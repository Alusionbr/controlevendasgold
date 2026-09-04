# Revisão do sistema e plano de melhorias

Revisão feita em **04/09/2026** sobre todo o código de `src/`, com o app
rodando (ver `.claude/skills/run-controlevendasgold/`) nos dois perfis
(administrador e vendedor) e em telas de celular e computador.

O documento tem três partes:

1. o que foi corrigido agora;
2. o que foi encontrado e **não** foi corrigido (com o motivo e o caminho da
   correção, para quem continuar o trabalho);
3. as melhorias propostas, em ordem de prioridade.

---

## 1. Corrigido nesta rodada

| # | Onde | Problema | Correção |
|---|---|---|---|
| 1 | `src/calculations.js` | Receita recebida contava **duas vezes** a entrada de um pedido de revenda pago à vista/parcial: uma vez como `sellerOrderAccounts.initialPaid` e outra como evento `pagamento` da consignação que o despacho cria (`advance_order_group` grava esse evento). | `isClientConsignmentEvent()` passa a excluir eventos de consignação que pertencem a vendedor, tanto em `dailyReceipts` quanto em `recognizedRevenue`. |
| 2 | `src/salesCart.js` | Toda mensagem do painel de Vendas (sucesso e erro) era apagada no mesmo instante: depois de `paint()`, o `options.onDone()` (= `renderAll`) remontava o painel com um closure novo, sem a mensagem. Na prática, lançar venda, aprovar/rejeitar pedido ou receber um erro parecia "não fazer nada". | Mensagem guardada em `carriedFeedback` (escopo do módulo, como o rascunho do carrinho) e recuperada no primeiro `paint()` do remount. Além disso, `onDone()` só é chamado quando algo foi realmente gravado — clicar em "+"/"−" no carrinho não remonta mais o app inteiro. |
| 3 | `src/operationalMovements.js` | Mesmo problema na conferência de devoluções/desperdícios/brindes: confirmar ou recusar não mostrava confirmação nem o motivo do erro. | Mesma solução (`carriedFeedback` no escopo do módulo). |
| 4 | `src/app.js` + `src/salesCart.js` | "Permissões dos vendedores" (`mountSettings`) ficou **sem nenhum chamador** quando a aba "Aprovações" saiu da navegação. Com ela sumiram os únicos botões que liberam "acerto de estoque" e "alinhamento de saldo" para o vendedor — a tela do vendedor lê `balanceAlignmentCredits`, que nada mais conseguia preencher. | Painel remontado dentro da aba **Vendedores**, recolhido num `<details>` ("Permissões e liberações dos vendedores"), sem criar aba nova. |
| 5 | `src/api.js` | `listSellerOrderAccounts` devolvia direto o corpo do RPC; qualquer resposta que não fosse lista quebrava o `.map()` em `src/state.js` e derrubava o `refresh()` **inteiro** — o sistema abria zerado, como se o negócio não tivesse dado nenhum. Reproduzido no ambiente de teste. | Sempre devolve array. |
| 6 | `src/exportImport.js` | Backup em Excel não levava `priceFloor`/`defaultPrice` (produtos) nem `paidInitialAmount` (carrinhos). | Campos incluídos em `fields`, `LABELS` e `NUMERIC_KEYS`. |
| 7 | `src/sellerLedger.js` | Textos do acompanhamento de pagamento sem acentuação ("Otimo", "Atencao", "ultimo"). | Corrigidos. |
| 7b | `styles/main.css` | Em quase todo quadro da tela do vendedor, o título e a explicação apareciam grudados ("Informar pagamentoO saldo muda somente..."): o `<small>` de `.approval-card-head` era inline, e a regra que o separava existia só dentro de `.seller-order-account`. | Regra generalizada para todo `.approval-card-head small`. |
| 8 | `.claude/skills/run-controlevendasgold/driver.mjs` | O driver de teste ainda procurava `input[type=email]` na tela de login (o campo virou "usuário ou e-mail") e não implementava `list_seller_order_accounts`, `register_seller_daily_login` nem `register_manual_seller_debit`. | Seletor corrigido e os três RPCs implementados no mock. |

Novidade entregue junto (pedido do dono do sistema): **tela "Novidades"** com
o histórico de atualizações por data — `src/changelog.js`, aba `novidades` e
selo de versão no cabeçalho. Ver `docs/historico-atualizacoes.md`.

---

## 2. Encontrado e não corrigido (decisão pendente)

### 2.1 Restaurar backup não grava no servidor — **risco alto**

`importXlsx`/`importJson` chamam `state.replaceState(...)`, que só troca o
cache em memória e o espelho do navegador. Nenhuma escrita vai para o
Supabase: a tela mostra os dados importados e o primeiro `refresh()`
(qualquer gravação, ou recarregar a página) traz tudo do servidor de volta.

Ou seja: **exportar funciona, restaurar não.** Enquanto isso não for
resolvido, o botão "Importar" transmite uma segurança que o sistema não tem.

Caminho: gravar coleção por coleção respeitando ordem de chave estrangeira e
RLS. Antes disso é preciso decidir: substituir tudo, mesclar, ou o que fazer
com registro cujo `id` já existe. É trabalho de backend, com decisão de
produto no meio.

Paliativo barato (1 hora): enquanto não existir, trocar o texto do botão para
deixar claro que a importação é só visualização, ou escondê-lo.

### 2.2 Aba "Ajuda" fala com o vendedor, mas só o administrador enxerga

`src/sellerHelp.js` é a central de ajuda **do vendedor** ("lance sua primeira
venda", "peça reposição") e a aba está liberada só para `admin`
(`TAB_ROLES.ajuda`). Além disso, parte do conteúdo descreve funções que o
vendedor perdeu quando o painel dele virou somente leitura.

Decisão necessária: reescrever o conteúdo para o modelo atual e liberar para
o vendedor, ou transformar a aba numa ajuda do administrador.

### 2.3 Telas do vendedor desativadas continuam no código

`estoque` ("Meu estoque") e `minhasdevolucoes` estão em `TAB_ORDER` com
`SEM_PAPEL` — ninguém abre. É proposital (documentado em `src/app.js`), mas
já são dois módulos inteiros (`src/sellerStock.js` e a parte `mountSeller` de
`src/operationalMovements.js`) sem uso. Decidir: religar para o vendedor ou
remover. Manter indefinidamente aumenta o custo de cada revisão.

### 2.4 Vendedor não consegue excluir os próprios registros pendentes

Já registrado no `CLAUDE.md`: a policy de DELETE de `orders`/`clients`/
`consignments` é só do administrador, então o botão "Excluir" dá erro para o
vendedor. Falta decidir entre dar a permissão ou esconder o botão.

### 2.5 Relatórios de replicação não filtram por negócio

`renderReplicationReports` (`src/app.js`) lê `sellerAccountEntries`,
`saleCarts` e `operationalMovements` sem filtrar `businessId`, ao contrário do
resto da tela. Hoje não muda nada (cada conta pertence a um negócio só), mas
volta a ser bug no dia em que uma conta enxergar dois negócios.

### 2.6 "Consignado em aberto" tem duas contas diferentes na mesma tela

`businessMetrics.consignmentsOpen` soma consignação de cliente + saldo do
ledger do vendedor; `creditSalesPosition.sellers` usa o saldo por pedido
(`sellerOrderAccounts.openAmount`). São números próximos, calculados de
formas diferentes, exibidos em painéis vizinhos — e vão divergir sempre que
existir lançamento manual no ledger. Vale unificar a fonte ou deixar os
rótulos explicitamente diferentes.

---

## 3. Melhorias propostas, por prioridade

### Prioridade 1 — confiança no dado

1. **Restaurar backup de verdade** (item 2.1). Sem isso o backup é só metade
   do seguro.
2. **Testes automáticos dos cálculos.** `src/calculations.js` é JavaScript
   puro, sem DOM: dá para rodar em Node sem instalar nada. Cobrir custo médio
   ponderado, ficha técnica, `saleMath`, `sellerBalance`, `recognizedRevenue`
   e `dailyReceipts` evitaria justamente o tipo de erro do item 1 da tabela
   acima (dinheiro contado duas vezes), que nenhuma tela denuncia.
3. **Conferência de caixa por período**: uma tela que some recebimentos,
   pagamentos e saldo dos vendedores e mostre a diferença em relação ao
   esperado. Hoje cada número vive numa aba.

### Prioridade 2 — uso diário

4. **Busca e filtro nas listas grandes** (produtos, clientes, vendas). Acima
   de algumas dezenas de linhas, a rolagem é o único recurso disponível.
5. **Confirmação visível em toda gravação.** As correções desta rodada
   consertaram Vendas e Devoluções; vale padronizar um único helper de
   mensagem (hoje cada módulo tem o seu) para o problema não voltar em módulo
   novo.
6. **Fechar o ciclo do pedido pelo celular**: aprovar e despachar da tela
   "Hoje", sem abrir a esteira.
7. **Alerta de vendedor parado**: o acompanhamento de pagamento já calcula os
   dias desde o último pagamento; falta levar esse aviso para a tela do
   administrador, ordenando quem está há mais tempo sem acertar.

### Prioridade 3 — evolução

8. **Comissão do vendedor** (já previsto no `CLAUDE.md`, ainda não feito).
9. **Anexar comprovante/nota à compra**, como já existe para pagamento.
10. **Lotes e validade**, importante para quem trabalha com cosmético e
    alimento.
11. **Impressão de lista de separação/etiqueta** a partir do pedido aprovado.

---

## Como continuar este trabalho

- Regras de negócio: `docs/regras-negocio.md`; estrutura de dados:
  `docs/modelo-dados.md`; contrato do backend: `docs/backend.md`.
- Cálculo muda **primeiro** em `src/calculations.js`, nunca direto na tela.
- Toda alteração de estoque precisa gerar `stockMovements` (regra fixa do
  projeto, ver `CLAUDE.md`).
- Depois de mexer em `src/` ou `styles/`, rode `node build-mobile.js` para a
  versão de celular não ficar para trás.
- Registre a alteração em `src/changelog.js` e em
  `docs/historico-atualizacoes.md` — é o que aparece na tela "Novidades".
