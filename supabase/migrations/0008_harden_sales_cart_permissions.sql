-- =============================================================================
-- Controle360 - endurecimento de permissoes e indices do carrinho
-- =============================================================================

revoke all on function public.consume_seller_stock(uuid, numeric) from public;
revoke all on function public.consume_seller_stock(uuid, numeric) from anon;
grant execute on function public.consume_seller_stock(uuid, numeric) to authenticated;

-- public_cart_lookup e intencionalmente publico: ele so retorna carrinhos com
-- token valido, pagamento a vista e expiracao respeitada.

create index if not exists idx_sale_cart_items_product on public.sale_cart_items(product_id);
create index if not exists idx_sale_carts_client on public.sale_carts(client_id);
create index if not exists idx_sale_carts_approved_by on public.sale_carts(approved_by);

