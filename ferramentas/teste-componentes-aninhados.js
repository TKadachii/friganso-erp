// 🐞 Pega o bug das "letras saindo ao contrário".
//
// Componente React declarado DENTRO do corpo de outro componente é recriado a cada render.
// O React trata isso como um TIPO NOVO: desmonta a árvore inteira e monta outra. Se houver um
// <input>/<textarea>/<select> ali dentro, ele perde o foco a cada tecla e o cursor volta pro
// começo — a letra seguinte entra ANTES da anterior, e o texto sai invertido.
//
// Aconteceu de verdade em 13/08/2026, na tela de Lembretes:
//     const LembretesScreen = (...) => {
//         const Campo = ({ children }) => <div className="space-y-1">{children}</div>;   // ⬅️
//         ... <Campo><textarea value={form.texto} .../></Campo>
//
// Componente sem campo de digitação também remonta à toa, mas não quebra nada visível — por isso
// este teste só falha quando há um campo dentro, que é o caso que estraga a experiência.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const linhas = src.split('\n');

// 8 espaços = nível do módulo (ok). 12+ = está dentro de outro componente.
const DENTRO_DE_COMPONENTE = /^(\s{12,})const ([A-Z]\w*)\s*=\s*\(/;
const TEM_CAMPO = /<(input|textarea|select)\b/;

const achados = [];
linhas.forEach((l, i) => {
    const m = DENTRO_DE_COMPONENTE.exec(l);
    if (!m) return;
    let prof = 0, corpo = [];
    for (let j = i; j < Math.min(i + 150, linhas.length); j++) {
        corpo.push(linhas[j]);
        for (const ch of linhas[j]) {
            if (ch === '(' || ch === '{') prof++;
            else if (ch === ')' || ch === '}') prof--;
        }
        if (j > i && prof <= 0) break;
    }
    achados.push({ linha: i + 1, nome: m[2], comCampo: TEM_CAMPO.test(corpo.join('\n')) });
});

const perigosos = achados.filter(a => a.comCampo);
const inofensivos = achados.filter(a => !a.comCampo);

console.log(`componentes declarados dentro de outro componente: ${achados.length}`);
console.log(`   sem campo de digitação (só remontam à toa): ${inofensivos.length}`);
console.log(`   COM campo de digitação: ${perigosos.length}\n`);

if (perigosos.length) {
    console.log('❌ Estes vão quebrar a digitação (letras ao contrário):');
    perigosos.forEach(p => console.log(`   index.html:${p.linha}  <${p.nome}>`));
    console.log('\n   Conserto: mova o componente pro nível do módulo (8 espaços de indentação)');
    console.log('   e passe por props o que ele lia do closure.');
    process.exit(1);
}
console.log('✅ nenhum componente com campo de digitação declarado dentro de outro');
