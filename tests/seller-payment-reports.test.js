'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260730132326_seller_payment_reports_review.sql';

test('pagamento informado fica pendente e isolado por RLS', () => {
  const sql = read(migration);
  for (const required of [
    'create table if not exists public.seller_payment_reports',
    "status text not null default 'pending'",
    'alter table public.seller_payment_reports enable row level security',
    'seller_id = (select auth.uid())',
    'public.is_admin() and business_id = public.my_business_id()',
    'proof_path like (select auth.uid())::text',
    'order_group_id is null',
    'o.seller_id = (select auth.uid())',
    'revoke all on table public.seller_payment_reports from anon, authenticated',
  ]) assert.ok(sql.includes(required), `proteção ausente: ${required}`);
});

test('comprovante usa bucket privado limitado a foto ou PDF', () => {
  const sql = read(migration);
  assert.match(sql, /'seller-payment-proofs', 'seller-payment-proofs', false, 10485760/);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) assert.ok(sql.includes(mime));
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)::text/);
  assert.match(sql, /seller_payment_proofs_select/);
  assert.match(sql, /r\.proof_path = storage\.objects\.name/);
});

test('aprovação é atômica, ajustável e não pode ser repetida', () => {
  const sql = read(migration);
  for (const required of [
    'for update', "if v_report.status <> 'pending'", 'if p_amount > v_open_amount + 0.004',
    'insert into public.seller_payments', 'insert into public.seller_payment_allocations',
    'insert into public.seller_account_entries', "status = 'approved'",
    'reviewed_amount = round(p_amount, 2)', 'payment_id = v_payment_id',
  ]) assert.ok(sql.includes(required), `regra atômica ausente: ${required}`);
});

test('recusa preserva auditoria sem lançar pagamento', () => {
  const sql = read(migration);
  const rejectStart = sql.indexOf("if p_action = 'reject'");
  const rejectEnd = sql.indexOf('if coalesce(p_amount', rejectStart);
  const block = sql.slice(rejectStart, rejectEnd);
  assert.match(block, /status = 'rejected'/);
  assert.match(block, /reviewed_by = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(block, /insert into public\.seller_payments/);
});

test('API valida arquivo, envia relatório e cria URL temporária', () => {
  const api = read('src/api.js');
  assert.match(api, /uploadSellerPaymentProof/);
  assert.match(api, /10 \* 1024 \* 1024/);
  assert.match(api, /seller-payment-proofs/);
  assert.match(api, /insert\('seller_payment_reports'/);
  assert.match(api, /rpc\/review_seller_payment_report/);
  assert.match(api, /expiresIn: 300/);
});

test('vendedor informa todos os campos e admin confere com valor editável', () => {
  const seller = read('src/sellerLedger.js');
  const admin = read('src/auth.js');
  for (const field of ['orderGroupId', 'reportedAt', 'amount', 'method', 'proof', 'notes']) assert.match(seller, new RegExp(`name="${field}"`));
  assert.match(seller, /data-seller-payment-report-form/);
  assert.match(seller, /ainda não alterou seu saldo/);
  assert.match(admin, /data-review-payment-report/);
  assert.match(admin, /Valor a lançar/);
  assert.match(admin, /view-payment-proof/);
  assert.match(admin, /reject-payment-report/);
  assert.match(admin, /Conferir e lançar pagamento/);
});

test('estado carrega relatórios próprios para vendedor e da empresa para admin', () => {
  const state = read('src/state.js');
  assert.match(state, /sellerPaymentReports: \[\]/);
  assert.match(state, /seller_payment_reports', \{ business_id: businessId/);
  assert.match(state, /seller_payment_reports', \{ seller_id: userId/);
});