// Testa a trava de conferência do pedido (a "trava contra distração").
// Roda sem navegador: as funções de estado são puras em cima do localStorage, que é mockado aqui.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

// ── mock de localStorage ───────────────────────────────────────────────────────────
const loja = {};
global.window = { localStorage: {
    getItem: k => (k in loja ? loja[k] : null),
    setItem: (k, v) => { loja[k] = String(v); },
    removeItem: k => { delete loja[k]; },
} };

// extrai as funções REAIS do index.html
const pega = (nome) => {
    const i = src.indexOf('const ' + nome + ' = ');
    if (i < 0) throw new Error('não achei ' + nome);
    const fim = src.indexOf('\n', src.indexOf('=>', i));
    let trecho = src.slice(i, fim);
    if ((trecho.match(/{/g) || []).length !== (trecho.match(/}/g) || []).length) {
        let prof = 0, f = -1;
        for (let k = src.indexOf('{', src.indexOf('=>', i)); k < src.length; k++) {
            if (src[k] === '{') prof++;
            else if (src[k] === '}') { prof--; if (prof === 0) { f = k + 1; break; } }
        }
        trecho = src.slice(i, f);
    }
    return trecho.replace(/^const /, 'globalThis.').replace(/;$/, '');
};
// ⚠️ as constantes das chaves precisam vir ANTES: sem elas as funções batem em ReferenceError
// e caem no próprio catch, devolvendo o valor padrão como se estivesse tudo certo.
const constante = (nome) => {
    const m = new RegExp("const " + nome + " = '([^']+)'").exec(src);
    if (!m) throw new Error('não achei a constante ' + nome);
    return `globalThis.${nome} = '${m[1]}'`;
};
eval(constante('CONFERENCIA_KEY'));
eval(constante('CONFERENCIA_PULOS'));
['lerConferenciaAtiva', 'salvarConferenciaAtiva', 'hojeStr', 'lerPulosHoje', 'registrarPulo'].forEach(n => eval(pega(n)));

console.log('═══ 1. LIGA/DESLIGA ═══');
ok(lerConferenciaAtiva() === false, 'vem DESLIGADA por padrão (não muda o fluxo de quem não pediu)');
salvarConferenciaAtiva(true);
ok(lerConferenciaAtiva() === true, 'liga e persiste');
salvarConferenciaAtiva(false);
ok(lerConferenciaAtiva() === false, 'desliga e persiste');

console.log('\n═══ 2. CONTADOR DE PULOS ═══');
ok(lerPulosHoje() === 0, 'começa em 0');
registrarPulo(); registrarPulo(); registrarPulo();
ok(lerPulosHoje() === 3, `conta 3 pulos (deu ${lerPulosHoje()})`);
// simula a virada do dia
loja['friganso_conferencia_pulos'] = JSON.stringify({ dia: '2020-01-01', n: 99 });
ok(lerPulosHoje() === 0, 'zera sozinho quando vira o dia (99 de ontem não conta hoje)');
registrarPulo();
ok(lerPulosHoje() === 1, 'volta a contar do 1 no dia novo');
loja['friganso_conferencia_pulos'] = 'lixo{{';
ok(lerPulosHoje() === 0, 'dado corrompido não quebra');

console.log('\n═══ 3. A TRAVA ESTÁ MESMO NO CAMINHO? ═══');
// De nada adianta o modal existir se der pra copiar o resumo por fora dele.
const botao = src.slice(src.indexOf('if (conferenciaAtiva)') - 400, src.indexOf('if (conferenciaAtiva)') + 600);
ok(/if \(conferenciaAtiva\) \{ setMostrarConferencia\(true\); return; \}/.test(src),
   'o botão "Copiar Resumo" desvia pra conferência quando a trava está ligada');
ok(/Copiar Resumo<\/button>/.test(botao), 'o desvio está no botão de Copiar Resumo, não em outro lugar');
// só pode existir UMA chamada direta do fluxo sem prova, a do caso "trava desligada"
const diretas = (src.match(/executarCopiaResumo\(null\)/g) || []).length;
ok(diretas === 1, `só 1 caminho direto sem prova (o da trava desligada) — achei ${diretas}`);
ok(/onConfirmar=\{\(prova\) => \{ setMostrarConferencia\(false\); executarCopiaResumo\(prova\); \}\}/.test(src),
   'o caminho da conferência entrega a prova pro fluxo');

console.log('\n═══ 4. A PROVA CHEGA NA VENDA? ═══');
ok(/registrarCompra = async \(clienteCode, itensValidos, tipo, via, clients, user, spamov, condicaoPagamento, prova\)/.test(src),
   'registrarCompra recebe a prova');
ok(/prova: prova \|\| null,/.test(src), 'a prova é gravada no documento da compra');
ok(/registrarCompra\(orderSummary\.customerCode, itens, null, 'resumo', clients, user, orderSummary\.spamov, condicaoAtual, prova\)/.test(src),
   'o Resumo repassa a prova ao registrar a venda');

console.log('\n═══ 5. AS TRÊS SAÍDAS + O PULAR ═══');
['print', 'audio', 'ligacao'].forEach(t => ok(src.includes(`id="${t}"`), `opção "${t}" existe`));
ok(/tipo === 'ligacao' && !anotacao\.trim\(\)/.test(src), 'por ligação exige a linha escrita');
ok(/const pular = \(\) => \{ registrarPulo\(\);/.test(src), 'o botão de pular registra o pulo antes de liberar');
ok(/tipo: 'pulado'/.test(src), 'pedido pulado fica marcado como "pulado" na venda (dá pra auditar depois)');

console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
process.exit(falhas ? 1 : 0);
