'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCalculations() {
  const context = { window: { C360: { utils: {
    number: (value) => Number(value) || 0,
    money: (value) => String(value),
  } } } };
  vm.createContext(context);
  vm.runInContext(read('src/calculations.js'), context, { filename: 'src/calculations.js' });
  return context.window.C360.calc;
}

function baseState(overrides = {}) {
  return {
    activeBusinessId: 'b1',
    products: [], financialEntries: [], financialEntryPayments: [], sales: [],
    consignments: [], consignmentEvents: [], sellerPayments: [], sellerOrderAccounts: [],
    sellerPaymentAllocations: [], sellerPaymentReports: [], sellerAccountEntries: [],
    orders: [], operationalMovements: [], tasks: [],
    ...overrides,
  };
}

test('KPIs financeiros usam títulos reais e lucro reconhecido pelo ledger', () => {
  const calc = loadCalculations();
  const state = baseState({
    sales: [{ id: 's1', businessId: 'b1', date: '2026-09-01', netRevenue: 100, grossProfit: 40 }],
    financialEntries: [
      { id: 'r1', businessId: 'b1', direction: 'receivable', sourceType: 'sale', sourceId: 's1', amount: 100, paidAmount: 25, status: 'partial', dueDate: '2026-09-30' },
      { id: 'p1', businessId: 'b1', direction: 'payable', amount: 80, paidAmount: 20, status: 'partial', dueDate: '2026-09-20' },
      { id: 'settled-stale-status', businessId: 'b1', direction: 'receivable', amount: 50, paidAmount: 50, status: 'open', dueDate: '2026-09-01' },
      { id: 'foreign', businessId: 'b2', direction: 'receivable', amount: 999, paidAmount: 0, status: 'open' },
    ],
    financialEntryPayments: [
      { businessId: 'b1', financialEntryId: 'r1', eventType: 'payment', amount: 25, paymentDate: '2026-09-10' },
    ],
  });
  const model = calc.dashboardCockpit(state, { today: '2026-09-14', dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.equal(model.financial.availableBalance, null);
  assert.equal(model.financial.receivable, 75);
  assert.equal(model.financial.payable, 60);
  assert.equal(model.financial.recognizedProfit, 10);
  assert.ok(model.priorities.every((item) => item.id !== 'overdue-receivables'));
});

test('alertas financeiros carregam a direção correta do Financeiro', () => {
  const calc = loadCalculations();
  const model = calc.dashboardCockpit(baseState({ financialEntries: [
    { id: 'r1', businessId: 'b1', direction: 'receivable', amount: 20, paidAmount: 0, status: 'open', dueDate: '2026-09-01' },
    { id: 'p1', businessId: 'b1', direction: 'payable', amount: 30, paidAmount: 0, status: 'open', dueDate: '2026-09-02' },
  ] }), { today: '2026-09-14' });
  const byId = new Map(model.priorities.concat(model.otherAlerts).map((item) => [item.id, item]));
  assert.equal(byId.get('overdue-receivables').financeDirection, 'receivable');
  assert.equal(byId.get('overdue-payables').financeDirection, 'payable');
  assert.match(read('src/app.js'), /trigger\.dataset\.financeFilter\) financeDirection = trigger\.dataset\.financeFilter/);
});

test('prioridades são exatamente três e seguem a ordem de urgência documentada', () => {
  const calc = loadCalculations();
  const state = baseState({
    products: [
      { id: 'missing', businessId: 'b1', name: 'Sem custo', type: 'produto_final', currentStock: 4, avgCost: 0, minStock: 0 },
      { id: 'low', businessId: 'b1', name: 'Estoque baixo', type: 'produto_final', currentStock: 1, avgCost: 5, minStock: 2 },
    ],
    financialEntries: [{ id: 'r1', businessId: 'b1', direction: 'receivable', amount: 120, paidAmount: 20, status: 'partial', dueDate: '2026-09-01' }],
    sellerPaymentReports: [{ id: 'report', businessId: 'b1', status: 'pending' }],
  });
  const model = calc.dashboardCockpit(state, { today: '2026-09-14' });
  assert.equal(model.priorities.length, 3);
  assert.deepEqual(Array.from(model.priorities, (item) => item.id), [
    'overdue-receivables', 'missing-cost', 'pending-seller-payments',
  ]);
  assert.equal(model.otherAlerts[0].id, 'low-stock');
  assert.deepEqual(Array.from(model.canWait), []);
  assert.ok(model.priorities.every((item) => item.tab));
});

test('ausência de dados não fabrica trabalho nem valores de saldo', () => {
  const calc = loadCalculations();
  const model = calc.dashboardCockpit(baseState(), { today: '2026-09-14' });
  assert.equal(model.priorities.length, 3);
  assert.ok(model.priorities.every((item) => item.kind === 'clear' && item.count === 0 && item.estimate === '0 min'));
  assert.deepEqual(Array.from(model.canWait), []);
  assert.deepEqual(Array.from(model.otherAlerts), []);
  assert.equal(model.financial.availableBalance, null);
  assert.equal(model.financial.receivable, 0);
  assert.equal(model.financial.payable, 0);
});

test('tarefas preservam created_at, prazo, status e ordenação reais', () => {
  const calc = loadCalculations();
  const state = baseState({ tasks: [
    { id: 'later', businessId: 'b1', title: 'Depois', createdAt: '2026-09-02T09:00:00Z', dueDate: '2026-09-20', status: 'a_fazer' },
    { id: 'first', businessId: 'b1', title: 'Primeiro', createdAt: '2026-09-01T08:00:00Z', dueDate: '2026-09-10', status: 'fazendo' },
    { id: 'done', businessId: 'b1', title: 'Feita', createdAt: '2026-08-01T08:00:00Z', dueDate: '2026-08-02', status: 'feito' },
  ] });
  const model = calc.dashboardCockpit(state, { today: '2026-09-14' });
  assert.deepEqual(Array.from(model.tasks, (task) => task.id), ['first', 'later']);
  assert.equal(model.tasks[0].createdAt, '2026-09-01T08:00:00Z');
  assert.equal(model.tasks[0].dueDate, '2026-09-10');
  assert.equal(model.tasks[0].status, 'fazendo');
  assert.equal(model.canWait[0].id, 'active-tasks');

  const app = read('src/app.js');
  assert.match(app, /Criação:.*cockpitDate\(task\.createdAt, true\)/s);
  assert.match(app, /Prazo:.*cockpitDate\(task\.dueDate\)/s);
  assert.match(app, /task\.priority \?/);
});

test('ações, modo foco e estados honestos permanecem acessíveis', () => {
  const app = read('src/app.js');
  const css = read('styles/main.css');
  for (const tab of ['financeiro', 'produtos', 'clientes', 'devolucoes', 'tarefas']) {
    assert.match(app, new RegExp(`tab: '${tab}'`));
  }
  assert.match(app, /data-dashboard-focus-toggle aria-pressed=/);
  assert.match(app, /dashboardFocusMode = !dashboardFocusMode/);
  assert.match(css, /\.admin-cockpit\.is-focus-mode \.cockpit-secondary \{ display: none; \}/);
  assert.match(app, /Carregando sua operação/);
  assert.match(app, /Não foi possível carregar todos os dados/);
  assert.match(app, /Selecione um negócio para carregar prioridades/);
  assert.match(app, /Não informado[\s\S]*Não há conta caixa\/banco cadastrada/);
  assert.match(app, /toLocaleDateString\('pt-BR', \{ timeZone: 'America\/Sao_Paulo' \}\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => document\.querySelector\('\[data-dashboard-focus-toggle\]'\)\?\.focus\(\)\)/);
});

test('timestamps com offset são convertidos para São Paulo sem alterar datas civis', () => {
  const app = read('src/app.js');
  const start = app.indexOf('function cockpitDate');
  const end = app.indexOf('function cockpitPriorityCopy', start);
  const context = { window: {}, Date, Number };
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}; globalThis.cockpitDate = cockpitDate;`, context);
  assert.equal(context.cockpitDate('2026-09-15T01:30:00+00:00', true), '14/09/2026 22:30');
  assert.equal(context.cockpitDate('2026-09-15', false), '15/09/2026');
});

test('rastreabilidade usa eventos existentes e marca campos ausentes', () => {
  const app = read('src/app.js');
  const start = app.indexOf('function cockpitActivityRows');
  const end = app.indexOf('function renderAdminCockpit', start);
  const activity = app.slice(start, end);
  assert.match(activity, /recordAuditLog/);
  assert.match(activity, /currentMovements\(\)/);
  assert.match(activity, /currentFinancialEntryPayments\(\)/);
  assert.match(activity, /row\.oldValue/);
  assert.match(activity, /row\.newValue/);
  assert.match(activity, /row\.notes \|\| null/);
  assert.match(activity, /'não informado'/);
});

test('cockpit não altera contratos financeiros ou migrations da Etapa 1', () => {
  const app = read('src/app.js');
  const cockpitStart = app.indexOf('function renderAdminCockpit');
  const cockpitEnd = app.indexOf('function renderToday', cockpitStart);
  const cockpit = app.slice(cockpitStart, cockpitEnd);
  assert.doesNotMatch(cockpit, /registerFinancialEntryPayment|registerDirectSale|S\.update|S\.add/);
  assert.match(cockpit, /Calc\.dashboardCockpit/);
});
