begin;

create or replace function public.tracking_sync_shipment_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'cancelled' then return new; end if;
  if new.delivered_at is null then
    new.status := 'in_transit';
  elsif new.paid_amount >= new.total_amount
    and (new.direction = 'inbound' or not exists (
      select 1 from public.tracking_shipment_items
      where shipment_id = new.id and quantity_sold + quantity_returned < quantity
    )) then
    new.status := 'closed';
  else
    new.status := 'delivered';
  end if;
  return new;
end;
$$;

create or replace function public.tracking_touch_shipment_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  update public.tracking_shipments set status = status where id = new.shipment_id;
  return new;
end;
$$;

drop trigger if exists trg_tracking_shipments_sync_status on public.tracking_shipments;
create trigger trg_tracking_shipments_sync_status before update on public.tracking_shipments
  for each row execute function public.tracking_sync_shipment_status();

drop trigger if exists trg_tracking_shipment_items_touch_status on public.tracking_shipment_items;
create trigger trg_tracking_shipment_items_touch_status
  after update of quantity_sold, quantity_returned on public.tracking_shipment_items
  for each row execute function public.tracking_touch_shipment_status();

revoke all on function public.tracking_sync_shipment_status() from public, anon, authenticated;
revoke all on function public.tracking_touch_shipment_status() from public, anon, authenticated;

commit;
