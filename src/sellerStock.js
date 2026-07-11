(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const Calc = window.C360.calc;

  // ==========================================================================
  // Estoque próprio de vendedor + aprovação de pedidos — módulo autocontido.
  //
  // API remota esperada (implementada por outro agente em window.C360.api,
  // ver docs/backend.md). Este módulo checa a existência de cada método
  // antes de chamar e cai num placeholder inofensivo ("modo demonstração")
  // quando ela ainda não existe — segue o mesmo padrão defensivo de
  // src/goals.js:
  //
  //   C360.api.list(table, query)                        -> Promise<Array<object>>
  //   C360.api.insert(table, payload)                     -> Promise<object>
  //   C360.api.update(table, id, patch)                   -> Promise<object>
  //   C360.api.listSellerStock(sellerId)                  -> Promise<Array<{id, sellerId, productId, quantity}>>
  //   C360.api.setSellerStock({sellerId, productId, quantity}) -> Promise<object>
  //   C360.api.approveOrder(id)                           -> Promise<object>
  //   C360.api.rejectOrder(id)                            -> Promise<object>
  //
  //   C360.state.getState()        -> object (products, clients, orders, profiles...)
  //   C360.state.getCurrentUser()  -> { id, role, name, businessId } | null
  //   C360.state.isAdmin()         -> boolean
  //   C360.state.add(collectionName, payload)   -> Promise<object>
  //   C360.state.update(collectionName, id, patch) -> Promise<object>
  //
  // IMPORTANTE — interpretação de produto (flagged para o dono do negócio
  // confirmar): "vendedor vende do estoque próprio -> vira consignado devido
  // ao admin" foi modelado aqui como uma consignação já 100% vendida na hora
  // da venda: quantitySent = quantitySold = quantidade vendida,
  // quantityReturned = 0, amountPaid = 0. O saldo em aberto dessa consignação
  // (quantitySold * unitPrice - amountPaid, ver Calc.consignmentOpenAmount em
  // src/calculations.js) passa a representar exatamente o valor que o
  // vendedor deve repassar ao administrador por essa venda. Confirmar se essa
  // leitura ("saldo em aberto = dívida do vendedor com o admin") é a
  // semântica desejada, ou se o produto quer um conceito de "consignado
  // reverso" separado.
  // ==========================================================================

  // ---------------------------------------------------------------------
  // Acesso defensivo a C360.api / C360.state
  // ---------------------------------------------------------------------
  function api() {
    return window.C360.api || null;
  }

  function hasApi(method) {
    return !!(api() && typeof api()[method] === 'function');
  }

  async function safeCall(method, ...args) {
    if (!hasApi(method)) return null;
    return api()[method](...args);
  }

  function stateApi() {
    return window.C360.state || null;
  }

  function currentUser() {
    try {
      const s = stateApi();
      return s && typeof s.getCurrentUser === 'function' ? s.getCurrentUser() || null : null;
    } catch (error) {
      console.error('C360.sellerStock: erro ao ler usuário atual', error);
      return null;
    }
  }

  function isAdmin() {
    try {
      const s = stateApi();
      return !!(s && typeof s.isAdmin === 'function' && s.isAdmin());
    } catch (error) {
      console.error('C360.sellerStock: erro ao checar admin', error);
      return false;
    }
  }

  function fullState() {
    try {
      const s = stateApi();
      return (s && typeof s.getState === 'function' && s.getState()) || {};
    } catch (error) {
      console.error('C360.sellerStock: erro ao ler estado', error);
      return {};
    }
  }

  function productsList() {
    const st = fullState();
    return Array.isArray(st.products) ? st.products : [];
  }

  function productById(id) {
    return productsList().find((product) => String(product.id) === String(id)) || null;
  }

  async function addRecord(collectionName, payload) {
    const s = stateApi();
    if (s && typeof s.add === 'function') return s.add(collectionName, payload);
    if (hasApi('insert')) return safeCall('insert', collectionName, payload);
    throw new Error('Não foi possível salvar: camada de dados indisponível.');
  }

  async function loadSellers() {
    const st = fullState();
    if (Array.isArray(st.profiles) && st.profiles.length) {
      return st.profiles
        .filter((profile) => profile.role === 'vendedor' && profile.active !== false)
        .map((profile) => ({ id: profile.id, name: profile.name }));
    }
    if (hasApi('list')) {
      try {
        const rows = await safeCall('list', 'profiles', { role: 'vendedor' });
        if (Array.isArray(rows)) {
          return rows.filter((profile) => profile.active !== false).map((profile) => ({ id: profile.id, name: profile.name }));
        }
      } catch (error) {
        console.error('C360.sellerStock: erro ao listar vendedores', error);
      }
    }
    return [];
  }

  // ---------------------------------------------------------------------
  // Estilos (injetados uma única vez; o módulo não edita styles/main.css).
  // Segue o mesmo padrão de src/goals.js: variáveis --accent-gold* com
  // fallback inline, para funcionar mesmo se o tema ainda não as define.
  // ---------------------------------------------------------------------
  const STYLE_ID = 'c360-sellerstock-inline-styles';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ss-stock-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.85rem; }
      .ss-stock-card {
        background: var(--surface, #fff);
        border: 1px solid var(--line, #d8e1df);
        border-radius: var(--radius, 14px);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .ss-stock-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
      .ss-inline-form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px dashed var(--line, #d8e1df); }
      .ss-inline-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
      .ss-hint { font-size: 0.82rem; color: var(--muted, #5d6f6d); margin-top: 0.5rem; }
      .ss-approvals-head { display: flex; justify-content: flex-end; margin-bottom: 0.6rem; }
      .ss-approvals-list { display: flex; flex-direction: column; gap: 0.8rem; }
      .ss-approval-card {
        background: var(--surface, #fff);
        border: 1px solid var(--accent-gold, #c9a227);
        border-radius: var(--radius, 14px);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        box-shadow: var(--shadow-sm, 0 4px 14px rgba(12, 60, 56, 0.07));
      }
      .ss-approval-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
      .ss-approval-detail { font-size: 0.88rem; color: var(--muted, #5d6f6d); margin: 0; }
      .ss-badge-urgent {
        background: var(--accent-gold-soft, #faf1d4);
        color: var(--accent-gold-deep, #8a6f14);
        font-weight: 700;
        animation: c360SsPulse 1.8s ease-in-out infinite;
      }
      @keyframes c360SsPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(201, 162, 39, 0.35); }
        50% { box-shadow: 0 0 0 6px rgba(201, 162, 39, 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .ss-badge-urgent { animation: none; }
      }
      .ss-approval-card .actions button { flex: 1 1 auto; min-width: 130px; }
      .ss-stock-adjust-notice { margin-bottom: 0.6rem; }
    `;
    document.head.appendChild(style);
  }

  // =========================================================================
  // SELLER SIDE — Meu estoque
  // =========================================================================

  function sellFormHtml(productId, product) {
    const clients = fullState().clients || [];
    const salePrice = product && product.salePrice ? product.salePrice : '';
    return `
      <form class="ss-inline-form" data-ss-sell-form data-product-id="${U.escapeHtml(productId)}">
        <label>Cliente
          <select name="clientId" required>${UI.optionList(clients, '', clients.length ? 'Selecione o cliente' : 'Nenhum cliente cadastrado')}</select>
        </label>
        <label>Quantidade
          <input name="quantity" type="number" step="0.001" min="0.001" required>
        </label>
        <label>Preço unitário
          <input name="unitPrice" type="number" step="0.01" min="0.01" required value="${U.escapeHtml(salePrice)}">
        </label>
        <label>Observações
          <input name="notes" placeholder="Opcional">
        </label>
        <div class="actions">
          <button type="submit">Confirmar venda</button>
          <button type="button" class="small secondary" data-ss-action="cancel-sell">Cancelar</button>
        </div>
      </form>
    `;
  }

  function stockCardHtml(row, openProductId) {
    const product = row.product || productById(row.productId);
    const name = product ? U.escapeHtml(product.name) : 'Produto removido';
    const unit = product ? product.unit : '';
    const isOpen = String(openProductId) === String(row.productId);
    return `
      <article class="ss-stock-card" data-stock-product-id="${U.escapeHtml(row.productId)}">
        <div class="ss-stock-card-head">
          <strong>${name}</strong>
          <span class="badge">${U.qty(row.quantity, unit)}</span>
        </div>
        <button type="button" data-ss-action="toggle-sell" data-product-id="${U.escapeHtml(row.productId)}">Vender deste estoque</button>
        ${isOpen ? sellFormHtml(row.productId, product) : ''}
      </article>
    `;
  }

  // ---------------------------------------------------------------------
  // Pedir mais estoque ao admin — à vista ou a prazo (consignado, gera
  // dívida). Um único ponto de entrada em "Meu estoque" em vez de o
  // vendedor precisar entender o construtor de carrinho genérico (canal,
  // link público, múltiplos itens) na aba Pedidos só pra pedir reposição.
  // ---------------------------------------------------------------------
  function sellerPriceForProduct(productId) {
    return (fullState().sellerPrices || []).find((row) => String(row.productId) === String(productId)) || null;
  }

  // ---------------------------------------------------------------------
  // Acerto de estoque próprio — só aparece quando o admin liberou 1 crédito
  // (seller_settings.stock_adjustment_credits > 0). Consome o RPC
  // seller_adjust_own_stock via C360.api.adjustOwnStock, que já zera o
  // crédito no servidor depois de usado.
  // ---------------------------------------------------------------------
  function adjustFormHtml(adjustFeedback) {
    const products = productsList();
    return `
      <div class="ss-stock-adjust-notice">${UI.badge('Acerto de estoque liberado pelo administrador', 'ok')}</div>
      <form class="ss-inline-form" data-ss-adjust-form>
        <label>Produto
          <select name="productId" required>${UI.optionList(products, '', 'Selecione o produto')}</select>
        </label>
        <label>Novo estoque (quantidade correta)
          <input name="newQuantity" type="number" step="0.001" min="0" required>
        </label>
        <label>Motivo do acerto (obrigatório)
          <input name="reason" required placeholder="Ex.: contagem antiga nunca foi lançada certo">
        </label>
        <div class="actions">
          <button type="submit">Registrar acerto (usa o crédito)</button>
        </div>
        ${adjustFeedback ? UI.formNotice(adjustFeedback.message, adjustFeedback.type) : ''}
      </form>
    `;
  }

  function renderMyStock(data = {}) {
    ensureStyles();
    const apiAvailable = data.apiAvailable !== undefined ? data.apiAvailable : hasApi('listSellerStock');
    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api.listSellerStock para ver seu estoque próprio real.', 'warning');

    if (data.loading) {
      return UI.section(
        'Meu estoque',
        'Produtos que você guarda para vender por conta própria. Ao vender, o valor vira consignado devido ao administrador.',
        `${notice}${UI.formNotice('Carregando seu estoque...', 'info')}`
      );
    }

    const rows = (data.rows || []).filter((row) => U.number(row.quantity) > 0);
    const body = rows.length
      ? `<div class="ss-stock-grid">${rows.map((row) => stockCardHtml(row, data.openProductId)).join('')}</div>`
      : '<div class="empty-state"><strong>Nenhum estoque próprio no momento.</strong><span>Peça ao administrador para lhe repassar produtos.</span></div>';

    const credits = U.number(data.sellerSettings && data.sellerSettings.stockAdjustmentCredits);
    const adjustSection = credits > 0
      ? UI.section(
          'Acerto de estoque',
          'Corrige a quantidade que você realmente tem, com motivo obrigatório. Depois de usar, o administrador precisa liberar de novo.',
          adjustFormHtml(data.adjustFeedback)
        )
      : '';

    return `
      ${UI.section(
        'Meu estoque',
        'Produtos que você guarda para vender por conta própria. Ao vender, o valor vira consignado devido ao administrador. Para pedir mais estoque, use a aba Vendas → "Pedir estoque ao admin".',
        `${notice}${body}`
      )}
      ${adjustSection}
    `;
  }

  function mountMyStock(container) {
    if (!container) return null;

    const user = currentUser();
    if (!hasApi('listSellerStock') || !user) {
      container.innerHTML = renderMyStock({ apiAvailable: hasApi('listSellerStock'), rows: [] });
      return null;
    }

    let rows = [];
    let loading = true;
    let openProductId = null;
    let sellerSettings = null;
    let adjustFeedback = null;

    function paint() {
      container.innerHTML = renderMyStock({ rows, loading, openProductId, apiAvailable: true, sellerSettings, adjustFeedback });
    }

    async function load() {
      loading = true;
      paint();
      try {
        const [stockRes, settingsRes] = await Promise.all([
          safeCall('listSellerStock', user.id),
          hasApi('listSellerSettings') ? safeCall('listSellerSettings', { sellerId: user.id }) : Promise.resolve(null),
        ]);
        rows = Array.isArray(stockRes) ? stockRes : [];
        sellerSettings = Array.isArray(settingsRes) ? (settingsRes[0] || null) : null;
      } catch (error) {
        console.error('C360.sellerStock: erro ao carregar estoque próprio', error);
        rows = [];
        sellerSettings = null;
      }
      loading = false;
      paint();
    }

    container.addEventListener('click', (event) => {
      const toggleButton = event.target.closest('[data-ss-action="toggle-sell"]');
      if (toggleButton) {
        const { productId } = toggleButton.dataset;
        openProductId = String(openProductId) === String(productId) ? null : productId;
        paint();
        return;
      }
      const cancelButton = event.target.closest('[data-ss-action="cancel-sell"]');
      if (cancelButton) {
        openProductId = null;
        paint();
      }
    });

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-ss-sell-form]');
      if (!form) return;
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      try {
        const data = U.formData(form);
        if (submitButton) submitButton.disabled = true;
        const result = await sellFromOwnStock({
          productId: form.dataset.productId,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          clientId: data.clientId,
          notes: data.notes || '',
        });
        if (!result.ok) throw new Error(result.error || 'Não foi possível registrar a venda.');
        openProductId = null;
        await load();
      } catch (error) {
        alert(error.message);
        if (submitButton) submitButton.disabled = false;
      }
    });

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-ss-adjust-form]');
      if (!form) return;
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      try {
        if (!hasApi('adjustOwnStock')) throw new Error('Recurso de acerto de estoque indisponível (modo demonstração).');
        const data = U.formData(form);
        if (submitButton) submitButton.disabled = true;
        await safeCall('adjustOwnStock', {
          productId: data.productId,
          newQuantity: U.number(data.newQuantity),
          reason: (data.reason || '').trim(),
        });
        adjustFeedback = null;
        await load();
      } catch (error) {
        adjustFeedback = { message: error.message, type: 'danger' };
        if (submitButton) submitButton.disabled = false;
        paint();
      }
    });

    paint();
    load();
    return { refresh: load };
  }

  async function sellFromOwnStock({ productId, quantity, unitPrice, clientId, notes } = {}) {
    try {
      if (!hasApi('listSellerStock') || !hasApi('setSellerStock')) {
        return { ok: false, error: 'Recurso de estoque próprio indisponível (modo demonstração).' };
      }
      const user = currentUser();
      if (!user) return { ok: false, error: 'Usuário não autenticado.' };
      if (!productId) return { ok: false, error: 'Produto não informado.' };
      if (!clientId) return { ok: false, error: 'Selecione um cliente.' };

      const qty = U.number(quantity);
      const price = U.number(unitPrice);
      if (qty <= 0) return { ok: false, error: 'Quantidade precisa ser maior que zero.' };
      if (price <= 0) return { ok: false, error: 'Preço unitário precisa ser maior que zero.' };

      // 1) Ler estoque atual do vendedor e validar disponibilidade.
      const currentRows = (await safeCall('listSellerStock', user.id)) || [];
      const row = Array.isArray(currentRows)
        ? currentRows.find((item) => String(item.productId) === String(productId))
        : null;
      const currentQty = row ? U.number(row.quantity) : 0;
      if (qty > currentQty) {
        return { ok: false, error: 'Estoque insuficiente' };
      }

      // 2) Decrementar o estoque próprio do vendedor.
      await safeCall('setSellerStock', { sellerId: user.id, productId, quantity: currentQty - qty });

      // 3) Criar a consignação já vendida (ver nota de interpretação no topo do arquivo).
      const product = productById(productId);
      const costAtSend = product && typeof product.avgCost === 'number' ? product.avgCost : 0;
      const math = Calc && typeof Calc.saleMath === 'function'
        ? Calc.saleMath({ quantity: qty, unitPrice: price, discount: 0, fixedFees: 0, feePercent: 0, unitCost: costAtSend })
        : {
            grossRevenue: qty * price,
            netRevenue: qty * price,
            percentFees: 0,
            cogs: qty * costAtSend,
            grossProfit: (qty * price) - (qty * costAtSend),
            margin: qty * price > 0 ? ((qty * price) - (qty * costAtSend)) / (qty * price) : 0,
          };
      const sale = await addRecord('sales', {
        date: U.today(),
        channel: 'Estoque proprio',
        clientId,
        productId,
        quantity: qty,
        unitPrice: price,
        discount: 0,
        fixedFees: 0,
        feePercent: 0,
        unitCost: costAtSend,
        ...math,
        notes: notes || 'Venda pelo estoque proprio',
        origin: 'manual',
        originId: null,
      });

      const consignmentPayload = {
        sellerId: user.id,
        productId,
        clientId,
        quantitySent: qty,
        quantitySold: qty,
        quantityReturned: 0,
        unitPrice: price,
        costAtSend,
        amountPaid: 0,
        status: 'com_cliente',
        date: U.today(),
        notes: notes || (sale && sale.id ? `Venda ${sale.id}` : ''),
      };
      const consignment = await addRecord('consignments', consignmentPayload);

      // 4) Evento de venda, best-effort — não deve derrubar o fluxo se falhar.
      if (consignment && consignment.id) {
        try {
          await addRecord('consignment_events', {
            consignmentId: consignment.id,
            type: 'venda_cliente',
            date: U.today(),
            quantity: qty,
            amount: qty * price,
          });
        } catch (eventError) {
          console.error('C360.sellerStock: consignação criada, mas evento falhou', eventError);
        }
      }

      return { ok: true, consignment };
    } catch (error) {
      console.error('C360.sellerStock: erro em sellFromOwnStock', error);
      return { ok: false, error: error.message || 'Erro ao registrar venda do estoque próprio.' };
    }
  }

  // =========================================================================
  // ADMIN SIDE — Repassar estoque
  // =========================================================================

  function renderGrantStock(data = {}) {
    ensureStyles();
    if (!isAdmin()) {
      return UI.formNotice('Acesso restrito ao administrador.', 'warning');
    }
    const sellers = data.sellers || [];
    const products = data.products || productsList();
    const apiAvailable = data.apiAvailable !== undefined ? data.apiAvailable : hasApi('setSellerStock');
    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api.setSellerStock para repassar estoque de verdade.', 'warning');
    const feedback = data.feedback ? UI.formNotice(data.feedback.message, data.feedback.type || 'success') : '';

    return UI.section(
      'Repassar estoque a vendedor',
      'Defina quanto de cada produto fica sob responsabilidade do vendedor (consignado dele).',
      `
        ${notice}${feedback}
        <form data-ss-grant-form class="grid-form">
          <label>Vendedor
            <select name="sellerId" required>${UI.optionList(sellers, '', sellers.length ? 'Selecione' : 'Nenhum vendedor cadastrado')}</select>
          </label>
          <label>Produto
            <select name="productId" required>${UI.optionList(products, '', 'Selecione o produto')}</select>
          </label>
          <label>Quantidade a repassar
            <input name="quantity" type="number" step="0.001" min="0" required>
          </label>
          <button type="submit">Definir estoque do vendedor</button>
        </form>
        <p class="ss-hint">O valor informado substitui o saldo atual do vendedor para este produto (não soma).</p>
      `
    );
  }

  function mountGrantStock(container) {
    if (!container) return null;
    if (!isAdmin()) {
      container.innerHTML = renderGrantStock();
      return null;
    }

    let sellers = [];
    let feedback = null;

    function paint() {
      container.innerHTML = renderGrantStock({
        sellers,
        products: productsList(),
        apiAvailable: hasApi('setSellerStock'),
        feedback,
      });
    }

    async function load() {
      sellers = await loadSellers();
      paint();
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-ss-grant-form]');
      if (!form) return;
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      try {
        const data = U.formData(form);
        if (!data.sellerId) throw new Error('Selecione um vendedor.');
        if (!data.productId) throw new Error('Selecione um produto.');
        const quantity = U.number(data.quantity);
        if (quantity < 0) throw new Error('Quantidade não pode ser negativa.');
        if (!hasApi('setSellerStock')) {
          feedback = { message: 'Modo demonstração: conecte C360.api.setSellerStock para repassar estoque de verdade.', type: 'warning' };
          paint();
          return;
        }
        if (submitButton) submitButton.disabled = true;
        await safeCall('setSellerStock', { sellerId: data.sellerId, productId: data.productId, quantity });
        feedback = { message: 'Estoque do vendedor atualizado.', type: 'success' };
        form.reset();
        paint();
      } catch (error) {
        feedback = { message: error.message, type: 'error' };
        paint();
      }
    });

    paint();
    load();
    return { refresh: load };
  }

  // =========================================================================
  // ADMIN SIDE — Aprovações de pedidos
  // =========================================================================

  function orderApprovalStatus(order) {
    return order.approvalStatus || order.approval_status || '';
  }

  function approvalCardHtml(order) {
    const product = productById(order.productId);
    const st = fullState();
    const seller = (st.profiles || []).find((profile) => String(profile.id) === String(order.sellerId));
    const sellerName = seller ? seller.name : 'Vendedor';
    const qtyLabel = U.qty(order.quantity, product ? product.unit : '');
    const dateLabel = order.dueDate || order.date || '—';

    return `
      <article class="ss-approval-card" data-order-id="${U.escapeHtml(order.id)}">
        <div class="ss-approval-head">
          <strong>${product ? U.escapeHtml(product.name) : 'Produto removido'}</strong>
          <span class="badge ss-badge-urgent">Aguardando aprovação</span>
        </div>
        <p class="ss-approval-detail">Vendedor: <strong>${U.escapeHtml(sellerName)}</strong> · Quantidade: <strong>${qtyLabel}</strong></p>
        <p class="ss-approval-detail">Data: ${U.escapeHtml(dateLabel)}${order.notes ? ` · Obs.: ${U.escapeHtml(order.notes)}` : ''}</p>
        <div class="actions">
          <button type="button" data-ss-action="approve" data-order-id="${U.escapeHtml(order.id)}">Aprovar</button>
          <button type="button" class="danger" data-ss-action="reject" data-order-id="${U.escapeHtml(order.id)}">Rejeitar</button>
        </div>
      </article>
    `;
  }

  function renderApprovals(data = {}) {
    ensureStyles();
    if (!isAdmin()) {
      return UI.formNotice('Acesso restrito ao administrador.', 'warning');
    }
    const apiAvailable = data.apiAvailable !== undefined ? data.apiAvailable : (hasApi('list') || hasApi('approveOrder'));
    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api (list/approveOrder/rejectOrder) para aprovar pedidos de verdade.', 'warning');

    if (data.loading) {
      return UI.section(
        'Aprovações de pedidos',
        'Pedidos de reposição feitos pelos vendedores aguardando sua aprovação.',
        `${notice}${UI.formNotice('Carregando pedidos pendentes...', 'info')}`
      );
    }

    const orders = data.orders || [];
    const count = orders.length;
    const countBadge = count > 0
      ? `<span class="badge ss-badge-urgent">${count} pendente${count === 1 ? '' : 's'}</span>`
      : '<span class="badge ok">Tudo em dia</span>';

    const listHtml = count
      ? orders.map((order) => approvalCardHtml(order)).join('')
      : '<div class="empty-state"><strong>Nenhum pedido aguardando aprovação.</strong><span>Pedidos novos de vendedores aparecem aqui.</span></div>';

    return UI.section(
      'Aprovações de pedidos',
      'Pedidos de reposição feitos pelos vendedores aguardando sua aprovação.',
      `
        ${notice}
        <div class="ss-approvals-head">${countBadge}</div>
        <div class="ss-approvals-list">${listHtml}</div>
      `
    );
  }

  function mountApprovals(container, options = {}) {
    if (!container) return null;
    const onDone = options.onDone;
    if (!isAdmin()) {
      container.innerHTML = renderApprovals();
      return null;
    }

    let orders = [];
    let loading = true;

    function paint() {
      container.innerHTML = renderApprovals({ orders, loading, apiAvailable: hasApi('list') || hasApi('approveOrder') });
    }

    async function load() {
      loading = true;
      paint();
      let rows = null;
      if (hasApi('list')) {
        try {
          rows = await safeCall('list', 'orders', { approval_status: 'pendente_aprovacao' });
        } catch (error) {
          console.error('C360.sellerStock: erro ao listar pedidos pendentes', error);
          rows = null;
        }
      }
      if (!Array.isArray(rows)) {
        const st = fullState();
        rows = (st.orders || []).filter((order) => orderApprovalStatus(order) === 'pendente_aprovacao');
      }
      orders = Array.isArray(rows) ? rows : [];
      loading = false;
      paint();
    }

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-ss-action="approve"], [data-ss-action="reject"]');
      if (!button) return;
      const { ssAction, orderId } = button.dataset;
      if (ssAction === 'reject' && !confirm('Rejeitar este pedido?')) return;
      button.disabled = true;
      try {
        if (ssAction === 'approve') {
          if (!hasApi('approveOrder')) throw new Error('Modo demonstração: conecte C360.api.approveOrder.');
          await safeCall('approveOrder', orderId);
        } else {
          if (!hasApi('rejectOrder')) throw new Error('Modo demonstração: conecte C360.api.rejectOrder.');
          await safeCall('rejectOrder', orderId);
        }
        await load();
        if (typeof onDone === 'function') onDone();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });

    paint();
    load();
    return { refresh: load };
  }

  window.C360.sellerStock = {
    renderMyStock,
    mountMyStock,
    sellFromOwnStock,
    renderGrantStock,
    mountGrantStock,
    renderApprovals,
    mountApprovals,
  };
})();
