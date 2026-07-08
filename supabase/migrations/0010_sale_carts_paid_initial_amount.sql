-- =============================================================================
-- Controle360 - Fase 2 (reposicao padronizada em carrinhos): valor pago no
-- ato do pedido, para o pagamento "parcial" deixar de ser so uma flag.
-- Ver docs/replication-v1/03-fase2-reposicao-carrinhos.md.
-- =============================================================================

alter table public.sale_carts
  add column if not exists paid_initial_amount numeric not null default 0;

alter table public.sale_carts
  drop constraint if exists sale_carts_paid_initial_amount_check,
  add constraint sale_carts_paid_initial_amount_check
    check (paid_initial_amount >= 0);

-- Convencao (aplicada pelo frontend em src/salesCart.js, funcoes
-- resolvePaidInitialAmount/approveCart):
--   avista     -> paid_initial_amount = total do carrinho (nada fica devendo)
--   consignado -> paid_initial_amount = 0 (tudo fica devendo)
--   parcial    -> paid_initial_amount = valor informado pelo vendedor,
--                 nunca maior que o total do carrinho
--
-- O efeito financeiro real (quanto vira consignacao/divida) e calculado na
-- APROVACAO do carrinho, sobre a quantidade aprovada por item — nao sobre a
-- solicitada. Nao ha trigger de banco para essa regra nesta migracao: ela
-- vive em C360.salesCart.approveCart (frontend), mesmo padrao ja usado para
-- o piso de preco antes de existir o trigger de banco (docs/backend.md §7).
