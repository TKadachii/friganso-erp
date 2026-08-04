# Gera TUDO que a extensão precisa, a partir de extensao/content.js. Rode da raiz do repo:
#     powershell -ExecutionPolicy Bypass -File extensao\gerar-extensao.ps1
#
# ⚠️ ORDEM: rode DEPOIS de já ter bumpado o web-version.json e escrito a entrada nova no CHANGELOG —
# o script LÊ os dois pra montar a versão da extensão. Se rodar antes, o manifest sai com a versão
# anterior. (Rodar de novo depois conserta, é idempotente.)
#
# Existe porque estes três artefatos são gerados À MÃO e já ficaram pra trás antes:
#   - friganso-extensao.zip ficou parado de 25/06 a 03/08 entregando um content.js velho pra quem
#     baixava a extensão pelo site (ver CONTEXTO-DO-PROJETO.md);
#   - a versão do manifest ficou em "2.0.0" pra sempre, então não dava pra saber, olhando o
#     chrome://extensions, se a extensão instalada era a nova ou a antiga;
#   - o friganso.user.js (Tampermonkey) é gerado do mesmo content.js e também precisa acompanhar.
#
# O número do build vem do web-version.json, que já sobe a cada publicação do site — assim a versão
# da extensão anda junto com o site sozinha, sem mais um número pra lembrar de bumpar.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$ext  = Join-Path $repo "extensao"

# ---------- 1) build atual (do site) ----------
$build = (Get-Content (Join-Path $repo "web-version.json") -Raw | ConvertFrom-Json).version
if (-not $build) { throw "Nao consegui ler o build do web-version.json" }

# ---------- 2) versao vX.Y do CHANGELOG (a mesma que aparece na aba Atualizacoes) ----------
$html = [System.IO.File]::ReadAllText((Join-Path $repo "index.html"), [System.Text.UTF8Encoding]::new($false))
$mv = [regex]::Match($html, "const CHANGELOG = \[\s*\{\s*versao:\s*'([0-9]+)\.([0-9]+)\.([0-9]+)'")
if (-not $mv.Success) { throw "Nao achei a versao no topo do CHANGELOG do index.html" }
$maj = $mv.Groups[1].Value; $min = $mv.Groups[2].Value; $pat = $mv.Groups[3].Value

# ---------- 3) manifest: version numerica + version_name legivel ----------
# "version" precisa ser so numeros e pontos (regra do Chrome); o ultimo campo e o build, entao muda
# a cada publicacao. "version_name" e o texto que o Chrome mostra na tela de detalhes da extensao.
$manPath = Join-Path $ext "manifest.json"
$man = [System.IO.File]::ReadAllText($manPath, [System.Text.UTF8Encoding]::new($false))
$novaVersao = "$maj.$min.$build"
$novoNome   = "$maj.$min.$pat - build $build"
$man = [regex]::Replace($man, '"version"\s*:\s*"[^"]*"', '"version": "' + $novaVersao + '"')
if ($man -match '"version_name"\s*:\s*"[^"]*"') {
    $man = [regex]::Replace($man, '"version_name"\s*:\s*"[^"]*"', '"version_name": "' + $novoNome + '"')
} else {
    $man = [regex]::Replace($man, '("version"\s*:\s*"[^"]*",)', '$1' + "`n  " + '"version_name": "' + $novoNome + '",')
}
[System.IO.File]::WriteAllText($manPath, $man, [System.Text.UTF8Encoding]::new($false))

# ---------- 4) friganso.user.js (Tampermonkey) a partir do mesmo content.js ----------
$now = Get-Date
$verUS = "{0}.{1}.{2}.{3:00}{4:00}" -f $now.Year, $now.Month, $now.Day, $now.Hour, $now.Minute
$header = @"
// ==UserScript==
// @name         Friganso ERP - Lancar pedido
// @namespace    friganso-erp
// @version      $verUS
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

"@ -replace "`r`n", "`n"
$shim = @'

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

'@ -replace "`r`n", "`n"
$code = [System.IO.File]::ReadAllText((Join-Path $ext "content.js"), [System.Text.UTF8Encoding]::new($false))
$marker = '"use strict";'
$i = $code.IndexOf($marker)
if ($i -lt 0) { throw "Nao achei 'use strict'; no content.js" }
$code = $code.Substring(0, $i + $marker.Length) + "`n" + $shim + $code.Substring($i + $marker.Length)
[System.IO.File]::WriteAllText((Join-Path $repo "friganso.user.js"), $header + "`n" + $code, [System.Text.UTF8Encoding]::new($false))

# ---------- 5) content.js da raiz (o que o WebUpdater do app baixa) ----------
# ⚠️ A FONTE é o extensao\content.js; o da raiz é CÓPIA. Mas é fácil (já aconteceu em 04/08/2026)
# editar o da raiz por engano e perder tudo aqui, calado. Então: se os dois estiverem diferentes E o
# da raiz for MAIS NOVO, para tudo e avisa, em vez de sobrescrever.
$srcCjs  = Join-Path $ext "content.js"
$raizCjs = Join-Path $repo "content.js"
if (Test-Path $raizCjs) {
    # normaliza a quebra de linha antes de comparar: o git desta maquina converte LF<->CRLF, e sem
    # isso o alerta dispararia por diferenca que nao e de conteudo nenhum
    $a = ([System.IO.File]::ReadAllText($srcCjs,  [System.Text.UTF8Encoding]::new($false))) -replace "`r`n", "`n"
    $b = ([System.IO.File]::ReadAllText($raizCjs, [System.Text.UTF8Encoding]::new($false))) -replace "`r`n", "`n"
    if ($a -ne $b -and (Get-Item $raizCjs).LastWriteTime -gt (Get-Item $srcCjs).LastWriteTime) {
        throw @"
PAREI: o content.js da RAIZ esta diferente e MAIS NOVO que o extensao\content.js.
A fonte e o 'extensao\content.js' -- o da raiz e gerado a partir dele.
Voce provavelmente editou o arquivo errado. Leve as mudancas pro extensao\content.js
(ex.: copy content.js extensao\content.js) e rode de novo.
"@
    }
}
Copy-Item $srcCjs $raizCjs -Force

# ---------- 6) o zip que o site entrega ----------
$arquivos = "content.js","manifest.json","icon16.png","icon48.png","icon128.png","COMO-INSTALAR.txt" |
            ForEach-Object { Join-Path $ext $_ }
Compress-Archive -Path $arquivos -DestinationPath (Join-Path $repo "friganso-extensao.zip") -Force

# ---------- 7) conferencia: o content.js do zip TEM que bater com o da raiz ----------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $repo "friganso-extensao.zip"))
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "content.js" }
    if (-not $entry) { throw "content.js nao entrou no zip!" }
    $sr = New-Object System.IO.StreamReader($entry.Open())
    $doZip = $sr.ReadToEnd(); $sr.Close()
} finally { $zip.Dispose() }
$daRaiz = [System.IO.File]::ReadAllText((Join-Path $repo "content.js"), [System.Text.UTF8Encoding]::new($false))
if ($doZip.Length -ne $daRaiz.Length) { throw "O content.js do zip ficou diferente do da raiz ($($doZip.Length) vs $($daRaiz.Length) bytes)" }

Write-Output "OK - extensao gerada"
Write-Output "  manifest version      : $novaVersao"
Write-Output "  manifest version_name : $novoNome"
Write-Output "  friganso.user.js      : $verUS"
Write-Output "  zip conferido         : content.js identico ao da raiz ($($daRaiz.Length) bytes)"
