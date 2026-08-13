-- =============================================================================
-- Controle360 — último acesso dos usuários
-- =============================================================================

alter table public.profiles
  add column if not exists last_access_at timestamptz;

-- O cliente pode disparar a atualização do próprio acesso, mas o horário é
-- sempre definido pelo banco. Admins não conseguem alterar o carimbo de outro
-- usuário por acidente ou por payload enviado pelo navegador.
create or replace function public.guard_profile_last_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_role() then
    return new;
  end if;

  if auth.uid() = old.id then
    if new.last_access_at is distinct from old.last_access_at then
      new.last_access_at := now();
    end if;
  else
    new.last_access_at := old.last_access_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_last_access() from public, anon, authenticated;

drop trigger if exists trg_profiles_last_access_guard on public.profiles;
create trigger trg_profiles_last_access_guard
  before update of last_access_at on public.profiles
  for each row execute function public.guard_profile_last_access();

create index if not exists idx_profiles_business_last_access
  on public.profiles (business_id, last_access_at desc);