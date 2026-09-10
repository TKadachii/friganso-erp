// 🎯 Testa a regra de POSITIVAÇÃO DO MÊS (positivacaoNoMes / textoPositivacao do index.html).
//
// Positivar = fazer o cliente comprar pelo menos uma vez dentro do mês. É a meta que decide o mês do
// vendedor, e ela não aparece em nenhum gráfico de faturamento: dá pra bater a meta de dinheiro com
// metade da carteira parada.
//
// ⚠️ A armadilha que este teste existe pra travar: o corte TEM que ser pelo campo `dia` (a data da
// VENDA) e nunca pelo `ts` (o carimbo de quando o pedido foi importado pro app). Importar em setembro
// uma venda de julho grava ts de setembro — se o corte olhasse o ts, o cliente apareceria positivado
// num mês em que não comprou nada, e o placar mentiria pro usuário exatamente no número que ele usa
// pra decidir quem ligar.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Extrai `const NOME = (...) => { ... };` casando as chaves.
function extrairArrow(nome) {
    const i = src.indexOf('const ' + nome + ' = (');
    if (i < 0) { console.log('❌ não achei ' + nome + ' no index.html'); process.exit(1); }
    let prof = 0, f = -1;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } }
    }
    return src.slice(i, f);
}
eval(extrairArrow('positivacaoNoMes').replace('const positivacaoNoMes =', 'globalThis.positivacaoNoMes ='));
eval(extrairArrow('textoPositivacao').replace('const textoPositivacao =', 'globalThis.textoPositivacao ='));

let falhas = 0;
function checa(nome, cond, extra) {
    if (!cond) falhas++;
    console.log(`${cond ? '✅' : '❌'} ${nome}${cond ? '' : '  → ' + extra}`);
}

// "Hoje" fixo: 10/09/2026. Mês atual = setembro, mês passado = agosto.
const HOJE = new Date(2026, 8, 10, 12, 0, 0);
const cli = (code, name, phone) => ({ id: 'id' + code, code: code, name: name, phone: phone || '' });
const compra = (code, dia, valor, itens, extra) => Object.assign({
    clienteCode: code, dia: dia, valor: valor, pesoTotal: 10,
    // ts de HOJE de propósito em toda compra: se a regra olhasse o ts, tudo apareceria como do mês.
    ts: HOJE.getTime(), itens: itens || [],
}, extra || {});
const item = (name, peso, valorKg) => ({ code: name.slice(0, 3), name: name, peso: peso, valorKg: valorKg });

const clientes = [
    cli('1', 'Bar do Zé', '22999998888'),
    cli('2', 'Mercado Silva'),
    cli('3', 'Padaria Sol'),
    cli('4', 'Churrascaria Boi'),
    cli('5', 'Cliente Novo'),
];
const compras = [
    // 1 — comprou este mês: positivado
    compra('1', '2026-09-05', 1200, [item('DIANTEIRO BOVINO', 40, 20)]),
    // 2 — comprou SÓ mês passado: é o alvo da positivação, e o de maior valor
    compra('2', '2026-08-12', 5000, [item('DIANTEIRO BOVINO', 100, 25)]),
    compra('2', '2026-08-25', 3000, [item('DIANTEIRO BOVINO', 50, 25), item('COXA PILÃO', 30, 12)]),
    // 3 — comprou mês passado, valor menor: entra depois do 2 na prioridade
    compra('3', '2026-08-20', 800, [item('PEITO BOVINO', 20, 18)]),
    // 4 — a ÚNICA movimentação dele no mês foi uma DEVOLUÇÃO: não positiva
    compra('4', '2026-09-02', -400, [item('COXA PILÃO', 20, 12)], { devolucao: true }),
    compra('4', '2026-07-10', 900, [item('COXA PILÃO', 40, 12)]),
    // 5 — nunca comprou nada
];

const r = positivacaoNoMes(clientes, compras, HOJE);

checa('conta a carteira inteira', r.total === 5, JSON.stringify(r.total));
checa('só quem comprou ESTE mês é positivado', r.feitos === 1, `feitos=${r.feitos}`);
checa('o resto entra como "falta"', r.faltam === 4, `faltam=${r.faltam}`);

// ⚠️ o coração do teste
checa('venda de mês passado importada hoje NÃO positiva (usa dia, não ts)',
    !r.comBase.concat(r.frios, r.jamais).some(f => f.positivado) && r.feitos === 1,
    'alguma compra antiga passou como se fosse do mês');

checa('devolução não positiva o cliente',
    r.comBase.concat(r.frios, r.jamais).some(f => f.cliente.code === '4'),
    'o cliente que só devolveu sumiu da lista de quem falta');

checa('prioridade ordenada pelo valor do mês passado',
    r.comBase.length === 2 && r.comBase[0].cliente.code === '2' && r.comBase[1].cliente.code === '3',
    r.comBase.map(f => f.cliente.code + ':' + f.anterior.valor).join(', '));

checa('soma as compras do mês passado do mesmo cliente',
    r.comBase[0].anterior.valor === 8000, JSON.stringify(r.comBase[0].anterior));

checa('agrupa o mesmo produto e soma os kg',
    r.comBase[0].anterior.itens[0].nome === 'DIANTEIRO BOVINO' && r.comBase[0].anterior.itens[0].peso === 150,
    JSON.stringify(r.comBase[0].anterior.itens));

checa('o item mais pesado vem primeiro (é o argumento mais forte)',
    r.comBase[0].anterior.itens[1].nome === 'COXA PILÃO', JSON.stringify(r.comBase[0].anterior.itens));

checa('quem tem histórico mas nada no mês passado fica na lista fria',
    r.frios.length === 1 && r.frios[0].cliente.code === '4', JSON.stringify(r.frios.map(f => f.cliente.code)));

checa('quem nunca comprou fica separado',
    r.jamais.length === 1 && r.jamais[0].cliente.code === '5', JSON.stringify(r.jamais.map(f => f.cliente.code)));

checa('soma o dinheiro em jogo (o que os que faltam compraram mês passado)',
    r.emRisco === 8800, `emRisco=${r.emRisco}`);

checa('sabe quantos dias ainda restam no mês', r.restantes === 20, `restantes=${r.restantes}`);

// Projeção: 1 positivado em 10 dias -> 3 no mês de 30 dias. É régua, não profecia.
checa('projeta o fechamento no ritmo atual', r.projecao === 3, `projecao=${r.projecao}`);

// ── A mensagem de abordagem ────────────────────────────────────────────────────────────────
// Genérico não vende. O texto tem que citar o que o cliente REALMENTE levou.
const txt = textoPositivacao(r.comBase[0]);
checa('a mensagem cita o produto real do cliente', txt.includes('DIANTEIRO BOVINO'), txt);
checa('a mensagem cita o peso real', txt.includes('150 kg'), txt);
checa('a mensagem chama o cliente pelo nome', txt.includes('Mercado'), txt);

const txtSemBase = textoPositivacao(r.jamais[0]);
checa('quem nunca comprou recebe um texto que não inventa histórico',
    !/levou/.test(txtSemBase) && txtSemBase.length > 20, txtSemBase);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
