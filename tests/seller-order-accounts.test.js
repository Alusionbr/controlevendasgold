'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('migração aloca pagamentos e protege a consulta do vendedor', () => {
  const sql = read('supabase/migrations/20260729205823_seller_order_accounts.sql');
  assert.match(sql, /create table if not exists public\.seller_payment_allocations/);
  assert.match(sql, /alter table public\.seller_payment_allocations enable row level security/);
  assert.match(sql, /create or replace function public\.register_seller_order_payment/);
  assert.match(sql, /create or replace function public\.list_seller_order_accounts/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /when v_role = 'vendedor' then v_caller_id/);
  assert.match(sql, /p_amount > v_open_amount/);
  assert.match(sql, /'order_group_payment'/);
});

test('frontend registra pagamento no grupo e renderiza contas por pedido', () => {
  const api = read('src/api.js');
  const ledger = read('src/sellerLedger.js');
  const auth = read('src/auth.js');
  const state = read('src/state.js');

  assert.match(api, /rpc\/register_seller_order_payment/);
  assert.match(api, /p_order_group_id: orderGroupId/);
  assert.match(api, /rpc\/list_seller_order_accounts/);
  assert.match(ledger, /Estoque e contas por pedido/);
  assert.match(ledger, /Pagamentos deste pedido/);
  assert.match(ledger, /data-order-payment-form/);
  assert.match(auth, /fill-order-balance/);
  assert.match(auth, /registerOrderPayment\(orderGroupId/);
  assert.match(state, /sellerPaymentAllocations/);
  assert.match(state, /sellerOrderAccounts/);
});

test('vendedor continua sem formulário de escrita na própria tela', () => {
  const ledger = read('src/sellerLedger.js');
  const start = ledger.indexOf('function renderSeller');
  const end = ledger.indexOf('function mountSeller', start);
  const panel = ledger.slice(start, end);
  assert.match(panel, /renderOrderAccounts\(currentUser\.id\)/);
  assert.doesNotMatch(panel, /editable:\s*true/);
  assert.doesNotMatch(panel, /<form|<button|data-action=/i);
});
