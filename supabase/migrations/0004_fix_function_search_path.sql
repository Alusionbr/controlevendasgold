-- =============================================================================
-- Controle360 — fixa search_path das funções SECURITY DEFINER/STABLE que não
-- tinham (advisor de segurança do Supabase: function_search_path_mutable).
-- Sem search_path fixo, uma função SECURITY DEFINER pode ser enganada por um
-- schema malicioso no search_path da sessão que chama. Reaplica as mesmas
-- definições de 0001_init.sql, só adicionando `set search_path = public`.
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_privileged_role()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(current_setting('request.jwt.claims', true), '') = ''
    or (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
$$;

create or replace function public.sales_goals_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
