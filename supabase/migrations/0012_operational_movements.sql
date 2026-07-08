-- =============================================================================
-- Controle360 - Fase 4 (devolucao com status, desperdicio, brinde). Ver
-- docs/replication-v1/05-fase4-devolucoes-desperdicio-brinde.md.
--
-- Regra central: status "a_devolver"/"pending" NAO mexe em estoque nem
-- financeiro. So a CONFERENCIA (sempre uma acao do admin) dispara o
-- impacto. Por isso nao ha RPC security-definer aqui — confirmar uma
-- movimentacao e sempre feito no contexto do admin logado (que ja tem RLS
-- de escrita em products/stock_movements/seller_stock/seller_account_entries
-- via *_all_admin), o mesmo padrao ja usado em approveCart/sellerLedger.
-- =============================================================================

-- 1) Novo tipo de movimento de estoque para brinde
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
      'saida_brinde'
    ));

create table if not exists public.operational_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('return', 'waste', 'gift')),
  status text not null default 'a_devolver' check (status in (
    'a_devolver', 'enviado', 'recebido', 'devolvido', 'devolvido_parcialmente', 'recusado',
    'pending', 'confirmed', 'cancelled'
  )),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_declared numeric not null check (quantity_declared > 0),
  quantity_received numeric,
  seller_id uuid references public.profiles(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  reason text not null,
  notes text,
  affects_stock boolean not null default true,
  affects_finance boolean not null default false,
  unit_value numeric,
  total_value numeric,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
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

-- 2) RLS — admin full; vendedor cria so a propria solicitacao pendente e le
-- o que e seu; NUNCA confere (sem UPDATE para vendedor).
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
    and status in ('a_devolver', 'pending')
  );

-- 3) Trava: so admin muda o status depois de criado (mesmo padrao de
-- enforce_order_approval_lock, migracao 0009).
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
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'Somente admin pode conferir/mudar o status de uma movimentacao operacional.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_operational_movements_lock on public.operational_movements;
create trigger trg_operational_movements_lock
  before update on public.operational_movements
  for each row execute function public.enforce_operational_movement_lock();
