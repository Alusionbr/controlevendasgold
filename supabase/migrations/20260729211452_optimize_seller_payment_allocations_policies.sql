-- Otimiza a FK e evita duas policies permissivas para o mesmo SELECT.

create index if not exists idx_seller_payment_allocations_seller_id
  on public.seller_payment_allocations (seller_id);

drop policy if exists seller_payment_allocations_all_admin on public.seller_payment_allocations;
drop policy if exists seller_payment_allocations_select_seller on public.seller_payment_allocations;

create policy seller_payment_allocations_select
  on public.seller_payment_allocations for select to authenticated
  using (
    (public.is_admin() and business_id = public.my_business_id())
    or seller_id = (select auth.uid())
  );

create policy seller_payment_allocations_insert_admin
  on public.seller_payment_allocations for insert to authenticated
  with check (public.is_admin() and business_id = public.my_business_id());

create policy seller_payment_allocations_update_admin
  on public.seller_payment_allocations for update to authenticated
  using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

create policy seller_payment_allocations_delete_admin
  on public.seller_payment_allocations for delete to authenticated
  using (public.is_admin() and business_id = public.my_business_id());