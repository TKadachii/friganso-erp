# 🛠️ ferramentas

Scripts que rodam **no seu PC** (não fazem parte do site). Node.js puro, sem instalar nada.

---

## 🔄 `sincronizar.js` — põe o seu PC em dia

**É por onde começar sempre que voltar ao projeto.**

```powershell
node ferramentas\sincronizar.js
```

Faz, em ordem:

1. **Baixa** o que tem de novo (`git pull`) — e recusa se você tiver trabalho não commitado,
   pra não atropelar
2. Mostra **o que mudou desde a ÚLTIMA VEZ que você rodou** (não desde sempre) — commits e arquivos
3. Lê as **entradas novas do CHANGELOG** em português, pra você saber o que virou o quê
4. Confere as travas de versão — principalmente `APP_BUILD_VERSION` × `web-version.json`, que se
   ficarem diferentes prendem o app num loop eterno de "atualização disponível"
5. Avisa **se a extensão mudou** (ela não se atualiza sozinha — precisa baixar e reinstalar)
6. Roda os testes
7. Lembra de mandar o Claude local ler o `CONTEXTO-DO-PROJETO.md`

| Flag | O que faz |
|---|---|
| `--sem-pull` | Não baixa nada, só analisa o que já está aqui |
| `--sem-teste` | Pula os testes (mais rápido) |
| `--tudo` | Mostra o histórico inteiro, não só o que é novo pra você |

Ele guarda em `ferramentas/.ultima-sincronizacao` (fora do git) o último commit que você viu — é isso
que faz ele mostrar só a novidade em vez de repetir tudo.

⚠️ **Teste que não roda aparece como `⏭️ NÃO RODOU`, nunca como ✅.** Alguns testes precisam de
pacotes que não são dependência do site. Pra rodar todos:

```powershell
npm install playwright jspdf xlsx pdfjs-dist@3.11.174 react@18 react-dom@18 chart.js @babel/standalone
```

---

## 🎯 `gerar-leads.js` — lista de prospecção de graça

Monta a lista de empresas pra abastecer a tela **🎯 Prospecção em Massa** do Friganso ERP,
lendo a base **pública e gratuita** de CNPJ da Receita Federal.

### Por que isso existe

O CNPJ.biz e o Casa dos Dados **não têm base própria** — os dois revendem exatamente este
arquivo da Receita. O telefone e o email que eles cobram pra mostrar são os campos
`telefone_1` e `correio_eletronico` da tabela ESTABELECIMENTOS. Este script vai direto na fonte.

| | Casa dos Dados | Este script |
|---|---|---|
| Primeira lista | ~R$50 (5.000 CNPJs) | R$ 0 |
| Atualizar mês que vem | outros R$50 | R$ 0 |
| Tempo | ~10 min | ~1h na primeira vez |
| Dados | idênticos | idênticos |

### Como rodar

```powershell
node ferramentas\gerar-leads.js
```

Gera `leads-friganso.csv` na pasta atual. Depois é só abrir o ERP →
**🎯 Prospecção em Massa** → *Selecionar planilha de leads*.

### Opções

| Flag | O que faz |
|---|---|
| `--so-celular` | Descarta quem só tem telefone fixo |
| `--com-inativas` | Inclui empresas não-ATIVAS (padrão: só ativas) |
| `--razao` | Traz também a Razão Social ⚠️ **dobra o download** |
| `--pasta 2026-07` | Usa uma publicação específica (padrão: descobre a mais nova) |
| `--saida nome.csv` | Muda o nome do arquivo gerado |
| `--manter-zips` | Não apaga os `.zip`, pra rodar de novo sem baixar tudo outra vez |

### O que dá pra configurar

No topo do arquivo, em maiúsculas:

- **`CIDADES_ALVO`** — hoje: Cabo Frio, Armação dos Búzios, São Pedro da Aldeia, Arraial do Cabo,
  Araruama, Iguaba Grande e Saquarema. Escreva **sem acento e em maiúscula**.
- **`CNAES_ALVO`** — restaurante, mercado, açougue, padaria, hotel e buffet.
- **`UF_ALVO`** — hoje `RJ`.

### ⚠️ O que esperar

- **Download de ~2,5 GB** (10 partes). O script baixa, filtra e **apaga cada parte** antes de
  pegar a próxima, então não precisa de 12 GB livres — precisa de uns 2 GB.
- Se a internet cair, **rode de novo**: o que já baixou é reaproveitado.
- Descompactar usa o `Expand-Archive` do PowerShell (já vem no Windows).
- **O email costuma ser do contador.** O telefone é bem melhor — e o filtro `--so-celular` é o
  que separa o contato do dono do telefone de recado.

### As pegadinhas do formato da Receita (já resolvidas aqui)

Se um dia precisar mexer, é isso que quebra quem tenta na mão:

1. Os CSVs **não têm cabeçalho** — as colunas são posicionais (layout oficial).
2. O encoding é **ISO-8859-1**, não UTF-8. Ler como UTF-8 estraga todos os acentos.
3. Separador é `;`, campos entre aspas, aspas internas dobradas.
4. **Município e CNAE vêm como código**, não como nome — daí as tabelas auxiliares.
5. **O DDD vem numa coluna separada** do número.
6. Situação cadastral ATIVA é o código `02`.

---

## ✅ `teste-gerar-leads.js`

Testa a regra de negócio do gerador **sem baixar nada** (dados falsos no formato exato da Receita):

```powershell
node ferramentas\teste-gerar-leads.js
```

Cobre o filtro de cidade/CNAE/UF/situação, a junção do DDD com o número, a preferência pelo
celular quando a empresa tem fixo e celular, o escape do CSV, e o caminho de volta pela tela de
importação — usando os **mesmos detectores de coluna que estão no `index.html`**, então se alguém
mexer neles e quebrar a compatibilidade, o teste acusa.

A última etapa precisa do SheetJS (`npm install xlsx`); sem ele, é pulada em vez de falhar.
