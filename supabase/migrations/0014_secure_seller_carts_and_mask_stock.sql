-- Controle360 - seguranca do carrinho do vendedor e mascara de estoque central

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
where p.business_id = public.my_business_id();

grant select on public.seller_products to authenticated;

create or replace function public.seller_cart_permission_ok(
  p_seller_id uuid,
  p_source text,
  p_payment_mode text,
  p_status text
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    p_seller_id = auth.uid()
    and (
      p_source <> 'admin_stock'
      or coalesce((
        select ss.allow_admin_stock_sales
        from public.seller_settings ss
        where ss.seller_id = p_seller_id
        limit 1
      ), true)
    )
    and (
      p_payment_mode <> 'consignado'
      or coalesce((
        select ss.allow_consignment
        from public.seller_settings ss
        where ss.seller_id = p_seller_id
        limit 1
      ), false)
    )
    and (
      p_status <> 'shared'
      or (
        p_payment_mode = 'avista'
        and coalesce((
          select ss.allow_public_cart_links
          from public.seller_settings ss
          where ss.seller_id = p_seller_id
          limit 1
        ), true)
      )
    );
$$;

revoke all on function public.seller_cart_permission_ok(uuid, text, text, text) from public;
grant execute on function public.seller_cart_permission_ok(uuid, text, text, text) to authenticated;

drop policy if exists sale_carts_insert_seller on public.sale_carts;
create policy sale_carts_insert_seller on public.sale_carts
  for insert to authenticated
  with check (
    seller_id = auth.uid()
    and business_id = public.my_business_id()
    and status = 'draft'
    and public.seller_cart_permission_ok(seller_id, source, payment_mode, status)
  );

drop policy if exists sale_carts_update_seller on public.sale_carts;
create policy sale_carts_update_seller on public.sale_carts
  for update to authenticated
  using (
    seller_id = auth.uid()
    and status in ('draft', 'shared', 'submitted', 'pending_approval')
  )
  with check (
    seller_id = auth.uid()
    and business_id = public.my_business_id()
    and status in ('draft', 'shared', 'submitted', 'pending_approval', 'converted')
    and (status <> 'converted' or source = 'seller_stock')
    and public.seller_cart_permission_ok(seller_id, source, payment_mode, status)
  );

drop policy if exists sale_cart_items_insert_seller on public.sale_cart_items;
create policy sale_cart_items_insert_seller on public.sale_cart_items
  for insert to authenticated
  with check (
    business_id = public.my_business_id()
    and exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared', 'submitted', 'pending_approval')
    )
  );

drop policy if exists sale_cart_items_update_seller on public.sale_cart_items;
create policy sale_cart_items_update_seller on public.sale_cart_items
  for update to authenticated
  using (
    exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared', 'submitted', 'pending_approval')
    )
  )
  with check (
    business_id = public.my_business_id()
    and exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared', 'submitted', 'pending_approval')
    )
  );

drop policy if exists sale_cart_items_delete_seller on public.sale_cart_items;
create policy sale_cart_items_delete_seller on public.sale_cart_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared', 'submitted', 'pending_approval')
    )
  );
