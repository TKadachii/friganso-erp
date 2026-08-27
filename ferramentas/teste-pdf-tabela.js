// Testa a leitura da Tabela de Preços em PDF, sem precisar de PDF nenhum: monta as linhas no
// mesmo formato que o pdf.js entrega (itens com transform[4]=x e transform[5]=y).
//
// ⚠️ O bug que originou isto: o parser antigo usava FAIXAS DE X FIXAS (preço a partir de x=535).
// No PDF real a coluna à vista fica em x≈354 e as 9 colunas vão até ~570, então ele pegava o
// preço de 45 DIAS achando que era o à vista — ~8% mais caro, em silêncio. Medido contra o PDF
// real: 0 de 718 corretos. A correção é ler os preços por ORDEM, não por posição.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const trecho = (nome) => {
    const i = src.indexOf('const ' + nome + ' = ');
    if (i < 0) throw new Error('não achei ' + nome);
    const abre = src.indexOf('{', src.indexOf('=>', i));
    const fimLinha = src.indexOf('\n', i);
    if (abre < 0 || abre > fimLinha) return src.slice(i, fimLinha).replace(/^const /, 'globalThis.').replace(/;$/, '');
    let prof = 0, f = -1;
    for (let k = abre; k < src.length; k++) { if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } } }
    return src.slice(i, f).replace(/^const /, 'globalThis.');
};
['PDF_TEM_CARA_DE_PRECO', 'PDF_LINHA_DE_CABECALHO', 'PDF_TIPOS_EMBALAGEM', 'PDF_DIAS_PRAZO', 'PDF_NOME_CORROMPIDO', 'extrairProdutosDaPaginaPdf'].forEach(n => eval(trecho(n)));

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };
const item = (x, y, str) => ({ str, transform: [0, 0, 0, 0, x, y] });
const paginaFalsa = (linhas) => { const m = new Map(); linhas.forEach(([y, its]) => m.set(y, its)); return m; };

// Layout REAL medido no Tabela_2708.pdf: código x=40, nome x=68, tipo x=178, peso x=200,
// peças x=234, un x=254, est-venda x=290, e as 9 colunas de preço de x=354 a x=570.
const linhaProduto = (y, cod, nome, precos, tipo) => [y, [
    item(40, y, cod), item(68, y, nome), item(178, y, tipo || 'PC'),
    item(200, y, '300 Kg'), item(234, y, '1 Pç'), item(254, y, 'Kg [L]'), item(290, y, '6077.8 Kg/127 Un'),
    ...precos.map((v, k) => item(354 + k * 27, y, v.toFixed(2))),
]];
const PRECOS_1602 = [23.00, 23.35, 23.35, 23.69, 23.92, 24.38, 24.61, 24.84, 24.84];

console.log('═══ 1. PREÇO POR ORDEM (o coração da correção) ═══');
let r = extrairProdutosDaPaginaPdf(paginaFalsa([linhaProduto(600, '1602', 'DIANTEIRO BOVINO', PRECOS_1602)]));
ok(r.length === 1, 'leu 1 produto');
ok(r[0].originalPrice === 23.00, `à vista = a PRIMEIRA coluna, 23,00 (o bug pegava 24,84) → ${r[0].originalPrice}`);
ok(r[0].precoCartao === 23.35, 'cartão = a segunda coluna');
ok(r[0].precosPrazo[45] === 24.84, '45 dias = a última coluna');
ok(r[0].precosPrazo[7] === 23.35 && r[0].precosPrazo[21] === 23.92, 'os prazos entram na ordem certa');
ok(r[0].name === 'DIANTEIRO BOVINO', `nome limpo, sem peso/peças/unidade → "${r[0].name}"`);
ok(r[0].tipo === 'PC', 'tipo separado do nome');

console.log('\n═══ 2. NOME QUE TRANSBORDA (pra cima E pra baixo) ═══');
// ⚠️ o nome ocupa mais linhas que o código: parte fica ACIMA da linha do código do próprio
// produto. Juntar "só a linha de baixo" cola o nome do produto seguinte no anterior.
r = extrairProdutosDaPaginaPdf(paginaFalsa([
    linhaProduto(648, '0133', 'BATATA BEM BRASIL 9MM', PRECOS_1602, 'CX'),
    [642, [item(68, 642, 'TRADICIONAL CX/14 X 1.05KG')]],   // continuação do 0133
    [636, [item(68, 636, 'BATATA BEM BRASIL MAIS')]],       // já é do 01055, ACIMA do código dele
    linhaProduto(630, '01055', '', PRECOS_1602, 'CX'),
    [624, [item(68, 624, 'BATATA 6X2,5KG')]],               // continuação do 01055
]));
const p133 = r.find(p => p.code === '0133'), p1055 = r.find(p => p.code === '01055');
ok(p133.name === 'BATATA BEM BRASIL 9MM TRADICIONAL CX/14 X 1.05KG', `0133 → "${p133.name}"`);
ok(!/MAIS/.test(p133.name), 'o 0133 NÃO leva junto o nome do produto seguinte');
ok(p1055.name === 'BATATA BEM BRASIL MAIS BATATA 6X2,5KG', `01055 junta o de cima e o de baixo → "${p1055.name}"`);

console.log('\n═══ 3. CABEÇALHO NÃO VIRA NOME ═══');
// o cabeçalho se repete em toda página, logo acima do 1º produto
r = extrairProdutosDaPaginaPdf(paginaFalsa([
    [696, [item(98, 696, 'ÍTEM'), item(176, 696, 'UN.'), item(230, 696, 'Peças'), item(281, 696, 'EST-VENDA')]],
    linhaProduto(672, '0004', 'BOLSA TÉRMICA FRIGANSO', PRECOS_1602, 'CX'),
]));
ok(r[0].name === 'BOLSA TÉRMICA FRIGANSO', `sem "ÍTEM" grudado → "${r[0].name}"`);

console.log('\n═══ 4. NÃO INVENTAR PRODUTO ═══');
// ⚠️ o parser antigo lia o número da coluna EST-VENDA ("1428 Kg/87 Un") como se fosse código e
// criava produtos fantasma. 30 deles ainda existem na tabela do usuário.
r = extrairProdutosDaPaginaPdf(paginaFalsa([
    linhaProduto(600, '1602', 'DIANTEIRO BOVINO', PRECOS_1602),
    [594, [item(290, 594, '1428 Kg/87 Un')]],   // número de estoque solto: NÃO é produto
]));
ok(r.length === 1, `só 1 produto (o estoque solto não virou produto) → ${r.length}`);
ok(!r.some(p => p.code === '1428'), 'não criou o fantasma 1428');

console.log('\n═══ 5. LAYOUT ANTIGO (1 preço só) CONTINUA LENDO ═══');
r = extrairProdutosDaPaginaPdf(paginaFalsa([[500, [
    item(40, 500, '9999'), item(68, 500, 'PRODUTO ANTIGO'), item(178, 500, 'CX'), item(545, 500, '12.34'),
]]]));
ok(r.length === 1 && r[0].originalPrice === 12.34, 'PDF com uma coluna de preço só ainda funciona');
ok(r[0].precoCartao === null && r[0].precosPrazo === null, 'sem cartão nem prazos, em vez de inventar');

console.log('\n═══ 6. A REGRA DO NOME ═══');
ok(PDF_NOME_CORROMPIDO.test('COXA PILÃO ENV. (LAR) PLT 500 à 1200 Kg 1 Pç Kg [L] 2300 Kg/3 Un'), 'reconhece nome estragado pelo parser antigo');
ok(!PDF_NOME_CORROMPIDO.test('HAMBURG. AVE/BOV 12PC X 672GR PERDIGÃO CX/8.064KG'), 'NÃO confunde nome legítimo com "12PC" no meio');
ok(!PDF_NOME_CORROMPIDO.test('QUEIJO MINAS FRESCAL ITALATE SC 8 PC +- 0.5GR'), 'NÃO confunde nome legítimo com "8 PC"');
ok(!PDF_NOME_CORROMPIDO.test('DIANTEIRO BOVINO'), 'nome normal passa intacto');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
