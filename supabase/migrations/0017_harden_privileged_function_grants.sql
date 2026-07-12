-- Controle360 - restringe a superficie RPC de funcoes SECURITY DEFINER.
--
-- Funcoes de trigger nunca devem ser chamadas pelo Data API. Helpers usados
-- pelas policies precisam ser executaveis apenas por usuarios autenticados.
-- O lookup de carrinho publico e consumido exclusivamente pela Edge Function
-- public-cart, que usa service_role no servidor.

revoke all on function public.current_profile() from public, anon;
grant execute on function public.current_profile() to authenticated, service_role;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.my_business_id() from public, anon;
grant execute on function public.my_business_id() to authenticated, service_role;

revoke all on function public.public_cart_lookup(uuid) from public, anon, authenticated;
grant execute on function public.public_cart_lookup(uuid) to service_role;

revoke all on function public.enforce_operational_movement_lock() from public, anon, authenticated;
revoke all on function public.enforce_order_approval_lock() from public, anon, authenticated;
revoke all on function public.enforce_profile_privilege_guard() from public, anon, authenticated;
revoke all on function public.enforce_sale_price_floor() from public, anon, authenticated;
revoke all on function public.fill_consignment_cost_at_send() from public, anon, authenticated;

-- RPCs intencionalmente disponiveis ao vendedor autenticado.
revoke all on function public.consume_seller_stock(uuid, numeric) from public, anon;
grant execute on function public.consume_seller_stock(uuid, numeric) to authenticated, service_role;

revoke all on function public.seller_adjust_own_stock(uuid, numeric, text) from public, anon;
grant execute on function public.seller_adjust_own_stock(uuid, numeric, text) to authenticated, service_role;
