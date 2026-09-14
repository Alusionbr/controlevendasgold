-- Align the financial ledger with the business rules already used by the UI:
-- direct admin sales are cash sales, while purchases create payables according
-- to their recorded payment mode and paid amount.

begin;

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
    new.business_id, 'receivable', 'sale', coalesce(v_description, 'Venda'),
    new.date, new.date, new.net_revenue, new.net_revenue, new.client_id,
    'sale', new.id, 'a_vista', coalesce(new.notes, ''), auth.uid()
  )
  on conflict (business_id, source_type, source_id)
    where source_id is not null do nothing;

  return new;
end;
$sale_receivable$;

revoke all on function public.create_sale_receivable() from public, anon;

-- Repair direct-sale entries created by the previous trigger. This update
-- activates trg_financial_entries_status, which derives status='paid' and
-- settled_at from paid_amount.
update public.financial_entries fe
   set paid_amount = fe.amount,
       payment_method = coalesce(nullif(fe.payment_method, ''), 'a_vista')
  from public.sales s
 where fe.source_type = 'sale'
   and fe.source_id = s.id
   and fe.business_id = s.business_id
   and s.seller_id is null
   and coalesce(s.origin, '') <> 'consignado'
   and coalesce(s.net_revenue, 0) > 0
   and (fe.paid_amount <> fe.amount or fe.status <> 'paid');

-- Backfill purchase payables that predate the trigger or were missed by an
-- interrupted legacy flow. The partial unique index makes this idempotent.
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
