-- =============================================================================
-- Controle360 - Fase 3 (conta corrente do vendedor): ledger de lancamentos
-- e pagamentos fracionados, substituindo o saldo implicito que hoje reusa
-- consignments. Ver docs/replication-v1/04-fase3-ledger-vendedor.md.
-- =============================================================================

-- 1) Lancamentos: o saldo do vendedor e SEMPRE a soma disto (nunca um numero
-- sobrescrito). direction 'debit' aumenta a divida; 'credit' reduz.
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
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric not null check (amount >= 0),
  source_type text,
  source_id uuid,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_account_entries_seller
  on public.seller_account_entries (business_id, seller_id, created_at desc);

-- 2) Pagamentos fracionados: cada pagamento recebido tambem vira um
-- lancamento tipo 'payment'/credit (feito pelo mesmo admin, mesma
-- transacao logica no frontend — ver src/sellerLedger.js).
create table if not exists public.seller_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_date date not null default current_date,
  method text,
  proof_url text,
  notes text,
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_payments_seller
  on public.seller_payments (business_id, seller_id, payment_date desc);

-- 3) RLS — mesmo padrao de seller_prices/seller_stock: admin full, vendedor
-- so le as proprias linhas. Sem INSERT/UPDATE direto para vendedor: quem
-- lanca debito (aprovacao de carrinho) e credito (pagamento recebido) e
-- sempre uma acao do admin (ver src/salesCart.js approveCart e
-- src/sellerLedger.js mountAdmin).
alter table public.seller_account_entries enable row level security;
alter table public.seller_payments enable row level security;

drop policy if exists seller_account_entries_all_admin on public.seller_account_entries;
create policy seller_account_entries_all_admin on public.seller_account_entries
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_account_entries_select_seller on public.seller_account_entries;
create policy seller_account_entries_select_seller on public.seller_account_entries
  for select using (seller_id = auth.uid());

drop policy if exists seller_payments_all_admin on public.seller_payments;
create policy seller_payments_all_admin on public.seller_payments
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_payments_select_seller on public.seller_payments;
create policy seller_payments_select_seller on public.seller_payments
  for select using (seller_id = auth.uid());
