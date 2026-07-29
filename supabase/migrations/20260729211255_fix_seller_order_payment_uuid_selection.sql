-- Corrige selecao de UUIDs no RPC de pagamento por pedido.
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

revoke all on function public.register_seller_order_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.register_seller_order_payment(uuid, numeric, text, text) to authenticated;
