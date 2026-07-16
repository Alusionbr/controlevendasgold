-- =============================================================================
-- Controle360 - "Rascunho de pedidos": bloco de notas para anotar um pedido
-- (cliente, produto, quantidade, observação) antes de ele virar de fato uma
-- venda/carrinho lançado. Não mexe em estoque nem financeiro — é só uma
-- lista de itens pendentes de lançar, visível a admin e vendedor (cada um só
-- vê os próprios rascunhos; admin vê todos do negócio). Sem status/arquivo:
-- lançar ou descartar a nota simplesmente apaga a linha (ver
-- src/orderDrafts.js) — é bloco de notas, não histórico.
-- =============================================================================

create table if not exists public.order_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  client_name text,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_drafts_business
  on public.order_drafts (business_id, created_at desc);

create index if not exists idx_order_drafts_created_by
  on public.order_drafts (created_by, created_at desc);

alter table public.order_drafts enable row level security;

grant select, insert, update, delete on public.order_drafts to authenticated;

-- Admin: acesso total aos rascunhos do próprio negócio (is_admin() já
-- exige profiles.active = true, ver 0021_enforce_active_profiles_in_rls.sql).
drop policy if exists order_drafts_all_admin on public.order_drafts;
create policy order_drafts_all_admin on public.order_drafts
  for all
  to authenticated
  using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Vendedor: só os próprios rascunhos (criar, ler, editar, apagar) — mesmo
-- padrão de orders_select_seller/orders_insert_seller/orders_update_seller
-- em 0001_init.sql, com is_active_user() explícito porque esta tabela é
-- nova (não existia quando 0021 rodou o ALTER POLICY em massa).
drop policy if exists order_drafts_select_seller on public.order_drafts;
create policy order_drafts_select_seller on public.order_drafts
  for select
  to authenticated
  using (created_by = (select auth.uid()) and public.is_active_user());

drop policy if exists order_drafts_insert_seller on public.order_drafts;
create policy order_drafts_insert_seller on public.order_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and business_id = public.my_business_id()
    and public.is_active_user()
  );

drop policy if exists order_drafts_update_seller on public.order_drafts;
create policy order_drafts_update_seller on public.order_drafts
  for update
  to authenticated
  using (created_by = (select auth.uid()) and public.is_active_user())
  with check (
    created_by = (select auth.uid())
    and business_id = public.my_business_id()
    and public.is_active_user()
  );

drop policy if exists order_drafts_delete_seller on public.order_drafts;
create policy order_drafts_delete_seller on public.order_drafts
  for delete
  to authenticated
  using (created_by = (select auth.uid()) and public.is_active_user());
