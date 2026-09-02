#!/usr/bin/env node
/**
 * 🔄 sincronizar.js — põe o seu PC em dia com tudo que foi feito.
 *
 * Roda da raiz do repo:
 *     node ferramentas\sincronizar.js
 *
 * O que ele faz, nesta ordem:
 *   1. Baixa o que tem de novo (git pull)
 *   2. Mostra o que mudou DESDE A ÚLTIMA VEZ que você rodou (não desde sempre)
 *   3. Lê as entradas novas do CHANGELOG, em português, e diz o que virou o quê
 *   4. Confere as travas de versão (o famoso APP_BUILD_VERSION x web-version.json)
 *   5. Avisa se a EXTENSÃO mudou — ela não se atualiza sozinha, precisa reinstalar
 *   6. Roda os testes
 *   7. Lembra de mandar o Claude local ler o CONTEXTO-DO-PROJETO.md
 *
 * Opções:
 *     --sem-pull     não baixa nada, só analisa o que já está aqui
 *     --sem-teste    pula os testes (mais rápido)
 *     --tudo         mostra o histórico inteiro, não só o que é novo pra você
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const MARCA = path.join(__dirname, '.ultima-sincronizacao');   // ignorado pelo git
const args = process.argv.slice(2);
const opc = {
    semPull: args.includes('--sem-pull'),
    semTeste: args.includes('--sem-teste'),
    tudo: args.includes('--tudo'),
};

const log = (m) => process.stdout.write(m + '\n');
const titulo = (t) => { log(''); log('═'.repeat(66)); log(t); log('═'.repeat(66)); };
const git = (cmd, silencioso) => {
    try { return execSync('git ' + cmd, { cwd: RAIZ, encoding: 'utf8', stdio: silencioso ? 'pipe' : ['pipe', 'pipe', 'pipe'] }).trim(); }
    catch (e) { if (!silencioso) throw e; return ''; }
};

// ═══════════════════════════════════════════════════════════════════════════
log('');
log('🔄 SINCRONIZAR — Friganso ERP');

const antes = git('rev-parse HEAD', true);
let marcaAnterior = '';
try { marcaAnterior = fs.readFileSync(MARCA, 'utf8').trim(); } catch (e) {}

// ── 1) Baixa ───────────────────────────────────────────────────────────────
if (opc.semPull) {
    log('   (--sem-pull: não baixei nada)');
} else {
    titulo('📥 BAIXANDO');
    const sujo = git('status --porcelain', true);
    if (sujo) {
        log('⚠️  Você tem mudanças locais não commitadas:');
        sujo.split('\n').slice(0, 10).forEach(l => log('     ' + l));
        log('');
        log('   NÃO vou puxar por cima disso pra não atropelar seu trabalho.');
        log('   Commite (ou use "git stash") e rode de novo.');
        process.exit(1);
    }
    const ramo = git('rev-parse --abbrev-ref HEAD', true) || 'main';
    try {
        execSync('git pull origin ' + ramo, { cwd: RAIZ, stdio: 'inherit' });
    } catch (e) {
        log('\n⚠️  O pull falhou. Se foi queda de internet, é só rodar de novo.');
        process.exit(1);
    }
}

const agora = git('rev-parse HEAD', true);
// desde onde comparar: a última sincronização, ou o que veio agora no pull
const base = opc.tudo ? '' : (marcaAnterior || (antes !== agora ? antes : ''));

// ── 2) O que mudou ─────────────────────────────────────────────────────────
titulo('📝 O QUE MUDOU');
const faixa = base ? base + '..HEAD' : '-15';
const commits = git('log --oneline --no-decorate ' + faixa, true);
if (!commits) {
    log('   Nada novo desde a última vez que você rodou. Você já está em dia. ✅');
} else {
    const linhas = commits.split('\n').filter(Boolean);
    log(`   ${linhas.length} commit(s)${base ? ' desde a sua última sincronização' : ' (últimos 15)'}:\n`);
    linhas.forEach(l => log('   • ' + l));

    const arquivos = git('diff --name-only ' + (base ? base + '..HEAD' : 'HEAD~15..HEAD'), true);
    if (arquivos) {
        log('\n   Arquivos tocados:');
        arquivos.split('\n').filter(Boolean).forEach(a => log('     - ' + a));
    }
}

// ── 3) CHANGELOG novo (o que isso significa na prática) ────────────────────
const lerChangelog = (conteudo) => {
    const i = conteudo.indexOf('const CHANGELOG = [');
    if (i < 0) return [];
    const trecho = conteudo.slice(i, i + 60000);
    const entradas = [];
    const re = /\{\s*versao:\s*'([^']+)',\s*data:\s*'([^']+)',\s*areas:\s*\[([^\]]*)\],\s*itens:\s*\[([\s\S]*?)\]\s*\}/g;
    let m;
    while ((m = re.exec(trecho)) !== null) {
        const itens = [...m[4].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1].replace(/\\'/g, "'"));
        entradas.push({ versao: m[1], data: m[2], areas: m[3].replace(/'/g, '').split(',').map(s => s.trim()).filter(Boolean), itens });
    }
    return entradas;
};
const atual = lerChangelog(fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'));
let anteriores = [];
if (base) {
    const antigo = git('show ' + base + ':index.html', true);
    if (antigo) anteriores = lerChangelog(antigo);
}
const jaTinha = new Set(anteriores.map(e => e.versao));
const novasVersoes = atual.filter(e => !jaTinha.has(e.versao));

if (novasVersoes.length) {
    titulo('🆕 NOVIDADES (do CHANGELOG)');
    novasVersoes.forEach(e => {
        log(`\n   ▸ v${e.versao} — ${e.data}   [${e.areas.join(', ')}]`);
        e.itens.forEach(it => {
            // quebra em linhas de ~80 pra não virar um paredão
            const palavras = it.split(' ');
            let linha = '       ';
            palavras.forEach(p => {
                if ((linha + p).length > 84) { log(linha); linha = '         '; }
                linha += p + ' ';
            });
            log(linha.trimEnd());
        });
    });
}

// ── 4) Travas de versão ────────────────────────────────────────────────────
titulo('🔢 CONFERÊNCIA DE VERSÃO');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const buildWeb = JSON.parse(fs.readFileSync(path.join(RAIZ, 'web-version.json'), 'utf8')).version;
const buildApp = Number((/const APP_BUILD_VERSION = (\d+)/.exec(html) || [])[1]);
const sw = (/friganso-v(\d+)/.exec(fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8')) || [])[1];
const versaoCL = atual[0] ? atual[0].versao : '?';

log(`   web-version.json  : ${buildWeb}`);
log(`   APP_BUILD_VERSION : ${buildApp}`);
log(`   sw.js (cache)     : friganso-v${sw}`);
log(`   CHANGELOG (topo)  : v${versaoCL}`);
if (buildWeb !== buildApp) {
    log('');
    log('   ❌ web-version.json e APP_BUILD_VERSION NÃO batem!');
    log('      Isso prende o app num loop eterno de "atualização disponível".');
    process.exit(1);
}
log('\n   ✅ batem — sem risco do loop de atualização');

// ── 5) A extensão mudou? ───────────────────────────────────────────────────
titulo('🧩 EXTENSÃO');
const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'extensao', 'manifest.json'), 'utf8'));
const mexeuNaExtensao = base && git(`diff --name-only ${base}..HEAD -- extensao/ content.js friganso-extensao.zip`, true);
log(`   versão publicada: ${man.version_name || man.version}`);
if (mexeuNaExtensao) {
    log('');
    log('   ⚠️  A EXTENSÃO MUDOU — e ela NÃO se atualiza sozinha.');
    log('      1. Baixe a extensão de novo pelo site');
    log('      2. Descompacte por cima da pasta antiga');
    log('      3. Em chrome://extensions, clique no 🔄 Atualizar');
    log(`      Confira: tem que aparecer "${man.version_name || man.version}"`);
} else {
    log('   ✅ não mudou — nada pra reinstalar');
    log(`      (se o seu chrome://extensions mostra "${man.version_name || man.version}", está em dia;`);
    log('       o número dela NÃO acompanha o do site, só sobe quando a extensão muda)');
}

// ── 6) Testes ──────────────────────────────────────────────────────────────
if (!opc.semTeste) {
    titulo('🧪 TESTES');
    const testes = fs.readdirSync(__dirname).filter(f => /^teste-.*\.js$/.test(f)).sort();
    let falhou = 0, pulados = 0;
    testes.forEach(t => {
        try {
            const saida = execSync('node ' + JSON.stringify(path.join(__dirname, t)), { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe' });
            const nome = t.replace(/^teste-|\.js$/g, '').padEnd(24);
            // ⚠️ teste que NÃO rodou não pode aparecer como ✅ — seria pior que não ter teste.
            // Alguns pulam sozinhos quando falta um pacote (playwright, jspdf, xlsx, pdfjs-dist).
            const pulou = /Teste pulado|⏭️/.test(saida);
            const faltou = (/npm install ([\w@.\-\s]+)/.exec(saida) || [])[1];
            if (pulou) log(`   ⏭️  ${nome} NÃO RODOU — falta: ${(faltou || '?').trim()}`);
            else log(`   ✅ ${nome}`);
            if (pulou) pulados++;
        } catch (e) {
            falhou++;
            log(`   ❌ ${t.replace(/^teste-|\.js$/g, '')}`);
            const saida = ((e.stdout || '') + (e.stderr || '')).trim().split('\n').filter(l => l.includes('❌'));
            saida.slice(0, 5).forEach(l => log('        ' + l.trim()));
        }
    });
    if (falhou) log(`\n   ⚠️  ${falhou} teste(s) FALHANDO — vale investigar antes de mexer em mais coisa.`);
    if (pulados) {
        log(`\n   ${pulados} teste(s) não rodaram por falta de pacote. Pra rodar todos:`);
        log('       npm install playwright jspdf xlsx pdfjs-dist@3.11.174 react@18 react-dom@18 chart.js @babel/standalone');
        log('   (não são dependências do site — só destes testes)');
    }
    if (!falhou && !pulados) log('\n   ✅ tudo passando');
}

// ── 7) Fecho ───────────────────────────────────────────────────────────────
titulo('👉 PRÓXIMO PASSO');
log('   Pra deixar o Claude LOCAL a par de tudo, abra ele nesta pasta e diga:');
log('');
log('       leia o CONTEXTO-DO-PROJETO.md');
log('');
log('   Esse arquivo tem a arquitetura, as regras do projeto, as lições de bugs');
log('   antigos e o que está pendente. É o que sobrevive quando a conversa se perde.');

try { fs.writeFileSync(MARCA, agora); } catch (e) {}
log('');
log(`   (marquei ${agora.slice(0, 7)} como sua última sincronização)`);
log('');
