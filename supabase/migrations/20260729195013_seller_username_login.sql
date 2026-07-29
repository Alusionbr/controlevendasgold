-- Login interno de vendedores por usuário, sem envio de e-mail.
alter table public.profiles
  add column if not exists username text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (
        username is null
        or (username = lower(username) and username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
      );
  end if;
end;
$$;

create unique index if not exists idx_profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'Identificador de login do vendedor; contas antigas permanecem por e-mail até o administrador definir usuário e senha.';