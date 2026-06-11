// Gera friganso.user.js (Tampermonkey/Firefox) a partir do content.js da extensão.
// Assim NÃO mantemos dois códigos: o userscript é sempre gerado do mesmo content.js.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "content.js");
const OUT = path.join(__dirname, "..", "friganso-app", "friganso.user.js");

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const version = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}.${pad(now.getHours())}${pad(now.getMinutes())}`;

const header = `// ==UserScript==
// @name         Friganso ERP - Lancar pedido
// @namespace    friganso-erp
// @version      ${version}
// @description  Le e lanca pedidos no SPAmov direto pelo app Friganso (funciona no celular via Firefox + Tampermonkey).
// @author       Friganso
// @match        https://tkadachii.github.io/*
// @match        *://*.friganso.com.br/*
// @match        *://spd1.friganso.com.br/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @downloadURL  https://tkadachii.github.io/friganso-erp/friganso.user.js
// @updateURL    https://tkadachii.github.io/friganso-erp/friganso.user.js
// ==/UserScript==
`;

// Shim: emula chrome.storage.local usando o armazenamento do Tampermonkey (GM_*),
// que e compartilhado entre o app (github.io) e o SPAmov (friganso.com.br) — igual a extensao.
const shim = `
    // ---- shim chrome.storage.local sobre GM_* (Firefox/Tampermonkey) ----
    var chrome = (typeof window !== "undefined" && window.chrome && window.chrome.storage && window.chrome.storage.local) ? window.chrome : {
        storage: { local: {
            get: function (keys, cb) {
                var out = {}; var arr = Array.isArray(keys) ? keys : [keys];
                for (var i = 0; i < arr.length; i++) { var v; try { v = GM_getValue(arr[i], undefined); } catch (e) { v = undefined; } if (v !== undefined && v !== null) out[arr[i]] = v; }
                if (cb) cb(out);
            },
            set: function (obj, cb) {
                for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { try { GM_setValue(k, obj[k]); } catch (e) {} } }
                if (cb) cb();
            },
            remove: function (keys, cb) {
                var arr = Array.isArray(keys) ? keys : [keys];
                for (var i = 0; i < arr.length; i++) { try { GM_deleteValue(arr[i]); } catch (e) {} }
                if (cb) cb();
            }
        } }
    };
`;

let code = fs.readFileSync(SRC, "utf8");

// Insere o shim logo apos o primeiro "use strict";
const marker = '"use strict";';
const i = code.indexOf(marker);
if (i === -1) { console.error("ERRO: nao achei \"use strict\"; no content.js"); process.exit(1); }
code = code.slice(0, i + marker.length) + "\n" + shim + code.slice(i + marker.length);

fs.writeFileSync(OUT, header + "\n" + code, "utf8");
console.log("OK -> " + OUT + "  (versao " + version + ")");
