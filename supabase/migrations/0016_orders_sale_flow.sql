-- =============================================================================
-- Controle360 - fluxo unificado de venda: a esteira de pedidos (orders) passa a
-- ser o destino de TODA venda lancada pelo carrinho unico, seja "venda minha"
-- (cliente final) ou "venda ao revendedor" (a vista / parcial / consignado).
--
-- A materializacao (baixa de estoque, venda/CMV ou consignado + divida) so
-- acontece quando o admin move o pedido para "despachado" - ver
-- advanceOrderGroup() em src/salesCart.js. Ate la, o pedido so ocupa a esteira.
--
-- Reaproveita a tabela orders (enum de status + trigger enforce_order_approval_lock
-- que ja garante "nasce pendente" e "so admin muda status") e as policies RLS
-- ja existentes - nenhuma policy nova e necessaria (colunas novas herdam as
-- policies da tabela).
-- =============================================================================

alter table public.orders
  add column if not exists sale_type text not null default 'propria',
  add column if not exists payment_mode text,
  add column if not exists paid_amount numeric not null default 0,
  add column if not exists order_group_id uuid;

-- 'propria' = venda minha (cliente final) | 'revenda' = venda ao revendedor
alter table public.orders
  drop constraint if exists orders_sale_type_check,
  add constraint orders_sale_type_check
    check (sale_type in ('propria', 'revenda'));

-- payment_mode so faz sentido em 'revenda' (fica null em 'propria')
alter table public.orders
  drop constraint if exists orders_payment_mode_check,
  add constraint orders_payment_mode_check
    check (payment_mode is null or payment_mode in ('avista', 'parcial', 'consignado'));

-- order_group_id agrupa as linhas (1 produto/linha) de um mesmo carrinho para
-- renderizarem como um card unico na esteira e avancarem de status juntas.
create index if not exists idx_orders_group on public.orders(order_group_id);
