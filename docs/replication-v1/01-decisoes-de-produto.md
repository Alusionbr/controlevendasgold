# 01 — Decisões de produto

**Resumo:** três decisões foram tomadas antes de detalhar as fases. Elas guiam todo o resto e evitam
retrabalho. Este documento registra cada uma, o porquê e a consequência prática no código.

---

## Decisão 1 — Dívida do vendedor = **ledger dedicado**

**O que foi decidido:** modelar a conta corrente do vendedor com tabelas próprias
(`seller_account_entries` + `seller_payments`), como no pacote — **não** continuar com o modelo implícito
que reaproveita `consignments`.

**Por quê:**
- O saldo passa a ser **resultado de lançamentos** (débitos e créditos), nunca um número sobrescrito — é
  auditável e bate com a regra do pacote ("nunca sobrescrever o saldo manualmente").
- Pagamentos fracionados viram **registros próprios** (`seller_payments`), permitindo "pagar aos poucos".
- Separa claramente **dois conceitos que hoje se misturam**: consignado admin→vendedor (dívida do vendedor)
  vs. consignado vendedor→cliente (a receber do cliente). Ver `docs/02-domain-logic/06-two-consignment-types.md`
  do pacote.

**Consequência prática:**
- Onde os **débitos** entram: no momento em que o admin aprova um carrinho **consignado** ou **parcial** —
  ou seja, dentro de `transferAdminStockToSeller()` / `approveCart()` (`src/salesCart.js:462-505`). A
  aprovação passa a lançar um `debit_replenishment` no ledger (sobre a **quantidade aprovada**).
- Onde os **créditos** entram: `payment` (pagamento fracionado recebido), `return_credit` (devolução
  **conferida** — ver Fase 4), `manual_adjustment`, `writeoff`, `bonus_credit`.
- O saldo agregado por vendedor vem de uma **view/RPC** (`Σ débitos − Σ créditos`), consumida pela tela do
  admin (saldo por vendedor) e pela tela do vendedor (só o próprio, simples).
- O saldo implícito atual (`consignmentOpenAmount` sobre consignações "admin→vendedor") **deixa de ser a
  fonte de verdade da dívida**; migração/backfill desse histórico é uma pendência a decidir na Fase 3.

---

## Decisão 2 — Reposição = **padronizar nos carrinhos**

**O que foi decidido:** `sale_carts`/`sale_cart_items` é o **caminho único** de pedido de reposição.
Aposentar a UI de aprovação do fluxo antigo de `orders`.

**Por quê:**
- Os carrinhos **já têm** o que o pacote pede: `payment_mode` (avista/consignado/parcial) e aprovação
  **ajustável/parcial por item** (`approved_quantity`). Evoluir os carrinhos é bem menos trabalho do que
  levar `orders` (um-produto-por-linha, aprovação binária) até esse nível.
- Manter os dois caminhos é risco permanente de divergência de regra financeira.

**Consequência prática:**
- A tela de reposição do vendedor cria **carrinho** (multi-item), não `orders` diretos.
- A tela de **Aprovações do admin** passa a ser a de carrinhos (`renderAdminApprovals`,
  `src/salesCart.js:244`); a antiga `mountApprovals` de `orders` (`src/sellerStock.js:643`) é
  **descontinuada** da navegação (o código pode ficar por um tempo, mas sai do fluxo).
- `orders` **continua existindo** como o **registro logístico** gerado ao aprovar um carrinho à vista
  (`src/salesCart.js:493-504`) — status `pendente`/`em_preparo`/`pronto`/`despachado`/`concluido`. Não é
  removido; só deixa de ser o ponto de entrada da aprovação.
- A trava de banco `enforce_order_approval_lock` (migration `0009`) permanece válida.

---

## Decisão 3 — UX mobile por perfil, a partir de **fonte única de navegação**

**O que foi decidido:** implementar bottom-nav + menu "Mais" + tela "Hoje" por perfil (Fase 1), gerando a
navegação a partir de **um único mapa** (o `TAB_ROLES` + rótulos), em vez de manter a lista de abas
duplicada entre `index.html` e `src/app.js`.

**Por quê:**
- Resolve os problemas nº 1 e nº 2 do resumo executivo do pacote (abas demais no mesmo nível; vendedor vê
  ferramentas demais).
- Fonte única elimina o bug latente de dessincronizar as duas listas de abas.

**Consequência prática:**
- `applyRoleVisibility()` (`src/app.js:74`) e o wiring de clique passam a operar sobre a nav gerada.
- A tela "Hoje" reaproveita `renderDashboard()` (`src/app.js:126`) e adiciona ações rápidas + últimas
  movimentações + estoque crítico (mockup `assets/screens/01-hoje-dashboard.png`).
- Regra visual do pacote respeitada: **função fora do perfil não renderiza** botão nem item de menu.
- Ao final da Fase 1, rodar `node build-mobile.js` para sincronizar `controle360-mobile.html`.

---

## O que estas decisões **não** mudam

- Persistência e segurança continuam no Supabase (Auth + Postgres + RLS). Nada de segundo backend.
- Cálculo continua em `src/calculations.js`; dados em `src/state.js` (add/update/remove assíncronos).
- Estoque nunca muda sem registro de movimentação (`stock_movements`) — as fases novas seguem isso.
- Sem dados de exemplo pré-preenchidos.
