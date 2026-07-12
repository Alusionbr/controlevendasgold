-- Controle360 - invariantes financeiras e de estoque no banco.
-- Todos os dados existentes foram auditados antes da aplicacao.

-- Permite reaplicacao segura em ambientes onde o hardening foi validado antes
-- de a migration entrar no historico oficial.
alter table public.products
  drop constraint if exists products_current_stock_nonnegative,
  drop constraint if exists products_avg_cost_nonnegative;
alter table public.seller_stock
  drop constraint if exists seller_stock_quantity_nonnegative;
alter table public.purchases
  drop constraint if exists purchases_quantity_positive,
  drop constraint if exists purchases_total_cost_positive,
  drop constraint if exists purchases_unit_cost_positive;
alter table public.productions
  drop constraint if exists productions_quantity_positive,
  drop constraint if exists productions_total_cost_nonnegative,
  drop constraint if exists productions_unit_cost_nonnegative;
alter table public.orders
  drop constraint if exists orders_quantity_positive,
  drop constraint if exists orders_unit_price_positive;
alter table public.consignments
  drop constraint if exists consignments_quantity_sent_positive,
  drop constraint if exists consignments_quantity_sold_nonnegative,
  drop constraint if exists consignments_quantity_returned_nonnegative,
  drop constraint if exists consignments_quantity_balance_valid,
  drop constraint if exists consignments_amount_paid_nonnegative,
  drop constraint if exists consignments_unit_price_positive,
  drop constraint if exists consignments_cost_at_send_nonnegative;
alter table public.sale_cart_items
  drop constraint if exists sale_cart_items_approved_quantity_valid;
alter table public.seller_prices
  drop constraint if exists seller_prices_price_positive,
  drop constraint if exists seller_prices_floor_nonnegative;

alter table public.products
  add constraint products_current_stock_nonnegative check (current_stock >= 0),
  add constraint products_avg_cost_nonnegative check (avg_cost >= 0);

alter table public.seller_stock
  add constraint seller_stock_quantity_nonnegative check (quantity >= 0);

alter table public.purchases
  add constraint purchases_quantity_positive check (quantity > 0),
  add constraint purchases_total_cost_positive check (total_cost > 0),
  add constraint purchases_unit_cost_positive check (unit_cost > 0);

alter table public.productions
  add constraint productions_quantity_positive check (quantity > 0),
  add constraint productions_total_cost_nonnegative check (total_cost >= 0),
  add constraint productions_unit_cost_nonnegative check (unit_cost >= 0);

alter table public.orders
  add constraint orders_quantity_positive check (quantity > 0),
  add constraint orders_unit_price_positive check (unit_price > 0);

alter table public.consignments
  add constraint consignments_quantity_sent_positive check (quantity_sent > 0),
  add constraint consignments_quantity_sold_nonnegative check (quantity_sold >= 0),
  add constraint consignments_quantity_returned_nonnegative check (quantity_returned >= 0),
  add constraint consignments_quantity_balance_valid check (quantity_sold + quantity_returned <= quantity_sent),
  add constraint consignments_amount_paid_nonnegative check (amount_paid >= 0),
  add constraint consignments_unit_price_positive check (unit_price > 0),
  add constraint consignments_cost_at_send_nonnegative check (cost_at_send >= 0);

alter table public.sale_cart_items
  add constraint sale_cart_items_approved_quantity_valid
    check (approved_quantity is null or (approved_quantity >= 0 and approved_quantity <= quantity));

alter table public.seller_prices
  add constraint seller_prices_price_positive check (price > 0),
  add constraint seller_prices_floor_nonnegative check (floor is null or floor >= 0);
