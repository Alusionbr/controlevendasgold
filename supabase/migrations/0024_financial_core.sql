-- Controle360 - nÃºcleo financeiro operacional.
-- Contas a pagar/receber ficam restritas ao administrador do negÃ³cio.

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  direction text not null check (direction in ('receivable', 'payable')),
  category text not null default 'other'
    check (category in ('sale', 'purchase', 'consignment', 'commission', 'operational', 'other')),
  description text not null,
  issue_date date not null default current_date,
  due_date date,
  amount numeric(14,2) not null check (amount > 0),
  paid_amount numeric(14,2) not null default 0
    check (paid_amount >= 0 and paid_amount <= amount),
  status text not null default 'open'
    check (status in ('open', 'partial', 'paid', 'cancelled')),
  client_id uuid references public.clients(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  seller_id uuid references public.profiles(id) on delete set null,
  source_type text,
  source_id uuid,
  payment_method text,
  notes text not null default '',
  settled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financial_entries enable row level security;

drop policy if exists financial_entries_all_admin on public.financial_entries;
create policy financial_entries_all_admin
  on public.financial_entries
  for all
  to authenticated
  using (
    (select public.is_admin())
    and business_id = (select public.my_business_id())
  )
  with check (
    (select public.is_admin())
    and business_id = (select public.my_business_id())
  );

revoke all on public.financial_entries from public, anon;
grant select, insert, update, delete on public.financial_entries to authenticated;
grant all on public.financial_entries to service_role;

create index if not exists idx_financial_entries_business_due
  on public.financial_entries (business_id, due_date, status);
create index if not exists idx_financial_entries_business_direction
  on public.financial_entries (business_id, direction, issue_date desc);
create unique index if not exists idx_financial_entries_source_unique
  on public.financial_entries (business_id, source_type, source_id)
  where source_id is not null;
create index if not exists idx_financial_entries_client on public.financial_entries (client_id);
create index if not exists idx_financial_entries_supplier on public.financial_entries (supplier_id);
create index if not exists idx_financial_entries_seller on public.financial_entries (seller_id);
create index if not exists idx_financial_entries_created_by on public.financial_entries (created_by);

create or replace function public.sync_financial_entry_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' then
    new.settled_at := null;
    return new;
  end if;

  if new.paid_amount >= new.amount then
    new.status := 'paid';
    new.paid_amount := new.amount;
    new.settled_at := coalesce(new.settled_at, now());
  elsif new.paid_amount > 0 then
    new.status := 'partial';
    new.settled_at := null;
  else
    new.status := 'open';
    new.settled_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_financial_entries_status on public.financial_entries;
create trigger trg_financial_entries_status
  before insert or update of amount, paid_amount, status
  on public.financial_entries
  for each row execute function public.sync_financial_entry_status();

drop trigger if exists trg_financial_entries_updated_at on public.financial_entries;
create trigger trg_financial_entries_updated_at
  before update on public.financial_entries
  for each row execute function public.set_updated_at();

alter table public.purchases
  add column if not exists purchase_group_id uuid not null default gen_random_uuid(),
  add column if not exists due_date date,
  add column if not exists payment_mode text not null default 'a_prazo',
  add column if not exists paid_amount numeric(14,2) not null default 0;

alter table public.purchases
  drop constraint if exists purchases_paid_amount_valid,
  add constraint purchases_paid_amount_valid
    check (paid_amount >= 0 and paid_amount <= total_cost);

create index if not exists idx_purchases_business_group
  on public.purchases (business_id, purchase_group_id);

create or replace function public.create_purchase_payable()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_description text;
begin
  select 'Compra - ' || p.name into v_description
  from public.products p where p.id = new.product_id;

  insert into public.financial_entries (
    business_id, direction, category, description, issue_date, due_date,
    amount, paid_amount, supplier_id, source_type, source_id, payment_method, notes, created_by
  ) values (
    new.business_id, 'payable', 'purchase', coalesce(v_description, 'Compra'), new.date,
    coalesce(new.due_date, new.date), new.total_cost, new.paid_amount, new.supplier_id,
    'purchase', new.id, coalesce(new.payment_mode, 'a_prazo'), coalesce(new.notes, ''), auth.uid()
  )
  on conflict (business_id, source_type, source_id) where source_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_purchases_create_payable on public.purchases;
create trigger trg_purchases_create_payable
  after insert on public.purchases
  for each row execute function public.create_purchase_payable();

create or replace function public.create_sale_receivable()
returns trigger
language plpgsql
set search_path = public
as $sale_receivable$
declare
  v_description text;
begin
  if new.seller_id is not null or coalesce(new.origin, '') = 'consignado' or coalesce(new.net_revenue, 0) <= 0 then
    return new;
  end if;

  select 'Venda - ' || p.name into v_description
  from public.products p where p.id = new.product_id;

  insert into public.financial_entries (
    business_id, direction, category, description, issue_date, due_date,
    amount, paid_amount, client_id, source_type, source_id, payment_method, notes, created_by
  ) values (
    new.business_id, 'receivable', 'sale', coalesce(v_description, 'Venda'), new.date, new.date,
    new.net_revenue, 0, new.client_id, 'sale', new.id, null, coalesce(new.notes, ''), auth.uid()
  )
  on conflict (business_id, source_type, source_id) where source_id is not null do nothing;

  return new;
end;
$sale_receivable$;

drop trigger if exists trg_sales_create_receivable on public.sales;
create trigger trg_sales_create_receivable
  after insert on public.sales
  for each row execute function public.create_sale_receivable();

revoke all on function public.sync_financial_entry_status() from public, anon;
revoke all on function public.create_purchase_payable() from public, anon;
revoke all on function public.create_sale_receivable() from public, anon;

