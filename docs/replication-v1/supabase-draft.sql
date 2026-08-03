-- DRAFT ONLY — NÃO APLICAR SEM REVISÃO
-- Controle360: reposição com dívida, pagamentos fracionados, devoluções, desperdícios e brindes.

-- 1. Conta corrente do vendedor
create table if not exists public.seller_account_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'debit_replenishment',
    'payment',
    'return_credit',
    'manual_adjustment',
    'writeoff',
    'bonus_credit'
  )),
  amount numeric not null check (amount >= 0),
  direction text not null check (direction in ('debit','credit')),
  source_type text,
  source_id uuid,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 2. Pagamentos fracionados
create table if not exists public.seller_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_date date not null default current_date,
  method text,
  proof_url text,
  notes text,
  received_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 3. Movimentações operacionais
create table if not exists public.operational_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('return','waste','gift','manual_adjustment')),
  status text not null default 'pending',
  product_id uuid not null references public.products(id),
  quantity_declared numeric not null check (quantity_declared > 0),
  quantity_received numeric,
  seller_id uuid references public.profiles(id),
  client_id uuid references public.clients(id),
  origin_type text,
  destination_type text,
  reason text not null,
  notes text,
  tracking_code text,
  carrier text,
  affects_stock boolean not null default false,
  affects_finance boolean not null default false,
  unit_value numeric,
  total_value numeric,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  confirmed_at timestamptz
);

-- Índices sugeridos
create index if not exists idx_seller_account_entries_seller on public.seller_account_entries (business_id, seller_id, created_at desc);
create index if not exists idx_seller_payments_seller on public.seller_payments (business_id, seller_id, payment_date desc);
create index if not exists idx_operational_movements_business on public.operational_movements (business_id, type, status, created_at desc);
create index if not exists idx_operational_movements_seller on public.operational_movements (business_id, seller_id, status);

-- RLS e funções devem ser desenhadas após revisão das policies existentes.
