(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const Calc = window.C360.calc;

  const CART_STATUS_LABELS = {
    draft: 'Rascunho',
    shared: 'Link enviado',
    submitted: 'Enviado',
    pending_approval: 'Aguardando aprovacao',
    approved: 'Aprovado',
    partially_approved: 'Parcial',
    rejected: 'Rejeitado',
    converted: 'Convertido',
    expired: 'Expirado',
  };

  const PAYMENT_MODE_LABELS = { avista: 'A vista', parcial: 'Parcial', consignado: 'Consignado' };

  // ---------------------------------------------------------------------
  // Rascunho do carrinho vive fora de mount(): app.js recria o container do
  // painel de Vendas a cada renderAll(), e mount() e chamado de novo. Mantendo
  // o objeto no escopo do modulo, os itens ja adicionados sobrevivem aos
  // remounts.
  //
  // draft.mode e o "tipo de venda" escolhido no topo do painel:
  //   admin:    'propria'  (venda minha, cliente final)
  //             'revenda'  (venda ao revendedor: a vista/parcial/consignado)
  //   vendedor: 'own'      (vender o proprio estoque, baixa imediata)
  //             'request'  (pedir estoque ao admin: entra na esteira p/ aprovar)
  // ---------------------------------------------------------------------
  const persistentDraft = {
    mode: '',
    paymentMode: 'avista',
    targetSellerId: '',
    clientId: '',
    channel: 'WhatsApp',
    notes: '',
    paidInitialAmount: '0',
    customerName: '',
    expiresHours: '48',
    items: [],
    lastLink: '',
  };

  // Estado local da esteira: qual grupo esta com o form de edicao aberto.
  const boardState = { editGroupId: '' };

  function api() { return window.C360.api; }
  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }
  function isAdmin() { return S().isAdmin(); }
  function productById(id) { return (state().products || []).find((item) => String(item.id) === String(id)) || null; }
  function clientName(id) {
    const client = (state().clients || []).find((item) => String(item.id) === String(id));
    return client ? client.name : '';
  }
  function sellerName(id) {
    const profile = (state().profiles || []).find((item) => String(item.id) === String(id));
    return profile ? profile.name : 'Vendedor';
  }
  function settingForSeller(id) {
    return (state().sellerSettings || []).find((item) => String(item.sellerId) === String(id)) || {
      allowAdminStockSales: true,
      allowConsignment: false,
      allowPublicCartLinks: true,
      maxDiscountPercent: 0,
      stockAdjustmentCredits: 0,
    };
  }
  function itemsForCart(cartId) {
    return (state().saleCartItems || []).filter((item) => String(item.cartId) === String(cartId));
  }
  function cartTotal(items) {
    return items.reduce((sum, item) => sum + U.number(item.quantity) * U.number(item.unitPrice), 0);
  }

  function publicUrl(cart) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('cart', cart.publicToken);
    return url.toString();
  }

  function sellerPriceForProduct(productId) {
    return (state().sellerPrices || []).find((row) => String(row.productId) === String(productId)) || null;
  }

  function ownStockForProduct(productId) {
    const currentUser = user();
    if (!currentUser) return null;
    return (state().sellerStock || []).find((row) => String(row.sellerId) === String(currentUser.id) && String(row.productId) === String(productId)) || null;
  }

  function resolvedUnitPrice(product) {
    if (!product) return 0;
    const currentUser = user();
    if (currentUser && currentUser.role === 'vendedor' && Calc && typeof Calc.resolveSellerPrice === 'function') {
      return Calc.resolveSellerPrice({ product, sellerPrice: sellerPriceForProduct(product.id) }).price;
    }
    return product.defaultPrice || product.salePrice || 0;
  }

  function validateDraftPrice(productId, unitPrice) {
    const price = U.number(unitPrice);
    if (price <= 0) throw new Error('Preço unitário precisa ser maior que zero.');
    if (isAdmin() || !Calc || typeof Calc.resolveSellerPrice !== 'function' || typeof Calc.validatePriceFloor !== 'function') return;
    const product = productById(productId);
    if (!product) throw new Error('Produto não encontrado.');
    const { floor } = Calc.resolveSellerPrice({ product, sellerPrice: sellerPriceForProduct(productId) });
    const check = Calc.validatePriceFloor({ unitPrice: price, floor });
    if (!check.ok) throw new Error(check.message);
  }

  function validateDraftItems(draft) {
    draft.items.forEach((item) => validateDraftPrice(item.productId, item.unitPrice));
  }

  // Modo escolhido pelo papel -> filtra a lista de produtos disponivel.
  function draftUsesOwnStock(draft) { return draft.mode === 'own'; }

  function productsForDraft(draft) {
    const base = (state().products || []).filter((product) => !['materia_prima', 'embalagem'].includes(product.type));
    if (draftUsesOwnStock(draft)) {
      const ownStockIds = new Set((state().sellerStock || [])
        .filter((row) => String(row.sellerId) === String(user()?.id) && U.number(row.quantity) > 0)
        .map((row) => String(row.productId)));
      return base.filter((product) => ownStockIds.has(String(product.id)));
    }
    return base;
  }

  function productOptions(products) {
    return UI.optionList(products.map((product) => ({
      id: product.id,
      name: `${product.name} - ${U.money(resolvedUnitPrice(product))}`,
    })), '', 'Produto');
  }

  function addDraftItem(draft, { productId, quantity = 1, unitPrice }) {
    const product = productById(productId);
    if (!product) return;
    const qty = U.number(quantity || 1);
    const price = U.number(unitPrice || resolvedUnitPrice(product));
    if (qty <= 0) return;
    const existing = draft.items.find((item) => String(item.productId) === String(productId) && U.number(item.unitPrice) === price);
    if (existing) existing.quantity = U.number(existing.quantity) + qty;
    else draft.items.push({ productId, quantity: qty, unitPrice: price });
  }

  function resetDraft(draft, keepLink = false) {
    draft.items = [];
    if (!keepLink) draft.lastLink = '';
    draft.customerName = '';
    draft.notes = '';
    draft.clientId = '';
    draft.paidInitialAmount = '0';
  }

  function defaultModeForRole() {
    return isAdmin() ? 'propria' : 'own';
  }

  // Modos que geram um pedido na esteira (via orders). 'own' e baixa imediata.
  function isBoardMode(mode) { return mode === 'propria' || mode === 'revenda' || mode === 'request'; }
  function isRevendaMode(mode) { return mode === 'revenda' || mode === 'request'; }

  // =====================================================================
  // Motores de estoque/dinheiro reaproveitados (nao mudam a regra de negocio,
  // so o ponto de disparo). Ver docs/fluxos-operacionais.md Fluxo 15.
  // =====================================================================

  async function addToSellerStock(sellerId, productId, quantity) {
    const current = (state().sellerStock || []).find((row) => String(row.sellerId) === String(sellerId) && String(row.productId) === String(productId));
    const nextQuantity = U.number(current?.quantity) + U.number(quantity);
    if (current) await S().update('sellerStock', current.id, { quantity: nextQuantity });
    else await S().add('sellerStock', { sellerId, productId, quantity: nextQuantity });
  }

  // Transfere estoque central -> estoque do vendedor, criando consignments +
  // stock_movements + seller_stock. Devolve o consignment criado (usado como
  // marcador de "ja materializado" no pedido). amountPaid = fatia ja quitada.
  async function transferAdminStockToSeller({ sellerId, productId, quantity, unitPrice, amountPaid = 0, groupId, note }) {
    const product = productById(productId);
    const qty = U.number(quantity);
    if (!product) throw new Error('Produto nao encontrado no estoque do admin.');
    if (product.type === 'servico') throw new Error('Servico nao pode ser enviado ao revendedor.');
    if (qty <= 0) throw new Error('Quantidade precisa ser maior que zero.');
    if (U.number(product.currentStock) < qty) throw new Error(`${product.name} nao tem estoque suficiente para despachar.`);

    await S().update('products', product.id, { currentStock: U.number(product.currentStock) - qty });
    await S().recordMovement({
      date: U.today(),
      type: 'saida_envio_consignado',
      productId: product.id,
      quantity: -qty,
      unitCost: U.number(product.avgCost),
      totalCost: -(qty * U.number(product.avgCost)),
      notes: note || `Despacho ao vendedor ${sellerName(sellerId)}`,
    });
    await addToSellerStock(sellerId, product.id, qty);
    const paid = U.number(amountPaid);
    const consignment = await S().add('consignments', {
      sellerId,
      clientId: null,
      productId: product.id,
      quantitySent: qty,
      quantitySold: 0,
      quantityReturned: 0,
      unitPrice,
      costAtSend: U.number(product.avgCost),
      amountPaid: paid,
      status: 'com_cliente',
      date: U.today(),
      notes: `Revenda despachada${groupId ? ` (pedido ${groupId})` : ''}`,
    });
    if (consignment && consignment.id) {
      await S().add('consignmentEvents', { consignmentId: consignment.id, type: 'envio', date: U.today(), quantity: qty, amount: 0 });
      if (paid > 0) await S().add('consignmentEvents', { consignmentId: consignment.id, type: 'pagamento', date: U.today(), quantity: 0, amount: paid });
    }
    return consignment;
  }

  function saleMathForCart({ quantity, unitPrice, unitCost }) {
    if (Calc && typeof Calc.saleMath === 'function') {
      return Calc.saleMath({ quantity, unitPrice, discount: 0, fixedFees: 0, feePercent: 0, unitCost });
    }
    const grossRevenue = U.number(quantity) * U.number(unitPrice);
    const cogs = U.number(quantity) * U.number(unitCost);
    const grossProfit = grossRevenue - cogs;
    return { grossRevenue, netRevenue: grossRevenue, percentFees: 0, cogs, grossProfit, margin: grossRevenue > 0 ? grossProfit / grossRevenue : 0 };
  }

  // =====================================================================
  // Carrinho de link publico (recurso avancado, mantido). createCart grava um
  // sale_cart + itens; usado so pelo botao "Gerar link".
  // =====================================================================

  async function createCart(draft, status) {
    const currentUser = user();
    if (!currentUser) throw new Error('Entre na sua conta antes de criar carrinho.');
    const expiresAt = new Date(Date.now() + U.number(draft.expiresHours, 48) * 60 * 60 * 1000).toISOString();
    const finalStatus = status || 'draft';
    const cart = await S().add('saleCarts', {
      sellerId: currentUser.id,
      source: draftUsesOwnStock(draft) ? 'seller_stock' : 'admin_stock',
      paymentMode: 'avista',
      status: 'draft',
      channel: draft.channel || 'WhatsApp',
      customerName: draft.customerName || null,
      publicExpiresAt: null,
      paidInitialAmount: 0,
      notes: draft.notes || '',
    });
    for (const item of draft.items) {
      // eslint-disable-next-line no-await-in-loop
      await S().add('saleCartItems', { cartId: cart.id, productId: item.productId, quantity: U.number(item.quantity), unitPrice: U.number(item.unitPrice) });
    }
    const finalCart = finalStatus === 'draft' ? cart : await S().update('saleCarts', cart.id, {
      status: finalStatus,
      publicExpiresAt: finalStatus === 'shared' ? expiresAt : null,
    });
    await S().refresh();
    return { ...cart, ...finalCart };
  }

  // Venda imediata do estoque proprio do vendedor (produto ja esta na mao):
  // baixa seller_stock e grava a venda + o acerto (consignments) com o admin.
  async function convertOwnStockCart(cart) {
    const items = itemsForCart(cart.id);
    for (const item of items) {
      const product = productById(item.productId);
      const quantity = U.number(item.quantity);
      const unitPrice = U.number(item.unitPrice);
      const unitCost = U.number(product?.avgCost);
      // eslint-disable-next-line no-await-in-loop
      await api().consumeSellerStock({ productId: item.productId, quantity });
      const math = saleMathForCart({ quantity, unitPrice, unitCost });
      // eslint-disable-next-line no-await-in-loop
      const sale = await S().add('sales', {
        date: U.today(),
        channel: cart.channel || 'Meu estoque',
        clientId: cart.clientId || null,
        productId: item.productId,
        quantity,
        unitPrice,
        discount: 0,
        fixedFees: 0,
        feePercent: 0,
        unitCost,
        ...math,
        notes: `Venda do meu estoque${cart.customerName ? ` - ${cart.customerName}` : ''}`,
        origin: 'meu_estoque',
        originId: cart.id,
      });
      // eslint-disable-next-line no-await-in-loop
      const consignment = await S().add('consignments', {
        sellerId: cart.sellerId,
        clientId: cart.clientId || null,
        productId: item.productId,
        quantitySent: quantity,
        quantitySold: quantity,
        quantityReturned: 0,
        unitPrice,
        costAtSend: unitCost,
        amountPaid: 0,
        status: 'com_cliente',
        date: U.today(),
        notes: `Venda do meu estoque ${cart.id}`,
      });
      if (consignment && consignment.id) {
        // eslint-disable-next-line no-await-in-loop
        await S().add('consignmentEvents', { consignmentId: consignment.id, type: 'venda_cliente', date: U.today(), quantity, amount: quantity * unitPrice });
      }
      if (sale && sale.id) { /* venda gravada para painel/metas */ }
    }
    await S().update('saleCarts', cart.id, { status: 'converted' });
    await S().refresh();
  }

  async function sellOwnStockNow(draft) {
    if (!draft.items.length) throw new Error('Adicione pelo menos um produto.');
    validateDraftItems(draft);
    const cart = await createCart({ ...draft }, 'submitted');
    await convertOwnStockCart({ ...cart, clientId: draft.clientId || null, customerName: draft.customerName });
  }

  // =====================================================================
  // Esteira de pedidos (orders): lancamento a partir do carrinho.
  // =====================================================================

  // Valor pago no ato, distribuido por linha: a vista = total; consignado = 0;
  // parcial = o que o usuario informou (proporcional entre as linhas).
  function paidForRow(draft, rowTotal, cartTotalValue) {
    if (!isRevendaMode(draft.mode)) return 0;
    if (draft.paymentMode === 'avista') return rowTotal;
    if (draft.paymentMode === 'consignado') return 0;
    const cartPaid = Math.min(U.number(draft.paidInitialAmount), cartTotalValue);
    return cartTotalValue > 0 ? (rowTotal / cartTotalValue) * cartPaid : 0;
  }

  async function launchOrderFromCart(draft) {
    const currentUser = user();
    if (!currentUser) throw new Error('Entre na sua conta antes de lancar.');
    if (!draft.items.length) throw new Error('Adicione pelo menos um produto.');
    validateDraftItems(draft);
    const revenda = isRevendaMode(draft.mode);
    const asRequest = draft.mode === 'request';
    if (draft.mode === 'revenda' && !draft.targetSellerId) throw new Error('Selecione o vendedor que vai receber.');

    const total = cartTotal(draft.items);
    const groupId = crypto.randomUUID();
    const sellerId = revenda
      ? (asRequest ? currentUser.id : draft.targetSellerId)
      : currentUser.id;
    const approvalStatus = asRequest ? 'pendente_aprovacao' : 'aprovado';

    for (const item of draft.items) {
      const qty = U.number(item.quantity);
      const price = U.number(item.unitPrice);
      const rowTotal = qty * price;
      // eslint-disable-next-line no-await-in-loop
      const order = await S().add('orders', {
        sellerId,
        clientId: revenda ? null : (draft.clientId || null),
        productId: item.productId,
        quantity: qty,
        unitPrice: price,
        dueDate: null,
        status: 'pendente',
        approvalStatus,
        saleType: revenda ? 'revenda' : 'propria',
        paymentMode: revenda ? draft.paymentMode : null,
        paidAmount: paidForRow(draft, rowTotal, total),
        orderGroupId: groupId,
        notes: draft.notes || (draft.customerName || ''),
        convertedSaleId: null,
      });
      // Revenda lançada direto pelo admin (não 'request') já nasce aprovada —
      // a dívida entra no saldo do vendedor agora, antes mesmo de montar.
      // eslint-disable-next-line no-await-in-loop
      if (approvalStatus === 'aprovado') await syncOrderDebt(order);
    }
    await S().refresh();
  }

  // =====================================================================
  // Dívida do pedido de revenda — decisão do usuário: a dívida nasce quando o
  // pedido fica APROVADO (mesmo antes de montar/despachar), não mais só no
  // despacho. syncOrderDebt é a ÚNICA porta de entrada para isso: idempotente
  // (calcula o líquido já lançado e só posta a diferença), então é seguro
  // chamar em qualquer ponto de transição — aprovação, edição de qtd/preço, e
  // como rede de segurança dentro de materializeOrder — sem nunca cobrar duas
  // vezes. sourceType 'order'/'order_edit' marcam os lançamentos que entram
  // nesse cálculo; 'order_cancel' (reverseOrderDebt) fica de fora de propósito
  // para não anular o próprio estorno num recálculo seguinte.
  function postedOrderDebt(orderId) {
    return (state().sellerAccountEntries || [])
      .filter((entry) => String(entry.sourceId) === String(orderId) && ['order', 'order_edit'].includes(entry.sourceType))
      .reduce((sum, entry) => sum + (entry.direction === 'credit' ? -U.number(entry.amount) : U.number(entry.amount)), 0);
  }

  async function syncOrderDebt(order) {
    if (order.saleType !== 'revenda' || order.approvalStatus !== 'aprovado') return;
    const target = Math.max(U.number(order.quantity) * U.number(order.unitPrice) - U.number(order.paidAmount), 0);
    const postedNet = postedOrderDebt(order.id);
    const delta = target - postedNet;
    if (Math.abs(delta) < 0.005) return;
    await S().add('sellerAccountEntries', {
      sellerId: order.sellerId,
      type: delta > 0 ? 'debit_replenishment' : 'manual_adjustment',
      direction: delta > 0 ? 'debit' : 'credit',
      amount: Math.abs(delta),
      sourceType: postedNet > 0 ? 'order_edit' : 'order',
      sourceId: order.id,
      notes: postedNet > 0
        ? `Ajuste de pedido editado - pedido ${order.orderGroupId || order.id}`
        : `Revenda (${PAYMENT_MODE_LABELS[order.paymentMode] || order.paymentMode}) aprovada - pedido ${order.orderGroupId || order.id}`,
    });
  }

  // Estorna a dívida já lançada quando um pedido aprovado é cancelado antes de
  // ser despachado (decisão do usuário: cancelamento sempre estorna sozinho).
  async function reverseOrderDebt(order) {
    const postedNet = postedOrderDebt(order.id);
    if (postedNet <= 0.005) return;
    await S().add('sellerAccountEntries', {
      sellerId: order.sellerId,
      type: 'writeoff',
      direction: 'credit',
      amount: postedNet,
      sourceType: 'order_cancel',
      sourceId: order.id,
      notes: `Pedido cancelado - estorno da dívida do pedido ${order.orderGroupId || order.id}`,
    });
  }

  // Materializa UMA linha do pedido (idempotente: convertedSaleId marca feito).
  // A dívida de revenda NÃO nasce mais aqui (ver syncOrderDebt) — despacho só
  // move estoque físico e cria o consignment; syncOrderDebt é chamado no fim
  // apenas como rede de segurança (idempotente, não cobra de novo).
  async function materializeOrder(order) {
    if (order.convertedSaleId) return;
    const quantity = U.number(order.quantity);
    const unitPrice = U.number(order.unitPrice);
    if (order.saleType === 'revenda') {
      const paid = Math.min(U.number(order.paidAmount), quantity * unitPrice);
      const consignment = await transferAdminStockToSeller({
        sellerId: order.sellerId,
        productId: order.productId,
        quantity,
        unitPrice,
        amountPaid: paid,
        groupId: order.orderGroupId || order.id,
        note: `Revenda (${PAYMENT_MODE_LABELS[order.paymentMode] || order.paymentMode}) para ${sellerName(order.sellerId)}`,
      });
      await syncOrderDebt(order);
      await S().update('orders', order.id, { convertedSaleId: (consignment && consignment.id) || order.id });
    } else {
      // Venda minha (cliente final): baixa estoque central + CMV/lucro.
      const sale = await window.C360.app.addSale({
        date: U.today(),
        channel: 'Pedido',
        clientId: order.clientId || null,
        productId: order.productId,
        quantity,
        unitPrice,
        discount: 0,
        fixedFees: 0,
        feePercent: 0,
        notes: `Venda despachada - pedido ${order.orderGroupId || order.id}${order.notes ? ` - ${order.notes}` : ''}`,
      }, { origin: 'pedido', originId: order.id });
      await S().update('orders', order.id, { convertedSaleId: sale.id });
    }
  }

  function ordersInGroup(groupId) {
    return (state().orders || []).filter((order) => String(order.orderGroupId || order.id) === String(groupId));
  }

  async function advanceOrderGroup(groupId, newStatus) {
    if (!isAdmin()) throw new Error('Somente o administrador muda o status do pedido.');
    const orders = ordersInGroup(groupId);
    if (!orders.length) return;
    if (orders.some((order) => order.approvalStatus === 'pendente_aprovacao')) {
      throw new Error('Aprove o pedido antes de avancar o status.');
    }
    // Despacho/conclusao materializam a venda (estoque + financeiro).
    if (newStatus === 'despachado' || newStatus === 'concluido') {
      // Pré-checagem de estoque de TODAS as linhas antes de mexer em qualquer
      // uma. Bug real encontrado: sem isto, um pedido com vários itens
      // processava um a um — se o 3º item não tivesse estoque, os 2 primeiros
      // já tinham baixado estoque/gerado consignação, mas a função quebrava
      // antes de atualizar o status do grupo. O card ficava preso na coluna
      // antiga (parecia travado/bugado) escondendo que metade já tinha sido
      // processada. Validando tudo antes, o despacho é tudo-ou-nada.
      const shortages = [];
      orders.forEach((order) => {
        if (order.convertedSaleId) return;
        const product = productById(order.productId);
        if (!product) { shortages.push('Um produto do pedido não foi encontrado no estoque.'); return; }
        if (product.type === 'servico') return;
        const missing = U.number(order.quantity) - U.number(product.currentStock);
        if (missing > 0) {
          shortages.push(`${product.name}: faltam ${U.qty(missing, product.unit)} (estoque atual ${U.qty(product.currentStock, product.unit)}, pedido pede ${U.qty(order.quantity, product.unit)}).`);
        }
      });
      if (shortages.length) {
        throw new Error(`Não é possível despachar — estoque insuficiente: ${shortages.join(' ')}`);
      }
      for (const order of orders) {
        // eslint-disable-next-line no-await-in-loop
        if (!order.convertedSaleId) await materializeOrder(order);
      }
    }
    for (const order of orders) {
      // eslint-disable-next-line no-await-in-loop
      await S().update('orders', order.id, { status: newStatus });
    }
    await S().refresh();
  }

  async function setGroupApproval(groupId, approvalStatus) {
    const orders = ordersInGroup(groupId);
    for (const order of orders) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await S().update('orders', order.id, { approvalStatus });
      // Ao aprovar um pedido que o vendedor pediu ('request'), a dívida entra
      // no saldo dele agora — antes mesmo de montar/despachar (decisão do
      // usuário). syncOrderDebt não faz nada se approvalStatus !== 'aprovado'.
      // eslint-disable-next-line no-await-in-loop
      await syncOrderDebt(updated || { ...order, approvalStatus });
    }
    await S().refresh();
  }

  async function cancelGroup(groupId) {
    const orders = ordersInGroup(groupId);
    if (orders.some((order) => order.convertedSaleId)) {
      throw new Error('Este pedido ja foi despachado. Use Devolucao/Desperdicio para reverter.');
    }
    // Estorna a dívida já lançada na aprovação antes de excluir os pedidos —
    // decisão do usuário: cancelar sempre estorna sozinho, sem depender do
    // admin lembrar de ajustar o saldo manualmente.
    for (const order of orders) {
      // eslint-disable-next-line no-await-in-loop
      await reverseOrderDebt(order);
    }
    for (const order of orders) {
      // eslint-disable-next-line no-await-in-loop
      await S().remove('orders', order.id);
    }
    await S().refresh();
  }

  async function saveGroupEdit(container, groupId) {
    const orders = ordersInGroup(groupId);
    if (orders.some((order) => order.convertedSaleId)) throw new Error('Pedido ja despachado nao pode ser editado.');
    for (const order of orders) {
      const qtyInput = container.querySelector(`[data-edit-qty="${CSS.escape(order.id)}"]`);
      const priceInput = container.querySelector(`[data-edit-price="${CSS.escape(order.id)}"]`);
      const qty = U.number(qtyInput?.value);
      const price = U.number(priceInput?.value);
      if (qty <= 0) throw new Error('Quantidade precisa ser maior que zero.');
      validateDraftPrice(order.productId, price);
      // eslint-disable-next-line no-await-in-loop
      const updated = await S().update('orders', order.id, { quantity: qty, unitPrice: price });
      // Se o pedido já estava aprovado (dívida já lançada), o valor da dívida
      // acompanha a edição automaticamente — decisão do usuário. syncOrderDebt
      // só lança a DIFERENÇA (idempotente), nunca duplica.
      // eslint-disable-next-line no-await-in-loop
      await syncOrderDebt(updated || { ...order, quantity: qty, unitPrice: price });
    }
    await S().refresh();
  }

  // =====================================================================
  // Render: construtor unificado + esteira
  // =====================================================================

  function modeOptionsFor(role) {
    return role === 'admin'
      ? [{ v: 'propria', label: 'Venda minha (cliente final)' }, { v: 'revenda', label: 'Venda ao revendedor' }]
      : [{ v: 'own', label: 'Vender meu estoque' }, { v: 'request', label: 'Pedir estoque ao admin' }];
  }

  function segmented(draft) {
    const opts = modeOptionsFor(isAdmin() ? 'admin' : 'vendedor');
    return `<div class="sale-type-switch">${opts.map((opt) => `
      <button type="button" class="sale-type-option ${draft.mode === opt.v ? 'active' : ''}" data-cart-action="set-mode" data-mode="${opt.v}">${U.escapeHtml(opt.label)}</button>
    `).join('')}</div>`;
  }

  function primaryLabel(mode) {
    return { propria: 'Lancar venda', revenda: 'Lancar para revendedor', own: 'Vender agora', request: 'Pedir ao admin' }[mode] || 'Lancar';
  }

  function configFields(draft) {
    const sellers = (state().profiles || []).filter((profile) => profile.role === 'vendedor' && profile.active !== false);
    const settings = !isAdmin() ? settingForSeller(user()?.id) : null;
    const rows = [];
    if (draft.mode === 'propria' || draft.mode === 'own') {
      rows.push(`<label>Cliente${draft.mode === 'own' ? ' (opcional)' : ''}
        <select name="clientId">${UI.optionList((state().clients || []), draft.clientId || '', 'Opcional')}</select>
      </label>`);
    }
    if (draft.mode === 'revenda') {
      rows.push(`<label>Vendedor que recebe
        <select name="targetSellerId" required>${UI.optionList(sellers, draft.targetSellerId || '', sellers.length ? 'Selecione o vendedor' : 'Nenhum vendedor ativo')}</select>
      </label>`);
    }
    if (draft.mode === 'revenda' || draft.mode === 'request') {
      const allowConsignment = isAdmin() || (settings && settings.allowConsignment);
      const payOpts = [
        '<option value="avista">A vista</option>',
        draft.mode === 'revenda' ? '<option value="parcial">Parcial</option>' : '',
        allowConsignment ? '<option value="consignado">Consignado</option>' : '',
      ].join('');
      rows.push(`<label>Pagamento
        <select name="paymentMode">${payOpts}</select>
      </label>`);
      if (draft.mode === 'revenda' && draft.paymentMode === 'parcial') {
        rows.push(`<label>Valor pago agora
          <input name="paidInitialAmount" type="number" step="0.01" min="0" value="${U.escapeHtml(draft.paidInitialAmount || '0')}">
        </label>`);
      }
    }
    return rows.join('');
  }

  function renderBuilder(draft, feedback) {
    const products = productsForDraft(draft);
    const revenda = isRevendaMode(draft.mode);
    const modeHint = {
      propria: 'Venda para o cliente final. Ao lançar, entra na esteira em Pendente; a baixa de estoque só acontece quando chegar em Despachado.',
      revenda: 'Envio para um revendedor. A dívida (consignado/parcial) já entra no saldo do vendedor agora, ao lançar. O estoque central só sai de fato, e a venda só conta no faturamento, quando o pedido chegar em Despachado.',
      own: 'Você vende um produto que já está no seu estoque. A baixa é imediata.',
      request: 'Pedido de reposição ao admin. Assim que o admin aprovar, a dívida (se for consignado/parcial) já entra no seu saldo — antes mesmo de ser montado. O estoque só sai quando for despachado.',
    }[draft.mode] || '';

    const productCards = products.slice(0, 18).map((product) => {
      const ownStock = ownStockForProduct(product.id);
      const stockHint = draftUsesOwnStock(draft)
        ? `<small>${U.qty(ownStock?.quantity || 0, product.unit)} no seu estoque</small>`
        : (product.stockHidden ? '<small>Disponibilidade protegida</small>' : '');
      return `
        <button type="button" class="cart-product-pick" data-cart-action="quick-add-product" data-product-id="${U.escapeHtml(product.id)}">
          <strong>${U.escapeHtml(product.name)}</strong>
          <span>${U.money(resolvedUnitPrice(product))}</span>
          ${stockHint}
        </button>`;
    }).join('');

    const itemCards = draft.items.map((item, index) => {
      const product = productById(item.productId);
      const total = U.number(item.quantity) * U.number(item.unitPrice);
      return `
        <article class="cart-draft-item">
          <div>
            <strong>${U.escapeHtml(product ? product.name : 'Produto')}</strong>
            <label class="cart-price-editor">Preço unitário<input data-draft-price="${index}" type="number" min="0.01" step="0.01" value="${U.escapeHtml(item.unitPrice)}" aria-label="Preço unitário"></label>
          </div>
          <div class="cart-stepper">
            <button type="button" class="small ghost" data-cart-action="dec-draft-item" data-index="${index}">-</button>
            <input data-draft-qty="${index}" type="number" min="0.001" step="0.001" value="${U.escapeHtml(item.quantity)}" aria-label="Quantidade">
            <button type="button" class="small ghost" data-cart-action="inc-draft-item" data-index="${index}">+</button>
          </div>
          <strong>${U.money(total)}</strong>
          <button type="button" class="small danger" data-cart-action="remove-draft-item" data-index="${index}">Remover</button>
        </article>`;
    }).join('');

    const linkHint = draft.lastLink
      ? `<div class="notice success"><strong>Link criado:</strong><br><input readonly value="${U.escapeHtml(draft.lastLink)}" onfocus="this.select()"></div>`
      : '';
    const canShareLink = isAdmin() ? false : (settingForSeller(user()?.id).allowPublicCartLinks && draft.mode === 'own');
    const parcialHint = (draft.mode === 'revenda' && draft.paymentMode === 'parcial')
      ? `<p class="hint-inline">Fica devendo: <strong>${U.money(Math.max(cartTotal(draft.items) - U.number(draft.paidInitialAmount), 0))}</strong></p>`
      : '';

    return `
      ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
      ${linkHint}
      <div class="sales-cart-layout sales-cart-layout-modern">
        <article class="panel-card sales-cart-builder">
          <div class="cart-panel-head">
            <div>
              <h3>Nova venda</h3>
              <p>${U.escapeHtml(modeHint)}</p>
            </div>
          </div>
          ${segmented(draft)}
          <form data-cart-config class="cart-config-grid">
            ${configFields(draft)}
          </form>

          <div class="cart-product-grid">
            ${productCards || '<div class="empty-state"><strong>Nenhum produto disponivel.</strong><span>Cadastre produtos ou peca reposicao.</span></div>'}
          </div>

          <form data-cart-add-item class="cart-manual-add">
            <select name="productId" required>${productOptions(products)}</select>
            <input name="quantity" type="number" step="0.001" min="0.001" placeholder="Qtd." required>
            <input name="unitPrice" type="number" step="0.01" min="0.01" placeholder="Preco">
            <button type="submit">Adicionar</button>
          </form>

          <details class="sale-more-options">
            <summary>Mais opcoes (canal, observacoes${canShareLink ? ', link publico' : ''})</summary>
            <div class="cart-config-grid">
              <label>Canal
                <select name="channel" data-extra-channel>${UI.optionList(state().settings.channels, draft.channel || 'WhatsApp', '')}</select>
              </label>
              <label class="wide">Observacoes
                <input name="notes" data-extra-notes value="${U.escapeHtml(draft.notes || '')}" placeholder="Entrega, combinado, apelido...">
              </label>
            </div>
            ${canShareLink ? '<button type="button" class="secondary" data-cart-action="share-cart">Gerar link publico</button>' : ''}
          </details>
        </article>

        <article class="panel-card sales-cart-summary">
          <div class="cart-panel-head">
            <div>
              <h3>Carrinho</h3>
              <p>${draft.items.length} item(ns)</p>
            </div>
            <strong>${U.money(cartTotal(draft.items))}</strong>
          </div>
          <div class="cart-draft-list">${itemCards || '<div class="empty-state"><strong>Carrinho vazio.</strong><span>Toque em um produto para adicionar.</span></div>'}</div>
          ${parcialHint}
          <div class="actions cart-primary-actions">
            <button type="button" data-cart-action="launch" ${draft.items.length ? '' : 'disabled'}>${primaryLabel(draft.mode)}</button>
            <button type="button" class="ghost" data-cart-action="clear-draft">Limpar</button>
          </div>
        </article>
      </div>`;
  }

  // ------- Esteira -------

  function orderGroups() {
    const map = new Map();
    (state().orders || []).forEach((order) => {
      const key = order.orderGroupId || order.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(order);
    });
    return [...map.entries()].map(([key, rows]) => {
      const first = rows[0];
      return {
        key,
        rows,
        status: first.status,
        approvalStatus: first.approvalStatus,
        saleType: first.saleType || 'propria',
        paymentMode: first.paymentMode,
        sellerId: first.sellerId,
        clientId: first.clientId,
        total: rows.reduce((sum, order) => sum + U.number(order.quantity) * U.number(order.unitPrice), 0),
        materialized: rows.some((order) => order.convertedSaleId),
      };
    });
  }

  function groupItemsHtml(group, editing) {
    return `<ul class="board-card-items">${group.rows.map((order) => {
      const product = productById(order.productId);
      if (editing) {
        return `<li class="board-edit-line">
          <span>${U.escapeHtml(product ? product.name : 'Produto')}</span>
          <input data-edit-qty="${U.escapeHtml(order.id)}" type="number" min="0.001" step="0.001" value="${U.escapeHtml(order.quantity)}" aria-label="Quantidade">
          <input data-edit-price="${U.escapeHtml(order.id)}" type="number" min="0" step="0.01" value="${U.escapeHtml(order.unitPrice)}" aria-label="Preco">
        </li>`;
      }
      return `<li><span>${U.escapeHtml(product ? product.name : 'Produto')}</span><strong>${U.qty(order.quantity, product?.unit)}</strong></li>`;
    }).join('')}</ul>`;
  }

  function boardCard(group, admin, statuses) {
    const revenda = group.saleType === 'revenda';
    const who = revenda ? `Revenda: ${U.escapeHtml(sellerName(group.sellerId))}` : (U.escapeHtml(clientName(group.clientId) || 'Cliente final'));
    const typeBadge = revenda
      ? UI.badge(`Revenda · ${PAYMENT_MODE_LABELS[group.paymentMode] || group.paymentMode || ''}`)
      : UI.badge('Venda minha', 'ok');
    const pending = group.approvalStatus === 'pendente_aprovacao';
    const editing = boardState.editGroupId === group.key;

    let actions = '';
    if (admin && editing) {
      actions = `<div class="actions">
        <button type="button" class="small" data-board-action="save-edit-group" data-group-id="${U.escapeHtml(group.key)}">Salvar</button>
        <button type="button" class="small ghost" data-board-action="cancel-edit-group">Cancelar</button>
      </div>`;
    } else if (admin && pending) {
      actions = `<div class="actions">
        <button type="button" class="small secondary" data-board-action="edit-group" data-group-id="${U.escapeHtml(group.key)}">Ajustar itens</button>
        <button type="button" class="small" data-board-action="approve-group" data-group-id="${U.escapeHtml(group.key)}">Aprovar</button>
        <button type="button" class="small danger" data-board-action="reject-group" data-group-id="${U.escapeHtml(group.key)}">Rejeitar</button>
      </div>`;
    } else if (admin) {
      const moveSelect = `<label class="kanban-move"><span>Mover para</span>
        <select data-board-move data-group-id="${U.escapeHtml(group.key)}">
          ${statuses.map((st) => `<option value="${st.value}" ${st.value === group.status ? 'selected' : ''}>${U.escapeHtml(st.label)}</option>`).join('')}
        </select></label>`;
      const tools = group.materialized
        ? UI.badge('Venda lancada', 'ok')
        : `<button type="button" class="small secondary" data-board-action="edit-group" data-group-id="${U.escapeHtml(group.key)}">Editar</button>
           <button type="button" class="small danger" data-board-action="cancel-group" data-group-id="${U.escapeHtml(group.key)}">Cancelar</button>`;
      actions = `${moveSelect}<div class="actions">${tools}</div>`;
    } else {
      actions = pending ? UI.badge('Aguardando aprovacao') : '';
    }

    return `
      <article class="kanban-card board-card ${pending ? 'board-card-pending' : ''}">
        <div class="board-card-head">
          <strong>${who}</strong>
          ${typeBadge}
        </div>
        ${groupItemsHtml(group, admin && editing)}
        <div class="board-card-foot"><span>Total</span><strong>${U.money(group.total)}</strong></div>
        ${actions}
      </article>`;
  }

  function renderBoard(feedback) {
    const statuses = state().settings.orderStatuses;
    const admin = isAdmin();
    const groups = orderGroups().filter((group) => group.approvalStatus !== 'rejeitado');
    const columns = statuses.map((st) => {
      const inCol = groups.filter((group) => group.status === st.value);
      const cards = inCol.map((group) => boardCard(group, admin, statuses)).join('');
      return `<div class="kanban-column" data-status="${st.value}">
        <h3>${U.escapeHtml(st.label)} ${UI.badge(String(inCol.length))}</h3>
        <div class="kanban-dropzone">${cards || '<p class="hint-inline board-empty">—</p>'}</div>
      </div>`;
    }).join('');
    const desc = admin
      ? 'Só o administrador avança o pedido. Revenda (consignado/parcial): a dívida do vendedor já entra no saldo assim que o pedido é aprovado — "Em montagem"/"Pronto" são só as etapas físicas de separar a mercadoria. O estoque central só sai de fato, e a venda só conta no faturamento, quando o pedido chega em "Despachado".'
      : 'Acompanhe o status dos seus pedidos. Quem avança o status é o administrador. Se for revenda, a dívida já aparece em "Meu saldo com admin" assim que o pedido é aprovado, antes mesmo de ser montado.';
    return UI.section('Esteira de pedidos', desc,
      `${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}<div class="kanban board-kanban" data-board>${columns}</div>`);
  }

  // =====================================================================
  // mount() — painel unificado de Vendas
  // =====================================================================

  function mount(container, options = {}) {
    const draft = persistentDraft;
    // O rascunho sobrevive entre remounts e ate entre trocas de conta (admin
    // <-> vendedor). Se o modo salvo nao existe para o papel atual (ex.:
    // 'revenda' e so do admin), volta ao padrao do papel — senao nenhum botao
    // do seletor fica ativo e os campos errados aparecem.
    const allowedModes = modeOptionsFor(isAdmin() ? 'admin' : 'vendedor').map((opt) => opt.v);
    if (!allowedModes.includes(draft.mode)) {
      draft.mode = defaultModeForRole();
      draft.items = [];
      draft.targetSellerId = '';
      draft.clientId = '';
    }
    let feedback = null;
    let boardFeedback = null;

    function paint() {
      container.innerHTML = [renderBuilder(draft, feedback), renderBoard(boardFeedback)].join('');
      const config = container.querySelector('[data-cart-config]');
      if (config) {
        if (config.clientId) config.clientId.value = draft.clientId || '';
        if (config.targetSellerId) config.targetSellerId.value = draft.targetSellerId || '';
        if (config.paymentMode) config.paymentMode.value = draft.paymentMode || 'avista';
        if (config.paidInitialAmount) config.paidInitialAmount.value = draft.paidInitialAmount || '0';
      }
    }

    function readConfig() {
      const config = container.querySelector('[data-cart-config]');
      if (config) {
        if (config.clientId) draft.clientId = config.clientId.value || '';
        if (config.targetSellerId) draft.targetSellerId = config.targetSellerId.value || '';
        if (config.paymentMode) draft.paymentMode = config.paymentMode.value || 'avista';
        if (config.paidInitialAmount) draft.paidInitialAmount = config.paidInitialAmount.value || '0';
      }
      const channelEl = container.querySelector('[data-extra-channel]');
      if (channelEl) draft.channel = channelEl.value || 'WhatsApp';
      const notesEl = container.querySelector('[data-extra-notes]');
      if (notesEl) draft.notes = notesEl.value || '';
    }

    container.addEventListener('change', async (event) => {
      if (event.target.closest('[data-cart-config]')) { readConfig(); paint(); return; }
      const boardMove = event.target.closest('[data-board-move]');
      if (boardMove) {
        // options.onDone() (= renderAll) REMONTA este painel do zero, o que
        // descarta boardFeedback (variável local do closure) — se chamado
        // também no erro, a mensagem de "estoque insuficiente" pisca e some
        // antes do admin conseguir ler (bug real: parecia que o despacho
        // falhava "sem avisar nada"). Só chama onDone() quando algo de fato
        // mudou; no erro, só repinta este painel e a mensagem fica visível.
        try {
          await advanceOrderGroup(boardMove.dataset.groupId, boardMove.value);
          boardFeedback = { message: 'Status atualizado.', type: 'success' };
          paint();
          if (typeof options.onDone === 'function') options.onDone();
        } catch (error) {
          boardFeedback = { message: error.message, type: 'danger' };
          paint();
        }
        return;
      }
      const priceInput = event.target.closest('[data-draft-price]');
      if (priceInput) {
        const item = draft.items[Number(priceInput.dataset.draftPrice)];
        try {
          if (item) {
            validateDraftPrice(item.productId, priceInput.value);
            item.unitPrice = U.number(priceInput.value);
          }
          feedback = null;
        } catch (error) {
          feedback = { message: error.message, type: 'danger' };
        }
        paint();
        return;
      }
      const qtyInput = event.target.closest('[data-draft-qty]');
      if (qtyInput) {
        const item = draft.items[Number(qtyInput.dataset.draftQty)];
        if (item) item.quantity = U.number(qtyInput.value);
        draft.items = draft.items.filter((entry) => U.number(entry.quantity) > 0);
        paint();
        return;
      }
      const productSelect = event.target.closest('[data-cart-add-item] select[name="productId"]');
      if (productSelect) {
        const product = productById(productSelect.value);
        const form = productSelect.closest('[data-cart-add-item]');
        if (form && product && form.elements.unitPrice && !form.elements.unitPrice.dataset.touched) {
          form.elements.unitPrice.value = resolvedUnitPrice(product);
        }
      }
      if (event.target.closest('[data-cart-add-item] input[name="unitPrice"]')) event.target.dataset.touched = '1';
    });

    container.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-cart-add-item]');
      if (!form) return;
      event.preventDefault();
      readConfig();
      const data = U.formData(form);
      const product = productById(data.productId);
      if (!product) return;
      addDraftItem(draft, { productId: data.productId, quantity: U.number(data.quantity), unitPrice: U.number(data.unitPrice || resolvedUnitPrice(product)) });
      form.reset();
      feedback = null;
      paint();
    });

    container.addEventListener('click', async (event) => {
      const boardButton = event.target.closest('[data-board-action]');
      if (boardButton) {
        const action = boardButton.dataset.boardAction;
        const groupId = boardButton.dataset.groupId;
        // 'edit-group'/'cancel-edit-group' só alternam um estado de UI local
        // (boardState, que sobrevive a remounts) — não precisam de onDone().
        // As demais mudam dado real e devem refletir no dashboard/outras abas.
        // Só chamamos onDone() quando a ação teve sucesso: no erro, chamar
        // onDone() remontaria o painel e apagaria a mensagem antes do admin
        // ler (mesmo problema do board-move acima).
        const needsRefresh = ['approve-group', 'reject-group', 'save-edit-group', 'cancel-group'].includes(action);
        try {
          if (action === 'approve-group') { await setGroupApproval(groupId, 'aprovado'); boardFeedback = { message: 'Pedido aprovado. Pode montar.', type: 'success' }; }
          else if (action === 'reject-group') { if (!confirm('Rejeitar este pedido?')) return; await setGroupApproval(groupId, 'rejeitado'); boardFeedback = { message: 'Pedido rejeitado.', type: 'warning' }; }
          else if (action === 'edit-group') { boardState.editGroupId = groupId; }
          else if (action === 'cancel-edit-group') { boardState.editGroupId = ''; }
          else if (action === 'save-edit-group') { await saveGroupEdit(container, groupId); boardState.editGroupId = ''; boardFeedback = { message: 'Pedido atualizado.', type: 'success' }; }
          else if (action === 'cancel-group') { if (!confirm('Cancelar (excluir) este pedido?')) return; await cancelGroup(groupId); boardFeedback = { message: 'Pedido cancelado.', type: 'success' }; }
          paint();
          if (needsRefresh && typeof options.onDone === 'function') options.onDone();
        } catch (error) {
          boardFeedback = { message: error.message, type: 'danger' };
          paint();
        }
        return;
      }

      const button = event.target.closest('[data-cart-action]');
      if (!button) return;
      const action = button.dataset.cartAction;
      try {
        readConfig();
        if (action === 'set-mode') {
          draft.mode = button.dataset.mode;
          if (draft.mode === 'request' && draft.paymentMode === 'parcial') draft.paymentMode = 'avista';
        } else if (action === 'remove-draft-item') {
          draft.items.splice(Number(button.dataset.index), 1);
        } else if (action === 'inc-draft-item') {
          const item = draft.items[Number(button.dataset.index)];
          if (item) item.quantity = U.number(item.quantity) + 1;
        } else if (action === 'dec-draft-item') {
          const item = draft.items[Number(button.dataset.index)];
          if (item) item.quantity = Math.max(U.number(item.quantity) - 1, 0);
          if (item && U.number(item.quantity) <= 0) draft.items.splice(Number(button.dataset.index), 1);
        } else if (action === 'quick-add-product') {
          addDraftItem(draft, { productId: button.dataset.productId, quantity: 1 });
        } else if (action === 'clear-draft') {
          resetDraft(draft);
        } else if (action === 'launch') {
          if (draft.mode === 'own') {
            await sellOwnStockNow(draft);
            resetDraft(draft);
            feedback = { message: 'Venda registrada. Seu estoque foi baixado.', type: 'success' };
          } else {
            await launchOrderFromCart(draft);
            const msg = draft.mode === 'request'
              ? 'Pedido enviado ao admin. Aparece na esteira aguardando aprovacao.'
              : 'Pedido lancado. Acompanhe na esteira (Pendente).';
            resetDraft(draft);
            feedback = { message: msg, type: 'success' };
          }
        } else if (action === 'share-cart') {
          const cart = await createCart(draft, 'shared');
          resetDraft(draft, true);
          draft.lastLink = publicUrl(cart);
          feedback = { message: 'Link publico criado.', type: 'success' };
        }
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    paint();
  }

  // =====================================================================
  // Permissoes dos vendedores (movido para a aba Vendedores) — mantido.
  // =====================================================================

  function renderAdminSettings(settingsFeedback) {
    if (!isAdmin()) return '';
    const sellers = (state().profiles || []).filter((profile) => profile.role === 'vendedor' && profile.active !== false);
    const cards = sellers.map((seller) => {
      const settings = settingForSeller(seller.id);
      const credits = U.number(settings.stockAdjustmentCredits);
      return `
        <form class="seller-permission-card" data-seller-settings-form data-seller-id="${U.escapeHtml(seller.id)}">
          <div><strong>${U.escapeHtml(seller.name || 'Vendedor')}</strong><p class="hint-inline">Configure o que aparece para este vendedor.</p></div>
          <label><input type="checkbox" name="allowConsignment" ${settings.allowConsignment ? 'checked' : ''}> Pode pedir consignado</label>
          <label><input type="checkbox" name="allowPublicCartLinks" ${settings.allowPublicCartLinks ? 'checked' : ''}> Pode gerar link publico</label>
          <label>Desconto maximo (%)<input name="maxDiscountPercent" type="number" min="0" max="100" step="0.01" value="${U.escapeHtml(settings.maxDiscountPercent || 0)}"></label>
          <button type="submit" class="small">Salvar permissao</button>
          <div class="seller-permission-stock-adjust">
            ${credits > 0 ? UI.badge('Acerto de estoque liberado', 'ok') : UI.badge('Sem acerto liberado')}
            <button type="button" class="small secondary" data-cart-action="grant-stock-adjustment" data-seller-id="${U.escapeHtml(seller.id)}" ${credits > 0 ? 'disabled' : ''}>Liberar 1 acerto de estoque</button>
          </div>
        </form>`;
    }).join('');
    return UI.section('Permissoes dos vendedores', 'Controle quem pode pedir consignado e gerar links publicos.',
      `${settingsFeedback ? UI.formNotice(settingsFeedback.message, settingsFeedback.type) : ''}<div class="seller-permission-grid">${cards || '<div class="empty-state"><strong>Nenhum vendedor ativo.</strong></div>'}</div>`);
  }

  function mountSettings(container, options = {}) {
    if (!container) return null;
    let settingsFeedback = null;
    function paint() { container.innerHTML = renderAdminSettings(settingsFeedback); }

    container.addEventListener('submit', async (event) => {
      const settingsForm = event.target.closest('[data-seller-settings-form]');
      if (!settingsForm) return;
      event.preventDefault();
      try {
        const sellerId = settingsForm.dataset.sellerId;
        const current = settingForSeller(sellerId);
        const payload = {
          sellerId,
          allowAdminStockSales: current.allowAdminStockSales !== false,
          allowConsignment: !!settingsForm.elements.allowConsignment.checked,
          allowPublicCartLinks: !!settingsForm.elements.allowPublicCartLinks.checked,
          maxDiscountPercent: U.number(settingsForm.elements.maxDiscountPercent.value),
          stockAdjustmentCredits: U.number(current.stockAdjustmentCredits),
        };
        if (current.id) await S().update('sellerSettings', current.id, payload);
        else await S().add('sellerSettings', payload);
        await S().refresh();
        settingsFeedback = { message: 'Permissoes salvas.', type: 'success' };
      } catch (error) {
        settingsFeedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cart-action="grant-stock-adjustment"]');
      if (!button) return;
      try {
        const sellerId = button.dataset.sellerId;
        const current = settingForSeller(sellerId);
        const payload = {
          sellerId,
          allowAdminStockSales: current.allowAdminStockSales !== false,
          allowConsignment: !!current.allowConsignment,
          allowPublicCartLinks: current.allowPublicCartLinks !== false,
          maxDiscountPercent: U.number(current.maxDiscountPercent),
          stockAdjustmentCredits: U.number(current.stockAdjustmentCredits) + 1,
        };
        if (current.id) await S().update('sellerSettings', current.id, payload);
        else await S().add('sellerSettings', payload);
        await S().refresh();
        settingsFeedback = { message: 'Acerto de estoque liberado para o vendedor.', type: 'success' };
      } catch (error) {
        settingsFeedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    paint();
    return { refresh: paint };
  }

  // =====================================================================
  // Envio direto admin -> vendedor (usado pelo painel da aba Vendedores).
  // Reaproveita a esteira: cria um pedido de revenda ja aprovado e o despacha
  // na hora (baixa de estoque + consignado + divida iguais ao fluxo normal).
  // =====================================================================

  async function sendConsignmentToSeller({ sellerId, productId, quantity, unitPrice }) {
    if (!isAdmin()) throw new Error('Somente o administrador pode enviar consignado ao vendedor.');
    const qty = U.number(quantity);
    const price = U.number(unitPrice);
    if (qty <= 0) throw new Error('Quantidade precisa ser maior que zero.');
    const groupId = crypto.randomUUID();
    await S().add('orders', {
      sellerId,
      clientId: null,
      productId,
      quantity: qty,
      unitPrice: price,
      dueDate: null,
      status: 'pendente',
      approvalStatus: 'aprovado',
      saleType: 'revenda',
      paymentMode: 'consignado',
      paidAmount: 0,
      orderGroupId: groupId,
      notes: 'Consignado enviado pelo painel da aba Vendedores',
      convertedSaleId: null,
    });
    await S().refresh();
    await advanceOrderGroup(groupId, 'despachado');
  }


  // =====================================================================
  // Página pública do carrinho (link compartilhado) — mantida.
  // =====================================================================

  async function mountPublic(container, token) {
    container.innerHTML = '<main class="public-cart-page"><div class="panel-card">Carregando carrinho...</div></main>';
    try {
      const data = await api().publicCartLookup(token);
      const items = data.items || [];
      const rows = items.map((item) => [
        U.escapeHtml(item.product_name),
        U.qty(item.quantity, item.unit),
        UI.moneyCell(item.unit_price),
        UI.moneyCell(U.number(item.quantity) * U.number(item.unit_price)),
      ]);
      container.innerHTML = `
        <main class="public-cart-page">
          <section class="public-cart-shell">
            <div class="public-cart-brand">
              <span class="eyebrow">Controle360</span>
              <h1>Carrinho de compra</h1>
              <p>Confira os itens e envie seus dados. O link expira automaticamente.</p>
            </div>
            <article class="panel-card">
              ${UI.table(['Produto', 'Qtd.', 'Unitario', 'Total'], rows, 'Carrinho vazio.')}
              <div class="cart-total"><span>Total</span><strong>${U.money(cartTotal(items.map((item) => ({ quantity: item.quantity, unitPrice: item.unit_price }))))}</strong></div>
            </article>
            <form class="panel-card public-cart-form" data-public-cart-form>
              <h2>Confirmar pedido</h2>
              <label>Nome<input name="customer_name" required value="${U.escapeHtml(data.cart.customer_name || '')}"></label>
              <label>WhatsApp<input name="customer_phone" value="${U.escapeHtml(data.cart.customer_phone || '')}"></label>
              <label>Comprovante (imagem ou PDF)<input name="payment_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
              <label>Observacoes<textarea name="customer_notes">${U.escapeHtml(data.cart.customer_notes || '')}</textarea></label>
              <button type="submit">Enviar pedido</button>
            </form>
          </section>
        </main>`;
      container.querySelector('[data-public-cart-form]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const result = await api().publicCartSubmit(token, new FormData(form));
          form.innerHTML = `<div class="notice success"><strong>${U.escapeHtml(result.message || 'Pedido enviado.')}</strong><br>Obrigado. Voce pode fechar esta pagina.</div>`;
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
      });
    } catch (error) {
      container.innerHTML = `<main class="public-cart-page"><div class="panel-card">${UI.formNotice(error.message || 'Carrinho indisponivel.', 'danger')}</div></main>`;
    }
  }

  window.C360.salesCart = { mount, mountSettings, mountPublic, sendConsignmentToSeller };
})();
