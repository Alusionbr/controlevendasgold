'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('vendedor possui somente a tela Minha conta', () => {
  const app = read('src/app.js');
  const roles = app.match(/const TAB_ROLES = \{([\s\S]*?)\n  \};/);
  assert.ok(roles, 'TAB_ROLES não encontrado');
  const sellerTabs = [...roles[1].matchAll(/^\s*(\w+):\s*\[[^\]]*'vendedor'[^\]]*\]/gm)].map((match) => match[1]);
  assert.deepEqual(sellerTabs, ['meusaldo']);
  assert.match(app, /vendedor:\s*\['meusaldo'\]/);
  assert.doesNotMatch(app, /mountGrantStock\(document\.getElementById\('grantStockPanel'\)\)/);
});

test('carregamento do vendedor busca somente dados próprios e registra o login diário controlado', () => {
  const state = read('src/state.js');
  const start = state.indexOf('async function refreshAsSeller');
  const end = state.indexOf('async function refresh()', start);
  assert.ok(start >= 0 && end > start, 'refreshAsSeller não encontrado');
  const sellerRefresh = state.slice(start, end);

  for (const forbidden of [
    "api.list('clients'", "api.list('sales'", "api.list('orders'",
    "api.list('consignments'", 'api.listSaleCarts', 'api.listSaleCartItems',
    'api.listSellerPrices', 'api.listSalesGoals', 'api.listGoalsProgress',
    "api.list('operational_movements'",
  ]) assert.doesNotMatch(sellerRefresh, new RegExp(forbidden.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));

  for (const required of [
    'api.listSellerProducts', 'api.listSellerStock', "api.list('seller_settings'",
    'api.registerSellerDailyLogin', "api.list('seller_account_entries'",
    "api.list('seller_payments'", "api.list('seller_payment_allocations'",
    'api.listSellerOrderAccounts',
  ]) assert.ok(sellerRefresh.includes(required), `consulta obrigatória ausente: ${required}`);
});

test('painel do vendedor limita escrita a senha própria e alinhamento autorizado', () => {
  const ledger = read('src/sellerLedger.js');
  assert.match(ledger, /data-balance-alignment-form/);
  assert.match(ledger, /data-change-password-form/);
  assert.match(ledger, /alignOwnSellerBalance/);
  assert.match(ledger, /changeOwnPassword/);
  assert.doesNotMatch(ledger, /data-payment-form|data-stock-adjustment-form/i);
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