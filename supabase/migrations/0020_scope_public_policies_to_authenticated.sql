-- Controle360 - policies de negocio sao exclusivas de usuarios autenticados.
--
-- As migrations antigas omitiram `to authenticated`, fazendo as policies
-- valerem para PUBLIC. Os predicados com auth.uid()/is_admin() ja negavam o
-- acesso anonimo, mas o escopo explicito reduz superficie e custo de RLS.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles = array['public']::name[]
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;
