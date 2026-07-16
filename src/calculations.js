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

  function businessMetrics(state) {
    const businessId = state.activeBusinessId;
    if (!businessId) {
      return {
        stockValue: 0,
        lowStockCount: 0,
        netRevenue: 0,
        grossProfit: 0,
        consignmentsOpen: 0,
        pendingOrders: 0,
      };
    }

    const products = state.products.filter((product) => product.businessId === businessId);
    const sales = state.sales.filter((sale) => sale.businessId === businessId);
    const consignments = state.consignments.filter((item) => item.businessId === businessId);
    const orders = state.orders.filter((order) => order.businessId === businessId);

    return {
      stockValue: products.reduce((sum, product) => sum + number(product.currentStock) * number(product.avgCost), 0),
      lowStockCount: products.filter((product) => number(product.minStock) > 0 && number(product.currentStock) <= number(product.minStock)).length,
      netRevenue: sales.reduce((sum, sale) => sum + number(sale.netRevenue), 0),
      grossProfit: sales.reduce((sum, sale) => sum + number(sale.grossProfit), 0),
      // "A receber" / "Consignado em aberto" conta SÓ consignação admin->CLIENTE
      // (sem sellerId). A dívida do vendedor — tanto o consignado que o admin
      // manda pro vendedor quanto a venda que o vendedor faz do próprio estoque
      // — vive no ledger (seller_account_entries / "Meu saldo com admin"), não
      // aqui. Senão o mesmo valor apareceria em dois lugares que não se abatem
      // (decisão "um número só" para a dívida do vendedor).
      consignmentsOpen: consignments.filter((item) => !item.sellerId).reduce((sum, item) => sum + consignmentOpenAmount(item), 0),
      pendingOrders: orders.filter((order) => !['despachado', 'concluido'].includes(order.status)).length,
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
    consignmentAvailableWithClient,
    businessMetrics,
    resolveSellerPrice,
    validatePriceFloor,
  };
})();
