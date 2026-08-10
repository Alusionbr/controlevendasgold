-- A reward failure must not prevent seller account data from loading.
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
  select p.business_id, p.role into v_business_id, v_role
  from public.profiles p
  where p.id = v_user_id and p.active = true;
  if v_business_id is null or v_role <> 'vendedor' then
    raise exception 'Recompensa disponivel somente para vendedor ativo';
  end if;

  insert into public.seller_login_rewards (seller_id, business_id, current_streak, best_streak, last_login_date)
  values (v_user_id, v_business_id, 1, 1, v_today)
  on conflict (seller_id) do nothing;
  select * into v_row from public.seller_login_rewards r where r.seller_id = v_user_id for update;

  if v_row.last_login_date <> v_today then
    v_next_streak := case when v_row.last_login_date = v_today - 1 then v_row.current_streak + 1 else 1 end;
    v_earned := case when mod(v_next_streak, 15) = 0 then 1 else 0 end;
    update public.seller_login_rewards as r
    set current_streak = v_next_streak,
        best_streak = greatest(r.best_streak, v_next_streak),
        last_login_date = v_today,
        gift_credits = r.gift_credits + v_earned,
        total_gifts_earned = r.total_gifts_earned + v_earned,
        updated_at = now()
    where r.seller_id = v_user_id
