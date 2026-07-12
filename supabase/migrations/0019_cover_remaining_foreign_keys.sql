-- Controle360 - indices restantes para chaves estrangeiras.

create index if not exists idx_businesses_owner_id on public.businesses (owner_id);
create index if not exists idx_consignment_events_business_id on public.consignment_events (business_id);
create index if not exists idx_consignments_client_id on public.consignments (client_id);
create index if not exists idx_consignments_product_id on public.consignments (product_id);
create index if not exists idx_operational_movements_seller_id on public.operational_movements (seller_id);
create index if not exists idx_orders_client_id on public.orders (client_id);
create index if not exists idx_orders_converted_sale_id on public.orders (converted_sale_id);
create index if not exists idx_orders_product_id on public.orders (product_id);
create index if not exists idx_productions_final_product_id on public.productions (final_product_id);
create index if not exists idx_purchases_product_id on public.purchases (product_id);
create index if not exists idx_purchases_supplier_id on public.purchases (supplier_id);
create index if not exists idx_recipes_final_product_id on public.recipes (final_product_id);
create index if not exists idx_recipes_input_product_id on public.recipes (input_product_id);
create index if not exists idx_sales_client_id on public.sales (client_id);
create index if not exists idx_sales_parent_sale_id on public.sales (parent_sale_id);
create index if not exists idx_sales_product_id on public.sales (product_id);
create index if not exists idx_seller_account_entries_seller_id on public.seller_account_entries (seller_id);
create index if not exists idx_seller_payments_seller_id on public.seller_payments (seller_id);
create index if not exists idx_seller_prices_product_id on public.seller_prices (product_id);
create index if not exists idx_seller_stock_product_id on public.seller_stock (product_id);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
