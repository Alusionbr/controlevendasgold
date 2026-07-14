-- Controle360 - compras agrupadas e atômicas.

create or replace function public.create_purchase_payable()
returns trigger
language plpgsql
set search_path = public
as $purchase_payable$
declare
  v_description text;
begin
  v_description := 'Compra ' || to_char(new.date, 'DD/MM/YYYY');

  insert into public.financial_entries (
    business_id, direction, category, description, issue_date, due_date,
    amount, paid_amount, supplier_id, source_type, source_id, payment_method, notes, created_by
  ) values (
    new.business_id, 'payable', 'purchase', v_description, new.date,
    coalesce(new.due_date, new.date), new.total_cost, new.paid_amount, new.supplier_id,
    'purchase_group', new.purchase_group_id, coalesce(new.payment_mode, 'a_prazo'),
    coalesce(new.notes, ''), auth.uid()
  )
  on conflict (business_id, source_type, source_id) where source_id is not null
  do update set
    amount = public.financial_entries.amount + excluded.amount,
    paid_amount = public.financial_entries.paid_amount + excluded.paid_amount,
    due_date = excluded.due_date,
    supplier_id = coalesce(excluded.supplier_id, public.financial_entries.supplier_id),
    payment_method = excluded.payment_method,
    notes = excluded.notes;

  return new;
end;
$purchase_payable$;

create or replace function public.register_purchase_group(
  p_supplier_id uuid,
  p_date date,
  p_due_date date,
  p_payment_mode text,
  p_paid_amount numeric,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $purchase_group$
declare
  v_business_id uuid;
  v_group_id uuid := gen_random_uuid();
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_total_cost numeric;
  v_unit_cost numeric;
  v_total numeric;
  v_paid numeric := coalesce(p_paid_amount, 0);
  v_paid_allocated numeric := 0;
  v_paid_share numeric;
  v_count integer;
  v_index integer := 0;
  v_stock numeric;
  v_avg_cost numeric;
  v_next_avg numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode registrar compras';
  end if;

  v_business_id := (select public.my_business_id());
  if v_business_id is null then raise exception 'Negócio não encontrado'; end if;
  if p_date is null then raise exception 'Data da compra é obrigatória'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um item à compra';
  end if;

  select coalesce(sum((item->>'totalCost')::numeric), 0), count(*)
    into v_total, v_count
  from jsonb_array_elements(p_items) item;

  if v_total <= 0 then raise exception 'Valor total da compra precisa ser maior que zero'; end if;
  if v_paid < 0 or v_paid > v_total then
    raise exception 'Valor pago precisa ficar entre zero e o total da compra';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    v_product_id := (v_item->>'productId')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_total_cost := (v_item->>'totalCost')::numeric;

    if v_quantity <= 0 or v_total_cost <= 0 then
      raise exception 'Quantidade e valor dos itens precisam ser maiores que zero';
    end if;

    select current_stock, avg_cost into v_stock, v_avg_cost
    from public.products
    where id = v_product_id and business_id = v_business_id
    for update;

    if not found then raise exception 'Produto não encontrado no negócio'; end if;

    v_unit_cost := v_total_cost / v_quantity;
    v_next_avg := ((v_stock * v_avg_cost) + v_total_cost) / (v_stock + v_quantity);
    if v_index = v_count then
      v_paid_share := v_paid - v_paid_allocated;
    else
      v_paid_share := round((v_total_cost / v_total) * v_paid, 2);
      v_paid_allocated := v_paid_allocated + v_paid_share;
    end if;

    update public.products
      set current_stock = v_stock + v_quantity, avg_cost = v_next_avg
      where id = v_product_id;

    insert into public.purchases (
      business_id, purchase_group_id, date, due_date, supplier_id, product_id,
      quantity, total_cost, unit_cost, payment_mode, paid_amount, notes
    ) values (
      v_business_id, v_group_id, p_date, coalesce(p_due_date, p_date), p_supplier_id,
      v_product_id, v_quantity, v_total_cost, v_unit_cost,
      coalesce(p_payment_mode, 'a_prazo'), v_paid_share, coalesce(p_notes, '')
    );

    insert into public.stock_movements (
      business_id, date, type, product_id, quantity, unit_cost, total_cost,
      ref_type, ref_id, notes
    ) values (
      v_business_id, p_date, 'entrada_compra', v_product_id, v_quantity,
      v_unit_cost, v_total_cost, 'purchase_group', v_group_id, coalesce(p_notes, '')
    );
  end loop;

  return v_group_id;
end;
$purchase_group$;

revoke all on function public.register_purchase_group(uuid, date, date, text, numeric, text, jsonb) from public, anon;
grant execute on function public.register_purchase_group(uuid, date, date, text, numeric, text, jsonb) to authenticated;
revoke all on function public.create_purchase_payable() from public, anon;
