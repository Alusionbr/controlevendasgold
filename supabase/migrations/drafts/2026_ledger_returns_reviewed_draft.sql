-- =============================================================================
-- DRAFT REVISADO — NÃO APLICAR SEM REVISÃO HUMANA / NÃO É UMA MIGRATION NUMERADA
-- =============================================================================
-- Objetivo: dar forma, seguindo os PADRÕES REAIS deste projeto (migrations
-- 0001-0009), às estruturas das Fases 2-4 do pacote de replicação:
--   Fase 2  -> sale_carts.paid_initial_amount        (pagamento parcial real)
--   Fase 3  -> seller_account_entries + seller_payments (ledger + pagamentos)
--   Fase 4  -> operational_movements                 (devolução c/ status, desperdício, brinde)
--
-- Diferenças em relação ao draft original do pacote
-- (controle360_replication_implementation_pack_v1/supabase/drafts/...):
--   * RLS de verdade, no padrão is_admin()/my_business_id() + seller-scoped.
--   * Mutação do vendedor via RPC SECURITY DEFINER (nunca escrita direta em
--     tabela sensível), como consume_seller_stock / seller_adjust_own_stock.
--   * updated_at via set_updated_at(); triggers de guarda com is_privileged_role().
--
-- Ao implementar de verdade: QUEBRAR por fase, revisar, e renumerar como
-- 0010 / 0011 / 0012. Este arquivo é só referência de conteúdo.
-- =============================================================================

-- =============================================================================
-- FASE 2 — valor pago inicial no carrinho (pagamento parcial)
-- =============================================================================
alter table public.sale_carts
  add column if not exists paid_initial_amount numeric not null default 0
    check (paid_initial_amount >= 0);
-- Regra de negócio (aplicada no app / opcionalmente em trigger):
--   avista     -> paid_initial_amount = Σ(approved_quantity * unit_price)
--   consignado -> paid_initial_amount = 0
--   parcial    -> 0 < paid_initial_amount < total aprovado
-- divida_gerada = total_aprovado - paid_initial_amount  (>= 0)

-- =============================================================================
-- FASE 3 — LEDGER DO VENDEDOR
-- =============================================================================

-- 3.1 Lançamentos (o saldo é SEMPRE a soma disto; nunca sobrescrito)
create table if not exists public.seller_account_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'debit_replenishment', -- débito: reposição consignado/parcial aprovada
    'payment',             -- crédito: pagamento recebido
    'return_credit',       -- crédito: devolução conferida
    'manual_adjustment',   -- débito OU crédito, com motivo
    'writeoff',            -- crédito: perdão/baixa de dívida
    'bonus_credit'         -- crédito: bonificação
  )),
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric not null check (amount >= 0),
  source_type text,   -- ex.: 'sale_cart', 'operational_movement', 'manual'
  source_id uuid,     -- id da origem (sem FK: aponta para tabelas diferentes)
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_account_entries_seller
  on public.seller_account_entries (business_id, seller_id, created_at desc);

-- 3.2 Pagamentos fracionados (cada pagamento também vira um lançamento 'payment')
create table if not exists public.seller_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  payment_date date not null default current_date,
  method text,
  proof_url text,
  notes text,
  received_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_payments_seller
  on public.seller_payments (business_id, seller_id, payment_date desc);

-- 3.3 RLS — admin full; vendedor SÓ LÊ o próprio (mutação via RPC)
alter table public.seller_account_entries enable row level security;
alter table public.seller_payments enable row level security;

drop policy if exists seller_account_entries_all_admin on public.seller_account_entries;
create policy seller_account_entries_all_admin on public.seller_account_entries
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_account_entries_select_seller on public.seller_account_entries;
create policy seller_account_entries_select_seller on public.seller_account_entries
  for select using (seller_id = auth.uid());

drop policy if exists seller_payments_all_admin on public.seller_payments;
create policy seller_payments_all_admin on public.seller_payments
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_payments_select_seller on public.seller_payments;
create policy seller_payments_select_seller on public.seller_payments
  for select using (seller_id = auth.uid());

-- 3.4 Saldo agregado (view). RLS das tabelas base já filtra por papel.
create or replace view public.seller_balances as
  select
    business_id,
    seller_id,
    coalesce(sum(case when direction = 'debit'  then amount else 0 end), 0)
      - coalesce(sum(case when direction = 'credit' then amount else 0 end), 0) as balance
  from public.seller_account_entries
  group by business_id, seller_id;

-- 3.5 RPC — admin registra pagamento recebido (grava pagamento + lançamento).
create or replace function public.admin_register_seller_payment(
  p_seller_id uuid,
  p_amount numeric,
  p_method text default null,
  p_proof_url text default null,
  p_notes text default null
) returns public.seller_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_payment public.seller_payments;
begin
  if not public.is_admin() then
    raise exception 'Somente admin pode registrar pagamento de vendedor.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Valor do pagamento deve ser maior que zero.';
  end if;

  v_business_id := public.my_business_id();

  -- garante que o vendedor é do mesmo negócio do admin
  if not exists (
    select 1 from public.profiles
    where id = p_seller_id and business_id = v_business_id and role = 'vendedor'
  ) then
    raise exception 'Vendedor não pertence ao seu negócio.';
  end if;

  insert into public.seller_payments
    (business_id, seller_id, amount, method, proof_url, notes, received_by)
  values
    (v_business_id, p_seller_id, p_amount, p_method, p_proof_url, p_notes, auth.uid())
  returning * into v_payment;

  insert into public.seller_account_entries
    (business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by)
  values
    (v_business_id, p_seller_id, 'payment', 'credit', p_amount, 'seller_payment', v_payment.id, p_notes, auth.uid());

  return v_payment;
end;
$$;

revoke all on function public.admin_register_seller_payment(uuid, numeric, text, text, text) from public;
revoke all on function public.admin_register_seller_payment(uuid, numeric, text, text, text) from anon;
grant execute on function public.admin_register_seller_payment(uuid, numeric, text, text, text) to authenticated;

-- NOTA: o débito 'debit_replenishment' (aprovação de carrinho consignado/parcial)
-- e o 'return_credit' (devolução conferida) são gravados no MESMO caminho que já
-- roda como admin (approveCart / confirmação de devolução), então não precisam
-- de RPC separada — só de um INSERT na seller_account_entries dentro daquela
-- transação. Documentado aqui para não duplicar lógica.

-- =============================================================================
-- FASE 4 — MOVIMENTAÇÕES OPERACIONAIS (devolução c/ status, desperdício, brinde)
-- =============================================================================

-- 4.1 novo tipo de movimento de estoque para brinde
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
      'saida_brinde'                -- NOVO
    ));

create table if not exists public.operational_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('return', 'waste', 'gift', 'manual_adjustment')),
  -- status cobre devolução (logístico) e waste/gift (simples pending->confirmed)
  status text not null default 'a_devolver' check (status in (
    'a_devolver', 'enviado', 'recebido', 'devolvido', 'devolvido_parcialmente', 'recusado',
    'pending', 'confirmed', 'cancelled'
  )),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_declared numeric not null check (quantity_declared > 0),
  quantity_received numeric,
  seller_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  origin_type text,
  destination_type text,
  reason text not null,
  notes text,
  tracking_code text,
  carrier text,
  -- impacto só é DISPARADO na conferência; estas flags dizem SE deve impactar
  affects_stock boolean not null default false,
  affects_finance boolean not null default false,
  unit_value numeric,
  total_value numeric,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  confirmed_at timestamptz
);

create index if not exists idx_operational_movements_business
  on public.operational_movements (business_id, type, status, created_at desc);
create index if not exists idx_operational_movements_seller
  on public.operational_movements (business_id, seller_id, status);

drop trigger if exists trg_operational_movements_updated_at on public.operational_movements;
create trigger trg_operational_movements_updated_at
  before update on public.operational_movements
  for each row execute function public.set_updated_at();

-- 4.2 RLS — admin full; vendedor cria só solicitação e lê o próprio; NUNCA confere
alter table public.operational_movements enable row level security;

drop policy if exists operational_movements_all_admin on public.operational_movements;
create policy operational_movements_all_admin on public.operational_movements
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists operational_movements_select_seller on public.operational_movements;
create policy operational_movements_select_seller on public.operational_movements
  for select using (seller_id = auth.uid());

drop policy if exists operational_movements_insert_seller on public.operational_movements;
create policy operational_movements_insert_seller on public.operational_movements
  for insert with check (
    seller_id = auth.uid()
    and business_id = public.my_business_id()
    and status in ('a_devolver', 'pending')  -- vendedor só ABRE a solicitação
  );
-- (sem UPDATE/DELETE para vendedor: conferência e impacto são só do admin/RPC)

-- 4.3 Trigger de guarda — impede o vendedor de "pular" para status que impacta
create or replace function public.enforce_operational_movement_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_role() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- só admin muda status de uma movimentação já criada
    if new.status is distinct from old.status and not public.is_admin() then
      raise exception 'Somente admin pode conferir/mudar o status de uma movimentação operacional.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_operational_movements_lock on public.operational_movements;
create trigger trg_operational_movements_lock
  before update on public.operational_movements
  for each row execute function public.enforce_operational_movement_lock();

-- 4.4 RPC — admin confere a movimentação e dispara o impacto (estoque + ledger)
--     numa transação. Esboço: a lógica real de estoque/ledger deve reusar o
--     mesmo caminho de recordMovement/lançamento já existente.
create or replace function public.confirm_operational_movement(
  p_id uuid,
  p_quantity_received numeric,
  p_new_status text default 'recebido'
) returns public.operational_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.operational_movements;
begin
  if not public.is_admin() then
    raise exception 'Somente admin pode conferir uma movimentação operacional.';
  end if;

  select * into v_row from public.operational_movements
  where id = p_id and business_id = public.my_business_id()
  for update;
  if not found then
    raise exception 'Movimentação não encontrada no seu negócio.';
  end if;

  -- TODO (implementação real):
  --  * se affects_stock: inserir stock_movements (entrada_devolucao_venda /
  --    entrada_devolucao_consignado / saida_desperdicio / saida_brinde) e ajustar estoque;
  --  * se affects_finance e type='return' de consignado admin->vendedor:
  --    inserir seller_account_entries ('return_credit','credit', ...).
  --  Manter tudo nesta transação para não deixar registro órfão.

  update public.operational_movements
    set status = p_new_status,
        quantity_received = p_quantity_received,
        approved_by = auth.uid(),
        confirmed_at = now(),
        received_at = coalesce(received_at, now())
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.confirm_operational_movement(uuid, numeric, text) from public;
revoke all on function public.confirm_operational_movement(uuid, numeric, text) from anon;
grant execute on function public.confirm_operational_movement(uuid, numeric, text) to authenticated;

-- =============================================================================
-- FIM DO DRAFT — revisar, quebrar por fase e renumerar antes de aplicar.
-- =============================================================================
