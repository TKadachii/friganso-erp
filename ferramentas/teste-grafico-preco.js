// 📈 Testa o gráfico de Variação de Preço num navegador de verdade.
//
// Por que num navegador: o problema original era VISUAL — com `beginAtZero: true`, num produto de
// R$ 35 um pico pra R$ 37,50 ocupava 6% da altura e a linha parecia reta. Isso não dá pra checar
// lendo código; precisa renderizar e medir o eixo.
//
// Monta uma página com o componente REAL extraído do index.html, dados iguais ao caso que o usuário
// reportou (0202 CARNE SECA), e confere eixo, busca e correção de preço.
const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http');
let chromium;
try { chromium = require('playwright').chromium; require.resolve('react'); require.resolve('chart.js'); require.resolve('@babel/standalone'); }
catch (e) {
    console.log('⏭️  Teste pulado: faltam pacotes.');
    console.log('   Pra rodar:  npm install playwright react@18 react-dom@18 chart.js @babel/standalone');
    process.exit(0);
}
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pegar = (nome) => {
    const i = src.indexOf('const ' + nome + ' = ');
    if (i < 0) throw new Error('não achei ' + nome + ' no index.html');
    let prof = 0, f = -1;
    for (let k = src.indexOf('{', src.indexOf('=>', i)); k < src.length; k++) {
        if (src[k] === '{') prof++; else if (src[k] === '}') { prof--; if (!prof) { f = k + 1; break; } }
    }
    return src.slice(i, f) + ';';
};

let falhas = 0;
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) falhas++; };

// caso real: quase reto em R$ 35 com um pico isolado — o que aparecia como linha reta
const precos = Array(27).fill(35).concat([37.5, 35, 35, 35, 35, 35, 35.1]);
const base = new Date('2026-08-31');
const versions = precos.map((v, i) => {
    const d = new Date(base); d.setDate(d.getDate() - (precos.length - 1 - i) * 2.6);
    return { id: 'v' + i, updatedAt: d.toISOString(), products: [{ code: '0202', name: 'CARNE SECA DIANT. 5K FRIGANSO', originalPrice: v }] };
});
const products = [
    { code: '0202', name: 'CARNE SECA DIANT. 5K FRIGANSO' },
    { code: '1602', name: 'DIANTEIRO BOVINO' },
    { code: '10088', name: 'PEITO DE FRANGO ENV COOPAVEL CX/18KG' },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frig-grafico-'));
// ⚠️ resolve o caminho REAL de cada pacote em vez de chutar uma pasta node_modules: com NODE_PATH
// os pacotes podem estar em qualquer lugar, e adivinhar a pasta fazia o teste rodar pela metade —
// os scripts davam 404, o gráfico não desenhava e ele acusava um bug que não existia.
const ARQ = {};
// ⚠️ NÃO dá pra usar require.resolve('react/umd/...') direto: o campo "exports" do package.json
// do React bloqueia subcaminhos, mesmo com o arquivo existindo no disco. Resolve a RAIZ do pacote
// e monta o caminho na mão.
// Cada pacote bloqueia um subcaminho diferente no "exports" (o React barra ./umd/*, o chart.js
// barra até ./package.json), então nada de resolver subcaminho: resolve a ENTRADA do pacote e sobe
// os diretórios até achar o package.json com o nome certo.
const naPasta = (pkg, rel) => {
    let d = path.dirname(require.resolve(pkg));
    for (let i = 0; i < 6; i++) {
        const pj = path.join(d, 'package.json');
        if (fs.existsSync(pj)) {
            try { if (JSON.parse(fs.readFileSync(pj, 'utf8')).name === pkg) break; } catch (e) {}
        }
        const pai = path.dirname(d);
        if (pai === d) break;
        d = pai;
    }
    const f = path.join(d, rel);
    if (!fs.existsSync(f)) throw new Error('não achei ' + pkg + '/' + rel);
    return f;
};
try {
    ARQ['react.js'] = naPasta('react', 'umd/react.development.js');
    ARQ['react-dom.js'] = naPasta('react-dom', 'umd/react-dom.development.js');
    ARQ['chart.js'] = naPasta('chart.js', 'dist/chart.umd.js');
    ARQ['babel.js'] = naPasta('@babel/standalone', 'babel.min.js');
} catch (e) {
    console.log('⏭️  Teste pulado: não achei os builds de navegador dos pacotes (' + e.message.split('\n')[0] + ')');
    console.log('   Pra rodar:  npm install playwright react@18 react-dom@18 chart.js @babel/standalone');
    process.exit(0);
}
fs.writeFileSync(path.join(dir, 'preview.html'), `<!doctype html><html><head><meta charset="utf-8">
<script src="/lib/react.js"></script>
<script src="/lib/react-dom.js"></script>
<script src="/lib/chart.js"></script>
<script src="/lib/babel.js"></script>
<style>body{font-family:system-ui;padding:20px}input{font:inherit;padding:8px;width:100%;box-sizing:border-box}summary{cursor:pointer}</style>
</head><body><div id="raiz"></div>
<script type="text/babel">
const { useState, useEffect, useMemo, useRef } = React;
${pegar('Grafico')}
${pegar('GraficoPrecoProduto')}
const V0 = ${JSON.stringify(versions)}.map(v => ({ ...v, updatedAt: new Date(v.updatedAt) }));
const Raiz = () => {
  const [vs, setVs] = useState(V0);
  window.__ignorar = (id, ign) => setVs(a => a.map(v => v.id === id ? { ...v, ignorada: ign } : v));
  return <GraficoPrecoProduto products={${JSON.stringify(products)}} versions={vs}
    onSalvarPreco={async (versaoId, code, valor) => { window.__salvou = { versaoId, code, valor }; return true; }}
    onIgnorarTabela={async (id, ign) => { window.__ignorou = { id, ign }; window.__ignorar(id, ign); return true; }}
    showMessage={() => {}} />;
};
ReactDOM.createRoot(document.getElementById('raiz')).render(<Raiz />);
</script></body></html>`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };
const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const f = u.startsWith('/lib/') ? ARQ[u.slice(5)] : path.join(dir, u);
    if (!f) { r.statusCode = 404; r.end(); return; }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; r.end(); return; }
    r.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(r);
});

(async () => {
    await new Promise(r => srv.listen(0, r));
    const cand = (fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers') : [])
        .filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`).filter(f => fs.existsSync(f));
    const nav = await chromium.launch(cand.length ? { executablePath: cand[0] } : {});
    const pg = await nav.newPage({ viewport: { width: 900, height: 1000 } });
    const erros = [];
    pg.on('pageerror', e => erros.push(e.message));
    await pg.goto(`http://localhost:${srv.address().port}/preview.html`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(2000);

    console.log('═══ 1. RENDERIZOU? ═══');
    ok(erros.length === 0, `sem erro de JS${erros.length ? ': ' + erros[0] : ''}`);
    ok(await pg.locator('canvas').count() === 1, 'o gráfico foi desenhado');

    console.log('\n═══ 2. O EIXO MOSTRA A VARIAÇÃO? (o bug original) ═══');
    // ⚠️ o coração do teste: com beginAtZero o eixo ia de 0 a 40 e o pico sumia
    const eixo = await pg.evaluate(() => {
        const c = Object.values(window.Chart.instances || {})[0] || (window.Chart.getChart && window.Chart.getChart(document.querySelector('canvas')));
        return { min: c.scales.y.min, max: c.scales.y.max };
    });
    ok(eixo.min > 30, `o eixo começa em ~R$ ${eixo.min.toFixed(2)}, não em zero`);
    ok(eixo.max < 40, `e termina em ~R$ ${eixo.max.toFixed(2)}, colado nos dados`);
    // o pico (37,50 sobre 35,00) tem que ocupar boa parte da altura
    const fatia = (37.5 - 35) / (eixo.max - eixo.min);
    ok(fatia > 0.5, `o pico ocupa ${Math.round(fatia * 100)}% da altura (com zero na base ocupava ~6%)`);
    ok(await pg.locator('text=/O eixo começa em/').count() === 1, 'avisa que o eixo não começa em zero');

    console.log('\n═══ 3. DÁ PRA ACHAR O PRODUTO? ═══');
    const campo = pg.locator('input[placeholder*="Buscar produto"]');
    await campo.click(); await campo.fill('frango'); await pg.waitForTimeout(300);
    ok(await pg.locator('button:has-text("PEITO DE FRANGO")').count() === 1, 'busca por nome filtra');
    await campo.fill('1602'); await pg.waitForTimeout(300);
    ok(await pg.locator('button:has-text("DIANTEIRO BOVINO")').count() === 1, 'busca por código também');
    await campo.fill('xyzabc'); await pg.waitForTimeout(300);
    ok(await pg.locator('text=/Nenhum produto com esse termo/').count() === 1, 'avisa quando não acha nada');
    await pg.keyboard.press('Escape'); await campo.fill('0202'); await pg.waitForTimeout(300);
    await pg.locator('button:has-text("CARNE SECA")').click(); await pg.waitForTimeout(500);

    console.log('\n═══ 4. DÁ PRA CORRIGIR PREÇO ERRADO? ═══');
    await pg.locator('summary').click(); await pg.waitForTimeout(300);
    ok(await pg.locator('summary ~ div > div').count() === precos.length, `lista as ${precos.length} datas`);
    const primeira = await pg.locator('summary ~ div > div').first().innerText();
    ok(/31\/08/.test(primeira), 'data mais recente no topo');
    await pg.locator('button:has-text("✏️")').nth(6).click(); await pg.waitForTimeout(200);
    await pg.locator('summary ~ div input').fill('35,00');
    await pg.locator('button:has-text("Salvar")').click(); await pg.waitForTimeout(400);
    const salvo = await pg.evaluate(() => window.__salvou);
    ok(!!salvo, 'chamou o salvamento');
    ok(salvo && salvo.valor === 35, `aceita vírgula: "35,00" virou ${salvo && salvo.valor}`);
    ok(salvo && salvo.code === '0202', 'manda o código certo');
    ok(salvo && /^v\d+$/.test(salvo.versaoId), 'manda o ID da tabela daquela data');
    await pg.evaluate(() => { window.__salvou = null; });
    await pg.locator('button:has-text("✏️")').nth(2).click(); await pg.waitForTimeout(200);
    await pg.locator('summary ~ div input').fill('abc');
    await pg.locator('button:has-text("Salvar")').click(); await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => window.__salvou) === null, 'recusa valor inválido');

    console.log('\n═══ 5. DESCARTAR A TABELA INTEIRA DE UM DIA ═══');
    // caso real: uma tabela foi carregada de um PDF errado e sujou vários produtos de uma vez
    pg.on('dialog', d => d.accept());
    const antes = await pg.evaluate(() => {
        const c = window.Chart.getChart(document.querySelector('canvas'));
        return c.data.labels.length;
    });
    await pg.locator('button:has-text("🚫")').nth(6).click();
    await pg.waitForTimeout(600);
    const ign = await pg.evaluate(() => window.__ignorou);
    ok(ign && ign.ign === true, 'pediu pra descartar a tabela daquela data');
    ok(ign && /^v\d+$/.test(ign.id), `mandou o ID da tabela → ${ign && ign.id}`);
    const depois = await pg.evaluate(() => {
        const c = window.Chart.getChart(document.querySelector('canvas'));
        return c.data.labels.length;
    });
    ok(depois === antes - 1, `o ponto saiu do gráfico (${antes} → ${depois})`);
    ok(await pg.locator('text=/tabela\\(s\\) fora do gráfico/').count() === 1, 'mostra o aviso de tabela descartada');
    ok(await pg.locator('button:has-text("Trazer de volta")').count() === 1, 'oferece o botão de restaurar');

    // ⚠️ o pulo do gato: descartar TUDO não pode esconder o botão de restaurar
    await pg.evaluate(() => { document.querySelectorAll('button').forEach(b => {}); });
    const total = await pg.evaluate(() => window.__ignorar && true);
    await pg.evaluate(() => {
        for (let i = 0; i < 40; i++) window.__ignorar('v' + i, true);
    });
    await pg.waitForTimeout(600);
    ok(await pg.locator('button:has-text("Trazer de volta")').count() > 0,
       'com TUDO descartado, o botão de restaurar continua na tela (não deixa o usuário sem saída)');

    await nav.close(); srv.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ todos passaram');
    process.exit(falhas ? 1 : 0);
})();
