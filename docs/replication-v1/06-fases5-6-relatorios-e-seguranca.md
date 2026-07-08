# 06 — Fases 5 e 6: relatórios e revisão Supabase

**Resumo:** depois que as fases 1–4 estiverem funcionando, a Fase 5 monta os relatórios que consomem os
dados novos, e a Fase 6 faz a revisão de segurança/performance do Supabase (RLS, índices, advisors). São
fases de consolidação — pouca ou nenhuma estrutura nova de dados.

---

## Fase 5 — Relatórios

Cobre `docs/05-implementation/01-phased-plan.md` (Fase 5) e o ticket `007-reports.md`. Cada relatório lê o
que as fases anteriores criaram; nenhuma tabela nova.

Relatórios a criar:
- **Saldo por vendedor** — a partir da view/RPC de saldo do ledger (Fase 3).
- **Pedidos em aberto** — carrinhos `pending_approval`/`partially_approved` e `orders` não concluídos.
- **Devoluções pendentes** — `operational_movements` com `type='return'` e status ainda não conferido
  (Fase 4).
- **Desperdício por período** — `operational_movements`/`stock_movements` `saida_desperdicio` agregados por
  data.
- **Brindes por responsável** — `operational_movements` `type='gift'` agrupados por `created_by`/vendedor.
- **Estoque em trânsito** — mercadoria enviada mas ainda não recebida (devoluções `enviado`, consignações
  admin→vendedor em aberto).

Onde encaixa: estender `renderReports` (aba `relatorios`, `LEGACY_RENDERERS` em `src/app.js:174`) ou um
módulo próprio. Cálculos de agregação vão para `src/calculations.js` (regra do `CLAUDE.md`). Reaproveitar a
exportação existente (`src/exportImport.js`) para CSV por relatório, se desejado.

Visibilidade: relatórios globais são **admin-only** (o vendedor não vê relatório do negócio; ele tem o
"Hoje" e "Meu saldo"). Reforçar via `TAB_ROLES`.

## Fase 6 — Revisão Supabase

Cobre `docs/05-implementation/01-phased-plan.md` (Fase 6) e o ticket `008-supabase-review.md`. Feita **após**
o funcional das fases 2–4, usando as ferramentas MCP do Supabase:

- **RLS:** revisar todas as policies das tabelas novas (`seller_account_entries`, `seller_payments`,
  `operational_movements`) — confirmar que vendedor só lê/insere o próprio e nunca dispara impacto
  financeiro/estoque global direto. Conferir com `get_advisors` (security).
- **Funções expostas:** revisar as RPCs novas (`admin_register_seller_payment`,
  `confirm_operational_movement`, etc.) — `SECURITY DEFINER` + `set search_path = public`, `revoke ... from
  public/anon`, `grant execute ... to authenticated`, curto-circuito por `is_privileged_role()` nos
  triggers.
- **Índices:** garantir índices por `(business_id, seller_id, created_at desc)` no ledger e por
  `(business_id, type, status, created_at desc)` em `operational_movements` (já sugeridos no draft).
- **Performance/advisors:** rodar `get_advisors` (performance) e `get_logs` para caçar policies faltando
  índice, N+1 no refresh, etc.

## Ordem de aplicação das migrations (quando chegar a hora)
As migrations reais devem ser aplicadas **em ordem** e só após revisão humana, cada uma como um arquivo
numerado (`0010_...`, `0011_...`), **nunca** aplicando o draft diretamente:
1. `0010` — `sale_carts.paid_initial_amount` (Fase 2).
2. `0011` — ledger (`seller_account_entries`, `seller_payments`, RLS, RPCs, view de saldo) (Fase 3).
3. `0012` — `operational_movements` + `saida_brinde` + RLS + RPC de confirmação (Fase 4).

O draft consolidado em `supabase/migrations/drafts/` serve de **referência de conteúdo**; ao implementar,
quebrar por fase, revisar e renumerar.

## Critérios de aceite
- Relatórios batem com os dados das fases 2–4 e respeitam perfil (globais = admin-only).
- `get_advisors` sem alertas de segurança nas tabelas novas.
- Migrations aplicadas em ordem, numeradas, revisadas — nunca o draft cru.
