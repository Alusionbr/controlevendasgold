-- Support cash, partial and credit terms for manual direct sales without
-- guessing the settlement state of historical sales.

begin;

alter table public.sales
  add column if not exists payment_mode text,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists due_date date,
  add column if not exists payment_method text,
  add column if not exists request_id uuid;

alter table public.sales
  drop constraint if exists sales_payment_mode_valid,
  add constraint sales_payment_mode_valid
    check (payment_mode is null or payment_mode in ('avista', 'parcial', 'a_prazo')),
  drop constraint if exists sales_paid_amount_valid,
  add constraint sales_paid_amount_valid
    check (
      paid_amount >= 0
      and paid_amount <= greatest(coalesce(net_revenue, 0), 0)
    ),
  drop constraint if exists sales_payment_terms_valid,
  add constraint sales_payment_terms_valid
    check (
      payment_mode is null
      or (
        payment_mode = 'avista'
        and net_revenue is not null
        and round(net_revenue, 2) > 0
        and paid_amount = round(net_revenue, 2)
        and (due_date is null or due_date = date)
        and nullif(btrim(coalesce(payment_method, '')), '') is not null
      )
      or (
        payment_mode = 'parcial'
        and net_revenue is not null
        and round(net_revenue, 2) > 0
        and paid_amount > 0
        and paid_amount < round(net_revenue, 2)
        and due_date is not null
        and due_date >= date
        and nullif(btrim(coalesce(payment_method, '')), '') is not null
      )
      or (
        payment_mode = 'a_prazo'
        and net_revenue is not null
        and round(net_revenue, 2) > 0
        and paid_amount = 0
        and due_date is not null
        and due_date >= date
      )
    );

create unique index if not exists idx_sales_direct_request_unique
  on public.sales (business_id, request_id)
  where request_id is not null;

create or replace function public.create_sale_receivable()
returns trigger
language plpgsql
security invoker
set search_path = ''
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
    round(new.net_revenue, 2),
    least(round(coalesce(new.paid_amount, 0), 2), round(new.net_revenue, 2)),
    new.client_id,
    'sale',
    new.id,
    nullif(btrim(coalesce(new.payment_method, '')), ''),
    coalesce(new.notes, ''),
    (select auth.uid())
  )
  on conflict (business_id, source_type, source_id)
    where source_id is not null do nothing;

  return new;
end;
$sale_receivable$;

revoke all on function public.create_sale_receivable() from public, anon;

create or replace function public.register_direct_sale(
  p_request_id uuid,
  p_date date,
  p_channel text,
  p_client_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_discount numeric,
  p_fixed_fees numeric,
  p_fee_percent numeric,
  p_payment_mode text,
  p_paid_amount numeric,
  p_due_date date,
  p_payment_method text,
  p_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $register_direct_sale$
declare
  v_business_id uuid;
  v_existing public.sales%rowtype;
  v_product_type text;
  v_stock numeric;
  v_unit_cost numeric;
  v_quantity numeric := coalesce(p_quantity, 0);
  v_unit_price numeric := round(coalesce(p_unit_price, 0), 2);
  v_discount numeric := round(coalesce(p_discount, 0), 2);
  v_fixed_fees numeric := round(coalesce(p_fixed_fees, 0), 2);
  v_fee_percent numeric := round(coalesce(p_fee_percent, 0), 4);
  v_gross_revenue numeric;
  v_percent_fees numeric;
  v_net_revenue numeric;
  v_cogs numeric;
  v_gross_profit numeric;
  v_margin numeric;
  v_paid_amount numeric := round(coalesce(p_paid_amount, 0), 2);
  v_due_date date;
  v_payment_method text := nullif(btrim(coalesce(p_payment_method, '')), '');
  v_channel text := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'Direto');
  v_notes text := btrim(coalesce(p_notes, ''));
  v_sale_id uuid;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'Somente o administrador pode registrar venda direta';
  end if;

  v_business_id := (select public.my_business_id());
  if v_business_id is null then
    raise exception 'Negócio não encontrado';
  end if;
  if p_request_id is null then
    raise exception 'Identificador da operação é obrigatório';
  end if;
  if p_date is null then
    raise exception 'Data da venda é obrigatória';
  end if;
  if p_product_id is null then
    raise exception 'Produto é obrigatório';
  end if;
  if v_quantity <= 0 then
    raise exception 'Quantidade precisa ser maior que zero';
  end if;
  if v_unit_price <= 0 then
    raise exception 'Preço unitário precisa ser maior que zero';
  end if;
  if v_discount < 0 or v_fixed_fees < 0 or v_fee_percent < 0 or v_fee_percent > 100 then
    raise exception 'Desconto e taxas precisam ser válidos';
  end if;
  if p_payment_mode is null or p_payment_mode not in ('avista', 'parcial', 'a_prazo') then
    raise exception 'Modalidade de pagamento inválida';
  end if;

  v_gross_revenue := round(v_quantity * v_unit_price, 2);
  v_percent_fees := round(v_gross_revenue * v_fee_percent / 100, 2);
  v_net_revenue := round(v_gross_revenue - v_discount - v_fixed_fees - v_percent_fees, 2);
  if v_net_revenue <= 0 then
    raise exception 'Receita líquida precisa ser maior que zero';
  end if;

  if p_payment_mode = 'avista' then
    if v_paid_amount <> v_net_revenue then
      raise exception 'Venda à vista exige valor pago igual à receita líquida';
    end if;
    if v_payment_method is null then
      raise exception 'Informe o método do pagamento recebido';
    end if;
    v_due_date := p_date;
  elsif p_payment_mode = 'parcial' then
    if v_paid_amount <= 0 or v_paid_amount >= v_net_revenue then
      raise exception 'Venda parcial exige valor pago maior que zero e menor que a receita líquida';
    end if;
    if p_due_date is null or p_due_date < p_date then
      raise exception 'Informe um vencimento válido para o saldo';
    end if;
    if v_payment_method is null then
      raise exception 'Informe o método do pagamento recebido';
    end if;
    v_due_date := p_due_date;
  else
    if v_paid_amount <> 0 then
      raise exception 'Venda a prazo exige valor pago igual a zero';
    end if;
    if p_due_date is null or p_due_date < p_date then
      raise exception 'Informe um vencimento válido para a venda a prazo';
    end if;
    v_due_date := p_due_date;
  end if;

  -- Serializa repetições do mesmo pedido antes de qualquer efeito material.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );

  select s.*
    into v_existing
    from public.sales s
   where s.business_id = v_business_id
     and s.request_id = p_request_id
   for update;

  if found then
    if v_existing.origin is distinct from 'manual'
       or v_existing.seller_id is not null
       or v_existing.date is distinct from p_date
       or v_existing.channel is distinct from v_channel
       or v_existing.client_id is distinct from p_client_id
       or v_existing.product_id is distinct from p_product_id
       or v_existing.quantity is distinct from v_quantity
       or v_existing.unit_price is distinct from v_unit_price
       or v_existing.discount is distinct from v_discount
       or v_existing.fixed_fees is distinct from v_fixed_fees
       or v_existing.fee_percent is distinct from v_fee_percent
       or v_existing.payment_mode is distinct from p_payment_mode
       or v_existing.paid_amount is distinct from v_paid_amount
       or v_existing.due_date is distinct from v_due_date
       or v_existing.payment_method is distinct from v_payment_method
       or v_existing.notes is distinct from v_notes then
      raise exception 'Identificador da operação já usado com dados diferentes';
    end if;
    return v_existing.id;
  end if;

  if p_client_id is not null and not exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.business_id = v_business_id
  ) then
    raise exception 'Cliente não encontrado no negócio';
  end if;

  -- O bloqueio da linha impede duas vendas concorrentes de consumirem o
  -- mesmo saldo de estoque. Serviço também é validado e bloqueado, mas nunca
  -- tem estoque ou movimentação alterados.
  select p.type, p.current_stock, p.avg_cost
    into v_product_type, v_stock, v_unit_cost
    from public.products p
   where p.id = p_product_id
     and p.business_id = v_business_id
   for update;

  if not found then
    raise exception 'Produto não encontrado no negócio';
  end if;
  if v_product_type <> 'servico' and v_stock < v_quantity then
    raise exception 'Estoque insuficiente. Disponível: %', v_stock;
  end if;

  v_cogs := round(v_quantity * coalesce(v_unit_cost, 0), 2);
  v_gross_profit := round(v_net_revenue - v_cogs, 2);
  v_margin := case when v_net_revenue > 0 then v_gross_profit / v_net_revenue else 0 end;

  insert into public.sales (
    business_id, date, channel, client_id, product_id, quantity, unit_price,
    discount, fixed_fees, fee_percent, percent_fees, unit_cost,
    gross_revenue, net_revenue, cogs, gross_profit, margin, notes,
    origin, origin_id, seller_id, payment_mode, paid_amount, due_date,
    payment_method, request_id
  ) values (
    v_business_id, p_date, v_channel, p_client_id, p_product_id, v_quantity,
    v_unit_price, v_discount, v_fixed_fees, v_fee_percent, v_percent_fees,
    coalesce(v_unit_cost, 0), v_gross_revenue, v_net_revenue, v_cogs,
    v_gross_profit, v_margin, v_notes, 'manual', null, null, p_payment_mode,
    v_paid_amount, v_due_date, v_payment_method, p_request_id
  )
  returning id into v_sale_id;

  if v_product_type <> 'servico' then
    update public.products
       set current_stock = current_stock - v_quantity
     where id = p_product_id
       and business_id = v_business_id;

    insert into public.stock_movements (
      business_id, date, type, product_id, quantity, unit_cost, total_cost,
      ref_type, ref_id, notes
    ) values (
      v_business_id, p_date, 'saida_venda', p_product_id, -v_quantity,
      coalesce(v_unit_cost, 0), -v_cogs, 'sale', v_sale_id, v_notes
    );
  end if;

  -- O trigger acima é parte da mesma transação. Se ele for removido ou não
  -- conseguir criar a conta, abortamos tudo para não deixar venda órfã.
  if not exists (
    select 1
      from public.financial_entries f
     where f.business_id = v_business_id
       and f.source_type = 'sale'
       and f.source_id = v_sale_id
  ) then
    raise exception 'Não foi possível criar o lançamento financeiro da venda';
  end if;

  return v_sale_id;
end;
$register_direct_sale$;

revoke all on function public.register_direct_sale(
  uuid, date, text, uuid, uuid, numeric, numeric, numeric, numeric, numeric,
  text, numeric, date, text, text
) from public, anon;
grant execute on function public.register_direct_sale(
  uuid, date, text, uuid, uuid, numeric, numeric, numeric, numeric, numeric,
  text, numeric, date, text, text
) to authenticated, service_role;

-- Historical direct sales keep their current financial status because the old
-- records do not say whether they were cash, partial or credit sales. They must
-- be reviewed by a person instead of being marked paid automatically.

-- This migration intentionally performs no data backfill. Historical sales
-- and purchases remain unchanged until a person classifies them explicitly.

commit;
