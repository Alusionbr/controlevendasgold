-- Controle360 - despacho atomico da esteira.
--
-- O campo converted_sale_id referencia exclusivamente sales(id). O fluxo de
-- revenda gravava ali o id de consignments, recebia FK 409 depois de ja ter
-- baixado estoque e deixava o card parado. Se o usuario tentasse novamente,
-- a baixa era repetida.
--
-- A partir daqui venda propria e revenda possuem referencias distintas e toda
-- a materializacao do grupo acontece em uma unica transacao Postgres.

alter table public.orders
  add column if not exists converted_consignment_id uuid;

alter table public.orders
  drop constraint if exists orders_converted_consignment_id_fkey,
  add constraint orders_converted_consignment_id_fkey
    foreign key (converted_consignment_id)
    references public.consignments(id)
    on delete restrict;

create index if not exists idx_orders_converted_consignment_id
  on public.orders (converted_consignment_id);

create or replace function public.advance_order_group(
  p_group_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $advance_order_group$
declare
  v_business_id uuid;
  v_order_count integer;
  v_current_status text;
  v_distinct_statuses integer;
  v_product record;
  v_order record;
  v_sale_id uuid;
  v_consignment_id uuid;
  v_gross numeric;
  v_net numeric;
  v_cogs numeric;
  v_profit numeric;
  v_margin numeric;
  v_debt_target numeric;
  v_debt_posted numeric;
  v_debt_delta numeric;
begin
  if p_group_id is null then
    raise exception 'Grupo do pedido não informado.';
  end if;

  if p_new_status not in ('pendente', 'em_preparo', 'pronto', 'despachado', 'concluido') then
    raise exception 'Etapa inválida para a esteira: %.', p_new_status;
  end if;

  if not public.is_admin() then
    raise exception 'Somente o administrador pode avançar a esteira.';
  end if;

  -- Serializa duas tentativas simultaneas do mesmo grupo.
  perform 1
  from public.orders o
  where coalesce(o.order_group_id, o.id) = p_group_id
  order by o.id
  for update;

  select
    count(*)::integer,
    (array_agg(o.business_id order by o.id))[1],
    min(o.status),
    count(distinct o.status)::integer
  into v_order_count, v_business_id, v_current_status, v_distinct_statuses
  from public.orders o
  where coalesce(o.order_group_id, o.id) = p_group_id;

  if v_order_count = 0 then
    raise exception 'Pedido não encontrado na esteira.';
  end if;

  if v_distinct_statuses <> 1 then
    raise exception 'O grupo está com etapas divergentes. Atualize a tela e tente novamente.';
  end if;

  if exists (
    select 1
    from public.orders o
    where coalesce(o.order_group_id, o.id) = p_group_id
      and o.approval_status <> 'aprovado'
  ) then
    raise exception 'Aprove o pedido antes de avançar a etapa.';
  end if;

  if exists (
    select 1
    from public.orders o
    where coalesce(o.order_group_id, o.id) = p_group_id
      and o.business_id <> v_business_id
  ) then
    raise exception 'O grupo contém pedidos de negócios diferentes.';
  end if;

  -- Depois que estoque/financeiro foram materializados, a unica transicao
  -- aceita e Despachado -> Concluido. Nunca se volta uma etapa pelo select.
  if exists (
    select 1
    from public.orders o
    where coalesce(o.order_group_id, o.id) = p_group_id
      and (o.converted_sale_id is not null or o.converted_consignment_id is not null)
  ) and p_new_status not in ('despachado', 'concluido') then
    raise exception 'Pedido já despachado não pode voltar para uma etapa anterior.';
  end if;

  if v_current_status = 'concluido' and p_new_status <> 'concluido' then
    raise exception 'Pedido concluído não pode voltar para outra etapa.';
  end if;

  if v_current_status = p_new_status then
    return jsonb_build_object(
      'group_id', p_group_id,
      'status', p_new_status,
      'orders', v_order_count,
      'changed', false
    );
  end if;

  -- Etapas anteriores ao despacho sao apenas logisticas.
  if p_new_status in ('pendente', 'em_preparo', 'pronto') then
    update public.orders o
      set status = p_new_status
    where coalesce(o.order_group_id, o.id) = p_group_id;

    return jsonb_build_object(
      'group_id', p_group_id,
      'status', p_new_status,
      'orders', v_order_count,
      'changed', true
    );
  end if;

  -- Bloqueia os produtos em ordem estavel e valida a soma por produto antes
  -- de qualquer baixa. Assim o despacho inteiro confirma ou inteiro reverte.
  perform 1
  from public.products p
  where p.id in (
    select o.product_id
    from public.orders o
    where coalesce(o.order_group_id, o.id) = p_group_id
      and o.converted_sale_id is null
      and o.converted_consignment_id is null
  )
  order by p.id
  for update;

  for v_product in
    select
      p.id,
      p.name,
      p.type,
      p.unit,
      p.current_stock,
      sum(o.quantity) as required_quantity
    from public.orders o
    join public.products p on p.id = o.product_id
    where coalesce(o.order_group_id, o.id) = p_group_id
      and o.converted_sale_id is null
      and o.converted_consignment_id is null
    group by p.id, p.name, p.type, p.unit, p.current_stock
  loop
    if v_product.type <> 'servico'
       and v_product.current_stock < v_product.required_quantity then
      raise exception
        'Estoque insuficiente para %: disponível %, pedido pede %.',
        v_product.name,
        v_product.current_stock,
        v_product.required_quantity;
    end if;
  end loop;

  for v_order in
    select
      o.*,
      p.name as product_name,
      p.type as product_type,
      p.avg_cost as product_avg_cost
    from public.orders o
    join public.products p on p.id = o.product_id
    where coalesce(o.order_group_id, o.id) = p_group_id
    order by o.created_at, o.id
  loop
    if v_order.converted_sale_id is not null
       or v_order.converted_consignment_id is not null then
      continue;
    end if;

    if v_order.sale_type = 'revenda' then
      if v_order.seller_id is null then
        raise exception 'Pedido de revenda sem vendedor responsável.';
      end if;
      if v_order.product_type = 'servico' then
        raise exception 'Serviço não pode ser despachado para revendedor.';
      end if;

      update public.products
        set current_stock = current_stock - v_order.quantity
      where id = v_order.product_id;

      insert into public.stock_movements (
        business_id, date, type, product_id, quantity,
        unit_cost, total_cost, ref_type, ref_id, notes
      ) values (
        v_order.business_id, current_date, 'saida_envio_consignado',
        v_order.product_id, -v_order.quantity,
        coalesce(v_order.product_avg_cost, 0),
        -(v_order.quantity * coalesce(v_order.product_avg_cost, 0)),
        'order', v_order.id,
        'Despacho da esteira - pedido ' || p_group_id::text
      );

      insert into public.seller_stock (
        business_id, seller_id, product_id, quantity
      ) values (
        v_order.business_id, v_order.seller_id, v_order.product_id, v_order.quantity
      )
      on conflict (seller_id, product_id)
      do update set
        quantity = public.seller_stock.quantity + excluded.quantity,
        business_id = excluded.business_id;

      insert into public.consignments (
        business_id, date, client_id, product_id,
        quantity_sent, quantity_sold, quantity_returned,
        amount_paid, unit_price, cost_at_send, notes, status, seller_id
      ) values (
        v_order.business_id, current_date, null, v_order.product_id,
        v_order.quantity, 0, 0,
        least(coalesce(v_order.paid_amount, 0), v_order.quantity * v_order.unit_price),
        v_order.unit_price, coalesce(v_order.product_avg_cost, 0),
        'Revenda despachada (pedido ' || p_group_id::text || ')',
        'com_cliente', v_order.seller_id
      )
      returning id into v_consignment_id;

      insert into public.consignment_events (
        business_id, consignment_id, type, date, quantity, amount
      ) values (
        v_order.business_id, v_consignment_id, 'envio',
        current_date, v_order.quantity, 0
      );

      if coalesce(v_order.paid_amount, 0) > 0 then
        insert into public.consignment_events (
          business_id, consignment_id, type, date, quantity, amount
        ) values (
          v_order.business_id, v_consignment_id, 'pagamento',
          current_date, 0,
          least(v_order.paid_amount, v_order.quantity * v_order.unit_price)
        );
      end if;

      -- Rede de seguranca para pedidos antigos cuja divida nao foi lancada na
      -- aprovacao. Considera os mesmos source_type usados pelo frontend.
      select coalesce(sum(
        case when e.direction = 'credit' then -e.amount else e.amount end
      ), 0)
      into v_debt_posted
      from public.seller_account_entries e
      where e.source_id = v_order.id
        and e.source_type in ('order', 'order_edit');

      v_debt_target := greatest(
        v_order.quantity * v_order.unit_price - coalesce(v_order.paid_amount, 0),
        0
      );
      v_debt_delta := v_debt_target - v_debt_posted;

      if abs(v_debt_delta) >= 0.005 then
        insert into public.seller_account_entries (
          business_id, seller_id, type, direction, amount,
          source_type, source_id, notes, created_by
        ) values (
          v_order.business_id,
          v_order.seller_id,
          case when v_debt_delta > 0 then 'debit_replenishment' else 'manual_adjustment' end,
          case when v_debt_delta > 0 then 'debit' else 'credit' end,
          abs(v_debt_delta),
          case when v_debt_posted > 0 then 'order_edit' else 'order' end,
          v_order.id,
          'Ajuste atômico no despacho - pedido ' || p_group_id::text,
          auth.uid()
        );
      end if;

      update public.orders
        set converted_consignment_id = v_consignment_id
      where id = v_order.id;
    else
      v_gross := v_order.quantity * v_order.unit_price;
      v_net := v_gross;
      v_cogs := v_order.quantity * coalesce(v_order.product_avg_cost, 0);
      v_profit := v_net - v_cogs;
      v_margin := case when v_net <> 0 then v_profit / v_net else 0 end;

      insert into public.sales (
        business_id, date, channel, client_id, product_id,
        quantity, unit_price, discount, fixed_fees, fee_percent,
        percent_fees, unit_cost, gross_revenue, net_revenue,
        cogs, gross_profit, margin, notes, origin, origin_id, seller_id
      ) values (
        v_order.business_id, current_date, 'Pedido', v_order.client_id, v_order.product_id,
        v_order.quantity, v_order.unit_price, 0, 0, 0,
        0, coalesce(v_order.product_avg_cost, 0), v_gross, v_net,
        v_cogs, v_profit, v_margin,
        'Venda despachada - pedido ' || p_group_id::text ||
          case when coalesce(v_order.notes, '') <> '' then ' - ' || v_order.notes else '' end,
        'pedido', v_order.id, null
      )
      returning id into v_sale_id;

      if v_order.product_type <> 'servico' then
        update public.products
          set current_stock = current_stock - v_order.quantity
        where id = v_order.product_id;

        insert into public.stock_movements (
          business_id, date, type, product_id, quantity,
          unit_cost, total_cost, ref_type, ref_id, notes
        ) values (
          v_order.business_id, current_date, 'saida_venda',
          v_order.product_id, -v_order.quantity,
          coalesce(v_order.product_avg_cost, 0),
          -(v_order.quantity * coalesce(v_order.product_avg_cost, 0)),
          'order', v_order.id,
          'Venda despachada - pedido ' || p_group_id::text
        );
      end if;

      update public.orders
        set converted_sale_id = v_sale_id
      where id = v_order.id;
    end if;
  end loop;

  update public.orders o
    set status = p_new_status
  where coalesce(o.order_group_id, o.id) = p_group_id;

  return jsonb_build_object(
    'group_id', p_group_id,
    'status', p_new_status,
    'orders', v_order_count,
    'changed', true
  );
end;
$advance_order_group$;

revoke all on function public.advance_order_group(uuid, text) from public, anon;
grant execute on function public.advance_order_group(uuid, text) to authenticated;
