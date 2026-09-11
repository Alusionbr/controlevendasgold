begin;

drop policy if exists tracking_shipments_all_admin on public.tracking_shipments;
drop policy if exists tracking_shipments_select_seller on public.tracking_shipments;
drop policy if exists tracking_shipments_select on public.tracking_shipments;
drop policy if exists tracking_shipments_insert_admin on public.tracking_shipments;
drop policy if exists tracking_shipments_update_admin on public.tracking_shipments;
drop policy if exists tracking_shipments_delete_admin on public.tracking_shipments;

create policy tracking_shipments_select on public.tracking_shipments
  for select to authenticated using (
    business_id = (select public.my_business_id())
    and ((select public.is_admin()) or seller_id = (select auth.uid()))
  );
create policy tracking_shipments_insert_admin on public.tracking_shipments
  for insert to authenticated with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipments_update_admin on public.tracking_shipments
  for update to authenticated
  using ((select public.is_admin()) and business_id = (select public.my_business_id()))
  with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipments_delete_admin on public.tracking_shipments
  for delete to authenticated using ((select public.is_admin()) and business_id = (select public.my_business_id()));

drop policy if exists tracking_shipment_items_all_admin on public.tracking_shipment_items;
drop policy if exists tracking_shipment_items_select_seller on public.tracking_shipment_items;
drop policy if exists tracking_shipment_items_select on public.tracking_shipment_items;
drop policy if exists tracking_shipment_items_insert_admin on public.tracking_shipment_items;
drop policy if exists tracking_shipment_items_update_admin on public.tracking_shipment_items;
drop policy if exists tracking_shipment_items_delete_admin on public.tracking_shipment_items;

create policy tracking_shipment_items_select on public.tracking_shipment_items
  for select to authenticated using (
    business_id = (select public.my_business_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.tracking_shipments s
        where s.id = shipment_id and s.business_id = business_id and s.seller_id = (select auth.uid())
      )
    )
  );
create policy tracking_shipment_items_insert_admin on public.tracking_shipment_items
  for insert to authenticated with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_items_update_admin on public.tracking_shipment_items
  for update to authenticated
  using ((select public.is_admin()) and business_id = (select public.my_business_id()))
  with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_items_delete_admin on public.tracking_shipment_items
  for delete to authenticated using ((select public.is_admin()) and business_id = (select public.my_business_id()));

drop policy if exists tracking_shipment_events_all_admin on public.tracking_shipment_events;
drop policy if exists tracking_shipment_events_select_seller on public.tracking_shipment_events;
drop policy if exists tracking_shipment_events_select on public.tracking_shipment_events;
drop policy if exists tracking_shipment_events_insert_admin on public.tracking_shipment_events;
drop policy if exists tracking_shipment_events_update_admin on public.tracking_shipment_events;
drop policy if exists tracking_shipment_events_delete_admin on public.tracking_shipment_events;

create policy tracking_shipment_events_select on public.tracking_shipment_events
  for select to authenticated using (
    business_id = (select public.my_business_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.tracking_shipments s
        where s.id = shipment_id and s.business_id = business_id and s.seller_id = (select auth.uid())
      )
    )
  );
create policy tracking_shipment_events_insert_admin on public.tracking_shipment_events
  for insert to authenticated with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_events_update_admin on public.tracking_shipment_events
  for update to authenticated
  using ((select public.is_admin()) and business_id = (select public.my_business_id()))
  with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_events_delete_admin on public.tracking_shipment_events
  for delete to authenticated using ((select public.is_admin()) and business_id = (select public.my_business_id()));

drop policy if exists tracking_shipment_payments_all_admin on public.tracking_shipment_payments;
drop policy if exists tracking_shipment_payments_select_seller on public.tracking_shipment_payments;
drop policy if exists tracking_shipment_payments_select on public.tracking_shipment_payments;
drop policy if exists tracking_shipment_payments_insert_admin on public.tracking_shipment_payments;
drop policy if exists tracking_shipment_payments_update_admin on public.tracking_shipment_payments;
drop policy if exists tracking_shipment_payments_delete_admin on public.tracking_shipment_payments;

create policy tracking_shipment_payments_select on public.tracking_shipment_payments
  for select to authenticated using (
    business_id = (select public.my_business_id())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.tracking_shipments s
        where s.id = shipment_id and s.business_id = business_id and s.seller_id = (select auth.uid())
      )
    )
  );
create policy tracking_shipment_payments_insert_admin on public.tracking_shipment_payments
  for insert to authenticated with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_payments_update_admin on public.tracking_shipment_payments
  for update to authenticated
  using ((select public.is_admin()) and business_id = (select public.my_business_id()))
  with check ((select public.is_admin()) and business_id = (select public.my_business_id()));
create policy tracking_shipment_payments_delete_admin on public.tracking_shipment_payments
  for delete to authenticated using ((select public.is_admin()) and business_id = (select public.my_business_id()));

revoke all on function public.tracking_next_due_date(date, text, smallint) from public, anon;
grant execute on function public.tracking_next_due_date(date, text, smallint) to authenticated;

create or replace function public.create_tracking_shipment(
  p_direction text,
  p_partner_type text,
  p_partner_id uuid,
  p_departed_at date,
  p_delivered_at date,
  p_settlement_mode text,
  p_settlement_day smallint,
  p_notes text,
  p_items jsonb,
  p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_business_id uuid := (select public.my_business_id());
  v_shipment_id uuid;
  v_existing_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_source public.tracking_shipment_items%rowtype;
  v_item_id uuid;
  v_quantity numeric;
  v_price numeric;
  v_source_used numeric;
  v_total numeric := 0;
  v_status text := case when p_delivered_at is null then 'in_transit' else 'delivered' end;
begin
  if not (select public.is_admin()) or v_business_id is null then
    raise exception 'Somente o administrador ativo pode registrar remessas.';
  end if;
  select id into v_existing_id from public.tracking_shipments
    where business_id = v_business_id and request_id = p_request_id;
  if v_existing_id is not null then return v_existing_id; end if;
  if p_direction not in ('inbound', 'outbound') then raise exception 'Sentido de remessa inválido.'; end if;
  if (p_direction = 'inbound' and p_partner_type <> 'supplier')
     or (p_direction = 'outbound' and p_partner_type not in ('client', 'seller')) then
    raise exception 'Parceiro incompatível com o sentido da remessa.';
  end if;
  if p_departed_at is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Informe data de saída e ao menos um produto.';
  end if;
  if p_delivered_at is not null and p_delivered_at < p_departed_at then
    raise exception 'A entrega não pode ocorrer antes da saída.';
  end if;
  if p_partner_type = 'supplier' and not exists (
    select 1 from public.suppliers where id = p_partner_id and business_id = v_business_id
  ) then raise exception 'Fornecedor não encontrado neste negócio.'; end if;
  if p_partner_type = 'client' and not exists (
    select 1 from public.clients where id = p_partner_id and business_id = v_business_id
  ) then raise exception 'Cliente/parceiro não encontrado neste negócio.'; end if;
  if p_partner_type = 'seller' and not exists (
    select 1 from public.profiles where id = p_partner_id and business_id = v_business_id and role = 'vendedor' and active
  ) then raise exception 'Vendedor ativo não encontrado neste negócio.'; end if;

  insert into public.tracking_shipments (
    business_id, direction, partner_type, supplier_id, client_id, seller_id,
    status, departed_at, delivered_at, settlement_mode, settlement_day,
    due_date, request_id, notes
  ) values (
    v_business_id, p_direction, p_partner_type,
    case when p_partner_type = 'supplier' then p_partner_id end,
    case when p_partner_type = 'client' then p_partner_id end,
    case when p_partner_type = 'seller' then p_partner_id end,
    v_status, p_departed_at, p_delivered_at, p_settlement_mode, p_settlement_day,
    case when p_delivered_at is null then null
      else public.tracking_next_due_date(p_delivered_at, p_settlement_mode, p_settlement_day) end,
    p_request_id, coalesce(p_notes, '')
  ) returning id into v_shipment_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;
    if v_quantity <= 0 or v_price < 0 then raise exception 'Quantidade ou preço inválido.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and business_id = v_business_id for update;
    if not found then raise exception 'Produto não encontrado neste negócio.'; end if;
    if p_direction = 'outbound' and v_product.type <> 'servico' and v_product.current_stock < v_quantity then
      raise exception 'Estoque insuficiente para %: disponível %, solicitado %.',
        v_product.name, v_product.current_stock, v_quantity;
    end if;

    if nullif(v_item ->> 'source_item_id', '') is not null then
      if p_direction <> 'outbound' then raise exception 'Somente saídas podem indicar origem.'; end if;
      select i.* into v_source from public.tracking_shipment_items i
        join public.tracking_shipments s on s.id = i.shipment_id
        where i.id = (v_item ->> 'source_item_id')::uuid
          and i.business_id = v_business_id and i.product_id = v_product.id
          and s.direction = 'inbound' and s.status in ('delivered', 'closed') for update of i;
      if not found then raise exception 'Remessa de origem inválida para %.', v_product.name; end if;
      select coalesce(sum(i.quantity - i.quantity_returned), 0) into v_source_used
        from public.tracking_shipment_items i
        join public.tracking_shipments s on s.id = i.shipment_id
        where i.source_item_id = v_source.id and s.status <> 'cancelled';
      if v_source.quantity - v_source.quantity_returned - v_source_used < v_quantity then
        raise exception 'Saldo insuficiente na remessa de origem para %.', v_product.name;
      end if;
    end if;

    insert into public.tracking_shipment_items (
      business_id, shipment_id, product_id, source_item_id, quantity, unit_price, unit_cost
    ) values (
      v_business_id, v_shipment_id, v_product.id,
      nullif(v_item ->> 'source_item_id', '')::uuid,
      v_quantity, v_price, coalesce(nullif(v_item ->> 'unit_cost', '')::numeric, v_product.avg_cost, 0)
    ) returning id into v_item_id;
    v_total := v_total + v_quantity * v_price;

    if p_direction = 'outbound' and v_product.type <> 'servico' then
      update public.products set current_stock = current_stock - v_quantity where id = v_product.id;
      insert into public.stock_movements (
        business_id, date, type, product_id, quantity, unit_cost, total_cost, ref_type, ref_id, notes
      ) values (
        v_business_id, p_departed_at, 'saida_envio_consignado', v_product.id, -v_quantity,
        v_product.avg_cost, -(v_quantity * v_product.avg_cost), 'tracking_shipment', v_shipment_id,
        'Saída rastreada por remessa'
      );
      if p_partner_type = 'seller' and p_delivered_at is not null then
        insert into public.seller_stock (business_id, seller_id, product_id, quantity)
        values (v_business_id, p_partner_id, v_product.id, v_quantity)
        on conflict (seller_id, product_id) do update
          set quantity = public.seller_stock.quantity + excluded.quantity,
              updated_at = now();
      end if;
    elsif p_direction = 'inbound' and p_delivered_at is not null and v_product.type <> 'servico' then
      update public.products
        set avg_cost = case
              when current_stock + v_quantity > 0 then round(
                ((current_stock * coalesce(avg_cost, 0))
                  + (v_quantity * coalesce(nullif(v_item ->> 'unit_cost', '')::numeric, v_product.avg_cost, 0)))
                / (current_stock + v_quantity), 4
              )
              else avg_cost
            end,
            current_stock = current_stock + v_quantity
        where id = v_product.id;
      insert into public.stock_movements (
        business_id, date, type, product_id, quantity, unit_cost, total_cost, ref_type, ref_id, notes
      ) values (
        v_business_id, p_delivered_at, 'entrada_recebimento_consignado', v_product.id, v_quantity,
        coalesce(nullif(v_item ->> 'unit_cost', '')::numeric, v_product.avg_cost, 0),
        v_quantity * coalesce(nullif(v_item ->> 'unit_cost', '')::numeric, v_product.avg_cost, 0),
        'tracking_shipment', v_shipment_id, 'Entrada rastreada por remessa'
      );
    end if;
  end loop;

  update public.tracking_shipments set total_amount = round(v_total, 2) where id = v_shipment_id;
  insert into public.tracking_shipment_events (
    business_id, shipment_id, type, event_at, request_id, notes
  ) values (v_business_id, v_shipment_id, 'dispatch', p_departed_at::timestamptz,
    gen_random_uuid(), 'Remessa registrada');

  if p_delivered_at is not null then
    insert into public.tracking_shipment_events (
      business_id, shipment_id, type, event_at, request_id, notes
    ) values (v_business_id, v_shipment_id, 'delivery', p_delivered_at::timestamptz,
      gen_random_uuid(), 'Entrega confirmada');
    if v_total > 0 then
      insert into public.financial_entries (
        business_id, direction, category, description, issue_date, due_date,
        amount, supplier_id, client_id, seller_id, source_type, source_id, notes, created_by
      ) values (
        v_business_id, case when p_direction = 'inbound' then 'payable' else 'receivable' end,
        'consignment', case when p_direction = 'inbound' then 'Remessa recebida em consignação' else 'Remessa entregue em consignação' end,
        p_delivered_at, public.tracking_next_due_date(p_delivered_at, p_settlement_mode, p_settlement_day),
        round(v_total, 2),
        case when p_partner_type = 'supplier' then p_partner_id end,
        case when p_partner_type = 'client' then p_partner_id end,
        case when p_partner_type = 'seller' then p_partner_id end,
        'tracking_shipment', v_shipment_id, coalesce(p_notes, ''), auth.uid()
      );
      if p_partner_type = 'seller' then
        insert into public.seller_account_entries (
          business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by
        ) values (
          v_business_id, p_partner_id, 'debit_replenishment', 'debit', round(v_total, 2),
          'tracking_shipment', v_shipment_id, coalesce(p_notes, 'Remessa entregue'), auth.uid()
        ) on conflict (business_id, source_type, source_id)
          where source_type = 'tracking_shipment' and source_id is not null do nothing;
      end if;
    end if;
  end if;
  return v_shipment_id;
end;
$$;

create or replace function public.confirm_tracking_shipment_delivery(
  p_shipment_id uuid, p_delivered_at date, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_shipment public.tracking_shipments%rowtype;
  v_item record;
begin
  if not (select public.is_admin()) then raise exception 'Somente o administrador pode confirmar entregas.'; end if;
  select * into v_shipment from public.tracking_shipments
    where id = p_shipment_id and business_id = (select public.my_business_id()) for update;
  if not found then raise exception 'Remessa não encontrada.'; end if;
  if v_shipment.delivered_at is not null then return v_shipment.id; end if;
  if p_delivered_at < v_shipment.departed_at then raise exception 'A entrega não pode ocorrer antes da saída.'; end if;

  if v_shipment.direction = 'inbound' then
    for v_item in select i.*, p.type as product_type from public.tracking_shipment_items i
      join public.products p on p.id = i.product_id where i.shipment_id = v_shipment.id
      for update of i, p loop
      if v_item.product_type <> 'servico' then
        update public.products
          set avg_cost = case
                when current_stock + v_item.quantity > 0 then round(
                  ((current_stock * coalesce(avg_cost, 0)) + (v_item.quantity * v_item.unit_cost))
                  / (current_stock + v_item.quantity), 4
                )
                else avg_cost
              end,
              current_stock = current_stock + v_item.quantity
          where id = v_item.product_id;
        insert into public.stock_movements (
          business_id, date, type, product_id, quantity, unit_cost, total_cost, ref_type, ref_id, notes
        ) values (
          v_shipment.business_id, p_delivered_at, 'entrada_recebimento_consignado', v_item.product_id,
          v_item.quantity, v_item.unit_cost, v_item.quantity * v_item.unit_cost,
          'tracking_shipment', v_shipment.id, 'Entrada confirmada por remessa'
        );
      end if;
    end loop;
  elsif v_shipment.direction = 'outbound' and v_shipment.seller_id is not null then
    for v_item in select i.*, p.type as product_type from public.tracking_shipment_items i
      join public.products p on p.id = i.product_id where i.shipment_id = v_shipment.id
      for update of i, p loop
      if v_item.product_type <> 'servico' then
        insert into public.seller_stock (business_id, seller_id, product_id, quantity)
        values (v_shipment.business_id, v_shipment.seller_id, v_item.product_id, v_item.quantity)
        on conflict (seller_id, product_id) do update
          set quantity = public.seller_stock.quantity + excluded.quantity,
              updated_at = now();
      end if;
    end loop;
  end if;

  update public.tracking_shipments set status = 'delivered', delivered_at = p_delivered_at,
    due_date = public.tracking_next_due_date(p_delivered_at, settlement_mode, settlement_day)
    where id = v_shipment.id;
  insert into public.tracking_shipment_events (
    business_id, shipment_id, type, event_at, request_id, notes
  ) values (v_shipment.business_id, v_shipment.id, 'delivery', p_delivered_at::timestamptz,
    p_request_id, 'Entrega confirmada');
  if v_shipment.total_amount > 0 then
    insert into public.financial_entries (
      business_id, direction, category, description, issue_date, due_date, amount,
      supplier_id, client_id, seller_id, source_type, source_id, notes, created_by
    ) values (
      v_shipment.business_id, case when v_shipment.direction = 'inbound' then 'payable' else 'receivable' end,
      'consignment', case when v_shipment.direction = 'inbound' then 'Remessa recebida em consignação' else 'Remessa entregue em consignação' end,
      p_delivered_at, public.tracking_next_due_date(p_delivered_at, v_shipment.settlement_mode, v_shipment.settlement_day),
      v_shipment.total_amount, v_shipment.supplier_id, v_shipment.client_id, v_shipment.seller_id,
      'tracking_shipment', v_shipment.id, v_shipment.notes, auth.uid()
    ) on conflict (business_id, source_type, source_id) where source_id is not null do nothing;
    if v_shipment.seller_id is not null then
      insert into public.seller_account_entries (
        business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by
      ) values (
        v_shipment.business_id, v_shipment.seller_id, 'debit_replenishment', 'debit', v_shipment.total_amount,
        'tracking_shipment', v_shipment.id, v_shipment.notes, auth.uid()
      ) on conflict (business_id, source_type, source_id)
        where source_type = 'tracking_shipment' and source_id is not null do nothing;
    end if;
  end if;
  return v_shipment.id;
end;
$$;

commit;
