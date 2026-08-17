const fs = require('fs');
// Extrai as funções REAIS do index.html (não uma cópia)
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const pega = (nome) => {
    const i = src.indexOf('const ' + nome + ' = (');
    if (i < 0) throw new Error('não achei ' + nome);
    let prof = 0, fim = -1;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (prof === 0) { fim = k + 1; break; } }
    }
    return src.slice(i, fim).replace(/^const /, 'globalThis.');
};
eval(pega('montarRankCompras'));
eval(pega('ordenarPelosMaisComprados'));

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

// ── Histórico realista de um cliente ──────────────────────────────────────────────
// COSTELA: 4 pedidos · FILE COXA: 2 pedidos (mas MUITO kg) · PICANHA: 1 · ASA: 1 (o mais recente)
const compras = [
    { clienteCode: '68425', ts: 1000, itens: [{ code: '1603', peso: 20 }, { code: '10131', peso: 100 }] },
    { clienteCode: '68425', ts: 2000, itens: [{ code: '1603', peso: 20 }] },
    { clienteCode: '68425', ts: 3000, itens: [{ code: '1603', peso: 20 }, { code: '10131', peso: 100 }] },
    { clienteCode: '68425', ts: 4000, itens: [{ code: '1603', peso: 20 }, { code: '9999', peso: 5 }] },
    { clienteCode: '68425', ts: 5000, itens: [{ code: '8888', peso: 5 }] },
    // outro cliente — não pode vazar pro ranking do 68425
    { clienteCode: '99999', ts: 9000, itens: [{ code: '7777', peso: 500 }] },
];
const mapa = montarRankCompras(compras);
const r = mapa.get('68425');

console.log('═══ 1. AGREGAÇÃO ═══');
ok(mapa.size === 2, 'dois clientes no mapa');
ok(r.get('1603').pedidos === 4, `COSTELA apareceu em 4 pedidos (deu ${r.get('1603').pedidos})`);
ok(r.get('1603').kg === 80, `COSTELA somou 80 kg (deu ${r.get('1603').kg})`);
ok(r.get('10131').pedidos === 2, 'FILE COXA em 2 pedidos');
ok(r.get('10131').kg === 200, 'FILE COXA somou 200 kg');
ok(r.get('8888').ultima === 5000, 'guarda a data da compra mais recente');
ok(!r.has('7777'), 'produto de OUTRO cliente não entra neste ranking');

console.log('\n═══ 2. PRODUTO REPETIDO NO MESMO PEDIDO ═══');
const dup = montarRankCompras([{ clienteCode: 'X', ts: 1, itens: [{ code: 'A', peso: 10 }, { code: 'A', peso: 5 }] }]);
ok(dup.get('X').get('A').pedidos === 1, 'conta 1 PEDIDO, não 2 (mesmo item repetido na nota)');
ok(dup.get('X').get('A').kg === 15, 'mas soma os 15 kg dos dois lançamentos');

console.log('\n═══ 3. ORDENAÇÃO (é o que decide o que o cliente recebe) ═══');
const produtos = [
    { code: '8888', name: 'ASA' }, { code: '9999', name: 'PICANHA' },
    { code: '10131', name: 'FILE COXA' }, { code: '1603', name: 'COSTELA' },
    { code: '5555', name: 'NUNCA COMPROU' },
];
const ord = ordenarPelosMaisComprados(produtos, r).map(p => p.name);
console.log('   ordem:', ord.join(' > '));
ok(ord[0] === 'COSTELA', '1º = COSTELA (4 pedidos, o que ele mais compra)');
ok(ord[1] === 'FILE COXA', '2º = FILE COXA (2 pedidos) — frequência ganha do volume, mesmo com 200kg');
ok(ord[ord.length - 1] === 'NUNCA COMPROU', 'quem ele nunca comprou vai pro fim');
ok(ord.indexOf('ASA') < ord.indexOf('PICANHA'), 'empate em 1 pedido e 5kg: desempata pelo mais RECENTE (ASA)');

console.log('\n═══ 4. TOP 3 (o que ele pediu) ═══');
const top3 = ordenarPelosMaisComprados(produtos, r).slice(0, 3).map(p => p.name);
console.log('   top 3:', top3.join(', '));
ok(top3.length === 3 && top3[0] === 'COSTELA' && !top3.includes('NUNCA COMPROU'), 'top 3 = os 3 mais comprados de verdade');

console.log('\n═══ 5. BORDAS ═══');
ok(montarRankCompras([]).size === 0, 'sem compras não quebra');
ok(montarRankCompras(null).size === 0, 'null não quebra');
ok(montarRankCompras([{ clienteCode: '', itens: [{ code: 'A' }] }]).size === 0, 'compra sem cliente é ignorada');
ok(montarRankCompras([{ clienteCode: 'Z', itens: null }]).get('Z').size === 0, 'pedido sem itens não quebra');
const semRank = ordenarPelosMaisComprados(produtos, new Map()).map(p => p.name);
ok(semRank.length === produtos.length, 'cliente sem histórico: devolve todos, sem quebrar');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
