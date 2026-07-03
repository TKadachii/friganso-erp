# 🧠 CONTEXTO DO PROJETO — Friganso ERP

> Este arquivo é o "cérebro compartilhado" entre os PCs. Ao começar a trabalhar em qualquer
> computador, abra o Claude Code na pasta do projeto e diga: **"leia o CONTEXTO-DO-PROJETO.md"**.
> Mantenha-o atualizado (peça ao Claude pra atualizar quando algo mudar de verdade).

## O que é
Friganso ERP — sistema de vendas (distribuidora de carnes). Um mesmo código React roda em 4 lugares:
- **Site** (GitHub Pages): https://tkadachii.github.io/friganso-erp/ — repo: https://github.com/TKadachii/friganso-erp.git
- **PWA** (site instalável, offline via service worker)
- **Programa de PC** (Electron) — pasta local `friganso-desktop`
- **App Android** (Capacitor) — pasta local `friganso-mobile` → gera `FrigansoERP.apk`

Tudo num único `index.html` (React 18 via CDN + Babel no navegador + Tailwind + Firebase Firestore).
Trechos só-PC são protegidos por `if (isElectron)`, e só-app por `if (isCapacitor)`.

## ⚠️ Regra de trabalho (IMPORTANTE)
A cada mudança, **publicar SÓ o site** (commit + push do `friganso-app`). **NÃO** recompilar o
programa de PC nem gerar o APK a cada mudança. Quando o usuário pedir **"atualizar"**, aí sim:
rodar `precompile.js` (PC), gerar o APK, e entregar o "dossiê" (APK novo + reabrir o programa + resumo).

## Estrutura (pastas locais — NÃO estão todas no git)
- `friganso-app/` → **está no GitHub** (é o site). Arquivos: `index.html` (tudo), `sw.js` (cache, versão `friganso-vNN`), `manifest.json`, `icon.svg`.
- `friganso-desktop/` → Electron (local). `main.js`, `preload.js`, `content.js` (automação SPAmov), `precompile.js` (gera `index-compiled.html`), `icon.ico`.
- `friganso-mobile/` → Capacitor/Android (local). `android/`, `www/`, `content.js`, scripts de teste de PDF.
- ⚠️ Só o `friganso-app` está versionado no GitHub. Pra trabalhar no PC/app no outro computador,
  precisaria levar essas pastas também (ver "Continuidade" abaixo).

## Como publicar o site (fluxo padrão)
```
cd friganso-app
# editar index.html (e bump do sw.js: friganso-vNN -> NN+1)
# ⚠️ TAMBÉM bumpar web-version.json pro MESMO número (ver "Auto-atualização do APK" abaixo,
#    senão o app do celular nunca fica sabendo que tem conteúdo novo pra baixar sozinho)
git add index.html sw.js web-version.json
git commit -m "..."
git push origin main
```
Ver no navegador: Ctrl+Shift+R. O HTML é network-first no SW, então chega rápido.

## 📲 Auto-atualização do conteúdo do APP (desde a v6/2.4 — 2026-07-03, estilo Discord)
O app checa sozinho ao abrir (tela "🦢 Atualizando...") se `web-version.json` no site tem um
número maior que o já salvo no aparelho; se tiver, baixa `index.html` + `content.js` do site pra
uma pasta gravável do app (`WebUpdater.java`) e troca o que a WebView carrega via
`Bridge.setServerBasePath()` do Capacitor — **sem passar pelo navegador, sem instalar nada**.
`SpamovActivity` também passou a ler o `content.js` baixado (se existir) em vez do fixo no APK,
então correções de automação também se beneficiam.

**Isso cobre a MAIORIA do que a gente muda (index.html/content.js).** Só publicar o site (fluxo
acima, lembrando de bumpar `web-version.json`) já é suficiente — o app se atualiza sozinho na
próxima vez que abrir, sem precisar de "atualizar"/gerar APK.

**Quando ainda precisa de APK novo (raro):** só quando a mudança é em código NATIVO Java
(`MainActivity.java`, `SpamovActivity.java`, `SpamovAuto.java`, `ZapBolha.java`, `AndroidManifest.xml`,
`build.gradle` — novo plugin, nova permissão, etc.). Isso é uma trava de segurança do próprio
Android: nenhum app fora da Play Store consegue trocar código nativo sem o usuário confirmar a
instalação. Nesses casos, segue o fluxo de "atualizar" normal abaixo E também bump o `versionCode`/
`versionName` do `build.gradle` + `apk-version.json` (esse é o mecanismo ANTIGO, que mostra o modal
"🚀 Atualização disponível" pedindo pra baixar/instalar — mantido só pra esses casos raros).

## Como gerar PC + APK (só quando o usuário pedir "atualizar")
Toolchain: **JDK 21** (`C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot`), **Android SDK 36**
(`%LOCALAPPDATA%\Android\Sdk`).
```
Copy index.html -> friganso-desktop\index.html
cd friganso-desktop && node precompile.js              (gera index-compiled.html p/ Electron)
Copy index-compiled.html -> friganso-mobile\www\index.html
cd friganso-mobile && npx cap copy android
cd android && .\gradlew.bat assembleDebug --no-daemon  (gera o APK)
APK -> friganso-mobile\android\app\build\outputs\apk\debug\app-debug.apk  (cópia em Downloads\FrigansoERP.apk)
```
Programa de PC: lê `index-compiled.html`; basta reabrir pelo atalho.

## ⚠️ Lição aprendida: NÃO mexer manualmente em insets/status bar no MainActivity
O **Capacitor 8** (`@capacitor/android`) já registra sozinho um plugin nativo chamado
**`SystemBars`** (`Bridge.registerAllPlugins()` faz isso automaticamente, sem precisar
configurar nada) que cuida da área segura (status bar/notch/nav bar) — ele escuta os insets
no **pai** da WebView e aplica padding ou expõe `env(safe-area-inset-*)` via CSS (o
`index.html` já tem `viewport-fit=cover` no `<meta viewport>`, então o modo CSS moderno já
funciona quando o WebView suporta). **Em 2026-07-03 um ajuste manual foi adicionado no
`MainActivity` (listener de insets na própria WebView) achando que resolveria um problema de
layout — na verdade CRIOU um conflito** (dois listeners competindo pelos mesmos insets) que
piorou o bug (app "invadindo" as duas barras do sistema). Foi revertido — `MainActivity`
**não deve** ter nenhum código de insets/`WindowInsetsCompat`/`setStatusBarColor` etc. Se
aparecer um bug parecido de novo, a causa provavelmente é outra (ex: o WebView da versão do
Android do aparelho ser mais antigo que o `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`/140 usado pelo
Capacitor internamente) — investigar `node_modules/@capacitor/android/.../SystemBars.java`
antes de tentar mexer nisso de novo.

## 📲 Auto-atualização do APK (desde a v2 — 2026-07-01)
O app checa atualização sozinho ao abrir (estilo Discord): chama `SpamovAuto.versao()` (versionCode
nativo) e compara com `https://tkadachii.github.io/friganso-erp/apk-version.json`. Se o remoto for
maior → modal "🚀 Atualização disponível" → `SpamovAuto.abrirLink(url)` abre o navegador que baixa
`https://tkadachii.github.io/friganso-erp/FrigansoERP.apk` → instala por cima (⚠️ mesma assinatura
debug DESTE PC; não buildar noutro PC senão não instala por cima).

**Publicar APK novo (nunca mais mandar pro WhatsApp):**
1. Bump `versionCode`/`versionName` no `friganso-mobile/android/app/build.gradle`.
2. Fluxo de build acima (precompile → www → cap copy → assembleDebug).
3. Copiar o APK pra `Downloads\FrigansoERP.apk`, `G:\Meu Drive\Friganso APK\` **e `friganso-app/FrigansoERP.apk`**.
4. Atualizar `friganso-app/apk-version.json` (mesmo versionCode + novidades) e commitar/pushar
   junto com o APK — todos os celulares avisam sozinhos na próxima abertura do app.

Extras da v2: botões nativos **📋 ERP** e **🚀** na barra de cima do SpamovActivity (os botões da
página ficam fora da tela no celular por causa da largura de PC); `content.js` expõe
`window.__frigEnviarSePuder` por frame pro botão nativo funcionar.

## ⚠️ Bug crítico corrigido (v3/2.1 — 2026-07-01): `precompile.js` corrompia PC/APK
`precompile.js` injetava o código compilado no HTML com `html.replace(regex, \`<script>${result.code}</script>\`)`
— **string** como substituto. `String.replace()` interpreta padrões especiais dentro da string de
substituto: `$&`, `` $` ``, `$'`, `$$`, `$<nome>`. O código-fonte tinha a string `'R$'` (label do
gráfico de faturamento) — o app termina exatamente em `` $' `` (dólar + aspas), que o `replace()` leu
como "insira aqui o resto do arquivo depois do match" → duplicou/corrompeu o HTML, o `<script>`
principal nunca terminava de rodar, e o app abria mostrando só texto puro (código JS visível na tela).
**Isso NUNCA afeta o site** (o site usa Babel ao vivo no navegador, sem passar por `precompile.js`) —
só afeta **PC (Electron)** e **APK**, e só aparece quando o código tem uma string terminando em `$'`,
`` $` `` etc. (fácil de acontecer com preços em R$). Fix definitivo: usar **função** como substituto
— `.replace(regex, () => \`<script>${result.code}</script>\`)` — funções não sofrem interpretação de
`$`-patterns. Já corrigido em `friganso-desktop/precompile.js`. **Antes de qualquer "atualizar"**,
depois de rodar `precompile.js`, verificar `(Select-String index-compiled.html -Pattern '</body>').Count`
deve ser **1** (se vier 2+, o arquivo está corrompido de novo).

## Recursos já feitos (resumo)
- Login por código+senha (Google bloqueia OAuth em webview → no app/PC escondido; conta sem senha
  é obrigada a criar uma). Botão "Alterar senha" no perfil.
- Tabela de Preços lê PDF (pdf.js) por POSIÇÃO X das colunas (código x~33, nome x~70, tipo x~311,
  peso x~333, peças x~382, kg/un x~465, preço x~545). Junta a janela y±6 (nome/colunas "transbordam").
- Comparação de preço entre tabelas (persistente) + botões "Comparar com anterior" / "Comparar com a nuvem".
- Disparos WhatsApp: categorias (Por produto, 📉 Abaixou de preço, etc.). No PC envia pela busca interna
  do WhatsApp embutido (sem recarregar). No app Android: balão flutuante (overlay) que abre cada cliente.
- Automação SPAmov: PC (Electron webview) e App (plugin nativo SpamovAuto, user-agent de PC, injeta content.js).
- Aba 🎨 Temas: Auto/Claro/Escuro/Sakura/Oceano/Esmeralda (window.aplicarTema + localStorage friganso_tema).
  Sakura ativa sozinho em 21 e 27 de junho no modo "auto".

## 🐞 PENDENTE / em investigação
- **Bug do preço 00,00 no PDF `2206.pdf`**: vários itens vieram R$ 0,00. Ex.: código **13291**
  (correto = 30,63). Causa descoberta: NESSE PDF as colunas estão em posições X **diferentes** das
  outras tabelas (ex.: tipo ~208, preço ~535 com texto quebrado tipo "30 6" em vez de "30.63"; os
  números vêm partidos por espaços). O parser atual usa faixas de X fixas e não casa. Próximo passo:
  tornar a leitura das colunas robusta a layouts diferentes (detectar colunas dinamicamente, e juntar
  dígitos partidos). Ver scripts `friganso-mobile\dump2206.js` e `testfull.js` pra inspecionar o PDF.

## Continuidade entre PCs
- Conversa do Claude: fica local em `~/.claude/projects/<hash-do-caminho>/*.jsonl`. Não sincroniza
  sozinha. Pra retomar no mesmo PC: `claude --resume`.
- Pra "cérebro" compartilhado: este arquivo (vai junto no `git pull`).
- Export legível da conversa: `Downloads\Conversa-Friganso.html` (gerado por `friganso-mobile\exportar-conversa.js`).
