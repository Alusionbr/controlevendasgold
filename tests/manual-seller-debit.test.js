'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260806203450_register_manual_seller_debit.sql';

test('RPC de débito manual é restrita, auditável e idempotente', () => {
  const sql = read(migration).toLowerCase();
  for (const required of [
    'security invoker',
    'select public.is_admin()',
    "role = 'vendedor'",
    'active = true',
    "'manual_adjustment', 'debit'",
    "'manual_seller_debit'",
    'p_request_id',
    'create unique index if not exists seller_account_entries_manual_debit_request_uidx',
    'on conflict (business_id, source_type, source_id)',
    'from public, anon',
    'to authenticated, service_role',
  ]) assert.ok(sql.includes(required), `regra ausente: ${required}`);
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.doesNotMatch(sql, /sale_carts|sale_cart_items/);
});

test('API e ledger expõem uma única operação de débito manual', () => {
  const api = read('src/api.js');
  const ledger = read('src/sellerLedger.js');
  assert.match(api, /rpc\/register_manual_seller_debit/);
  for (const field of ['p_seller_id', 'p_amount', 'p_reason', 'p_request_id']) {
    assert.match(api, new RegExp(field));
  }
  assert.match(ledger, /async function registerManualDebit/);
  assert.match(ledger, /cleanReason\.length < 3/);
  assert.match(ledger, /registerManualSellerDebit/);
  assert.match(ledger, /await S\(\)\.refresh\(\)/);
});

test('painel rápido seleciona vendedor, confirma impacto e não depende de carrinho', () => {
  const auth = read('src/auth.js');
  for (const hook of [
    'data-manual-debit-form',
    'name="sellerId"',
    'name="amount"',
    'name="reason"',
    'Incluir dívida sem carrinho',
    'registerManualDebit',
    'crypto.randomUUID()',
    'O saldo passará de',
  ]) assert.ok(auth.includes(hook), `gancho ausente: ${hook}`);

  const manualDebitHandler = auth.indexOf('if (manualDebitForm && container.contains(manualDebitForm))');
  const createSellerHandler = auth.indexOf('if (createForm && container.contains(createForm))');
  assert.ok(createSellerHandler >= 0 && manualDebitHandler > createSellerHandler, 'manual debit handler must exist after seller creation');
  const betweenHandlers = auth.slice(createSellerHandler, manualDebitHandler);
  assert.match(betweenHandlers, /return;\s*}\s*$/, 'manual debit handler must be outside seller creation');

  const declaration = auth.indexOf('const pendingPayments = pendingPaymentReportsCountForSeller');
  const use = auth.indexOf('const isExpanded =', declaration - 300);
  assert.ok(declaration >= 0 && use > declaration, 'pendingPayments deve ser calculado antes de isExpanded');
});
