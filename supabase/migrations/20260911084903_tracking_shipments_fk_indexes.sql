-- Índices sugeridos pelo advisor após a implantação do rastreio de remessas.
create index if not exists idx_tracking_shipments_created_by
  on public.tracking_shipments (created_by);
create index if not exists idx_tracking_shipment_items_business
  on public.tracking_shipment_items (business_id);
create index if not exists idx_tracking_shipment_events_created_by
  on public.tracking_shipment_events (created_by);
create index if not exists idx_tracking_shipment_payments_created_by
  on public.tracking_shipment_payments (created_by);
