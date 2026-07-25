-- Substitui a view SECURITY DEFINER seller_products por um catálogo físico
-- sincronizado. O vendedor continua vendo apenas dados comerciais mascarados,
-- agora com RLS normal e sem executar a consulta com privilégios do criador.

begin;

drop view if exists public.seller_products;

create table public.seller_products (
  id uuid primary key references public.products(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  type text not null,
  unit text,
  current_stock numeric,
  sale_price numeric,
  default_price numeric,
  price_floor numeric,
  min_stock numeric,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  stock_available boolean not null,
  stock_hidden boolean not null default true,
  constraint seller_products_stock_masked check (current_stock is null),
  constraint seller_products_stock_hidden check (stock_hidden = true)
);

create index idx_seller_products_business_name
  on public.seller_products (business_id, name);

insert into public.seller_products (
  id, business_id, name, type, unit, current_stock, sale_price,
  default_price, price_floor, min_stock, notes, created_at, updated_at,
  stock_available, stock_hidden
)
select
  id, business_id, name, type, unit, null, sale_price,
  default_price, price_floor, min_stock, notes, created_at, updated_at,
  current_stock > 0, true
from public.products;

create or replace function public.sync_seller_product_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $sync_seller_product_catalog$
begin
  if tg_op = 'DELETE' then
    delete from public.seller_products where id = old.id;
    return old;
  end if;

  insert into public.seller_products (
    id, business_id, name, type, unit, current_stock, sale_price,
    default_price, price_floor, min_stock, notes, created_at, updated_at,
    stock_available, stock_hidden
  ) values (
    new.id, new.business_id, new.name, new.type, new.unit, null,
    new.sale_price, new.default_price, new.price_floor, new.min_stock,
    new.notes, new.created_at, new.updated_at, new.current_stock > 0, true
  )
  on conflict (id) do update set
    business_id = excluded.business_id,
    name = excluded.name,
    type = excluded.type,
    unit = excluded.unit,
    current_stock = null,
    sale_price = excluded.sale_price,
    default_price = excluded.default_price,
    price_floor = excluded.price_floor,
    min_stock = excluded.min_stock,
    notes = excluded.notes,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    stock_available = excluded.stock_available,
    stock_hidden = true;

  return new;
end;
$sync_seller_product_catalog$;

drop trigger if exists trg_sync_seller_product_catalog on public.products;
create trigger trg_sync_seller_product_catalog
  after insert or update or delete on public.products
  for each row execute function public.sync_seller_product_catalog();

alter table public.seller_products enable row level security;

create policy seller_products_select_active_business
  on public.seller_products
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles caller
      where caller.id = (select auth.uid())
        and caller.active = true
        and caller.business_id = seller_products.business_id
    )
  );

revoke all on public.seller_products from public, anon, authenticated;
grant select on public.seller_products to authenticated;
grant all on public.seller_products to service_role;

revoke all on function public.sync_seller_product_catalog() from public, anon, authenticated;

commit;
