// Testa a lógica de agendamento dos lembretes, com o relógio controlado.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

const pega = (nome) => {
    const i = src.indexOf('const ' + nome + ' = ');
    if (i < 0) throw new Error('não achei ' + nome);
    let prof = 0, f = -1;
    const abre = src.indexOf('{', src.indexOf('=>', i));
    const fimLinha = src.indexOf('\n', i);
    if (abre < 0 || abre > fimLinha) return src.slice(i, fimLinha).replace(/^const /, 'globalThis.').replace(/;$/, '');
    for (let k = abre; k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (prof === 0) { f = k + 1; break; } }
    }
    return src.slice(i, f).replace(/^const /, 'globalThis.');
};
eval(src.match(/const DIAS_SEMANA = \[[^\]]+\];/)[0].replace('const ', 'globalThis.'));
['diaISO', 'lembreteEhDeHoje', 'lembreteJaNaHora', 'lembretePendente', 'lembreteDeveAbrir', 'descreverRepeticao'].forEach(n => eval(pega(n)));

// ⚠️ 13/08/2026 é QUINTA-feira (getDay = 4). Confirmado com o próprio Date — não confie na memória.
const QUINTA_0930 = new Date(2026, 7, 13, 9, 30);
const QUINTA_0700 = new Date(2026, 7, 13, 7, 0);
const SEXTA_0930  = new Date(2026, 7, 14, 9, 30);
ok(diaISO(QUINTA_0930) === '2026-08-13', 'diaISO monta a data certa');
ok(QUINTA_0930.getDay() === 4, 'a data de teste é mesmo uma quinta (getDay 4)');

console.log('\n═══ 1. QUANDO CAI ═══');
const diario   = { ativo: true, repeticao: 'diario', categoria: 'permanente' };
const semanal  = { ativo: true, repeticao: 'semanal', diaSemana: 4, categoria: 'permanente' };
const umDia    = { ativo: true, repeticao: 'data', data: '2026-08-13', categoria: 'rapido' };
ok(lembreteEhDeHoje(diario, QUINTA_0930), 'diário cai hoje');
ok(lembreteEhDeHoje(semanal, QUINTA_0930), 'semanal na quinta cai numa quinta');
ok(!lembreteEhDeHoje(semanal, SEXTA_0930), 'semanal na quinta NÃO cai na sexta');
ok(lembreteEhDeHoje(umDia, QUINTA_0930), 'data única cai no dia dela');
ok(!lembreteEhDeHoje(umDia, SEXTA_0930), 'data única não cai no dia seguinte');
ok(!lembreteEhDeHoje({ ...diario, ativo: false }, QUINTA_0930), 'concluído (ativo:false) não cai mais');

console.log('\n═══ 2. HORA MARCADA ═══');
const com8h = { ...diario, hora: '08:00' };
ok(!lembreteJaNaHora(com8h, QUINTA_0700), 'às 7h ainda NÃO é hora do lembrete das 8h');
ok(lembreteJaNaHora(com8h, QUINTA_0930), 'às 9h30 já passou das 8h');
ok(lembreteJaNaHora(diario, QUINTA_0700), 'sem hora vale desde a primeira abertura do dia');
ok(lembreteJaNaHora({ ...diario, hora: 'lixo' }, QUINTA_0700), 'hora inválida não trava o lembrete');

console.log('\n═══ 3. PENDENTE x JÁ FEITO ═══');
ok(lembretePendente(diario, QUINTA_0930), 'sem ter feito hoje: pendente');
ok(!lembretePendente({ ...diario, ultimoFeito: '2026-08-13' }, QUINTA_0930), 'feito HOJE: sai de pendente');
ok(lembretePendente({ ...diario, ultimoFeito: '2026-08-12' }, QUINTA_0930), 'feito ONTEM: volta a ser pendente hoje (é rotina)');

console.log('\n═══ 4. O ✕ NÃO RESOLVE — só empurra ═══');
const adiadoHoje = { ...diario, ultimoAdiado: '2026-08-13' };
ok(!lembreteDeveAbrir(adiadoHoje, QUINTA_0930), 'fechado no ✕: o pop-up não sobe de novo');
ok(lembretePendente(adiadoHoje, QUINTA_0930), '...mas CONTINUA pendente — é o que acende o ⚠️');
ok(lembreteDeveAbrir({ ...diario, ultimoAdiado: '2026-08-12' }, QUINTA_0930), 'adiado ontem volta a abrir hoje');
const feitoEAdiado = { ...diario, ultimoAdiado: '2026-08-13', ultimoFeito: '2026-08-13' };
ok(!lembretePendente(feitoEAdiado, QUINTA_0930), 'depois do "Feito" o ⚠️ apaga');

console.log('\n═══ 5. TEXTO NA TELA ═══');
ok(descreverRepeticao(diario) === 'Todo dia', 'diário sem hora');
ok(descreverRepeticao(com8h) === 'Todo dia às 08:00', 'diário com hora');
ok(descreverRepeticao(semanal) === 'Toda Quinta', 'semanal diz o dia');
ok(descreverRepeticao(umDia) === '13/08/2026', 'data única sai em formato br');

console.log('\n═══ 6. FEITO: rápido conclui, rotina volta ═══');
ok(/if \(l\.categoria === 'rapido'\) dados\.ativo = false;/.test(src), 'rápido é concluído (ativo:false) ao marcar Feito');
ok(/const adiarLembrete = async \(l\) => \{[\s\S]{0,200}ultimoAdiado: diaISO/.test(src), 'o ✕ grava ultimoAdiado, não ultimoFeito');
ok(!/const adiarLembrete[\s\S]{0,200}ultimoFeito/.test(src), 'o ✕ NUNCA marca como feito (senão o ⚠️ nem apareceria)');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
