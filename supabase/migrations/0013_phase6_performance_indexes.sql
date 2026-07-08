-- =============================================================================
-- Controle360 - Fase 6 (revisao de seguranca/performance): indices de FK
-- faltando e RLS otimizada nas 3 tabelas novas das Fases 2-4. Achados via
-- mcp__Supabase__get_advisors apos aplicar 0010-0012.
--
-- Nota: os mesmos dois padroes (auth.uid() sem `select`, e par de policies
-- _all_admin + _select_seller gerando "multiple_permissive_policies") ja
-- existiam em consignments/seller_prices/seller_stock/sale_carts antes
-- desta migracao — nao sao regressao das Fases 2-4, e uma limpeza ampla
-- disso fica fora do escopo aqui (afetaria tabelas que ja estao em
-- producao). Corrigido so nas tabelas novas.
-- =============================================================================

-- Indices de FK que o advisor de performance apontou como faltando
create index if not exists idx_operational_movements_approved_by on public.operational_movements (approved_by);
create index if not exists idx_operational_movements_client_id on public.operational_movements (client_id);
create index if not exists idx_operational_movements_created_by on public.operational_movements (created_by);
create index if not exists idx_operational_movements_product_id on public.operational_movements (product_id);
-- idx_operational_movements_seller ja cobre seller_id (business_id, seller_id, status)

create index if not exists idx_seller_account_entries_created_by on public.seller_account_entries (created_by);
-- idx_seller_account_entries_seller ja cobre seller_id (business_id, seller_id, created_at)

create index if not exists idx_seller_payments_received_by on public.seller_payments (received_by);
-- idx_seller_payments_seller ja cobre seller_id (business_id, seller_id, payment_date)

-- RLS: troca auth.uid() por (select auth.uid()) nas policies de vendedor das
-- 3 tabelas novas (auth_rls_initplan — evita reavaliar a funcao por linha).
drop policy if exists seller_account_entries_select_seller on public.seller_account_entries;
create policy seller_account_entries_select_seller on public.seller_account_entries
  for select using (seller_id = (select auth.uid()));

drop policy if exists seller_payments_select_seller on public.seller_payments;
create policy seller_payments_select_seller on public.seller_payments
  for select using (seller_id = (select auth.uid()));

drop policy if exists operational_movements_select_seller on public.operational_movements;
create policy operational_movements_select_seller on public.operational_movements
  for select using (seller_id = (select auth.uid()));

drop policy if exists operational_movements_insert_seller on public.operational_movements;
create policy operational_movements_insert_seller on public.operational_movements
  for insert with check (
    seller_id = (select auth.uid())
    and business_id = public.my_business_id()
    and status in ('a_devolver', 'pending')
  );
