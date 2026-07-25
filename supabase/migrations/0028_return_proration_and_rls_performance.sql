-- Ajusta devoluções com desconto/taxas proporcionalmente e elimina
-- reavaliações desnecessárias de auth.uid() nas policies mais acessadas.

begin;

create or replace function public.register_sale_return(
  p_sale_id uuid,
  p_quantity numeric,
  p_notes text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $register_sale_return$
declare
  v_business_id uuid;
  v_sale public.sales%rowtype;
  v_product public.products%rowtype;
  v_already_returned numeric;
  v_return_id uuid;
  v_fraction numeric;
  v_gross numeric;
  v_net numeric;
  v_cogs numeric;
  v_profit numeric;
  v_percent_fees numeric;
  v_receivable public.financial_entries%rowtype;
  v_new_receivable numeric;
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode registrar devoluções';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Informe uma quantidade maior que zero';
  end if;

  v_business_id := (select public.my_business_id());
  select * into v_sale
  from public.sales
  where id = p_sale_id
    and business_id = v_business_id
    and parent_sale_id is null
  for update;
  if not found then raise exception 'Venda original não encontrada'; end if;
  if v_sale.quantity <= 0 then raise exception 'Venda original inválida'; end if;

  select coalesce(-sum(quantity), 0) into v_already_returned
  from public.sales
  where parent_sale_id = v_sale.id and origin = 'devolucao';
  if v_already_returned + p_quantity > v_sale.quantity then
    raise exception 'A devolução acumulada não pode superar a quantidade vendida';
  end if;

  select * into v_product
  from public.products
  where id = v_sale.product_id and business_id = v_business_id
  for update;
  if not found then raise exception 'Produto da venda não encontrado'; end if;

  v_fraction := p_quantity / v_sale.quantity;
  v_gross := -(coalesce(v_sale.gross_revenue, v_sale.quantity * v_sale.unit_price) * v_fraction);
  v_net := -(coalesce(v_sale.net_revenue, v_sale.quantity * v_sale.unit_price) * v_fraction);
  v_cogs := -(coalesce(v_sale.cogs, v_sale.quantity * coalesce(v_sale.unit_cost, 0)) * v_fraction);
  v_profit := -(coalesce(v_sale.gross_profit, coalesce(v_sale.net_revenue, 0) - coalesce(v_sale.cogs, 0)) * v_fraction);
  v_percent_fees := -(coalesce(v_sale.percent_fees, 0) * v_fraction);

  insert into public.sales (
    business_id, date, channel, client_id, product_id, quantity,
    unit_price, discount, fixed_fees, fee_percent, percent_fees,
    unit_cost, gross_revenue, net_revenue, cogs, gross_profit, margin,
    notes, origin, origin_id, seller_id, parent_sale_id
  ) values (
    v_business_id, current_date, v_sale.channel, v_sale.client_id,
    v_sale.product_id, -p_quantity, v_sale.unit_price,
    -(coalesce(v_sale.discount, 0) * v_fraction),
    -(coalesce(v_sale.fixed_fees, 0) * v_fraction),
    v_sale.fee_percent, v_percent_fees, v_sale.unit_cost,
    v_gross, v_net, v_cogs, v_profit, coalesce(v_sale.margin, 0),
    btrim(coalesce(p_notes, '')), 'devolucao', v_sale.id,
    v_sale.seller_id, v_sale.id
  )
  returning id into v_return_id;

  if v_product.type <> 'servico' then
    update public.products
      set current_stock = current_stock + p_quantity
      where id = v_product.id;

    insert into public.stock_movements (
      business_id, date, type, product_id, quantity, unit_cost,
      total_cost, ref_type, ref_id, notes
    ) values (
      v_business_id, current_date, 'entrada_devolucao_venda',
      v_product.id, p_quantity, v_sale.unit_cost,
      p_quantity * coalesce(v_sale.unit_cost, 0),
      'sale_return', v_return_id, btrim(coalesce(p_notes, ''))
    );
  end if;

  select * into v_receivable
  from public.financial_entries
  where business_id = v_business_id
    and source_type = 'sale'
    and source_id = v_sale.id
  for update;

  if found and v_receivable.status <> 'cancelled' then
    v_new_receivable := greatest(v_receivable.amount - abs(v_net), 0);
    if v_new_receivable <= 0 then
      update public.financial_entries
        set status = 'cancelled',
            notes = concat_ws(' | ', nullif(notes, ''), 'Cancelada por devolução integral')
        where id = v_receivable.id;
    else
      update public.financial_entries
        set amount = v_new_receivable,
            paid_amount = least(paid_amount, v_new_receivable),
            notes = concat_ws(' | ', nullif(notes, ''), 'Ajustada por devolução')
        where id = v_receivable.id;
    end if;
  end if;

  return v_return_id;
end;
$register_sale_return$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.is_active_user()))
  with check (id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists seller_stock_select_seller on public.seller_stock;
create policy seller_stock_select_seller on public.seller_stock
  for select to authenticated
  using (seller_id = (select auth.uid()) and (select public.is_active_user()));

drop policy if exists seller_products_select_active_business on public.seller_products;
create policy seller_products_select_active_business on public.seller_products
  for select to authenticated
  using (
    exists (
      select 1
      from public.profiles caller
      where caller.id = (select auth.uid())
        and caller.active = true
        and caller.business_id = seller_products.business_id
    )
  );

create index if not exists idx_order_drafts_product_id
  on public.order_drafts(product_id);

commit;
