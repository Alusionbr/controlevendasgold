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

test('RPC de venda direta é invoker, restrita ao admin e isolada por negócio', () => {
  const sql = read(migration);
  const start = sql.indexOf('create or replace function public.register_direct_sale');
  const end = sql.indexOf('$register_direct_sale$;', start) + '$register_direct_sale$;'.length;
  const rpc = sql.slice(start, end);

  assert.match(rpc, /security invoker\s+set search_path = ''/);
  assert.doesNotMatch(rpc, /security\s+definer/i);
  assert.match(rpc, /auth\.uid\(\).*public\.is_admin\(\)/s);
  assert.match(rpc, /v_business_id := \(select public\.my_business_id\(\)\)/);
  assert.match(rpc, /from public\.clients c[\s\S]*c\.business_id = v_business_id/);
  assert.match(rpc, /from public\.products p[\s\S]*p\.business_id = v_business_id[\s\S]*for update/);
  assert.match(rpc, /'manual', null, null, p_payment_mode/);
  assert.match(sql, /revoke all on function public\.register_direct_sale\([\s\S]*from public, anon/);
  assert.match(sql, /grant execute on function public\.register_direct_sale\([\s\S]*to authenticated, service_role/);
});

test('à vista, parcial e a prazo têm regras explícitas no banco', () => {
  const sql = read(migration);
  for (const required of [
    "p_payment_mode = 'avista'",
    'v_paid_amount <> v_net_revenue',
    "p_payment_mode = 'parcial'",
    'v_paid_amount <= 0 or v_paid_amount >= v_net_revenue',
    'p_due_date is null or p_due_date < p_date',
    'v_payment_method is null',
    'Venda a prazo exige valor pago igual a zero',
    "payment_mode is null or payment_mode in ('avista', 'parcial', 'a_prazo')",
  ]) assert.ok(sql.includes(required), `regra ausente: ${required}`);
});

test('idempotência e concorrência serializam a requisição e bloqueiam o produto', () => {
  const sql = read(migration);
  const requestLock = sql.indexOf('pg_catalog.pg_advisory_xact_lock');
  const existingLookup = sql.indexOf('s.request_id = p_request_id', requestLock);
  const productLock = sql.indexOf('p.id = p_product_id', existingLookup);
  const stockCheck = sql.indexOf('v_stock < v_quantity', productLock);
  const stockUpdate = sql.indexOf('set current_stock = current_stock - v_quantity', stockCheck);

  assert.match(sql, /create unique index if not exists idx_sales_direct_request_unique/);
  assert.ok(requestLock > 0 && existingLookup > requestLock, 'a chave idempotente deve ser serializada antes da consulta');
  assert.match(sql.slice(existingLookup, productLock), /return v_existing\.id/);
  assert.match(sql.slice(productLock, stockCheck), /for update/);
  assert.ok(stockCheck > productLock && stockUpdate > stockCheck, 'estoque deve ser validado depois do lock e antes da baixa');
  assert.match(sql, /Identificador da operação já usado com dados diferentes/);
});

test('venda física grava uma vez e qualquer falha derruba a operação inteira', () => {
  const sql = read(migration);
  const start = sql.indexOf('create or replace function public.register_direct_sale');
  const end = sql.indexOf('$register_direct_sale$;', start);
  const rpc = sql.slice(start, end);

  assert.equal((rpc.match(/insert into public\.sales/g) || []).length, 1);
  assert.equal((rpc.match(/insert into public\.stock_movements/g) || []).length, 1);
  assert.match(rpc, /ref_type, ref_id[\s\S]*'sale', v_sale_id/);
  assert.match(rpc, /from public\.financial_entries f[\s\S]*f\.source_id = v_sale_id/);
  assert.match(rpc, /raise exception 'Não foi possível criar o lançamento financeiro da venda'/);
  assert.doesNotMatch(rpc, /exception\s+when/i);
});

test('baixa da RPC permanece visível na auditoria administrativa do produto', () => {
  const rpc = read(migration);
  const audit = read('supabase/migrations/0029_record_audit_log.sql');
  assert.match(rpc, /update public\.products[\s\S]*set current_stock = current_stock - v_quantity/);
  assert.match(audit, /create trigger trg_products_audit after update on public\.products/);
  assert.match(audit, /jsonb_object_keys\(new_json\)/);
  assert.doesNotMatch(audit, /key not in \([^)]*current_stock/);
});

test('serviço não movimenta estoque e estoque físico insuficiente é recusado', () => {
  const sql = read(migration);
  assert.match(sql, /if v_product_type <> 'servico' and v_stock < v_quantity then[\s\S]*Estoque insuficiente/);
  const serviceGuard = sql.match(/if v_product_type <> 'servico' then[\s\S]*?insert into public\.stock_movements[\s\S]*?end if;/);
  assert.ok(serviceGuard, 'baixa e movimento precisam estar sob a mesma guarda de serviço');
});

test('formulário manual chama somente register_direct_sale com todos os termos', async () => {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify('sale-1') };
  };
  const context = vm.createContext({
    window: {}, console, URL, URLSearchParams, fetch, Blob, FormData,
  });
  context.window.window = context.window;
  vm.runInContext(read('src/api.js'), context, { filename: 'src/api.js' });

  await context.window.C360.api.registerDirectSale({
    requestId: 'request-1', date: '2026-09-14', channel: 'Direto', clientId: 'client-1',
    productId: 'product-1', quantity: 2, unitPrice: 50, discount: 5, fixedFees: 1,
    feePercent: 2, paymentMode: 'parcial', paidAmount: 30, dueDate: '2026-10-01',
    paymentMethod: 'pix', notes: 'teste',
  });

  assert.equal(new URL(requests[0].url).pathname, '/rest/v1/rpc/register_direct_sale');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    p_request_id: 'request-1', p_date: '2026-09-14', p_channel: 'Direto',
    p_client_id: 'client-1', p_product_id: 'product-1', p_quantity: 2,
    p_unit_price: 50, p_discount: 5, p_fixed_fees: 1, p_fee_percent: 2,
    p_payment_mode: 'parcial', p_paid_amount: 30, p_due_date: '2026-10-01',
    p_payment_method: 'pix', p_notes: 'teste',
  });

  const app = read('src/app.js');
  const submitStart = app.indexOf('async function submitSale');
  const submitEnd = app.indexOf('async function addOrder', submitStart);
  const submit = app.slice(submitStart, submitEnd);
  assert.match(app, /id="saleForm"/);
  for (const field of ['paymentMode', 'paidAmount', 'dueDate', 'paymentMethod']) {
    assert.match(app, new RegExp(`name="${field}"`));
  }
  assert.match(submit, /registerDirectSale/);
  assert.doesNotMatch(submit, /return addSale|await addSale/);
  assert.match(submit, /pendingManualSaleRequestId/);
});

test('receita direta usa liquidação real e reconhece só o valor parcial recebido', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1',
    sales: [
      { id: 'cash', businessId: 'b1', date: '2026-09-10', netRevenue: 100, grossProfit: 40, paidAmount: 100 },
      { id: 'partial', businessId: 'b1', date: '2026-09-10', netRevenue: 200, grossProfit: 80, paidAmount: 50 },
      { id: 'credit', businessId: 'b1', date: '2026-09-10', netRevenue: 300, grossProfit: 120, paidAmount: 0 },
      { id: 'historical', businessId: 'b1', date: '2026-08-01', netRevenue: 700, grossProfit: 280, paidAmount: 0 },
      { id: 'foreign', businessId: 'b2', date: '2026-09-10', netRevenue: 999, grossProfit: 999, paidAmount: 999 },
    ],
    financialEntries: [
      { businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'cash', amount: 100, paidAmount: 100, status: 'paid' },
      { businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'partial', amount: 200, paidAmount: 80, status: 'partial', updatedAt: '2026-09-12T12:00:00Z' },
      { businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'credit', amount: 300, paidAmount: 0, status: 'open' },
      { businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 'historical', amount: 700, paidAmount: 0, status: 'open' },
      { businessId: 'b2', direction: 'receivable', sourceType: 'sale', sourceId: 'foreign', amount: 999, paidAmount: 999, status: 'paid' },
    ],
    consignments: [], consignmentEvents: [], sellerPayments: [], sellerOrderAccounts: [],
  };

  const all = calc.recognizedRevenue(state);
  assert.equal(all.direct.total, 180);
  assert.equal(all.direct.count, 3);
  assert.equal(all.direct.profit, 72);
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-09-10', dateTo: '2026-09-10' }).direct.total, 150);
  assert.equal(calc.recognizedRevenue(state, { dateFrom: '2026-09-12', dateTo: '2026-09-12' }).direct.total, 30);
});

test('migration não classifica nem liquida vendas históricas ambíguas', () => {
  const sql = read(migration);
  const historical = sql.slice(
    sql.indexOf('-- Historical direct sales'),
    sql.indexOf('-- Backfill purchase payables')
  );
  assert.match(historical, /must[\s\S]*be reviewed by a person/);
  assert.doesNotMatch(historical, /update public\.sales|update public\.financial_entries|insert into public\.financial_entries/);
});

test('pagamento inicial de vendedor não é contado também como cliente', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1', sales: [], financialEntries: [],
    consignments: [
      { id: 'client-c', businessId: 'b1', unitPrice: 10, costAtSend: 6 },
      { id: 'seller-c', businessId: 'b1', sellerId: 'seller-1', unitPrice: 20, costAtSend: 12 },
    ],
    consignmentEvents: [
      { businessId: 'b1', consignmentId: 'client-c', type: 'pagamento', date: '2026-09-14', amount: 20 },
      { businessId: 'b1', consignmentId: 'seller-c', type: 'pagamento', date: '2026-09-14', amount: 40 },
    ],
    sellerPayments: [{ businessId: 'b1', paymentDate: '2026-09-14', amount: 100 }],
    sellerOrderAccounts: [{ createdAt: '2026-09-14T10:00:00Z', initialPaid: 40 }],
    sellerPaymentAllocations: [], orders: [],
  };

  const revenue = calc.recognizedRevenue(state);
  assert.equal(revenue.clients.total, 20);
  assert.equal(revenue.sellers.total, 140);
  assert.equal(revenue.total, 160);
  const daily = calc.dailyReceipts(state, '2026-09-14');
  assert.equal(daily.clients.total, 20);
  assert.equal(daily.sellers.total, 140);
  assert.equal(daily.total, 160);
});

test('restauração local enganosa fica desabilitada sem tocar no cache', () => {
  const io = read('src/exportImport.js');
  const app = read('src/app.js');
  const xlsxStart = io.indexOf('async function importXlsx');
  const jsonStart = io.indexOf('function importJson');
  const xlsxBlock = io.slice(xlsxStart, io.indexOf('// ---------- CSV', xlsxStart));
  const jsonBlock = io.slice(jsonStart, io.indexOf('window.C360.io', jsonStart));

  assert.match(xlsxBlock, /Restauração indisponível/);
  assert.match(jsonBlock, /Restauração indisponível/);
  assert.doesNotMatch(xlsxBlock, /replaceState/);
  assert.doesNotMatch(jsonBlock, /replaceState/);
  assert.match(app, /Importar Excel indisponível/);
  assert.match(app, /Importar JSON indisponível/);
  assert.match(app, /Restauração temporariamente indisponível/);
});
