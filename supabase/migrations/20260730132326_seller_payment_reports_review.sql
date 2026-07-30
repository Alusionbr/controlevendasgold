begin;

create table if not exists public.seller_payment_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  order_group_id uuid,
  reported_at timestamptz not null,
  reported_amount numeric(12,2) not null check (reported_amount > 0),
  method text,
  proof_path text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_amount numeric(12,2) check (reviewed_amount is null or reviewed_amount > 0),
  reviewed_payment_date date,
  review_notes text,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  payment_id uuid references public.seller_payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(coalesce(method, '')) <= 80),
  check (char_length(coalesce(notes, '')) <= 1000),
  check (char_length(coalesce(review_notes, '')) <= 1000),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and payment_id is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null and payment_id is not null and reviewed_amount is not null and reviewed_payment_date is not null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and payment_id is null)
  )
);

create index if not exists idx_seller_payment_reports_business_status_created
  on public.seller_payment_reports (business_id, status, created_at desc);
create index if not exists idx_seller_payment_reports_seller_created
  on public.seller_payment_reports (seller_id, created_at desc);
create index if not exists idx_seller_payment_reports_reviewed_by
  on public.seller_payment_reports (reviewed_by);
create index if not exists idx_seller_payment_reports_payment_id
  on public.seller_payment_reports (payment_id);

alter table public.seller_payment_reports enable row level security;

drop policy if exists seller_payment_reports_select on public.seller_payment_reports;
create policy seller_payment_reports_select
  on public.seller_payment_reports for select to authenticated
  using (
    seller_id = (select auth.uid())
    or (public.is_admin() and business_id = public.my_business_id())
  );

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
      or exists (
        select 1 from public.orders o
        where coalesce(o.order_group_id, o.id) = seller_payment_reports.order_group_id
          and o.business_id = seller_payment_reports.business_id
          and o.seller_id = (select auth.uid())
          and o.sale_type = 'revenda' and o.approval_status = 'aprovado'
      )
    )
  );

drop policy if exists seller_payment_reports_update_admin on public.seller_payment_reports;
create policy seller_payment_reports_update_admin
  on public.seller_payment_reports for update to authenticated
  using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

revoke all on table public.seller_payment_reports from anon, authenticated;
grant select on table public.seller_payment_reports to authenticated;
grant insert (id, business_id, seller_id, order_group_id, reported_at, reported_amount, method, proof_path, notes)
  on table public.seller_payment_reports to authenticated;
grant update on table public.seller_payment_reports to authenticated;
grant all on table public.seller_payment_reports to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'seller-payment-proofs', 'seller-payment-proofs', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists seller_payment_proofs_insert on storage.objects;
create policy seller_payment_proofs_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'seller-payment-proofs'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'vendedor' and p.active = true
    )
  );

drop policy if exists seller_payment_proofs_select on storage.objects;
create policy seller_payment_proofs_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'seller-payment-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.seller_payment_reports r
        where r.proof_path = storage.objects.name
          and public.is_admin() and r.business_id = public.my_business_id()
      )
    )
  );

drop policy if exists seller_payment_proofs_delete_orphan on storage.objects;
create policy seller_payment_proofs_delete_orphan
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'seller-payment-proofs'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.seller_payment_reports r where r.proof_path = storage.objects.name
    )
  );
create or replace function public.review_seller_payment_report(
  p_report_id uuid,
  p_action text,
  p_amount numeric default null,
  p_payment_date date default null,
  p_method text default null,
  p_review_notes text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $review_seller_payment_report$
declare
  v_report public.seller_payment_reports;
  v_payment_id uuid;
  v_account_amount numeric;
  v_allocated numeric;
  v_open_amount numeric;
  v_total_balance numeric;
  v_open_orders numeric;
  v_legacy_balance numeric;
  v_final_notes text;
begin
  if not public.is_admin() then raise exception 'Somente o administrador pode revisar pagamentos informados'; end if;
  if p_action not in ('approve', 'reject') then raise exception 'Acao invalida'; end if;
  if char_length(coalesce(p_review_notes, '')) > 1000 then raise exception 'Observacao muito longa'; end if;

  select * into v_report from public.seller_payment_reports r
  where r.id = p_report_id and r.business_id = public.my_business_id()
  for update;
  if not found then raise exception 'Pagamento informado nao encontrado'; end if;
  if v_report.status <> 'pending' then raise exception 'Este pagamento ja foi revisado'; end if;

  if p_action = 'reject' then
    update public.seller_payment_reports set
      status = 'rejected', review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
      reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
    where id = v_report.id;
    return null;
  end if;

  if coalesce(p_amount, 0) <= 0 then raise exception 'Informe um valor maior que zero'; end if;
  if p_payment_date is null or p_payment_date > current_date then raise exception 'Informe uma data de pagamento valida'; end if;
  if char_length(coalesce(p_method, '')) > 80 then raise exception 'Forma de pagamento muito longa'; end if;

  perform 1 from public.profiles p
  where p.id = v_report.seller_id and p.business_id = v_report.business_id
  for update;
  v_final_notes := concat_ws(' | ',
    nullif(btrim(coalesce(v_report.notes, '')), ''),
    nullif(btrim(coalesce(p_review_notes, '')), ''),
    'Informado pelo vendedor e conferido pelo administrador'
  );

  if v_report.order_group_id is not null then
    perform 1 from public.orders o
    where coalesce(o.order_group_id, o.id) = v_report.order_group_id
    order by o.id for update;

    select coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0)
      into v_account_amount
    from public.orders o
    join public.seller_account_entries e
      on e.source_id = o.id and e.source_type in ('order', 'order_edit', 'order_cancel')
    where coalesce(o.order_group_id, o.id) = v_report.order_group_id
      and o.business_id = v_report.business_id and o.seller_id = v_report.seller_id;

    select coalesce(sum(a.amount), 0) into v_allocated
    from public.seller_payment_allocations a
    where a.business_id = v_report.business_id and a.seller_id = v_report.seller_id
      and a.order_group_id = v_report.order_group_id;

    v_open_amount := greatest(v_account_amount - v_allocated, 0);
    if v_open_amount < 0.005 then raise exception 'Este pedido ja esta quitado'; end if;
    if p_amount > v_open_amount + 0.004 then raise exception 'O valor excede o saldo aberto do pedido'; end if;
  else
    select coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0)
      into v_total_balance
    from public.seller_account_entries e
    where e.business_id = v_report.business_id and e.seller_id = v_report.seller_id;

    with group_amounts as (
      select coalesce(o.order_group_id, o.id) as group_id,
        coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0) as account_amount
      from public.orders o
      join public.seller_account_entries e
        on e.source_id = o.id and e.source_type in ('order', 'order_edit', 'order_cancel')
      where o.business_id = v_report.business_id and o.seller_id = v_report.seller_id
      group by coalesce(o.order_group_id, o.id)
    ), allocations as (
      select a.order_group_id, sum(a.amount) as allocated
      from public.seller_payment_allocations a
      where a.business_id = v_report.business_id and a.seller_id = v_report.seller_id
      group by a.order_group_id
    )
    select coalesce(sum(greatest(g.account_amount - coalesce(a.allocated, 0), 0)), 0)
      into v_open_orders
    from group_amounts g left join allocations a on a.order_group_id = g.group_id;

    v_legacy_balance := greatest(v_total_balance - v_open_orders, 0);
    if v_legacy_balance < 0.005 then raise exception 'Nao existe saldo anterior em aberto'; end if;
    if p_amount > v_legacy_balance + 0.004 then raise exception 'O valor excede o saldo anterior em aberto'; end if;
  end if;

  insert into public.seller_payments
    (business_id, seller_id, amount, payment_date, method, proof_url, notes, received_by)
  values (
    v_report.business_id, v_report.seller_id, round(p_amount, 2), p_payment_date,
    nullif(btrim(coalesce(p_method, '')), ''), v_report.proof_path, v_final_notes, (select auth.uid())
  ) returning id into v_payment_id;

  if v_report.order_group_id is not null then
    insert into public.seller_payment_allocations
      (business_id, seller_id, payment_id, order_group_id, amount)
    values (v_report.business_id, v_report.seller_id, v_payment_id, v_report.order_group_id, round(p_amount, 2));
  end if;

  insert into public.seller_account_entries
    (business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by)
  values (
    v_report.business_id, v_report.seller_id, 'payment', 'credit', round(p_amount, 2),
    'seller_payment_report', v_report.id, v_final_notes, (select auth.uid())
  );

  update public.seller_payment_reports set
    status = 'approved', reviewed_amount = round(p_amount, 2), reviewed_payment_date = p_payment_date,
    review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''), reviewed_by = (select auth.uid()),
    reviewed_at = now(), payment_id = v_payment_id, updated_at = now()
  where id = v_report.id;

  return v_payment_id;
end;
$review_seller_payment_report$;

revoke all on function public.review_seller_payment_report(uuid, text, numeric, date, text, text) from public, anon;
grant execute on function public.review_seller_payment_report(uuid, text, numeric, date, text, text) to authenticated, service_role;

commit;