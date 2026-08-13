#!/usr/bin/env node
/**
 * 🎯 gerar-leads.js — monta a lista de leads da Prospecção em Massa a partir da base
 *                     PÚBLICA e GRATUITA de CNPJ da Receita Federal.
 *
 * Por que existe: o CNPJ.biz e o Casa dos Dados não têm base própria — os dois revendem
 * exatamente este arquivo. O telefone e o email que eles cobram pra mostrar são os campos
 * `telefone_1` e `correio_eletronico` da tabela ESTABELECIMENTOS. Este script baixa a fonte,
 * filtra as suas cidades e os seus segmentos, e cospe um CSV pronto pra importar na tela
 * "🎯 Prospecção em Massa" do Friganso ERP.
 *
 * COMO USAR (no PowerShell, na pasta do projeto):
 *     node ferramentas\gerar-leads.js
 *
 * Opções:
 *     --pasta 2026-07     usa uma pasta específica da Receita (padrão: descobre a mais nova)
 *     --so-celular        joga fora quem não tem celular (9 dígitos começando com 9)
 *     --com-inativas      inclui empresas não-ATIVAS (padrão: só ATIVAS)
 *     --razao             também baixa a tabela EMPRESAS pra trazer a Razão Social
 *                         (⚠️ dobra o download; sem isso vem só o Nome Fantasia)
 *     --saida arquivo.csv nome do arquivo gerado (padrão: leads-friganso.csv)
 *     --manter-zips       não apaga os .zip depois de usar (pra rodar de novo sem rebaixar)
 *
 * ⚠️ AVISOS SOBRE O FORMATO DA RECEITA (as pegadinhas que quebram quem tenta na mão):
 *   • Os CSVs NÃO têm linha de cabeçalho — as colunas são POSICIONAIS (layout oficial).
 *   • O encoding é ISO-8859-1 (latin1), não UTF-8. Ler como UTF-8 estraga todo acento.
 *   • O separador é ponto-e-vírgula, com os campos entre aspas.
 *   • Município e CNAE vêm como CÓDIGO, não como nome — por isso as tabelas auxiliares.
 *   • O DDD vem numa coluna separada do número do telefone.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════════════
// ⚙️ CONFIGURAÇÃO — é aqui que você mexe
// ═══════════════════════════════════════════════════════════════════════════

const UF_ALVO = 'RJ';

// Região dos Lagos. Escreva SEM acento e em MAIÚSCULA — a comparação é feita sem acento,
// então "ARMACAO DOS BUZIOS" casa com "Armação dos Búzios" do arquivo da Receita.
const CIDADES_ALVO = [
    'CABO FRIO',
    'ARMACAO DOS BUZIOS',
    'SAO PEDRO DA ALDEIA',
    'ARRAIAL DO CABO',
    'ARARUAMA',
    'IGUABA GRANDE',
    'SAQUAREMA',
];

// Segmentos que compram carne. O prefixo de 4 dígitos do CNAE já basta.
const CNAES_ALVO = {
    '5611': 'Restaurante / Lanchonete',
    '5612': 'Ambulante de alimentação',
    '5620': 'Buffet / Fornecimento de comida',
    '4711': 'Supermercado / Minimercado',
    '4712': 'Mercearia / Armazém',
    '4713': 'Loja de departamentos',
    '4721': 'Padaria / Confeitaria',
    '4722': 'Açougue / Peixaria',
    '5510': 'Hotel / Pousada',
    '5590': 'Outros alojamentos',
};

const BASE_URL = 'https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj';
const PASTA_TRABALHO = path.join(__dirname, '_dados-receita');

// ═══════════════════════════════════════════════════════════════════════════
// 📐 LAYOUT OFICIAL — posição de cada coluna (o arquivo não tem cabeçalho)
// ═══════════════════════════════════════════════════════════════════════════
const EST = {
    cnpjBasico: 0, cnpjOrdem: 1, cnpjDv: 2, matrizFilial: 3, nomeFantasia: 4,
    situacao: 5, dataSituacao: 6, motivoSituacao: 7, cidadeExterior: 8, pais: 9,
    dataInicio: 10, cnaePrincipal: 11, cnaeSecundaria: 12, tipoLogradouro: 13,
    logradouro: 14, numero: 15, complemento: 16, bairro: 17, cep: 18, uf: 19,
    municipio: 20, ddd1: 21, telefone1: 22, ddd2: 23, telefone2: 24,
    dddFax: 25, fax: 26, email: 27, situacaoEspecial: 28, dataSituacaoEspecial: 29,
};
const SITUACAO_ATIVA = '02';

// ═══════════════════════════════════════════════════════════════════════════
// 🧰 Utilidades
// ═══════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const temFlag = (f) => args.includes(f);
const valorFlag = (f, padrao) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; };

const OPC = {
    pasta: valorFlag('--pasta', null),
    soCelular: temFlag('--so-celular'),
    comInativas: temFlag('--com-inativas'),
    comRazao: temFlag('--razao'),
    saida: valorFlag('--saida', 'leads-friganso.csv'),
    manterZips: temFlag('--manter-zips'),
};

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

/** Celular = 9 dígitos começando com 9 (fixo tem 8). É o que separa o contato do DONO. */
const ehCelular = (tel) => {
    let d = soDigitos(tel);
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return d[2] === '9';
    if (d.length === 9) return d[0] === '9';
    return false;
};

/** Quebra uma linha do CSV da Receita: separador ';' e campos entre aspas. */
function quebrarLinha(linha) {
    const campos = [];
    let atual = '', dentroDeAspas = false;
    for (let i = 0; i < linha.length; i++) {
        const c = linha[i];
        if (c === '"') {
            if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
            else dentroDeAspas = !dentroDeAspas;
        } else if (c === ';' && !dentroDeAspas) {
            campos.push(atual); atual = '';
        } else atual += c;
    }
    campos.push(atual);
    return campos;
}

/** Escapa um campo pro CSV de saída. */
const csvCampo = (v) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * Decide se UMA linha de ESTABELECIMENTOS vira lead, e monta o registro.
 * Fica separada do laço principal de propósito: é a regra de negócio inteira do script,
 * e assim dá pra testá-la sem baixar 2,5 GB. Devolve `null` quando a linha não serve.
 */
function avaliarEstabelecimento(c, ctx) {
    const { codigosCidade, descCnae, opc } = ctx;
    if (c[EST.uf] !== UF_ALVO) return null;
    if (!codigosCidade.has(c[EST.municipio])) return null;
    const cnae = soDigitos(c[EST.cnaePrincipal]);
    if (!CNAES_ALVO[cnae.slice(0, 4)]) return null;
    if (!opc.comInativas && c[EST.situacao] !== SITUACAO_ATIVA) return { descartado: 'inativas' };

    // 📞 DDD e número vêm em colunas separadas — junta e PREFERE o celular
    const t1 = soDigitos(c[EST.ddd1]) + soDigitos(c[EST.telefone1]);
    const t2 = soDigitos(c[EST.ddd2]) + soDigitos(c[EST.telefone2]);
    const candidatos = [t1, t2].filter(t => t.length >= 10);
    const telefone = candidatos.find(ehCelular) || candidatos[0] || '';
    if (!telefone) return { descartado: 'semTelefone' };
    if (opc.soCelular && !ehCelular(telefone)) return { descartado: 'semCelular' };

    return {
        cnpjBasico: c[EST.cnpjBasico],
        cnpj: c[EST.cnpjBasico] + c[EST.cnpjOrdem] + c[EST.cnpjDv],
        nomeFantasia: (c[EST.nomeFantasia] || '').trim(),
        razaoSocial: '',
        telefone,
        celular: ehCelular(telefone) ? 'SIM' : 'NAO',
        email: (c[EST.email] || '').trim().toLowerCase(),
        municipio: codigosCidade.get(c[EST.municipio]),
        uf: c[EST.uf],
        bairro: (c[EST.bairro] || '').trim(),
        logradouro: [c[EST.tipoLogradouro], c[EST.logradouro]].filter(Boolean).join(' ').trim(),
        numero: (c[EST.numero] || '').trim(),
        cep: soDigitos(c[EST.cep]),
        cnae,
        cnaeDescricao: descCnae.get(c[EST.cnaePrincipal]) || CNAES_ALVO[cnae.slice(0, 4)] || '',
        situacaoCadastral: c[EST.situacao] === SITUACAO_ATIVA ? 'ATIVA' : 'NAO ATIVA',
        dataAbertura: c[EST.dataInicio],
    };
}

/** Monta o CSV final (com cabeçalho) a partir dos leads achados. */
const COLUNAS_SAIDA = ['cnpj', 'razao_social', 'nome_fantasia', 'telefone', 'contato_movel', 'email',
                       'municipio', 'uf', 'bairro', 'logradouro', 'numero', 'cep',
                       'cnae', 'cnae_descricao', 'situacao_cadastral', 'data_abertura'];
function montarCsv(achados) {
    const linhas = [COLUNAS_SAIDA.join(';')];
    for (const a of achados) {
        linhas.push([
            a.cnpj, a.razaoSocial, a.nomeFantasia, a.telefone, a.celular, a.email,
            a.municipio, a.uf, a.bairro, a.logradouro, a.numero, a.cep,
            a.cnae, a.cnaeDescricao, a.situacaoCadastral, a.dataAbertura,
        ].map(csvCampo).join(';'));
    }
    return '﻿' + linhas.join('\n');
}

function log(msg) { process.stdout.write(msg + '\n'); }
function barra(atual, total, rotulo) {
    const pct = total ? Math.floor((atual / total) * 100) : 0;
    const cheio = Math.floor(pct / 4);
    process.stdout.write(`\r   [${'█'.repeat(cheio)}${'░'.repeat(25 - cheio)}] ${pct}% ${rotulo}   `);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🌐 Download
// ═══════════════════════════════════════════════════════════════════════════

function baixarTexto(url, redirecoes = 0) {
    return new Promise((resolve, reject) => {
        if (redirecoes > 5) return reject(new Error('Redirecionamentos demais.'));
        https.get(url, res => {
            if ([301, 302, 307, 308].includes(res.statusCode)) {
                res.resume();
                return resolve(baixarTexto(new URL(res.headers.location, url).href, redirecoes + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' em ' + url)); }
            let dados = '';
            res.setEncoding('utf8');
            res.on('data', d => dados += d);
            res.on('end', () => resolve(dados));
        }).on('error', reject);
    });
}

function baixarArquivo(url, destino, rotulo, redirecoes = 0) {
    return new Promise((resolve, reject) => {
        if (redirecoes > 5) return reject(new Error('Redirecionamentos demais.'));
        const req = https.get(url, res => {
            if ([301, 302, 307, 308].includes(res.statusCode)) {
                res.resume();
                return resolve(baixarArquivo(new URL(res.headers.location, url).href, destino, rotulo, redirecoes + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' em ' + url)); }
            const total = Number(res.headers['content-length'] || 0);
            let baixado = 0;
            const out = fs.createWriteStream(destino);
            res.on('data', c => { baixado += c.length; if (total) barra(baixado, total, rotulo); });
            res.pipe(out);
            out.on('finish', () => { out.close(() => { process.stdout.write('\n'); resolve(); }); });
            out.on('error', reject);
        });
        req.on('error', reject);
    });
}

/** Descobre a pasta mais nova (AAAA-MM) publicada pela Receita. */
async function descobrirPastaMaisNova() {
    if (OPC.pasta) return OPC.pasta;
    log('🔎 Procurando a publicação mais recente da Receita...');
    const html = await baixarTexto(BASE_URL + '/');
    const pastas = [...html.matchAll(/(\d{4}-\d{2})\//g)].map(m => m[1]);
    if (!pastas.length) throw new Error('Não consegui listar as pastas. Rode com --pasta AAAA-MM (ex.: --pasta 2026-07).');
    const maisNova = [...new Set(pastas)].sort().pop();
    log(`   Usando a publicação de ${maisNova}`);
    return maisNova;
}

/** Descompacta usando o Expand-Archive do Windows (sem depender de pacote npm). */
function descompactar(zip, destino) {
    try {
        execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destino}' -Force`], { stdio: 'pipe' });
    } catch (e) {
        throw new Error(`Não consegui descompactar ${path.basename(zip)}. No Windows isso usa o Expand-Archive do PowerShell. Erro: ${e.message}`);
    }
}

/**
 * Lê um CSV grande da Receita linha a linha, sem carregar o arquivo inteiro na memória.
 * ⚠️ latin1: ler como UTF-8 estraga todos os acentos.
 */
function lerLinhas(arquivo, aoLerLinha) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(arquivo, { encoding: 'latin1', highWaterMark: 1 << 20 });
        let resto = '';
        stream.on('data', pedaco => {
            const linhas = (resto + pedaco).split('\n');
            resto = linhas.pop();
            for (const l of linhas) if (l.trim()) aoLerLinha(quebrarLinha(l.replace(/\r$/, '')));
        });
        stream.on('end', () => { if (resto.trim()) aoLerLinha(quebrarLinha(resto.replace(/\r$/, ''))); resolve(); });
        stream.on('error', reject);
    });
}

/** Baixa, descompacta, processa e limpa — um arquivo por vez, pra não encher o disco. */
async function processarZip(url, nomeZip, aoLerLinha) {
    const zip = path.join(PASTA_TRABALHO, nomeZip);
    const pastaExtraida = path.join(PASTA_TRABALHO, nomeZip.replace('.zip', ''));
    if (!fs.existsSync(zip)) await baixarArquivo(url, zip, nomeZip);
    else log(`   ${nomeZip} já baixado, reaproveitando.`);

    fs.mkdirSync(pastaExtraida, { recursive: true });
    descompactar(zip, pastaExtraida);
    for (const f of fs.readdirSync(pastaExtraida)) {
        await lerLinhas(path.join(pastaExtraida, f), aoLerLinha);
    }
    fs.rmSync(pastaExtraida, { recursive: true, force: true });
    if (!OPC.manterZips) fs.rmSync(zip, { force: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 Principal
// ═══════════════════════════════════════════════════════════════════════════

async function principal() {
    log('');
    log('🎯 GERADOR DE LEADS — Friganso ERP');
    log('   Fonte: base pública de CNPJ da Receita Federal (a mesma que o CNPJ.biz revende)');
    log('');
    log(`   Cidades:   ${CIDADES_ALVO.join(', ')}`);
    log(`   Segmentos: ${[...new Set(Object.values(CNAES_ALVO))].length} tipos (restaurante, mercado, açougue, padaria, hotel, buffet)`);
    log(`   Situação:  ${OPC.comInativas ? 'ativas e inativas' : 'só ATIVAS'}`);
    log(`   Telefone:  ${OPC.soCelular ? 'só quem tem CELULAR' : 'qualquer telefone'}`);
    log('');

    fs.mkdirSync(PASTA_TRABALHO, { recursive: true });
    const pasta = await descobrirPastaMaisNova();
    const url = (nome) => `${BASE_URL}/${pasta}/${nome}`;

    // ── 1. Tabela de municípios: preciso do CÓDIGO das minhas cidades ────────
    log('\n🏙️  Baixando a tabela de municípios...');
    const codigosCidade = new Map();   // código -> nome bonito
    const alvosSemAcento = new Set(CIDADES_ALVO.map(semAcento));
    await processarZip(url('Municipios.zip'), 'Municipios.zip', (c) => {
        if (alvosSemAcento.has(semAcento(c[1]))) codigosCidade.set(c[0], c[1]);
    });
    if (!codigosCidade.size) throw new Error('Nenhuma das cidades da lista foi encontrada. Confira a grafia em CIDADES_ALVO.');
    log(`   ✅ ${codigosCidade.size} cidade(s) localizada(s): ${[...codigosCidade.values()].join(', ')}`);
    const naoAchadas = CIDADES_ALVO.filter(c => ![...codigosCidade.values()].some(v => semAcento(v) === semAcento(c)));
    if (naoAchadas.length) log(`   ⚠️  Não achei: ${naoAchadas.join(', ')} — confira a grafia.`);

    // ── 2. Tabela de CNAEs: só pra escrever a descrição bonita na saída ──────
    log('\n🏷️  Baixando a tabela de CNAEs...');
    const descCnae = new Map();
    await processarZip(url('Cnaes.zip'), 'Cnaes.zip', (c) => {
        const pref = soDigitos(c[0]).slice(0, 4);
        if (CNAES_ALVO[pref] && !descCnae.has(c[0])) descCnae.set(c[0], c[1]);
    });
    log(`   ✅ ${descCnae.size} CNAE(s) dos seus segmentos`);

    // ── 3. Estabelecimentos: o arquivo grande, 10 partes ────────────────────
    log('\n🏢 Baixando e filtrando os estabelecimentos (parte mais demorada)...');
    const achados = [];
    let lidos = 0;
    const estatisticas = { semTelefone: 0, semCelular: 0, inativas: 0 };

    for (let i = 0; i < 10; i++) {
        log(`\n   ── Parte ${i + 1} de 10`);
        await processarZip(url(`Estabelecimentos${i}.zip`), `Estabelecimentos${i}.zip`, (c) => {
            lidos++;
            const r = avaliarEstabelecimento(c, { codigosCidade, descCnae, opc: OPC });
            if (!r) return;
            if (r.descartado) { estatisticas[r.descartado]++; return; }
            achados.push(r);
        });
        log(`   ${achados.length} lead(s) até agora (de ${lidos.toLocaleString('pt-BR')} empresas lidas)`);
    }

    if (!achados.length) throw new Error('Nenhum lead encontrado. Confira CIDADES_ALVO e CNAES_ALVO.');

    // ── 4. Razão Social (opcional): exige a tabela EMPRESAS, que dobra o download ──
    if (OPC.comRazao) {
        log('\n📇 Baixando a tabela de empresas pra pegar a Razão Social...');
        const querRazao = new Set(achados.map(a => a.cnpjBasico));
        const razoes = new Map();
        for (let i = 0; i < 10; i++) {
            log(`\n   ── Parte ${i + 1} de 10`);
            await processarZip(url(`Empresas${i}.zip`), `Empresas${i}.zip`, (c) => {
                if (querRazao.has(c[0])) razoes.set(c[0], (c[1] || '').trim());
            });
        }
        achados.forEach(a => { a.razaoSocial = razoes.get(a.cnpjBasico) || ''; });
        log(`   ✅ ${razoes.size} razão(ões) social(is)`);
    }

    // ── 5. Escreve o CSV ────────────────────────────────────────────────────
    // ⚠️ COM cabeçalho e em UTF-8 com BOM: a tela de importação acha as colunas pelo NOME,
    //    e o BOM faz o Excel abrir com os acentos certos se você quiser conferir na mão.
    const saida = path.isAbsolute(OPC.saida) ? OPC.saida : path.join(process.cwd(), OPC.saida);
    fs.writeFileSync(saida, montarCsv(achados), 'utf8');

    // ── 6. Resumo ───────────────────────────────────────────────────────────
    const comCelular = achados.filter(a => a.celular === 'SIM').length;
    const porCidade = {};
    achados.forEach(a => { porCidade[a.municipio] = (porCidade[a.municipio] || 0) + 1; });

    log('\n');
    log('═'.repeat(58));
    log(`✅ PRONTO — ${achados.length} leads salvos em:`);
    log(`   ${saida}`);
    log('═'.repeat(58));
    log(`   📱 Com celular:  ${comCelular} (${Math.round(comCelular / achados.length * 100)}%)`);
    log(`   ✉️  Com email:    ${achados.filter(a => a.email).length}`);
    log('');
    log('   Por cidade:');
    Object.entries(porCidade).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => log(`     ${String(n).padStart(5)}  ${c}`));
    log('');
    log('   Por segmento:');
    const porSeg = {};
    achados.forEach(a => { const s = CNAES_ALVO[a.cnae.slice(0, 4)] || 'Outro'; porSeg[s] = (porSeg[s] || 0) + 1; });
    Object.entries(porSeg).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => log(`     ${String(n).padStart(5)}  ${s}`));
    log('');
    log('👉 Agora abra o Friganso ERP → 🎯 Prospecção em Massa → "Selecionar planilha de leads"');
    log('   e escolha esse arquivo.');
    log('');
}

if (require.main === module) {
    principal().catch(err => {
        log('\n\n❌ ' + err.message);
        log('\nDica: se o download falhar, rode de novo — os arquivos já baixados são reaproveitados.');
        process.exit(1);
    });
}

// exportado só pros testes
module.exports = { quebrarLinha, ehCelular, semAcento, csvCampo, avaliarEstabelecimento, montarCsv, COLUNAS_SAIDA, EST, CNAES_ALVO };
