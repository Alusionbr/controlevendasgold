-- =============================================================================
-- Controle360 — RLS para stock_movements: permitir vendedores registrarem
-- devoluções e desperdícios nas próprias vendas
-- =============================================================================

-- Primeiro, corrige o CHECK constraint em sales.origin para incluir 'devolucao'
-- (estava em ('manual', 'pedido', 'consignado'), precisa incluir 'devolucao')
alter table public.sales
  drop constraint if exists sales_origin_check,
  add constraint sales_origin_check
    check (origin in ('manual', 'pedido', 'consignado', 'devolucao'));

-- Adiciona RLS policy para vendedores inserirem stock_movements relacionados
-- às suas próprias vendas (devoluções e desperdícios).
-- A policy garante que:
-- 1. O tipo de movimento é um dos permitidos (entrada_devolucao_venda, saida_desperdicio)
-- 2. A venda referenciada pertence ao vendedor
-- 3. Rejeita UPDATE/DELETE por vendedores (apenas INSERT permitido)

drop policy if exists stock_movements_seller_insert on public.stock_movements;
create policy stock_movements_seller_insert on public.stock_movements
  for insert
  with check (
    -- Apenas tipos de movimento permitidos para vendedores
    type in ('entrada_devolucao_venda', 'saida_desperdicio')
    -- E a venda referenciada deve pertencer a este vendedor
    and exists (
      select 1 from public.sales
      where sales.id = stock_movements.ref_id
        and sales.seller_id = auth.uid()
    )
  );

-- Leitura: vendedores podem ver movimentos das próprias vendas.
-- Não abrimos um segundo OR "produto é do mesmo negócio", porque isso
-- exporia compras/produção/vendas de outros vendedores (admin já tem
-- acesso total via stock_movements_all_admin).
drop policy if exists stock_movements_seller_select on public.stock_movements;
create policy stock_movements_seller_select on public.stock_movements
  for select
  using (
    exists (
      select 1 from public.sales
      where sales.id = stock_movements.ref_id
        and sales.seller_id = auth.uid()
    )
  );
