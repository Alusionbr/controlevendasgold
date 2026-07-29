-- Histórico de alterações de cadastros administrativos.
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
drop policy if exists record_audit_log_admin_read on public.record_audit_log;
create policy record_audit_log_admin_read on public.record_audit_log
  for select to authenticated
  using ((select public.is_admin()) and business_id = (select public.my_business_id()));
revoke all on public.record_audit_log from public, anon;
grant select on public.record_audit_log to authenticated;
grant all on public.record_audit_log to service_role;
create index if not exists idx_record_audit_log_entity
  on public.record_audit_log (business_id, entity, entity_id, changed_at desc);

create or replace function public.log_record_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare key text; old_json jsonb := to_jsonb(old); new_json jsonb := to_jsonb(new);
begin
  for key in select jsonb_object_keys(new_json) loop
    if key not in ('updated_at') and old_json -> key is distinct from new_json -> key then
      insert into public.record_audit_log (business_id, entity, entity_id, field, old_value, new_value, changed_by, source)
      values (new.business_id, tg_table_name, new.id, key, old_json ->> key, new_json ->> key, auth.uid(),
        case when auth.uid() is null then 'system' else 'user' end);
    end if;
  end loop;
  return new;
end;
$$;

-- Apenas as entidades administrativas explicitamente auditadas pelo produto.
drop trigger if exists trg_products_audit on public.products;
create trigger trg_products_audit after update on public.products for each row execute function public.log_record_audit();
drop trigger if exists trg_clients_audit on public.clients;
create trigger trg_clients_audit after update on public.clients for each row execute function public.log_record_audit();
drop trigger if exists trg_suppliers_audit on public.suppliers;
create trigger trg_suppliers_audit after update on public.suppliers for each row execute function public.log_record_audit();
drop trigger if exists trg_orders_audit on public.orders;
create trigger trg_orders_audit after update on public.orders for each row execute function public.log_record_audit();
drop trigger if exists trg_tasks_audit on public.tasks;
create trigger trg_tasks_audit after update on public.tasks for each row execute function public.log_record_audit();

revoke all on function public.log_record_audit() from public, anon;
