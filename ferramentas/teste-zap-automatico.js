const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

// Extrai a função iniciarZapAuto do content.js de verdade — testa o código publicado,
// não uma cópia.
const src = fs.readFileSync(require('path').join(__dirname, '..', 'extensao', 'content.js'), 'utf8');
const ini = src.indexOf('function iniciarZapAuto()');
if (ini < 0) { console.log('❌ não achei iniciarZapAuto no content.js'); process.exit(1); }
// acha o fim da função contando chaves
let prof = 0, fim = -1;
for (let i = src.indexOf('{', ini); i < src.length; i++) {
    if (src[i] === '{') prof++;
    else if (src[i] === '}') { prof--; if (prof === 0) { fim = i + 1; break; } }
}
const FONTE_ZAP = src.slice(ini, fim);
console.log(`Função extraída do content.js: ${FONTE_ZAP.split('\n').length} linhas\n`);

// ── Servidor que finge ser o WhatsApp Web ──────────────────────────────────────────
// Reproduz o essencial: a URL /send?phone=..&text=.., e um botão com o mesmo
// aria-label="Enviar" que o WhatsApp usa. Registra cada envio em /enviado.
const enviados = [];
const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/registrar') { enviados.push(u.searchParams.get('p')); res.end('ok'); return; }
    const phone = u.searchParams.get('phone') || '';
    const invalido = phone === '5511000000000';   // simula número inválido
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body>
        <div id="app">${invalido
            ? '<p>O número de telefone compartilhado por url é inválido.</p>'
            : (phone ? `<button aria-label="Enviar" onclick="fetch('/registrar?p=${phone}')">enviar</button>` : '<p>WhatsApp</p>')}</div>
    </body></html>`);
});
(async () => {
    await new Promise(r => servidor.listen(0, r));
    const porta = servidor.address().port;
    const BASE = `http://localhost:${porta}`;

    const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
    const ctx = await navegador.newContext();
    const pg = await ctx.newPage();

    let falhas = 0;
    const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

    // Injeta: mock do chrome.storage + troca da URL do WhatsApp pela do servidor falso
    const preparar = async (campanha) => {
        await pg.addInitScript(({ fonte, camp, base }) => {
            // ⚠️ apoiado no localStorage: o chrome.storage de verdade PERSISTE entre navegações,
            // e o motor navega a cada envio. Um objeto em memória zeraria a cada troca de página.
            const LS = 'mock_chrome_storage';
            if (camp) window.localStorage.setItem(LS, JSON.stringify({ friganso_zap_campanha: camp }));
            const pegar = () => { try { return JSON.parse(window.localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
            const por = (o) => window.localStorage.setItem(LS, JSON.stringify(o));
            window.__store = { get: pegar };
            window.chrome = { storage: { local: {
                get: (ks, cb) => { const st = pegar(); cb(Object.fromEntries((Array.isArray(ks) ? ks : [ks]).map(k => [k, st[k]]))); },
                set: (o, cb) => { const st = pegar(); Object.assign(st, o); por(st); cb && cb(); },
                remove: (k) => { const st = pegar(); (Array.isArray(k) ? k : [k]).forEach(x => delete st[x]); por(st); },
            } } };
            const f = new Function('return ' + fonte.replace(
                'https://web.whatsapp.com/send?phone=', base + '/send?phone='))();
            window.__iniciar = f;
        }, { fonte: FONTE_ZAP, camp: campanha, base: BASE });
    };

    const campanha = {
        itens: [
            { telefone: '5522992891542', nome: 'Rota do Sol',  mensagem: 'oi 1', status: '' },
            { telefone: '5511000000000', nome: 'Número Ruim',  mensagem: 'oi 2', status: '' },
            { telefone: '5522988887777', nome: 'Bar do Mar',   mensagem: 'oi 3', status: '' },
        ], idx: 0, rodando: false, respiro: 2, ts: Date.now(),
    };

    console.log('═══ 1. SEM CAMPANHA: não pode aparecer painel ═══');
    await preparar(null);
    await pg.goto(BASE + '/');
    await pg.evaluate(() => window.__iniciar());
    await pg.waitForTimeout(2200);
    ok(await pg.locator('#friganso-zap-painel').count() === 0, 'nenhum painel quando não há campanha (não atrapalha o uso normal)');

    console.log('\n═══ 2. COM CAMPANHA: painel aparece, parado ═══');
    const pg2 = await ctx.newPage();
    await pg2.addInitScript(({ fonte, camp, base }) => {
        const LS = 'mock_chrome_storage';
        // só semeia a campanha na PRIMEIRA carga; nas seguintes o estado já está gravado
        if (!window.localStorage.getItem(LS)) window.localStorage.setItem(LS, JSON.stringify({ friganso_zap_campanha: camp }));
        const pegar = () => { try { return JSON.parse(window.localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
        const por = (o) => window.localStorage.setItem(LS, JSON.stringify(o));
        window.__store = { get: pegar };
        window.chrome = { storage: { local: {
            get: (ks, cb) => { const st = pegar(); cb(Object.fromEntries((Array.isArray(ks) ? ks : [ks]).map(k => [k, st[k]]))); },
            set: (o, cb) => { const st = pegar(); Object.assign(st, o); por(st); cb && cb(); },
            remove: (k) => { const st = pegar(); (Array.isArray(k) ? k : [k]).forEach(x => delete st[x]); por(st); },
        } } };
        window.__fonte = fonte.replace('https://web.whatsapp.com/send?phone=', base + '/send?phone=');
        // roda a cada carregamento, como o content script de verdade faz
        window.addEventListener('DOMContentLoaded', () => { new Function('return ' + window.__fonte)()(); });
    }, { fonte: FONTE_ZAP, camp: campanha, base: BASE });

    await pg2.goto(BASE + '/');
    await pg2.waitForTimeout(2200);
    ok(await pg2.locator('#friganso-zap-painel').count() === 1, 'painel montado');
    const txt0 = await pg2.locator('#friganso-zap-painel').innerText();
    ok(/Iniciar envio/.test(txt0), 'botão começa em "Iniciar envio" (não dispara sozinho sem o usuário mandar)');
    ok(/0 de 3/.test(txt0), 'mostra 0 de 3');

    console.log('\n═══ 3. CLICA EM INICIAR: dispara a fila inteira ═══');
    await pg2.locator('#frig-btn').click();
    // 3 contatos, respiro 2s -> dá folga
    await pg2.waitForTimeout(16000);

    ok(enviados.includes('5522992891542'), 'enviou pro 1º contato (Rota do Sol)');
    ok(enviados.includes('5522988887777'), 'enviou pro 3º contato (Bar do Mar), DEPOIS do número inválido');
    ok(!enviados.includes('5511000000000'), 'não enviou pro número inválido');
    ok(enviados.length === 2, `total de envios = 2 (deu ${enviados.length}) — sem envio duplicado`);

    const est = await pg2.evaluate(() => window.__store.get().friganso_zap_campanha);
    ok(est.itens[0].status === 'enviado', '1º marcado como enviado');
    ok(est.itens[1].status === 'falhou',  '2º marcado como FALHOU (número inválido) em vez de travar a fila');
    ok(est.itens[2].status === 'enviado', '3º marcado como enviado');
    ok(est.rodando === false, 'campanha terminou e se desligou sozinha');

    const txtFim = await pg2.locator('#friganso-zap-painel').innerText();
    ok(/concluída/i.test(txtFim), 'painel avisa que concluiu');

    await navegador.close();
    servidor.close();
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
    process.exit(falhas ? 1 : 0);
})();
