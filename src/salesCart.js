(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  const STATUS_LABELS = {
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

  // Rascunho do carrinho vive fora de mount(): app.js recria o container do
  // Vendas/Pedidos a cada renderAll() (qualquer aÃ§Ã£o na tela dispara isso),
  // e mount() Ã© chamado de novo â€” se o draft fosse uma variÃ¡vel local do
  // fecho de mount(), cada remount zeraria os itens jÃ¡ adicionados ao
  // carrinho. Mantendo o objeto no escopo do mÃ³dulo, ele sobrevive a
  // remounts (inclusive entre a aba Vendas e a aba Pedidos, que montam o
  // mesmo carrinho).
  const persistentDraft = {
    source: 'seller_stock',
    paymentMode: 'avista',
    expiresHours: '48',
    targetSellerId: '',
    customerName: '',
    channel: 'WhatsApp',
    notes: '',
    items: [],
    lastLink: '',
  };

  function api() { return window.C360.api; }
  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }
  function isAdmin() { return S().isAdmin(); }
  function productById(id) { return (state().products || []).find((item) => String(item.id) === String(id)) || null; }
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
    };
  }
  function itemsForCart(cartId) {
    return (state().saleCartItems || []).filter((item) => String(item.cartId) === String(cartId));
  }
  function statusBadge(status) {
    const type = status === 'approved' || status === 'converted' ? 'ok' : status === 'rejected' ? 'danger' : '';
    return UI.badge(STATUS_LABELS[status] || status, type);
  }
  function sourceLabel(source) {
    return source === 'admin_stock' ? 'Estoque do admin' : 'Estoque proprio';
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

  function productOptions(products) {
    return UI.optionList(products.map((product) => ({
      id: product.id,
      name: `${product.name} - ${U.money(product.defaultPrice || product.salePrice || 0)}`,
    })), '', 'Produto');
  }

  function renderBuilder(draft, feedback) {
    const currentUser = user();
    const settings = currentUser && currentUser.role === 'vendedor' ? settingForSeller(currentUser.id) : {
      allowAdminStockSales: true,
      allowConsignment: true,
      allowPublicCartLinks: true,
    };
    const products = (state().products || []).filter((product) => !['materia_prima', 'embalagem'].includes(product.type));
    const allowAdminSource = isAdmin() || settings.allowAdminStockSales;
    const allowConsignment = isAdmin() || settings.allowConsignment;
    const sourceOptions = [
      '<option value="seller_stock">Estoque proprio do vendedor</option>',
      allowAdminSource ? '<option value="admin_stock">Estoque do administrador</option>' : '',
    ].join('');
    const paymentOptions = [
      '<option value="avista">A vista</option>',
      '<option value="parcial">Parcial</option>',
      allowConsignment ? '<option value="consignado">Consignado</option>' : '',
    ].join('');
    const channelOptions = UI.optionList(state().settings.channels, draft.channel || 'WhatsApp', '');
    const sellers = (state().profiles || []).filter((profile) => profile.role === 'vendedor' && profile.active !== false);
    const sellerTargetField = isAdmin() && draft.paymentMode === 'consignado'
      ? `<label>Vendedor consignado
          <select name="targetSellerId" required>${UI.optionList(sellers, draft.targetSellerId || '', sellers.length ? 'Selecione o vendedor' : 'Nenhum vendedor ativo')}</select>
        </label>`
      : '';
    const rows = draft.items.map((item, index) => {
      const product = productById(item.productId);
      return [
        UI.productName(product),
        U.qty(item.quantity, product?.unit),
        UI.moneyCell(item.unitPrice),
        UI.moneyCell(U.number(item.quantity) * U.number(item.unitPrice)),
        `<button type="button" class="small danger" data-cart-action="remove-draft-item" data-index="${index}">Remover</button>`,
      ];
    });
    const linkHint = draft.lastLink
      ? `<div class="notice success"><strong>Link criado:</strong><br><input readonly value="${U.escapeHtml(draft.lastLink)}" onfocus="this.select()"></div>`
      : '';

    return `
      ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
      ${linkHint}
      <div class="sales-cart-layout">
        <article class="panel-card sales-cart-builder">
          <h3>Novo carrinho</h3>
          <form data-cart-config class="grid-form compact-form">
            <label>Origem do estoque
              <select name="source">${sourceOptions}</select>
            </label>
            <label>Pagamento
              <select name="paymentMode">${paymentOptions}</select>
            </label>
            <label>Canal
              <select name="channel">${channelOptions}</select>
            </label>
            <label>Nome do cliente
              <input name="customerName" value="${U.escapeHtml(draft.customerName || '')}" placeholder="Opcional">
            </label>
            ${sellerTargetField}
            <label>Validade do link
              <select name="expiresHours">
                <option value="24">24 horas</option>
                <option value="48" selected>48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </label>
            <label class="wide">Observacoes internas
              <input name="notes" value="${U.escapeHtml(draft.notes || '')}" placeholder="Entrega, combinado, origem do atendimento...">
            </label>
          </form>

          <form data-cart-add-item class="grid-form compact-form">
            <label>Produto
              <select name="productId" required>${productOptions(products)}</select>
            </label>
            <label>Qtd.
              <input name="quantity" type="number" step="0.001" min="0.001" required>
            </label>
            <label>Preco unitario
              <input name="unitPrice" type="number" step="0.01" min="0.01" required>
            </label>
            <button type="submit">Adicionar item</button>
          </form>
        </article>

        <article class="panel-card sales-cart-summary">
          <h3>Carrinho atual</h3>
          ${UI.table(['Produto', 'Qtd.', 'Unitario', 'Total', ''], rows, 'Nenhum item no carrinho.')}
          <div class="cart-total"><span>Total</span><strong>${U.money(cartTotal(draft.items))}</strong></div>
          <div class="actions">
            <button type="button" data-cart-action="save-cart" ${draft.items.length ? '' : 'disabled'}>Salvar pedido</button>
            <button type="button" class="secondary" data-cart-action="share-cart" ${draft.items.length && draft.paymentMode === 'avista' && settings.allowPublicCartLinks ? '' : 'disabled'}>Gerar link</button>
            <button type="button" class="ghost" data-cart-action="clear-draft">Limpar</button>
          </div>
          <p class="hint-inline">Link publico aceita somente pagamento a vista e pode receber comprovante.</p>
        </article>
      </div>
    `;
  }

  function renderCarts() {
    const carts = state().saleCarts || [];
    const rows = carts.slice(0, 40).map((cart) => {
      const items = itemsForCart(cart.id);
      const itemText = items.map((item) => {
        const product = productById(item.productId);
        return `${product ? product.name : 'Produto'} (${U.qty(item.quantity, product?.unit)})`;
      }).join(', ');
      const actions = [];
      if (cart.publicToken) actions.push(`<button type="button" class="small secondary" data-cart-action="copy-link" data-cart-id="${U.escapeHtml(cart.id)}">Copiar link</button>`);
      if (cart.source === 'seller_stock' && user() && String(user().id) === String(cart.sellerId) && ['submitted', 'shared'].includes(cart.status)) actions.push(`<button type="button" class="small" data-cart-action="convert-own-stock" data-cart-id="${U.escapeHtml(cart.id)}">Baixar estoque proprio</button>`);
      return [
        statusBadge(cart.status),
        U.escapeHtml(sourceLabel(cart.source)),
        U.escapeHtml(cart.customerName || 'Sem cliente'),
        U.escapeHtml(itemText || 'Sem itens'),
        UI.moneyCell(cartTotal(items)),
        `<div class="actions">${actions.join('')}</div>`,
      ];
    });
    return UI.section('Carrinhos e pedidos', 'Acompanhe links enviados, pedidos do estoque do admin e vendas do estoque proprio.', UI.table(['Status', 'Origem', 'Cliente', 'Itens', 'Total', 'Acoes'], rows, 'Nenhum carrinho ainda.'));
  }

  function renderAdminSettings(settingsFeedback) {
    if (!isAdmin()) return '';
    const sellers = (state().profiles || []).filter((profile) => profile.role === 'vendedor' && profile.active !== false);
    const cards = sellers.map((seller) => {
      const settings = settingForSeller(seller.id);
      const credits = U.number(settings.stockAdjustmentCredits);
      return `
        <form class="seller-permission-card" data-seller-settings-form data-seller-id="${U.escapeHtml(seller.id)}">
          <div>
            <strong>${U.escapeHtml(seller.name || 'Vendedor')}</strong>
            <p class="hint-inline">Configure o que aparece para este vendedor.</p>
          </div>
          <label><input type="checkbox" name="allowAdminStockSales" ${settings.allowAdminStockSales ? 'checked' : ''}> Pode pedir estoque do admin</label>
          <label><input type="checkbox" name="allowConsignment" ${settings.allowConsignment ? 'checked' : ''}> Pode vender consignado</label>
          <label><input type="checkbox" name="allowPublicCartLinks" ${settings.allowPublicCartLinks ? 'checked' : ''}> Pode gerar link publico</label>
          <label>Desconto maximo (%)
            <input name="maxDiscountPercent" type="number" min="0" max="100" step="0.01" value="${U.escapeHtml(settings.maxDiscountPercent || 0)}">
          </label>
          <button type="submit" class="small">Salvar permissao</button>
          <div class="seller-permission-stock-adjust">
            ${credits > 0 ? UI.badge('Acerto de estoque liberado', 'ok') : UI.badge('Sem acerto liberado')}
            <button type="button" class="small secondary" data-cart-action="grant-stock-adjustment" data-seller-id="${U.escapeHtml(seller.id)}" ${credits > 0 ? 'disabled' : ''}>Liberar 1 acerto de estoque</button>
          </div>
        </form>
      `;
    }).join('');
    return UI.section(
      'Permissoes dos vendedores',
      'Controle quem pode usar consignado, estoque do admin e links publicos.',
      `${settingsFeedback ? UI.formNotice(settingsFeedback.message, settingsFeedback.type) : ''}<div class="seller-permission-grid">${cards || '<div class="empty-state"><strong>Nenhum vendedor ativo.</strong><span>Crie vendedores para configurar permissoes.</span></div>'}</div><p class="hint-inline">"Liberar 1 acerto de estoque" da ao vendedor uma unica correcao do proprio estoque (util para quem ja tinha mercadoria mas nunca fez o acerto certo). Depois de usado, o credito zera e precisa ser liberado de novo.</p>`
    );
  }
  function renderAdminApprovals(feedback) {
    if (!isAdmin()) return '';
    const carts = (state().saleCarts || []).filter((cart) => cart.source === 'admin_stock' && cart.status === 'pending_approval');
    const cards = carts.map((cart) => {
      const items = itemsForCart(cart.id);
      const itemRows = items.map((item) => {
        const product = productById(item.productId);
        const approved = item.approvedQuantity == null ? item.quantity : item.approvedQuantity;
        return `
          <label class="approval-line">
            <span>${U.escapeHtml(product ? product.name : 'Produto removido')} <small>${U.qty(item.quantity, product?.unit)} pedido</small></span>
            <input data-approve-item="${U.escapeHtml(item.id)}" type="number" min="0" step="0.001" max="${U.escapeHtml(item.quantity)}" value="${U.escapeHtml(approved)}">
          </label>
        `;
      }).join('');
      return `
        <article class="approval-cart-card" data-approval-cart="${U.escapeHtml(cart.id)}">
          <div class="approval-card-head">
            <strong>${U.escapeHtml(cart.customerName || 'Cliente nao informado')}</strong>
            ${statusBadge(cart.status)}
          </div>
          <p>Vendedor: <strong>${U.escapeHtml(sellerName(cart.sellerId))}</strong> - Total pedido: <strong>${U.money(cartTotal(items))}</strong></p>
          <div class="approval-items">${itemRows}</div>
          <label>Observacao para rejeicao/ajuste
            <input data-rejection-note placeholder="Opcional">
          </label>
          <div class="actions">
            <button type="button" data-cart-action="approve-cart" data-cart-id="${U.escapeHtml(cart.id)}">Aprovar liberado</button>
            <button type="button" class="danger" data-cart-action="reject-cart" data-cart-id="${U.escapeHtml(cart.id)}">Rejeitar</button>
          </div>
        </article>
      `;
    });
    return UI.section(
      'Aprovacoes de carrinho',
      'Pedidos feitos com estoque do administrador. Ajuste as quantidades antes de aprovar; o restante fica rejeitado.',
      `${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}<div class="approval-cart-list">${cards.join('') || '<div class="empty-state"><strong>Nenhum carrinho aguardando aprovacao.</strong><span>Quando vendedor usar estoque do admin, aparece aqui.</span></div>'}</div>`
    );
  }

  function mount(container, options = {}) {
    const draft = persistentDraft;
    let feedback = null;
    let approvalFeedback = null;
    let settingsFeedback = null;

    function paint() {
      container.innerHTML = [
        renderBuilder(draft, feedback),
        renderAdminSettings(settingsFeedback),
        renderAdminApprovals(approvalFeedback),
        renderCarts(),
      ].join('');
      const config = container.querySelector('[data-cart-config]');
      if (config) {
        config.source.value = draft.source;
        config.paymentMode.value = draft.paymentMode;
        if (config.channel) config.channel.value = draft.channel || 'WhatsApp';
        if (config.customerName) config.customerName.value = draft.customerName || '';
        if (config.targetSellerId) config.targetSellerId.value = draft.targetSellerId || '';
        config.expiresHours.value = draft.expiresHours;
      }
    }

    function readConfig() {
      const config = container.querySelector('[data-cart-config]');
      if (!config) return;
      const data = U.formData(config);
      draft.source = data.source || 'seller_stock';
      draft.paymentMode = data.paymentMode || 'avista';
      draft.channel = data.channel || 'WhatsApp';
      draft.customerName = data.customerName || '';
      draft.expiresHours = data.expiresHours || '48';
      draft.targetSellerId = data.targetSellerId || draft.targetSellerId || '';
      draft.notes = data.notes || '';
      if (isAdmin() && draft.paymentMode === 'consignado') draft.source = 'admin_stock';
      if (!isAdmin()) draft.targetSellerId = '';
    }

    async function createCart(status) {
      const currentUser = user();
      if (!currentUser) throw new Error('Entre na sua conta antes de criar carrinho.');
      const expiresAt = new Date(Date.now() + U.number(draft.expiresHours, 48) * 60 * 60 * 1000).toISOString();
      const cart = await S().add('saleCarts', {
        sellerId: isAdmin() && draft.targetSellerId ? draft.targetSellerId : currentUser.id,
        source: draft.source,
        paymentMode: draft.paymentMode,
        status,
        channel: draft.channel || 'WhatsApp',
        customerName: draft.customerName || null,
        publicExpiresAt: status === 'shared' ? expiresAt : null,
        notes: draft.notes || '',
      });
      for (const item of draft.items) {
        // eslint-disable-next-line no-await-in-loop
        await S().add('saleCartItems', {
          cartId: cart.id,
          productId: item.productId,
          quantity: U.number(item.quantity),
          unitPrice: U.number(item.unitPrice),
        });
      }
      await S().refresh();
      return cart;
    }

    async function addToSellerStock(sellerId, productId, quantity) {
      const current = (state().sellerStock || []).find((row) => String(row.sellerId) === String(sellerId) && String(row.productId) === String(productId));
      const nextQuantity = U.number(current?.quantity) + U.number(quantity);
      if (current) {
        await S().update('sellerStock', current.id, { quantity: nextQuantity });
      } else {
        await S().add('sellerStock', { sellerId, productId, quantity: nextQuantity });
      }
    }

    async function transferAdminStockToSeller({ sellerId, productId, quantity, unitPrice, cartId, note }) {
      const product = productById(productId);
      const qty = U.number(quantity);
      if (!product) throw new Error('Produto nao encontrado no estoque do admin.');
      if (product.type === 'servico') throw new Error('Servico nao pode ser enviado em consignado.');
      if (qty <= 0) throw new Error('Quantidade precisa ser maior que zero.');
      if (U.number(product.currentStock) < qty) throw new Error(`${product.name} nao tem estoque suficiente para consignar.`);

      await S().update('products', product.id, { currentStock: U.number(product.currentStock) - qty });
      await S().recordMovement({
        date: U.today(),
        type: 'saida_envio_consignado',
        productId: product.id,
        quantity: -qty,
        unitCost: U.number(product.avgCost),
        totalCost: -(qty * U.number(product.avgCost)),
        notes: note || `Consignado ao vendedor ${sellerName(sellerId)} via carrinho ${cartId}`,
      });
      await addToSellerStock(sellerId, product.id, qty);
      const consignment = await S().add('consignments', {
        sellerId,
        clientId: null,
        productId: product.id,
        quantitySent: qty,
        quantitySold: 0,
        quantityReturned: 0,
        unitPrice,
        costAtSend: U.number(product.avgCost),
        amountPaid: 0,
        status: 'com_cliente',
        date: U.today(),
        notes: `Consignado ao vendedor via carrinho ${cartId}`,
      });
      if (consignment && consignment.id) {
        await S().add('consignmentEvents', {
          consignmentId: consignment.id,
          type: 'envio',
          date: U.today(),
          quantity: qty,
          amount: 0,
        });
      }
    }

    async function createAdminSellerConsignment() {
      if (!isAdmin()) throw new Error('Somente o administrador pode enviar consignado ao vendedor por aqui.');
      if (!draft.targetSellerId) throw new Error('Selecione o vendedor que recebera o consignado.');
      if (!draft.items.length) throw new Error('Adicione pelo menos um item ao carrinho.');
      draft.source = 'admin_stock';
      draft.paymentMode = 'consignado';
      const targetSellerId = draft.targetSellerId;
      const cart = await createCart('converted');
      for (const item of draft.items) {
        // eslint-disable-next-line no-await-in-loop
        await transferAdminStockToSeller({
          sellerId: targetSellerId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          cartId: cart.id,
        });
      }
      await S().refresh();
      return cart;
    }

    async function convertOwnStockCart(cart) {
      const items = itemsForCart(cart.id);
      for (const item of items) {
        const product = productById(item.productId);
        // eslint-disable-next-line no-await-in-loop
        await api().consumeSellerStock({ productId: item.productId, quantity: item.quantity });
        // eslint-disable-next-line no-await-in-loop
        const consignment = await S().add('consignments', {
          sellerId: cart.sellerId,
          clientId: cart.clientId || null,
          productId: item.productId,
          quantitySent: item.quantity,
          quantitySold: cart.paymentMode === 'avista' ? item.quantity : 0,
          quantityReturned: 0,
          unitPrice: item.unitPrice,
          costAtSend: product ? product.avgCost : null,
          amountPaid: 0,
          status: 'com_cliente',
          date: U.today(),
          notes: `Carrinho ${cart.id}`,
        });
        if (consignment && consignment.id && cart.paymentMode === 'avista') {
          // eslint-disable-next-line no-await-in-loop
          await S().add('consignmentEvents', {
            consignmentId: consignment.id,
            type: 'venda_cliente',
            date: U.today(),
            quantity: item.quantity,
            amount: U.number(item.quantity) * U.number(item.unitPrice),
          });
        }
      }
      await S().update('saleCarts', cart.id, { status: 'converted' });
      await S().refresh();
    }

    async function approveCart(cartId, approvedByAdmin) {
      const card = container.querySelector(`[data-approval-cart="${CSS.escape(cartId)}"]`);
      const cart = (state().saleCarts || []).find((item) => String(item.id) === String(cartId));
      if (!cart) throw new Error('Carrinho nao encontrado.');
      const items = itemsForCart(cartId);
      let approvedAny = false;
      let rejectedAny = false;
      const note = card?.querySelector('[data-rejection-note]')?.value || '';
      for (const item of items) {
        const input = card?.querySelector(`[data-approve-item="${CSS.escape(item.id)}"]`);
        const qty = approvedByAdmin ? Math.min(U.number(input?.value), U.number(item.quantity)) : 0;
        if (qty > 0) approvedAny = true;
        if (qty < U.number(item.quantity)) rejectedAny = true;
        // eslint-disable-next-line no-await-in-loop
        await S().update('saleCartItems', item.id, {
          approvedQuantity: qty,
          rejectionReason: qty < U.number(item.quantity) ? (note || 'Quantidade nao liberada pelo admin.') : null,
        });
        if (qty > 0) {
          if (cart.paymentMode === 'consignado') {
            // eslint-disable-next-line no-await-in-loop
            await transferAdminStockToSeller({
              sellerId: cart.sellerId,
              productId: item.productId,
              quantity: qty,
              unitPrice: item.unitPrice,
              cartId: cart.id,
              note: `Consignado aprovado para ${sellerName(cart.sellerId)} via carrinho ${cart.id}${note ? ` - ${note}` : ''}`,
            });
          } else {
            // eslint-disable-next-line no-await-in-loop
            await S().add('orders', {
              sellerId: cart.sellerId,
              clientId: cart.clientId || null,
              productId: item.productId,
              quantity: qty,
              unitPrice: item.unitPrice,
              dueDate: null,
              status: 'pendente',
              notes: `Liberado pelo carrinho ${cart.id}${note ? ` - ${note}` : ''}`,
              convertedSaleId: null,
              approvalStatus: 'aprovado',
            });
          }
        }
      }
      const status = approvedAny ? (rejectedAny ? 'partially_approved' : 'approved') : 'rejected';
      await S().update('saleCarts', cartId, {
        status,
        approvedAt: approvedAny ? new Date().toISOString() : null,
        approvedBy: approvedAny ? user().id : null,
      });
      await S().refresh();
    }

    container.addEventListener('change', (event) => {
      if (event.target.closest('[data-cart-config]')) {
        readConfig();
        paint();
      }
    });

    container.addEventListener('submit', async (event) => {
      const settingsForm = event.target.closest('[data-seller-settings-form]');
      if (settingsForm) {
        event.preventDefault();
        try {
          const sellerId = settingsForm.dataset.sellerId;
          const current = settingForSeller(sellerId);
          const payload = {
            sellerId,
            allowAdminStockSales: !!settingsForm.elements.allowAdminStockSales.checked,
            allowConsignment: !!settingsForm.elements.allowConsignment.checked,
            allowPublicCartLinks: !!settingsForm.elements.allowPublicCartLinks.checked,
            maxDiscountPercent: U.number(settingsForm.elements.maxDiscountPercent.value),
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
        return;
      }

      const form = event.target.closest('[data-cart-add-item]');
      if (!form) return;
      event.preventDefault();
      readConfig();
      const data = U.formData(form);
      const product = productById(data.productId);
      if (!product) return;
      draft.items.push({
        productId: data.productId,
        quantity: U.number(data.quantity),
        unitPrice: U.number(data.unitPrice || product.defaultPrice || product.salePrice),
      });
      form.reset();
      feedback = null;
      paint();
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cart-action]');
      if (!button) return;
      const action = button.dataset.cartAction;
      try {
        readConfig();
        if (action === 'remove-draft-item') {
          draft.items.splice(Number(button.dataset.index), 1);
        } else if (action === 'clear-draft') {
          draft.items = [];
          draft.lastLink = '';
          draft.customerName = '';
        } else if (action === 'save-cart') {
          if (isAdmin() && draft.paymentMode === 'consignado') {
            await createAdminSellerConsignment();
            draft.items = [];
            draft.lastLink = '';
            draft.customerName = '';
            feedback = { message: 'Consignado enviado ao vendedor. Estoque central baixado e estoque proprio atualizado.', type: 'success' };
          } else {
            const status = draft.source === 'admin_stock' ? 'pending_approval' : 'submitted';
            await createCart(status);
            draft.items = [];
            draft.lastLink = '';
            draft.customerName = '';
            feedback = { message: status === 'pending_approval' ? 'Pedido enviado para aprovacao do admin.' : 'Carrinho salvo.', type: 'success' };
          }
        } else if (action === 'share-cart') {
          const cart = await createCart('shared');
          draft.items = [];
          draft.lastLink = publicUrl(cart);
          draft.customerName = '';
          feedback = { message: 'Link publico criado. Ele expira no prazo escolhido.', type: 'success' };
        } else if (action === 'copy-link') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart) await navigator.clipboard.writeText(publicUrl(cart));
          feedback = { message: 'Link copiado.', type: 'success' };
        } else if (action === 'convert-own-stock') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart) await convertOwnStockCart(cart);
          feedback = { message: 'Estoque proprio baixado e consignado registrado.', type: 'success' };
        } else if (action === 'approve-cart') {
          await approveCart(button.dataset.cartId, true);
          approvalFeedback = { message: 'Carrinho aprovado. Quantidades nao liberadas ficaram rejeitadas.', type: 'success' };
        } else if (action === 'reject-cart') {
          if (!confirm('Rejeitar este carrinho?')) return;
          await approveCart(button.dataset.cartId, false);
          approvalFeedback = { message: 'Carrinho rejeitado.', type: 'warning' };
        } else if (action === 'grant-stock-adjustment') {
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
        }
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    paint();
  }

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
              <label>Nome
                <input name="customer_name" required value="${U.escapeHtml(data.cart.customer_name || '')}">
              </label>
              <label>WhatsApp
                <input name="customer_phone" value="${U.escapeHtml(data.cart.customer_phone || '')}">
              </label>
              <label>Comprovante (imagem ou PDF)
                <input name="payment_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
              </label>
              <label>Observacoes
                <textarea name="customer_notes">${U.escapeHtml(data.cart.customer_notes || '')}</textarea>
              </label>
              <button type="submit">Enviar pedido</button>
            </form>
          </section>
        </main>
      `;
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

  window.C360.salesCart = { mount, mountPublic };
})();
