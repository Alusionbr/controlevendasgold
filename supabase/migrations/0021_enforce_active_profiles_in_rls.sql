-- Controle360 - conta desativada nao pode continuar usando a Data API.
--
-- A interface ja encerrava a sessao ao encontrar profiles.active=false, mas
-- um token valido ainda passava pelas policies que verificavam apenas uid,
-- role e business_id. O perfil proprio continua legivel para que o cliente
-- consiga identificar a desativacao e mostrar a mensagem correta.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
  );
$$;

revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active = true
  );
$$;

create or replace function public.my_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id
  from public.profiles
  where id = auth.uid()
    and active = true;
$$;

do $$
declare
  policy_row record;
  statement text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and policyname <> 'profiles_select_own'
  loop
    statement := format(
      'alter policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    if policy_row.qual is not null and policy_row.qual not like '%is_active_user%' then
      statement := statement || format(
        ' using ((%s) and public.is_active_user())',
        policy_row.qual
      );
    end if;

    if policy_row.with_check is not null and policy_row.with_check not like '%is_active_user%' then
      statement := statement || format(
        ' with check ((%s) and public.is_active_user())',
        policy_row.with_check
      );
    end if;

    execute statement;
  end loop;
end;
$$;
