-- Controle360 - historico de edicao com auditoria.
-- Registra, campo a campo, o que mudou em cadastros sensiveis (por enquanto
-- products; entidades adicionais entram no mesmo trigger no futuro).
-- Leitura restrita ao admin do negocio - vendedor nao ve quem mudou o que.

create table if not exists public.record_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entity text not null check (entity in ('products', 'clients', 'suppliers', 'orders', 'tasks')),
  entity_id uuid not null,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  source text not null default 'user' check (source in ('user', 'system'))
);

alter table public.record_audit_log enable row level security;

drop policy if exists record_audit_log_all_admin on public.record_audit_log;
create policy record_audit_log_all_admin
  on public.record_audit_log
  for all
  to authenticated
  using (
    (select public.is_admin())
    and business_id = (select public.my_business_id())
  )
  with check (
    (select public.is_admin())
    and business_id = (select public.my_business_id())
  );

revoke all on public.record_audit_log from public, anon;
grant select, insert on public.record_audit_log to authenticated;
grant all on public.record_audit_log to service_role;

create index if not exists idx_record_audit_log_entity
  on public.record_audit_log (business_id, entity, entity_id, changed_at desc);

-- Compara to_jsonb(old) com to_jsonb(new) e insere uma linha por campo
-- alterado, inclusive avg_cost/current_stock (recalculo de custo medio,
-- baixa/entrada de estoque) - e assim que o historico mostra a origem real
-- do numero atual. changed_by usa auth.uid(): fica nulo quando a mudanca
-- vem de outro trigger/funcao SECURITY DEFINER sem sessao de usuario (ex.:
-- RPC de compra) - por isso source distingue 'system' de 'user' via o
-- parametro do gatilho (tg_argv[0]).
create or replace function public.log_record_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_source text := coalesce(tg_argv[0], 'user');
  v_skip text[] := array['updated_at', 'created_at'];
begin
  for v_key in select jsonb_object_keys(v_new)
  loop
    if v_key = any(v_skip) then
      continue;
    end if;
    if v_old -> v_key is distinct from v_new -> v_key then
      insert into public.record_audit_log (
        business_id, entity, entity_id, field, old_value, new_value, changed_by, source
      ) values (
        new.business_id, tg_argv[1], new.id, v_key,
        v_old ->> v_key, v_new ->> v_key, auth.uid(), v_source
      );
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.log_record_audit() from public, anon;

drop trigger if exists trg_products_audit_log on public.products;
create trigger trg_products_audit_log
  after update on public.products
  for each row execute function public.log_record_audit('user', 'products');
