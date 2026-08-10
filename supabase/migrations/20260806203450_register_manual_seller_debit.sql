-- Registra um débito manual no ledger do vendedor sem criar venda, pedido
-- ou carrinho. A chave da requisição torna repetições da mesma ação idempotentes.
create unique index if not exists seller_account_entries_manual_debit_request_uidx
  on public.seller_account_entries (business_id, source_type, source_id)
  where source_type = 'manual_seller_debit' and source_id is not null;

create or replace function public.register_manual_seller_debit(
  p_seller_id uuid,
  p_amount numeric,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $register_manual_seller_debit$
declare
  v_business_id uuid;
  v_entry_id uuid;
  v_existing_seller_id uuid;
  v_existing_amount numeric;
  v_existing_reason text;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (select public.is_admin()) then
    raise exception 'Somente o administrador pode lançar débito manual';
  end if;
  if p_seller_id is null then
    raise exception 'Selecione um vendedor';
  end if;
  if v_amount <= 0 then
    raise exception 'Informe um valor maior que zero';
  end if;
  if p_amount <> v_amount then
    raise exception 'Informe o valor com no máximo duas casas decimais';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Informe um motivo com pelo menos 3 caracteres';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'O motivo deve ter no máximo 500 caracteres';
  end if;
  if p_request_id is null then
    raise exception 'Identificador da operação ausente';
  end if;

  v_business_id := (select public.my_business_id());
  if not exists (
    select 1
    from public.profiles
    where id = p_seller_id
      and business_id = v_business_id
      and role = 'vendedor'
      and active = true
  ) then
    raise exception 'Vendedor não encontrado ou inativo';
  end if;

  insert into public.seller_account_entries (
    business_id, seller_id, type, direction, amount,
    source_type, source_id, notes, created_by
  ) values (
    v_business_id, p_seller_id, 'manual_adjustment', 'debit', v_amount,
    'manual_seller_debit', p_request_id, v_reason, (select auth.uid())
  )
  on conflict (business_id, source_type, source_id)
    where source_type = 'manual_seller_debit' and source_id is not null
  do nothing
  returning id into v_entry_id;

  if v_entry_id is not null then
    return v_entry_id;
  end if;

  select id, seller_id, amount, notes
    into v_entry_id, v_existing_seller_id, v_existing_amount, v_existing_reason
  from public.seller_account_entries
  where business_id = v_business_id
    and source_type = 'manual_seller_debit'
    and source_id = p_request_id;

  if v_entry_id is null then
    raise exception 'Não foi possível confirmar o lançamento manual';
  end if;
  if v_existing_seller_id <> p_seller_id
     or v_existing_amount <> v_amount
     or v_existing_reason <> v_reason then
    raise exception 'Identificador de operação já utilizado com dados diferentes';
  end if;

  return v_entry_id;
end;
$register_manual_seller_debit$;

revoke all on function public.register_manual_seller_debit(uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.register_manual_seller_debit(uuid, numeric, text, uuid)
  to authenticated, service_role;
