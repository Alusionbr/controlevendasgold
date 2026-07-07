-- =============================================================================
-- Controle360 - carrinho de vendas, permissões por vendedor e comprovantes
-- =============================================================================

create extension if not exists pgcrypto;

-- Configuracoes finas por vendedor. Ausencia de linha = configuracao segura:
-- sem consignado, com pedido ao estoque do admin permitido e link publico
-- permitido somente para pagamento a vista.
create table if not exists public.seller_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  allow_admin_stock_sales boolean not null default true,
  allow_consignment boolean not null default false,
  allow_public_cart_links boolean not null default true,
  max_discount_percent numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id)
);

drop trigger if exists trg_seller_settings_updated_at on public.seller_settings;
create trigger trg_seller_settings_updated_at
  before update on public.seller_settings
  for each row execute function public.set_updated_at();

create table if not exists public.sale_carts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  source text not null default 'seller_stock'
    check (source in ('seller_stock', 'admin_stock')),
  payment_mode text not null default 'avista'
    check (payment_mode in ('avista', 'consignado')),
  status text not null default 'draft'
    check (status in (
      'draft',
      'shared',
      'submitted',
      'pending_approval',
      'approved',
      'partially_approved',
      'rejected',
      'converted',
      'expired'
    )),
  channel text default 'WhatsApp',
  customer_name text,
  customer_phone text,
  customer_notes text,
  public_token uuid unique default gen_random_uuid(),
  public_expires_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  payment_proof_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_sale_carts_updated_at on public.sale_carts;
create trigger trg_sale_carts_updated_at
  before update on public.sale_carts
  for each row execute function public.set_updated_at();

create table if not exists public.sale_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.sale_carts(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price > 0),
  approved_quantity numeric,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_sale_cart_items_updated_at on public.sale_cart_items;
create trigger trg_sale_cart_items_updated_at
  before update on public.sale_cart_items
  for each row execute function public.set_updated_at();

create index if not exists idx_seller_settings_business on public.seller_settings(business_id);
create index if not exists idx_sale_carts_business on public.sale_carts(business_id);
create index if not exists idx_sale_carts_seller on public.sale_carts(seller_id);
create index if not exists idx_sale_carts_status on public.sale_carts(business_id, status);
create index if not exists idx_sale_carts_public_token on public.sale_carts(public_token);
create index if not exists idx_sale_cart_items_cart on public.sale_cart_items(cart_id);
create index if not exists idx_sale_cart_items_business on public.sale_cart_items(business_id);

alter table public.seller_settings enable row level security;
alter table public.sale_carts enable row level security;
alter table public.sale_cart_items enable row level security;

drop policy if exists seller_settings_all_admin on public.seller_settings;
create policy seller_settings_all_admin on public.seller_settings
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_settings_select_seller on public.seller_settings;
create policy seller_settings_select_seller on public.seller_settings
  for select using (seller_id = auth.uid());

drop policy if exists sale_carts_all_admin on public.sale_carts;
create policy sale_carts_all_admin on public.sale_carts
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists sale_carts_select_seller on public.sale_carts;
create policy sale_carts_select_seller on public.sale_carts
  for select using (seller_id = auth.uid());

drop policy if exists sale_carts_insert_seller on public.sale_carts;
create policy sale_carts_insert_seller on public.sale_carts
  for insert with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists sale_carts_update_seller on public.sale_carts;
create policy sale_carts_update_seller on public.sale_carts
  for update using (seller_id = auth.uid() and status in ('draft', 'shared', 'submitted', 'pending_approval'))
  with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists sale_cart_items_all_admin on public.sale_cart_items;
create policy sale_cart_items_all_admin on public.sale_cart_items
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists sale_cart_items_select_seller on public.sale_cart_items;
create policy sale_cart_items_select_seller on public.sale_cart_items
  for select using (
    exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id and c.seller_id = auth.uid()
    )
  );

drop policy if exists sale_cart_items_insert_seller on public.sale_cart_items;
create policy sale_cart_items_insert_seller on public.sale_cart_items
  for insert with check (
    business_id = public.my_business_id()
    and exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared')
    )
  );

drop policy if exists sale_cart_items_update_seller on public.sale_cart_items;
create policy sale_cart_items_update_seller on public.sale_cart_items
  for update using (
    exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared')
    )
  )
  with check (
    business_id = public.my_business_id()
    and exists (
      select 1 from public.sale_carts c
      where c.id = sale_cart_items.cart_id
        and c.seller_id = auth.uid()
        and c.status in ('draft', 'shared')
    )
  );

-- Bucket privado para comprovantes. Arquivos nao tem URL publica permanente.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

drop policy if exists payment_proofs_auth_insert on storage.objects;
create policy payment_proofs_auth_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and exists (
      select 1
      from public.sale_carts c
      where c.id::text = (storage.foldername(name))[1]
        and (
          c.seller_id = auth.uid()
          or (public.is_admin() and c.business_id = public.my_business_id())
        )
    )
  );

drop policy if exists payment_proofs_auth_select on storage.objects;
create policy payment_proofs_auth_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1
      from public.sale_carts c
      where c.id::text = (storage.foldername(name))[1]
        and (
          c.seller_id = auth.uid()
          or (public.is_admin() and c.business_id = public.my_business_id())
        )
    )
  );

-- RPC publica: consulta somente carrinhos compartilhados e ainda validos.
create or replace function public.public_cart_lookup(token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cart_row public.sale_carts;
begin
  select *
    into cart_row
  from public.sale_carts
  where public_token = token
    and status in ('shared', 'submitted', 'pending_approval')
    and payment_mode = 'avista'
    and (public_expires_at is null or public_expires_at > now());

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'cart', jsonb_build_object(
      'id', cart_row.id,
      'source', cart_row.source,
      'status', cart_row.status,
      'channel', cart_row.channel,
      'customer_name', cart_row.customer_name,
      'customer_phone', cart_row.customer_phone,
      'customer_notes', cart_row.customer_notes,
      'public_expires_at', cart_row.public_expires_at
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'product_id', i.product_id,
        'product_name', p.name,
        'unit', p.unit,
        'quantity', i.quantity,
        'unit_price', i.unit_price
      ) order by i.created_at)
      from public.sale_cart_items i
      join public.products p on p.id = i.product_id
      where i.cart_id = cart_row.id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.public_cart_lookup(uuid) to anon, authenticated;


-- Baixa segura do estoque proprio do vendedor. Evita abrir UPDATE livre em
-- seller_stock e impede saldo negativo.
create or replace function public.consume_seller_stock(p_product_id uuid, p_quantity numeric)
returns public.seller_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.seller_stock;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  if p_quantity <= 0 then
    raise exception 'Quantidade precisa ser maior que zero.';
  end if;

  select * into current_row
  from public.seller_stock
  where seller_id = auth.uid()
    and product_id = p_product_id
  for update;

  if not found or current_row.quantity < p_quantity then
    raise exception 'Estoque proprio insuficiente.';
  end if;

  update public.seller_stock
  set quantity = quantity - p_quantity
  where id = current_row.id
  returning * into current_row;

  return current_row;
end;
$$;

grant execute on function public.consume_seller_stock(uuid, numeric) to authenticated;
