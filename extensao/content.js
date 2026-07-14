// Friganso ERP - Extensão (Resumo + Lançar pedido)
(function () {
    "use strict";

    const APP_URL = "https://TKadachii.github.io/friganso-erp/";
    const host = location.hostname || "";

    // ========= PONTE: roda na página do APP (github.io) =========
    if (host.indexOf("github.io") !== -1) {
        // 📥 Se tem uma Tabela de Preços pendente (lida no SPAmov, guardada no chrome.storage pra
        // não estourar o tamanho da URL), entrega ela pro app agora e limpa — só uma vez.
        try {
            chrome.storage.local.get(["friganso_tabela_pendente"], function (r) {
                const pend = r && r.friganso_tabela_pendente;
                if (!pend || !pend.produtos || !pend.produtos.length) return;
                if (Date.now() - (pend.ts || 0) > 10 * 60 * 1000) { chrome.storage.local.remove("friganso_tabela_pendente"); return; } // expira em 10min
                chrome.storage.local.remove("friganso_tabela_pendente");
                try { window.postMessage({ source: "friganso-ext", type: "TABELA_PENDENTE", produtos: pend.produtos }, "*"); } catch (e) {}
            });
        } catch (e) {}
        window.addEventListener("message", function (e) {
            const d = e.data;
            if (!d || d.source !== "friganso-app") return;
            if (d.type === "SET_CREDS") {
                try { chrome.storage.local.set({ friganso_creds: { usuario: d.usuario || "", senha: d.senha || "", autoLogin: !!d.autoLogin, irVendas: !!d.irVendas } }); } catch (err) {}
                return;
            }
            // ⚡ TUDO automático: guarda credenciais (login + ir pra vendas) + pedido pendente
            if (d.type === "LANCAR_AUTO" && d.pedido) {
                try {
                    chrome.storage.local.set({
                        friganso_creds: { usuario: d.usuario || "", senha: d.senha || "", autoLogin: true, irVendas: true },
                        friganso_run_auto: { pedido: d.pedido, ts: Date.now() }
                    }, function () { try { window.postMessage({ source: "friganso-ext", type: "AUTO_SAVED" }, "*"); } catch (e) {} });
                } catch (err) {}
                return;
            }
            let novos = [];
            if (d.type === "LANCAR_PEDIDO" && d.pedido) novos = [d.pedido];
            else if (d.type === "LANCAR_VARIOS" && Array.isArray(d.pedidos)) novos = d.pedidos;
            else return;
            try {
                chrome.storage.local.get(["friganso_fila"], function (r) {
                    const fila = (r && r.friganso_fila) || [];
                    novos.forEach(function (p, i) {
                        fila.push({ id: Date.now() + "_" + i + "_" + Math.floor(Math.random() * 100000), cliente: p.cliente, itens: p.itens, ts: Date.now() });
                    });
                    while (fila.length > 30) fila.shift(); // guarda os últimos 30
                    chrome.storage.local.set({ friganso_fila: fila });
                });
            } catch (err) { /* ignore */ }
        });
        return;
    }

    // ========= SPAMOV: leitura + lançamento =========
    if (host.indexOf("friganso.com.br") === -1) return;

    // 📱 Força largura "de PC" no SPAmov mesmo no celular (no modo mobile a página
    // se espreme e o robô erra a posição dos campos). Roda no documento principal.
    if (window.top === window.self) {
        try {
            var vpFg = document.querySelector('meta[name="viewport"]');
            if (!vpFg) { vpFg = document.createElement("meta"); vpFg.setAttribute("name", "viewport"); (document.head || document.documentElement).appendChild(vpFg); }
            vpFg.setAttribute("content", "width=1280");
        } catch (e) {}
    }

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
    function extrairSpamov() {
        const t = bodyText();
        // número LOGO após o rótulo "SPAmov" (mais preciso; evita pegar limite de crédito/data por engano)
        let m = t.match(/SPAmov\s*(?:n[ºo°.]?\s*|:|-|nº|n°)?\s*(\d{6,8})\b/i);
        if (!m) m = t.match(/SPAmov[\s\S]{0,90}?(\d{6,8})/i); // fallback mais curto que antes (era 200)
        return m ? m[1] : "";
    }
    function extrairOrcamento() { const m = bodyText().match(/Or[çc]amento[\s\S]{0,40}?(\d{6,8})/i); return m ? m[1] : ""; }

    function acharTabelaItens() {
        const tables = document.querySelectorAll("table");
        for (let i = 0; i < tables.length; i++) {
            const txt = (tables[i].innerText || "").toLowerCase();
            if (txt.indexOf("valor unit") !== -1 || txt.indexOf("quant. mov") !== -1) return tables[i];
        }
        return null;
    }
    // 🎯 Acha o X (centro) do CABEÇALHO de uma coluna. O SPAmov aninha tabelas, então existe um <td>
    // container GIGANTE cujo texto contém vários títulos juntos ("...Valor Unit... P.Liq.(KG)...").
    // Por isso pegamos a célula MAIS ESPECÍFICA (texto normalizado mais curto) que casa — assim achamos
    // a célula real do título (ex: "P.Liq.(KG)" em x=1516) e não o container largo (centro ~960).
    // Busca também em <b>/<div> porque às vezes o título não é um <td> direto.
    function colXHeader(scope, teste) {
        const cs = (scope || document).querySelectorAll("td, th, b, div, span, font, nobr");
        let best = null, bestLen = 1e9;
        for (let i = 0; i < cs.length; i++) {
            const t = (cs[i].innerText || cs[i].textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
            if (!t || t.length > 26) continue;            // ignora containers (texto longo) e vazios
            if (!teste(t)) continue;
            const r = cs[i].getBoundingClientRect(); if (!r.width || !r.height) continue;
            if (t.length < bestLen) { bestLen = t.length; best = r.left + r.width / 2; }
        }
        return best;
    }
    function colXQuant(scope) { return colXHeader(scope, function (t) { return t.indexOf("quant") !== -1 && t.indexOf("mov") !== -1; }); }
    // 🟡 Coluna "P.Liq.(KG)" — peso líquido do item, usado pra calcular o Valor da Nota = peso × preço
    function colXPLiq(scope) { return colXHeader(scope, function (t) { return t.indexOf("p.liq") !== -1 || t.indexOf("pliq") !== -1 || (t.indexOf("liq") !== -1 && t.indexOf("kg") !== -1); }); }
    // 💲 Coluna "Valor Unit." — preço por kg que o SPAmov usa (ex: "23,40/PL")
    function colXValor(scope) { return colXHeader(scope, function (t) { return t.indexOf("valor") !== -1 && t.indexOf("unit") !== -1; }); }
    // Converte "80.00" / "80,00" / "1.250,50" -> número (mesma lógica do parsePrice do site)
    function parseNumBR(s) {
        s = String(s || "").trim();
        const m = s.match(/-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/);
        if (!m) return null;
        let x = m[0];
        x = (x.indexOf(".") !== -1 && x.indexOf(",") !== -1) ? x.replace(/\./g, "").replace(",", ".") : x.replace(",", ".");
        const v = parseFloat(x); return isNaN(v) ? null : v;
    }

    function extrairItens(spamov) {
        const raw = [];
        const ignorar = new Set([spamov, extrairOrcamento()].filter(Boolean));
        // 🛑 SÓ extrai itens se achar de verdade a tabela de um PEDIDO (com a coluna "Quant. Mov.").
        // Sem isso, telas que NÃO são pedido (ex.: Lista de Preços — catálogo inteiro, cada linha
        // "código + nome" igual a um item) eram lidas por engano como se fossem os itens do pedido.
        const tabelaAchada = acharTabelaItens();
        if (!tabelaAchada || colXQuant(tabelaAchada) === null) return [];
        const scope = tabelaAchada;
        const colX = colXQuant(scope);
        // 🟡💲 colunas de peso e preço: procura no escopo da tabela e, se não achar, no documento inteiro
        // (o cabeçalho às vezes fica numa tabela "irmã", fora da tabela de itens).
        const colXP = colXPLiq(scope) || colXPLiq(document);
        const colXV = colXValor(scope) || colXValor(document);
        const campos = [];
        scope.querySelectorAll("input").forEach(function (inp) {
            const tipo = (inp.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(tipo) !== -1) return;
            const v = (inp.value || "").trim();
            if (!/^\d+$/.test(v) || parseInt(v, 10) <= 0) return;
            const r = inp.getBoundingClientRect(); if (!r.width || !r.height) return;
            campos.push({ val: parseInt(v, 10), x: r.left + r.width / 2, y: r.top + r.height / 2 });
        });

        // ⚖️💲 Candidatos a PESO (P.Liq.) e PREÇO (Valor Unit.): podem ser <input> (readonly) OU texto numa célula.
        // Guardamos valor + posição na tela pra casar depois por COLUNA (X) e LINHA (Y) — bem mais robusto que
        // depender de o número estar num <td> direto da mesma <tr>.
        const numeros = []; // {val, x, y, dec}  (dec = tem casa decimal -> mais provável ser peso/preço)
        function addNumCand(s, el) {
            const txt = String(s || "").trim();
            if (!/\d/.test(txt) || txt.length > 16) return;
            // aceita "80.00", "23,40", "23,40/PL", "1.250,50"; rejeita coisas tipo "100000016129" (>9 dígitos colados)
            if (/^\d{10,}$/.test(txt.replace(/\D/g, "")) && !/[.,]/.test(txt)) return;
            const v = parseNumBR(txt); if (v === null || v <= 0) return;
            const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
            numeros.push({ val: v, x: r.left + r.width / 2, y: r.top + r.height / 2, dec: /[.,]\d{1,2}\b/.test(txt) });
        }
        document.querySelectorAll("input").forEach(function (inp) {
            const t = (inp.type || "").toLowerCase();
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(t) !== -1) return;
            addNumCand(inp.value, inp);
        });
        // 🔎 Varre QUALQUER elemento-folha com texto (SPAmov é antigo: usa div/font/nobr, não só td).
        document.querySelectorAll("td, th, span, font, b, div, a, p, label, i, small, strong, em, nobr, li").forEach(function (el) {
            if (el.children && el.children.length) return; // só folhas (evita pegar texto de containers)
            addNumCand(el.innerText || el.textContent || "", el);
        });
        // acha o número mais próximo de uma coluna (X) na linha do produto (Y), priorizando os com casa decimal
        function acharNaColuna(colXref, prodY, tolX, tolY) {
            if (colXref === null) return 0;
            const cand = numeros.filter(function (n) { return Math.abs(n.y - prodY) <= (tolY || 20) && Math.abs(n.x - colXref) <= (tolX || 70); });
            cand.sort(function (a, b) { if (a.dec !== b.dec) return a.dec ? -1 : 1; return Math.abs(a.x - colXref) - Math.abs(b.x - colXref); });
            return cand.length ? cand[0].val : 0;
        }
        try { dlog('🔎 peso/preço: colXP=' + colXP + ' colXV=' + colXV + ' candidatos=' + numeros.length); } catch (e) { try { console.log('[FRIG-LER] colXP=' + colXP + ' colXV=' + colXV + ' candidatos=' + numeros.length); } catch (e2) {} }

        scope.querySelectorAll("tr").forEach(function (row) {
            const cells = row.querySelectorAll("td"); if (!cells.length) return;
            let rawCode = "", codeCell = null;
            for (let i = 0; i < cells.length; i++) { const ct = (cells[i].innerText || "").trim(); const mm = ct.match(/^(\d{3,7})$/); if (mm) { rawCode = mm[1]; codeCell = cells[i]; break; } }
            if (!rawCode || ignorar.has(rawCode)) return;
            let nome = "";
            cells.forEach(function (c) { const ct = (c.innerText || "").replace(/\s+/g, " ").trim(); if (/[A-Za-zÀ-Ú]{4,}/.test(ct) && ct.length > nome.length) nome = ct; });
            if (!nome || nome.replace(/[^A-Za-zÀ-Ú]/g, "").length < 4) return;
            // 🚯 rejeita "nome" que na verdade é lixo de script/URL da página (não é produto)
            if (nome.length > 70 || /[{}=;]|\bfunction\b|document\.|\.ajax|https?:|frm_|spa_|timezone|getTimezone|var\s|css\(|position\(|\.hide\(/i.test(nome)) return;
            const rr = (codeCell || row).getBoundingClientRect(); const prodY = rr.top + rr.height / 2;
            let qty = null, melhor = 1e9;
            campos.forEach(function (c) { const dy = Math.abs(c.y - prodY); if (dy > 16) return; const dx = (colX !== null) ? Math.abs(c.x - colX) : 0; const s = dx + dy; if (s < melhor) { melhor = s; qty = c.val; } });
            if (qty === null) qty = 1;
            // ⚖️ Peso (P.Liq. KG) e 💲 Valor Unit. da linha — por POSIÇÃO (coluna X × linha Y), olhando inputs e textos.
            const peso = acharNaColuna(colXP, prodY);
            const valorUnit = acharNaColuna(colXV, prodY);
            try { console.log('[FRIG-LER] linha code=' + rawCode + ' qty=' + qty + ' peso=' + peso + ' valorUnit=' + valorUnit + ' nome="' + nome.slice(0, 50) + '"'); } catch (e) {}
            // 🔬 Se o peso não foi achado, despeja TODOS os números na faixa Y da linha (com X e valor)
            // pra eu calibrar a coluna sem precisar adivinhar o DOM.
            if (!peso) {
                try {
                    const perto = numeros.filter(function (n) { return Math.abs(n.y - prodY) <= 22; })
                        .sort(function (a, b) { return a.x - b.x; })
                        .map(function (n) { return Math.round(n.x) + ":" + n.val; });
                    dlog('🔬 DUMP ' + rawCode + ' (prodY=' + Math.round(prodY) + ' colXP=' + colXP + ' colXV=' + colXV + ') nums[x:val]= ' + perto.join("  "));
                } catch (e) {}
            }
            raw.push({ rawCode: rawCode, nome: nome, qty: qty, peso: peso, valorUnit: valorUnit });
        });
        // Lê o código COMO ESTÁ. (Antes tirava um suposto "prefixo de número de linha", o que
        // quebrava códigos reais — ex: 1443 na linha 1 virava 443. Removido.)
        const itens = [], seen = new Set();
        raw.forEach(function (r) { const code = r.rawCode; if (!code || seen.has(code)) return; seen.add(code); itens.push({ code: code, nome: r.nome, qty: r.qty, peso: r.peso, valorUnit: r.valorUnit }); });
        return itens;
    }
    // 💳 Acha o <select> de "Condição de Pagamento" (achando o rótulo perto e o <select> mais próximo
    // dele em Y) e devolve o texto da opção SELECIONADA (ex.: "21 Dias", "À Vista", "Cartão de Crédito")
    // — não só o value cru do SPAmov, que é só um número interno sem significado por fora ("4").
    // Também devolve TODAS as opções, pra gente montar a tabela de conversão valor→texto no futuro.
    function extrairCondicaoPagamento() {
        try {
            const labels = document.querySelectorAll("b, td, div, span, font");
            let labelY = null;
            for (let i = 0; i < labels.length; i++) {
                if (labels[i].children && labels[i].children.length) continue;
                const t = (labels[i].innerText || labels[i].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                if (t.length > 40) continue;
                if (t.indexOf("condi") !== -1 && t.indexOf("pagamento") !== -1) {
                    const r = labels[i].getBoundingClientRect();
                    if (r.width && r.height) { labelY = r.top; break; }
                }
            }
            if (labelY === null) return null;
            const selects = document.querySelectorAll("select");
            let melhor = null, melhorD = 1e9;
            selects.forEach(function (sel) {
                const r = sel.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const d = Math.abs(r.top - labelY);
                if (d < 40 && d < melhorD) { melhorD = d; melhor = sel; }
            });
            if (!melhor) return null;
            const opt = melhor.options[melhor.selectedIndex];
            const texto = opt ? (opt.textContent || opt.value || "").replace(/\s+/g, " ").trim() : "";
            const opcoes = [];
            for (let i = 0; i < melhor.options.length; i++) {
                opcoes.push({ valor: melhor.options[i].value, texto: (melhor.options[i].textContent || "").replace(/\s+/g, " ").trim() });
            }
            return { valor: melhor.value, texto: texto, opcoes: opcoes };
        } catch (e) { return null; }
    }
    function montarPedidoLeitura() {
        const c = extrairCliente(); const sp = extrairSpamov(); const itens = extrairItens(sp);
        const cond = extrairCondicaoPagamento();
        try { console.log('[FRIG-LER] >>> cliente=' + c.code + ' (' + c.nome + ') | spamov=' + sp + ' | tabela=' + (acharTabelaItens() ? 'achada' : 'NAO achada') + ' | condicaoPagamento=' + (cond ? cond.texto : '(nao achada)') + ' | itens=' + JSON.stringify(itens.map(function (x) { return { c: x.code, q: x.qty, n: (x.nome || '').slice(0, 30) }; }))); } catch (e) {}
        return { cliente: c.code, clienteNome: c.nome, spamov: sp, itens: itens, condicaoPagamento: cond ? cond.texto : '', condicaoPagamentoValor: cond ? cond.valor : '' };
    }
    function temPedidoLeitura(p) { return p && (p.cliente || p.spamov || (p.itens && p.itens.length > 0)); }
    function enviarParaApp() {
        const p = montarPedidoLeitura();
        if (!temPedidoLeitura(p) || p.itens.length === 0) { alert("Não consegui ler o pedido nesta tela."); return; }
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(p))));
        const url = APP_URL + "?pedidojson=" + encodeURIComponent(b64);
        // Celular (toque): abrir aba nova no Firefox costuma ser bloqueado/perdido -> navega a PRÓPRIA aba.
        // Detecta por toque porque no SPAmov a UA está forçada como PC (não dá pra confiar no userAgent/largura).
        const ehCelular = (navigator.maxTouchPoints || 0) > 0;
        if (ehCelular) {
            try { (window.top || window).location.href = url; }
            catch (e) { window.location.href = url; }
            return;
        }
        try { const w = (window.top || window).open(url, "friganso_erp_app"); if (w && w.focus) w.focus(); }
        catch (e) { window.open(url, "friganso_erp_app"); }
    }
    // ================= LISTA DE PREÇOS (catálogo) =================
    // Lê a tela "Lista de Preços" do SPAmov (com.listapreco.spadim) e monta a Tabela do site DIRETO
    // da tela viva — sem precisar exportar/anexar PDF nenhum. A lista inteira fica no DOM mesmo
    // rolada pra fora da tela, então dá pra ler tudo de uma vez sem precisar rolar manualmente.
    function ehTelaListaPrecos() {
        return /listapreco/i.test(location.href) || /lista\s*de\s*pre[çc]os/i.test(document.title || "");
    }
    function extrairListaPrecos() {
        // exige o ponto ("UN.") pra não confundir com a célula de dado "UN" que aparece
        // dentro da coluna "Unidade Preço" (mesmo texto, sem ponto, em várias linhas)
        const colUn = colXHeader(document, function (t) { return /^un\.$/.test(t); });
        const colPeso = colXHeader(document, function (t) { return t.indexOf("peso") !== -1 && t.indexOf("liq") !== -1; });
        const colPecas = colXHeader(document, function (t) { return /^pe[çc]as$/.test(t); });
        const colUnidPreco = colXHeader(document, function (t) { return t.indexOf("unidade") !== -1 && t.indexOf("pre") !== -1; });
        const colEstVenda = colXHeader(document, function (t) { return t.indexOf("est") !== -1 && t.indexOf("venda") !== -1; });
        // 💲 Preços (À Vista, Cartão, 07/14/21/28/30/35/45 dias): em vez de calcular a distância até
        // cada cabeçalho (deu errado repetidas vezes — o valor do Cartão saía no lugar do À Vista mesmo
        // com o cabeçalho certo detectado), agora pega TODOS os números com formato de preço da linha
        // e usa a ORDEM da esquerda pra direita, que é sempre fixa nessa tela do SPAmov.
        const diasCols = [7, 14, 21, 28, 30, 35, 45];

        // coleta TODAS as células-folha com texto e posição (uma vez só)
        // ⚠️ lista de tags igual à do extrairItens() (que já funciona certo em produção) — o preço
        // "à vista" tava saindo trocado pelo do Cartão em TODOS os produtos porque a célula dele
        // provavelmente vem numa tag que faltava aqui (ex.: <a>, célula clicável), então ela sumia
        // da coleta e o "mais perto da coluna X" caía sempre na coluna vizinha (Cartão) por engano.
        const todas = [];
        document.querySelectorAll("td, th, span, font, b, div, a, p, label, i, small, strong, em, nobr, li").forEach(function (el) {
            if (el.children && el.children.length) return;
            const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
            if (!t || t.length > 90) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            todas.push({ x: r.left, y: Math.round(r.top / 4) * 4, t: t });
        });
        // agrupa por linha (Y, com tolerância)
        const porLinha = {};
        todas.forEach(function (c) { if (!porLinha[c.y]) porLinha[c.y] = []; porLinha[c.y].push(c); });

        // limite direito do nome: termina antes da coluna "UN." (se detectada); 1180 é só um fallback
        // pra layouts antigos/sem essa coluna visível.
        const limiteNome = colUn !== null ? colUn - 60 : 1180;

        const produtos = [];
        Object.keys(porLinha).forEach(function (y) {
            const linha = porLinha[y];
            const candCodigo = linha.filter(function (c) { return /^\d{3,7}$/.test(c.t) && c.x < 100; });
            if (!candCodigo.length) return;
            const code = candCodigo[0].t;
            const candNome = linha.filter(function (c) { return c.x >= 100 && c.x < limiteNome && /[A-Za-zÀ-Ú]{3,}/.test(c.t); });
            candNome.sort(function (a, b) { return b.t.length - a.t.length; });
            if (!candNome.length) return;
            const name = candNome[0].t;
            function perto(colX, tol) {
                if (colX === null) return "";
                let melhor = "", melhorD = 1e9;
                linha.forEach(function (c) { const d = Math.abs(c.x - colX); if (d < (tol || 90) && d < melhorD) { melhorD = d; melhor = c.t; } });
                return melhor;
            }
            const tipo = perto(colUn, 90);
            const pesoItem = perto(colPeso, 160);
            const pcsItem = perto(colPecas, 160);
            const unidade = perto(colUnidPreco, 160);
            const kgUn = perto(colEstVenda, 160);
            // 💲 números com CARA de preço (só dígitos + separador + 2 casas — não bate com "1 Kg",
            // "3 Un" nem "12941.8 Kg/253 Un"), na ordem X: [à vista, cartão, 07d, 14d, 21d, 28d, 30d, 35d, 45d]
            const precos = linha
                .filter(function (c) { return /^\d{1,4}[.,]\d{2}$/.test(c.t.trim()); })
                .sort(function (a, b) { return a.x - b.x; })
                .map(function (c) { return parseNumBR(c.t); });
            const originalPrice = precos.length ? precos[0] : null;
            if (originalPrice === null || originalPrice <= 0) return;
            const precoCartao = precos.length > 1 ? precos[1] : null;
            const precosPrazo = {};
            diasCols.forEach(function (n, i) {
                const v = precos[2 + i];
                if (v !== undefined && v !== null) precosPrazo[n] = v;
            });
            produtos.push({ code: code, name: name, tipo: tipo, pesoItem: pesoItem, pcsItem: pcsItem, unidade: unidade, kgUn: kgUn, originalPrice: originalPrice, precoCartao: precoCartao, precosPrazo: precosPrazo });
        });
        return produtos;
    }
    function enviarTabelaParaApp() {
        const produtos = extrairListaPrecos();
        if (!produtos.length) { alert("Não consegui ler a tabela de preços nesta tela."); return; }
        // 🚫 NÃO manda a tabela inteira pela URL — com muitos produtos ela fica gigante e o próprio
        // GitHub Pages/CDN não aguenta (dá "I/O error"). Usa o chrome.storage da extensão (compartilhado
        // entre todas as abas dela, sem limite de tamanho de URL) e navega com uma URL curtinha.
        try {
            if (window.chrome && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ friganso_tabela_pendente: { produtos: produtos, ts: Date.now() } }, function () {
                    const url = APP_URL + "?tabela=pendente";
                    const ehCelular = (navigator.maxTouchPoints || 0) > 0;
                    if (ehCelular) { try { (window.top || window).location.href = url; } catch (e) { window.location.href = url; } return; }
                    try { const w = (window.top || window).open(url, "friganso_erp_app"); if (w && w.focus) w.focus(); }
                    catch (e) { window.open(url, "friganso_erp_app"); }
                });
                return;
            }
        } catch (e) {}
        // Sem chrome.storage disponível (ex.: Tampermonkey sem @grant): volta pro jeito antigo,
        // que só funciona bem com poucos produtos (URL grande demais pode falhar).
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(produtos))));
        const url = APP_URL + "?tabelaJson=" + encodeURIComponent(b64);
        const ehCelular = (navigator.maxTouchPoints || 0) > 0;
        if (ehCelular) {
            try { (window.top || window).location.href = url; } catch (e) { window.location.href = url; }
            return;
        }
        try { const w = (window.top || window).open(url, "friganso_erp_app"); if (w && w.focus) w.focus(); }
        catch (e) { window.open(url, "friganso_erp_app"); }
    }

    // 📲 Botão NATIVO do app (barra de cima): tenta enviar o resumo deste frame; devolve true se conseguiu.
    try {
        window.__frigEnviarSePuder = function () {
            try {
                const p = montarPedidoLeitura();
                if (temPedidoLeitura(p) && p.itens.length > 0) { enviarParaApp(); return true; }
            } catch (e) {}
            return false;
        };
    } catch (e) {}
    // 📲 Dados CRUS deste frame (sem exigir que ESTE frame tenha cliente+SPAmov+itens todos juntos —
    // no SPAmov o cabeçalho [cliente/SPAmov] e a tabela de itens costumam ficar em frames DIFERENTES
    // do frameset). O app agrega os dados de todos os frames antes de decidir se dá pra montar o pedido.
    try {
        window.__frigDadosFrame = function () {
            try {
                const c = extrairCliente(), sp = extrairSpamov(), itens = extrairItens(sp);
                const cond = extrairCondicaoPagamento();
                const bt = bodyText();
                // 🔬 diagnóstico: pra descobrir se ESTE frame chega a ver a tabela de itens ou não
                return {
                    cliente: c.code, clienteNome: c.nome, spamov: sp, itens: itens,
                    condicaoPagamento: cond ? cond.texto : '', condicaoPagamentoValor: cond ? cond.valor : '',
                    _diag: { url: (location.href || '').slice(0, 90), bodyLen: bt.length, temQuantMov: /quant.{0,4}mov/i.test(bt), temPLiq: /p\.?\s*liq/i.test(bt) }
                };
            } catch (e) { return null; }
        };
    } catch (e) {}

    // 🔍 Diagnóstico GERAL deste frame — todo texto curto + posição (X/Y), campos e o que as funções
    // de leitura acham aqui. Usado pelo botão "🔍 Ler Página": junta isso de TODOS os frames, pra você
    // copiar e colar no chat com o Claude quando algo não estiver lendo certo, ou quando quiser pedir
    // uma automação nova baseada no que a página realmente tem.
    window.__frigDiagnostico = function () {
        try {
            if (!document.body || document.body.tagName === "FRAMESET") return { url: (location.href || "").slice(0, 150), frameset: true };
            // ⚠️ SEM limite de quantidade — o diagnóstico agora alimenta a leitura real da Tabela
            // (que precisa da página inteira, ex.: catálogo com centenas de produtos).
            const textos = [];
            document.querySelectorAll("td, th, div, span, font, b, a, label, li, nobr, small, strong").forEach(function (el) {
                // "folha" = sem filhos-elemento, OU só com <br> — antes um <br> descartava a célula, e a
                // coluna DATA (que mostra "13-07-2026<br>21:44:47") sumia inteira do diagnóstico.
                for (var k = 0; k < el.children.length; k++) { if (el.children[k].tagName !== "BR") return; }
                const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                if (!t || t.length > 60) return;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                textos.push({ x: Math.round(r.left), y: Math.round(r.top), t: t, tag: el.tagName });
            });
            // 🏷️ Também captura atributos "title"/tooltip — algumas colunas (como a DATA) mostram o
            // valor só no title (aparece ao passar o mouse), então o texto visível vinha vazio.
            document.querySelectorAll("[title]").forEach(function (el) {
                const tit = (el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
                if (!tit || tit.length > 80) return;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                textos.push({ x: Math.round(r.left), y: Math.round(r.top), t: tit, tag: el.tagName, attr: "title" });
            });
            const campos = [];
            document.querySelectorAll("input, select").forEach(function (el) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                campos.push({ tag: el.tagName, tipo: (el.type || "").toLowerCase(), valor: (el.value || "").slice(0, 40), x: Math.round(r.left), y: Math.round(r.top) });
            });
            let cliente = null, spamov = null, itens = null;
            try { cliente = extrairCliente(); } catch (e) {}
            try { spamov = extrairSpamov(); } catch (e) {}
            try { itens = extrairItens(spamov || ""); } catch (e) {}
            return {
                url: (location.href || "").slice(0, 150), titulo: document.title,
                cliente: cliente, spamov: spamov, itensAchados: itens,
                textos: textos, campos: campos
            };
        } catch (e) { return { erro: String(e && e.message ? e.message : e) }; }
    };

    // Junta o diagnóstico de TODOS os frames, mostra numa caixa pra copiar (e tenta copiar sozinho).
    function gerarDiagnostico() {
        function coletar(w, prof, out) {
            try { if (w.__frigDiagnostico) { const d = w.__frigDiagnostico(); if (d) out.push(Object.assign({ profundidade: prof }, d)); } } catch (e) {}
            try { for (let i = 0; i < w.frames.length; i++) coletar(w.frames[i], prof + 1, out); } catch (e) {}
        }
        const partes = [];
        coletar(window, 0, partes);
        const relatorio = { geradoEm: new Date().toLocaleString("pt-BR"), paginaTop: location.href, totalFrames: partes.length, frames: partes };
        const texto = JSON.stringify(relatorio, null, 1);
        let copiado = false;
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto); copiado = true; } } catch (e) {}
        mostrarDiagnosticoModal(texto, copiado);
    }
    function mostrarDiagnosticoModal(texto, copiado) {
        const old = document.getElementById("friganso-diag-modal"); if (old) old.remove();
        const ov = document.createElement("div");
        ov.id = "friganso-diag-modal";
        Object.assign(ov.style, { position: "fixed", inset: "0", background: "rgba(15,23,42,.7)", zIndex: "2147483647", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif", padding: "16px" });
        ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
        const box = document.createElement("div");
        Object.assign(box.style, { background: "#fff", borderRadius: "14px", padding: "16px", width: "640px", maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 10px 40px rgba(0,0,0,.4)" });
        const titulo = document.createElement("div");
        titulo.textContent = (copiado ? "✅ Copiado! " : "📋 ") + "Cole isso no chat com o Claude";
        Object.assign(titulo.style, { fontWeight: "800", fontSize: "15px", color: "#0f172a", marginBottom: "8px" });
        box.appendChild(titulo);
        const ta = document.createElement("textarea");
        ta.value = texto; ta.readOnly = true;
        Object.assign(ta.style, { flex: "1", minHeight: "300px", fontFamily: "monospace", fontSize: "11px", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "8px", resize: "none", boxSizing: "border-box" });
        box.appendChild(ta);
        const btns = document.createElement("div");
        Object.assign(btns.style, { display: "flex", gap: "8px", marginTop: "10px" });
        const btnCopiar = document.createElement("button");
        btnCopiar.textContent = "📋 Copiar de novo";
        Object.assign(btnCopiar.style, { flex: "1", background: "#e11d48", color: "#fff", border: "none", borderRadius: "8px", padding: "10px", fontWeight: "700", cursor: "pointer" });
        btnCopiar.addEventListener("click", function () {
            ta.focus(); ta.select();
            try { document.execCommand("copy"); } catch (e) {}
            try { navigator.clipboard && navigator.clipboard.writeText(texto); } catch (e) {}
        });
        btns.appendChild(btnCopiar);
        const btnBaixar = document.createElement("button");
        btnBaixar.textContent = "💾 Baixar .txt";
        Object.assign(btnBaixar.style, { flex: "1", background: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", padding: "10px", fontWeight: "700", cursor: "pointer" });
        btnBaixar.addEventListener("click", function () {
            try {
                const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
                const a = document.createElement("a");
                const agora = new Date();
                const nome = "friganso-diagnostico-" + agora.toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".txt";
                a.href = URL.createObjectURL(blob);
                a.download = nome;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            } catch (e) {}
        });
        btns.appendChild(btnBaixar);
        const fechar = document.createElement("button");
        fechar.textContent = "Fechar";
        Object.assign(fechar.style, { background: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", padding: "10px 16px", fontWeight: "700", cursor: "pointer" });
        fechar.addEventListener("click", function () { ov.remove(); });
        btns.appendChild(fechar);
        box.appendChild(btns);
        ov.appendChild(box);
        document.body.appendChild(ov);
        ta.focus(); ta.select();
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

    // ---- Painel de LOG: fica ESCONDIDO atrás de um ícone pequeno (clica pra abrir) ----
    function ensureLogUI() {
        let btn = document.getElementById("friganso-log-btn");
        if (!btn) {
            btn = document.createElement("button");
            btn.id = "friganso-log-btn"; btn.type = "button"; btn.textContent = "🐞"; btn.title = "Log da extensão (clique para abrir/fechar)";
            Object.assign(btn.style, { position: "fixed", left: "10px", bottom: "10px", width: "34px", height: "34px", borderRadius: "50%", border: "1px solid #334155", background: "#0f172a", color: "#fff", fontSize: "15px", cursor: "pointer", zIndex: "2147483647", boxShadow: "0 4px 12px rgba(0,0,0,.35)", padding: "0", lineHeight: "34px", textAlign: "center" });
            btn.addEventListener("click", function () { const p = document.getElementById("friganso-log"); if (p) p.style.display = (p.style.display === "none" ? "block" : "none"); });
            document.body.appendChild(btn);
        }
        let p = document.getElementById("friganso-log");
        if (!p) {
            p = document.createElement("div"); p.id = "friganso-log";
            Object.assign(p.style, { position: "fixed", left: "10px", bottom: "52px", width: "380px", maxWidth: "48vw", maxHeight: "240px", overflowY: "auto", background: "rgba(2,6,23,0.95)", color: "#cbd5e1", fontFamily: "monospace", fontSize: "11px", lineHeight: "1.5", padding: "8px 10px", borderRadius: "10px", zIndex: "2147483647", border: "1px solid #334155", whiteSpace: "pre-wrap", display: "none" });
            document.body.appendChild(p);
        }
        return p;
    }
    function renderLog(linhas) {
        const p = ensureLogUI(); // garante o ícone; o painel começa escondido
        p.textContent = (linhas || []).join("\n");
        p.scrollTop = p.scrollHeight;
    }
    function dlog(msg) {
        const linha = new Date().toLocaleTimeString() + "  " + msg;
        try { console.log("[FRIG] " + linha); } catch (e) {} // surge no log nativo do app
        try {
            chrome.storage.local.get(["friganso_log"], function (r) {
                const arr = (r && r.friganso_log) || [];
                arr.push(linha); while (arr.length > 80) arr.shift();
                chrome.storage.local.set({ friganso_log: arr });
                renderLog(arr);
            });
        } catch (e) { renderLog([linha]); }
    }
    function limparLog() { try { chrome.storage.local.set({ friganso_log: [] }); } catch (e) {} renderLog([]); }
    function mostrarLogSalvo() { try { chrome.storage.local.get(["friganso_log"], function (r) { const a = (r && r.friganso_log) || []; if (a.length) renderLog(a); }); } catch (e) {} }

    function setInput(el, v) {
        try { el.focus(); } catch (e) {}
        var setter = (function () { try { return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; } catch (e) { return null; } })();
        try { if (setter) setter.call(el, String(v)); else el.value = String(v); } catch (e) { try { el.value = String(v); } catch (e2) {} }
        ["input", "change", "keyup", "blur"].forEach(function (t) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} });
    }
    // Digitação ROBUSTA: usa o setter nativo (burla controles que revertem o valor) +
    // tenta document.execCommand("insertText") (digitação real, como um teclado).
    function typeInto(el, texto) {
        const s = String(texto);
        try { el.focus(); el.click(); } catch (e) {}
        const setter = (function () { try { return Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; } catch (e) { return null; } })();
        const setVal = function (v) { try { if (setter) setter.call(el, v); else el.value = v; } catch (e) { try { el.value = v; } catch (e2) {} } };
        setVal("");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        let ok = false;
        try { ok = document.execCommand && document.execCommand("insertText", false, s); } catch (e) {}
        if (!ok || (el.value || "") !== s) {
            setVal("");
            for (let i = 0; i < s.length; i++) {
                const ch = s[i];
                el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
                el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: ch }));
                setVal(s.slice(0, i + 1));
                try { el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" })); } catch (e) { el.dispatchEvent(new Event("input", { bubbles: true })); }
                el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
            }
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function enter(el) { ["keydown", "keypress", "keyup"].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }))); }
    // Força o "saiu do campo" (blur) — no Android o blur sintético não basta, então também tira o foco
    // de verdade e foca outro campo. É isso que faz o SPAmov buscar e mostrar o NOME do cliente.
    function blurDe(el) {
        try {
            ["change", "blur", "focusout"].forEach(function (t) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {} });
            try { if (el.blur) el.blur(); } catch (e) {}
            try {
                var outros = inputsVisiveis().filter(function (i) { return i !== el; });
                if (outros[0] && outros[0].focus) { outros[0].focus(); outros[0].blur && outros[0].blur(); }
                else if (document.body && document.body.focus) { document.body.setAttribute && document.body.setAttribute("tabindex", "-1"); document.body.focus(); }
            } catch (e) {}
        } catch (e) {}
    }
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
        const els = document.querySelectorAll("input[type=button], input[type=submit], input[type=image], button, a, td, span, img");
        for (let i = 0; i < els.length; i++) { const e = els[i]; const t = ((e.value || e.innerText || e.alt || e.title || "") + "").trim(); if (/^enviar$/i.test(t)) { const r = e.getBoundingClientRect(); if (r.width && r.height) return e; } }
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

    // Seleciona "1. Jurídica" (CNPJ) ou "2. Física" (CPF) no dropdown do cliente
    function selecionarTipoPessoa(tipo) {
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const s = selects[i];
            const opts = Array.prototype.slice.call(s.options || []);
            const txt = opts.map(o => o.text).join(" ");
            if (/jur[ií]dica/i.test(txt) && /f[ií]sica/i.test(txt)) {
                const re = (tipo === "fisica") ? /f[ií]sica/i : /jur[ií]dica/i;
                for (let j = 0; j < opts.length; j++) {
                    if (re.test(opts[j].text)) {
                        s.value = opts[j].value; s.selectedIndex = j;
                        s.dispatchEvent(new Event("input", { bubbles: true }));
                        s.dispatchEvent(new Event("change", { bubbles: true }));
                        return opts[j].text.trim();
                    }
                }
            }
        }
        return null;
    }

    // Processa UM item por carregamento da página. O clique no verde recarrega o site
    // e, no próximo load, esta função retoma sozinha do próximo item.
    // Detecta se o pedido já está no estado PA (confirmado)
    function estaEmPA() {
        const t = bodyText();
        if (/\bPA\b\s*Mov/i.test(t)) return true;
        // no estado PA aparece a linha expandida: PCP OE PDE OP PDP CP NF DP FIN
        return /\bPCP\b/.test(t) && /\bPDE\b/.test(t) && /\bFIN\b/.test(t);
    }
    // Acha um elemento clicável (link/imagem/onclick) PERTO de uma referência (o "Mov")
    function clicavelPerto(ref, raio) {
        const rr = ref.getBoundingClientRect(); const cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
        const cands = document.querySelectorAll("a, img, input[type=image], [onclick]");
        let best = null, bd = 1e9;
        for (let i = 0; i < cands.length; i++) {
            const c = cands[i]; if (c === ref) continue;
            const r = c.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            if (d < (raio || 80) && d < bd) { bd = d; best = c; }
        }
        return best;
    }
    // Acha o botão "DS/SP/PA Mov" — é uma IMAGENZINHA. Acha a imagem perto do texto "Mov"/"Orçamento".
    function acharMovBotao() {
        const els = document.querySelectorAll("a, td, div, span, b, img, button");
        let ref = null;
        // 1) referência: texto "DS Mov" / "Mov"
        for (let i = 0; i < els.length; i++) {
            const e = els[i];
            const t = ((e.innerText || e.alt || e.title || "") + "").replace(/\s+/g, " ").trim();
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (/^(DS|SP|PA)\s*Mov$/i.test(t) || /^Mov$/i.test(t)) { ref = e; break; }
        }
        // 2) sem "Mov": usa "Orçamento" como referência (o DS fica logo à esquerda dele)
        if (!ref) {
            for (let i = 0; i < els.length; i++) {
                const e = els[i]; const t = ((e.innerText || "") + "").trim();
                if (/^Or[çc]amento$/i.test(t)) { const r = e.getBoundingClientRect(); if (r.width) { ref = e; break; } }
            }
        }
        if (!ref) return null;
        const rr = ref.getBoundingClientRect(); const cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
        // procura a IMAGEM mais próxima da referência (o badge DS)
        const imgs = document.querySelectorAll("img, input[type=image]");
        let best = null, bd = 1e9;
        for (let i = 0; i < imgs.length; i++) {
            const im = imgs[i]; const r = im.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            if (d < 100 && d < bd) { bd = d; best = im; }
        }
        if (best) return best;
        return clicavelPerto(ref, 100) || ref;
    }
    // Um passo da finalização: se já está em PA, termina; senão clica no DS/SP/PA
    async function finalizarPasso() {
        const run = await getRun();
        if (!run || !run.ativo) return;
        const status = statusBox();
        if (estaEmPA()) { await clearRun(); dlog("✅ chegou em PA — pedido confirmado!"); status("✅ Pedido confirmado (PA)! Tudo pronto. 🎉"); return; }
        const cliques = run.finalCliques || 0;
        if (cliques >= 6) { await clearRun(); dlog("⚠️ 6 cliques sem chegar em PA — parei"); status("⚠️ Não cheguei em PA sozinho. Clique no DS até virar PA na mão."); return; }
        const btn = acharMovBotao();
        dlog("finalizar: DS/SP/PA " + (btn ? ("clicando <" + btn.tagName + " " + ((btn.className || "") + "").slice(0, 30) + " src=" + ((btn.getAttribute && btn.getAttribute("src")) || "-").slice(-20) + ">") : "NÃO achado") + " (clique " + (cliques + 1) + ")");
        if (!btn) { await clearRun(); status("Itens lançados! Não achei o botão DS — clique nele até virar PA na mão."); return; }
        status("Confirmando (DS → SP → PA): clique " + (cliques + 1) + "...");
        await setRun({ pedido: run.pedido, stage: "finalizar", idx: run.idx, ativo: true, aguardando: false, ultimoCode: "", finalCliques: cliques + 1, ts: Date.now() });
        clicar(btn);
        // a página recarrega; no próximo load o finalizar continua
    }

    async function processarRun() {
      try {
        const run = await getRun();
        if (!run || !run.ativo) { return; }
        if (!ehFramePrincipal()) { dlog("(frame ignorado — sem UI do SPAmov)"); return; }
        // ⏳ 8 min sem progresso (era 2min) — cada item recarrega a página inteira do SPAmov, e com
        // internet lenta isso pode demorar bem mais que 2min; 2min descartava o pedido todo no meio do
        // lançamento (itens que ainda faltavam ficavam pra trás sem aviso nenhum).
        if (Date.now() - (run.ts || 0) > 8 * 60 * 1000) { await clearRun(); dlog("⏰ expirou (8min sem progresso) — limpei"); return; }

        const status = statusBox();
        const stage = run.stage || "itens";
        dlog("➡ etapa=" + stage + " idx=" + run.idx + " aguardando=" + run.aguardando);
        const nomeEtapa = stage === "novo" ? "abrir Novo" : (stage === "cliente" ? "preencher Cliente" : (stage === "finalizar" ? "confirmar (DS→SP→PA)" : "lançar Itens"));
        status("🔄 Retomando — etapa: " + nomeEtapa + "...");
        await sleep(1800); // deixa a página assentar após o "pisca"/navegação

        // ETAPA FINAL: clicar DS -> SP -> PA até confirmar o pedido
        if (stage === "finalizar") { await clearRun(); status("✅ Itens lançados! Clique no DP/finalizar você mesmo. 👍"); return; } // DS→SP→PA desativado a pedido

        // ETAPA 1: clicar em "Novo"
        if (stage === "novo") {
            let btn = acharBotaoNovo(), t = 0;
            while (!btn && t < 8) { await sleep(500); btn = acharBotaoNovo(); t++; }
            if (!btn) { dlog("❌ botão Novo NÃO achado"); if (ehFramePrincipal()) status("❌ Não achei o botão 'Novo'."); return; }
            dlog("✓ botão Novo achado — clicando");
            status("Abrindo novo pedido...");
            await setRun({ pedido: run.pedido, stage: "cliente", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() });
            clicar(btn);
            return; // a página vai recarregar e a etapa "cliente" continua sozinha no próximo load
        }

        // ETAPA 2: preencher o cliente e clicar em "Enviar"
        if (stage === "cliente") {
            status("Aguardando a tela do cliente...");
            await sleep(1000); // ⏱️ folga após o "Novo" (a tela termina de abrir e foca o campo)
            // Seleciona Jurídica (CNPJ) ou Física (CPF) ANTES de digitar o ID
            const tipo = run.pedido.tipoPessoa || "juridica";
            const tipoSel = selecionarTipoPessoa(tipo);
            dlog("tipo pessoa: " + tipo + " -> " + (tipoSel || "select NÃO achado"));
            await sleep(600);
            // acha o campo do ID (após mudar o tipo, o foco pode ter saído do campo)
            let cli = acharCampoCliente();
            if (!cli) { const ae = document.activeElement; if (ae && ae.tagName === "INPUT" && ae.type !== "checkbox" && ae.type !== "radio") cli = ae; }
            dlog("campo cliente: " + (cli ? "achado" : "NÃO achado"));
            if (!cli) { if (ehFramePrincipal()) status("❌ Não achei o campo do Cliente."); return; }
            status("Digitando cliente " + run.pedido.cliente + "...");
            typeInto(cli, run.pedido.cliente);   // digitação robusta (native setter + execCommand)
            dlog("valor no campo após digitar: '" + (cli.value || "") + "'");
            // 🔑 dispara o "saiu do campo" pra o SPAmov buscar e MOSTRAR o nome do cliente (AJAX).
            // No Android isso só acontecia quando o usuário tocava na tela; agora forçamos no robô.
            const antesNome = bodyText();
            blurDe(cli);
            enter(cli);
            status("Buscando o nome do cliente " + run.pedido.cliente + "...");
            const apareceu = await esperar(function () { return bodyText() !== antesNome; }, 8000); // espera o nome aparecer (o corpo muda)
            await sleep(900); // folga extra pro AJAX assentar
            dlog("nome do cliente: " + (apareceu ? "apareceu (corpo mudou)" : "NÃO mudou — segui mesmo assim"));
            await setRun({ pedido: run.pedido, stage: "itens", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() });
            let env = acharBotaoEnviar(), te = 0;
            while (!env && te < 8) { await sleep(400); env = acharBotaoEnviar(); te++; }
            dlog("botão Enviar: " + (env ? "achado — clicando" : "NÃO achado (tento Enter)"));
            if (env) { status("Clicando em Enviar..."); clicar(env); }
            else { status("Botão Enviar não achado — tentando Enter..."); enter(cli); }
            return; // recarrega -> a etapa "itens" continua sozinha no próximo load
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
            dlog("✓ todos os " + total + " itens lançados — PRONTO (agora você confere e clica no DP)");
            await clearRun();
            status("✅ Itens lançados! Agora confira e clique no DP/finalizar você mesmo. 👍");
            return;
        }

        // garante a linha de entrada pronta
        let info = camposEntrada(), tent = 0;
        while ((!info || !info.code || !info.qty) && tent < 12) { await sleep(500); info = camposEntrada(); tent++; }
        if (!info || !info.code || !info.qty) { dlog("campos do item ainda não prontos (inputs: " + (info ? info.n : 0) + ") — aguardo e tento de novo"); status("Aguardando os campos do item... (pode deixar, não precisa tocar na tela)"); return; } // não cancela: sobrevive a toques/navegação; expira sozinho em 2min se travar

        const it = run.pedido.itens[run.idx];
        dlog("item " + (run.idx + 1) + "/" + total + ": " + it.code + " x" + it.qty);
        status("Lançando " + (run.idx + 1) + "/" + total + ":  " + it.code + "  x" + it.qty);

        // 1) código -> resolve o produto (com blur forçado, igual ao cliente, pro Android)
        const antesCod = bodyText();
        setInput(info.code, "");
        setInput(info.code, it.code);
        blurDe(info.code);
        enter(info.code);
        await esperar(function () { return bodyText() !== antesCod; }, 6000);
        await sleep(900);

        // 2) quantidade (ignora o campo de valor)
        info = camposEntrada();
        if (info && info.qty) setInput(info.qty, it.qty);
        await sleep(400);

        // 3) salva o avanço ANTES de clicar (a página vai recarregar)
        await setRun({ pedido: run.pedido, stage: "itens", idx: run.idx + 1, ativo: true, aguardando: true, ultimoCode: it.code, ts: Date.now() });

        // 4) clica no ✓ verde -> o site recarrega e o próximo item continua sozinho
        const check = acharCheckVerde(info ? info.rect : linhaEntradaRect());
        dlog("✓ verde: " + (check ? "achado — clicando" : "NÃO achado (Enter)"));
        if (check) clicar(check);
        else if (info && info.qty) enter(info.qty);
        status("✓ " + it.code + " enviado — aguardando o site recarregar...");
        // a página recarrega ("pisca") e o próximo item continua sozinho no próximo load
      } catch (e) { dlog("❌ ERRO: " + (e && e.message ? e.message : e)); }
    }

    function removerDaFila(id) {
        chrome.storage.local.get(["friganso_fila"], function (r) {
            const fila = ((r && r.friganso_fila) || []).filter(function (x) { return x.id !== id; });
            chrome.storage.local.set({ friganso_fila: fila });
        });
    }
    function lancarDaFila(p) {
        // NÃO remove da fila — fica salvo pra você reusar/reenviar (remova manualmente com ✕)
        limparLog();
        dlog("▶ INÍCIO — cliente " + (p.cliente || "?") + ", " + (p.itens ? p.itens.length : 0) + " itens");
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

    // ---------- LOGIN AUTOMÁTICO ----------
    function acharCampoPorLabel(re, tipo) {
        let labelRect = null;
        const cells = document.querySelectorAll("td, th, label, span, div, b, font");
        for (let i = 0; i < cells.length; i++) {
            const t = (cells[i].innerText || "").trim();
            if (re.test(t) && t.length < 28) { const r = cells[i].getBoundingClientRect(); if (r.width && r.height) { labelRect = r; break; } }
        }
        if (!labelRect) return null;
        const cy = labelRect.top + labelRect.height / 2;
        const inps = Array.prototype.slice.call(document.querySelectorAll("input")).filter(function (inp) {
            const tp = (inp.type || "text").toLowerCase();
            if (tipo && tp !== tipo) return false;
            if (["checkbox", "radio", "hidden", "button", "submit", "image"].indexOf(tp) !== -1) return false;
            const r = inp.getBoundingClientRect();
            return r.width > 20 && r.height > 5 && Math.abs((r.top + r.height / 2) - cy) < 18 && r.left >= labelRect.left;
        });
        inps.sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
        return inps[0] || null;
    }
    function acharBotaoTextoExato(re) {
        const els = document.querySelectorAll("input[type=button], input[type=submit], button, a");
        for (let i = 0; i < els.length; i++) { const e = els[i]; const t = ((e.value || e.innerText || "") + "").trim(); if (re.test(t)) { const r = e.getBoundingClientRect(); if (r.width && r.height) return e; } }
        return null;
    }
    function tentarLogin() {
        try {
            chrome.storage.local.get(["friganso_creds"], function (c) {
                const cr = c && c.friganso_creds;
                if (!cr || !cr.autoLogin) return;
                if (!document.querySelector("input[type=password]")) return; // não é a tela de login
                chrome.storage.local.set({ friganso_creds: { usuario: cr.usuario, senha: cr.senha, autoLogin: false, irVendas: cr.irVendas } }); // evita loop, mantém o ir-pra-vendas
                const userInput = acharCampoPorLabel(/Usu[áa]rio/i, "text") || document.querySelector("input[type=text]");
                const passInput = acharCampoPorLabel(/Senha/i, "password") || document.querySelector("input[type=password]");
                dlog("login: campo usuário " + (userInput ? "ok" : "?") + ", senha " + (passInput ? "ok" : "?"));
                if (userInput && cr.usuario) typeInto(userInput, cr.usuario);
                if (passInput && cr.senha) typeInto(passInput, cr.senha);
                setTimeout(function () {
                    const b = acharBotaoTextoExato(/^Log\s*In$/i);
                    dlog("login: botão Log In " + (b ? "achado — clicando" : "NÃO achado"));
                    if (b) clicar(b);
                }, 700);
            });
        } catch (e) {}
    }

    // ---------- NAVEGAR NO MENU (SPA mov -> VENDAS - VENDEDOR) ----------
    // Roda um código no CONTEXTO da página (necessário para javascript: e funções do site)
    function rodarNaPagina(code) {
        try {
            const s = document.createElement("script");
            s.textContent = code;
            (document.head || document.documentElement).appendChild(s);
            if (s.parentNode) s.parentNode.removeChild(s);
            return true;
        } catch (e) { return false; }
    }
    // Aciona UMA VEZ: se tem onclick/javascript:, roda na página (1x); senão dá 1 clique nativo.
    // (não usa o clicar() normal aqui pra NÃO disparar a ação 2x e "destogglar" o menu)
    function clicarRobusto(el) {
        if (!el) return;
        let p = el, code = null;
        for (let i = 0; i < 4 && p; i++) {
            const oc = p.getAttribute && p.getAttribute("onclick");
            const hr = p.getAttribute && p.getAttribute("href");
            if (oc) { code = oc; break; }
            if (hr && /^javascript:/i.test(hr)) { code = hr.replace(/^javascript:/i, ""); break; }
            p = p.parentElement;
        }
        if (code) { rodarNaPagina("try{" + code + "}catch(e){}"); }
        else { try { el.focus && el.focus(); } catch (e) {} try { el.click(); } catch (e) {} }
    }
    function acharLinkTexto(re) {
        const els = document.querySelectorAll("a, td, span, div, b, font, li");
        for (let i = 0; i < els.length; i++) {
            const e = els[i]; const t = ((e.innerText || "") + "").replace(/\s+/g, " ").trim();
            if (re.test(t) && t.length < 30) { const r = e.getBoundingClientRect(); if (r.width && r.height) return e; }
        }
        return null;
    }
    function acharPorHrefOnclick(sub) {
        const els = document.querySelectorAll("a, [onclick]");
        for (let i = 0; i < els.length; i++) {
            const e = els[i]; const h = ((e.getAttribute("href") || "") + " " + (e.getAttribute("onclick") || "")).toLowerCase();
            if (h.indexOf(sub.toLowerCase()) !== -1) { const r = e.getBoundingClientRect(); if (r.width && r.height) return e; }
        }
        return null;
    }
    function forcarVisivel(el) {
        if (!el) return;
        try { el.style.display = "block"; el.style.visibility = "visible"; el.removeAttribute("hidden"); } catch (e) {}
    }
    // Acha o link "VENDAS - VENDEDOR" (prioriza <a>, depois href de vendedor/spadim)
    function acharLinkVendas() {
        const as = document.querySelectorAll("a");
        for (let i = 0; i < as.length; i++) { const a = as[i]; const t = ((a.innerText || "") + "").replace(/\s+/g, " ").trim(); if (/VENDAS\s*-\s*VENDEDOR/i.test(t)) { const r = a.getBoundingClientRect(); if (r.width && r.height) return a; } }
        for (let i = 0; i < as.length; i++) { const a = as[i]; const h = ((a.getAttribute("href") || "") + " " + (a.getAttribute("onclick") || "")).toLowerCase(); if (/vendedorexterno|spa\.vended|vended/.test(h)) { const r = a.getBoundingClientRect(); if (r.width && r.height) return a; } }
        return acharLinkTexto(/VENDAS\s*-\s*VENDEDOR/i);
    }
    function tentarNavegarVendas() {
        try {
            chrome.storage.local.get(["friganso_creds"], function (c) {
                const cr = c && c.friganso_creds;
                if (!cr || !cr.irVendas) return;
                if (document.querySelector("input[type=password]")) return; // ainda na tela de login
                const span = document.getElementById("spamov");
                const spamovLink = acharPorHrefOnclick("spamov") || acharLinkTexto(/^SPA\s*mov$/i);
                const jaTemVendas = acharLinkTexto(/VENDAS\s*-\s*VENDEDOR/i);
                if (!span && !spamovLink && !jaTemVendas) return; // ainda não é a tela de menu
                chrome.storage.local.set({ friganso_creds: { usuario: cr.usuario, senha: cr.senha, autoLogin: false, irVendas: false } });
                dlog("menu: span#spamov=" + (span ? "ok" : "?") + " linkSPAmov=" + (spamovLink ? "ok" : "?"));
                // força o submenu visível (mais confiável que depender da função do site)
                forcarVisivel(span);
                if (!span && spamovLink) clicarRobusto(spamovLink); // sem o span, tenta a função
                let tentou = 0;
                const iv = setInterval(function () {
                    tentou++;
                    forcarVisivel(document.getElementById("spamov")); // mantém aberto
                    const v = acharLinkVendas();
                    if (v) {
                        dlog("menu: clicando VENDAS - VENDEDOR <" + v.tagName + ">");
                        try { v.focus && v.focus(); } catch (e) {}
                        try { v.click(); } catch (e) {}          // clique NATIVO (navega / executa javascript:)
                        clearInterval(iv);
                    } else if (tentou > 40) { clearInterval(iv); dlog("menu: VENDAS - VENDEDOR não apareceu (manda o log)"); }  // ~16s (era ~6.4s)
                }, 400);
            });
        } catch (e) { dlog("menu ERRO: " + (e && e.message)); }
    }

    // ⚡ Dispara o lançamento sozinho quando chega na tela de vendas (após login + navegação)
    function tentarIniciarAuto() {
        try {
            chrome.storage.local.get(["friganso_run_auto", "friganso_run"], function (r) {
                const auto = r && r.friganso_run_auto;
                if (!auto || !auto.pedido) return;
                // ⏳ 15 min (era 5) — internet lenta pode fazer login+navegação demorar bem mais que isso,
                // e o pedido inteiro era descartado em silêncio se passasse do prazo antigo.
                if (Date.now() - (auto.ts || 0) > 15 * 60 * 1000) { chrome.storage.local.remove("friganso_run_auto"); return; }
                if (r.friganso_run && r.friganso_run.ativo) return;          // já tem lançamento rolando
                if (document.querySelector("input[type=password]")) return;  // ainda na tela de login
                let t = 0;
                const iv = setInterval(function () {
                    t++;
                    if (document.querySelector("input[type=password]")) { clearInterval(iv); return; }
                    const novo = acharBotaoNovo();
                    if (novo) {
                        clearInterval(iv);
                        chrome.storage.local.get(["friganso_run", "friganso_run_auto"], function (r2) {
                            if (r2.friganso_run && r2.friganso_run.ativo) return;   // outro frame já começou
                            if (!r2.friganso_run_auto) return;                       // já foi consumido
                            chrome.storage.local.remove("friganso_run_auto");
                            limparLog();
                            dlog("🤖 auto: tela de vendas pronta — lançando cliente " + (auto.pedido.cliente || "?") + " (" + (auto.pedido.itens ? auto.pedido.itens.length : 0) + " itens)");
                            statusBox()("🤖 Lançando automático: cliente " + (auto.pedido.cliente || "?") + "...");
                            setRun({ pedido: auto.pedido, stage: "novo", idx: 0, ativo: true, aguardando: false, ultimoCode: "", ts: Date.now() }).then(processarRun);
                        });
                    } else if (t > 60) { clearInterval(iv); }  // ~30s (era ~10s) esperando a tela de vendas neste load
                }, 500);
            });
        } catch (e) {}
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

    const temLeitura = temPedidoLeitura(montarPedidoLeitura());

    if (ehFramePrincipal()) {
        botao("friganso-lancar-btn", "🚀 Lançar pedido", "#15803d", "120px", abrirPopupFila);
        botao("friganso-cancelar-btn", "⏹ Cancelar lançamento", "#64748b", "70px", cancelarLancamento);
    }
    if (temLeitura) botao("friganso-erp-btn", "📋 Enviar pro Friganso ERP", "#e11d48", "18px", enviarParaApp);
    // 🔍 "Ler Página": disponível em QUALQUER tela do SPAmov (não só pedido), pra usar como ferramenta
    // de exploração — ex.: Lista de Preços, Histórico, etc. — na hora de criar uma automação nova.
    botao("friganso-diag-btn", "🔍 Ler Página", "#0f172a", "170px", gerarDiagnostico);
    // 📥 Atualizar Tabela: só na tela "Lista de Preços" — lê o catálogo inteiro direto da tela
    // (sem precisar de PDF) e manda pro site, que atualiza a Tabela de Preços sozinho.
    if (ehTelaListaPrecos()) botao("friganso-tabela-btn", "📥 Atualizar Tabela do Site", "#7c3aed", "220px", enviarTabelaParaApp);

    // Mostra o log salvo (passo a passo que sobrevive aos recarregamentos)
    if (ehFramePrincipal()) mostrarLogSalvo();
    // Retoma automaticamente um lançamento em andamento (após cada reload do site)
    if (ehFramePrincipal()) processarRun();
    // Login automático (se solicitado pelo Debug e estivermos na tela de login)
    tentarLogin();
    // Após logar, navega: SPA mov -> VENDAS - VENDEDOR
    tentarNavegarVendas();
    // ⚡ Se houver pedido pendente "automático", dispara o lançamento ao chegar na tela de vendas
    tentarIniciarAuto();
})();
