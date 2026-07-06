-- =============================================================================
-- Controle360 — migração inicial multi-usuário (admin/vendedor)
-- =============================================================================
-- Convenções:
--   * Nomes de coluna em snake_case (equivalente camelCase é documentado em
--     docs/backend.md, na tabela de mapeamento).
--   * Dinheiro e quantidade sempre `numeric` (evita erro de ponto flutuante).
--   * Datas de evento de negócio (ex.: data da venda) ficam como `date`
--     porque o app usa `YYYY-MM-DD` puro (ver src/utils.js `today()`).
--   * `created_at`/`updated_at` são `timestamptz` com trigger automática.
--   * Esta migração é reexecutável: usa `create table if not exists`,
--     `create or replace function`, `drop trigger if exists` + `create trigger`,
--     e `drop policy if exists` + `create policy`.
--   * RLS é a fronteira de segurança real: cada tabela tem RLS habilitado e
--     policies explícitas — não existe tabela "aberta por padrão".
-- =============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- =============================================================================
-- 1. FUNÇÃO UTILITÁRIA DE updated_at
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- 2. PROFILES (perfil de usuário: admin ou vendedor)
-- =============================================================================
-- Observação/assumção: no MVP local um único usuário podia ter vários
-- "businesses". Na versão multi-usuário simplificamos para 1 negócio por
-- perfil (business_id). Se no futuro um admin precisar gerenciar mais de um
-- negócio, será necessário um passo extra (ex.: tabela de associação
-- profile<->business N:N). Fora do escopo desta migração.
--
-- A FK de business_id -> businesses(id) é adicionada depois que a tabela
-- `businesses` existir (ver seção 3), para evitar dependência circular entre
-- profiles e businesses (businesses.owner_id também referencia profiles).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'vendedor')),
  name text,
  business_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. BUSINESSES (raiz do tenant / negócio)
-- =============================================================================

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  segment text,
  default_target_margin numeric,
  default_fee_percent numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- Agora que `businesses` existe, conectamos profiles.business_id -> businesses.id.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_business_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_business_id_fkey
      foreign key (business_id) references public.businesses(id) on delete set null;
  end if;
end $$;

-- =============================================================================
-- 4. FUNÇÕES HELPER DE RLS
-- =============================================================================
-- IMPORTANTE: estas três funções são `security definer` (não o padrão
-- `security invoker`). Motivo, comprovado testando esta migração localmente:
-- a policy "profiles_select_admin" (seção 12) usa is_admin()/my_business_id()
-- na sua condição. Se essas funções rodassem como invoker, a consulta interna
-- delas em `public.profiles` seria RE-ESCRITA pelo planner acrescentando as
-- policies de RLS de profiles — incluindo a própria "profiles_select_admin",
-- que chama is_admin()/my_business_id() de novo. O planner tenta INLINE essas
-- SQL functions recursivamente em tempo de planejamento e estoura a pilha
-- ("stack depth limit exceeded") antes mesmo de executar a query — não é um
-- problema de runtime, então "OR de policies com short-circuit" não salva.
-- Como `security definer`, a consulta interna roda com o dono da função
-- (quem aplica a migração, ex.: postgres/supabase_admin), que tem BYPASSRLS,
-- então a consulta a profiles não é reescrita com policies e a recursão não
-- acontece. `set search_path` fixo evita sequestro de função via search_path.

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active
  );
$$;

create or replace function public.my_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.business_id from public.profiles p where p.id = auth.uid();
$$;

-- Identifica execução vinda de um contexto privilegiado (a própria migração
-- rodando direto via psql/postgres, ou a Edge Function usando a service role
-- key através do PostgREST). Usada pelos triggers de guarda abaixo para não
-- travar operações administrativas legítimas feitas fora do fluxo normal do
-- PostgREST autenticado — nesses contextos não existe JWT de usuário, então
-- auth.uid() é null e is_admin() sempre daria falso mesmo para uma operação
-- totalmente confiável.
--
-- IMPORTANTE (bug encontrado testando esta migração localmente): NÃO dá para
-- checar `current_user`/`pg_has_role(current_user, ...)` aqui, porque as
-- funções de trigger que usam esta checagem são `security definer` — dentro
-- de uma função security definer, `current_user` passa a ser o DONO da
-- função (quem aplicou a migração), não o chamador original, para QUALQUER
-- chamador. Isso fazia a checagem retornar sempre verdadeiro e desligava a
-- trava de piso de preço/aprovação para todo mundo, inclusive vendedores.
-- A forma correta é ler a GUC `request.jwt.claims` que o PostgREST define por
-- requisição (mesma GUC usada por auth.uid()/auth.role()): ela é estado de
-- sessão, não muda com escalonamento de security definer. Ausência total da
-- claim (conexão direta via psql/service de backend, sem passar pelo
-- PostgREST) também conta como privilegiado; claim com role='service_role'
-- (Edge Function usando a chave de service role) idem.
create or replace function public.is_privileged_role()
returns boolean
language sql
stable
as $$
  select
    coalesce(current_setting('request.jwt.claims', true), '') = ''
    or (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role';
$$;

-- =============================================================================
-- 5. TABELAS OPERACIONAIS
-- =============================================================================

-- ---------- products ----------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  type text not null check (type in ('materia_prima', 'embalagem', 'produto_final', 'mercadoria', 'kit', 'servico')),
  unit text,
  current_stock numeric not null default 0,
  avg_cost numeric not null default 0,
  sale_price numeric,
  min_stock numeric,
  labor_cost_per_unit numeric default 0,
  overhead_cost_per_unit numeric default 0,
  loss_percent numeric default 0,
  target_margin_percent numeric default 0,
  tax_fee_percent numeric default 0,
  notes text,
  -- NOVO (multi-usuário): preço padrão sugerido e piso mínimo de venda.
  -- `default_price` é o preço de referência da loja/admin; `price_floor` é o
  -- valor mínimo absoluto que QUALQUER vendedor pode praticar (ver seção 8,
  -- trigger de piso de preço).
  default_price numeric,
  price_floor numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- clients -------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  type text default 'cliente' check (type in ('cliente', 'consignado', 'ambos')),
  notes text,
  -- NOVO: vendedor dono do cliente. NULL = cliente compartilhado/da casa,
  -- visível e editável apenas pelo admin (ver policies da seção 9).
  seller_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------- suppliers ------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------- purchases -------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  supplier_id uuid references public.suppliers(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null,
  total_cost numeric not null,
  unit_cost numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_purchases_updated_at on public.purchases;
create trigger trg_purchases_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- ---------- stock_movements --------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  type text not null check (type in (
    'entrada_compra',
    'saida_producao_insumo',
    'entrada_producao_produto_final',
    'saida_venda',
    'saida_envio_consignado',
    'entrada_devolucao_consignado',
    'ajuste_manual',
    -- NOVOS tipos exigidos pelo produto multi-usuário:
    'saida_desperdicio',
    'entrada_devolucao_venda'
  )),
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null, -- positivo = entrada, negativo = saída (mesma regra do MVP local)
  unit_cost numeric,
  total_cost numeric,
  ref_type text, -- ex.: 'sale', 'purchase', 'production', 'consignment' (rastreio da origem)
  ref_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- recipes (ficha técnica) --------------------------------------
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  final_product_id uuid not null references public.products(id) on delete cascade,
  input_product_id uuid not null references public.products(id) on delete cascade,
  quantity_per_unit numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_recipes_updated_at on public.recipes;
create trigger trg_recipes_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ---------- productions ---------------------------------------------------
create table if not exists public.productions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  final_product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null,
  total_cost numeric,
  unit_cost numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_productions_updated_at on public.productions;
create trigger trg_productions_updated_at
  before update on public.productions
  for each row execute function public.set_updated_at();

-- ---------- sales -----------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  channel text,
  client_id uuid references public.clients(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null,
  unit_price numeric not null,
  discount numeric default 0,
  fixed_fees numeric default 0,
  fee_percent numeric default 0,       -- taxa percentual configurada (input)
  percent_fees numeric default 0,      -- valor calculado da taxa percentual (quantidade * preço * fee_percent/100)
  unit_cost numeric,
  gross_revenue numeric,
  net_revenue numeric,
  cogs numeric,
  gross_profit numeric,
  margin numeric,
  notes text,
  origin text default 'manual' check (origin in ('manual', 'pedido', 'consignado')),
  origin_id uuid, -- id do pedido/consignação de origem, quando aplicável (sem FK fixa: pode apontar para orders ou consignments)
  -- NOVOS campos multi-usuário:
  seller_id uuid references public.profiles(id) on delete set null,
  -- Vínculo para devolução/desperdício: aponta para a venda original.
  -- Uma linha com parent_sale_id preenchido é um AJUSTE (não uma venda nova)
  -- e fica isenta da checagem de piso de preço (ver seção 8).
  parent_sale_id uuid references public.sales(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- ---------- orders (pedidos) -----------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null,
  unit_price numeric,
  due_date date,
  status text not null default 'pendente' check (status in ('pendente', 'em_preparo', 'pronto', 'despachado', 'concluido')),
  notes text,
  converted_sale_id uuid references public.sales(id) on delete set null,
  -- NOVOS campos multi-usuário:
  seller_id uuid references public.profiles(id) on delete set null,
  -- `approval_status` é o portão de aprovação do admin. `status` (logística)
  -- só passa a ter efeito prático depois que approval_status = 'aprovado'.
  -- Vendedor NUNCA pode gravar aprovado/rejeitado (RLS + trigger, seção 9/10).
  approval_status text not null default 'pendente_aprovacao' check (approval_status in ('pendente_aprovacao', 'aprovado', 'rejeitado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------- consignments ----------------------------------------------------
create table if not exists public.consignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null default current_date,
  client_id uuid references public.clients(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity_sent numeric not null,
  quantity_sold numeric not null default 0,
  quantity_returned numeric not null default 0,
  amount_paid numeric not null default 0,
  unit_price numeric,
  cost_at_send numeric,
  notes text,
  -- Assunção: o MVP local só usa 'com_cliente' hoje; 'quitado'/'encerrado'
  -- são estados futuros de fechamento. Ajustar o CHECK se o produto definir
  -- outros nomes.
  status text not null default 'com_cliente' check (status in ('com_cliente', 'quitado', 'encerrado')),
  -- NOVO (assumção): consignação também precisa de dono (vendedor) para que
  -- a regra de RLS "vendedor só vê o que é seu" (pedida no contrato) funcione.
  -- Não estava na lista explícita de colunas novas do pedido, mas é exigido
  -- pela policy de RLS descrita para consignments. Confirmar com o time.
  seller_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_consignments_updated_at on public.consignments;
create trigger trg_consignments_updated_at
  before update on public.consignments
  for each row execute function public.set_updated_at();

-- ---------- consignment_events ----------------------------------------------
create table if not exists public.consignment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  consignment_id uuid not null references public.consignments(id) on delete cascade,
  type text not null check (type in ('envio', 'venda_cliente', 'devolucao', 'pagamento')),
  date date not null default current_date,
  quantity numeric default 0,
  amount numeric default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_consignment_events_updated_at on public.consignment_events;
create trigger trg_consignment_events_updated_at
  before update on public.consignment_events
  for each row execute function public.set_updated_at();

-- ---------- tasks -------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  due_date date,
  status text not null default 'a_fazer' check (status in ('a_fazer', 'fazendo', 'aguardando', 'feito')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 6. TABELAS NOVAS (preço por vendedor e estoque do vendedor)
-- =============================================================================

create table if not exists public.seller_prices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric not null,
  floor numeric, -- piso específico deste vendedor; se nulo, cai no products.price_floor
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, product_id)
);

drop trigger if exists trg_seller_prices_updated_at on public.seller_prices;
create trigger trg_seller_prices_updated_at
  before update on public.seller_prices
  for each row execute function public.set_updated_at();

create table if not exists public.seller_stock (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, product_id)
);

drop trigger if exists trg_seller_stock_updated_at on public.seller_stock;
create trigger trg_seller_stock_updated_at
  before update on public.seller_stock
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 7. ÍNDICES DE APOIO (RLS filtra por business_id/seller_id o tempo todo)
-- =============================================================================

create index if not exists idx_products_business on public.products(business_id);
create index if not exists idx_clients_business on public.clients(business_id);
create index if not exists idx_clients_seller on public.clients(seller_id);
create index if not exists idx_suppliers_business on public.suppliers(business_id);
create index if not exists idx_purchases_business on public.purchases(business_id);
create index if not exists idx_stock_movements_business on public.stock_movements(business_id);
create index if not exists idx_stock_movements_product on public.stock_movements(product_id);
create index if not exists idx_recipes_business on public.recipes(business_id);
create index if not exists idx_productions_business on public.productions(business_id);
create index if not exists idx_sales_business on public.sales(business_id);
create index if not exists idx_sales_seller on public.sales(seller_id);
create index if not exists idx_orders_business on public.orders(business_id);
create index if not exists idx_orders_seller on public.orders(seller_id);
create index if not exists idx_consignments_business on public.consignments(business_id);
create index if not exists idx_consignments_seller on public.consignments(seller_id);
create index if not exists idx_consignment_events_consignment on public.consignment_events(consignment_id);
create index if not exists idx_tasks_business on public.tasks(business_id);
create index if not exists idx_seller_prices_business on public.seller_prices(business_id);
create index if not exists idx_seller_stock_business on public.seller_stock(business_id);
create index if not exists idx_profiles_business on public.profiles(business_id);

-- =============================================================================
-- 8. TRIGGER: PISO DE PREÇO (price floor) NAS VENDAS
-- =============================================================================
-- Regra: o preço unitário de uma venda NÃO pode ficar abaixo do piso vigente:
--   1) `seller_prices.floor` para (seller_id, product_id), se essa linha
--      existir E floor não for nulo;
--   2) senão, `products.price_floor`.
--   3) se nenhum dos dois estiver definido (ambos nulos), não há piso a
--      aplicar e a venda passa.
--
-- Quando a checagem é PULADA (é um ajuste, não uma venda nova):
--   * `parent_sale_id` preenchido -> é uma devolução/estorno vinculado a uma
--     venda original (ex.: gera stock_movements 'entrada_devolucao_venda').
--   * `quantity <= 0` -> lançamento de estorno/ajuste, não uma venda real.
--   * `unit_price <= 0` -> perda/descarte registrado como venda de valor
--     zero (equivalente ao stock_movements 'saida_desperdicio'), não faz
--     sentido validar piso de um preço zero/negativo.
-- Essas três condições cobrem "retorno/desperdício" citados no pedido.
--
-- IMPORTANT: a função é SECURITY DEFINER de propósito. O RLS de `products`
-- NÃO libera SELECT para vendedor (dados de custo são sensíveis — ver seção
-- 9). Se esta função rodasse como o vendedor (security invoker), a consulta
-- ao price_floor do produto retornaria NULL para o vendedor e a checagem
-- seria pulada silenciosamente — um furo de segurança. Rodando como definer
-- (dono da função = quem aplica a migração, tipicamente sem RLS restritiva)
-- ela sempre enxerga o piso real, não importa quem está inserindo a venda.

create or replace function public.enforce_sale_price_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_floor numeric;
begin
  if public.is_privileged_role() then
    return new; -- migrações/backfills/edge functions com service role não passam por esta trava
  end if;

  if new.parent_sale_id is not null or coalesce(new.quantity, 0) <= 0 or coalesce(new.unit_price, 0) <= 0 then
    return new;
  end if;

  if new.seller_id is not null then
    select sp.floor into v_floor
    from public.seller_prices sp
    where sp.seller_id = new.seller_id and sp.product_id = new.product_id;
  end if;

  if v_floor is null then
    select p.price_floor into v_floor
    from public.products p
    where p.id = new.product_id;
  end if;

  if v_floor is not null and new.unit_price < v_floor then
    -- RAISE não suporta especificadores de formato (%.2f); usar round() antes.
    raise exception
      'Preço unitário (%) abaixo do piso permitido (%) para este produto.',
      round(new.unit_price, 2), round(v_floor, 2)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sales_price_floor on public.sales;
create trigger trg_sales_price_floor
  before insert or update on public.sales
  for each row execute function public.enforce_sale_price_floor();

-- =============================================================================
-- 9. TRIGGER: TRAVA DE approval_status EM orders
-- =============================================================================
-- Vendedor pode criar/editar seus próprios pedidos, mas NUNCA pode mudar
-- approval_status para 'aprovado'/'rejeitado' (nem alterar um pedido já
-- decidido). Só admin decide aprovação. Implementado via trigger (não só
-- RLS) porque comparar OLD/NEW de uma mesma coluna é mais simples e mais
-- seguro em trigger do que em policy USING/WITH CHECK.

create or replace function public.enforce_order_approval_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_role() then
    return new; -- migrações/backfills/edge functions com service role não passam por esta trava
  end if;

  if tg_op = 'INSERT' then
    if not public.is_admin() and new.approval_status <> 'pendente_aprovacao' then
      raise exception 'Vendedor só pode criar pedidos com approval_status = pendente_aprovacao';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.approval_status is distinct from old.approval_status and not public.is_admin() then
    raise exception 'Somente admin pode alterar approval_status de um pedido';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_approval_lock on public.orders;
create trigger trg_orders_approval_lock
  before insert or update on public.orders
  for each row execute function public.enforce_order_approval_lock();

-- =============================================================================
-- 10. TRIGGER: PROTEÇÃO DE profiles (evita auto-promoção de vendedor a admin)
-- =============================================================================

create or replace function public.enforce_profile_privilege_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_role() then
    return new; -- migrações/bootstrap/edge functions com service role não passam por esta trava
  end if;

  if public.is_admin() then
    return new; -- admin pode alterar role/business_id/active dentro do seu negócio (RLS restringe o business)
  end if;

  if new.role is distinct from old.role
     or new.business_id is distinct from old.business_id
     or new.active is distinct from old.active then
    raise exception 'Vendedor não pode alterar role, business_id ou active do próprio perfil';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_privilege_guard on public.profiles;
create trigger trg_profiles_privilege_guard
  before update on public.profiles
  for each row execute function public.enforce_profile_privilege_guard();

-- =============================================================================
-- 11. VIEW: catálogo de produtos seguro para vendedor (sem custo/CMV)
-- =============================================================================
-- `products` (tabela base) só é SELECT-ável por admin (dados de custo são
-- sensíveis: avg_cost, labor_cost_per_unit, overhead_cost_per_unit,
-- loss_percent, target_margin_percent, tax_fee_percent). O vendedor usa esta
-- view, que expõe só as colunas necessárias para montar catálogo/venda.
--
-- `security_invoker = false` (padrão) é PROPOSITAL aqui: a view roda com o
-- privilégio do dono (quem aplica a migração), que no Supabase tem
-- BYPASSRLS, então o filtro de negócio é feito manualmente dentro da própria
-- view (business_id = my_business_id()) em vez de depender do RLS da tabela
-- base — que aliás bloquearia o vendedor por completo.

create or replace view public.seller_products
with (security_invoker = false)
as
select
  p.id,
  p.business_id,
  p.name,
  p.type,
  p.unit,
  p.current_stock,
  p.sale_price,
  p.default_price,
  p.price_floor,
  p.min_stock,
  p.notes,
  p.created_at,
  p.updated_at
from public.products p
where p.business_id = public.my_business_id();

grant select on public.seller_products to authenticated;

-- =============================================================================
-- 12. ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.products enable row level security;
alter table public.clients enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.stock_movements enable row level security;
alter table public.recipes enable row level security;
alter table public.productions enable row level security;
alter table public.sales enable row level security;
alter table public.orders enable row level security;
alter table public.consignments enable row level security;
alter table public.consignment_events enable row level security;
alter table public.tasks enable row level security;
alter table public.seller_prices enable row level security;
alter table public.seller_stock enable row level security;

-- ---------- profiles ---------------------------------------------------------
-- Qualquer usuário autenticado enxerga a PRÓPRIA linha (necessário para que
-- is_admin()/my_business_id() funcionem, e para a tela "Meu perfil").
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- Admin enxerga todos os perfis do seu negócio (para gerenciar vendedores).
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin() and business_id = public.my_business_id());

-- Atualização: usuário pode atualizar a própria linha (ex.: nome), mas o
-- trigger `enforce_profile_privilege_guard` bloqueia mudar role/business_id/
-- active se não for admin. Admin também pode atualizar vendedores do mesmo
-- negócio.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Não há policy de INSERT/DELETE para `authenticated`: criação de
-- vendedores é feita pela Edge Function `create-seller` com a service role
-- (que ignora RLS). O primeiro admin/negócio é provisionado manualmente pelo
-- orquestrador (ver docs/backend.md, seção "Gaps").

-- ---------- businesses --------------------------------------------------------
-- Ambos os papéis enxergam o próprio negócio.
drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses
  for select using (id = public.my_business_id());

-- Admin pode atualizar dados do próprio negócio (nome, margens padrão etc.).
drop policy if exists businesses_update_admin on public.businesses;
create policy businesses_update_admin on public.businesses
  for update using (public.is_admin() and id = public.my_business_id())
  with check (public.is_admin() and id = public.my_business_id());

-- Não há policy de INSERT/DELETE para `authenticated`: o primeiro negócio é
-- criado via service role no bootstrap do admin (fora do escopo desta
-- migração — ver docs/backend.md).

-- ---------- products -----------------------------------------------------------
-- Só admin lê/escreve a tabela base (tem avg_cost e outros dados de custo).
-- Vendedor usa a view `public.seller_products` (seção 11).
drop policy if exists products_all_admin on public.products;
create policy products_all_admin on public.products
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- ---------- clients -------------------------------------------------------------
drop policy if exists clients_all_admin on public.clients;
create policy clients_all_admin on public.clients
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Vendedor só enxerga/gerencia os PRÓPRIOS clientes (seller_id = auth.uid()).
-- Clientes com seller_id nulo (compartilhados/da casa) NÃO aparecem para o
-- vendedor nesta versão — assumção; revisar se o produto quiser "contas da
-- casa" visíveis a todos os vendedores.
drop policy if exists clients_select_seller on public.clients;
create policy clients_select_seller on public.clients
  for select using (seller_id = auth.uid());

drop policy if exists clients_insert_seller on public.clients;
create policy clients_insert_seller on public.clients
  for insert with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists clients_update_seller on public.clients;
create policy clients_update_seller on public.clients
  for update using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and business_id = public.my_business_id());

-- ---------- suppliers / purchases / stock_movements / recipes / productions / tasks
-- Dados sensíveis de custo/operação interna: só admin (nenhuma policy para
-- vendedor => RLS nega por padrão, PostgREST retorna conjunto vazio).
drop policy if exists suppliers_all_admin on public.suppliers;
create policy suppliers_all_admin on public.suppliers
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists purchases_all_admin on public.purchases;
create policy purchases_all_admin on public.purchases
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists stock_movements_all_admin on public.stock_movements;
create policy stock_movements_all_admin on public.stock_movements
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists recipes_all_admin on public.recipes;
create policy recipes_all_admin on public.recipes
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists productions_all_admin on public.productions;
create policy productions_all_admin on public.productions
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists tasks_all_admin on public.tasks;
create policy tasks_all_admin on public.tasks
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- ---------- sales -----------------------------------------------------------------
drop policy if exists sales_all_admin on public.sales;
create policy sales_all_admin on public.sales
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists sales_select_seller on public.sales;
create policy sales_select_seller on public.sales
  for select using (seller_id = auth.uid());

drop policy if exists sales_insert_seller on public.sales;
create policy sales_insert_seller on public.sales
  for insert with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists sales_update_seller on public.sales;
create policy sales_update_seller on public.sales
  for update using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and business_id = public.my_business_id());

-- ---------- orders ------------------------------------------------------------------
drop policy if exists orders_all_admin on public.orders;
create policy orders_all_admin on public.orders
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists orders_select_seller on public.orders;
create policy orders_select_seller on public.orders
  for select using (seller_id = auth.uid());

-- O trigger `enforce_order_approval_lock` garante que o vendedor só insira
-- com approval_status = 'pendente_aprovacao'; a policy garante o isolamento
-- por dono (seller_id) e por negócio.
drop policy if exists orders_insert_seller on public.orders;
create policy orders_insert_seller on public.orders
  for insert with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists orders_update_seller on public.orders;
create policy orders_update_seller on public.orders
  for update using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and business_id = public.my_business_id());

-- ---------- consignments -------------------------------------------------------------
drop policy if exists consignments_all_admin on public.consignments;
create policy consignments_all_admin on public.consignments
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists consignments_select_seller on public.consignments;
create policy consignments_select_seller on public.consignments
  for select using (seller_id = auth.uid());

drop policy if exists consignments_insert_seller on public.consignments;
create policy consignments_insert_seller on public.consignments
  for insert with check (seller_id = auth.uid() and business_id = public.my_business_id());

drop policy if exists consignments_update_seller on public.consignments;
create policy consignments_update_seller on public.consignments
  for update using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and business_id = public.my_business_id());

-- ---------- consignment_events ---------------------------------------------------------
-- Segue o dono da consignação-pai (não tem seller_id próprio): o vendedor só
-- lança/lê eventos (venda ao cliente, devolução, pagamento) de consignações
-- que são dele.
drop policy if exists consignment_events_all_admin on public.consignment_events;
create policy consignment_events_all_admin on public.consignment_events
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

drop policy if exists consignment_events_select_seller on public.consignment_events;
create policy consignment_events_select_seller on public.consignment_events
  for select using (
    exists (
      select 1 from public.consignments c
      where c.id = consignment_events.consignment_id and c.seller_id = auth.uid()
    )
  );

drop policy if exists consignment_events_insert_seller on public.consignment_events;
create policy consignment_events_insert_seller on public.consignment_events
  for insert with check (
    business_id = public.my_business_id()
    and exists (
      select 1 from public.consignments c
      where c.id = consignment_events.consignment_id and c.seller_id = auth.uid()
    )
  );

-- ---------- seller_prices -------------------------------------------------------------
drop policy if exists seller_prices_all_admin on public.seller_prices;
create policy seller_prices_all_admin on public.seller_prices
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Vendedor só LÊ a própria tabela de preços; quem define preço/piso por
-- vendedor é o admin.
drop policy if exists seller_prices_select_seller on public.seller_prices;
create policy seller_prices_select_seller on public.seller_prices
  for select using (seller_id = auth.uid());

-- ---------- seller_stock -------------------------------------------------------------
drop policy if exists seller_stock_all_admin on public.seller_stock;
create policy seller_stock_all_admin on public.seller_stock
  for all using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Vendedor só LÊ o próprio saldo de estoque; a transferência de estoque
-- central -> vendedor é feita pelo admin (mesmo espírito do consignado:
-- quem envia estoque controla o envio).
drop policy if exists seller_stock_select_seller on public.seller_stock;
create policy seller_stock_select_seller on public.seller_stock
  for select using (seller_id = auth.uid());

-- =============================================================================
-- Fim da migração 0001_init.sql
-- =============================================================================
