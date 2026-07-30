begin;

create or replace function public.seller_can_report_payment_for_order(
  p_order_group_id uuid,
  p_business_id uuid,
  p_seller_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $seller_can_report_payment_for_order$
  select
    p_order_group_id is not null
    and p_seller_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.business_id = p_business_id
        and p.role = 'vendedor'
        and p.active = true
    )
    and exists (
      select 1
      from public.orders o
      where coalesce(o.order_group_id, o.id) = p_order_group_id
        and o.business_id = p_business_id
        and o.seller_id = (select auth.uid())
        and o.sale_type = 'revenda'
        and o.approval_status = 'aprovado'
    );
$seller_can_report_payment_for_order$;

revoke all on function public.seller_can_report_payment_for_order(uuid, uuid, uuid) from public, anon;
grant execute on function public.seller_can_report_payment_for_order(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists seller_payment_reports_insert_seller on public.seller_payment_reports;
create policy seller_payment_reports_insert_seller
  on public.seller_payment_reports for insert to authenticated
  with check (
    seller_id = (select auth.uid())
    and business_id = public.my_business_id()
    and status = 'pending'
    and reported_at between now() - interval '365 days' and now() + interval '5 minutes'
    and proof_path like (select auth.uid())::text || '/' || id::text || '/%'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.business_id = seller_payment_reports.business_id
        and p.role = 'vendedor' and p.active = true
    )
    and (
      order_group_id is null
      or public.seller_can_report_payment_for_order(order_group_id, business_id, seller_id)
    )
  );

commit;