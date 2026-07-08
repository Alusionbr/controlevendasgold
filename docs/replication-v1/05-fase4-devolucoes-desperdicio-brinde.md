# 05 — Fase 4: devoluções com status, desperdício e brinde

**Resumo:** criar movimentações operacionais de primeira classe para **devolução com status logístico**,
**desperdício** e **brinde**. Regra central: só a devolução **conferida/recebida** impacta estoque e
financeiro — "a devolver" não mexe em nada. Toca o banco (1 tabela + tipos/status + RLS) e evolui o
`src/returns.js` atual.

---

## Objetivo
Cobrir `docs/02-domain-logic/05-returns-waste-gifts.md` do pacote. Hoje `src/returns.js` só faz devolução
**imediata** (venda negativa) e desperdício (só estoque); não há status logístico nem brinde.

## Modelo de dados — `operational_movements`
Campos (do pacote, ajustados): `id`, `business_id`, `type`, `status`, `product_id`, `quantity_declared (>0)`,
`quantity_received`, `seller_id`, `client_id`, `origin_type`, `destination_type`, `reason (not null)`,
`notes`, `tracking_code`, `carrier`, `affects_stock`, `affects_finance`, `unit_value`, `total_value`,
`created_by`, `approved_by`, `created_at`, `sent_at`, `received_at`, `confirmed_at`.

Enums:
- `type`: `return` | `waste` | `gift` | `manual_adjustment`.
- **status de devolução**: `a_devolver` | `enviado` | `recebido` | `devolvido` | `devolvido_parcialmente` |
  `recusado`. Para `waste`/`gift`, um status mais simples (`pending` → `confirmed`).

## Regra central (não violar)
```txt
a_devolver / enviado  ->  NÃO mexe em estoque, NÃO abate dívida
recebido / devolvido  ->  aí sim: volta ao estoque (se reaproveitável) e/ou gera return_credit no ledger
recusado              ->  nada muda
```
Ou seja, `affects_stock`/`affects_finance` só disparam na **conferência** (`confirmed_at`), não na criação.

## Como se liga ao que existe
- **Devolução imediata atual** (`src/returns.js` `recordDevolucao`): continua válida para o caso "cliente
  devolveu na hora e já resolvi" (venda negativa + `entrada_devolucao_venda`). O fluxo **com status** é para
  os casos logísticos (vendedor→admin, consignado voltando, reposição parcialmente retornada), em que o item
  ainda está em trânsito.
- **Desperdício:** hoje é só `saida_desperdicio` em `stock_movements`. Passa a ter registro próprio em
  `operational_movements` (com responsável e motivo), **e** a baixa de estoque continua gerando o movimento
  `saida_desperdicio` (rastro em `stock_movements` — regra do `CLAUDE.md`).
- **Brinde (novo):** saída sem receita, com responsável/autorização. Baixa estoque (movimento novo sugerido
  `saida_brinde` em `stock_movements` — exige estender a constraint de `type`) e **não** gera receita. Pode
  ou não impactar financeiro do vendedor (`affects_finance`).
- **Crédito no ledger:** quando `type='return'` é **conferido** e a devolução era de mercadoria consignada
  admin→vendedor, gera `return_credit` no ledger (Fase 3).

## Gap de RLS a resolver (importante)
Documentado em `src/state.js:334-341`: vendedor não pode inserir `stock_movements` livremente — só há policy
para `entrada_devolucao_venda`/`saida_desperdicio` amarrada à venda do próprio vendedor (migration `0003`).
Para os fluxos novos (devolução em trânsito, brinde), o vendedor **cria** o `operational_movement` (status
`a_devolver`/`pending`), mas quem **confere** e dispara o impacto em estoque/financeiro é o **admin** (ou uma
RPC `SECURITY DEFINER`). Assim o vendedor nunca escreve direto em `stock_movements`/estoque global.

## RLS (seguir padrões existentes)
- `operational_movements`: RLS on.
- **Admin:** `_all_admin`.
- **Vendedor:** `for select using (seller_id = auth.uid())`; `for insert with check (seller_id = auth.uid()
  and status in ('a_devolver','pending'))` — só cria solicitação, nunca confere.
- **Confirmação/impacto:** RPC `SECURITY DEFINER` `confirm_operational_movement(id, quantity_received, ...)`
  chamada pelo admin, que grava `stock_movements`, ajusta estoque e (se aplicável) lança no ledger — tudo
  numa transação.

## Telas
- **Admin:** Devoluções (fila por status), Desperdícios, Brindes — cada uma lista + ação de conferir.
- **Vendedor:** Minhas devoluções (status), Brindes, "Informar desperdício".

## Arquivos afetados (quando implementada)
- Migration nova (draft): `operational_movements` + enums + RLS + RPC de confirmação; estender constraint de
  `stock_movements.type` com `saida_brinde`.
- `src/returns.js` — evoluir para suportar o fluxo com status (ou novo `src/operationalMovements.js`).
- `src/state.js` — cachear `operationalMovements`; refresh.
- `src/calculations.js` — helpers de agregação (desperdício por período etc.).
- `docs/backend.md`, `docs/modelo-dados.md`, `CLAUDE.md`.

## Critérios de aceite
- Devolução "a devolver" não altera estoque nem dívida; só a conferência altera.
- Desperdício e brinde baixam estoque com registro em `stock_movements` e responsável.
- Vendedor cria solicitação; admin confere; impacto acontece na conferência.
- Devolução conferida de consignado admin→vendedor gera `return_credit` no ledger.
