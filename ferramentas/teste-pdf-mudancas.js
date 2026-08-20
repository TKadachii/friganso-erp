const fs = require('fs');
// Precisa do jsPDF (no site ele vem de CDN, não é dependência do projeto).
let jsPDF;
try { jsPDF = require('jspdf').jsPDF; }
catch (e) {
    console.log('⏭️  Teste pulado: o pacote "jspdf" não está instalado.');
    console.log('   Pra rodar:  npm install jspdf');
    process.exit(0);
}
global.window = { jspdf: { jsPDF } };

// Extrai a função REAL do index.html
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const i = src.indexOf('const gerarPdfMudancasPreco = (');
let prof = 0, fim = -1;
for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') prof++;
    else if (src[k] === '}') { prof--; if (prof === 0) { fim = k + 1; break; } }
}
eval(src.slice(i, fim).replace(/^const /, 'globalThis.'));

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

const mudancas = [
    { code: '1603',  name: 'COSTELA BOVINA C/+ 14KG',            oldPrice: 22.90, newPrice: 20.90 },
    { code: '10131', name: 'FILE DE COXA S/COXA C/P ENV LAR/20KG', oldPrice: 41.25, newPrice: 40.01 },
    { code: '9999',  name: 'PICANHA MATURADA',                    oldPrice: 58.00, newPrice: 62.50 },
];

console.log('Assinatura da função:', src.slice(i, i + 60).split('\n')[0]);
ok(!/gerarPdfMudancasPreco = \(changes, user\)/.test(src), 'a função não recebe mais o `user`');

const doc = gerarPdfMudancasPreco(mudancas);
const buf = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync(require('path').join(require('os').tmpdir(), 'friganso-mudancas-teste.pdf'), buf);
const cru = buf.toString('latin1');

console.log('\n═══ CONTEÚDO DO PDF GERADO ═══');
// jsPDF escreve o texto em blocos Tj/TJ legíveis quando não há compressão
const textos = [...cru.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)].map(m => m[0].slice(1, m[0].lastIndexOf(')')));
console.log('   trechos de texto encontrados:', textos.length);

const nomesPessoais = ['Bruno', 'Moura', 'bruno'];
ok(!nomesPessoais.some(n => textos.some(t => t.includes(n))), 'nenhum nome pessoal no PDF');
// qualquer coisa com cara de telefone: (22) 9xxxx-xxxx, +55.., 9 dígitos seguidos
const telRe = /(\(\d{2}\)\s*\d{4,5}-?\d{4})|(\+?55\s?\d{2}\s?\d{4,5})|(\b\d{8,11}\b)/;
const suspeitos = textos.filter(t => telRe.test(t));
ok(suspeitos.length === 0, `nenhum telefone no PDF${suspeitos.length ? ' → achei: ' + JSON.stringify(suspeitos) : ''}`);
ok(textos.some(t => t === 'Friganso'), 'rodapé traz só "Friganso"');
ok(textos.some(t => t.includes('MUDANÇAS DE PREÇO') || t.includes('MUDAN')), 'título continua lá');
ok(textos.some(t => t.includes('1603')), 'os produtos continuam no PDF');
ok(textos.some(t => t.includes('BAIXARAM')), 'seção "BAIXARAM DE PREÇO" presente');
ok(textos.some(t => t.includes('SUBIRAM')), 'seção "SUBIRAM DE PREÇO" presente');
ok(textos.some(t => /Página 1 de \d/.test(t)), 'numeração de página mantida');

console.log('\n   rodapé completo:', JSON.stringify(textos.filter(t => t === 'Friganso' || /Página/.test(t))));
console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
