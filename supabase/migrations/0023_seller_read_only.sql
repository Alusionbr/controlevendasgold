-- Controle360 — modelo oficial de vendedor somente leitura.
--
-- A interface já restringe o vendedor à tela "Minha conta", mas a regra
-- precisa existir também no banco. Removemos políticas de escrita e leitura
-- de módulos operacionais que não pertencem mais ao papel vendedor.
-- O admin mantém acesso total pelas políticas *_all_admin.

begin;

-- Cadastros e operações
drop policy if exists clients_insert_seller on public.clients;
drop policy if exists clients_update_seller on public.clients;
drop policy if exists clients_select_seller on public.clients;

drop policy if exists consignment_events_insert_seller on public.consignment_events;
drop policy if exists consignment_events_select_seller on public.consignment_events;

drop policy if exists consignments_insert_seller on public.consignments;
drop policy if exists consignments_update_seller on public.consignments;
drop policy if exists consignments_select_seller on public.consignments;

drop policy if exists operational_movements_insert_seller on public.operational_movements;
drop policy if exists operational_movements_select_seller on public.operational_movements;

drop policy if exists order_drafts_insert_seller on public.order_drafts;
drop policy if exists order_drafts_update_seller on public.order_drafts;
drop policy if exists order_drafts_delete_seller on public.order_drafts;
drop policy if exists order_drafts_select_seller on public.order_drafts;

drop policy if exists orders_insert_seller on public.orders;
drop policy if exists orders_update_seller on public.orders;
drop policy if exists orders_select_seller on public.orders;

drop policy if exists sale_cart_items_insert_seller on public.sale_cart_items;
drop policy if exists sale_cart_items_update_seller on public.sale_cart_items;
drop policy if exists sale_cart_items_delete_seller on public.sale_cart_items;
drop policy if exists sale_cart_items_select_seller on public.sale_cart_items;

drop policy if exists sale_carts_insert_seller on public.sale_carts;
drop policy if exists sale_carts_update_seller on public.sale_carts;
drop policy if exists sale_carts_delete_seller on public.sale_carts;
drop policy if exists sale_carts_select_seller on public.sale_carts;

drop policy if exists sales_insert_seller on public.sales;
drop policy if exists sales_update_seller on public.sales;
drop policy if exists sales_select_seller on public.sales;

drop policy if exists sales_goals_seller_select on public.sales_goals;
drop policy if exists seller_prices_select_seller on public.seller_prices;
drop policy if exists seller_settings_select_seller on public.seller_settings;
drop policy if exists seller_stock_adjustments_select_seller on public.seller_stock_adjustments;
drop policy if exists stock_movements_seller_insert on public.stock_movements;
drop policy if exists stock_movements_seller_select on public.stock_movements;
drop policy if exists tasks_insert_seller_help_report on public.tasks;
drop policy if exists tasks_select_seller_help_report on public.tasks;

-- RPCs antigas que permitiam ao vendedor baixar ou sobrescrever o próprio
-- estoque. O admin continua usando os fluxos administrativos autorizados.
revoke execute on function public.consume_seller_stock(uuid, numeric) from authenticated;
revoke execute on function public.seller_adjust_own_stock(uuid, numeric, text) from authenticated;

-- Helper de trigger: nunca deve ser chamado diretamente pela Data API.
revoke execute on function public.fill_seller_sale_cost() from public, anon, authenticated;

commit;
