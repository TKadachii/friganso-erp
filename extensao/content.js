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
                    chrome.storage.local.set({ friganso_pedido: d.pedido, friganso_pedido_ts: Date.now() });
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
    function setInput(el, v) { el.focus(); el.value = String(v); ["input", "change", "keyup"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }
    function enter(el) { ["keydown", "keypress", "keyup"].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }))); }
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
    // Y (posição vertical) da linha de entrada de itens
    function entradaY() {
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const s = selects[i];
            const txt = Array.from(s.options || []).map(o => o.text).join(" ");
            if (/PRODUTOS/i.test(txt)) { const r = s.getBoundingClientRect(); if (r.width) return r.top + r.height / 2; }
        }
        const tds = document.querySelectorAll("td");
        for (let i = 0; i < tds.length; i++) { if (/novo or[çc]amento/i.test(tds[i].innerText || "")) { const r = tds[i].getBoundingClientRect(); if (r.height) return r.top + r.height / 2; } }
        return null;
    }
    function inputsVisiveis() {
        return Array.prototype.slice.call(document.querySelectorAll("input")).filter(function (i) {
            const t = (i.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(t) !== -1) return false;
            const r = i.getBoundingClientRect(); return r.width > 10 && r.height > 5;
        });
    }
    // Acha os campos de código e quantidade da linha de entrada PELA POSIÇÃO na tela
    function camposEntrada() {
        const y = entradaY(); if (y == null) return null;
        const colX = colXQuant();
        const naLinha = inputsVisiveis().filter(function (i) { const r = i.getBoundingClientRect(); return Math.abs((r.top + r.height / 2) - y) < 24; });
        const porX = naLinha.slice().sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
        const code = porX[0] || null; // mais à esquerda = código
        let qty = null, bd = 1e9;
        naLinha.forEach(function (i) {
            if (i === code) return;
            const r = i.getBoundingClientRect(); const x = r.left + r.width / 2;
            const d = (colX != null) ? Math.abs(x - colX) : x;
            if (d < bd) { bd = d; qty = i; } // mais próximo da coluna "Quant. Mov." = quantidade
        });
        return { y: y, n: naLinha.length, code: code, qty: qty };
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
    function acharCheckVerde(y) {
        if (y == null) return null;
        const cands = [];
        const els = document.querySelectorAll("img, a, input[type=image], button, span, div, td");
        els.forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (Math.abs((r.top + r.height / 2) - y) > 24) return; // mesma linha da entrada
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

    async function lancarPedido(pedido) {
        const status = statusBox();
        try {
            let info = camposEntrada();
            if (!info || info.y == null) { status("❌ Não achei a linha de entrada. Abra o pedido até a tela amarela de itens e clique de novo."); return; }
            const total = pedido.itens.length;
            for (let k = 0; k < total; k++) {
                const it = pedido.itens[k];
                status("Lançando " + (k + 1) + "/" + total + ":  " + it.code + "  x" + it.qty);
                info = camposEntrada();
                if (!info || !info.code || !info.qty) { status("❌ Não achei os campos (inputs na linha: " + (info ? info.n : 0) + "). Manda um print que eu ajusto."); return; }

                const antes = bodyText();
                setInput(info.code, it.code);
                enter(info.code);
                await sleep(1300); // espera o produto carregar
                info = camposEntrada(); // a linha pode ter mudado
                const q = (info && info.qty) ? info.qty : null;
                if (q) setInput(q, it.qty);
                await sleep(250);

                // clica no ✓ verde pra lançar o item
                const check = acharCheckVerde(info ? info.y : entradaY());
                if (check) { check.click(); }
                else if (q) { enter(q); } // fallback: tenta Enter

                const mudou = await esperar(function () { return bodyText() !== antes; }, 8000);
                await sleep(500);

                const fim = bodyText().slice(-700);
                if (!mudou) { status("⚠️ Item " + it.code + " não parece ter entrado (não achei/cliquei no ✓ certo). Manda um print que eu ajusto a mira."); return; }
                if (/n[ãa]o\s+adicionado|saldo\s+n[ãa]o\s+suporta|n[ãa]o\s+suporta|estoque\s+insuficiente|bloquead/i.test(fim) && !/item\s+aceito/i.test(fim)) {
                    status("🛑 PAROU no item " + it.code + ". O SPAmov recusou (veja a faixa azul). Os anteriores foram lançados.");
                    return;
                }
                status("✓ " + it.code + " ok");
                await sleep(400);
            }
            status("✅ " + total + " item(ns) lançados! Confira tudo e finalize na mão: DS → SP → PA.");
            try { chrome.storage.local.remove("friganso_pedido"); } catch (e) {}
        } catch (e) { status("❌ Erro: " + e.message); }
    }

    function iniciarLancamento() {
        try {
            chrome.storage.local.get(["friganso_pedido"], function (res) {
                const pedido = res && res.friganso_pedido;
                if (!pedido || !pedido.itens || !pedido.itens.length) {
                    alert("Nenhum pedido pendente.\n\nMonte o pedido no app (Fazer Pedido) e toque em 'Mandar pra Extensão' primeiro.");
                    return;
                }
                const resumo = pedido.itens.map(i => "• " + i.code + "  x" + i.qty).join("\n");
                if (confirm("Lançar este pedido no SPAmov?\n\nCliente: " + (pedido.cliente || "?") + "\n\n" + resumo + "\n\nVocê confere e finaliza (DS→SP→PA) na mão depois.")) {
                    lancarPedido(pedido);
                }
            });
        } catch (e) { alert("Erro ao ler o pedido: " + e.message); }
    }

    // ---------- BOTÕES ----------
    function botao(id, texto, cor, bottom, onClick) {
        if (document.getElementById(id)) return;
        const b = document.createElement("button");
        b.id = id; b.type = "button"; b.textContent = texto;
        Object.assign(b.style, { position: "fixed", right: "18px", bottom: bottom, zIndex: "2147483647", background: cor, color: "#fff", border: "none", borderRadius: "12px", padding: "12px 18px", fontSize: "14px", fontWeight: "bold", fontFamily: "system-ui,sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,0.3)", cursor: "pointer" });
        b.addEventListener("click", onClick);
        document.body.appendChild(b);
    }

    const temEntrada = !!acharLinhaEntrada() || entradaY() != null;
    const temLeitura = temPedidoLeitura(montarPedidoLeitura());

    // Botão de LANÇAR aparece na tela de itens (linha amarela de entrada)
    if (temEntrada) botao("friganso-lancar-btn", "🚀 Lançar pedido", "#15803d", "70px", iniciarLancamento);
    // Botão de LER/RESUMO aparece quando há um pedido já montado na tela
    if (temLeitura) botao("friganso-erp-btn", "📋 Enviar pro Friganso ERP", "#e11d48", "18px", enviarParaApp);
})();
