// Testa o PDF de conferência do Debug: ele precisa sair COMPLETO e, principalmente, ser
// LEGÍVEL DE VOLTA — é assim que a tabela do site vai ser comparada com o PDF da distribuidora.
const fs = require('fs'); const path = require('path');
let jsPDF, pdfjs;
try { jsPDF = require('jspdf').jsPDF; pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); }
catch (e) {
    console.log('⏭️  Teste pulado: faltam pacotes.');
    console.log('   Pra rodar:  npm install jspdf pdfjs-dist@3.11.174');
    process.exit(0);
}
global.window = { jspdf: { jsPDF } };
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = src.indexOf('const gerarPdfConferenciaTabela = (');
let prof = 0, f = -1;
for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } } }
eval(src.slice(i, f).replace(/^const /, 'globalThis.'));

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

// produtos de teste, com os casos que costumam quebrar
const produtos = [
    { code: '1602', name: 'DIANTEIRO BOVINO', originalPrice: 23, precoCartao: 23.35,
      precosPrazo: { 7: 23.35, 14: 23.69, 21: 23.92, 28: 24.38, 30: 24.61, 35: 24.84, 45: 24.84 }, tipo: 'PC', pesoItem: '300 Kg' },
    { code: '16021', name: 'CUPIM - DIANTEIRO', originalPrice: 32.42, precoCartao: 32.91,
      precosPrazo: { 7: 32.91, 45: 35.02 }, tipo: 'PC', pesoItem: '700 Kg' },
    { code: '0004', name: 'BOLSA TÉRMICA FRIGANSO', originalPrice: 41, precoCartao: 41.62, precosPrazo: null, tipo: 'CX', pesoItem: '1 Kg' },
    { code: '9999', name: 'PRODUTO SEM CARTÃO NEM PRAZO', originalPrice: 10.5, precoCartao: null, precosPrazo: null, tipo: '', pesoItem: '' },
    { code: '8888', name: 'NOME MUITO LONGO ' + 'X'.repeat(120), originalPrice: 7.77, precoCartao: 7.9, precosPrazo: null, tipo: 'CX', pesoItem: '5 Kg' },
    { code: '7777', name: 'ACENTUAÇÃO ÁÉÍÓÚ ÇÃO ÊÔ', originalPrice: 0, precoCartao: null, precosPrazo: null, tipo: 'UN', pesoItem: '' },
];
// enche pra forçar várias páginas
for (let k = 0; k < 300; k++) produtos.push({ code: String(20000 + k), name: 'PRODUTO DE ENCHIMENTO ' + k, originalPrice: 10 + k / 100, precoCartao: 11 + k / 100, precosPrazo: { 45: 12 + k / 100 }, tipo: 'CX', pesoItem: '10 Kg' });

const doc = gerarPdfConferenciaTabela(produtos);
const buf = Buffer.from(doc.output('arraybuffer'));

(async () => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    console.log(`gerado: ${produtos.length} produtos, ${pdf.numPages} páginas, ${Math.round(buf.length / 1024)} KB\n`);
    ok(pdf.numPages > 1, 'quebra em várias páginas sozinho');

    const lidos = new Map();
    for (let p = 1; p <= pdf.numPages; p++) {
        const tc = await (await pdf.getPage(p)).getTextContent();
        const linhas = new Map();
        // ⚠️ tolerância no agrupamento: as linhas ficam a 4,2mm e o acúmulo de ponto flutuante faz
        // itens da MESMA linha arredondarem diferente com Math.round direto.
        tc.items.forEach(it => { const y = Math.round(it.transform[5] / 2) * 2; if (!linhas.has(y)) linhas.set(y, []); linhas.get(y).push(it); });
        for (const its of linhas.values()) {
            const ord = its.sort((a, b) => a.transform[4] - b.transform[4]);
            // ⚠️ o jsPDF emite itens de texto VAZIOS no meio da linha — não dá pra assumir que o
            // primeiro item é o código.
            const cod = ((ord.find(it => it.str.trim()) || {}).str || '').trim();
            if (!/^\d{3,7}$/.test(cod)) continue;
            const nums = ord.filter(it => /^\d+\.\d{2}$/.test(it.str.trim())).map(it => Number(it.str));
            lidos.set(cod, { nums, texto: ord.map(o => o.str).join(' ') });
        }
    }

    console.log('═══ TODO PRODUTO VOLTA NA LEITURA? ═══');
    ok(lidos.size === produtos.length, `${lidos.size} de ${produtos.length} produtos relidos`);

    console.log('\n═══ OS VALORES SOBREVIVEM? ═══');
    let divergentes = 0;
    produtos.forEach(p => {
        const l = lidos.get(String(p.code));
        if (!l) return;
        const esperado = Number(p.originalPrice) || 0;
        if (esperado > 0 && Math.abs(l.nums[0] - esperado) > 0.005) divergentes++;
    });
    ok(divergentes === 0, `nenhum preço à vista mudou no caminho (divergentes: ${divergentes})`);
    const d = lidos.get('1602');
    ok(d && d.nums[0] === 23 && d.nums[1] === 23.35, 'à vista e cartão do 1602 batem');
    ok(d && /DIANTEIRO BOVINO/.test(d.texto), 'o nome sai por extenso');
    ok(lidos.get('7777') && /ACENTUA/.test(lidos.get('7777').texto), 'acentuação sobrevive');
    ok(!!lidos.get('9999'), 'produto sem cartão nem prazo também sai');
    ok(!!lidos.get('8888'), 'nome muito longo não derruba a linha (é cortado)');

    console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
    process.exit(falhas ? 1 : 0);
})();
