# Modelo de dados

> Este documento descreve o *shape* local (camelCase) usado por `src/app.js`.
> Desde a integração multiusuário, os dados vêm do Supabase (Postgres + RLS)
> via `src/api.js`/`src/state.js` — ver `docs/backend.md` para o contrato
> completo de tabelas/colunas em snake_case e regras de acesso por papel
> (admin/vendedor). O `localStorage` agora é só um espelho de cache, não a
> fonte de verdade. Coleções novas trazidas pelo backend: `sellerPrices`,
> `sellerStock`, `salesGoals`, `goalsProgress`, `profile`/`profiles`/`sellers`
> (ver `docs/goals-contract.md` para `salesGoals`/`goalsProgress`).

## Estado raiz

```js
{
  meta,
  activeBusinessId,
  settings,
  businesses,
  products,
  clients,
  suppliers,
  purchases,
  stockMovements,
  recipes,
  productions,
  sales,
  orders,
  consignments,
  consignmentEvents,
  tasks
}
```

## businesses

```js
{
  id,
  name,
  segment,
  defaultTargetMargin,
  defaultFeePercent,
  notes,
  createdAt,
  updatedAt
}
```

## products

```js
{
  id,
  businessId,
  name,
  type,
  unit,
  currentStock,
  avgCost,
  salePrice,
  minStock,
  laborCostPerUnit,
  overheadCostPerUnit,
  lossPercent,
  targetMarginPercent,
  taxFeePercent,
  notes,
  createdAt,
  updatedAt
}
```

## recipes

```js
{
  id,
  businessId,
  finalProductId,
  inputProductId,
  quantityPerUnit,
  createdAt,
  updatedAt
}
```

## purchases

```js
{
  id,
  businessId,
  date,
  supplierId,
  productId,
  quantity,
  totalCost,
  unitCost,
  notes,
  createdAt,
  updatedAt
}
```

## stockMovements

```js
{
  id,
  businessId,
  date,
  type,
  productId,
  quantity,
  unitCost,
  totalCost,
  notes,
  createdAt
}
```

Quantidade positiva = entrada.

Quantidade negativa = saída.

## productions

```js
{
  id,
  businessId,
  date,
  finalProductId,
  quantity,
  totalCost,
  unitCost,
  notes,
  createdAt,
  updatedAt
}
```

## sales

```js
{
  id,
  businessId,
  date,
  channel,
  clientId,
  productId,
  quantity,
  unitPrice,
  discount,
  fixedFees,
  feePercent,
  unitCost,
  grossRevenue,
  percentFees,
  netRevenue,
  cogs,
  grossProfit,
  margin,
  notes,
  origin,
  originId,
  sellerId,       // NOVO: dono da venda (vendedor) — RLS filtra por isso
  parentSaleId,   // NOVO: preenchido = é devolução/estorno de outra venda (ver src/returns.js)
  createdAt,
  updatedAt
}
```

## orders

```js
{
  id,
  businessId,
  clientId,
  productId,
  quantity,
  unitPrice,
  dueDate,
  status,          // logística: pendente|em_preparo|pronto|despachado|concluido
  notes,
  convertedSaleId,
  sellerId,        // NOVO: dono do pedido (vendedor)
  approvalStatus,  // NOVO: pendente_aprovacao|aprovado|rejeitado (aba Aprovações, admin)
  createdAt,
  updatedAt
}
```

## consignments

```js
{
  id,
  businessId,
  date,
  clientId,
  productId,
  quantitySent,
  quantitySold,
  quantityReturned,
  amountPaid,
  unitPrice,
  costAtSend,
  notes,
  status,
  createdAt,
  updatedAt
}
```

## consignmentEvents

```js
{
  id,
  businessId,
  consignmentId,
  type,
  date,
  quantity,
  amount,
  createdAt,
  updatedAt
}
```

## tasks

```js
{
  id,
  businessId,
  title,
  dueDate,
  status,
  notes,
  createdAt,
  updatedAt
}
```

## Formatos de backup

- **Excel (.xlsx)**: cada coleção vira uma aba com cabeçalhos em português. A aba `Backup_NAO_EDITAR` guarda `settings`, `meta` e `activeBusinessId` em JSON, para restauração fiel. As abas de dados são a fonte de verdade dos registros na reimportação.
- **JSON**: serialização direta de todo o estado (`controle360_multi_v2`).
- **CSV**: por módulo, do negócio ativo.

Regras na importação de Excel: colunas são mapeadas pelo rótulo (ou pela chave técnica) de volta ao campo original; campos numéricos voltam como número; datas digitadas como data no Excel são convertidas para `YYYY-MM-DD`; registros sem `id` recebem um novo id.
