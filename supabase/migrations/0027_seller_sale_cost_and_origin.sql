-- =============================================================================
-- Controle360 — venda do estoque próprio do vendedor: origin permitido + CMV
-- =============================================================================
-- Dois bugs encontrados na revisão da comunicação admin↔vendedor:
--
-- 1) `sales_origin_check` (definido em 0003) só aceita
--    ('manual','pedido','consignado','devolucao'). Mas src/salesCart.js
--    (convertOwnStockCart) grava `origin = 'meu_estoque'` quando o vendedor
--    vende do próprio estoque. Resultado: o INSERT em `sales` era REJEITADO
--    pelo Postgres — e como consumeSellerStock() roda ANTES, o estoque do
--    vendedor era baixado sem nenhuma venda ficar registrada. Por isso "as
--    vendas parecem não funcionar no painel". Aqui o valor 'meu_estoque' passa
--    a ser aceito (mantendo o rótulo distinto, útil pra relatório).
--
-- 2) O vendedor não enxerga `products.avg_cost` (RLS oculta o custo — dado do
--    dono). Então convertOwnStockCart grava a venda com `unit_cost = 0`, o que
--    zera CMV e infla o "Lucro bruto" no painel do admin. Mesma solução já
--    usada em 0005 (consignment cost): uma função SECURITY DEFINER preenche o
--    custo no servidor, sem depender do cliente e sem expor o custo a ele.

alter table public.sales
  drop constraint if exists sales_origin_check,
  add constraint sales_origin_check
    check (origin in ('manual', 'pedido', 'consignado', 'devolucao', 'meu_estoque'));

-- Preenche unit_cost/cogs/gross_profit/margin a partir do custo médio real
-- sempre que a linha vier de um vendedor sem custo (unit_cost nulo ou 0) e o
-- produto tiver custo > 0. net_revenue/gross_revenue já vêm corretos do cliente
-- (não dependem do custo), então só recalculamos o que depende do custo.
create or replace function public.fill_seller_sale_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg_cost numeric;
begin
  if new.seller_id is not null and coalesce(new.unit_cost, 0) = 0 then
    select p.avg_cost into v_avg_cost
    from public.products p
    where p.id = new.product_id;

    if v_avg_cost is not null and v_avg_cost > 0 then
      new.unit_cost := v_avg_cost;
      new.cogs := coalesce(new.quantity, 0) * v_avg_cost;
      new.gross_profit := coalesce(new.net_revenue, 0) - new.cogs;
      new.margin := case
        when coalesce(new.net_revenue, 0) <> 0 then new.gross_profit / new.net_revenue
        else 0
      end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_fill_seller_cost on public.sales;
create trigger trg_sales_fill_seller_cost
  before insert on public.sales
  for each row execute function public.fill_seller_sale_cost();
