-- ============================================================================
-- 0002_goals.sql
-- Metas de vendas (semanais/mensais) com premiação para vendedores.
--
-- ADITIVO: esta migração não altera nada criado em 0001_init.sql. Ela é escrita
-- em paralelo por um agente diferente do agente que autora 0001_init.sql, então
-- ela ASSUME o formato abaixo para as tabelas já existentes. Se o schema real
-- de 0001 divergir, ajuste apenas os pontos marcados com "ASSUNÇÃO" abaixo
-- antes de aplicar esta migração.
--
-- ASSUNÇÕES sobre o schema criado em 0001_init.sql:
--   1) public.profiles(id uuid primary key, role text check in ('admin','vendedor'),
--      name text, business_id uuid, active boolean, ...)
--   2) function public.is_admin() returns boolean
--      -> true quando o usuário autenticado (auth.uid()) é admin do negócio.
--   3) function public.my_business_id() returns uuid
--      -> retorna o business_id do usuário autenticado.
--   4) public.sales(id uuid, business_id uuid, seller_id uuid references profiles(id),
--      ..., date date, created_at timestamptz, ...)
--      -> ASSUNÇÃO MAIS IMPORTANTE: a coluna de receita da venda se chama
--         "net_revenue numeric" (equivalente ao campo `netRevenue` usado hoje
--         no estado local em src/calculations.js e docs/modelo-dados.md, que
--         é a "receita líquida" já descontando taxas/desconto). Caso a coluna
--         real em 0001 tenha outro nome (ex.: "receita_liquida" ou
--         "grossRevenue"/"gross_revenue" para receita BRUTA), troque apenas as
--         referências a "s.net_revenue" dentro da view sales_goals_progress
--         (uma única ocorrência, marcada abaixo) para o nome correto.
--      -> ASSUNÇÃO: existe uma coluna "date date" em sales usada para o
--         período da venda (compatível com o campo `date` do modelo local).
--         Se 0001 só tiver "created_at timestamptz", troque o filtro de
--         período na view para "s.created_at::date" (ponto também marcado
--         abaixo).
--
-- Se alguma dessas funções/tabelas ainda não existir quando esta migração for
-- aplicada, o CREATE TABLE/VIEW abaixo falhará "ruidosamente" (erro de FK ou
-- função inexistente) em vez de silenciosamente aplicar regras erradas — é o
-- comportamento desejado para forçar a reconciliação manual pelo orquestrador.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabela: sales_goals
-- ----------------------------------------------------------------------------
create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  seller_id uuid not null references public.profiles(id),
  period_type text not null check (period_type in ('semana', 'mes')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  target_amount numeric not null check (target_amount > 0),
  reward_description text,
  reward_value numeric,
  -- achieved/achieved_at funcionam como um "cache" opcional do resultado.
  -- A fonte de verdade em tempo real é a view sales_goals_progress (calculada
  -- a partir de public.sales). Estas duas colunas existem para permitir que a
  -- aplicação (ou um job/edge function futuro) grave o resultado final quando
  -- o período fechar, sem depender de recalcular a view para períodos antigos.
  -- Esta migração NÃO cria um trigger para preenchê-las automaticamente a
  -- cada venda nova (ficaria caro recalcular a cada insert em sales); a
  -- aplicação deve gravar achieved/achieved_at explicitamente (ex.: ao fechar
  -- o período) usando os valores computados por sales_goals_progress.
  achieved boolean not null default false,
  achieved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_goals is
  'Metas de vendas semanais/mensais por vendedor, com premiação associada. Ver sales_goals_progress para o progresso calculado em tempo real.';
comment on column public.sales_goals.achieved is
  'Cache opcional do resultado final do período; a verdade em tempo real está em sales_goals_progress.is_achieved.';

create index if not exists idx_sales_goals_business on public.sales_goals (business_id);
create index if not exists idx_sales_goals_seller on public.sales_goals (seller_id);
create index if not exists idx_sales_goals_period on public.sales_goals (business_id, seller_id, period_start, period_end);

-- ----------------------------------------------------------------------------
-- updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.sales_goals_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sales_goals_updated_at on public.sales_goals;
create trigger trg_sales_goals_updated_at
  before update on public.sales_goals
  for each row
  execute function public.sales_goals_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: sales_goals
-- ----------------------------------------------------------------------------
alter table public.sales_goals enable row level security;

-- Admin: CRUD completo, restrito ao próprio negócio.
drop policy if exists sales_goals_admin_all on public.sales_goals;
create policy sales_goals_admin_all
  on public.sales_goals
  for all
  using (public.is_admin() and business_id = public.my_business_id())
  with check (public.is_admin() and business_id = public.my_business_id());

-- Vendedor: apenas leitura das próprias metas. Sem insert/update/delete —
-- vendedor nunca pode editar metas ou o próprio progresso.
drop policy if exists sales_goals_seller_select on public.sales_goals;
create policy sales_goals_seller_select
  on public.sales_goals
  for select
  using (seller_id = auth.uid());

grant select, insert, update, delete on public.sales_goals to authenticated;

-- ----------------------------------------------------------------------------
-- View: sales_goals_progress
-- Progresso calculado em tempo real a partir de public.sales.
-- SECURITY INVOKER: a view roda com os privilégios/RLS de quem consulta, então
-- a RLS de sales_goals (acima) e de sales (definida em 0001) continuam valendo
-- normalmente — um vendedor só enxerga o próprio progresso, um admin enxerga
-- o do seu negócio.
-- ----------------------------------------------------------------------------
create or replace view public.sales_goals_progress
with (security_invoker = true) as
select
  g.id as goal_id,
  g.business_id,
  g.seller_id,
  g.period_type,
  g.period_start,
  g.period_end,
  g.target_amount,
  g.reward_description,
  g.reward_value,
  coalesce(sum(s.net_revenue), 0) as achieved_amount, -- ASSUNÇÃO: coluna sales.net_revenue (ver cabeçalho)
  case
    when g.target_amount > 0
      then round((coalesce(sum(s.net_revenue), 0) / g.target_amount) * 100, 1)
    else 0
  end as progress_pct,
  coalesce(sum(s.net_revenue), 0) >= g.target_amount as is_achieved
from public.sales_goals g
left join public.sales s
  on s.business_id = g.business_id
 and s.seller_id = g.seller_id
 and s.date >= g.period_start   -- ASSUNÇÃO: coluna sales.date (ver cabeçalho); trocar por s.created_at::date se necessário
 and s.date <= g.period_end
group by
  g.id, g.business_id, g.seller_id, g.period_type, g.period_start, g.period_end,
  g.target_amount, g.reward_description, g.reward_value;

comment on view public.sales_goals_progress is
  'Progresso em tempo real de cada meta (sales_goals), somando public.sales.net_revenue dentro do período. security_invoker=true preserva a RLS das tabelas base.';

grant select on public.sales_goals_progress to authenticated;
