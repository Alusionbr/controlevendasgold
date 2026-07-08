# 04 — Fase 3: conta corrente do vendedor (ledger dedicado)

**Resumo:** criar a dívida do vendedor como um **ledger de lançamentos** (`seller_account_entries`) mais uma
tabela de **pagamentos fracionados** (`seller_payments`). O saldo é sempre `Σ débitos − Σ créditos`, nunca
um número sobrescrito. Toca o banco (2 tabelas + RLS + RPC) e adiciona telas de admin e vendedor.

---

## Objetivo
Cobrir `docs/02-domain-logic/03-seller-debt-ledger.md` do pacote e a Decisão 1. Substituir o modelo
implícito atual (dívida = `consignmentOpenAmount` de consignações admin→vendedor) por uma conta corrente de
primeira classe.

## Modelo de dados

### `seller_account_entries` (lançamentos)
Campos: `id`, `business_id`, `seller_id`, `type`, `amount (>= 0)`, `direction (debit|credit)`, `source_type`,
`source_id`, `notes`, `created_by`, `created_at`.

Tipos (`type`): `debit_replenishment`, `payment`, `return_credit`, `manual_adjustment`, `writeoff`,
`bonus_credit`.

Convenção de sinal: `direction = 'debit'` aumenta a dívida; `'credit'` reduz. `debit_replenishment` é
sempre débito; `payment`/`return_credit`/`bonus_credit`/`writeoff` são créditos; `manual_adjustment` pode
ser qualquer um dos dois (com `notes` obrigatório).

### `seller_payments` (pagamentos fracionados)
Campos: `id`, `business_id`, `seller_id`, `amount (> 0)`, `payment_date`, `method`, `proof_url`, `notes`,
`received_by`, `created_at`.

Cada pagamento gera **também** um lançamento `payment`/`credit` no ledger (via RPC/trigger), para o saldo
continuar sendo só a soma do ledger.

### Saldo
View ou RPC `seller_balance(seller_id)`:
```txt
saldo = Σ(amount onde direction='debit') − Σ(amount onde direction='credit')
```
Admin: saldo por vendedor (todos). Vendedor: só o próprio.

## Onde os lançamentos entram (integração com o que existe)
- **Débito** (`debit_replenishment`): na aprovação de carrinho **consignado/parcial**
  (`approveCart`/`transferAdminStockToSeller`, `src/salesCart.js:462-505`), sobre `divida_gerada`
  (calculado na Fase 2). `source_type='sale_cart'`, `source_id = cart.id`.
- **Crédito `payment`**: quando o admin registra um pagamento recebido (tela nova) ou o vendedor "informa
  pagamento" (se permitido) → grava `seller_payments` + lançamento.
- **Crédito `return_credit`**: quando uma devolução é **conferida/recebida** (Fase 4). Só então abate a
  dívida — nunca em "a devolver".
- **`manual_adjustment` / `writeoff` / `bonus_credit`**: ações do admin com motivo obrigatório.

## RLS e segurança (seguir padrões de `0001`–`0009`)
- Ambas as tabelas: `enable row level security`.
- **Admin:** policy `_all_admin` (`is_admin() and business_id = my_business_id()`).
- **Vendedor:** `for select using (seller_id = auth.uid())` — só lê o próprio. **Não** escreve direto.
- **Mutações via RPC `SECURITY DEFINER`** (padrão de `seller_adjust_own_stock`):
  - `admin_register_seller_payment(seller_id, amount, method, ...)` — admin recebe pagamento; grava
    `seller_payments` + lançamento `payment`.
  - `seller_report_payment(amount, method, proof_url, ...)` — opcional, vendedor "informa pagamento" (fica
    pendente de confirmação do admin, se o produto quiser esse passo).
  - Lançamentos automáticos (débito na aprovação, crédito na devolução conferida) podem ser feitos por
    trigger/RPC no mesmo caminho que já roda como admin.
- Nunca permitir UPDATE/DELETE de lançamento pelo vendedor; correções são **novos lançamentos**
  (`manual_adjustment`), preservando histórico (regra do `CLAUDE.md`: não apagar histórico).

## Telas
- **Admin — "Débitos dos vendedores":** saldo por vendedor, e ao abrir um vendedor: pedidos que geraram
  débito, pagamentos recebidos, devoluções abatidas, histórico completo, botão "Receber pagamento".
- **Vendedor — "Meu saldo com admin":** total em aberto, pedidos em aberto, pagamentos já registrados,
  botão "Informar pagamento" (se permitido). Visão simples.

## Migração do histórico implícito (pendência a decidir)
Hoje há dívida implícita em consignações admin→vendedor. Opções na implementação:
1. **Backfill:** gerar `debit_replenishment` retroativo a partir das consignações admin→vendedor abertas.
2. **Corte limpo:** ledger começa do zero; consignações antigas seguem no modelo velho até quitarem.
Recomendação: decidir com o dono do negócio; registrar a escolha aqui antes de implementar.

## Arquivos afetados (quando implementada)
- Migration nova (draft): `seller_account_entries`, `seller_payments`, RLS, RPCs, view de saldo.
- `src/state.js` — cachear `sellerAccountEntries`/`sellerPayments`; refresh admin e vendedor.
- `src/calculations.js` — `sellerBalance(entries)` puro (soma débitos/créditos).
- Novo módulo `src/sellerLedger.js` (admin + vendedor) — telas de débito/pagamento (padrão mount/refresh).
- `src/salesCart.js` — lançar débito na aprovação.
- `docs/backend.md`, `docs/modelo-dados.md`, `CLAUDE.md` — documentar tabelas novas.

## Critérios de aceite
- Saldo = soma dos lançamentos; nunca sobrescrito.
- Pagamento fracionado reduz o saldo e aparece no histórico.
- Vendedor vê só o próprio saldo; admin vê todos.
- Devolução conferida (Fase 4) gera `return_credit`.
