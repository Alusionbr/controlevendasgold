-- =============================================================================
-- Controle360 — corrige custo zerado/nulo em consignação criada pelo vendedor
-- =============================================================================
-- Bug encontrado em QA: quando o vendedor vende do próprio estoque (aba "Meu
-- estoque"), o app cria uma linha em `consignments` com `cost_at_send`. O
-- vendedor não tem acesso a `products.avg_cost` (RLS não libera custo para
-- vendedor — dado sensível do dono do negócio), então `src/sellerStock.js`
-- sempre grava `cost_at_send = null` nesse fluxo, corrompendo silenciosamente
-- o CMV/margem desse item nos relatórios do admin.
--
-- Mesma solução já usada no piso de preço (seção 8 de 0001_init.sql): uma
-- função SECURITY DEFINER preenche o valor sensível no servidor, sem depender
-- do cliente (que nunca deveria ter visto o custo em primeiro lugar).

create or replace function public.fill_consignment_cost_at_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cost_at_send is null then
    select p.avg_cost into new.cost_at_send
    from public.products p
    where p.id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_consignments_fill_cost on public.consignments;
create trigger trg_consignments_fill_cost
  before insert on public.consignments
  for each row execute function public.fill_consignment_cost_at_send();
