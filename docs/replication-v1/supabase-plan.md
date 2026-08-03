# Supabase — Plano Futuro de Schema

## Não aplicar automaticamente

Este documento descreve o desenho. Criar migration somente depois de revisão.

## Estado atual útil

Tabelas existentes relevantes:

- `businesses`
- `profiles`
- `products`
- `clients`
- `suppliers`
- `purchases`
- `recipes`
- `productions`
- `sales`
- `orders`
- `consignments`
- `consignment_events`
- `seller_stock`
- `seller_stock_adjustments`
- `seller_prices`
- `seller_settings`
- `stock_movements`
- `sale_carts`
- `sale_cart_items`
- `sales_goals`
- `sales_goals_progress`

Observações:

- `orders` já possui `approval_status`.
- `sale_carts` possui `source`, `payment_mode` e `status`.
- `sale_cart_items` já possui `approved_quantity`.
- `seller_stock` já representa estoque do vendedor.
- `consignments` já cobre parte do consignado com cliente.

## Gaps principais

Falta modelagem explícita para:

- débito do vendedor com administrador;
- pagamentos fracionados;
- devoluções com status logístico;
- desperdício;
- brinde;
- aprovação parcial com financeiro consistente.

## Novas tabelas sugeridas

### `seller_account_entries`

Conta corrente do vendedor com o admin.

Campos:

- `id`
- `business_id`
- `seller_id`
- `type`
- `amount`
- `direction`
- `source_type`
- `source_id`
- `notes`
- `created_by`
- `created_at`

### `seller_payments`

Pagamentos fracionados do vendedor.

Campos:

- `id`
- `business_id`
- `seller_id`
- `amount`
- `payment_date`
- `method`
- `proof_url`
- `notes`
- `received_by`
- `created_at`

### `operational_movements`

Para devolução, desperdício, brinde e ajustes especiais.

Campos:

- `id`
- `business_id`
- `type`
- `status`
- `product_id`
- `quantity_declared`
- `quantity_received`
- `seller_id`
- `client_id`
- `origin_type`
- `destination_type`
- `reason`
- `notes`
- `tracking_code`
- `carrier`
- `affects_stock`
- `affects_finance`
- `unit_value`
- `total_value`
- `created_by`
- `approved_by`
- `created_at`
- `sent_at`
- `received_at`
- `confirmed_at`

## Enums sugeridos

### movement type

- `return`
- `waste`
- `gift`
- `manual_adjustment`

### return status

- `a_devolver`
- `enviado`
- `recebido`
- `devolvido`
- `devolvido_parcialmente`
- `recusado`

### seller account entry type

- `debit_replenishment`
- `payment`
- `return_credit`
- `manual_adjustment`
- `writeoff`
- `bonus_credit`

## Regras RLS

Admin:

- pode ver tudo do business;
- pode aprovar e confirmar.

Vendedor:

- vê apenas próprios registros;
- pode criar solicitação;
- não confirma impacto final em estoque global;
- não aprova abatimento financeiro final.
