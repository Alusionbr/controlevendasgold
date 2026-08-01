-- Controle360 — vendedor volta a montar pedido para o admin, com trava de
-- catálogo por produto.
--
-- Contexto: 0023_seller_read_only.sql tornou o vendedor somente leitura e
-- derrubou as policies de escrita em `orders`. Esta migração devolve APENAS a
-- capacidade de pedir produtos ao admin — nada de vender, baixar estoque,
-- mexer em cliente ou lançar no próprio saldo. Quem aprova, materializa
-- estoque e lança dívida continua sendo o admin.
--
-- Por que `orders` e não `sale_carts`: o pedido do vendedor já tem um caminho
-- inteiro pronto e testado em cima de `orders` — `enforce_order_approval_lock`
-- (0023) valida piso de preço, `setGroupApproval` + `syncOrderDebt` lançam a
-- dívida na aprovação, `advance_order_group` (20260725142236) baixa o estoque
-- no despacho, e `list_seller_order_accounts` (20260729205823) monta a conta
-- por pedido que o vendedor vê em "Minha conta". Reusar isso significa zero
-- lógica nova de estoque ou financeiro.
--
-- Trava de catálogo: existe produto no estoque que é só de controle interno
-- (matéria-prima, embalagem). Se o vendedor puder pedir esses itens, o pedido
-- diverge do que o negócio de fato revende. Por isso o produto passa a ter
-- `orderable_by_sellers`, e tanto o catálogo (seller_products) quanto o
-- trigger de pedido passam a respeitar a marca.

begin;

-- ---------------------------------------------------------------------------
-- 1. Marca no produto: "disponível para vendedores pedirem"
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists orderable_by_sellers boolean not null default false;

-- Backfill por tipo em vez de um default cego. `false` para tudo deixaria o
-- vendedor sem catálogo nenhum no dia seguinte à migração; `true` para tudo
-- exporia exatamente a matéria-prima que motivou esta trava. O que o negócio
-- revende é produto final, mercadoria e kit.
update public.products
   set orderable_by_sellers = true
 where type in ('produto_final', 'mercadoria', 'kit');

comment on column public.products.orderable_by_sellers is
  'Quando true, o produto aparece no catálogo do vendedor e pode entrar em pedido de reposição. Matéria-prima, embalagem e itens de controle interno ficam false.';

-- ---------------------------------------------------------------------------
-- 2. Catálogo do vendedor carrega e respeita a marca
-- ---------------------------------------------------------------------------

alter table public.seller_products
  add column if not exists orderable_by_sellers boolean not null default false;

update public.seller_products sp
   set orderable_by_sellers = p.orderable_by_sellers
  from public.products p
 where p.id = sp.id;

-- Mesma função de 0027, agora propagando a coluna nova.
create or replace function public.sync_seller_product_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $sync_seller_product_catalog$
begin
  if tg_op = 'DELETE' then
    delete from public.seller_products where id = old.id;
    return old;
  end if;

  insert into public.seller_products (
    id, business_id, name, type, unit, current_stock, sale_price,
    default_price, price_floor, min_stock, notes, created_at, updated_at,
    stock_available, stock_hidden, orderable_by_sellers
  ) values (
    new.id, new.business_id, new.name, new.type, new.unit, null,
    new.sale_price, new.default_price, new.price_floor, new.min_stock,
    new.notes, new.created_at, new.updated_at, new.current_stock > 0, true,
    new.orderable_by_sellers
  )
  on conflict (id) do update set
    business_id = excluded.business_id,
    name = excluded.name,
    type = excluded.type,
    unit = excluded.unit,
    current_stock = null,
    sale_price = excluded.sale_price,
    default_price = excluded.default_price,
    price_floor = excluded.price_floor,
    min_stock = excluded.min_stock,
    notes = excluded.notes,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    stock_available = excluded.stock_available,
    stock_hidden = true,
    orderable_by_sellers = excluded.orderable_by_sellers;

  return new;
end;
$sync_seller_product_catalog$;

revoke all on function public.sync_seller_product_catalog() from public, anon, authenticated;

-- A policy de 0027 liberava TODO o catálogo para qualquer perfil ativo do
-- negócio. Separada em duas: o admin enxerga tudo (precisa, para configurar);
-- o vendedor, só o que está liberado.
drop policy if exists seller_products_select_active_business on public.seller_products;

drop policy if exists seller_products_select_admin on public.seller_products;
create policy seller_products_select_admin
  on public.seller_products for select to authenticated
  using (public.is_admin() and business_id = public.my_business_id());

drop policy if exists seller_products_select_seller on public.seller_products;
create policy seller_products_select_seller
  on public.seller_products for select to authenticated
  using (
    orderable_by_sellers = true
    and exists (
      select 1 from public.profiles caller
      where caller.id = (select auth.uid())
        and caller.active = true
        and caller.role = 'vendedor'
        and caller.business_id = seller_products.business_id
    )
  );

create index if not exists idx_seller_products_orderable
  on public.seller_products (business_id, orderable_by_sellers);

-- ---------------------------------------------------------------------------
-- 3. Preço por vendedor: ele precisa ler o próprio preço para montar o pedido
-- ---------------------------------------------------------------------------
-- `enforce_order_approval_lock` já usa coalesce(seller_prices.floor,
-- products.price_floor) como piso, então o preço individual por vendedor já é
-- respeitado no servidor. Faltava o vendedor conseguir LER o próprio preço
-- para a tela preencher o campo — 0023_seller_read_only removeu essa policy.

drop policy if exists seller_prices_select_seller on public.seller_prices;
create policy seller_prices_select_seller
  on public.seller_prices for select to authenticated
  using (seller_id = (select auth.uid()));

grant select on public.seller_prices to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trava de catálogo dentro do lock de pedido que já existe
-- ---------------------------------------------------------------------------
-- Mantém tudo que 0023_order_integrity_and_price_floor já fazia (quantidade,
-- preço, piso por vendedor, "vendedor só cria pendente_aprovacao", "só admin
-- altera pedido criado") e acrescenta a checagem de catálogo. O admin não
-- passa por nenhuma dessas regras: pode lançar pedido de qualquer produto.

create or replace function public.enforce_order_approval_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $enforce_order_approval_lock$
declare
  v_floor numeric;
  v_orderable boolean;
  v_product_name text;
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

  select coalesce(sp.floor, p.price_floor), p.orderable_by_sellers, p.name
    into v_floor, v_orderable, v_product_name
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
    if not public.is_admin() then
      if new.approval_status <> 'pendente_aprovacao' then
        raise exception 'Vendedor só pode criar pedidos aguardando aprovação';
      end if;
      if coalesce(v_orderable, false) = false then
        raise exception 'O produto % não está liberado para pedido de vendedor', coalesce(v_product_name, '?')
          using errcode = 'check_violation';
      end if;
    end if;
    new.status := 'pendente';
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'Somente o administrador pode alterar um pedido já criado';
  end if;

  return new;
end;
$enforce_order_approval_lock$;

revoke all on function public.enforce_order_approval_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS de `orders`: vendedor lê os próprios e cria pedido de reposição
-- ---------------------------------------------------------------------------
-- Sem UPDATE e sem DELETE de propósito: depois de enviado, só o admin mexe
-- (o trigger acima recusaria de qualquer forma, mas não damos o grant).

drop policy if exists orders_select_seller on public.orders;
create policy orders_select_seller
  on public.orders for select to authenticated
  using (seller_id = (select auth.uid()));

drop policy if exists orders_insert_seller on public.orders;
create policy orders_insert_seller
  on public.orders for insert to authenticated
  with check (
    seller_id = (select auth.uid())
    and business_id = public.my_business_id()
    and sale_type = 'revenda'
    and approval_status = 'pendente_aprovacao'
    and client_id is null
    and exists (
      select 1 from public.profiles caller
      where caller.id = (select auth.uid())
        and caller.active = true
        and caller.role = 'vendedor'
    )
  );

grant select, insert on public.orders to authenticated;

commit;
