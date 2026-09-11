-- Controle360 - rastreabilidade por remessa, origem e destino.
-- Todas as escritas operacionais passam por RPCs transacionais e idempotentes.

begin;

alter table public.stock_movements
  drop constraint if exists stock_movements_type_check,
  add constraint stock_movements_type_check
    check (type in (
      'entrada_compra',
      'saida_producao_insumo',
      'entrada_producao_produto_final',
      'saida_venda',
      'saida_envio_consignado',
      'entrada_devolucao_consignado',
      'ajuste_manual',
      'saida_desperdicio',
      'entrada_devolucao_venda',
      'saida_brinde',
      'entrada_recebimento_consignado',
      'saida_devolucao_fornecedor'
    ));

create table if not exists public.tracking_shipments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  direction text not null check (direction in ('inbound', 'outbound')),
  partner_type text not null check (partner_type in ('supplier', 'client', 'seller')),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  seller_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'in_transit'
    check (status in ('in_transit', 'delivered', 'closed', 'cancelled')),
  departed_at date not null,
  delivered_at date,
  settlement_mode text not null default 'upon_sale'
    check (settlement_mode in ('upon_sale', 'weekly', 'monthly')),
  settlement_day smallint,
  due_date date,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  request_id uuid not null,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_shipments_partner_check check (
    (partner_type = 'supplier' and supplier_id is not null and client_id is null and seller_id is null)
    or (partner_type = 'client' and client_id is not null and supplier_id is null and seller_id is null)
    or (partner_type = 'seller' and seller_id is not null and supplier_id is null and client_id is null)
  ),
  constraint tracking_shipments_direction_partner_check check (
    (direction = 'inbound' and partner_type = 'supplier')
    or (direction = 'outbound' and partner_type in ('client', 'seller'))
  ),
  constraint tracking_shipments_settlement_day_check check (
    (settlement_mode = 'upon_sale' and settlement_day is null)
    or (settlement_mode = 'weekly' and settlement_day between 1 and 7)
    or (settlement_mode = 'monthly' and settlement_day between 1 and 31)
  ),
  unique (business_id, request_id)
);

create table if not exists public.tracking_shipment_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shipment_id uuid not null references public.tracking_shipments(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  source_item_id uuid references public.tracking_shipment_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  quantity_sold numeric(14,3) not null default 0 check (quantity_sold >= 0),
  quantity_returned numeric(14,3) not null default 0 check (quantity_returned >= 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_shipment_item_totals_check
    check (quantity_sold + quantity_returned <= quantity)
);

create table if not exists public.tracking_shipment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shipment_id uuid not null references public.tracking_shipments(id) on delete restrict,
  shipment_item_id uuid references public.tracking_shipment_items(id) on delete restrict,
  type text not null check (type in ('dispatch', 'delivery', 'sale', 'return', 'payment', 'note')),
  event_at timestamptz not null default now(),
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  client_id uuid references public.clients(id) on delete set null,
  request_id uuid not null,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, request_id)
);

create table if not exists public.tracking_shipment_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shipment_id uuid not null references public.tracking_shipments(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text,
  notes text not null default '',
  request_id uuid not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, request_id)
);

create index if not exists idx_tracking_shipments_business_status
  on public.tracking_shipments (business_id, status, due_date);
create index if not exists idx_tracking_shipments_supplier on public.tracking_shipments (supplier_id);
create index if not exists idx_tracking_shipments_client on public.tracking_shipments (client_id);
create index if not exists idx_tracking_shipments_seller on public.tracking_shipments (seller_id);
create index if not exists idx_tracking_shipment_items_shipment on public.tracking_shipment_items (shipment_id);
create index if not exists idx_tracking_shipment_items_product on public.tracking_shipment_items (product_id);
create index if not exists idx_tracking_shipment_items_source on public.tracking_shipment_items (source_item_id);
create index if not exists idx_tracking_shipment_events_shipment
  on public.tracking_shipment_events (shipment_id, event_at desc);
create index if not exists idx_tracking_shipment_events_item on public.tracking_shipment_events (shipment_item_id);
create index if not exists idx_tracking_shipment_events_client on public.tracking_shipment_events (client_id);
create index if not exists idx_tracking_shipment_payments_shipment
  on public.tracking_shipment_payments (shipment_id, payment_date desc);
create unique index if not exists seller_account_entries_tracking_shipment_uidx
  on public.seller_account_entries (business_id, source_type, source_id)
  where source_type = 'tracking_shipment' and source_id is not null;

create or replace function public.tracking_sync_shipment_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'cancelled' then return new; end if;
  if new.delivered_at is null then
    new.status := 'in_transit';
  elsif new.paid_amount >= new.total_amount
    and (new.direction = 'inbound' or not exists (
      select 1 from public.tracking_shipment_items
      where shipment_id = new.id and quantity_sold + quantity_returned < quantity
    )) then
    new.status := 'closed';
  else
    new.status := 'delivered';
  end if;
  return new;
end;
$$;

create or replace function public.tracking_touch_shipment_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.tracking_shipments set status = status where id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists trg_tracking_shipments_updated_at on public.tracking_shipments;
create trigger trg_tracking_shipments_updated_at before update on public.tracking_shipments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tracking_shipments_sync_status on public.tracking_shipments;
create trigger trg_tracking_shipments_sync_status before update on public.tracking_shipments
  for each row execute function public.tracking_sync_shipment_status();
drop trigger if exists trg_tracking_shipment_items_updated_at on public.tracking_shipment_items;
create trigger trg_tracking_shipment_items_updated_at before update on public.tracking_shipment_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tracking_shipment_items_touch_status on public.tracking_shipment_items;
create trigger trg_tracking_shipment_items_touch_status
  after update of quantity_sold, quantity_returned on public.tracking_shipment_items
  for each row execute function public.tracking_touch_shipment_status();

alter table public.tracking_shipments enable row level security;
alter table public.tracking_shipment_items enable row level security;
alter table public.tracking_shipment_events enable row level security;
alter table public.tracking_shipment_payments enable row level security;

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

revoke all on public.tracking_shipments, public.tracking_shipment_items,
  public.tracking_shipment_events, public.tracking_shipment_payments from public, anon;
grant select, insert, update on public.tracking_shipments, public.tracking_shipment_items,
  public.tracking_shipment_events, public.tracking_shipment_payments to authenticated;
grant all on public.tracking_shipments, public.tracking_shipment_items,
  public.tracking_shipment_events, public.tracking_shipment_payments to service_role;

create or replace function public.tracking_next_due_date(
  p_base_date date, p_mode text, p_day smallint
) returns date language plpgsql immutable set search_path = public as $$
declare
  v_delta integer;
  v_month date;
begin
  if p_mode = 'upon_sale' then return null; end if;
  if p_mode = 'weekly' then
    v_delta := p_day - extract(isodow from p_base_date)::integer;
    if v_delta <= 0 then v_delta := v_delta + 7; end if;
    return p_base_date + v_delta;
  end if;
  v_month := (date_trunc('month', p_base_date) + interval '1 month')::date;
  return make_date(
    extract(year from v_month)::integer,
    extract(month from v_month)::integer,
    least(p_day::integer, extract(day from (v_month + interval '1 month - 1 day'))::integer)
  );
end;
$$;

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

create or replace function public.register_tracking_shipment_sale(
  p_item_id uuid, p_quantity numeric, p_sold_at timestamptz,
  p_client_id uuid, p_unit_price numeric, p_notes text, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_item public.tracking_shipment_items%rowtype; v_shipment public.tracking_shipments%rowtype; v_event_id uuid;
begin
  if not (select public.is_admin()) then raise exception 'Somente o administrador pode informar vendas.'; end if;
  select * into v_item from public.tracking_shipment_items
    where id = p_item_id and business_id = (select public.my_business_id()) for update;
  if not found then raise exception 'Item de remessa não encontrado.'; end if;
  select * into v_shipment from public.tracking_shipments where id = v_item.shipment_id for update;
  if v_shipment.direction <> 'outbound' or v_shipment.status not in ('delivered', 'closed') then
    raise exception 'A venda só pode ser informada após a entrega de uma remessa de saída.';
  end if;
  if p_quantity <= 0 or v_item.quantity_sold + v_item.quantity_returned + p_quantity > v_item.quantity then
    raise exception 'Quantidade vendida maior que o saldo em mãos.';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients where id = p_client_id and business_id = v_item.business_id
  ) then raise exception 'Cliente final não encontrado neste negócio.'; end if;
  update public.tracking_shipment_items set quantity_sold = quantity_sold + p_quantity where id = v_item.id;
  if v_shipment.seller_id is not null then
    update public.seller_stock set quantity = quantity - p_quantity
      where seller_id = v_shipment.seller_id and product_id = v_item.product_id
        and business_id = v_item.business_id and quantity >= p_quantity;
    if not found then raise exception 'Estoque do vendedor insuficiente para informar esta venda.'; end if;
  end if;
  insert into public.tracking_shipment_events (
    business_id, shipment_id, shipment_item_id, type, event_at, quantity, amount, client_id, request_id, notes
  ) values (
    v_item.business_id, v_item.shipment_id, v_item.id, 'sale', coalesce(p_sold_at, now()), p_quantity,
    round(p_quantity * coalesce(p_unit_price, v_item.unit_price), 2), p_client_id, p_request_id, coalesce(p_notes, '')
  ) returning id into v_event_id;
  return v_event_id;
exception when unique_violation then
  select id into v_event_id from public.tracking_shipment_events
    where business_id = (select public.my_business_id()) and request_id = p_request_id;
  return v_event_id;
end;
$$;

create or replace function public.register_tracking_shipment_return(
  p_item_id uuid, p_quantity numeric, p_returned_at date, p_notes text, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_item public.tracking_shipment_items%rowtype;
  v_shipment public.tracking_shipments%rowtype;
  v_product public.products%rowtype;
  v_allocated numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_event_id uuid;
begin
  if not (select public.is_admin()) then raise exception 'Somente o administrador pode registrar devoluções.'; end if;
  select * into v_item from public.tracking_shipment_items
    where id = p_item_id and business_id = (select public.my_business_id()) for update;
  if not found then raise exception 'Item de remessa não encontrado.'; end if;
  select * into v_shipment from public.tracking_shipments where id = v_item.shipment_id for update;
  select * into v_product from public.products where id = v_item.product_id for update;
  if v_shipment.status not in ('delivered', 'closed') then raise exception 'A remessa ainda não foi entregue.'; end if;
  if p_quantity <= 0 then raise exception 'A quantidade devolvida deve ser maior que zero.'; end if;
  if v_shipment.direction = 'outbound' then
    if v_item.quantity_sold + v_item.quantity_returned + p_quantity > v_item.quantity then
      raise exception 'Quantidade devolvida maior que o saldo em mãos.';
    end if;
    if v_product.type <> 'servico' then
      update public.products set current_stock = current_stock + p_quantity where id = v_product.id;
      if v_shipment.seller_id is not null then
        update public.seller_stock set quantity = quantity - p_quantity
          where seller_id = v_shipment.seller_id and product_id = v_item.product_id
            and business_id = v_item.business_id and quantity >= p_quantity;
        if not found then raise exception 'Estoque do vendedor insuficiente para esta devolução.'; end if;
      end if;
      insert into public.stock_movements (
        business_id, date, type, product_id, quantity, unit_cost, total_cost, ref_type, ref_id, notes
      ) values (v_item.business_id, p_returned_at, 'entrada_devolucao_consignado', v_product.id,
        p_quantity, v_item.unit_cost, p_quantity * v_item.unit_cost,
        'tracking_shipment', v_shipment.id, coalesce(p_notes, 'Devolução de parceiro'));
    end if;
  else
    select coalesce(sum(i.quantity - i.quantity_returned), 0) into v_allocated
      from public.tracking_shipment_items i join public.tracking_shipments s on s.id = i.shipment_id
      where i.source_item_id = v_item.id and s.status <> 'cancelled';
    if v_item.quantity_returned + v_allocated + p_quantity > v_item.quantity then
      raise exception 'Parte desta origem já foi repassada; devolução excede o saldo disponível.';
    end if;
    if v_product.type <> 'servico' then
      if v_product.current_stock < p_quantity then raise exception 'Estoque central insuficiente para devolver ao fornecedor.'; end if;
      update public.products set current_stock = current_stock - p_quantity where id = v_product.id;
      insert into public.stock_movements (
        business_id, date, type, product_id, quantity, unit_cost, total_cost, ref_type, ref_id, notes
      ) values (v_item.business_id, p_returned_at, 'saida_devolucao_fornecedor', v_product.id,
        -p_quantity, v_item.unit_cost, -(p_quantity * v_item.unit_cost),
        'tracking_shipment', v_shipment.id, coalesce(p_notes, 'Devolução ao fornecedor'));
    end if;
  end if;
  update public.tracking_shipment_items set quantity_returned = quantity_returned + p_quantity where id = v_item.id;
  select round(coalesce(sum((quantity - quantity_returned) * unit_price), 0), 2) into v_total
    from public.tracking_shipment_items where shipment_id = v_shipment.id;
  select round(coalesce(sum(amount), 0), 2) into v_paid
    from public.tracking_shipment_payments where shipment_id = v_shipment.id;
  update public.tracking_shipments set total_amount = v_total, paid_amount = v_paid,
    credit_amount = greatest(v_paid - v_total, 0) where id = v_shipment.id;
  if v_total > 0 then
    update public.financial_entries set amount = v_total, paid_amount = least(v_paid, v_total)
      where source_type = 'tracking_shipment' and source_id = v_shipment.id;
  else
    update public.financial_entries set paid_amount = 0, status = 'cancelled'
      where source_type = 'tracking_shipment' and source_id = v_shipment.id;
  end if;
  insert into public.tracking_shipment_events (
    business_id, shipment_id, shipment_item_id, type, event_at, quantity, amount, request_id, notes
  ) values (v_item.business_id, v_shipment.id, v_item.id, 'return', p_returned_at::timestamptz,
    p_quantity, round(p_quantity * v_item.unit_price, 2), p_request_id, coalesce(p_notes, ''))
    returning id into v_event_id;
  if v_shipment.seller_id is not null then
    insert into public.seller_account_entries (
      business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by
    ) values (
      v_item.business_id, v_shipment.seller_id, 'return_credit', 'credit',
      round(p_quantity * v_item.unit_price, 2), 'tracking_shipment_return', v_event_id,
      coalesce(p_notes, 'Devolução de remessa'), auth.uid()
    );
  end if;
  return v_event_id;
exception when unique_violation then
  select id into v_event_id from public.tracking_shipment_events
    where business_id = (select public.my_business_id()) and request_id = p_request_id;
  return v_event_id;
end;
$$;

create or replace function public.register_tracking_shipment_payment(
  p_shipment_id uuid, p_amount numeric, p_payment_date date,
  p_method text, p_notes text, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_shipment public.tracking_shipments%rowtype; v_payment_id uuid; v_paid numeric;
begin
  if not (select public.is_admin()) then raise exception 'Somente o administrador pode registrar pagamentos.'; end if;
  select * into v_shipment from public.tracking_shipments
    where id = p_shipment_id and business_id = (select public.my_business_id()) for update;
  if not found or v_shipment.delivered_at is null then raise exception 'Remessa entregue não encontrada.'; end if;
  if p_amount <= 0 then raise exception 'O pagamento deve ser maior que zero.'; end if;
  insert into public.tracking_shipment_payments (
    business_id, shipment_id, payment_date, amount, method, notes, request_id
  ) values (v_shipment.business_id, v_shipment.id, p_payment_date, round(p_amount, 2), p_method,
    coalesce(p_notes, ''), p_request_id) returning id into v_payment_id;
  select round(coalesce(sum(amount), 0), 2) into v_paid
    from public.tracking_shipment_payments where shipment_id = v_shipment.id;
  update public.tracking_shipments set paid_amount = v_paid,
    credit_amount = greatest(v_paid - total_amount, 0),
    status = case when v_paid >= total_amount and not exists (
      select 1 from public.tracking_shipment_items
      where shipment_id = v_shipment.id and quantity_sold + quantity_returned < quantity
    ) then 'closed' else status end
    where id = v_shipment.id;
  update public.financial_entries set paid_amount = least(v_paid, amount)
    where source_type = 'tracking_shipment' and source_id = v_shipment.id and status <> 'cancelled';
  if v_shipment.seller_id is not null then
    insert into public.seller_payments (
      business_id, seller_id, amount, payment_date, method, notes, received_by
    ) values (
      v_shipment.business_id, v_shipment.seller_id, round(p_amount, 2), p_payment_date,
      p_method, coalesce(p_notes, ''), auth.uid()
    );
    insert into public.seller_account_entries (
      business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by
    ) values (
      v_shipment.business_id, v_shipment.seller_id, 'payment', 'credit', round(p_amount, 2),
      'tracking_shipment_payment', v_payment_id, coalesce(p_notes, ''), auth.uid()
    );
  end if;
  insert into public.tracking_shipment_events (
    business_id, shipment_id, type, event_at, amount, request_id, notes
  ) values (v_shipment.business_id, v_shipment.id, 'payment', p_payment_date::timestamptz,
    round(p_amount, 2), gen_random_uuid(), coalesce(p_notes, ''));
  return v_payment_id;
exception when unique_violation then
  select id into v_payment_id from public.tracking_shipment_payments
    where business_id = (select public.my_business_id()) and request_id = p_request_id;
  return v_payment_id;
end;
$$;

revoke all on function public.tracking_next_due_date(date, text, smallint) from public, anon;
revoke all on function public.tracking_sync_shipment_status() from public, anon, authenticated;
revoke all on function public.tracking_touch_shipment_status() from public, anon, authenticated;
revoke all on function public.create_tracking_shipment(text, text, uuid, date, date, text, smallint, text, jsonb, uuid) from public, anon;
revoke all on function public.confirm_tracking_shipment_delivery(uuid, date, uuid) from public, anon;
revoke all on function public.register_tracking_shipment_sale(uuid, numeric, timestamptz, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.register_tracking_shipment_return(uuid, numeric, date, text, uuid) from public, anon;
revoke all on function public.register_tracking_shipment_payment(uuid, numeric, date, text, text, uuid) from public, anon;
grant execute on function public.create_tracking_shipment(text, text, uuid, date, date, text, smallint, text, jsonb, uuid) to authenticated;
grant execute on function public.tracking_next_due_date(date, text, smallint) to authenticated;
grant execute on function public.confirm_tracking_shipment_delivery(uuid, date, uuid) to authenticated;
grant execute on function public.register_tracking_shipment_sale(uuid, numeric, timestamptz, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.register_tracking_shipment_return(uuid, numeric, date, text, uuid) to authenticated;
grant execute on function public.register_tracking_shipment_payment(uuid, numeric, date, text, text, uuid) to authenticated;

commit;
