'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260911083605_tracking_shipments.sql');

test('remessas possuem origem, destino, linha do tempo e políticas RLS', () => {
  for (const required of [
    'create table if not exists public.tracking_shipments',
    'create table if not exists public.tracking_shipment_items',
    'source_item_id uuid references public.tracking_shipment_items',
    'create table if not exists public.tracking_shipment_events',
    'create table if not exists public.tracking_shipment_payments',
    'alter table public.tracking_shipments enable row level security',
    'create policy tracking_shipments_select',
    's.seller_id = (select auth.uid())',
  ]) assert.ok(migration.includes(required), `contrato ausente: ${required}`);
});

test('operações críticas de remessa são atômicas, idempotentes e restritas ao admin', () => {
  for (const name of [
    'create_tracking_shipment',
    'confirm_tracking_shipment_delivery',
    'register_tracking_shipment_sale',
    'register_tracking_shipment_return',
    'register_tracking_shipment_payment',
  ]) {
    assert.match(migration, new RegExp(`function public\\.${name}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}`));
  }
  assert.match(migration, /unique \(business_id, request_id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /insert into public\.stock_movements/);
  assert.match(migration, /source_type, source_id/);
  assert.match(migration, /current_stock \* coalesce\(avg_cost, 0\)/);
  assert.match(migration, /p_partner_type = 'seller' and p_delivered_at is not null/);
  assert.match(migration, /function public\.tracking_sync_shipment_status/);
  assert.match(migration, /new\.direction = 'inbound'/);
});

test('interface expõe rastreio ao vendedor sem permitir lançamentos', () => {
  const source = read('src/tracking.js');
  assert.match(source, /isAdmin\(\) \? renderCreateForm\(\) : ''/);
  assert.match(source, /if \(!isAdmin\(\).*return ''/);
  assert.match(source, /createTrackingShipment/);
  assert.match(source, /registerTrackingShipmentPayment/);
});

test('estado e API carregam e gravam as remessas pelos contratos dedicados', () => {
  const state = read('src/state.js');
  const api = read('src/api.js');
  for (const collection of ['trackingShipments', 'trackingShipmentItems', 'trackingShipmentEvents', 'trackingShipmentPayments']) {
    assert.ok(state.includes(`${collection}: []`), `cache ausente: ${collection}`);
  }
  for (const method of ['createTrackingShipment', 'confirmTrackingShipmentDelivery', 'registerTrackingShipmentSale', 'registerTrackingShipmentReturn', 'registerTrackingShipmentPayment']) {
    assert.ok(api.includes(`async function ${method}`), `API ausente: ${method}`);
  }
});
