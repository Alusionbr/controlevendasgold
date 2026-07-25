-- Controle360 - endurecimento para uso oficial.
--
-- 1. Preserva o histórico ao impedir que a exclusão de um produto apague
--    compras, vendas, pedidos e movimentações em cascata.
-- 2. Torna pagamento de vendedor, devolução, desperdício e conversão de
--    carrinho público operações atômicas no banco.

begin;

-- Histórico contábil/operacional nunca deve desaparecer com o cadastro do
-- produto. As tabelas de configuração continuam com cascade, mas tabelas que
-- registram fatos passam a bloquear a exclusão do produto referenciado.
alter table public.purchases
  drop constraint if exists purchases_product_id_fkey,
  add constraint purchases_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

alter table public.stock_movements
  drop constraint if exists stock_movements_product_id_fkey,
  add constraint stock_movements_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

alter table public.productions
  drop constraint if exists productions_final_product_id_fkey,
  add constraint productions_final_product_id_fkey
    foreign key (final_product_id) references public.products(id) on delete restrict;

alter table public.sales
  drop constraint if exists sales_product_id_fkey,
  add constraint sales_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

alter table public.orders
  drop constraint if exists orders_product_id_fkey,
  add constraint orders_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

alter table public.consignments
  drop constraint if exists consignments_product_id_fkey,
  add constraint consignments_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

alter table public.operational_movements
  drop constraint if exists operational_movements_product_id_fkey,
  add constraint operational_movements_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

-- Pagamento e crédito correspondente são uma única transação.
create or replace function public.register_seller_payment(
  p_seller_id uuid,
  p_amount numeric,
  p_method text default null,
  p_notes text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $register_seller_payment$
declare
  v_business_id uuid;
  v_payment_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode registrar pagamentos';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Informe um valor maior que zero';
  end if;

  v_business_id := (select public.my_business_id());
  if not exists (
    select 1 from public.profiles
    where id = p_seller_id
      and business_id = v_business_id
      and role = 'vendedor'
      and active = true
  ) then
    raise exception 'Vendedor não encontrado ou inativo';
  end if;

  insert into public.seller_payments (
    business_id, seller_id, amount, payment_date, method, notes, received_by
  ) values (
    v_business_id, p_seller_id, p_amount, current_date,
    nullif(btrim(coalesce(p_method, '')), ''),
    btrim(coalesce(p_notes, '')), auth.uid()
  )
  returning id into v_payment_id;

  insert into public.seller_account_entries (
    business_id, seller_id, type, direction, amount,
    source_type, source_id, notes, created_by
  ) values (
    v_business_id, p_seller_id, 'payment', 'credit', p_amount,
    'seller_payment', v_payment_id, btrim(coalesce(p_notes, '')), auth.uid()
  );

  return v_payment_id;
end;
$register_seller_payment$;

-- Devolução: valida o total acumulado, grava a venda negativa, devolve o
-- estoque e registra a movimentação na mesma transação.
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
  v_gross numeric;
  v_cogs numeric;
  v_profit numeric;
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

  v_gross := -(p_quantity * coalesce(v_sale.unit_price, 0));
  v_cogs := -(p_quantity * coalesce(v_sale.unit_cost, 0));
  v_profit := v_gross - v_cogs;

  insert into public.sales (
    business_id, date, channel, client_id, product_id, quantity,
    unit_price, discount, fixed_fees, fee_percent, percent_fees,
    unit_cost, gross_revenue, net_revenue, cogs, gross_profit, margin,
    notes, origin, origin_id, seller_id, parent_sale_id
  ) values (
    v_business_id, current_date, v_sale.channel, v_sale.client_id,
    v_sale.product_id, -p_quantity, v_sale.unit_price, 0, 0, 0, 0,
    v_sale.unit_cost, v_gross, v_gross, v_cogs, v_profit, 0,
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

  -- Ajusta a conta a receber da venda própria. Vendas de vendedor e
  -- consignadas não geram financial_entries por regra do sistema.
  select * into v_receivable
  from public.financial_entries
  where business_id = v_business_id
    and source_type = 'sale'
    and source_id = v_sale.id
  for update;

  if found and v_receivable.status <> 'cancelled' then
    v_new_receivable := greatest(v_receivable.amount - abs(v_gross), 0);
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

-- Desperdício: baixa estoque e registra a movimentação de forma atômica.
create or replace function public.register_sale_waste(
  p_sale_id uuid,
  p_quantity numeric,
  p_notes text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $register_sale_waste$
declare
  v_business_id uuid;
  v_sale public.sales%rowtype;
  v_product public.products%rowtype;
  v_movement_id uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode registrar desperdícios';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Informe uma quantidade maior que zero';
  end if;

  v_business_id := (select public.my_business_id());
  select * into v_sale
  from public.sales
  where id = p_sale_id and business_id = v_business_id
  for update;
  if not found then raise exception 'Venda não encontrada'; end if;

  select * into v_product
  from public.products
  where id = v_sale.product_id and business_id = v_business_id
  for update;
  if not found then raise exception 'Produto da venda não encontrado'; end if;
  if v_product.type = 'servico' then raise exception 'Serviço não possui estoque físico'; end if;
  if v_product.current_stock < p_quantity then
    raise exception 'Estoque insuficiente para registrar o desperdício';
  end if;

  update public.products
    set current_stock = current_stock - p_quantity
    where id = v_product.id;

  insert into public.stock_movements (
    business_id, date, type, product_id, quantity, unit_cost,
    total_cost, ref_type, ref_id, notes
  ) values (
    v_business_id, current_date, 'saida_desperdicio', v_product.id,
    -p_quantity, v_sale.unit_cost,
    -(p_quantity * coalesce(v_sale.unit_cost, 0)),
    'sale', v_sale.id, btrim(coalesce(p_notes, ''))
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$register_sale_waste$;

-- Um carrinho público enviado precisa aparecer na esteira. A conversão cria
-- todas as linhas do pedido e marca o carrinho em uma única transação.
create or replace function public.convert_public_cart_to_orders(p_cart_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $convert_public_cart_to_orders$
declare
  v_business_id uuid;
  v_cart public.sale_carts%rowtype;
  v_group_id uuid := gen_random_uuid();
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode converter carrinhos';
  end if;

  v_business_id := (select public.my_business_id());
  select * into v_cart
  from public.sale_carts
  where id = p_cart_id and business_id = v_business_id
  for update;
  if not found then raise exception 'Carrinho não encontrado'; end if;
  if v_cart.status <> 'submitted' then
    raise exception 'Somente carrinhos enviados podem ser convertidos';
  end if;
  if not exists (select 1 from public.sale_cart_items where cart_id = v_cart.id) then
    raise exception 'Carrinho sem itens';
  end if;

  insert into public.orders (
    business_id, client_id, product_id, quantity, unit_price, due_date,
    status, notes, seller_id, approval_status, sale_type, payment_mode,
    paid_amount, order_group_id
  )
  select
    v_business_id, v_cart.client_id, item.product_id, item.quantity,
    item.unit_price, null, 'pendente',
    concat_ws(' - ',
      'Carrinho público',
      nullif(v_cart.customer_name, ''),
      nullif(v_cart.customer_phone, ''),
      nullif(v_cart.customer_notes, '')
    ),
    auth.uid(), 'aprovado', 'propria', v_cart.payment_mode,
    0, v_group_id
  from public.sale_cart_items item
  where item.cart_id = v_cart.id;

  update public.sale_carts
    set status = 'converted', approved_at = now(), approved_by = auth.uid()
    where id = v_cart.id;

  return v_group_id;
end;
$convert_public_cart_to_orders$;

revoke all on function public.register_seller_payment(uuid, numeric, text, text) from public, anon;
revoke all on function public.register_sale_return(uuid, numeric, text) from public, anon;
revoke all on function public.register_sale_waste(uuid, numeric, text) from public, anon;
revoke all on function public.convert_public_cart_to_orders(uuid) from public, anon;

grant execute on function public.register_seller_payment(uuid, numeric, text, text) to authenticated;
grant execute on function public.register_sale_return(uuid, numeric, text) to authenticated;
grant execute on function public.register_sale_waste(uuid, numeric, text) to authenticated;
grant execute on function public.convert_public_cart_to_orders(uuid) to authenticated;

commit;
