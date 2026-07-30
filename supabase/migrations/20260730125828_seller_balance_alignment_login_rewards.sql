begin;

alter table public.seller_settings
  add column if not exists balance_alignment_credits integer not null default 0;
alter table public.seller_settings
  drop constraint if exists seller_settings_balance_alignment_credits_check,
  add constraint seller_settings_balance_alignment_credits_check check (balance_alignment_credits between 0 and 1);

drop policy if exists seller_settings_select_seller on public.seller_settings;
create policy seller_settings_select_seller on public.seller_settings for select to authenticated
  using (seller_id = (select auth.uid()));
grant select on public.seller_settings to authenticated;
create table if not exists public.seller_balance_alignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  previous_balance numeric not null,
  reported_balance numeric not null check (reported_balance >= 0),
  adjustment_direction text not null check (adjustment_direction in ('debit', 'credit', 'none')),
  adjustment_amount numeric not null check (adjustment_amount >= 0),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_seller_balance_alignments_seller on public.seller_balance_alignments (business_id, seller_id, created_at desc);
alter table public.seller_balance_alignments enable row level security;
drop policy if exists seller_balance_alignments_admin on public.seller_balance_alignments;
create policy seller_balance_alignments_admin on public.seller_balance_alignments for select to authenticated
  using (public.is_admin() and business_id = public.my_business_id());
drop policy if exists seller_balance_alignments_seller on public.seller_balance_alignments;
create policy seller_balance_alignments_seller on public.seller_balance_alignments for select to authenticated
  using (seller_id = (select auth.uid()));
grant select on public.seller_balance_alignments to authenticated;
grant all on public.seller_balance_alignments to service_role;
revoke insert, update, delete on public.seller_balance_alignments from authenticated;

create or replace function public.seller_align_balance(p_reported_balance numeric, p_notes text default '')
returns table (previous_balance numeric, reported_balance numeric, adjustment_direction text, adjustment_amount numeric)
language plpgsql security definer set search_path = ''
as $seller_align_balance$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role text;
  v_credits integer;
  v_previous numeric;
  v_difference numeric;
  v_direction text;
  v_amount numeric;
  v_alignment_id uuid := gen_random_uuid();
begin
  if v_user_id is null then raise exception 'Usuario nao autenticado'; end if;
  if p_reported_balance is null or p_reported_balance < 0 then raise exception 'Informe um saldo maior ou igual a zero'; end if;
  select p.business_id, p.role into v_business_id, v_role from public.profiles p where p.id = v_user_id and p.active = true;
  if v_business_id is null or v_role <> 'vendedor' then raise exception 'Somente vendedor ativo pode alinhar o proprio saldo'; end if;

  select ss.balance_alignment_credits into v_credits from public.seller_settings ss
  where ss.seller_id = v_user_id and ss.business_id = v_business_id for update;
  if not found or coalesce(v_credits, 0) <= 0 then raise exception 'O administrador nao liberou um alinhamento de saldo'; end if;

  lock table public.seller_account_entries in share row exclusive mode;
  select coalesce(sum(case when e.direction = 'credit' then -e.amount else e.amount end), 0)
    into v_previous from public.seller_account_entries e
    where e.business_id = v_business_id and e.seller_id = v_user_id;

  v_difference := round(p_reported_balance - v_previous, 2);
  v_amount := abs(v_difference);
  v_direction := case when v_difference > 0.004 then 'debit' when v_difference < -0.004 then 'credit' else 'none' end;
  if v_direction <> 'none' then
    insert into public.seller_account_entries
      (business_id, seller_id, type, direction, amount, source_type, source_id, notes, created_by)
    values (v_business_id, v_user_id, 'manual_adjustment', v_direction, v_amount, 'balance_alignment', v_alignment_id,
      'Saldo informado pelo vendedor. ' || btrim(coalesce(p_notes, '')), v_user_id);
  end if;

  insert into public.seller_balance_alignments
    (id, business_id, seller_id, previous_balance, reported_balance, adjustment_direction, adjustment_amount, notes)
  values (v_alignment_id, v_business_id, v_user_id, v_previous, round(p_reported_balance, 2), v_direction, v_amount,
    nullif(btrim(coalesce(p_notes, '')), ''));
  update public.seller_settings set balance_alignment_credits = 0
  where seller_id = v_user_id and business_id = v_business_id;
  return query select v_previous, round(p_reported_balance, 2), v_direction, v_amount;
end;
$seller_align_balance$;
revoke all on function public.seller_align_balance(numeric, text) from public, anon;
grant execute on function public.seller_align_balance(numeric, text) to authenticated, service_role;

create table if not exists public.seller_login_rewards (
  seller_id uuid primary key references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_login_date date,
  gift_credits integer not null default 0 check (gift_credits >= 0),
  total_gifts_earned integer not null default 0 check (total_gifts_earned >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_login_rewards_business on public.seller_login_rewards (business_id, gift_credits desc, current_streak desc);

create table if not exists public.seller_gift_redemptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  notes text,
  redeemed_by uuid not null references public.profiles(id) on delete restrict,
  redeemed_at timestamptz not null default now()
);
create index if not exists idx_seller_gift_redemptions_seller on public.seller_gift_redemptions (business_id, seller_id, redeemed_at desc);
alter table public.seller_login_rewards enable row level security;
alter table public.seller_gift_redemptions enable row level security;

drop policy if exists seller_login_rewards_admin on public.seller_login_rewards;
create policy seller_login_rewards_admin on public.seller_login_rewards for select to authenticated
  using (public.is_admin() and business_id = public.my_business_id());
drop policy if exists seller_login_rewards_seller on public.seller_login_rewards;
create policy seller_login_rewards_seller on public.seller_login_rewards for select to authenticated
  using (seller_id = (select auth.uid()));
drop policy if exists seller_gift_redemptions_admin on public.seller_gift_redemptions;
create policy seller_gift_redemptions_admin on public.seller_gift_redemptions for select to authenticated
  using (public.is_admin() and business_id = public.my_business_id());
drop policy if exists seller_gift_redemptions_seller on public.seller_gift_redemptions;
create policy seller_gift_redemptions_seller on public.seller_gift_redemptions for select to authenticated
  using (seller_id = (select auth.uid()));
grant select on public.seller_login_rewards, public.seller_gift_redemptions to authenticated;
grant all on public.seller_login_rewards, public.seller_gift_redemptions to service_role;
revoke insert, update, delete on public.seller_login_rewards, public.seller_gift_redemptions from authenticated;

create or replace function public.register_seller_daily_login()
returns table (current_streak integer, best_streak integer, last_login_date date, gift_credits integer, total_gifts_earned integer)
language plpgsql security definer set search_path = ''
as $register_seller_daily_login$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_row public.seller_login_rewards;
  v_next_streak integer;
  v_earned integer := 0;
begin
  if v_user_id is null then raise exception 'Usuario nao autenticado'; end if;
  select p.business_id, p.role into v_business_id, v_role from public.profiles p where p.id = v_user_id and p.active = true;
  if v_business_id is null or v_role <> 'vendedor' then raise exception 'Recompensa disponivel somente para vendedor ativo'; end if;

  insert into public.seller_login_rewards (seller_id, business_id, current_streak, best_streak, last_login_date)
  values (v_user_id, v_business_id, 1, 1, v_today)
  on conflict (seller_id) do nothing;
  select * into v_row from public.seller_login_rewards r where r.seller_id = v_user_id for update;
  if v_row.last_login_date = v_today then
    null;
  else
    v_next_streak := case when v_row.last_login_date = v_today - 1 then v_row.current_streak + 1 else 1 end;
    v_earned := case when mod(v_next_streak, 15) = 0 then 1 else 0 end;
    update public.seller_login_rewards
    set current_streak = v_next_streak, best_streak = greatest(best_streak, v_next_streak), last_login_date = v_today,
        gift_credits = gift_credits + v_earned, total_gifts_earned = total_gifts_earned + v_earned, updated_at = now()
    where seller_id = v_user_id returning * into v_row;
  end if;
  return query select v_row.current_streak, v_row.best_streak, v_row.last_login_date, v_row.gift_credits, v_row.total_gifts_earned;
end;
$register_seller_daily_login$;

create or replace function public.redeem_seller_login_gift(p_seller_id uuid, p_notes text default '')
returns integer language plpgsql security definer set search_path = ''
as $redeem_seller_login_gift$
declare
  v_admin_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role text;
  v_credits integer;
begin
  select p.business_id, p.role into v_business_id, v_role from public.profiles p where p.id = v_admin_id and p.active = true;
  if v_business_id is null or v_role <> 'admin' then raise exception 'Somente administrador pode entregar o brinde'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_seller_id and p.business_id = v_business_id and p.role = 'vendedor' and p.active = true)
    then raise exception 'Vendedor nao encontrado'; end if;
  select r.gift_credits into v_credits from public.seller_login_rewards r
  where r.seller_id = p_seller_id and r.business_id = v_business_id for update;
  if not found or coalesce(v_credits, 0) <= 0 then raise exception 'Este vendedor nao tem brinde disponivel'; end if;
  update public.seller_login_rewards set gift_credits = gift_credits - 1, updated_at = now() where seller_id = p_seller_id;
  insert into public.seller_gift_redemptions (business_id, seller_id, notes, redeemed_by)
  values (v_business_id, p_seller_id, nullif(btrim(coalesce(p_notes, '')), ''), v_admin_id);
  return v_credits - 1;
end;
$redeem_seller_login_gift$;

revoke all on function public.register_seller_daily_login() from public, anon;
grant execute on function public.register_seller_daily_login() to authenticated, service_role;
revoke all on function public.redeem_seller_login_gift(uuid, text) from public, anon;
grant execute on function public.redeem_seller_login_gift(uuid, text) to authenticated, service_role;

commit;