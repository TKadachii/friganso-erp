# 🛠️ ferramentas

Scripts que rodam **no seu PC** (não fazem parte do site). Node.js puro, sem instalar nada.

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
