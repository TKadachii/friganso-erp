// Friganso ERP - Extensão (Resumo + Lançar pedido)
(function () {
    "use strict";

    const APP_URL = "https://TKadachii.github.io/friganso-erp/";
    const host = location.hostname || "";

    // ========= PONTE: roda na página do APP (github.io) =========
    if (host.indexOf("github.io") !== -1) {
        window.addEventListener("message", function (e) {
            const d = e.data;
            if (d && d.source === "friganso-app" && d.type === "LANCAR_PEDIDO" && d.pedido) {
                try {
                    chrome.storage.local.get(["friganso_fila"], function (r) {
                        const fila = (r && r.friganso_fila) || [];
                        fila.push({ id: Date.now() + "_" + Math.floor(Math.random() * 1000), cliente: d.pedido.cliente, itens: d.pedido.itens, ts: Date.now() });
                        while (fila.length > 12) fila.shift(); // guarda os últimos 12
                        chrome.storage.local.set({ friganso_fila: fila });
                    });
                } catch (err) { /* ignore */ }
            }
        });
        return;
    }

    // ========= SPAMOV: leitura + lançamento =========
    if (host.indexOf("friganso.com.br") === -1) return;
    if (!document.body || document.body.tagName === "FRAMESET") return;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const bodyText = () => (document.body && document.body.innerText) || "";

    // ---------- LEITURA (Resumo) ----------
    function extrairCliente() {
        const body = bodyText();
        let m = body.match(/CLIENTE[\s\S]{0,60}?\[[jf]\]\s*(\d+[a-z]?)\s*-\s*([^\n\r]+)/i);
        if (!m) {
            const re = /\[[jf]\]\s*(\d+[a-z]?)\s*-\s*([^\n\r]{3,})/ig;
            let mm, melhor = null;
            while ((mm = re.exec(body)) !== null) { if (mm[1] !== "0" && /[A-Za-zÀ-Ú]/.test(mm[2])) melhor = mm; }
            m = melhor;
        }
        return m ? { code: m[1].trim(), nome: m[2].trim() } : { code: "", nome: "" };
    }
    function extrairSpamov() { const m = bodyText().match(/SPAmov[\s\S]{0,200}?(\d{6,8})/i); return m ? m[1] : ""; }
    function extrairOrcamento() { const m = bodyText().match(/Or[çc]amento[\s\S]{0,40}?(\d{6,8})/i); return m ? m[1] : ""; }

    function acharTabelaItens() {
        const tables = document.querySelectorAll("table");
        for (let i = 0; i < tables.length; i++) {
            const txt = (tables[i].innerText || "").toLowerCase();
            if (txt.indexOf("valor unit") !== -1 || txt.indexOf("quant. mov") !== -1) return tables[i];
        }
        return null;
    }
    function colXQuant(scope) {
        const cs = (scope || document).querySelectorAll("td, th");
        for (let i = 0; i < cs.length; i++) {
            const t = (cs[i].innerText || "").toLowerCase().replace(/\s+/g, " ");
            if (t.indexOf("quant") !== -1 && t.indexOf("mov") !== -1) { const r = cs[i].getBoundingClientRect(); if (r.width) return r.left + r.width / 2; }
        }
        return null;
    }

    function extrairItens(spamov) {
        const raw = [];
        const ignorar = new Set([spamov, extrairOrcamento()].filter(Boolean));
        const scope = acharTabelaItens() || document;
        const colX = colXQuant(scope);
        const campos = [];
        scope.querySelectorAll("input").forEach(function (inp) {
            const tipo = (inp.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(tipo) !== -1) return;
            const v = (inp.value || "").trim();
            if (!/^\d+$/.test(v) || parseInt(v, 10) <= 0) return;
            const r = inp.getBoundingClientRect(); if (!r.width || !r.height) return;
            campos.push({ val: parseInt(v, 10), x: r.left + r.width / 2, y: r.top + r.height / 2 });
        });
        scope.querySelectorAll("tr").forEach(function (row) {
            const cells = row.querySelectorAll("td"); if (!cells.length) return;
            let rawCode = "", codeCell = null;
            for (let i = 0; i < cells.length; i++) { const ct = (cells[i].innerText || "").trim(); const mm = ct.match(/^(\d{3,7})$/); if (mm) { rawCode = mm[1]; codeCell = cells[i]; break; } }
            if (!rawCode || ignorar.has(rawCode)) return;
            let nome = "";
            cells.forEach(function (c) { const ct = (c.innerText || "").replace(/\s+/g, " ").trim(); if (/[A-Za-zÀ-Ú]{4,}/.test(ct) && ct.length > nome.length) nome = ct; });
            if (!nome || nome.replace(/[^A-Za-zÀ-Ú]/g, "").length < 4) return;
            const rr = (codeCell || row).getBoundingClientRect(); const prodY = rr.top + rr.height / 2;
            let qty = null, melhor = 1e9;
            campos.forEach(function (c) { const dy = Math.abs(c.y - prodY); if (dy > 16) return; const dx = (colX !== null) ? Math.abs(c.x - colX) : 0; const s = dx + dy; if (s < melhor) { melhor = s; qty = c.val; } });
            if (qty === null) qty = 1;
            raw.push({ rawCode: rawCode, nome: nome, qty: qty });
        });
        const temPrefixoLinha = raw.length > 0 && raw.every(function (r, i) { const p = String(i + 1); return r.rawCode.indexOf(p) === 0 && (r.rawCode.length - p.length) >= 3; });
        const itens = [], seen = new Set();
        raw.forEach(function (r, i) { let code = temPrefixoLinha ? r.rawCode.slice(String(i + 1).length) : r.rawCode; if (!code || seen.has(code)) return; seen.add(code); itens.push({ code: code, nome: r.nome, qty: r.qty }); });
        return itens;
    }
    function montarPedidoLeitura() { const c = extrairCliente(); const sp = extrairSpamov(); return { cliente: c.code, clienteNome: c.nome, spamov: sp, itens: extrairItens(sp) }; }
    function temPedidoLeitura(p) { return p && (p.cliente || p.spamov || (p.itens && p.itens.length > 0)); }
    function enviarParaApp() {
        const p = montarPedidoLeitura();
        if (!temPedidoLeitura(p) || p.itens.length === 0) { alert("Não consegui ler o pedido nesta tela."); return; }
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(p))));
        try { (window.top || window).open(APP_URL + "?pedidojson=" + encodeURIComponent(b64), "friganso_erp_app").focus(); }
        catch (e) { window.open(APP_URL + "?pedidojson=" + encodeURIComponent(b64), "friganso_erp_app"); }
    }

    // ---------- LANÇAMENTO (Fazer Pedido) ----------
    function statusBox() {
        let box = document.getElementById("friganso-status");
        if (!box) {
            box = document.createElement("div"); box.id = "friganso-status";
            Object.assign(box.style, { position: "fixed", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483647", background: "#0f172a", color: "#fff", padding: "10px 18px", borderRadius: "10px", fontFamily: "system-ui,sans-serif", fontSize: "13px", fontWeight: "bold", boxShadow: "0 6px 20px rgba(0,0,0,.35)", maxWidth: "92vw", textAlign: "center" });
            document.body.appendChild(box);
        }
        return function (msg) { box.textContent = "🦢 " + msg; };
    }
    function setInput(el, v) { el.focus(); el.value = String(v); ["input", "change", "keyup", "blur"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }
    // Digita caractere por caractere (campos legados às vezes exigem eventos de tecla)
    function digitar(el, texto) {
        try { el.focus(); } catch (e) {}
        try { el.value = ""; } catch (e) {}
        const s = String(texto);
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
            el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: ch }));
            try { el.value = s.slice(0, i + 1); } catch (e) {}
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function enter(el) { ["keydown", "keypress", "keyup"].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }))); }
    // Clique robusto: sobe até o elemento realmente clicável e dispara eventos de mouse + click nativo
    function clicar(el) {
        if (!el) return false;
        let alvo = el, p = el;
        for (let i = 0; i < 5 && p; i++) {
            const tem = p.onclick || (p.getAttribute && p.getAttribute("onclick")) || p.tagName === "A" || p.tagName === "BUTTON" || (p.getAttribute && p.getAttribute("href"));
            if (tem) { alvo = p; break; }
            p = p.parentElement;
        }
        try { if (alvo.focus) alvo.focus(); } catch (e) {}
        ["mousedown", "mouseup", "click"].forEach(function (t) { try { alvo.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {} });
        try { if (alvo.click) alvo.click(); } catch (e) {}
        return true;
    }
    async function esperar(cond, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await sleep(200); } return false; }

    function acharLinhaEntrada() {
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const s = selects[i];
            const txt = (s.innerText || "") + " " + Array.from(s.options || []).map(o => o.text).join(" ");
            if (/PRODUTOS/i.test(txt)) { const tr = s.closest("tr"); if (tr) return tr; }
        }
        return null;
    }
    // Retângulo EXATO da linha de entrada (a do seletor PRODUTOS / "novo orçamento")
    function linhaEntradaRect() {
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const s = selects[i];
            const txt = Array.from(s.options || []).map(o => o.text).join(" ");
            if (/PRODUTOS/i.test(txt)) { const tr = s.closest("tr"); const r = (tr || s).getBoundingClientRect(); if (r.height) return r; }
        }
        const tds = document.querySelectorAll("td");
        for (let i = 0; i < tds.length; i++) { if (/novo or[çc]amento/i.test(tds[i].innerText || "")) { const tr = tds[i].closest("tr"); const r = (tr || tds[i]).getBoundingClientRect(); if (r.height) return r; } }
        return null;
    }
    // verdadeiro se o centro vertical do elemento está dentro da faixa da linha de entrada
    function naFaixa(r, el) { const b = el.getBoundingClientRect(); const cy = b.top + b.height / 2; return cy >= r.top - 3 && cy <= r.bottom + 3; }
    function inputsVisiveis() {
        return Array.prototype.slice.call(document.querySelectorAll("input")).filter(function (i) {
            const t = (i.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(t) !== -1) return false;
            const r = i.getBoundingClientRect(); return r.width > 10 && r.height > 5;
        });
    }
    // Acha código e quantidade na LINHA DE ENTRADA = a primeira linha de inputs abaixo do
    // cabeçalho "Quant. Mov." (os itens já lançados ficam ABAIXO dela, então são ignorados).
    function camposEntrada() {
        const colX = colXQuant();
        // pega o fim (bottom) do cabeçalho da coluna "Quant. Mov."
        let headerBottom = null;
        document.querySelectorAll("td, th").forEach(function (c) {
            const t = (c.innerText || "").toLowerCase();
            if (t.indexOf("quant") !== -1 && t.indexOf("mov") !== -1) { const r = c.getBoundingClientRect(); if (r.width && (headerBottom == null || r.bottom < headerBottom)) headerBottom = r.bottom; }
        });
        let cand = inputsVisiveis();
        if (headerBottom != null) cand = cand.filter(function (i) { return i.getBoundingClientRect().top >= headerBottom - 4; });
        if (!cand.length) return null;
        // linha de entrada = inputs mais ao TOPO (itens lançados ficam abaixo)
        let minC = Infinity;
        cand.forEach(function (i) { const b = i.getBoundingClientRect(); const cy = b.top + b.height / 2; if (cy < minC) minC = cy; });
        const naLinha = cand.filter(function (i) { const b = i.getBoundingClientRect(); return Math.abs((b.top + b.height / 2) - minC) < 16; });
        if (!naLinha.length) return null;
        let top = Infinity, bottom = -Infinity;
        naLinha.forEach(function (i) { const b = i.getBoundingClientRect(); top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom); });
        const porX = naLinha.slice().sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
        const code = porX[0] || null; // mais à esquerda = código
        let qty = null, bd = 1e9;
        naLinha.forEach(function (i) {
            if (i === code) return;
            const b = i.getBoundingClientRect(); const x = b.left + b.width / 2;
            const d = (colX != null) ? Math.abs(x - colX) : x;
            if (d < bd) { bd = d; qty = i; } // mais próximo da coluna "Quant. Mov." = quantidade
        });
        return { rect: { top: top, bottom: bottom }, n: naLinha.length, code: code, qty: qty };
    }

    // Detecta se um elemento é "verde" (pela cor ou pelo nome do ícone)
    function ehVerde(el) {
        try {
            const cs = getComputedStyle(el);
            const cores = [cs.backgroundColor, cs.color, cs.borderTopColor];
            for (let i = 0; i < cores.length; i++) {
                const m = cores[i] && cores[i].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (m) { const R = +m[1], G = +m[2], B = +m[3]; if (G > 90 && G > R + 20 && G > B + 20) return true; }
            }
            const s = ((el.src || "") + " " + (el.alt || "") + " " + (el.title || "")).toLowerCase();
            if (/verde|green|\bok\b|check|confirm|aceit|salv|grava|adicion/.test(s)) return true;
        } catch (e) {}
        return false;
    }
    // Acha o ✓ verde da linha de entrada (clica pra lançar o item)
    function acharCheckVerde(faixa) {
        if (!faixa) return null;
        const cands = [];
        const els = document.querySelectorAll("img, a, input[type=image], button, span, div, td");
        els.forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cy = r.top + r.height / 2;
            if (cy < faixa.top - 3 || cy > faixa.bottom + 3) return; // só na linha de entrada
            const txt = ((el.innerText || el.value || "") + "").trim();
            if (/todos/i.test(txt)) return;            // ignora botão "Todos"
            if (txt.length > 6) return;                // ignora textos longos (não é ícone)
            const clicavel = el.tagName === "IMG" || el.tagName === "A" || el.tagName === "INPUT" || el.onclick || el.getAttribute("onclick") || getComputedStyle(el).cursor === "pointer";
            if (!clicavel) return;
            cands.push({ el: el, x: r.left + r.width / 2, verde: ehVerde(el) });
        });
        if (!cands.length) return null;
        const verdes = cands.filter(c => c.verde);
        const lista = verdes.length ? verdes : cands;
        lista.sort((a, b) => b.x - a.x); // mais à direita primeiro (o ✓ fica no fim da linha)
        return lista[0].el;
    }

    // ---------- Estado persistente (sobrevive ao reload "pisca" do site) ----------
    function getRun() { return new Promise(function (res) { try { chrome.storage.local.get(["friganso_run"], function (r) { res((r && r.friganso_run) || null); }); } catch (e) { res(null); } }); }
    function setRun(run) { return new Promise(function (res) { try { chrome.storage.local.set({ friganso_run: run }, function () { res(); }); } catch (e) { res(); } }); }
    function clearRun() { return new Promise(function (res) { try { chrome.storage.local.remove("friganso_run", function () { res(); }); } catch (e) { res(); } }); }
    function ehFrameItens() { return colXQuant() != null; } // frame que tem o cabeçalho "Quant. Mov."

    function acharBotaoNovo() {
        let best = null;
        const els = document.querySelectorAll("a, td, button, span, img, div, input[type=button], input[type=image]");
        for (let i = 0; i < els.length; i++) {
            const e = els[i];
            const t = ((e.value || e.alt || e.title || e.innerText || "") + "").trim();
            if (/^novo$/i.test(t)) { const r = e.getBoundingClientRect(); if (r.width && r.height) { const tam = (e.innerText || "").length; if (!best || tam < best._tam) { best = e; best._tam = tam; } } }
        }
        return best;
    }
    function acharBotaoEnviar() {
        const els = document.querySelectorAll("input[type=button], input[type=submit], button, a, td, span");
        for (let i = 0; i < els.length; i++) { const e = els[i]; const t = ((e.value || e.innerText || "") + "").trim(); if (/^enviar$/i.test(t)) { const r = e.getBoundingClientRect(); if (r.width && r.height) return e; } }
        return null;
    }
    function acharCampoCliente() {
        // 1) MELHOR PISTA: o seletor "1. Jurídica / 2. Física" — o campo do ID fica logo à direita dele
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const s = selects[i];
            const txt = Array.from(s.options || []).map(o => o.text).join(" ");
            if (/jur[ií]dica|f[ií]sica/i.test(txt)) {
                const sr = s.getBoundingClientRect();
                if (!sr.width) continue;
                const cy = sr.top + sr.height / 2;
                const inps = inputsVisiveis().filter(function (inp) {
                    const r = inp.getBoundingClientRect();
                    return Math.abs((r.top + r.height / 2) - cy) < 16 && r.left >= sr.right - 4;
                });
                inps.sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
                if (inps[0]) return inps[0];
            }
        }
        // 2) Fallback: pelo rótulo "CLIENTE"
        let labelRect = null;
        const cells = document.querySelectorAll("td, th, label, span, div, b");
        for (let i = 0; i < cells.length; i++) {
            const t = (cells[i].innerText || "").trim();
            if (/^cliente\b/i.test(t) && t.length < 12) { const r = cells[i].getBoundingClientRect(); if (r.width && r.height) { labelRect = r; break; } }
        }
        if (!labelRect) return null;
        const cy = labelRect.top + labelRect.height / 2;
        const inps = inputsVisiveis().filter(function (i) {
            const r = i.getBoundingClientRect();
            return Math.abs((r.top + r.height / 2) - cy) < 16 && r.left > labelRect.left;
        });
        inps.sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
        return inps[0] || null;
    }
    function ehFramePrincipal() { return ehFrameItens() || /CLIENTE/i.test(bodyText()) || !!acharBotaoNovo(); }

    // Processa UM item por carregamento da página. O clique no verde recarrega o site
    // e, no próximo load, esta função retoma sozinha do próximo item.
    async function processarRun() {
        const run = await getRun();
        if (!run || !run.ativo) return;
        if (!ehFrameItens()) return;                                   // só o frame de itens age
        if (Date.now() - (run.ts || 0) > 120 * 1000) { await clearRun(); return; } // expira em 2min sem progresso

        const status = statusBox();
        const stage = run.stage || "itens";
        const nomeEtapa = stage === "novo" ? "abrir Novo" : (stage === "cliente" ? "preencher Cliente" : "lançar Itens");
        status("🔄 Retomando — etapa: " + nomeEtapa + "...");
        await sleep(1800); // deixa a página assentar após o "pisca"/navegação

        // ETAPA 1: clicar em "Novo"
        if (stage === "novo") {
            let btn = acharBotaoNovo(), t = 0;
            while (!btn && t < 8) { await sleep(500); btn = acharBotaoNovo(); t++; }
            if (!btn) { if (ehFramePrincipal()) status("❌ Não achei o botão 'Novo'. Manda um print do botão que eu ajusto a mira."); return; }
            status("Abrindo novo pedido...");
            await setRun({ pedido: run.pedido, stage: "cliente", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() });
            clicar(btn);
            await sleep(2800); processarRun(); // se NÃO recarregar, continua sozinho; se recarregar, este código é descartado
            return;
        }

        // ETAPA 2: preencher o cliente e clicar em "Enviar"
        if (stage === "cliente") {
            status("Aguardando a tela do cliente...");
            await sleep(2000); // ⏱️ folga após o "Novo" (a tela termina de abrir e foca o campo)
            let cli = acharCampoCliente(), t = 0;
            while (!cli && t < 10) { await sleep(500); cli = acharCampoCliente(); t++; }
            // o site já deixa o campo focado depois do Novo — usa o campo focado como reforço
            if (!cli) { const ae = document.activeElement; if (ae && ae.tagName === "INPUT") cli = ae; }
            if (!cli) { if (ehFramePrincipal()) status("❌ Não achei o campo do Cliente. Manda um print que eu ajusto."); return; }
            status("Digitando cliente " + run.pedido.cliente + "...");
            try { cli.focus(); } catch (e) {}
            digitar(cli, run.pedido.cliente);          // digita o ID caractere a caractere
            setInput(cli, run.pedido.cliente);         // reforço: garante o valor final + change/blur
            enter(cli);
            await sleep(2000); // ⏱️ folga antes do Enviar (deixa o cliente resolver)
            await setRun({ pedido: run.pedido, stage: "itens", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() });
            let env = acharBotaoEnviar(), te = 0;
            while (!env && te < 6) { await sleep(400); env = acharBotaoEnviar(); te++; }
            if (env) { status("Clicando em Enviar..."); clicar(env); }
            else { status("Botão Enviar não achado — tentando Enter..."); enter(cli); }
            await sleep(2800); processarRun(); // continua sozinho se não recarregar
            return;
        }

        // ETAPA 3: itens
        if (!ehFrameItens()) return; // só o frame de itens age aqui
        const total = run.pedido.itens.length;

        // Confere o resultado do item anterior (a mensagem aparece na página recarregada)
        if (run.aguardando) {
            const msg = bodyText().slice(-900);
            if (/n[ãa]o\s+adicionado|saldo\s+n[ãa]o\s+suporta|n[ãa]o\s+suporta|estoque\s+insuficiente|bloquead/i.test(msg) && !/item\s+aceito/i.test(msg)) {
                await clearRun();
                status("🛑 PAROU no item " + run.ultimoCode + ". O SPAmov recusou (veja a faixa azul). Os anteriores foram lançados.");
                return;
            }
        }

        if (run.idx >= total) {
            await clearRun();
            status("✅ " + total + " item(ns) lançados! Confira tudo e finalize na mão: DS → SP → PA.");
            return;
        }

        // garante a linha de entrada pronta
        let info = camposEntrada(), tent = 0;
        while ((!info || !info.code || !info.qty) && tent < 12) { await sleep(500); info = camposEntrada(); tent++; }
        if (!info || !info.code || !info.qty) { await clearRun(); status("❌ Não achei os campos (inputs: " + (info ? info.n : 0) + "). Cancelei — manda um print."); return; }

        const it = run.pedido.itens[run.idx];
        status("Lançando " + (run.idx + 1) + "/" + total + ":  " + it.code + "  x" + it.qty);

        // 1) código -> resolve o produto
        const antesCod = bodyText();
        setInput(info.code, "");
        setInput(info.code, it.code);
        enter(info.code);
        await esperar(function () { return bodyText() !== antesCod; }, 5000);
        await sleep(900);

        // 2) quantidade (ignora o campo de valor)
        info = camposEntrada();
        if (info && info.qty) setInput(info.qty, it.qty);
        await sleep(400);

        // 3) salva o avanço ANTES de clicar (a página vai recarregar)
        await setRun({ pedido: run.pedido, stage: "itens", idx: run.idx + 1, ativo: true, aguardando: true, ultimoCode: it.code, ts: Date.now() });

        // 4) clica no ✓ verde -> o site recarrega e o próximo item continua sozinho
        const check = acharCheckVerde(info ? info.rect : linhaEntradaRect());
        if (check) clicar(check);
        else if (info && info.qty) enter(info.qty);
        status("✓ " + it.code + " enviado — aguardando o site recarregar...");

        // Se o site NÃO recarregar (caso seja AJAX), continua sozinho após um tempo.
        // Se recarregar, este código é descartado e o próximo load retoma.
        await sleep(3000);
        processarRun();
    }

    function removerDaFila(id) {
        chrome.storage.local.get(["friganso_fila"], function (r) {
            const fila = ((r && r.friganso_fila) || []).filter(function (x) { return x.id !== id; });
            chrome.storage.local.set({ friganso_fila: fila });
        });
    }
    function lancarDaFila(p) {
        removerDaFila(p.id);
        statusBox()("Iniciando lançamento do cliente " + (p.cliente || "?") + "...");
        clearRun().then(function () {
            setRun({ pedido: { cliente: p.cliente, itens: p.itens }, stage: "novo", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() }).then(processarRun);
        });
    }
    function abrirPopupFila() {
        chrome.storage.local.get(["friganso_fila"], function (r) {
            const fila = (r && r.friganso_fila) || [];
            const old = document.getElementById("friganso-popup"); if (old) old.remove();
            const ov = document.createElement("div"); ov.id = "friganso-popup";
            Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(15,23,42,.6)", zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" });
            ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
            const box = document.createElement("div");
            Object.assign(box.style, { background: "#fff", borderRadius: "16px", padding: "18px", width: "440px", maxWidth: "92vw", maxHeight: "80vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,.4)" });
            const titulo = document.createElement("div"); titulo.textContent = "🚀 Pedidos para lançar"; Object.assign(titulo.style, { fontWeight: "800", fontSize: "16px", color: "#0f172a", marginBottom: "6px" });
            box.appendChild(titulo);
            if (!fila.length) {
                const vazio = document.createElement("div"); vazio.style.cssText = "color:#64748b;font-size:13px;padding:14px 0;line-height:1.5;";
                vazio.innerHTML = 'Nenhum pedido na fila.<br>No app, vá em <b>Fazer Pedido</b>, monte e toque em <b>Mandar pra Extensão</b>.';
                box.appendChild(vazio);
            }
            fila.slice().reverse().forEach(function (p) {
                const card = document.createElement("div");
                Object.assign(card.style, { border: "1px solid #e2e8f0", borderRadius: "12px", padding: "10px", margin: "8px 0", display: "flex", gap: "10px", alignItems: "center" });
                const info = document.createElement("div"); info.style.flex = "1"; info.style.minWidth = "0";
                info.innerHTML = '<div style="font-weight:700;color:#0f172a;font-size:14px;">Cliente ' + (p.cliente || "?") + '</div><div style="color:#64748b;font-size:12px;line-height:1.4;">' + p.itens.length + ' item(ns): ' + p.itens.map(function (i) { return i.code + "×" + i.qty; }).join(", ") + '</div>';
                const btnL = document.createElement("button"); btnL.textContent = "Lançar"; Object.assign(btnL.style, { background: "#15803d", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 14px", fontWeight: "700", cursor: "pointer", flexShrink: "0" });
                btnL.addEventListener("click", function () { ov.remove(); lancarDaFila(p); });
                const btnX = document.createElement("button"); btnX.textContent = "✕"; btnX.title = "Remover da fila"; Object.assign(btnX.style, { background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: "8px", padding: "8px 10px", cursor: "pointer", flexShrink: "0" });
                btnX.addEventListener("click", function () { removerDaFila(p.id); card.remove(); });
                card.appendChild(info); card.appendChild(btnL); card.appendChild(btnX);
                box.appendChild(card);
            });
            const fechar = document.createElement("button"); fechar.textContent = "Fechar"; Object.assign(fechar.style, { marginTop: "8px", background: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", padding: "9px 12px", cursor: "pointer", width: "100%", fontWeight: "700" });
            fechar.addEventListener("click", function () { ov.remove(); });
            box.appendChild(fechar);
            ov.appendChild(box); document.body.appendChild(ov);
        });
    }
    function cancelarLancamento() { clearRun().then(function () { statusBox()("Lançamento cancelado."); }); }

    // ---------- BOTÕES ----------
    function botao(id, texto, cor, bottom, onClick) {
        if (document.getElementById(id)) return;
        const b = document.createElement("button");
        b.id = id; b.type = "button"; b.textContent = texto;
        Object.assign(b.style, { position: "fixed", right: "18px", bottom: bottom, zIndex: "2147483647", background: cor, color: "#fff", border: "none", borderRadius: "12px", padding: "12px 18px", fontSize: "14px", fontWeight: "bold", fontFamily: "system-ui,sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,0.3)", cursor: "pointer" });
        b.addEventListener("click", onClick);
        document.body.appendChild(b);
    }

    const temLeitura = temPedidoLeitura(montarPedidoLeitura());

    if (ehFramePrincipal()) {
        botao("friganso-lancar-btn", "🚀 Lançar pedido", "#15803d", "120px", abrirPopupFila);
        botao("friganso-cancelar-btn", "⏹ Cancelar lançamento", "#64748b", "70px", cancelarLancamento);
    }
    if (temLeitura) botao("friganso-erp-btn", "📋 Enviar pro Friganso ERP", "#e11d48", "18px", enviarParaApp);

    // Retoma automaticamente um lançamento em andamento (após cada reload do site)
    if (ehFramePrincipal()) processarRun();
})();
