-- Controle360 - contas e pagamentos do vendedor por pedido/carrinho.
begin;

create table if not exists public.seller_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  payment_id uuid not null references public.seller_payments(id) on delete restrict,
  order_group_id uuid not null,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, order_group_id)
);

create index if not exists idx_seller_payment_allocations_seller_group
  on public.seller_payment_allocations (business_id, seller_id, order_group_id);
create index if not exists idx_seller_payment_allocations_payment
  on public.seller_payment_allocations (payment_id);

alter table public.seller_payment_allocations enable row level security;

drop policy if exists seller_payment_allocations_all_admin on public.seller_payment_allocations;
create policy seller_payment_allocations_all_admin
  on public.seller_payment_allocations for all to authenticated
  using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_payment_allocations_select_seller on public.seller_payment_allocations;
create policy seller_payment_allocations_select_seller
  on public.seller_payment_allocations for select to authenticated
  using (seller_id = (select auth.uid()));

-- Distribui pagamentos antigos por ordem cronologica. A intersecao dos
-- intervalos cumulativos permite dividir um pagamento entre varios pedidos.
with order_debts as (
  select o.business_id, o.seller_id,
    coalesce(o.order_group_id, o.id) as order_group_id,
    min(o.created_at) as created_at,
    greatest(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0) as amount
  from public.orders o
  join public.seller_account_entries e
    on e.source_id = o.id
   and e.source_type in ('order', 'order_edit', 'order_cancel')
  where o.sale_type = 'revenda'
  group by o.business_id, o.seller_id, coalesce(o.order_group_id, o.id)
),
debt_intervals as (
  select d.*,
    coalesce(sum(d.amount) over (partition by d.business_id, d.seller_id order by d.created_at, d.order_group_id rows between unbounded preceding and 1 preceding), 0) as amount_start,
    sum(d.amount) over (partition by d.business_id, d.seller_id order by d.created_at, d.order_group_id) as amount_end
  from order_debts d where d.amount > 0
),
payment_intervals as (
  select p.*,
    coalesce(sum(p.amount) over (partition by p.business_id, p.seller_id order by p.payment_date, p.created_at, p.id rows between unbounded preceding and 1 preceding), 0) as amount_start,
    sum(p.amount) over (partition by p.business_id, p.seller_id order by p.payment_date, p.created_at, p.id) as amount_end
  from public.seller_payments p
)
insert into public.seller_payment_allocations (business_id, seller_id, payment_id, order_group_id, amount)
select p.business_id, p.seller_id, p.id, d.order_group_id,
  least(p.amount_end, d.amount_end) - greatest(p.amount_start, d.amount_start)
from payment_intervals p
join debt_intervals d
  on d.business_id = p.business_id
 and d.seller_id = p.seller_id
 and least(p.amount_end, d.amount_end) > greatest(p.amount_start, d.amount_start)
on conflict (payment_id, order_group_id) do nothing;

create or replace function public.register_seller_order_payment(
  p_order_group_id uuid,
  p_amount numeric,
  p_method text default null,
  p_notes text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $register_seller_order_payment$
declare
  v_business_id uuid;
  v_seller_id uuid;
  v_payment_id uuid;
  v_account_amount numeric;
  v_allocated numeric;
  v_open_amount numeric;
begin
  if not public.is_admin() then raise exception 'Somente o administrador pode registrar pagamentos'; end if;
  if p_order_group_id is null then raise exception 'Selecione o pedido que esta sendo pago'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;

  perform 1 from public.orders o
  where coalesce(o.order_group_id, o.id) = p_order_group_id
  order by o.id for update;

  select (array_agg(o.business_id order by o.id))[1],
    (array_agg(o.seller_id order by o.id))[1]
  into v_business_id, v_seller_id
  from public.orders o
  where coalesce(o.order_group_id, o.id) = p_order_group_id
    and o.sale_type = 'revenda' and o.approval_status = 'aprovado';

  if v_business_id is null or v_seller_id is null or v_business_id <> public.my_business_id() then
    raise exception 'Pedido de vendedor nao encontrado neste negocio';
  end if;
  if exists (
    select 1 from public.orders o
    where coalesce(o.order_group_id, o.id) = p_order_group_id
      and (o.business_id <> v_business_id or o.seller_id <> v_seller_id)
  ) then raise exception 'O grupo possui dados divergentes'; end if;

  select coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0)
  into v_account_amount
  from public.orders o
  join public.seller_account_entries e
    on e.source_id = o.id and e.source_type in ('order', 'order_edit', 'order_cancel')
  where coalesce(o.order_group_id, o.id) = p_order_group_id;

  select coalesce(sum(a.amount), 0) into v_allocated
  from public.seller_payment_allocations a
  where a.business_id = v_business_id and a.seller_id = v_seller_id
    and a.order_group_id = p_order_group_id;

  v_open_amount := greatest(v_account_amount - v_allocated, 0);
  if v_open_amount < 0.005 then raise exception 'Este pedido ja esta quitado'; end if;
  if p_amount > v_open_amount + 0.004 then raise exception 'O valor excede o saldo aberto do pedido'; end if;

  insert into public.seller_payments (business_id, seller_id, amount, payment_date, method, notes, received_by)
  values (v_business_id, v_seller_id, p_amount, current_date,
    nullif(btrim(coalesce(p_method, '')), ''), btrim(coalesce(p_notes, '')), (select auth.uid()))
  returning id into v_payment_id;

  insert into public.seller_payment_allocations (business_id, seller_id, payment_id, order_group_id, amount)
  values (v_business_id, v_seller_id, v_payment_id, p_order_group_id, p_amount);

  insert into public.seller_account_entries (
    business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by
  ) values (
    v_business_id, v_seller_id, 'payment', 'credit', p_amount, 'order_group_payment',
    p_order_group_id, btrim(coalesce(p_notes, '')), (select auth.uid())
  );
  return v_payment_id;
end;
$register_seller_order_payment$;

-- Funcao segura para a tela do vendedor. Nao libera acesso direto a pedidos.
create or replace function public.list_seller_order_accounts(p_seller_id uuid default null)
returns table (
  order_group_id uuid,
  seller_id uuid,
  created_at timestamptz,
  order_status text,
  order_total numeric,
  initial_paid numeric,
  account_amount numeric,
  paid_amount numeric,
  open_amount numeric,
  account_status text,
  items jsonb,
  payments jsonb
)
language plpgsql
security definer
set search_path = ''
as $list_seller_order_accounts$
declare
  v_caller_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role text;
  v_target_seller uuid;
begin
  select p.business_id, p.role into v_business_id, v_role
  from public.profiles p where p.id = v_caller_id and p.active = true;
  if v_business_id is null or v_role not in ('admin', 'vendedor') then raise exception 'Acesso nao autorizado'; end if;

  v_target_seller := case when v_role = 'vendedor' then v_caller_id else p_seller_id end;
  if v_target_seller is not null and not exists (
    select 1 from public.profiles p where p.id = v_target_seller
      and p.business_id = v_business_id and p.role = 'vendedor'
  ) then raise exception 'Vendedor nao encontrado'; end if;

  return query
  with group_orders as (
    select coalesce(o.order_group_id, o.id) as group_id,
      o.seller_id as target_seller_id, min(o.created_at) as group_created_at,
      min(o.status) as group_status,
      sum(o.quantity * coalesce(o.unit_price, 0)) as gross_total,
      sum(coalesce(o.paid_amount, 0)) as paid_at_order
    from public.orders o
    where o.business_id = v_business_id and (v_target_seller is null or o.seller_id = v_target_seller)
      and o.sale_type = 'revenda' and o.approval_status = 'aprovado'
    group by coalesce(o.order_group_id, o.id), o.seller_id
  ),
  group_debts as (
    select coalesce(o.order_group_id, o.id) as group_id,
      coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0) as debt
    from public.orders o
    join public.seller_account_entries e
      on e.source_id = o.id and e.source_type in ('order', 'order_edit', 'order_cancel')
    where o.business_id = v_business_id and (v_target_seller is null or o.seller_id = v_target_seller)
    group by coalesce(o.order_group_id, o.id)
  ),
  group_payments as (
    select a.order_group_id as group_id, sum(a.amount) as paid,
      jsonb_agg(jsonb_build_object(
        'date', p.payment_date, 'amount', a.amount,
        'method', p.method, 'notes', p.notes
      ) order by p.payment_date desc, p.created_at desc) as payment_list
    from public.seller_payment_allocations a
    join public.seller_payments p on p.id = a.payment_id
    where a.business_id = v_business_id and (v_target_seller is null or a.seller_id = v_target_seller)
    group by a.order_group_id
  ),
  group_items as (
    select coalesce(o.order_group_id, o.id) as group_id,
      jsonb_agg(jsonb_build_object(
        'productName', p.name, 'unit', p.unit, 'quantity', o.quantity,
        'unitPrice', o.unit_price,
        'remainingQuantity', case when c.id is null then 0
          else greatest(c.quantity_sent - c.quantity_sold - c.quantity_returned, 0) end
      ) order by p.name, o.id) as item_list
    from public.orders o
    join public.products p on p.id = o.product_id
    left join public.consignments c on c.id = o.converted_consignment_id
    where o.business_id = v_business_id and (v_target_seller is null or o.seller_id = v_target_seller)
      and o.sale_type = 'revenda' and o.approval_status = 'aprovado'
    group by coalesce(o.order_group_id, o.id)
  )
  select g.group_id, g.target_seller_id, g.group_created_at, g.group_status,
    g.gross_total, g.paid_at_order, greatest(coalesce(d.debt, 0), 0),
    coalesce(py.paid, 0), greatest(coalesce(d.debt, 0) - coalesce(py.paid, 0), 0),
    case
      when greatest(coalesce(d.debt, 0) - coalesce(py.paid, 0), 0) < 0.005 then 'quitado'
      when coalesce(py.paid, 0) + g.paid_at_order > 0 then 'parcial'
      else 'aberto'
    end,
    coalesce(i.item_list, '[]'::jsonb),
    coalesce(py.payment_list, '[]'::jsonb)
  from group_orders g
  left join group_debts d on d.group_id = g.group_id
  left join group_payments py on py.group_id = g.group_id
  left join group_items i on i.group_id = g.group_id
  order by g.group_created_at desc, g.group_id;
end;
$list_seller_order_accounts$;

revoke all on table public.seller_payment_allocations from anon;
grant select, insert, update, delete on table public.seller_payment_allocations to authenticated;
revoke all on function public.register_seller_order_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.register_seller_order_payment(uuid, numeric, text, text) to authenticated;
revoke all on function public.list_seller_order_accounts(uuid) from public, anon;
grant execute on function public.list_seller_order_accounts(uuid) to authenticated;

commit;