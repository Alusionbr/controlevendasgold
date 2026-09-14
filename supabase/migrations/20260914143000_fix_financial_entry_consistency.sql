-- Support cash, partial and credit terms for manual direct sales without
-- guessing the settlement state of historical sales.

begin;

alter table public.sales
  add column if not exists payment_mode text,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists due_date date,
  add column if not exists payment_method text;

alter table public.sales
  drop constraint if exists sales_payment_mode_valid,
  add constraint sales_payment_mode_valid
    check (payment_mode is null or payment_mode in ('avista', 'parcial', 'a_prazo')),
  drop constraint if exists sales_paid_amount_valid,
  add constraint sales_paid_amount_valid
    check (
      paid_amount >= 0
      and paid_amount <= greatest(coalesce(net_revenue, 0), 0)
    );

create or replace function public.create_sale_receivable()
returns trigger
language plpgsql
set search_path = public
as $sale_receivable$
declare
  v_description text;
begin
  if new.seller_id is not null
     or coalesce(new.origin, '') = 'consignado'
     or coalesce(new.net_revenue, 0) <= 0 then
    return new;
  end if;

  select 'Venda - ' || p.name
    into v_description
    from public.products p
   where p.id = new.product_id;

  insert into public.financial_entries (
    business_id, direction, category, description, issue_date, due_date,
    amount, paid_amount, client_id, source_type, source_id, payment_method,
    notes, created_by
  ) values (
    new.business_id,
    'receivable',
    'sale',
    coalesce(v_description, 'Venda'),
    new.date,
    case
      when new.payment_mode = 'avista' then new.date
      else coalesce(new.due_date, new.date)
    end,
    new.net_revenue,
    least(coalesce(new.paid_amount, 0), new.net_revenue),
    new.client_id,
    'sale',
    new.id,
    nullif(btrim(coalesce(new.payment_method, '')), ''),
    coalesce(new.notes, ''),
    auth.uid()
  )
  on conflict (business_id, source_type, source_id)
    where source_id is not null do nothing;

  return new;
end;
$sale_receivable$;

revoke all on function public.create_sale_receivable() from public, anon;

-- Historical direct sales keep their current financial status because the old
-- records do not say whether they were cash, partial or credit sales. They must
-- be reviewed by a person instead of being marked paid automatically.

-- Backfill purchase payables from explicit purchase fields only. The partial
-- unique index makes the statement safe to run again.
insert into public.financial_entries (
  business_id, direction, category, description, issue_date, due_date,
  amount, paid_amount, supplier_id, source_type, source_id, payment_method,
  notes, created_by
)
select
  p.business_id,
  'payable',
  'purchase',
  'Compra - ' || coalesce(pr.name, 'Produto'),
  p.date,
  coalesce(p.due_date, p.date),
  p.total_cost,
  p.paid_amount,
  p.supplier_id,
  'purchase',
  p.id,
  coalesce(nullif(p.payment_mode, ''), 'a_prazo'),
  coalesce(p.notes, ''),
  null
from public.purchases p
left join public.products pr on pr.id = p.product_id
where p.total_cost > 0
on conflict (business_id, source_type, source_id)
  where source_id is not null do nothing;

commit;
