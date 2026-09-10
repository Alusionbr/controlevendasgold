const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCalculations() {
  const context = { window: { C360: { utils: {
    number: (value) => Number(value) || 0,
    money: (value) => String(value),
  } } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'calculations.js'), 'utf8'), context);
  return context.window.C360.calc;
}

test('consignado só vira receita quando o pagamento é registrado', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1',
    sales: [
      { id: 'vista', businessId: 'b1', date: '2026-07-10', netRevenue: 100, grossProfit: 40 },
      { id: 'prazo', businessId: 'b1', date: '2026-07-10', origin: 'consignado', netRevenue: 200, grossProfit: 80 },
    ],
    consignments: [
      { id: 'c1', businessId: 'b1', quantitySent: 10, quantitySold: 5, quantityReturned: 0, unitPrice: 10, costAtSend: 6, amountPaid: 50 },
      { id: 'sc1', businessId: 'b1', sellerId: 's1', unitPrice: 20, costAtSend: 12 },
    ],
    consignmentEvents: [
      { id: 'ce1', businessId: 'b1', consignmentId: 'c1', type: 'pagamento', date: '2026-07-11', amount: 50 },
    ],
    sellerPayments: [
      { id: 'sp1', businessId: 'b1', sellerId: 's1', paymentDate: '2026-07-12', amount: 100 },
    ],
    sellerPaymentAllocations: [
      { paymentId: 'sp1', orderGroupId: 'g1', amount: 100 },
    ],
    orders: [
      { id: 'o1', businessId: 'b1', orderGroupId: 'g1', quantity: 10, unitPrice: 20, convertedConsignmentId: 'sc1' },
    ],
  };

  const revenue = calc.recognizedRevenue(state);
  assert.equal(revenue.direct.total, 100);
  assert.equal(revenue.clients.total, 50);
  assert.equal(revenue.sellers.total, 100);
  assert.equal(revenue.total, 250);
  assert.equal(revenue.grossProfit, 100);
  assert.equal(revenue.count, 3);
});

test('saídas a prazo ficam separadas entre clientes e vendedores', () => {
  const calc = loadCalculations();
  const position = calc.creditSalesPosition({
    activeBusinessId: 'b1',
    consignments: [
      { businessId: 'b1', quantitySent: 10, quantitySold: 4, quantityReturned: 1, unitPrice: 10, amountPaid: 10 },
    ],
    sellerOrderAccounts: [{ openAmount: 70 }],
  });

  assert.equal(position.clients.inHands, 50);
  assert.equal(position.clients.soldUnpaid, 30);
  assert.equal(position.clients.total, 80);
  assert.equal(position.sellers.total, 70);
  assert.equal(position.total, 150);
});

test('interface separa receita recebida do que saiu a prazo', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /Receita recebida hoje/);
  assert.match(app, /Origem da receita recebida/);
  assert.match(app, /Vendido a prazo/);
  assert.match(app, /Saídas a prazo para vendedores/);
  assert.match(app, /sale\.origin !== 'consignado' && !sale\.sellerId/);
});
// Regressão: o RPC de despacho (advance_order_group) grava um
// consignment_events tipo 'pagamento' com o valor pago na entrada do pedido de
// revenda — e o MESMO valor já é contado pelo lado do vendedor
// (sellerOrderAccounts.initialPaid). Sem excluir o evento da consignação de
// vendedor, a entrada era somada duas vezes na receita recebida.
test('entrada de pedido de revenda não é contada duas vezes', () => {
  const calc = loadCalculations();
  const state = {
    activeBusinessId: 'b1',
    sales: [],
    consignments: [
      { id: 'cli1', businessId: 'b1', unitPrice: 10, costAtSend: 6 },
      { id: 'vend1', businessId: 'b1', sellerId: 's1', unitPrice: 20, costAtSend: 12 },
    ],
    consignmentEvents: [
      // cliente pagando consignação: entra na receita
      { id: 'ce1', businessId: 'b1', consignmentId: 'cli1', type: 'pagamento', date: '2026-08-01', amount: 40 },
      // entrada do pedido de revenda, gravada pelo despacho: NÃO entra aqui
      { id: 'ce2', businessId: 'b1', consignmentId: 'vend1', type: 'pagamento', date: '2026-08-01', amount: 300 },
    ],
    sellerPayments: [],
    sellerPaymentAllocations: [],
    orders: [],
    sellerOrderAccounts: [
      { orderGroupId: 'g1', sellerId: 's1', createdAt: '2026-08-01T10:00:00Z', initialPaid: 300, openAmount: 0 },
    ],
  };

  const revenue = calc.recognizedRevenue(state);
  assert.equal(revenue.clients.total, 40, 'só o pagamento do cliente entra como consignado de cliente');
  assert.equal(revenue.sellers.total, 300, 'a entrada do pedido entra uma vez, pelo lado do vendedor');
  assert.equal(revenue.total, 340, 'total sem duplicar a entrada de R$ 300');

  const receipts = calc.dailyReceipts(state, '2026-08-01');
  assert.equal(receipts.clients.total, 40);
  assert.equal(receipts.sellers.total, 300);
  assert.equal(receipts.total, 340, 'recebimentos do dia também não duplicam');
});
