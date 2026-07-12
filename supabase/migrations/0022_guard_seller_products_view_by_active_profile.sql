-- Controle360 - a view mascarada nunca entrega produtos a conta inativa.
-- A verificacao fica embutida na view para nao depender de inlining/cache de
-- helpers SECURITY DEFINER dentro de outra view privilegiada.

create or replace view public.seller_products
with (security_invoker = false)
as
select
  p.id,
  p.business_id,
  p.name,
  p.type,
  p.unit,
  null::numeric as current_stock,
  p.sale_price,
  p.default_price,
  p.price_floor,
  p.min_stock,
  p.notes,
  p.created_at,
  p.updated_at,
  (p.current_stock > 0) as stock_available,
  true as stock_hidden
from public.products p
where exists (
  select 1
  from public.profiles caller
  where caller.id = auth.uid()
    and caller.active = true
    and caller.business_id = p.business_id
);

revoke all on public.seller_products from public, anon;
grant select on public.seller_products to authenticated;
