'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260914143000_fix_financial_entry_consistency.sql';

function loadCalculations() {
  const context = { window: { C360: { utils: {
    number: (value) => Number(value) || 0,
    money: (value) => String(value),
  } } } };
  vm.createContext(context);
  vm.runInContext(read('src/calculations.js'), context, { filename: 'src/calculations.js' });
  return context.window.C360.calc;
}

function paymentRpc(sql) {
  const start = sql.indexOf('create or replace function public.register_financial_entry_payment');
  const end = sql.indexOf('$register_financial_entry_payment$;', start);
  return sql.slice(start, end);
}

test('razão de baixas é append-only, isolado por negócio e preparado para estorno', () => {
  const sql = read(migration);
  assert.match(sql, /create table if not exists public\.financial_entry_payments/);
  for (const field of ['business_id', 'financial_entry_id', 'amount', 'payment_date', 'payment_method', 'notes', 'request_id', 'created_by', 'created_at']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`), `campo ausente: ${field}`);
  }
  assert.match(sql, /event_type in \('payment', 'reversal'\)/);
  assert.match(sql, /reversal_of_id uuid references public\.financial_entry_payments/);
  assert.match(sql, /unique \(business_id, request_id\)/);
  assert.match(sql, /alter table public\.financial_entry_payments enable row level security/);
  assert.match(sql, /financial_entry_payments_select_admin[\s\S]*public\.is_admin\(\)[\s\S]*business_id = \(select public\.my_business_id\(\)\)/);
  assert.match(sql, /financial_entry_payments_insert_admin[\s\S]*created_by = \(select auth\.uid\(\)\)/);
  assert.match(sql, /revoke all on public\.financial_entry_payments from public, anon, authenticated/);
  assert.match(sql, /grant select, insert on public\.financial_entry_payments to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*(update|delete)[^;]* on public\.financial_entry_payments/i);
  assert.match(sql, /before update or delete on public\.financial_entry_payments[\s\S]*reject_financial_entry_payment_mutation/);
  assert.match(sql, /Estorno deve corresponder integralmente a um pagamento do lançamento/);
});

test('RPC de baixa é invoker, idempotente e trava o título antes da soma', () => {
  const sql = read(migration);
  const rpc = paymentRpc(sql);
  assert.match(rpc, /security invoker\s+set search_path = ''/);
  assert.doesNotMatch(rpc, /security\s+definer/i);
  assert.match(rpc, /auth\.uid\(\).*public\.is_admin\(\)/s);
  assert.match(rpc, /v_business_id := \(select public\.my_business_id\(\)\)/);
  const advisory = rpc.indexOf('pg_catalog.pg_advisory_xact_lock');
  const existing = rpc.indexOf('p.request_id = p_request_id');
  const title = rpc.indexOf('f.id = p_financial_entry_id');
  const excess = rpc.indexOf('v_entry.paid_amount + v_amount');
  const insert = rpc.indexOf('insert into public.financial_entry_payments');
  assert.ok(advisory > 0 && existing > advisory && title > existing && excess > title && insert > excess);
  assert.match(rpc.slice(existing, title), /return v_existing\.id/);
  assert.match(rpc.slice(title, excess), /f\.business_id = v_business_id[\s\S]*for update/);
  assert.match(rpc, /Identificador da operação já usado com dados diferentes/);
  assert.match(rpc, /A baixa não pode superar o saldo do lançamento/);
  assert.match(sql, /grant execute on function public\.register_financial_entry_payment\([\s\S]*to authenticated, service_role/);
});

test('evento e saldo são atômicos; falhas e outro negócio não deixam efeito parcial', () => {
  const sql = read(migration);
  const syncStart = sql.indexOf('create or replace function public.sync_financial_entry_payment_balance');
  const syncEnd = sql.indexOf('$sync_financial_entry_payment_balance$;', syncStart);
  const sync = sql.slice(syncStart, syncEnd);
  const rpc = paymentRpc(sql);
  assert.match(sync, /f\.id = new\.financial_entry_id[\s\S]*f\.business_id = new\.business_id[\s\S]*for update/);
  assert.match(sync, /update public\.financial_entries[\s\S]*paid_amount = round\(v_entry\.paid_amount \+ v_delta, 2\)/);
  assert.match(sql, /before insert on public\.financial_entry_payments[\s\S]*sync_financial_entry_payment_balance/);
  assert.doesNotMatch(sync, /exception\s+when/i);
  assert.doesNotMatch(rpc, /exception\s+when/i);
});

test('venda direta registra o recebimento inicial dentro da mesma transação', () => {
  const sql = read(migration);
  const start = sql.indexOf('create or replace function public.register_direct_sale');
  const end = sql.indexOf('$register_direct_sale$;', start);
  const rpc = sql.slice(start, end);
  const saleInsert = rpc.indexOf('insert into public.sales');
  const financialLock = rpc.indexOf('into v_financial_entry_id', saleInsert);
  const paymentInsert = rpc.indexOf('insert into public.financial_entry_payments', financialLock);
  const postcondition = rpc.indexOf("raise exception 'Não foi possível registrar o recebimento inicial da venda'", paymentInsert);
  assert.ok(saleInsert > 0 && financialLock > saleInsert && paymentInsert > financialLock && postcondition > paymentInsert);
  assert.match(rpc.slice(paymentInsert, postcondition), /v_paid_amount, p_date[\s\S]*v_payment_method[\s\S]*p_request_id/);
  assert.doesNotMatch(rpc, /exception\s+when/i);
});

test('parcial inicial e duas parcelas preservam dias e meses distintos', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1',
    sales: [{ id: 'sale-1', businessId: 'b1', date: '2026-09-14', netRevenue: 300, grossProfit: 120, paidAmount: 50 }],
    financialEntries: [{ id: 'entry-1', businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'sale-1', amount: 300, paidAmount: 300, status: 'paid' }],
    financialEntryPayments: [
      { id: 'p1', businessId: 'b1', financialEntryId: 'entry-1', eventType: 'payment', amount: 50, paymentDate: '2026-09-14' },
      { id: 'p2', businessId: 'b1', financialEntryId: 'entry-1', eventType: 'payment', amount: 100, paymentDate: '2026-09-30' },
      { id: 'p3', businessId: 'b1', financialEntryId: 'entry-1', eventType: 'payment', amount: 150, paymentDate: '2026-10-05' },
    ],
    consignments: [], consignmentEvents: [], sellerPayments: [], sellerOrderAccounts: [],
    sellerPaymentAllocations: [], orders: [],
  };
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-09-01', dateTo: '2026-09-30' }).direct.total, 150);
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-10-01', dateTo: '2026-10-31' }).direct.total, 150);
  assert.equal(calc.dailyReceipts(state, '2026-09-14').sales.total, 50);
  assert.equal(calc.dailyReceipts(state, '2026-09-30').sales.total, 100);
  assert.equal(calc.dailyReceipts(state, '2026-10-05').sales.total, 150);
});

test('estorno corrige o período sem apagar o pagamento original', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1',
    sales: [{ id: 'sale-1', businessId: 'b1', date: '2026-09-10', netRevenue: 100, grossProfit: 40 }],
    financialEntries: [{ id: 'entry-1', businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'sale-1', amount: 100, paidAmount: 0, status: 'open' }],
    financialEntryPayments: [
      { id: 'p1', businessId: 'b1', financialEntryId: 'entry-1', eventType: 'payment', amount: 100, paymentDate: '2026-09-10' },
      { id: 'r1', businessId: 'b1', financialEntryId: 'entry-1', eventType: 'reversal', reversalOfId: 'p1', amount: 100, paymentDate: '2026-10-01' },
    ],
    consignments: [], consignmentEvents: [], sellerPayments: [], sellerOrderAccounts: [],
    sellerPaymentAllocations: [], orders: [],
  };
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-09-01', dateTo: '2026-09-30' }).direct.total, 100);
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-10-01', dateTo: '2026-10-31' }).direct.total, -100);
  assert.equal(calc.dailyReceipts(state, '2026-10-01').sales.total, -100);
});

test('modal envia data, método, notas e chave idempotente pela RPC', async () => {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify('payment-1') };
  };
  const context = vm.createContext({ window: {}, console, URL, URLSearchParams, fetch, Blob, FormData });
  context.window.window = context.window;
  vm.runInContext(read('src/api.js'), context, { filename: 'src/api.js' });
  await context.window.C360.api.registerFinancialEntryPayment({
    financialEntryId: 'entry-1', amount: 25, paymentDate: '2026-09-14',
    paymentMethod: 'Pix', notes: 'Parcela 1', requestId: 'request-1',
  });
  assert.equal(new URL(requests[0].url).pathname, '/rest/v1/rpc/register_financial_entry_payment');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    p_financial_entry_id: 'entry-1', p_amount: 25, p_payment_date: '2026-09-14',
    p_payment_method: 'Pix', p_notes: 'Parcela 1', p_request_id: 'request-1',
  });

  const app = read('src/app.js');
  const start = app.indexOf('async function applyFinancialPayment');
  const end = app.indexOf('async function updateProduct', start);
  const apply = app.slice(start, end);
  for (const field of ['paymentDate', 'paymentMethod', 'notes']) assert.match(app, new RegExp(`name="${field}"`));
  assert.match(app, /pendingFinancialPaymentRequestIds/);
  assert.match(app, /registerFinancialEntryPayment/);
  assert.doesNotMatch(apply, /S\.update\(['"]financialEntries/);
});

test('não há backfill de datas ou do histórico ambíguo de R$ 700', () => {
  const sql = read(migration);
  const historical = sql.slice(sql.indexOf('-- Historical direct sales'), sql.indexOf('commit;'));
  assert.match(historical, /intentionally performs no data backfill/);
  assert.doesNotMatch(historical, /financial_entry_payments/);
  assert.doesNotMatch(historical, /update public\.sales|update public\.financial_entries/);
});
