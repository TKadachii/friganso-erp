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

## 🔄 Atualização OBRIGATÓRIA do site/PWA/PC (desde 2026-07-04) — MAIS UM NÚMERO PRA BUMPAR
`APP_BUILD_VERSION` (const no topo do `index.html`, perto de `isCapacitor`) PRECISA bater com o
`version` do `web-version.json` a cada publicação — se esquecer de bumpar o `APP_BUILD_VERSION` pro
MESMO número, o app vai ficar preso num loop de "atualização disponível" pra sempre (porque depois de
atualizar, a versão embutida na página continua menor que a do `web-version.json`). O app checa a cada
3 min (+ toda vez que a aba volta a ficar visível) e, se a remota for maior, trava a tela com
`SiteUpdateModal` (sem botão de fechar) até clicar em "Atualizar agora" (que desregistra o Service
Worker, limpa o Cache Storage e recarrega — equivalente a um Ctrl+Shift+R). NÃO roda no app Android
(Capacitor), que já tem seu próprio OTA silencioso via `WebUpdater` nativo.

## 🔄 Changelog (aba "Atualizações", desde 2026-07-04) — ATUALIZAR SEMPRE
Toda entrega (site/extensão/app/PC) precisa ganhar uma entrada nova no array `CHANGELOG` do
`index.html` (perto de `CreditsScreen`). Versionamento estilo Steam, vX.Y.Z:
- **Z** (patch): correções/microajustes — soma 1 a cada fix.
- **Y** (minor): feature nova — soma 1 e ZERA o Z. Se Z chegasse a 100, também soma 1 no Y (e zera Z).
- **X** (major): só sobe quando o Y passaria de 9 — soma 1 no X e ZERA o Y.
- Exemplo do usuário: v1.12.124 (bruto, sem carry) vira v2.3.24 depois do carry (Z 124→24 carrega +1
  pro Y; Y 12+1=13→3 carrega +1 pro X; X 1+1=2).
- Cada entrada tem `{ versao, data, areas: ['site'|'app'|'extensao'|'pc'], itens: [...] }` — mais
  recente primeiro (topo do array). `v1.0.0` é a "linha de base" pra tudo que existia antes desse
  histórico começar a ser registrado.

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
# ⚠️ Se mexeu no content.js (automação SPAmov), TAMBÉM copiar pra RAIZ do site:
#    cp friganso-desktop/content.js friganso-app/content.js
#    (o WebUpdater do app baixa de https://tkadachii.github.io/friganso-erp/content.js —
#    NÃO de /extensao/content.js. Esquecer isso faz o app nunca receber correções de
#    automação via auto-atualização, só o index.html. Descoberto em 2026-07-03.)
git add index.html sw.js web-version.json content.js
git commit -m "..."
git push origin main
```

### ⚠️ Mexeu no `content.js`? REGENERE O ZIP DA EXTENSÃO (descoberto em 2026-08-03)
O `content.js` mora em **3 lugares** no repo, e o zip é o único que NÃO se atualiza sozinho:
1. `content.js` (raiz) — o que o `WebUpdater` do app baixa;
2. `extensao/content.js` — a pasta-fonte da extensão;
3. **`friganso-extensao.zip`** — ⚠️ **artefato gerado À MÃO**, é o que o botão de download do site entrega.

O zip ficou **parado em 25/06 até 03/08**: o `content.js` de dentro dele era o de 56 KB enquanto o de
verdade já estava em 111 KB. Quem baixava a extensão pelo site recebia uma versão de mais de um mês
atrás, sem `precoCartao`/`precosPrazo`/`extrairCondicaoPagamento` nem a leitura da Lista de Preços —
por isso a extensão "parou de pegar os preços do produto direto do site". O `friganso.user.js`
(Tampermonkey) é gerado por `extensao/gerar-userscript.js` e estava OK; só o zip ficou pra trás.

**Desde 04/08/2026 isso virou um comando só** (da raiz do repo), que faz tudo e ainda confere:
```powershell
powershell -ExecutionPolicy Bypass -File extensao\gerar-extensao.ps1
```
Ele grava a versão no `manifest.json`, gera o `friganso.user.js`, copia o `content.js` pra raiz, monta
o `friganso-extensao.zip` e **falha** se o `content.js` de dentro do zip não bater com o da raiz.
⚠️ Rode DEPOIS de bumpar o `web-version.json` e de escrever a entrada nova no `CHANGELOG` — o script
lê os dois pra montar a versão da extensão.

**Versão da extensão (desde 04/08/2026):** ficava fixa em `2.0.0`, então não dava pra saber pelo
`chrome://extensions` se a extensão instalada era a nova. Agora o manifest sai com
`"version": "<maj>.<min>.<build>"` e `"version_name": "<versão do CHANGELOG> - build <build>"`
(ex.: `2.10.1 - build 166`), com o build vindo do `web-version.json`. Pra conferir se o usuário está
com a extensão certa: o build do `chrome://extensions` tem que bater com o da aba Atualizações.

E avisar o usuário — **extensão instalada por pasta não se atualiza sozinha**: precisa baixar de novo,
trocar os arquivos e clicar em 🔄 "Atualizar" em `chrome://extensions`.
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

## 💳 Regra de preço por forma de pagamento (2026-07-04 — só REGISTRADA, ainda não aplicada no Resumo)
Quando fecha com o cliente, ele escolhe uma de 4 formas de pagamento, cada uma com uma regra de
desconto diferente:
- **À Vista** (dinheiro/PIX): pode vender o preço à vista da tabela com **até 3% de desconto** (regra
  de sempre, `checkDiscountRules`).
- **Cartão**: tem que cobrar o **preço de cartão** (`precoCartao`, vindo da Lista de Preços) — **sem
  desconto**, fixo.
- **A Prazo** (prazo único — cliente escolhe pagar tudo em 7/14/21/28/30/35/45 dias): mesma regra do
  à vista — pode vender o preço à vista com até 3% de desconto (o preço de prazo da tabela do SPAmov,
  `precosPrazo[dias]`, é só referência/catálogo, não é obrigatório cobrar ele).
- **A Prazo Parcelado** (divide a compra em pedacinhos pagos em prazos diferentes, ex.: uma parte em
  7 dias, outra em 14, outra em 21...): o máximo que dá pra vender é o **preço à vista, sem desconto**.

Já implementado: filtro "Forma de pagamento" na Tabela (tela PdfScreen), com 3 colunas de preço —
"Tabela (modo)" (puro, sem regra, muda com o filtro), "À Vista" (fixo, sempre o preço à vista bruto) e
"À Vista c/ desc." (até 3%, só pra À Vista/A Prazo — vazio pra Cartão/Parcelado). Funções
`precoTabelaModo`/`precoComDesconto` no index.html.

**Também implementado (2026-07-04): captura + histórico + aviso no Resumo.** `extrairCondicaoPagamento()`
no content.js acha o `<select>` de "Condição de Pagamento" na tela do pedido do SPAmov (perto do rótulo,
por posição Y) e devolve o TEXTO da opção selecionada (ex.: "21 Dias"), não só o value cru ("4", sem
significado fora do SPAmov). Isso vai junto no `montarPedidoLeitura()` (botão "📋 Enviar pro Friganso
ERP", extensão/PC) e no `window.__frigDadosFrame()` + `enviarResumoTopo()` (app mobile, `SpamovActivity.
java` — MEXEU EM JAVA, precisa de um novo APK pra valer no celular). No site: `registrarCompra` salva
`condicaoPagamento` em cada compra; `normalizarCondicaoPagamento()` reduz o texto cru pra uma de 4
categorias (avista/cartao/prazo/outro — "parcelado" não existe como opção no SPAmov, é um arranjo manual
do vendedor, nunca detectado sozinho); `condicaoDominanteCliente()` conta o histórico de um cliente e
acha a condição mais frequente. No ResumoScreen: mostra um badge com a condição do pedido atual + o
histórico do cliente, e no clique de "Copiar Resumo" (se o cliente já tem 3+ compras registradas e a
condição atual destoa da dominante) pergunta com `window.confirm` antes de salvar/copiar.

## ⚠️ Lição aprendida (2026-07-04): extração dos 9 preços da Lista de Preços — usar ORDEM, não distância
Tentei 3 vezes consertar o preço "à vista" saindo trocado pelo do "Cartão" usando o método de sempre
(achar o cabeçalho da coluna com `colXHeader` e pegar o texto mais PRÓXIMO em X) — tolerância errada,
depois tag faltando no seletor, depois mais tags ainda. Nenhuma bateu com o que o usuário via na tela,
mesmo com o diagnóstico (que grava a tag de cada célula) provando que tanto o preço à vista quanto o de
cartão são `<td>` normais, sem nada de especial. A causa real nunca foi confirmada, mas o método de
"distância até o cabeçalho" se provou frágil demais pra essa tela (9 colunas de preço bem coladas).
**Solução que funcionou**: abandonar a distância e usar a ORDEM DOS NÚMEROS na linha. As 9 colunas de
preço sempre aparecem na mesma ordem da esquerda pra direita (À Vista, Cartão, 07d, 14d, 21d, 28d, 30d,
35d, 45d) — então basta pegar todo texto da linha que tem CARA de preço (regex `^\d{1,4}[.,]\d{2}$`,
que não bate com "1 Kg"/"3 Un"/"12941.8 Kg/253 Un") e usar a posição (1º = à vista, 2º = cartão, resto
= prazos, nessa ordem), sem precisar achar cabeçalho nenhum pra essas colunas. Validado contra 3
diagnósticos reais completos (737-741 produtos) antes de publicar. Lição: quando um método baseado em
"achar a coisa mais próxima de X" falha repetidas vezes sem explicação clara, e a ORDEM dos elementos é
previsível, prefira extrair por ORDEM em vez de por DISTÂNCIA.

## 📋 Fila de Pedidos (2026-08-04, v2.12.x)
O vendedor lança MUITOS pedidos seguidos. Antes cada leitura pulava direto pro app, então ele ficava
indo e voltando site→app→site o dia todo. Agora o botão vermelho **soma o pedido numa fila** (contador
no próprio botão) e ele segue no SPAmov; **"✅ Finalizar e abrir o app"** entrega tudo de uma vez.
SHIFT+clique mantém o jeito antigo (pedido avulso direto pro Resumo).

- Fila no `chrome.storage` (`friganso_fila_pedidos`), com queda pro `localStorage` no Tampermonkey.
- **Reler a mesma tela ATUALIZA** o pedido em vez de duplicar. ⚠️ O registro é `{ pedido, ts }` — o
  SPAmov está em `x.pedido.spamov`, NÃO em `x.spamov` (esse foi um bug pego no teste antes de subir).
- Na `FilaScreen`, "Conferir" carrega o pedido no **Resumo normal** (`friganso_pedido_json` +
  rota `resumo`). É de propósito: só o Resumo sabe aplicar preço da Tabela do Dia, desconto de 3% e
  condição de pagamento. Ao tocar em "Copiar Resumo", o texto pronto volta pra fila (`FILA_ATIVA`),
  o item é marcado como feito e a tela volta pra fila. **Nunca recalcular preço em dois lugares.**
- 🎈 "Abrir balão" reusa o **mesmo plugin nativo `ZapBolha`** dos Disparos, passando **uma entrada por
  pedido** (mesmo telefone, mensagens diferentes) — então funciona no APK que já está instalado, sem
  precisar de app novo (o projeto Android e a debug.keystore se perderam na formatação).

⚠️ **Lição de entrega (2026-08-04):** a fila chegava vazia no app. A entrega via
`chrome.storage` + `postMessage` depende do `content.js` estar VIVO na aba do app — e ele morre quando
a extensão é recarregada ("Extension context invalidated"); como o `window.open` reaproveita a aba pelo
nome, caía numa aba órfã e sumia sem erro. Além disso havia corrida de tempo: a tela montava, lia o
`sessionStorage` vazio e desistia antes da mensagem chegar. **Conserto:** a tela **PEDE** a fila
(`PEDIR_FILA` → o `content.js` responde com a entrega pendente ou com a fila de trabalho parada) e
**continua ouvindo** depois de montada; sobra ainda um botão manual "Buscar fila que ficou no site".
Considerei trocar a entrega pra URL (`?filaJson=`), mas medindo com pedido real (6 itens, nomes longos)
só cabem ~6 pedidos em 6 KB — não resolve quem faz muitos pedidos, então **ficou no chrome.storage**.

## 👥 Cadastro de clientes lido do SPAmov (2026-08-04, v2.10.0)
Botão **"👥 Atualizar Clientes do Site"** na tela **Procura de Pessoas** (`system.spadim`), mesmo
padrão da Lista de Preços: `extrairClientes()` → `chrome.storage` → `APP_URL + "?clientes=pendente"`
→ ponte posta `CLIENTES_PENDENTE` → `sessionStorage.friganso_clientes_json` → rota `clients`.

Traz nome, CNPJ/CPF, endereço completo, telefone, status e **limite/saldo de crédito**.

- **Mapeamento por X EXATO** (folga de 2px) contra o X da coluna do cabeçalho — nessa tela o
  alinhamento é perfeito (conferido: 788 células, 60 clientes, zero desalinhamento), então NÃO usa
  "achar o mais próximo". O cabeçalho é achado por CONTEÚDO ("Nome / Razão Social" + "CNPF / CNPJ"),
  então sobrevive a reordenar/trocar as colunas do relatório.
- O ID vem como `[j] 48016` (`j` = jurídica, `f` = física) — o mesmo formato que a importação por
  planilha do site já entendia.
- No site cai no **mesmo preview** da planilha (`importPreview` na `ClientsScreen`), com
  `importOrigem: 'spamov'`. Quem já existe é **completado**, não ignorado: preenche só o que está
  VAZIO (cnpj/phone/address) e atualiza limite/saldo/status, que são do SPAmov por natureza. Nunca
  sobrescreve o que foi editado à mão. A importação por planilha segue com o comportamento antigo.
- ⚠️ O preview **espera o `onSnapshot` do Firestore responder** (`clientesCarregados`) antes de
  montar — senão todo mundo apareceria como "novo" e criaria cliente duplicado.
- ⚠️ A tela **não informa o total** de pessoas, só "De: 1 à N". O usuário tem **~60 clientes e o
  campo "Pessoas por Página" vem com 60** — ou seja, um aviso simples de paginação dispararia toda
  vez, e quando o cadastro passasse de 60 ele perderia gente sem perceber (o número sobe e desce
  sempre). Por isso, quando o tanto lido bate exatamente com o limite da página, o botão se oferece
  pra **pôr 1000 no campo e clicar em "Procurar" sozinho** — aí é só clicar no botão de novo. O campo
  e o botão são achados pelo **rótulo** ("Pessoas por Página") e pelo **value** ("Procurar"), nunca
  por X fixo; se algum dos dois não for encontrado, cai num alerta explicando o passo manual.
- Dado sujo conhecido: o município vem escrito de formas diferentes no SPAmov ("Armação dos Búzios",
  "Armacao dos Buzios", "Armação dos Buzios"; "São Pedro da Aldeia" vs "sao Pedro da Aldeia").
  Guardado **como veio** — se um dia for agrupar/filtrar por cidade, normalizar na hora de exibir.

## ⚠️ Lição aprendida (2026-08-03): posição X FIXA quebra a leitura — ancore numa coluna vizinha
Continuação direta da lição de 04/07. `extrairListaPrecos()` achava o nome do produto com
`c.x >= 100` — número fixo herdado de um layout antigo. Na tela real de Lista de Preços o **código
fica em x=6 e o nome em x=75**, então nenhum nome passava no filtro; como linha sem nome é
descartada, **767 linhas de produto viravam 0** e o botão só dizia "Não consegui ler a tabela de
preços nesta tela" — enquanto o código e os 9 preços já eram lidos perfeitamente. Sintoma enganoso:
parecia que a leitura de preço tinha quebrado, mas o que falhava era o NOME.

Conserto: o limite esquerdo do nome passou a ser o **X da própria célula do código**
(`c.x > celCodigo.x`), que se ajusta sozinho a qualquer largura de tela. Regra geral pro `content.js`:
**nunca ancore em pixel absoluto** — ancore no código/cabeçalho vizinho, ou use a ORDEM das colunas.
O `limiteNome` já fazia certo (`colUn - 60`, derivado do cabeçalho "UN.").

Como diagnosticar isso rápido: botão **🔍 Ler Página** → 💾 Baixar .txt → o JSON traz `textos[]` com
`{x, y, t}` de cada célula de todos os frames. Dá pra reproduzir o filtro em cima desse arquivo e ver
exatamente qual etapa zera. Foi assim que caiu de "não lê" pra causa exata em minutos.

⚠️ Detalhe conhecido: o cabeçalho **"Peças" não é encontrado** por `colXHeader` nessa tela, então
`pcsItem` sai vazio. Não impede a leitura (o campo é só informativo) — mas se um dia precisar do
número de peças, é aí que está o problema.

## 🎯 Prospecção em Massa / Leads (2026-08-13, v2.14.0)
Tela `LeadsScreen` (rota `leads`) pra **aumentar a carteira** abordando muito estabelecimento pelo
WhatsApp. Importa uma planilha de empresas, filtra, e dispara.

**De onde vêm os dados — a descoberta que definiu a arquitetura:** o CNPJ.biz e o Casa dos Dados
**não têm base própria**, os dois revendem o arquivo público da Receita Federal
(`dadosabertos.rfb.gov.br`). O telefone e o email que eles mostram são os campos `telefone_1` e
`correio_eletronico` da tabela ESTABELECIMENTOS. Ou seja: dá pra ter os mesmos dados de graça, e em
massa, em vez de um CNPJ por vez.

**Por que NÃO é API ao vivo** (decidido, não esquecer): o site é estático no GitHub Pages, então
qualquer chave de API ficaria visível no `index.html`, e o proxy pra escondê-la exigiria **Firebase
Blaze (pago)**. A importação única resolve sem custo recorrente, sem CORS, e ainda funciona offline
no app e no PC. A exceção é a **BrasilAPI** (`buscarCnpjNaReceita`, já usada na Consulta CNPJ): não
tem chave, então pode ser chamada direto do navegador — serve pra ENRIQUECER 1 CNPJ, não pra
descobrir leads.

- **Firestore `leads`**, com o **CNPJ como id do documento** (chave natural). O import usa `merge`,
  então **reimportar a mesma lista ATUALIZA em vez de duplicar** e nunca apaga o status de quem já
  foi abordado. Lotes de 400 (o limite do Firestore é 500).
- **Colunas achadas pelo NOME do cabeçalho**, nunca por posição fixa — mesma lição da Lista de Preços
  e do cadastro do SPAmov. Testado contra 4 formatos reais (Casa dos Dados, base da Receita,
  CNPJ.biz e planilha mínima); todos leem. Se a fonte mudar a ordem das colunas, continua lendo.
- ⚠️ **Filtro "só com celular" é o coração da tela.** Celular = 9 dígitos começando com 9 (fixo tem 8).
  Em empresa pequena — restaurante, mercadinho, açougue — o telefone do cadastro da Receita costuma
  ser o **celular do próprio dono**, então esse filtro é o que separa contato útil de telefone de
  recado. Confirmado com caso real (restaurante em Búzios: celular + Gmail pessoal da dona).
- Email **de contador** (`contab|escritorio|assessoria|fiscal`) é só SINALIZADO em âmbar, não
  descartado — nesse segmento o email costuma ser pessoal mesmo.
- **Cruza com a carteira** por CNPJ (exato) e por nome normalizado, pra esconder quem já é cliente.
- 🎈 O disparo reusa o **MESMO plugin nativo `ZapBolha`** dos Disparos e da Fila — funciona no APK que
  já está instalado, **sem precisar de app novo**. No PC usa o WhatsApp embutido (`window.__frigZap`)
  com **respiro regulável** entre envios: disparo rápido pra número desconhecido derruba a linha, e
  perder o número derruba junto os Disparos da carteira.
- Botão **"📋 Pro cadastro"** joga o lead pros `cadastros_processo` (funil que já existia) sem
  redigitar nada. **"🔍 Atualizar"** consulta a BrasilAPI e traz situação cadastral/contato frescos.
- Lista **🚫 Não perturbe** (`naoPerturbe: true`): some da prospecção pra sempre. Prospecção B2B se
  apoia no legítimo interesse da LGPD (art. 7º, IX), mas o opt-out precisa existir e ser respeitado.
### 🛠️ `ferramentas/gerar-leads.js` — o gerador da lista (2026-08-13)
Script Node (roda no PC, não no site) que baixa a base aberta da Receita e cospe o CSV pronto pra
importar na tela. **De graça e repetível** — o export do Casa dos Dados custa ~R$0,01/CNPJ *toda vez*
que você quiser atualizar; o script custa só o download. Ver `ferramentas/README.md`.

`node ferramentas\gerar-leads.js` → `leads-friganso.csv`. Flags: `--so-celular`, `--com-inativas`,
`--razao`, `--pasta AAAA-MM`, `--saida`, `--manter-zips`. Cidades/CNAEs/UF se configuram em
maiúsculas no topo do arquivo.

⚠️ **As pegadinhas do formato da Receita** (é o que quebra quem tenta na mão — já resolvidas):
1. Os CSVs **não têm cabeçalho**: colunas POSICIONAIS (aqui a ORDEM é o contrato, ao contrário da
   planilha do usuário, que é lida pelo NOME).
2. Encoding **ISO-8859-1**, não UTF-8 — ler como UTF-8 estraga todo acento.
3. Separador `;`, campos entre aspas, aspas internas dobradas.
4. **Município e CNAE vêm como CÓDIGO** — precisa das tabelas `Municipios.zip` e `Cnaes.zip`.
5. **DDD numa coluna separada** do número (`ddd_1` + `telefone_1`).
6. Situação ATIVA é o código `02`.
7. ⚠️ **Razão Social NÃO está em ESTABELECIMENTOS** — mora em EMPRESAS, ligada por `cnpj_basico`.
   Por isso `--razao` é opcional: dobra o download. Sem ela vem só o Nome Fantasia.

O download é de ~2,5 GB em 10 partes, mas o script **apaga cada parte depois de filtrar**, então
basta ~2 GB livres. Se cair a internet, rodar de novo reaproveita o que já baixou.

- ✅ Testado: `node ferramentas\teste-gerar-leads.js` roda a regra de negócio inteira com dados
  falsos no formato exato da Receita, **sem baixar nada**. O teste lê os detectores de coluna
  direto do `index.html`, então quebra de propósito se alguém mexer neles e perder a
  compatibilidade entre o script e a tela.
- ⚠️ **Falta a planilha**: a tela está pronta e vazia até rodar o gerador (ou importar um export
  do Casa dos Dados — a tela aceita os dois).
- ⚠️ **A URL da Receita muda de lugar**: o script descobre sozinho a pasta `AAAA-MM` mais nova
  listando o diretório. Se a Receita mudar a estrutura do site, cai no `--pasta AAAA-MM` manual.

## 🤖 Envio automático pelo SITE, via extensão (2026-08-13, v2.15.0)
O "🤖 Enviar todos sozinho" existia só no programa de PC, que tem o WhatsApp embutido numa
`<webview>` e consegue controlá-la. **No site um script NÃO pode clicar dentro do web.whatsapp.com**
(origens diferentes) — mas a EXTENSÃO pode, porque roda dentro da página.

Fluxo: o site entrega a lista pronta (`postMessage` `ZAP_CAMPANHA` → `chrome.storage`), abre o
`web.whatsapp.com`, e o `content.js` que roda lá dentro dispara um por um. Vale nos Disparos e na
Prospecção em Massa.

- ⚠️ Navega por URL (`/send?phone=..&text=..`), o que **RECARREGA a página a cada envio** — então o
  estado NÃO pode viver em memória, vive todo no `chrome.storage`. É mais lento que mexer na busca
  interna do WhatsApp (jeito do PC), mas não depende de adivinhar a navegação interna do app.
- O site **espera o ACK** (`ZAP_CAMPANHA_OK`) antes de abrir a aba: sem isso, quem não tem a
  extensão veria o WhatsApp abrir e nada acontecer, sem pista do motivo.
- O painel **não começa sozinho** — mostra "Iniciar envio" e espera o clique.
- ⚠️ **Trava de top-frame**: o manifesto usa `all_frames`, e sem ela cada iframe do WhatsApp montaria
  um painel e todos disputariam o mesmo envio.
- Número inválido é detectado pelo texto da página e marcado como falhou, em vez de segurar a fila
  os 18s do timeout.
- ✅ `ferramentas/teste-zap-automatico.js` roda num Chromium de verdade (Playwright) contra um
  servidor que finge ser o WhatsApp Web. Pula sozinho se o playwright não estiver instalado.

## 🏆 Disparos: oferta os produtos que o cliente MAIS compra (2026-08-13, v2.16.0)
Escolhendo 2/3/4/5 produtos, o app rodiziava (janela que anda por hash da data). Agora ranqueia pelo
histórico real: **1º em quantos PEDIDOS o produto apareceu, 2º o total de kg, 3º o mais recente.**

⚠️ **O `client.history` NÃO serve pra isso**: ele é desduplicado (`[...new Set(...)]`), então guarda
QUAIS produtos o cliente compra mas perde QUANTAS VEZES. A frequência real só existe na coleção
`purchases`, um documento por pedido. Quem usar o `history` acha que funcionou e entrega errado.

Frequência ganha do volume **de propósito**: item comprado em 4 pedidos vale mais que outro de 200 kg
comprado em 2 — numa oferta o que interessa é o hábito. O rodízio segue no botão "🔁 Variar a cada
dia", e cliente sem compra registrada cai nele sozinho.
Funções puras `montarRankCompras` / `ordenarPelosMaisComprados`. ✅ `ferramentas/teste-ranking-ofertas.js`.

## 🔒 PDF de mudanças de preço: sem dados pessoais (2026-08-13, v2.16.1)
O rodapé saía com `nome - whatsapp` do vendedor em TODAS as páginas. Esse PDF nasceu pra ir pro
cliente no WhatsApp, e dali é reencaminhado — o contato pessoal circulava junto. Agora sai só
"Friganso". O parâmetro `user` foi REMOVIDO da assinatura de `gerarPdfMudancasPreco` de propósito:
sem ele, não dá pra reintroduzir dado pessoal ali sem querer.
⚠️ O cartão do **Portfólio** continua mostrando o WhatsApp — lá o contato é o propósito da peça.

## ✋ Conferência obrigatória antes de mandar o pedido (2026-08-13, v2.17.0)
Trava OPCIONAL (⚙️ Configurações, vem desligada) antes do "Copiar Resumo" — que é onde o pedido vai
pro supervisor E a venda é contabilizada. Nasceu de erro por distração (TDAH).

⚠️ **O anexo NÃO é o que evita o erro; quem evita é a RELEITURA.** Por isso o texto do pedido aparece
grande e por inteiro no topo, e o upload fica embaixo. Se alguém "simplificar" escondendo o resumo,
o mecanismo perde a razão de existir.

- Três saídas: 📷 print (comprimido antes de subir), 🎤 áudio, ou 📞 "foi por ligação", que **exige uma
  linha escrita** do que o cliente pediu.
- Tem botão de **pular** (pedido do usuário). Ele não trava nada, mas **registra o pulo e mostra
  quantos foram no dia** — um escape sem atrito vira o padrão, e aí a trava deixa de existir.
- A prova sobe pro Storage em `provas-pedido/AAAA-MM/` e o link fica no próprio doc da compra
  (`purchases.prova`), então também serve de defesa se o supervisor cobrar. Pulado fica como
  `tipo: 'pulado'`, não como prova.
- Todo o fluxo virou `executarCopiaResumo(prova)`, chamado de dois lugares. Cobre a Fila junto,
  porque lá o botão é o mesmo — **não há porta dos fundos** (o teste verifica isso).
- ⚠️ Não consegui verificar as REGRAS do Firebase Storage daqui; se `provas-pedido/` der erro de
  permissão, é isso. ✅ `ferramentas/teste-conferencia-pedido.js`.

## 🔔 Lembretes (2026-08-13, v2.18.0)
Aba `lembretes`, coleção `lembretes` no Firestore filtrada por `userId` (vale no PC e no celular).
⚡ RÁPIDO = pontual, "Feito" conclui (`ativo:false`). 🔁 ROTINA = repete, "Feito" só marca o dia.
Quando: um dia só / todo dia / dia da semana. Hora opcional (vazia = primeira abertura do dia).

⚠️ **O ✕ NÃO resolve**: grava `ultimoAdiado`, NUNCA `ultimoFeito`. O lembrete segue pendente e acende
um ⚠️ vermelho pulsando no canto, em TODAS as telas, até o "Feito". É o ponto do recurso — por isso o
popup e o alerta vivem no **App**, não na aba. Clicar no ⚠️ limpa o `ultimoAdiado` e traz de volta.

⚠️ **LIMITE REAL**: site estático não manda push, então **não há aviso com o app fechado**. O lembrete
das 8h aparece na primeira abertura das 8h em diante. Não perde, atrasa — está escrito na própria
tela. Não prometer alarme. ✅ `ferramentas/teste-lembretes.js` (relógio controlado).

## 📄 Leitura de PDF CONSERTADA e unificada com a extensão (2026-08-13, v2.19.0 e v2.20.0)
⛔ **O bug, medido contra a tabela real de 27/08 (740 produtos):** o parser usava FAIXAS DE X FIXAS —
procurava o preço a partir de `x=535`. No PDF real a coluna à vista fica em **x≈354** e as 9 colunas
vão até ~570, então ele pegava a de **45 DIAS**. Resultado: **0 de 718 com o preço certo**, 699 com o
de 45 dias, **~8% mais caro**. Falhava em SILÊNCIO, com número plausível — pior que o R$ 0,00 do bug
antigo, que ao menos era visível. Ex.: `1602 DIANTEIRO BOVINO` saía 24,84 e o à vista é 23,00.

✅ **A correção é a MESMA lição de 04/07**: quando a ORDEM é previsível e a distância não é, extraia
por ORDEM. 740 de 740 corretos. De quebra o PDF passou a trazer `precoCartao` e os 7 `precosPrazo`.

⚠️ **CAMINHO ÚNICO**: PDF e extensão entregam na mesma função `carregarTabela(brutos, origem)`, então
carregar por um ou pelo outro mostra a MESMA coisa. **Se um dia divergirem, é porque alguém duplicou
essa função.** (Ela também foi tirada de dentro de um `useEffect [] `, onde congelava o `products` do
primeiro render e comparava preço contra tabela velha.)

⚠️ **O PDF NÃO RENOMEIA.** Quem manda no nome é a extensão, que lê do SPAmov. Nome não é cosmético:
alimenta `checkDiscountRules` (regra da fraldinha ramax) e `prodCategory` (categorias dos Disparos) —
trocar o nome MUDA COMPORTAMENTO, e foi isso que queimou o usuário antes. Única exceção:
`PDF_NOME_CORROMPIDO` (`Kg [L]`, `N Kg/N Un` — valores de coluna que vazaram pro nome). Conferido
contra os dados reais: **739 dos 740 nomes ficam idênticos**.

O nome é montado por **proximidade em Y**: ele transborda pra cima E pra baixo da linha do código, e
juntar "só a linha de baixo" colava o nome do produto seguinte no anterior.

🧪 **Debug → "Gerar PDF de conferência"**: despeja a tabela que o site usa (todos os preços) pra bater
contra o PDF da distribuidora. Foi assim que tudo acima foi descoberto.
✅ `ferramentas/teste-pdf-tabela.js` e `teste-pdf-conferencia.js`.

## ⚠️ Lição: componente dentro de componente inverte a digitação (2026-08-13, v2.20.1)
Na tela de Lembretes as letras saíam AO CONTRÁRIO. Causa: `const Campo = ...` declarado DENTRO do
`LembretesScreen`. Componente declarado no corpo de outro é **recriado a cada render**, o React trata
como TIPO NOVO, desmonta a árvore e monta outra — o `<textarea>` era destruído a cada tecla, perdia o
foco e o cursor voltava pra 0, então a letra seguinte entrava ANTES da anterior.

**Regra: componente sempre no nível do módulo (8 espaços de indentação).** Existem 17 outros assim no
arquivo (Kpi, Badge, Cartao, NavButton...), todos SEM campo de digitação dentro — remontam à toa, mas
não quebram nada visível. ✅ `ferramentas/teste-componentes-aninhados.js` varre e falha apontando a
linha (verificado reintroduzindo o bug de propósito).

## 🐞 PENDENTE / em investigação
- ⛔ **A EXTENSÃO lê errado o produto `29741` (ARROZ BCO T1, pallet):** dá R$ 510,00 quando o preço
  certo é **R$ 5.100,00** (confirmado pelo usuário e pelo PDF). O PDF lê certo. Suspeita: valores
  acima de R$ 999,99 na tela do SPAmov saem como `5.100,00` (com ponto de milhar) e o filtro
  `^\d{1,4}[.,]\d{2}$` do `extrairListaPrecos` não casa. **NÃO consertar no chute** — pedir o
  `🔍 Ler Página` → `💾 Baixar .txt` da Lista de Preços e olhar o `{x,y,t}` real da linha.
- 🧹 **30 "produtos fantasma"** na tabela do usuário, de cargas antigas do parser com bug: o código
  deles é na verdade o número da coluna EST-VENDA (`1199`, `1240`, `1428`, `2400`, `3168`...). O
  parser novo não cria mais, mas `setProducts` MESCLA e nunca apaga, então eles ficam. Falta um
  botão de limpeza no Debug (o usuário ainda não decidiu se apaga tudo de uma vez).
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
