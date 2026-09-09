'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(storage = new Map(), add) {
  const state = { activeBusinessId: 'business-1', products: Array.from({length: 24}, (_, i) => ({id: `p${i}`, name: i === 23 ? 'Essência especial' : `Produto ${i}`, type: 'mercadoria', defaultPrice: 10, currentStock: 100, unit: 'un'})), profiles: [], orders: [], settings: {channels: ['WhatsApp'], orderStatuses: []} };
  let account = {id: 'admin-1', role: 'admin'};
  let refreshes = 0;
  const writes = [];
  const context = vm.createContext({window: {sessionStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v)}}, console, URL, crypto: {randomUUID: () => 'group'}, confirm: () => true});
  for (const file of ['utils', 'calculations', 'ui']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/${file}.js`), 'utf8'), context);
  const c = context.window.C360;
  c.state = { getState: () => state, getCurrentUser: () => account, isAdmin: () => account.role === 'admin', refresh: async () => { refreshes++; }, add: async (table, payload) => { writes.push({table, payload}); if (add) await add(); return {id: 'saved', ...payload}; } };
  c.ui.markKanbanOverflow = () => {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/salesCart.js'), 'utf8'), context);
  function mount() {
    const events = {};
    const grid = {innerHTML: ''};
    const el = {innerHTML: '', querySelector: s => s === '[data-cart-products]' ? grid : null, querySelectorAll: () => [], addEventListener: (name, fn) => events[name] = fn};
    let done = 0;
    c.salesCart.mount(el, {onDone: () => {done++;}});
    const dispatch = (name, selector, props = {}) => events[name]({target: {closest: s => s === selector ? props : null}, preventDefault() {}});
    return {el, grid, dispatch, done: () => done, click: (action, extras = {}) => dispatch('click', '[data-cart-action]', {dataset: {cartAction: action, ...extras}})};
  }
  return {mount, storage, writes, state, account: id => account = {id, role: 'admin'}, refreshes: () => refreshes};
}

test('catálogo inclui produtos após o 18º e busca ignora acentos', async () => {
  const app = setup(); const ui = app.mount();
  assert.match(ui.el.innerHTML, /data-product-id="p23"/);
  await ui.dispatch('input', '[data-cart-search]', {value: 'ESSENCIA'});
  assert.match(ui.grid.innerHTML, /Essência especial/);
  assert.doesNotMatch(ui.grid.innerHTML, /Produto 0/);
});

test('rascunho sobrevive ao reload e fica separado por conta e negócio', async () => {
  const app = setup(); await app.mount().click('quick-add-product', {productId: 'p23'});
  const reload = setup(app.storage);
  assert.match(reload.mount().el.innerHTML, /data-draft-qty="0"[^>]*value="1"/);
  reload.account('admin-2');
  assert.doesNotMatch(reload.mount().el.innerHTML, /data-draft-qty="0"/);
  reload.account('admin-1'); reload.state.activeBusinessId = 'business-2';
  assert.doesNotMatch(reload.mount().el.innerHTML, /data-draft-qty="0"/);
});

test('quantidade vazia preserva item e erro; preço zero é rejeitado', async () => {
  const app = setup(); const ui = app.mount();
  await ui.click('quick-add-product', {productId: 'p0'});
  await ui.dispatch('change', '[data-draft-qty]', {dataset: {draftQty: '0'}, value: ''});
  assert.match(ui.el.innerHTML, /Informe uma quantidade maior que zero/);
  assert.match(ui.el.innerHTML, /data-draft-qty="0"[^>]*value="1"/);
  await ui.dispatch('change', '[data-draft-price]', {dataset: {draftPrice: '0'}, value: '0'});
  assert.match(ui.el.innerHTML, /Preço unitário precisa ser maior que zero/);
  assert.equal(ui.done(), 0);
});

test('envio repetido é bloqueado e sucesso limpa rascunho', async () => {
  let release;
  const wait = new Promise(resolve => release = resolve);
  const app = setup(new Map(), () => wait); const ui = app.mount();
  await ui.click('quick-add-product', {productId: 'p0'});
  const first = ui.click('launch');
  assert.match(ui.el.innerHTML, /Enviando/);
  await ui.click('launch');
  assert.equal(app.writes.length, 1);
  release(); await first;
  assert.match(ui.el.innerHTML, /Pedido lancado/);
  assert.doesNotMatch(ui.el.innerHTML, /data-draft-qty="0"/);
  assert.equal(app.refreshes(), 1);
});

test('falha de envio mantém itens e mensagem sem remontar o painel', async () => {
  const app = setup(new Map(), async () => {throw new Error('Falha de conexão');}); const ui = app.mount();
  await ui.click('quick-add-product', {productId: 'p0'});
  await ui.click('launch');
  assert.match(ui.el.innerHTML, /Falha de conexão/);
  assert.match(ui.el.innerHTML, /data-draft-qty="0"/);
  assert.equal(ui.done(), 0);
});

test('carrinho vazio e produto removido não fazem gravações', async () => {
  const app = setup(); const ui = app.mount();
  await ui.click('share-cart');
  assert.equal(app.writes.length, 0);
  await ui.click('quick-add-product', {productId: 'p0'});
  app.state.products = [];
  await ui.click('launch');
  assert.equal(app.writes.length, 0);
  assert.match(ui.el.innerHTML, /não está mais disponível/);
});

test('pagamento parcial acima do total é rejeitado antes de gravar', async () => {
  const storage = new Map([['c360:cart:admin-1:business-1', JSON.stringify({mode: 'revenda', paymentMode: 'parcial', targetSellerId: 'seller-1', paidInitialAmount: '11', items: [{productId: 'p0', quantity: 1, unitPrice: 10}]})]]);
  const app = setup(storage); const ui = app.mount();
  await ui.click('launch');
  assert.equal(app.writes.length, 0);
  assert.match(ui.el.innerHTML, /valor pago deve ficar entre zero e o total/);
});
