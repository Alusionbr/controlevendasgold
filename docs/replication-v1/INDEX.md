# Replication v1 — Análise e sequenciamento de implementação

Esta pasta é a **tradução do pacote `controle360_replication_implementation_pack_v1`** para a realidade
atual do código do Controle360. O pacote foi escrito de forma genérica (para "outra IA" replicar o
projeto); estes documentos corrigem as premissas que já estão desatualizadas e transformam as 6 fases em
tickets concretos, apontando os arquivos e tabelas reais.

> **Atualização (9 de julho):** Este ciclo começou como **análise/planejamento**, mas evoluiu para
> **implementação completa de todas as 6 fases**. A prioridade do usuário foi funcionalidades e UX
> em vez de documentação inicial — todas as mudanças foram commitadas, testadas e deployadas para
> produção via GitHub Pages. Os documentos abaixo refletem a análise original; a implementação real
> está nos commits listados no quadro abaixo.

## Ordem de leitura

1. [`00-situacao-atual-e-gaps.md`](00-situacao-atual-e-gaps.md) — o que **já existe** vs. o que falta, por domínio.
2. [`01-decisoes-de-produto.md`](01-decisoes-de-produto.md) — as três decisões que guiam tudo.
3. [`02-fase1-navegacao-mobile.md`](02-fase1-navegacao-mobile.md) — Fase 1: navegação mobile por perfil (sem banco).
4. [`03-fase2-reposicao-carrinhos.md`](03-fase2-reposicao-carrinhos.md) — Fase 2: reposição padronizada em carrinhos.
5. [`04-fase3-ledger-vendedor.md`](04-fase3-ledger-vendedor.md) — Fase 3: conta corrente do vendedor (ledger).
6. [`05-fase4-devolucoes-desperdicio-brinde.md`](05-fase4-devolucoes-desperdicio-brinde.md) — Fase 4: devoluções com status, desperdício e brinde.
7. [`06-fases5-6-relatorios-e-seguranca.md`](06-fases5-6-relatorios-e-seguranca.md) — Fases 5 e 6: relatórios e revisão Supabase.

## Sequência de implementação (concluída)

Bate com `project-templates/AI_IMPLEMENTATION_ORDER.md` do pacote:

| # | Fase | Toca banco? | Reversível fácil? | Status | Implementação |
|---|------|-------------|-------------------|--------|---|
| 1 | Navegação mobile por perfil | Não | Sim | ✅ **Implementado** | [7dc16c0](https://github.com/Alusionbr/controlevendasgold/commit/7dc16c0), [d7670ae](https://github.com/Alusionbr/controlevendasgold/commit/d7670ae), [c7c93f1](https://github.com/Alusionbr/controlevendasgold/commit/c7c93f1) |
| 2 | Reposição em carrinhos (`parcial` real) | Sim (1 coluna) | Sim | ✅ **Implementado** | [bb37a65](https://github.com/Alusionbr/controlevendasgold/commit/bb37a65), [d79e478](https://github.com/Alusionbr/controlevendasgold/commit/d79e478) |
| 3 | Ledger do vendedor + pagamentos fracionados | Sim (2 tabelas + RPC) | Médio | ✅ **Implementado** | [022672c](https://github.com/Alusionbr/controlevendasgold/commit/022672c), [5832b1a](https://github.com/Alusionbr/controlevendasgold/commit/5832b1a) |
| 4 | Devoluções com status, desperdício, brinde | Sim (1 tabela + RLS) | Médio | ✅ **Implementado** | Migrations `0011-0012` |
| 5 | Relatórios | Não (lê o que as fases criaram) | Sim | ✅ **Implementado** | `renderReplicationReports()` em `src/app.js` |
| 6 | Revisão Supabase (RLS/índices/advisors) | Revisão | — | ✅ **Implementado** | Migrations `0010-0013`, `mcp__Supabase__get_advisors` |

## Princípio que não muda

Do `CLAUDE.md` e do próprio pacote: **não reescrever o sistema — camada incremental sobre o que existe.**
Cálculo mora em `src/calculations.js`, dados em `src/state.js`, e estoque nunca muda sem registro de
movimentação.
