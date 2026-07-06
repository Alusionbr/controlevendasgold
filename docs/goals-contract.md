# Contrato de dados — Metas de vendas (goals)

Este documento descreve a tabela/view criadas em `supabase/migrations/0002_goals.sql`
para o recurso de metas semanais/mensais com premiação. Não edita e não substitui
`docs/backend.md` (schema geral, de responsabilidade do agente de backend).

## Tabela `sales_goals`

Uma meta atribuída a um vendedor específico, dentro de um negócio (`business_id`).

| coluna              | tipo        | observação                                              |
|---------------------|-------------|----------------------------------------------------------|
| `id`                | uuid        | PK                                                       |
| `business_id`       | uuid        | negócio dono da meta                                     |
| `seller_id`         | uuid        | vendedor (`profiles.id`) dono da meta                     |
| `period_type`       | text        | `'semana'` ou `'mes'`                                     |
| `period_start`      | date        | início do período                                         |
| `period_end`        | date        | fim do período (>= period_start)                          |
| `target_amount`     | numeric     | meta de receita, em R$ (> 0)                               |
| `reward_description`| text        | texto livre da premiação (ex.: "R$50 de bônus")            |
| `reward_value`      | numeric     | valor opcional da premiação, em R$                         |
| `achieved`          | boolean     | cache opcional, ver nota abaixo                            |
| `achieved_at`       | timestamptz | cache opcional, ver nota abaixo                            |
| `created_by`        | uuid        | quem criou (admin)                                         |
| `created_at`/`updated_at` | timestamptz | controle                                             |

`achieved`/`achieved_at` **não são atualizados automaticamente** por trigger a
cada venda nova (seria caro recalcular a cada insert em `sales`). A fonte de
verdade em tempo real é a view `sales_goals_progress` abaixo; se algum dia a
aplicação quiser "congelar" o resultado ao fechar um período, ela deve gravar
esses dois campos explicitamente usando os valores computados na view.

**Regras de acesso:**
- **Admin**: CRUD completo, restrito ao próprio `business_id`.
- **Vendedor**: apenas leitura (`SELECT`) das próprias metas (`seller_id = auth.uid()`).
  Não existe policy de insert/update/delete para vendedor — ele nunca edita
  metas ou o próprio progresso.

## View `sales_goals_progress`

Calcula o progresso de cada meta em tempo real, somando `sales.net_revenue`
dentro de `[period_start, period_end]` para o mesmo `business_id`/`seller_id`.
É `SECURITY INVOKER`, então a RLS de `sales_goals` e de `sales` continuam
valendo: um vendedor só vê o próprio progresso, um admin só vê o do seu negócio.

| coluna              | tipo    | descrição                                              |
|---------------------|---------|-----------------------------------------------------------|
| `goal_id`           | uuid    | id da meta (`sales_goals.id`)                              |
| `business_id`       | uuid    |                                                             |
| `seller_id`         | uuid    |                                                             |
| `period_type`       | text    | `'semana'` / `'mes'`                                        |
| `period_start`/`period_end` | date | período da meta                                        |
| `target_amount`     | numeric | meta em R$                                                  |
| `reward_description`| text    |                                                             |
| `reward_value`      | numeric |                                                             |
| `achieved_amount`   | numeric | soma de `sales.net_revenue` no período                      |
| `progress_pct`      | numeric | `achieved_amount / target_amount * 100`, arredondado a 1 casa (pode passar de 100) |
| `is_achieved`       | boolean | `achieved_amount >= target_amount`                          |

### Exemplo de consulta via PostgREST

```
GET /rest/v1/sales_goals_progress?seller_id=eq.<uid>&order=period_start.desc
Authorization: Bearer <jwt do usuário logado>
apikey: <anon/public key>
```

Um vendedor autenticado recebe automaticamente só as próprias linhas (RLS).
Um admin pode filtrar por vendedor específico com o mesmo `seller_id=eq.<uid>`
ou remover o filtro para ver todos os vendedores do seu negócio.

Para criar uma meta (admin):

```
POST /rest/v1/sales_goals
{
  "business_id": "...",
  "seller_id": "...",
  "period_type": "semana",
  "period_start": "2026-07-06",
  "period_end": "2026-07-13",
  "target_amount": 3000,
  "reward_description": "R$50 de bônus",
  "reward_value": 50
}
```

## ASSUNÇÃO IMPORTANTE — reconciliar com 0001

Esta migração assume que `sales` tem uma coluna `net_revenue numeric` (receita
líquida, equivalente ao campo `netRevenue` do estado local atual — ver
`src/calculations.js` e `docs/modelo-dados.md`) e uma coluna `date date` para o
período da venda. Se a migração `0001_init.sql` real usar outro nome (ex.:
`gross_revenue`, `receita_liquida`, ou só `created_at timestamptz` em vez de
`date`), é preciso ajustar a definição da view `sales_goals_progress` em
`0002_goals.sql` (dois pontos marcados no arquivo) antes de aplicar.

## Regras do lado cliente

- Admin cria/edita/exclui metas (`src/goals.js`, `renderAdmin`/`mountAdmin`).
- Vendedor só visualiza progresso (`renderSeller`/`mountSeller`), nunca edita.
- Nenhum recurso de IA é exposto ao usuário final nesta feature.
