-- =============================================================================
-- Controle360 - pedido sempre nasce pendente (status so muda com admin),
-- carrinho com pagamento parcial e credito de acerto de estoque proprio
-- =============================================================================

-- 1) sale_carts.payment_mode ganha a opcao 'parcial'
alter table public.sale_carts
  drop constraint if exists sale_carts_payment_mode_check,
  add constraint sale_carts_payment_mode_check
    check (payment_mode in ('avista', 'consignado', 'parcial'));

-- 2) pedidos: status sempre comeca 'pendente' e so admin muda depois de criado.
-- Reaproveita o trigger de trava de approval_status (mesma tabela, mesmo
-- motivo de ser trigger e nao so RLS: comparar OLD/NEW de uma coluna).
create or replace function public.enforce_order_approval_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_role() then
    return new; -- migrações/backfills/edge functions com service role não passam por esta trava
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() and new.approval_status <> 'pendente_aprovacao' then
      raise exception 'Vendedor só pode criar pedidos com approval_status = pendente_aprovacao';
    end if;
    -- Ao retirar/criar um pedido o status logístico sempre começa 'pendente',
    -- independente de quem cria (admin ou vendedor).
    new.status := 'pendente';
    return new;
  end if;

  -- UPDATE
  if new.approval_status is distinct from old.approval_status and not public.is_admin() then
    raise exception 'Somente admin pode alterar approval_status de um pedido';
  end if;

  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'Somente admin pode alterar o status do pedido';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- 3) Credito de "acerto de estoque" concedido pelo admin a um vendedor
-- =============================================================================

alter table public.seller_settings
  add column if not exists stock_adjustment_credits integer not null default 0;

alter table public.seller_settings
  drop constraint if exists seller_settings_stock_adjustment_credits_check,
  add constraint seller_settings_stock_adjustment_credits_check
    check (stock_adjustment_credits >= 0);

-- Trilha de auditoria dos acertos feitos pelo vendedor no proprio estoque
-- (CLAUDE.md: estoque nunca muda sem registro do motivo).
create table if not exists public.seller_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  previous_quantity numeric not null,
  new_quantity numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_stock_adjustments_business on public.seller_stock_adjustments(business_id);
create index if not exists idx_seller_stock_adjustments_seller on public.seller_stock_adjustments(seller_id);
create index if not exists idx_seller_stock_adjustments_product on public.seller_stock_adjustments(product_id);

alter table public.seller_stock_adjustments enable row level security;

drop policy if exists seller_stock_adjustments_all_admin on public.seller_stock_adjustments;
create policy seller_stock_adjustments_all_admin on public.seller_stock_adjustments
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_stock_adjustments_select_seller on public.seller_stock_adjustments;
create policy seller_stock_adjustments_select_seller on public.seller_stock_adjustments
  for select using (seller_id = auth.uid());

-- RPC segura: consome 1 credito (concedido pelo admin em seller_settings) e
-- corrige o estoque proprio do vendedor para a quantidade informada, sempre
-- com motivo obrigatorio. Depois de usar, o credito zera e o admin precisa
-- liberar de novo.
create or replace function public.seller_adjust_own_stock(p_product_id uuid, p_new_quantity numeric, p_reason text)
returns public.seller_stock
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_credits integer;
  v_previous numeric;
  v_row public.seller_stock;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado.';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Estoque nao pode ficar negativo.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Informe o motivo do acerto.';
  end if;

  select business_id, stock_adjustment_credits
    into v_business_id, v_credits
  from public.seller_settings
  where seller_id = auth.uid()
  for update;

  if not found or coalesce(v_credits, 0) <= 0 then
    raise exception 'Voce nao tem liberacao do administrador para fazer um acerto de estoque agora.';
  end if;

  select quantity into v_previous
  from public.seller_stock
  where seller_id = auth.uid() and product_id = p_product_id
  for update;

  v_previous := coalesce(v_previous, 0);

  update public.seller_settings
  set stock_adjustment_credits = stock_adjustment_credits - 1
  where seller_id = auth.uid();

  insert into public.seller_stock (business_id, seller_id, product_id, quantity)
  values (v_business_id, auth.uid(), p_product_id, p_new_quantity)
  on conflict (seller_id, product_id)
  do update set quantity = excluded.quantity
  returning * into v_row;

  insert into public.seller_stock_adjustments
    (business_id, seller_id, product_id, previous_quantity, new_quantity, reason)
  values
    (v_business_id, auth.uid(), p_product_id, v_previous, p_new_quantity, btrim(p_reason));

  return v_row;
end;
$$;

revoke all on function public.seller_adjust_own_stock(uuid, numeric, text) from public;
revoke all on function public.seller_adjust_own_stock(uuid, numeric, text) from anon;
grant execute on function public.seller_adjust_own_stock(uuid, numeric, text) to authenticated;
