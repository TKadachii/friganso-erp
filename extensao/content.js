// Friganso ERP - Resumo Rápido
// Lê o pedido aberto no SPAmov (cliente, SPAmov e itens com quantidade)
// e envia para o Resumo de Pedido do app.
(function () {
    "use strict";

    // URL do seu app Friganso ERP (GitHub Pages)
    const APP_URL = "https://TKadachii.github.io/friganso-erp/";

    // ---- Extração dos dados ----

    function textoDaPagina() {
        return (document.body && document.body.innerText) || "";
    }

    // Cliente: pega o código DEPOIS da palavra CLIENTE (evita pegar Local Entrega [f] 0 ou Vendedor)
    function extrairCliente() {
        const body = textoDaPagina();
        let m = body.match(/CLIENTE[\s\S]{0,60}?\[[jf]\]\s*(\d+[a-z]?)\s*-\s*([^\n\r]+)/i);
        if (!m) {
            // fallback: último [j]/[f] com código diferente de 0 e que tenha nome
            const re = /\[[jf]\]\s*(\d+[a-z]?)\s*-\s*([^\n\r]{3,})/ig;
            let mm, melhor = null;
            while ((mm = re.exec(body)) !== null) {
                if (mm[1] !== "0" && /[A-Za-zÀ-Ú]/.test(mm[2])) melhor = mm;
            }
            m = melhor;
        }
        if (m) return { code: m[1].trim(), nome: m[2].trim() };
        return { code: "", nome: "" };
    }

    // SPAmov: número de 6-8 dígitos perto do rótulo "SPAmov"
    function extrairSpamov() {
        const body = textoDaPagina();
        let m = body.match(/SPAmov[\s\S]{0,200}?(\d{6,8})/i);
        if (m) return m[1];
        return "";
    }

    // Orçamento: número do orçamento (para NÃO confundir com produto)
    function extrairOrcamento() {
        const body = textoDaPagina();
        let m = body.match(/Or[çc]amento[\s\S]{0,40}?(\d{6,8})/i);
        if (m) return m[1];
        return "";
    }

    // Acha a tabela de itens (a que tem cabeçalho "Valor Unit." / "Quant. Mov.")
    function acharTabelaItens() {
        const tables = document.querySelectorAll("table");
        for (let i = 0; i < tables.length; i++) {
            const txt = (tables[i].innerText || "").toLowerCase();
            if (txt.indexOf("valor unit") !== -1 || txt.indexOf("quant. mov") !== -1) return tables[i];
        }
        return null;
    }

    // Itens: lê só a tabela de itens — código (sem o nº da linha), nome e quantidade
    function extrairItens(spamov) {
        const raw = [];
        const ignorar = new Set([spamov, extrairOrcamento()].filter(Boolean));
        const tabela = acharTabelaItens();
        const scope = tabela || document;

        // X central da coluna "Quant. Mov.Un." (pelo cabeçalho)
        let colX = null;
        const possiveis = scope.querySelectorAll("td, th");
        for (let i = 0; i < possiveis.length; i++) {
            const t = (possiveis[i].innerText || "").toLowerCase().replace(/\s+/g, " ");
            if (t.indexOf("quant") !== -1 && t.indexOf("mov") !== -1) {
                const r = possiveis[i].getBoundingClientRect();
                if (r.width) { colX = r.left + r.width / 2; break; }
            }
        }

        // Junta todos os campos numéricos INTEIROS visíveis, com posição na tela
        const campos = [];
        const inputs = scope.querySelectorAll("input");
        for (let i = 0; i < inputs.length; i++) {
            const inp = inputs[i];
            const tipo = (inp.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(tipo) !== -1) continue;
            const v = (inp.value || "").trim();
            if (!/^\d+$/.test(v) || parseInt(v, 10) <= 0) continue; // só inteiros > 0
            const r = inp.getBoundingClientRect();
            if (!r.width || !r.height) continue; // ignora invisíveis
            campos.push({ val: parseInt(v, 10), x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }

        const rows = scope.querySelectorAll("tr");
        rows.forEach(function (row) {
            const cells = row.querySelectorAll("td");
            if (!cells.length) return;

            // Código do produto + a célula dele (para saber a linha/posição)
            let rawCode = "", codeCell = null;
            for (let i = 0; i < cells.length; i++) {
                const ct = (cells[i].innerText || "").trim();
                const mm = ct.match(/^(\d{3,7})$/);
                if (mm) { rawCode = mm[1]; codeCell = cells[i]; break; }
            }
            if (!rawCode || ignorar.has(rawCode)) return;

            // Nome do produto: a célula com o maior texto contendo letras
            let nome = "";
            cells.forEach(function (c) {
                const ct = (c.innerText || "").replace(/\s+/g, " ").trim();
                if (/[A-Za-zÀ-Ú]{4,}/.test(ct) && ct.length > nome.length) nome = ct;
            });
            if (!nome || nome.replace(/[^A-Za-zÀ-Ú]/g, "").length < 4) return; // ignora linhas sem nome de produto

            // Quantidade: campo na MESMA LINHA do produto (Y) e na coluna "Quant. Mov.Un." (X).
            // Isso ignora o "1" da linha de novo orçamento (Y diferente) e os campos de estoque (X diferente).
            const rr = (codeCell || row).getBoundingClientRect();
            const prodY = rr.top + rr.height / 2;
            let qty = null, melhor = 1e9;
            campos.forEach(function (c) {
                const dy = Math.abs(c.y - prodY);
                if (dy > 16) return; // tem que estar na mesma linha do produto
                const dx = (colX !== null) ? Math.abs(c.x - colX) : 0;
                const score = dx + dy;
                if (score < melhor) { melhor = score; qty = c.val; }
            });
            if (qty === null) qty = 1;

            raw.push({ rawCode: rawCode, nome: nome, qty: qty });
        });

        // O SPAmov mostra o nº da linha colado no código (1: 0202, 2: 1602, 3: 2701...).
        // Se TODOS os itens começam com o número da sua linha, removemos esse prefixo.
        const temPrefixoLinha = raw.length > 0 && raw.every(function (r, i) {
            const pref = String(i + 1);
            return r.rawCode.indexOf(pref) === 0 && (r.rawCode.length - pref.length) >= 3;
        });

        const itens = [];
        const seen = new Set();
        raw.forEach(function (r, i) {
            let code = r.rawCode;
            if (temPrefixoLinha) code = r.rawCode.slice(String(i + 1).length); // "10202" -> "0202"
            if (!code || seen.has(code)) return;
            seen.add(code);
            itens.push({ code: code, nome: r.nome, qty: r.qty });
        });

        return itens;
    }

    function montarPedido() {
        const cli = extrairCliente();
        const spamov = extrairSpamov();
        const itens = extrairItens(spamov);
        return { cliente: cli.code, clienteNome: cli.nome, spamov: spamov, itens: itens };
    }

    function temPedido(p) {
        return p && (p.cliente || p.spamov || (p.itens && p.itens.length > 0));
    }

    function enviar() {
        const pedido = montarPedido();
        if (!temPedido(pedido) || pedido.itens.length === 0) {
            alert("Não consegui ler o pedido nesta tela.\nAbra um pedido com itens no SPAmov e tente de novo.");
            return;
        }
        const json = JSON.stringify(pedido);
        const b64 = btoa(unescape(encodeURIComponent(json)));
        const url = APP_URL + "?pedidojson=" + encodeURIComponent(b64);
        // Nome fixo da aba: reutiliza a aba do Friganso ERP se já estiver aberta
        const TAB = "friganso_erp_app";
        try {
            const w = (window.top || window).open(url, TAB);
            if (w && w.focus) w.focus();
        } catch (e) {
            window.open(url, TAB);
        }
    }

    // ---- Botão flutuante ----

    // Evita duplicar no mesmo documento
    if (document.getElementById("friganso-erp-btn")) return;
    // Precisa de um body utilizável (framesets não têm)
    if (!document.body || document.body.tagName === "FRAMESET") return;
    // Só mostra o botão no frame que tem o pedido
    if (!temPedido(montarPedido())) return;

    const btn = document.createElement("button");
    btn.id = "friganso-erp-btn";
    btn.type = "button";
    btn.textContent = "📋 Enviar pro Friganso ERP";
    Object.assign(btn.style, {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: "2147483647",
        background: "#e11d48",
        color: "#fff",
        border: "none",
        borderRadius: "12px",
        padding: "12px 18px",
        fontSize: "14px",
        fontWeight: "bold",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
        cursor: "pointer"
    });
    btn.addEventListener("mouseover", function () { btn.style.background = "#be123c"; });
    btn.addEventListener("mouseout", function () { btn.style.background = "#e11d48"; });
    btn.addEventListener("click", enviar);

    document.body.appendChild(btn);
})();
