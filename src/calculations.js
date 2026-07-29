(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const { number, money } = window.C360.utils;

  function weightedAverageCost(currentStock, currentAvgCost, incomingQuantity, incomingTotalCost) {
    const stock = number(currentStock);
    const avg = number(currentAvgCost);
    const qty = number(incomingQuantity);
    const total = number(incomingTotalCost);
    const currentValue = Math.max(stock, 0) * avg;
    const newQuantity = Math.max(stock, 0) + qty;
    if (newQuantity <= 0) return 0;
    return (currentValue + total) / newQuantity;
  }

  function calculateRecipeCost(finalProductId, state) {
    const finalProduct = state.products.find((product) => product.id === finalProductId);
    const rows = state.recipes.filter((row) => row.finalProductId === finalProductId);

    const items = rows.map((row) => {
      const input = state.products.find((product) => product.id === row.inputProductId);
      const quantityPerUnit = number(row.quantityPerUnit);
      const avgCost = input ? number(input.avgCost) : 0;
      return {
        ...row,
        input,
        quantityPerUnit,
        avgCost,
        costPerUnit: quantityPerUnit * avgCost,
      };
    });

    const materialsCost = items.reduce((sum, item) => sum + item.costPerUnit, 0);
    const laborCost = number(finalProduct?.laborCostPerUnit);
    const overheadCost = number(finalProduct?.overheadCostPerUnit);
    const baseCost = materialsCost + laborCost + overheadCost;
    const lossPercent = number(finalProduct?.lossPercent) / 100;
    const lossCost = baseCost * Math.max(lossPercent, 0);
    const totalCostPerUnit = baseCost + lossCost;
    const targetMarginPercent = number(finalProduct?.targetMarginPercent) / 100;
    const taxFeePercent = number(finalProduct?.taxFeePercent) / 100;
    const denominator = 1 - targetMarginPercent - taxFeePercent;
    const suggestedSalePrice = denominator > 0.02 ? totalCostPerUnit / denominator : 0;
    const manualSalePrice = number(finalProduct?.salePrice);
    const selectedSalePrice = manualSalePrice > 0 ? manualSalePrice : suggestedSalePrice;
    const grossProfitAtSelectedPrice = selectedSalePrice - (selectedSalePrice * taxFeePercent) - totalCostPerUnit;
    const marginAtSelectedPrice = selectedSalePrice > 0 ? grossProfitAtSelectedPrice / selectedSalePrice : 0;

    return {
      finalProduct,
      items,
      materialsCost,
      laborCost,
      overheadCost,
      baseCost,
      lossCost,
      totalCostPerUnit,
      targetMarginPercent,
      taxFeePercent,
      suggestedSalePrice,
      manualSalePrice,
      selectedSalePrice,
      grossProfitAtSelectedPrice,
      marginAtSelectedPrice,
    };
  }

  function saleMath({ quantity, unitPrice, discount, fixedFees, feePercent, unitCost }) {
    const qty = number(quantity);
    const price = number(unitPrice);
    const grossRevenue = qty * price;
    const percentFees = grossRevenue * (number(feePercent) / 100);
    const netRevenue = grossRevenue - number(discount) - number(fixedFees) - percentFees;
    const cogs = qty * number(unitCost);
    const grossProfit = netRevenue - cogs;
    const margin = netRevenue > 0 ? grossProfit / netRevenue : 0;
    return { grossRevenue, percentFees, netRevenue, cogs, grossProfit, margin };
  }

  // Saldo do vendedor com o admin (Fase 3 — ledger dedicado, ver
  // docs/replication-v1/04-fase3-ledger-vendedor.md): sempre a soma dos
  // lançamentos, nunca um número sobrescrito. Positivo = vendedor deve.
  function sellerBalance(entries) {
    return (entries || []).reduce((sum, entry) => {
      const amount = number(entry.amount);
      return entry.direction === 'credit' ? sum - amount : sum + amount;
    }, 0);
  }

  function consignmentOpenAmount(consignment) {
    const soldValue = number(consignment.quantitySold) * number(consignment.unitPrice);
    return Math.max(soldValue - number(consignment.amountPaid), 0);
  }

  function consignmentAvailableWithClient(consignment) {
    return number(consignment.quantitySent) - number(consignment.quantitySold) - number(consignment.quantityReturned);
  }

  // Valor da mercadoria que saiu do estoque e ainda está na mão do vendedor/
  // cliente, ao preço combinado. Diferente de consignmentOpenAmount, que só
  // conta o que já foi VENDIDO e não pago: enquanto ninguém informa venda,
  // aquele valor é zero, e era por isso que um consignado recém-lançado
  // aparecia como R$ 0,00 no painel mesmo tendo sido registrado direitinho.
  function consignmentDeliveredAmount(consignment) {
    return Math.max(consignmentAvailableWithClient(consignment), 0) * number(consignment.unitPrice);
  }

  // Tudo que ainda não foi acertado nesta consignação: mercadoria parada com
  // quem recebeu + o que ele já vendeu e ainda não repassou. A soma não muda
  // quando uma venda é informada (o valor só troca de coluna) e só cai quando
  // o dinheiro entra ou a mercadoria volta.
  function consignmentUnsettledAmount(consignment) {
    return consignmentDeliveredAmount(consignment) + consignmentOpenAmount(consignment);
  }

  // Dinheiro que entrou num dia específico. Três origens distintas, somadas
  // mas nunca fundidas na tela — cada uma responde uma pergunta diferente:
  //
  // - vendedores: pagamento de vendedor quitando dívida (`seller_payments`,
  //   gravado pelo RPC register_seller_payment com a data do recebimento);
  // - clientes:   pagamento de consignação de cliente (`consignmentEvents`
  //   tipo 'pagamento', gravado por consignmentPay em src/app.js);
  // - vendas:     venda direta do dia, que é dinheiro na hora.
  //
  // Venda de consignado (origin 'consignado') fica DE FORA de propósito:
  // informar que o cliente vendeu não é receber — o dinheiro entra depois,
  // como pagamento, e seria contado duas vezes. Venda com sellerId também
  // fica fora: o dinheiro ficou com o vendedor, e vira dívida dele no ledger
  // (mesma regra do trigger create_sale_receivable, docs/backend.md).
  function dailyReceipts(state, date) {
    const businessId = state.activeBusinessId;
    const day = String(date || '').slice(0, 10);
    const empty = { total: 0, count: 0 };
    if (!businessId || !day) {
      return { sellers: empty, clients: empty, sales: empty, total: 0, count: 0 };
    }

    const sameBusiness = (row) => row.businessId === businessId;
    const sum = (rows, key) => rows.reduce((acc, row) => acc + number(row[key]), 0);

    const sellerRows = (state.sellerPayments || [])
      .filter((row) => sameBusiness(row) && String(row.paymentDate || '').slice(0, 10) === day);
    const sellerInitialRows = (state.sellerOrderAccounts || [])
      .filter((row) => String(row.createdAt || '').slice(0, 10) === day && number(row.initialPaid) > 0);
    const clientRows = (state.consignmentEvents || [])
      .filter((row) => sameBusiness(row) && row.type === 'pagamento' && String(row.date || '').slice(0, 10) === day);
    const saleRows = (state.sales || [])
      .filter((row) => sameBusiness(row) && String(row.date || '').slice(0, 10) === day
        && row.origin !== 'consignado' && !row.sellerId);

    const sellers = {
      total: sum(sellerRows, 'amount') + sum(sellerInitialRows, 'initialPaid'),
      count: sellerRows.length + sellerInitialRows.length,
    };
    const clients = { total: sum(clientRows, 'amount'), count: clientRows.length };
    const sales = { total: sum(saleRows, 'netRevenue'), count: saleRows.length };

    return {
      sellers,
      clients,
      sales,
      total: sellers.total + clients.total + sales.total,
      count: sellers.count + clients.count + sales.count,
    };
  }

  // Receita reconhecida pelo caixa: consignado informado como vendido continua
  // fora até o pagamento. Vendas à vista entram na data da venda; consignados
  // com clientes e vendedores entram na data do recebimento.
  function recognizedRevenue(state, { dateFrom = '', dateTo = '' } = {}) {
    const businessId = state.activeBusinessId;
    const inPeriod = (date) => {
      const day = String(date || '').slice(0, 10);
      return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
    };
    const sameBusiness = (row) => row.businessId === businessId;
    const directSales = (state.sales || []).filter((sale) => sameBusiness(sale)
      && inPeriod(sale.date) && sale.origin !== 'consignado' && !sale.sellerId);
    const clientPayments = (state.consignmentEvents || []).filter((event) => sameBusiness(event)
      && event.type === 'pagamento' && inPeriod(event.date));
    const sellerPayments = (state.sellerPayments || []).filter((payment) => sameBusiness(payment)
      && inPeriod(payment.paymentDate));

    const direct = directSales.reduce((result, sale) => ({
      total: result.total + number(sale.netRevenue),
      profit: result.profit + number(sale.grossProfit),
      count: result.count + 1,
    }), { total: 0, profit: 0, count: 0 });

    const clients = clientPayments.reduce((result, event) => {
      const consignment = (state.consignments || []).find((item) => String(item.id) === String(event.consignmentId));
      const unitPrice = number(consignment?.unitPrice);
      const unitCost = number(consignment?.costAtSend);
      const margin = unitPrice > 0 ? (unitPrice - unitCost) / unitPrice : 0;
      return {
        total: result.total + number(event.amount),
        profit: result.profit + number(event.amount) * margin,
        count: result.count + 1,
      };
    }, { total: 0, profit: 0, count: 0 });

    const orders = state.orders || [];
    const consignments = state.consignments || [];
    const allocations = state.sellerPaymentAllocations || [];
    const sellers = sellerPayments.reduce((result, payment) => {
      const paymentAllocations = allocations.filter((allocation) => String(allocation.paymentId) === String(payment.id));
      const allocatedProfit = paymentAllocations.reduce((profit, allocation) => {
        const groupOrders = orders.filter((order) => String(order.orderGroupId || order.id) === String(allocation.orderGroupId));
        const groupRevenue = groupOrders.reduce((sum, order) => sum + number(order.quantity) * number(order.unitPrice), 0);
        const groupCost = groupOrders.reduce((sum, order) => {
          const consignment = consignments.find((item) => String(item.id) === String(order.convertedConsignmentId));
          return sum + number(order.quantity) * number(consignment?.costAtSend);
        }, 0);
        const margin = groupRevenue > 0 ? (groupRevenue - groupCost) / groupRevenue : 0;
        return profit + number(allocation.amount) * margin;
      }, 0);
      return {
        total: result.total + number(payment.amount),
        profit: result.profit + allocatedProfit,
        count: result.count + 1,
      };
    }, { total: 0, profit: 0, count: 0 });

    (state.sellerOrderAccounts || [])
      .filter((account) => inPeriod(account.createdAt) && number(account.initialPaid) > 0)
      .forEach((account) => {
        const groupOrders = orders.filter((order) => String(order.orderGroupId || order.id) === String(account.orderGroupId));
        const groupRevenue = groupOrders.reduce((sum, order) => sum + number(order.quantity) * number(order.unitPrice), 0);
        const groupCost = groupOrders.reduce((sum, order) => {
          const consignment = consignments.find((item) => String(item.id) === String(order.convertedConsignmentId));
          return sum + number(order.quantity) * number(consignment?.costAtSend);
        }, 0);
        const margin = groupRevenue > 0 ? (groupRevenue - groupCost) / groupRevenue : 0;
        sellers.total += number(account.initialPaid);
        sellers.profit += number(account.initialPaid) * margin;
        sellers.count += 1;
      });

    return {
      direct,
      clients,
      sellers,
      total: direct.total + clients.total + sellers.total,
      grossProfit: direct.profit + clients.profit + sellers.profit,
      count: direct.count + clients.count + sellers.count,
    };
  }

  function creditSalesPosition(state) {
    const businessId = state.activeBusinessId;
    const clientRows = (state.consignments || []).filter((item) => item.businessId === businessId && !item.sellerId);
    const clients = {
      inHands: clientRows.reduce((sum, item) => sum + consignmentDeliveredAmount(item), 0),
      soldUnpaid: clientRows.reduce((sum, item) => sum + consignmentOpenAmount(item), 0),
      count: clientRows.filter((item) => consignmentUnsettledAmount(item) > 0.005).length,
    };
    clients.total = clients.inHands + clients.soldUnpaid;
    const sellerAccounts = state.sellerOrderAccounts || [];
    const sellers = {
      total: sellerAccounts.reduce((sum, account) => sum + number(account.openAmount), 0),
      count: sellerAccounts.filter((account) => number(account.openAmount) > 0.005).length,
    };
    return { clients, sellers, total: clients.total + sellers.total };
  }

  function businessMetrics(state) {
    const businessId = state.activeBusinessId;
    if (!businessId) {
      return {
        stockValue: 0,
        lowStockCount: 0,
        netRevenue: 0,
        grossProfit: 0,
        recognizedRevenueCount: 0,
        consignmentsOpen: 0,
        consignmentsSoldUnpaid: 0,
        consignmentsWithSellers: 0,
        pendingOrders: 0,
      };
    }

    const products = state.products.filter((product) => product.businessId === businessId);
    const consignments = state.consignments.filter((item) => item.businessId === businessId);
    const orders = state.orders.filter((order) => order.businessId === businessId);

    // Consignado em aberto tem DUAS fontes de verdade diferentes, e misturá-las
    // dá número errado:
    //
    // - Consignado com CLIENTE (sem vendedor): o acerto acontece na própria
    //   linha de `consignments` — "Registrar venda"/"Devolver"/"Registrar
    //   pagamento" mexem em quantitySold/quantityReturned/amountPaid. Aqui a
    //   linha é a fonte.
    // - Consignado com VENDEDOR: o acerto acontece no ledger
    //   (`seller_account_entries`). O pagamento do vendedor grava um crédito
    //   ali e NUNCA toca `consignments.amount_paid`. Somar a linha faria o
    //   valor ficar preso para sempre, mesmo depois de o vendedor pagar tudo.
    //
    // Por isso o lado do vendedor entra pelo saldo do ledger, que já nasce no
    // envio (débito lançado na aprovação) e cai sozinho a cada pagamento.
    const clientConsignments = consignments.filter((item) => !item.sellerId);
    const sellerEntries = (state.sellerAccountEntries || []).filter((entry) => entry.businessId === businessId);
    // Clampar por vendedor, não no total: quem pagou a mais fica com saldo
    // negativo (crédito), e somar tudo antes do Math.max fazia esse crédito
    // abater a dívida de OUTRO vendedor — o painel mostrava menos a receber
    // do que o admin realmente tem para receber.
    const balanceBySeller = new Map();
    sellerEntries.forEach((entry) => {
      const key = String(entry.sellerId);
      balanceBySeller.set(key, (balanceBySeller.get(key) || []).concat(entry));
    });
    let sellerOwed = 0;
    balanceBySeller.forEach((entries) => { sellerOwed += Math.max(sellerBalance(entries), 0); });

    const revenue = recognizedRevenue(state, {
      dateFrom: state.revenueDateFrom || '',
      dateTo: state.revenueDateTo || '',
    });

    return {
      stockValue: products.reduce((sum, product) => sum + number(product.currentStock) * number(product.avgCost), 0),
      lowStockCount: products.filter((product) => number(product.minStock) > 0 && number(product.currentStock) <= number(product.minStock)).length,
      netRevenue: revenue.total,
      grossProfit: revenue.grossProfit,
      recognizedRevenueCount: revenue.count,
      consignmentsOpen: clientConsignments.reduce((sum, item) => sum + consignmentUnsettledAmount(item), 0) + sellerOwed,
      consignmentsSoldUnpaid: clientConsignments.reduce((sum, item) => sum + consignmentOpenAmount(item), 0),
      consignmentsWithSellers: sellerOwed,
      // Pedido rejeitado não é pendência: some da esteira (renderBoard já o
      // filtra), mas continuava inflando este contador — o painel dizia que
      // havia pedidos a despachar que não existiam em tela nenhuma.
      pendingOrders: orders.filter((order) => !['despachado', 'concluido'].includes(order.status)
        && order.approvalStatus !== 'rejeitado').length,
    };
  }

  // Resolve o preço sugerido e o piso efetivo para um vendedor + produto,
  // espelhando exatamente a prioridade usada pelo trigger de piso de preço
  // no banco (docs/backend.md §7, passos 1-3):
  //   preço: seller_prices.price (se > 0) -> product.salePrice (se > 0) -> product.defaultPrice -> 0
  //   piso:  seller_prices.floor (se não for null/undefined) -> product.priceFloor -> null (sem piso)
  function resolveSellerPrice({ product, sellerPrice } = {}) {
    const sellerOverridePrice = number(sellerPrice?.price);
    const productSalePrice = number(product?.salePrice);
    const price = sellerOverridePrice > 0
      ? sellerOverridePrice
      : (productSalePrice > 0 ? productSalePrice : number(product?.defaultPrice));

    const sellerFloorDefined = sellerPrice != null && sellerPrice.floor !== null && sellerPrice.floor !== undefined;
    const productFloorDefined = product != null && product.priceFloor !== null && product.priceFloor !== undefined;
    const floor = sellerFloorDefined
      ? number(sellerPrice.floor)
      : (productFloorDefined ? number(product.priceFloor) : null);

    return { price, floor };
  }

  // Valida um preço unitário contra o piso efetivo. `floor` nulo/undefined
  // significa "sem piso" (sempre válido) — mesma regra do trigger de banco.
  function validatePriceFloor({ unitPrice, floor } = {}) {
    if (floor === null || floor === undefined) return { ok: true, message: null };
    const price = number(unitPrice);
    const floorValue = number(floor);
    if (price < floorValue) {
      return { ok: false, message: `Preço mínimo para este produto: ${money(floorValue)}` };
    }
    return { ok: true, message: null };
  }

  window.C360.calc = {
    weightedAverageCost,
    calculateRecipeCost,
    saleMath,
    sellerBalance,
    consignmentOpenAmount,
    consignmentDeliveredAmount,
    consignmentUnsettledAmount,
    consignmentAvailableWithClient,
    dailyReceipts,
    recognizedRevenue,
    creditSalesPosition,
    businessMetrics,
    resolveSellerPrice,
    validatePriceFloor,
  };
})();
