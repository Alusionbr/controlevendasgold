-- Controle360 - integridade do pedido antes do despacho
--
-- A interface permite ajustar preço e quantidade enquanto o pedido ainda não
-- saiu. Esta trava garante que uma chamada direta à API não possa inserir
-- preço/quantidade inválidos nem um vendedor alterar o pedido depois de criado.

create or replace function public.enforce_order_approval_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor numeric;
begin
  if public.is_privileged_role() then
    return new;
  end if;

  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'Quantidade do pedido precisa ser maior que zero'
      using errcode = 'check_violation';
  end if;

  if coalesce(new.unit_price, 0) <= 0 then
    raise exception 'Preço unitário do pedido precisa ser maior que zero'
      using errcode = 'check_violation';
  end if;

  select coalesce(sp.floor, p.price_floor)
    into v_floor
  from public.products p
  left join public.seller_prices sp
    on sp.product_id = p.id
   and sp.seller_id = new.seller_id
  where p.id = new.product_id;

  if v_floor is not null and new.unit_price < v_floor then
    raise exception 'Preço unitário (%) abaixo do piso permitido (%) para este produto',
      round(new.unit_price, 2), round(v_floor, 2)
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() and new.approval_status <> 'pendente_aprovacao' then
      raise exception 'Vendedor só pode criar pedidos aguardando aprovação';
    end if;
    new.status := 'pendente';
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'Somente o administrador pode alterar um pedido já criado';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_order_approval_lock() from public, anon, authenticated;
