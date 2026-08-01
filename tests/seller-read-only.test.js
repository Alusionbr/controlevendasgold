'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// O vendedor deixou de ser 100% somente leitura: ele volta a montar pedido de
// reposição para o admin (migration 20260801143000_seller_cart_requests).
// A lista continua fechada de propósito — qualquer aba nova para o papel tem
// de ser uma decisão explícita, com RLS correspondente.
test('vendedor tem exatamente as telas de pedido e conta', () => {
  const app = read('src/app.js');
  const roles = app.match(/const TAB_ROLES = \{([\s\S]*?)\n  \};/);
  assert.ok(roles, 'TAB_ROLES não encontrado');
  const sellerTabs = [...roles[1].matchAll(/^\s*(\w+):\s*\[[^\]]*'vendedor'[^\]]*\]/gm)].map((match) => match[1]);
  assert.deepEqual(sellerTabs, ['pedir', 'meusaldo']);
  assert.match(app, /vendedor:\s*\['pedir', 'meusaldo'\]/);
  assert.doesNotMatch(app, /mountGrantStock\(document\.getElementById\('grantStockPanel'\)\)/);
});

test('pedido do vendedor nasce aguardando aprovação e não mexe em estoque', () => {
  const request = read('src/sellerOrderRequest.js');
  // A tela não pode ter caminho próprio de gravação: tudo passa pelo
  // requestStockFromAdmin, que delega para launchOrderFromCart no modo
  // 'request' — o único que cria orders como 'pendente_aprovacao'.
  assert.match(request, /C360\.salesCart\.requestStockFromAdmin/);
  assert.doesNotMatch(request, /recordMovement|consumeSellerStock|add\('sales'|add\('consignments'/);

  const cart = read('src/salesCart.js');
  const start = cart.indexOf('async function requestStockFromAdmin');
  assert.ok(start >= 0, 'requestStockFromAdmin não encontrado');
  const fn = cart.slice(start, cart.indexOf('window.C360.salesCart =', start));
  assert.match(fn, /mode:\s*'request'/);
});

test('carregamento do vendedor busca somente dados próprios e registra o login diário controlado', () => {
  const state = read('src/state.js');
  const start = state.indexOf('async function refreshAsSeller');
  const end = state.indexOf('async function refresh()', start);
  assert.ok(start >= 0 && end > start, 'refreshAsSeller não encontrado');
  const sellerRefresh = state.slice(start, end);

  // `orders` e `seller_prices` entraram para a tela de pedido: o vendedor
  // precisa ver o que já pediu e por qual preço. Ambos são filtrados por
  // seller_id na consulta e pela RLS. O resto segue fora do alcance dele.
  for (const forbidden of [
    "api.list('clients'", "api.list('sales'",
    "api.list('consignments'", 'api.listSaleCarts', 'api.listSaleCartItems',
    'api.listSalesGoals', 'api.listGoalsProgress',
    "api.list('operational_movements'",
  ]) assert.doesNotMatch(sellerRefresh, new RegExp(forbidden.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));

  assert.match(sellerRefresh, /api\.list\('orders', \{ seller_id: userId/);
  assert.match(sellerRefresh, /api\.listSellerPrices\(userId\)/);

  for (const required of [
    'api.listSellerProducts', 'api.listSellerStock', "api.list('seller_settings'",
    'api.registerSellerDailyLogin', "api.list('seller_account_entries'",
    "api.list('seller_payments'", "api.list('seller_payment_allocations'",
    'api.listSellerOrderAccounts',
  ]) assert.ok(sellerRefresh.includes(required), `consulta obrigatória ausente: ${required}`);
});

test('painel do vendedor limita escrita a senha própria, alinhamento e pagamento informado', () => {
  const ledger = read('src/sellerLedger.js');
  assert.match(ledger, /data-balance-alignment-form/);
  assert.match(ledger, /data-change-password-form/);
  assert.match(ledger, /data-seller-payment-report-form/);
  assert.match(ledger, /alignOwnSellerBalance/);
  assert.match(ledger, /changeOwnPassword/);
  assert.doesNotMatch(ledger, /data-payment-form|data-stock-adjustment-form/i);
});

test('trava de catálogo do vendedor é aplicada no banco, não só na tela', () => {
  const sql = read('supabase/migrations/20260801143000_seller_cart_requests.sql');

  // 1. A marca existe no produto e nasce fechada — base sem a coluna não pode
  //    liberar o catálogo inteiro por omissão.
  assert.match(sql, /add column if not exists orderable_by_sellers boolean not null default false/);

  // 2. O catálogo que o vendedor lê filtra pela marca.
  assert.match(sql, /create policy seller_products_select_seller[\s\S]*?orderable_by_sellers = true/);

  // 3. O trigger de pedido recusa produto não liberado — é a garantia real,
  //    válida mesmo que alguém chame a API por fora do app.
  assert.match(sql, /não está liberado para pedido de vendedor/);

  // 4. O vendedor só insere pedido pendente, nunca aprova o próprio.
  assert.match(sql, /create policy orders_insert_seller[\s\S]*?approval_status = 'pendente_aprovacao'/);
  assert.doesNotMatch(sql, /create policy orders_update_seller/);

  // 5. O piso de preço continua checado, com o preço individual do vendedor
  //    tendo precedência sobre o do produto.
  assert.match(sql, /coalesce\(sp\.floor, p\.price_floor\)/);
});

test('migração antiga continua bloqueando operações gerais do vendedor', () => {
  const sql = read('supabase/migrations/0023_seller_read_only.sql');
  for (const required of [
    'drop policy if exists sales_insert_seller',
    'drop policy if exists orders_insert_seller',
    'drop policy if exists sale_carts_insert_seller',
    'drop policy if exists operational_movements_insert_seller',
    'revoke execute on function public.consume_seller_stock',
    'revoke execute on function public.seller_adjust_own_stock',
  ]) assert.ok(sql.includes(required), `proteção ausente: ${required}`);
});