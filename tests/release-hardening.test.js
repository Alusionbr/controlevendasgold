'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadScripts(files, additions = {}) {
  const context = vm.createContext({
    window: {},
    console,
    Intl,
    Date,
    URL,
    URLSearchParams,
    Blob,
    FormData,
    ...additions,
  });
  context.window.window = context.window;
  files.forEach((file) => vm.runInContext(read(file), context, { filename: file }));
  return context.window.C360;
}

test('cálculos financeiros e de estoque cobrem casos de borda', () => {
  const c360 = loadScripts(['src/utils.js', 'src/calculations.js']);

  assert.equal(c360.utils.number('1.234,56'), 1234.56);
  assert.equal(c360.calc.weightedAverageCost(10, 5, 10, 150), 10);
  assert.deepEqual(
    { ...c360.calc.saleMath({ quantity: 2, unitPrice: 100, discount: 10, fixedFees: 5, feePercent: 10, unitCost: 30 }) },
    {
      grossRevenue: 200,
      percentFees: 20,
      netRevenue: 165,
      cogs: 60,
      grossProfit: 105,
      margin: 105 / 165,
    }
  );
  assert.equal(c360.calc.sellerBalance([
    { direction: 'debit', amount: 300 },
    { direction: 'credit', amount: 125 },
  ]), 175);
  assert.deepEqual(
    { ...c360.calc.resolveSellerPrice({
      product: { salePrice: 80, defaultPrice: 70, priceFloor: 60 },
      sellerPrice: { price: 90, floor: 75 },
    }) },
    { price: 90, floor: 75 }
  );
  assert.equal(c360.calc.validatePriceFloor({ unitPrice: 74.99, floor: 75 }).ok, false);
});

test('devolução usa RPC atômica e limita o total acumulado', async () => {
  const calls = [];
  let refreshes = 0;
  const c360 = loadScripts(['src/utils.js'], {});
  c360.ui = {};
  c360.state = {
    getState: () => ({
      sales: [{ id: 'return-1', parentSaleId: 'sale-1', origin: 'devolucao', quantity: -2 }],
    }),
    refresh: async () => { refreshes += 1; },
  };
  c360.api = {
    registerSaleReturn: async (payload) => {
      calls.push(payload);
      return 'return-2';
    },
  };
  vm.runInContext(read('src/returns.js'), vm.createContext({
    window: { C360: c360 },
    console,
  }), { filename: 'src/returns.js' });

  const sale = { id: 'sale-1', quantity: 10 };
  const excess = await c360.returns.recordDevolucao({ sale, quantity: 9 });
  assert.equal(excess.ok, false);
  assert.match(excess.error, /saldo devolvível \(8\)/);
  assert.equal(calls.length, 0);

  const accepted = await c360.returns.recordDevolucao({ sale, quantity: 8, notes: 'troca' });
  assert.equal(accepted.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ saleId: 'sale-1', quantity: 8, notes: 'troca' }]);
  assert.equal(refreshes, 1);
});

test('desperdício usa RPC atômica e atualiza o cache remoto', async () => {
  const calls = [];
  let refreshes = 0;
  const c360 = loadScripts(['src/utils.js']);
  c360.ui = {};
  c360.state = {
    getState: () => ({ sales: [] }),
    refresh: async () => { refreshes += 1; },
  };
  c360.api = {
    registerSaleWaste: async (payload) => {
      calls.push(payload);
      return 'movement-1';
    },
  };
  vm.runInContext(read('src/returns.js'), vm.createContext({
    window: { C360: c360 },
    console,
  }), { filename: 'src/returns.js' });

  const result = await c360.returns.recordDesperdicio({
    sale: { id: 'sale-1' },
    quantity: 3,
    notes: 'avaria',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ saleId: 'sale-1', quantity: 3, notes: 'avaria' }]);
  assert.equal(refreshes, 1);
});

test('API envia as operações críticas para RPCs dedicadas', async () => {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify('result-id'),
    };
  };
  const c360 = loadScripts(['src/api.js'], { fetch });

  await c360.api.registerSellerPayment({ sellerId: 'seller-1', amount: 25, method: 'pix', notes: 'ok' });
  await c360.api.registerSaleReturn({ saleId: 'sale-1', quantity: 2, notes: 'troca' });
  await c360.api.registerSaleWaste({ saleId: 'sale-1', quantity: 1, notes: 'avaria' });
  await c360.api.convertPublicCartToOrders('cart-1');
  await c360.api.advanceOrderGroup('group-1', 'despachado');

  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [
      '/rest/v1/rpc/register_seller_payment',
      '/rest/v1/rpc/register_sale_return',
      '/rest/v1/rpc/register_sale_waste',
      '/rest/v1/rpc/convert_public_cart_to_orders',
      '/rest/v1/rpc/advance_order_group',
    ]
  );
  assert.deepEqual(
    requests.map((request) => JSON.parse(request.options.body)),
    [
      { p_seller_id: 'seller-1', p_amount: 25, p_method: 'pix', p_notes: 'ok' },
      { p_sale_id: 'sale-1', p_quantity: 2, p_notes: 'troca' },
      { p_sale_id: 'sale-1', p_quantity: 1, p_notes: 'avaria' },
      { p_cart_id: 'cart-1' },
      { p_group_id: 'group-1', p_new_status: 'despachado' },
    ]
  );
});

test('despacho da esteira separa venda de consignação e é atômico', () => {
  const source = read('src/salesCart.js');
  const sql = read('supabase/migrations/20260725142236_atomic_order_dispatch.sql');

  assert.match(source, /api\(\)\.advanceOrderGroup\(groupId, newStatus\)/);
  assert.doesNotMatch(source, /convertedSaleId:\s*\(consignment/);
  assert.match(source, /order\.convertedSaleId \|\| order\.convertedConsignmentId/);

  assert.match(sql, /add column if not exists converted_consignment_id uuid/);
  assert.match(sql, /references public\.consignments\(id\)/);
  assert.match(sql, /create or replace function public\.advance_order_group/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /for update/);
  assert.match(sql, /set converted_consignment_id = v_consignment_id/);
  assert.match(sql, /set converted_sale_id = v_sale_id/);
  assert.match(sql, /grant execute on function public\.advance_order_group\(uuid, text\) to authenticated/);
});

test('histórico não pode mais ser apagado pela interface ou por cascade', () => {
  const app = read('src/app.js');
  const sql = read('supabase/migrations/0026_release_hardening.sql');

  assert.doesNotMatch(app, /UI\.actionButton\('delete-product'/);
  assert.doesNotMatch(app, /UI\.actionButton\('delete-consignment'/);
  for (const table of [
    'purchases', 'stock_movements', 'productions', 'sales',
    'orders', 'consignments', 'operational_movements',
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table}[\\s\\S]*?on delete restrict`));
  }
});

test('carrinho público enviado fica visível e conversível na esteira', () => {
  const source = read('src/salesCart.js');
  const sql = read('supabase/migrations/0026_release_hardening.sql');

  assert.match(source, /function renderSubmittedPublicCarts\(\)/);
  assert.match(source, /isAdmin\(\)\s*\?\s*draft\.mode === 'propria'/);
  assert.match(source, /cart\.status === 'submitted'/);
  assert.match(source, /data-cart-action="convert-public-cart"/);
  assert.match(source, /convertPublicCartToOrders\(button\.dataset\.cartId\)/);
  assert.match(source, /data-cart-action="reject-public-cart"/);
  assert.match(source, /\{ status: 'rejected' \}/);
  assert.match(sql, /if v_cart\.status <> 'submitted'/);
  assert.match(sql, /insert into public\.orders/);
  assert.match(sql, /set status = 'converted'/);
});

test('catálogo do vendedor mascara estoque com RLS normal', () => {
  const sql = read('supabase/migrations/0027_secure_seller_product_catalog.sql');

  assert.match(sql, /drop view if exists public\.seller_products/);
  assert.match(sql, /create table public\.seller_products/);
  assert.match(sql, /seller_products_stock_masked check \(current_stock is null\)/);
  assert.match(sql, /alter table public\.seller_products enable row level security/);
  assert.match(sql, /create policy seller_products_select_active_business/);
  assert.match(sql, /revoke all on function public\.sync_seller_product_catalog\(\) from public, anon, authenticated/);
});
