-- Controle360 - carrinhos editaveis e relatos de ajuda

-- Vendedor pode excluir apenas carrinhos proprios ainda operacionais. Carrinho
-- convertido/vendido fica como historico e deve receber acerto por novo carrinho.
drop policy if exists sale_carts_delete_seller on public.sale_carts;
create policy sale_carts_delete_seller on public.sale_carts
  for delete to authenticated
  using (
    seller_id = auth.uid()
    and business_id = public.my_business_id()
    and status in ('draft', 'shared', 'submitted', 'pending_approval')
  );

alter table public.tasks
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.tasks
  alter column created_by set default auth.uid();

grant select, insert on public.tasks to authenticated;

-- Relatos de bug/ajuda/sugestao viram tarefas visiveis ao administrador.
-- O vendedor so consegue criar e reler os proprios relatos com prefixos
-- controlados para evitar abrir a gestao completa de tarefas.
drop policy if exists tasks_select_seller_help_report on public.tasks;
create policy tasks_select_seller_help_report on public.tasks
  for select to authenticated
  using (
    created_by = auth.uid()
    and business_id = public.my_business_id()
    and (
      title like '[BUG]%'
      or title like '[AJUDA]%'
      or title like '[MELHORIA]%'
    )
  );

drop policy if exists tasks_insert_seller_help_report on public.tasks;
create policy tasks_insert_seller_help_report on public.tasks
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and business_id = public.my_business_id()
    and status = 'a_fazer'
    and (
      title like '[BUG]%'
      or title like '[AJUDA]%'
      or title like '[MELHORIA]%'
    )
  );
