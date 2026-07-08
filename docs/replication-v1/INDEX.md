# Replication v1 — Análise e sequenciamento de implementação

Esta pasta é a **tradução do pacote `controle360_replication_implementation_pack_v1`** para a realidade
atual do código do Controle360. O pacote foi escrito de forma genérica (para "outra IA" replicar o
projeto); estes documentos corrigem as premissas que já estão desatualizadas e transformam as 6 fases em
tickets concretos, apontando os arquivos e tabelas reais.

> **Importante:** este ciclo é **só de análise/planejamento**. Nenhum arquivo de funcionalidade
> (`src/*.js`, `index.html`, `styles/main.css`) foi alterado e **nenhuma migration foi aplicada**. O único
> SQL aqui é um **rascunho** em `supabase/migrations/drafts/` para revisão humana.

## Ordem de leitura

1. [`00-situacao-atual-e-gaps.md`](00-situacao-atual-e-gaps.md) — o que **já existe** vs. o que falta, por domínio.
2. [`01-decisoes-de-produto.md`](01-decisoes-de-produto.md) — as três decisões que guiam tudo.
3. [`02-fase1-navegacao-mobile.md`](02-fase1-navegacao-mobile.md) — Fase 1: navegação mobile por perfil (sem banco).
4. [`03-fase2-reposicao-carrinhos.md`](03-fase2-reposicao-carrinhos.md) — Fase 2: reposição padronizada em carrinhos.
5. [`04-fase3-ledger-vendedor.md`](04-fase3-ledger-vendedor.md) — Fase 3: conta corrente do vendedor (ledger).
6. [`05-fase4-devolucoes-desperdicio-brinde.md`](05-fase4-devolucoes-desperdicio-brinde.md) — Fase 4: devoluções com status, desperdício e brinde.
7. [`06-fases5-6-relatorios-e-seguranca.md`](06-fases5-6-relatorios-e-seguranca.md) — Fases 5 e 6: relatórios e revisão Supabase.

## Sequência recomendada de execução

Bate com `project-templates/AI_IMPLEMENTATION_ORDER.md` do pacote:

| # | Fase | Toca banco? | Reversível fácil? | Status |
|---|------|-------------|-------------------|--------|
| 1 | Navegação mobile por perfil | Não | Sim | Planejado |
| 2 | Reposição em carrinhos (`parcial` real) | Sim (1 coluna) | Sim | Planejado |
| 3 | Ledger do vendedor + pagamentos fracionados | Sim (2 tabelas + RPC) | Médio | Planejado |
| 4 | Devoluções com status, desperdício, brinde | Sim (1 tabela + RLS) | Médio | Planejado |
| 5 | Relatórios | Não (lê o que as fases criaram) | Sim | Planejado |
| 6 | Revisão Supabase (RLS/índices/advisors) | Revisão | — | Planejado |

## Princípio que não muda

Do `CLAUDE.md` e do próprio pacote: **não reescrever o sistema — camada incremental sobre o que existe.**
Cálculo mora em `src/calculations.js`, dados em `src/state.js`, e estoque nunca muda sem registro de
movimentação.
