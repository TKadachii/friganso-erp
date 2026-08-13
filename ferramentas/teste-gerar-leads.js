const G = require('./gerar-leads.js');
const fs = require('fs');
let falhas = 0;
const ok = (c, msg) => { console.log(`${c ? '✅' : '❌'} ${msg}`); if (!c) falhas++; };

// ── Tabelas auxiliares simuladas (código -> nome), como vêm da Receita ──
const codigosCidade = new Map([['5905', 'Armação dos Búzios'], ['5867', 'Cabo Frio'], ['5901', 'Saquarema']]);
const descCnae = new Map([['5611201', 'Restaurantes e similares'], ['4722901', 'Comércio varejista de carnes - açougues']]);
const ctx = (opc = {}) => ({ codigosCidade, descCnae, opc });

// ── Linhas no layout POSICIONAL real (30 colunas, ';' e aspas) ──
// Colunas: 0 cnpjBasico;1 ordem;2 dv;3 matriz;4 fantasia;5 situacao;6 dtSit;7 motivo;8 cidExt;9 pais;
//          10 dtInicio;11 cnae;12 cnaeSec;13 tipoLog;14 log;15 num;16 compl;17 bairro;18 cep;19 uf;
//          20 municipio;21 ddd1;22 tel1;23 ddd2;24 tel2;25 dddFax;26 fax;27 email;28 sitEsp;29 dtSitEsp
const linha = (o) => {
    const c = new Array(30).fill('');
    Object.entries(o).forEach(([k, v]) => { c[G.EST[k]] = v; });
    return c.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';');
};

const restauranteBuzios = linha({
    cnpjBasico: '65095999', cnpjOrdem: '0001', cnpjDv: '45', nomeFantasia: 'ROTA DO SOL',
    situacao: '02', dataInicio: '20150310', cnaePrincipal: '5611201',
    tipoLogradouro: 'RUA', logradouro: 'CANTO ESQUERDO DE GERIBA', numero: '100',
    bairro: 'GERIBA', cep: '28953060', uf: 'RJ', municipio: '5905',
    ddd1: '22', telefone1: '992891542', email: 'SILVANALOPESBZ1@GMAIL.COM',
});
const acougueFixoSo   = linha({ cnpjBasico: '11111111', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'ACOUGUE DO ZE', situacao: '02', cnaePrincipal: '4722901', uf: 'RJ', municipio: '5867', ddd1: '22', telefone1: '26441234' });
const doisTelefones   = linha({ cnpjBasico: '22222222', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'BAR DO MAR', situacao: '02', cnaePrincipal: '5611201', uf: 'RJ', municipio: '5901', ddd1: '22', telefone1: '26449999', ddd2: '22', telefone2: '981234567' });
const inativa         = linha({ cnpjBasico: '33333333', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'FECHOU', situacao: '08', cnaePrincipal: '5611201', uf: 'RJ', municipio: '5905', ddd1: '22', telefone1: '999999999' });
const semTelefone     = linha({ cnpjBasico: '44444444', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'SEM ZAP', situacao: '02', cnaePrincipal: '5611201', uf: 'RJ', municipio: '5905' });
const outraCidade     = linha({ cnpjBasico: '55555555', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'NITEROI', situacao: '02', cnaePrincipal: '5611201', uf: 'RJ', municipio: '9999', ddd1: '21', telefone1: '999999999' });
const outroRamo       = linha({ cnpjBasico: '66666666', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'SOFTWARE', situacao: '02', cnaePrincipal: '6201501', uf: 'RJ', municipio: '5905', ddd1: '22', telefone1: '999999999' });
const outraUf         = linha({ cnpjBasico: '77777777', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'SP', situacao: '02', cnaePrincipal: '5611201', uf: 'SP', municipio: '5905', ddd1: '11', telefone1: '999999999' });
const nomeComAspas    = linha({ cnpjBasico: '88888888', cnpjOrdem: '0001', cnpjDv: '00', nomeFantasia: 'CHURRASCARIA "BOI; NA BRASA"', situacao: '02', cnaePrincipal: '5611201', uf: 'RJ', municipio: '5867', ddd1: '22', telefone1: '988887777' });

console.log('═══ 1. FILTRO (avaliarEstabelecimento) ═══');
const av = (l, opc) => G.avaliarEstabelecimento(G.quebrarLinha(l), ctx(opc));

const r1 = av(restauranteBuzios);
ok(r1 && !r1.descartado, 'restaurante de Búzios vira lead');
ok(r1 && r1.cnpj === '65095999000145', `CNPJ remontado das 3 partes → ${r1 && r1.cnpj}`);
ok(r1 && r1.telefone === '22992891542', `DDD juntado ao número → ${r1 && r1.telefone}`);
ok(r1 && r1.celular === 'SIM', 'marcado como celular');
ok(r1 && r1.municipio === 'Armação dos Búzios', `código 5905 traduzido → ${r1 && r1.municipio}`);
ok(r1 && r1.cnaeDescricao === 'Restaurantes e similares', 'CNAE traduzido pela tabela');
ok(r1 && r1.logradouro === 'RUA CANTO ESQUERDO DE GERIBA', 'tipo + logradouro juntados');

const r2 = av(acougueFixoSo);
ok(r2 && r2.celular === 'NAO', 'açougue só com fixo entra, marcado NAO');
ok(av(acougueFixoSo, { soCelular: true }).descartado === 'semCelular', '--so-celular descarta o fixo');

const r3 = av(doisTelefones);
ok(r3 && r3.telefone === '22981234567', `com fixo E celular, PREFERE o celular → ${r3 && r3.telefone}`);

ok(av(inativa).descartado === 'inativas', 'empresa inativa descartada por padrão');
ok(!av(inativa, { comInativas: true }).descartado, '--com-inativas deixa passar');
ok(av(semTelefone).descartado === 'semTelefone', 'sem telefone descartado');
ok(av(outraCidade) === null, 'cidade de fora ignorada');
ok(av(outroRamo) === null, 'CNAE de outro ramo ignorado');
ok(av(outraUf) === null, 'outra UF ignorada');

console.log('\n═══ 2. GERAÇÃO DO CSV ═══');
const leads = [restauranteBuzios, acougueFixoSo, doisTelefones, nomeComAspas].map(l => av(l)).filter(r => r && !r.descartado);
const csv = G.montarCsv(leads);
ok(csv.charCodeAt(0) === 0xFEFF, 'CSV sai com BOM (Excel abre com acento certo)');
ok(csv.replace(/^\uFEFF/, '').split('\n')[0] === G.COLUNAS_SAIDA.join(';'), 'primeira linha é o cabeçalho');
ok(csv.includes('"CHURRASCARIA ""BOI; NA BRASA"""'), 'nome com aspas e ponto-e-vírgula escapado direito');

console.log('\n═══ 3. VOLTA PELA TELA DE IMPORTAÇÃO (SheetJS + regex do index.html) ═══');
let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) {
    console.log('   ⏭️  pulada: o pacote "xlsx" não está instalado aqui.');
    console.log('      Pra rodar esta parte:  npm install xlsx');
}
if (XLSX) {
const tmpCsv = require('path').join(require('os').tmpdir(), 'leads-teste.csv');
fs.writeFileSync(tmpCsv, csv, 'utf8');
const wb = XLSX.read(new Uint8Array(fs.readFileSync(tmpCsv)), { type: 'array', raw: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false });
ok(rows.length === leads.length + 1, `SheetJS leu ${rows.length - 1} linha(s) + cabeçalho (separador ';' reconhecido)`);

// usa os MESMOS detectores de coluna que estão no index.html
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const dets = src.split('\n').filter(l => /^\s+const i[A-Z]\w*\s+=\s+cols?\(/.test(l)).map(l => l.trim());
const header = rows[0].map(c => String(c).toLowerCase().trim());
const col  = (re) => header.findIndex(h => re.test(h));
const cols = (re) => header.map((h, i) => re.test(h) ? i : -1).filter(i => i >= 0);
const A = {};
dets.forEach(l => { A[l.match(/const (i\w+)/)[1]] = eval(l.replace(/^const i\w+\s+=\s+/, '').replace(/;$/, '')); });

ok(A.iCnpj >= 0 && A.iRazao >= 0 && A.iMun >= 0, 'tela acha CNPJ, nome e cidade no arquivo gerado');
ok(A.iTels.length === 1 && header[A.iTels[0]] === 'telefone',
   `tela acha SÓ a coluna de telefone de verdade (${A.iTels.map(i => header[i]).join(', ')}) — nenhuma coluna auxiliar se disfarça de telefone`);
const lin = rows[1];
ok(String(lin[A.iCnpj]) === '65095999000145', 'CNPJ chega inteiro na tela (sem perder o zero à esquerda)');
ok(String(lin[A.iTels[0]]) === '22992891542', 'telefone chega pronto, já com DDD');
ok(String(lin[A.iMun]) === 'Armação dos Búzios', 'acento sobreviveu ao caminho todo');

}

console.log(falhas
    ? `\n❌ ${falhas} falha(s)`
    : `\n✅ todos passaram — ${leads.length} leads percorreram Receita → script → CSV${XLSX ? ' → tela' : ' (etapa da tela pulada, sem o pacote xlsx)'}`);
process.exit(falhas ? 1 : 0);
