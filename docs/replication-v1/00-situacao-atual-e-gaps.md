# 00 — Situação atual e gaps reais

**Resumo:** este documento inventaria o que o Controle360 **já faz hoje** e o que realmente falta, por
domínio. Ele existe porque o pacote de replicação foi escrito de forma genérica e assume que várias coisas
não existem quando, na verdade, já existem. Planejar sem esta conferência levaria a reimplementar recursos
prontos.

---

## 1. Navegação e perfis

### Como está
- **Uma única barra de abas horizontal** com 20 abas, definida estaticamente em `index.html` (linhas 37–58)
  e rolável no celular (`.tabs { overflow-x: auto }` em `styles/main.css`).
- Visibilidade por perfil já existe, via o mapa `TAB_ROLES` em `src/app.js:37` e a função
  `applyRoleVisibility()` (`src/app.js:74`), que apenas liga/desliga o atributo `hidden` de cada botão.
- O papel do usuário vem de `state.profile.role` (`'admin'` | `'vendedor'`), lido por
  `S.getCurrentUser()`/`S.isAdmin()` (`src/state.js:187-193`).
- Troca de aba: `setTab(tab)` → `renderTab()` → `LEGACY_RENDERERS` (HTML string) ou `mountModuleTab(tab)`
  (módulos autocontidos), `src/app.js:153-258`.

### Gap real
- **Não existe** bottom-nav, menu "Mais" nem tela "Hoje". No celular, o vendedor rola uma barra com muitas
  abas — exatamente o problema nº 1 e nº 2 do resumo executivo do pacote.
- A lista de abas está **duplicada** (HTML estático + `TAB_ROLES`). Qualquer navegação nova deveria ter
  **uma fonte única** para não dessincronizar.
- **Bom:** o pipeline de render é agnóstico a *como* a aba foi escolhida — uma bottom-nav só precisa chamar
  `setTab(dataTab)`. Não é preciso refatorar o miolo.

---

## 2. Reposição do vendedor e aprovação

### Como está — existem DOIS sistemas paralelos
1. **Fluxo antigo em `orders`** (`src/sellerStock.js`): vendedor cria pedido; admin aprova/rejeita de forma
   **binária** (`mountApprovals`, `src/sellerStock.js:643`; `approveOrder`/`rejectOrder`). `orders` é
   **um produto por linha**, sem `payment_mode`, sem quantidade aprovada separada da solicitada.
2. **Fluxo novo em carrinhos** (`src/salesCart.js` + `sale_carts`/`sale_cart_items`): já tem
   - `payment_mode` = `avista` | `consignado` | `parcial` (`src/salesCart.js:101-105`);
   - **aprovação ajustável e parcial por item** — `approveCart()` (`src/salesCart.js:462`) lê a quantidade
     ajustada pelo admin, grava `sale_cart_items.approved_quantity` e `rejection_reason`, e o status final
     vira `approved` / `partially_approved` / `rejected` (`src/salesCart.js:508`);
   - ao aprovar item consignado, chama `transferAdminStockToSeller()` (`src/salesCart.js:360`) — baixa o
     estoque central, registra `saida_envio_consignado`, incrementa `seller_stock` e cria uma consignação
     admin→vendedor. Ao aprovar item à vista, cria uma linha em `orders` já `aprovado`
     (`src/salesCart.js:493-504`).

### Gap real
- **A aprovação com ajuste/parcial do pacote (docs 03/04) já existe — mas só nos carrinhos.** O pacote
  assume que não existe.
- **`payment_mode='parcial'` é só uma flag**: não há **coluna de valor pago inicial** em `sale_carts` (nem
  em `orders`). O "misto/parcial" do pacote (paga uma parte, resto fica em aberto) **não está modelado
  financeiramente**.
- Dois caminhos de aprovação convivendo é fonte de divergência (ver decisão em `01-decisoes-de-produto.md`:
  padronizar em carrinhos).

---

## 3. Dívida do vendedor com o admin (consignado admin→vendedor)

### Como está
- **Não há entidade de dívida de primeira classe.** A dívida é **implícita**, reaproveitando
  `consignments`:
  - `sellFromOwnStock()` (`src/sellerStock.js:407`) cria uma consignação 100% vendida cujo
    `consignmentOpenAmount` (`src/calculations.js:82`) representa "o quanto o vendedor deve ao admin";
  - `transferAdminStockToSeller()` cria uma consignação admin→vendedor com `quantitySold: 0`.
- `consignments.amount_paid` + `consignment_events(type='pagamento')` são o único rastro de pago/devido, e
  **escopados a uma consignação**, não a um saldo agregado do vendedor.

### Gap real
- Não existe saldo agregado por vendedor, nem pagamentos fracionados como registros próprios, nem histórico
  unificado de lançamentos. Tudo isso é o que a Fase 3 (ledger) resolve.
- O próprio comentário de cabeçalho de `src/sellerStock.js:31-41` já pede confirmação do dono sobre esse
  modelo implícito — a decisão tomada foi **ledger dedicado**.

---

## 4. Devoluções, desperdício e brinde

### Como está — `src/returns.js`
- **Devolução** (`recordDevolucao`, `src/returns.js:179`): cria uma **venda negativa** (`quantity < 0`,
  `origin: 'devolucao'`, `parentSaleId` preenchido) e um movimento `entrada_devolucao_venda`. Dinheiro e
  estoque **voltam imediatamente**.
- **Desperdício** (`recordDesperdicio`, `src/returns.js:252`): só movimento `saida_desperdicio` (estoque
  sai, sem dinheiro).

### Gap real
- **Não há status logístico de devolução** (`a_devolver`, `enviado`, `recebido`, `devolvido`, ...). Hoje
  toda devolução é imediata — o que contraria a regra central do pacote: *"'a devolver' não volta para o
  estoque nem quita dívida; só 'devolvido/conferido' impacta"*.
- **Não existe brinde (`brinde`) em lugar nenhum** — nem tabela, nem tipo de movimento, nem UI.
- **Gap de RLS conhecido** (documentado em `src/state.js:334-341` e `docs/backend.md`): um **vendedor**
  chamando `recordMovement()` genérico é barrado. Só existe policy de INSERT de `stock_movements` para os
  tipos `entrada_devolucao_venda`/`saida_desperdicio` **amarrada a uma venda do próprio vendedor**
  (migration `0003`). Fluxos novos de devolução/brinde do vendedor precisam de policy/RPC própria.

---

## 5. Banco de dados — o que existe

Tabelas atuais (migrations `0001`–`0009`): `profiles`, `businesses`, `products` (+ view `seller_products`),
`clients`, `suppliers`, `purchases`, `stock_movements`, `recipes`, `productions`, `sales`, `orders`,
`consignments`, `consignment_events`, `tasks`, `seller_prices`, `seller_stock`, `sales_goals`
(+ view `sales_goals_progress`), `seller_settings`, `sale_carts`, `sale_cart_items`,
`seller_stock_adjustments`.

`stock_movements.type` aceita (constraint em `0001`): `entrada_compra`, `saida_producao_insumo`,
`entrada_producao_produto_final`, `saida_venda`, `saida_envio_consignado`, `entrada_devolucao_consignado`,
`ajuste_manual`, `saida_desperdicio`, `entrada_devolucao_venda`.

### Padrões reutilizáveis (para as tabelas novas seguirem)
- Helpers RLS `SECURITY DEFINER`: `public.is_admin()`, `public.my_business_id()`,
  `public.is_privileged_role()` (`0001`, search_path refixado em `0004`).
- **Padrão de duas policies:** `<tab>_all_admin` (admin full, `is_admin() and business_id = my_business_id()`)
  + policies seller-scoped por `seller_id = auth.uid()`.
- **Tabelas admin-only** (`suppliers`, `purchases`, `stock_movements`, `recipes`, `productions`, `tasks`,
  `products`): só a policy `_all_admin`.
- **Tabelas read-only para vendedor** (`seller_prices`, `seller_stock`, `seller_settings`,
  `seller_stock_adjustments`, `sales_goals`): `_all_admin` + `for select using (seller_id = auth.uid())`;
  mutações via RPC `SECURITY DEFINER`.
- **Padrão pai-filho** (evento herda dono do pai via `EXISTS`): `consignment_events`, `sale_cart_items`.
- **Triggers de guarda** para regras OLD/NEW que RLS não expressa, sempre com curto-circuito por
  `is_privileged_role()`: `enforce_order_approval_lock`, `enforce_sale_price_floor`,
  `enforce_profile_privilege_guard`, `fill_consignment_cost_at_send`.
- **RPCs privilegiadas** já existentes: `consume_seller_stock`, `seller_adjust_own_stock`,
  `public_cart_lookup` (padrão a copiar para pagamentos/lançamentos do ledger).

### Gap real — 5 domínios greenfield
Nenhuma tabela dedicada existe para: **ledger de dívida**, **pagamentos fracionados**,
**devolução-com-status**, **desperdício** (como registro próprio, não só movimento), **brinde**. Os
rascunhos do pacote (`seller_account_entries`, `seller_payments`, `operational_movements`) cobrem isso — mas
o SQL precisa ser reescrito para os padrões RLS reais acima (ver draft em
`supabase/migrations/drafts/`).

---

## Resumo do "já existe vs. falta"

| Domínio | Já existe | Falta |
|---|---|---|
| Nav por perfil | `TAB_ROLES` + `hidden` | bottom-nav, "Mais", tela "Hoje", fonte única de abas |
| Reposição | carrinhos com `payment_mode` + aprovação parcial/ajuste | aposentar caminho antigo; valor pago do `parcial` |
| Dívida do vendedor | saldo implícito via consignação | ledger dedicado + pagamentos fracionados + saldo agregado |
| Devoluções | devolução imediata (venda negativa) | status logístico; só conferido impacta |
| Desperdício | movimento `saida_desperdicio` | registro próprio com responsável/relatório |
| Brinde | nada | tudo (tabela/tipo/UI) |
| Relatórios | dashboard + relatórios básicos | saldo por vendedor, devoluções pendentes, desperdício/brinde por período |
