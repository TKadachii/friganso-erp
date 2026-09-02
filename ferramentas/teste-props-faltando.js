// 🩹 Pega o bug da TELA BRANCA: componente que USA um helper sem RECEBER ele por props.
//
// Aconteceu de verdade em 13/08/2026: o DashboardScreen passou a usar `showMessage`, mas a
// assinatura dele era ({ user, clients, products, setActiveRoute }) — sem showMessage. Como o uso
// estava dentro do JSX (`showMessage={showMessage}`), o ReferenceError estourava DURANTE O RENDER e
// o React derrubava a árvore inteira: site todo branco.
//
// ⚠️ O teste de sintaxe (Babel) NÃO pega isso — é sintaxe perfeitamente válida, o erro só existe em
// execução. Daí este teste existir.
//
// Confere só os helpers da lista abaixo: são os que SEMPRE viajam por props neste projeto e nunca
// existem como global. Um nome fora dessa lista não é checado, pra não inventar falso positivo.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const linhas = src.split('\n');

const HELPERS = ['showMessage', 'setActiveRoute'];

// componentes de topo: 8 espaços de indentação e nome com inicial maiúscula
const COMPONENTE = /^ {8}const ([A-Z]\w*) = \(\s*\{([^}]*)\}/;
const achados = [];
linhas.forEach((l, i) => {
    const m = COMPONENTE.exec(l);
    if (!m) return;
    // corpo do componente, por contagem de chaves
    let prof = 0, corpo = [], comecou = false;
    for (let j = i; j < linhas.length; j++) {
        for (const ch of linhas[j]) {
            if (ch === '{') { prof++; comecou = true; }
            else if (ch === '}') prof--;
        }
        corpo.push(linhas[j]);
        if (comecou && prof <= 0) break;
    }
    achados.push({ nome: m[1], linha: i + 1, props: m[2], corpo: corpo.join('\n') });
});

let falhas = 0;
console.log(`componentes de topo analisados: ${achados.length}\n`);
achados.forEach(c => {
    HELPERS.forEach(h => {
        const usa = new RegExp('\\b' + h + '\\b').test(c.corpo.slice(c.corpo.indexOf('\n')));
        if (!usa) return;
        const recebe = new RegExp('\\b' + h + '\\b').test(c.props);
        // pode ter sido declarado localmente (const/let/function) em vez de vir por props
        const declara = new RegExp('(const|let|var|function)\\s+' + h + '\\b').test(c.corpo);
        if (!recebe && !declara) {
            falhas++;
            console.log(`❌ <${c.nome}> (index.html:${c.linha}) usa "${h}" mas NÃO recebe por props`);
            console.log(`   props declaradas: {${c.props.trim().slice(0, 70)}}`);
            const ln = c.corpo.split('\n').findIndex(l => new RegExp('\\b' + h + '\\b').test(l) && !COMPONENTE.test(l));
            if (ln > 0) console.log(`   primeiro uso: index.html:${c.linha + ln} → ${c.corpo.split('\n')[ln].trim().slice(0, 80)}`);
            console.log(`   ⚠️  Isso derruba o site INTEIRO (tela branca) se o uso estiver no JSX.`);
        }
    });
});

if (falhas) {
    console.log(`\n❌ ${falhas} componente(s) com prop faltando`);
    console.log('   Conserto: acrescente o nome na desestruturação das props E passe onde o componente é usado.');
    process.exit(1);
}
console.log('✅ todo componente que usa showMessage/setActiveRoute recebe por props');
