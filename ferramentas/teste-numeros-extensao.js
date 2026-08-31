// 🔢 Testa o parseNumBR do content.js — a função que converte o texto da tela do SPAmov em número.
//
// ⚠️ O bug que originou isto (13/08/2026): a regex antiga truncava qualquer valor acima de 999,99
// escrito com PONTO decimal. Em "5100.00" o \d{1,3} pegava "510", esperava um separador, achava "0"
// e parava — devolvia 510. O pallet de arroz (29741) entrou na tabela a R$ 510,00 em vez de
// R$ 5.100,00. Passou despercebido por MESES porque preço até R$ 999,99 funciona, e é a maioria.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'extensao', 'content.js'), 'utf8');
const i = src.indexOf('function parseNumBR(s) {');
if (i < 0) { console.log('❌ não achei o parseNumBR no content.js'); process.exit(1); }
let prof = 0, f = -1;
for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } } }
eval(src.slice(i, f).replace('function parseNumBR', 'globalThis.parseNumBR = function'));

let falhas = 0;
const t = (entrada, esperado, nota) => {
    const v = parseNumBR(entrada);
    const ok = esperado === null ? v === null : (v !== null && Math.abs(v - esperado) < 0.0001);
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${JSON.stringify(entrada).padEnd(14)} → ${String(v).padEnd(11)}${ok ? '' : `esperado ${esperado}  `}${nota || ''}`);
};

console.log('═══ O CASO QUE QUEBROU (preço acima de mil, ponto decimal) ═══');
t('5100.00', 5100, '← dava 510 antes');
t('5176.50', 5176.5, '← dava 517');
t('5253.00', 5253, '← dava 525');
t('5508.00', 5508, '← dava 550');
t('1000.00', 1000, '← dava 100');
t('1234.56', 1234.56, '← dava 123');
t('99999.99', 99999.99);

console.log('\n═══ O QUE JÁ FUNCIONAVA (não pode regredir) ═══');
t('23.00', 23);
t('7.75', 7.75);
t('999.99', 999.99);
t('510.00', 510);
t('0.50', 0.5);
t('23,00', 23, 'vírgula decimal');
t('7,75', 7.75);

console.log('\n═══ FORMATO BRASILEIRO (ponto de milhar) ═══');
t('5.100,00', 5100);
t('1.234,56', 1234.56);
t('12.345,67', 12345.67);
t('1.234.567,89', 1234567.89, 'dois pontos de milhar');

console.log('\n═══ FORMATO INGLÊS (vírgula de milhar) ═══');
t('1,234.56', 1234.56);
t('5,100.00', 5100);

console.log('\n═══ SEM SEPARADOR / SÓ MILHAR ═══');
t('5100', 5100);
t('5.100', 5100, '3 casas depois = milhar, não decimal');
t('1,234', 1234, 'idem com vírgula');
t('42', 42);

console.log('\n═══ PESOS E QUANTIDADES (outros usos da função) ═══');
t('278,8000', 278.8, '4 casas = decimal, não milhar');
t('12941.8', 12941.8, '← dava 129 antes');
t('1 Kg', 1);
t('3 Un', 3);
t('2300 Kg/3 Un', 2300, 'pega o primeiro número');

console.log('\n═══ ENTRADAS RUINS ═══');
t('', null);
t(null, null);
t('sem número', null);
t('R$ 5100.00', 5100, 'com prefixo');
t('5100.00 ', 5100, 'com espaço');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
