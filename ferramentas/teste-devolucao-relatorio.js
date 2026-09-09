// ↩️ Testa a leitura de DEVOLUÇÃO no relatório de vendas (lerLinhaPedido do content.js).
//
// ⚠️ O bug que originou isto (09/09/2026): a marca de devolução ("E" amarelo em E/S, "D" vermelho em
// DEV) era procurada numa FAIXA FIXA DE TELA — x entre 600 e 900. Essa faixa depende da largura da
// janela, do zoom e do tamanho do nome do cliente. Na tela de faturamento do dia as células estavam
// em x=554 e x=576, ou seja, FORA da faixa: nenhuma das 10 devoluções do mês era detectada e todas
// somavam como venda. Total do mês saía R$ 298.047,57 em vez de R$ 276.399,47 (R$ 21.648,10 a mais).
//
// O mesmo vício de pixel (x > 2000) matava o total faturado de TODO pedido — o valor fica em x=1643.
//
// Por isso este teste checa DUAS coisas: que a leitura por coluna funciona, e que os números mágicos
// de pixel NÃO voltaram pro código.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'extensao', 'content.js'), 'utf8');

function extrairFuncao(nome) {
    const i = src.indexOf('function ' + nome + '(');
    if (i < 0) { console.log('❌ não achei ' + nome + ' no content.js'); process.exit(1); }
    let prof = 0, f = -1;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } }
    }
    return src.slice(i, f);
}
eval(extrairFuncao('normLabelRel').replace('function normLabelRel', 'globalThis.normLabelRel = function'));
eval(extrairFuncao('mapaColunasRelatorio').replace('function mapaColunasRelatorio', 'globalThis.mapaColunasRelatorio = function'));
eval(extrairFuncao('lerLinhaPedido').replace('function lerLinhaPedido', 'globalThis.lerLinhaPedido = function'));

// --- DOM de mentira, só com o que a função usa (sem dependência nenhuma) ---
const cel = (txt, opt) => ({
    textContent: txt, children: [], _bg: (opt && opt.bg) || null, _b: !!(opt && opt.b),
    getAttribute(n) { return n === 'bgcolor' ? this._bg : null; },
    querySelector(sel) { return sel === 'b' && this._b ? {} : null; },
});
const CAB = ['#', 'SPAMOV', 'O.E. ATUAL', 'N.F.', 'CLIENTE', 'E/S', 'DEV', 'FIN', 'CFOP', 'DATA', 'COND.PGTO.', 'VALOR'];
function montar(linhas, comCabecalho) {
    const tabela = { rows: [] };
    if (comCabecalho !== false) tabela.rows.push({ cells: CAB.map(t => cel(t)) });
    linhas.forEach(cells => { const tr = { cells, closest: s => (s === 'table' ? tabela : null) }; tr.cells = cells; tabela.rows.push(tr); });
    tabela.rows.forEach(r => { if (!r.closest) r.closest = s => (s === 'table' ? tabela : null); });
    const doc = { querySelectorAll: () => [tabela] };
    return { tabela, doc, ancora: tr => ({ closest: s => (s === 'tr' ? tr : s === 'table' ? tabela : null) }) };
}
// linha do relatório: #, SPAMOV, O.E., N.F., CLIENTE, E/S, DEV, FIN, CFOP, DATA, PREV, COND, VALOR-PEDIDO, VALOR-FATURADO
const linha = (es, dev, cfop, vlrPedido, vlrFaturado) => ([
    cel('17'), cel('1984355', { b: true }), cel('0/0', { b: true }), cel('1679101/1nfe', { b: true }),
    cel('[j] 54711 - g José dos Santos'),
    cel(es, { bg: es === 'E' ? 'ffffcc' : null }), cel(dev, { bg: dev === 'D' ? 'ffcccc' : null }),
    cel(''), cel(cfop), cel('03-09-2026 20:04:37'), cel('03-09-2026 23:04:50'), cel('14 d.m.'),
    cel(vlrPedido), cel(vlrFaturado, { b: true }),
]);

let falhas = 0;
function checa(nome, cond, extra) {
    if (!cond) falhas++;
    console.log(`${cond ? '✅' : '❌'} ${nome}${cond ? '' : '  → ' + extra}`);
}
function ler(cells, comCabecalho) {
    const m = montar([cells], comCabecalho);
    return lerLinhaPedido(m.ancora(m.tabela.rows[m.tabela.rows.length - 1]), mapaColunasRelatorio(m.doc));
}

// 1) venda normal
let r = ler(linha('S', '', '5.102/', '1.065,85', '1.065,85'));
checa('venda normal não é devolução', r.devolucao === false, JSON.stringify(r));
checa('venda normal lê o faturado', r.faturadoTotal === 1065.85, JSON.stringify(r));

// 2) devolução (o caso que estava passando batido)
r = ler(linha('E', 'D', '1.202/', '462,40', '460,72'));
checa('devolução é detectada pela coluna', r.devolucao === true, JSON.stringify(r));
checa('devolução lê o faturado', r.faturadoTotal === 460.72, JSON.stringify(r));

// 3) devolução lançada SEM nota: faturado vazio => null, e NÃO pode pegar a coluna PEDIDO do lado
r = ler(linha('E', 'D', '1.202/', '667,25', ''));
checa('pedido sem faturamento fica null', r.faturadoTotal === null, JSON.stringify(r));
checa('e não rouba o valor da coluna PEDIDO', r.faturadoTotal !== 667.25, JSON.stringify(r));

// 4) cabeçalho irreconhecível: plano B ainda acha o "D" varrendo a própria linha (sem pixel)
r = ler(linha('E', 'D', '1.202/', '462,40', '460,72'), false);
checa('plano B pega devolução sem o cabeçalho', r.devolucao === true, JSON.stringify(r));

// 5) só CFOP de entrada, sem E nem D escritos
r = ler(linha('', '', '1.202/', '100,00', '100,00'));
checa('CFOP 1.xxx sozinho já marca devolução', r.devolucao === true, JSON.stringify(r));

// 6) regressão: os números mágicos de pixel não podem voltar.
// Olha só o CÓDIGO — as linhas de comentário citam os valores antigos de propósito, pra explicar o
// bug, e não podem derrubar o teste.
const codigo = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
checa('sem a faixa de pixel 600..900', !/x\s*>\s*600\s*&&[^\n]*x\s*<\s*900/.test(codigo), 'voltou o filtro por posição de tela');
checa('sem o corte x > 2000 no faturado', !/\.x\s*>\s*2000/.test(codigo), 'voltou o corte de pixel do faturado');
checa('devolução não é mais descartada', !/filter\(function \(p\) \{ return !p\.devolvido; \}\)/.test(codigo), 'voltou o filtro que jogava devolução fora');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
