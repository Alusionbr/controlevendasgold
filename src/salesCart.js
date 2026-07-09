(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const Calc = window.C360.calc;

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
  // Vendas/Pedidos a cada renderAll() (qualquer acao na tela dispara isso),
  // e mount() e chamado de novo - se o draft fosse uma variavel local do
  // fecho de mount(), cada remount zeraria os itens ja adicionados ao
  // carrinho. Mantendo o objeto no escopo do modulo, ele sobrevive a
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
    paidInitialAmount: '0',
    items: [],
    lastLink: '',
    editingCartId: '',
  };

  const PAYMENT_MODE_LABELS = { avista: 'A vista', parcial: 'Parcial', consignado: 'Consignado' };

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
      stockAdjustmentCredits: 0,
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

  function productsForDraft(draft) {
    const base = (state().products || []).filter((product) => !['materia_prima', 'embalagem'].includes(product.type));
    if (!isAdmin() && draft.source === 'seller_stock') {
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
    draft.paidInitialAmount = '0';
    draft.editingCartId = '';
  }

  function loadDraftFromCart(draft, cart, asAdjustment = false) {
    draft.source = cart.source || 'seller_stock';
    draft.paymentMode = cart.paymentMode || 'avista';
    draft.channel = cart.channel || 'WhatsApp';
    draft.customerName = cart.customerName || '';
    draft.notes = asAdjustment ? `Acerto do carrinho ${cart.id}` : (cart.notes || '');
    draft.paidInitialAmount = cart.paidInitialAmount || '0';
    draft.expiresHours = draft.expiresHours || '48';
    draft.targetSellerId = isAdmin() ? (cart.sellerId || '') : '';
    draft.editingCartId = asAdjustment ? '' : cart.id;
    draft.items = itemsForCart(cart.id).map((item) => ({
      productId: item.productId,
      quantity: U.number(item.quantity),
      unitPrice: U.number(item.unitPrice),
    }));
  }

  function canEditCart(cart) {
    if (!cart) return false;
    if (cart.status === 'converted') return true;
    if (isAdmin()) return !['approved', 'partially_approved', 'rejected', 'expired'].includes(cart.status);
    return String(cart.sellerId) === String(user()?.id) && ['draft', 'shared', 'submitted', 'pending_approval'].includes(cart.status);
  }

  function canDeleteCart(cart) {
    if (!cart || cart.status === 'converted') return false;
    if (isAdmin()) return !['approved', 'partially_approved'].includes(cart.status);
    return String(cart.sellerId) === String(user()?.id) && ['draft', 'shared', 'submitted', 'pending_approval'].includes(cart.status);
  }

  function canConfirmOwnStockCart(cart) {
    return cart
      && cart.source === 'seller_stock'
      && ['submitted', 'shared'].includes(cart.status)
      && String(cart.sellerId) === String(user()?.id);
  }

  function renderBuilder(draft, feedback) {
    const currentUser = user();
    const settings = currentUser && currentUser.role === 'vendedor' ? settingForSeller(currentUser.id) : {
      allowAdminStockSales: true,
      allowConsignment: true,
      allowPublicCartLinks: true,
    };
    const products = productsForDraft(draft);
    const allowAdminSource = isAdmin() || settings.allowAdminStockSales;
    const allowConsignment = isAdmin() || settings.allowConsignment;
    const sourceOptions = [
      '<option value="seller_stock">Meu estoque</option>',
      allowAdminSource ? '<option value="admin_stock">Estoque do administrador</option>' : '',
    ].join('');
    const paymentOptions = [
      '<option value="avista">A vista</option>',
      '<option value="parcial">Parcial</option>',
      allowConsignment ? '<option value="consignado">Consignado</option>' : '',
    ].join('');
    const channelOptions = UI.optionList(state().settings.channels, draft.channel || 'WhatsApp', '');
    const sellers = (state().profiles || []).filter((profile) => profile.role === 'vendedor' && profile.active !== false);
    const editingCart = draft.editingCartId ? (state().saleCarts || []).find((cart) => String(cart.id) === String(draft.editingCartId)) : null;
    const sellerTargetField = isAdmin() && draft.paymentMode === 'consignado'
      ? `<label>Vendedor consignado
          <select name="targetSellerId" required>${UI.optionList(sellers, draft.targetSellerId || '', sellers.length ? 'Selecione o vendedor' : 'Nenhum vendedor ativo')}</select>
        </label>`
      : '';
    const paidInitialField = draft.paymentMode === 'parcial'
      ? `<label>Valor pago agora
          <input name="paidInitialAmount" type="number" step="0.01" min="0" value="${U.escapeHtml(draft.paidInitialAmount || '0')}">
        </label>`
      : '';
    const productCards = products.slice(0, 18).map((product) => {
      const ownStock = ownStockForProduct(product.id);
      const stockHint = !isAdmin() && draft.source === 'seller_stock'
        ? `<small>${U.qty(ownStock?.quantity || 0, product.unit)} no seu estoque</small>`
        : (product.stockHidden ? '<small>Disponibilidade protegida</small>' : '');
      return `
        <button type="button" class="cart-product-pick" data-cart-action="quick-add-product" data-product-id="${U.escapeHtml(product.id)}">
          <strong>${U.escapeHtml(product.name)}</strong>
          <span>${U.money(resolvedUnitPrice(product))}</span>
          ${stockHint}
        </button>
      `;
    }).join('');
    const itemCards = draft.items.map((item, index) => {
      const product = productById(item.productId);
      const total = U.number(item.quantity) * U.number(item.unitPrice);
      return `
        <article class="cart-draft-item">
          <div>
            <strong>${U.escapeHtml(product ? product.name : 'Produto')}</strong>
            <span>${U.money(item.unitPrice)} cada</span>
          </div>
          <div class="cart-stepper">
            <button type="button" class="small ghost" data-cart-action="dec-draft-item" data-index="${index}">-</button>
            <input data-draft-qty="${index}" type="number" min="0.001" step="0.001" value="${U.escapeHtml(item.quantity)}" aria-label="Quantidade">
            <button type="button" class="small ghost" data-cart-action="inc-draft-item" data-index="${index}">+</button>
          </div>
          <strong>${U.money(total)}</strong>
          <button type="button" class="small danger" data-cart-action="remove-draft-item" data-index="${index}">Remover</button>
        </article>
      `;
    }).join('');
    const linkHint = draft.lastLink
      ? `<div class="notice success"><strong>Link criado:</strong><br><input readonly value="${U.escapeHtml(draft.lastLink)}" onfocus="this.select()"></div>`
      : '';
    const modeHint = draft.source === 'admin_stock'
      ? 'Este carrinho vira pedido para aprovacao do administrador.'
      : 'Salve o carrinho e confirme a venda quando o produto for entregue ou enviado.';

    return `
      ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
      ${linkHint}
      <div class="sales-cart-layout sales-cart-layout-modern">
        <article class="panel-card sales-cart-builder">
          <div class="cart-panel-head">
            <div>
              <h3>${editingCart ? 'Editando carrinho' : 'Novo carrinho'}</h3>
              <p>${U.escapeHtml(modeHint)}</p>
            </div>
            ${editingCart ? UI.badge('Edicao') : ''}
          </div>
          <form data-cart-config class="cart-config-grid">
            <label>Origem
              <select name="source">${sourceOptions}</select>
            </label>
            <label>Pagamento
              <select name="paymentMode">${paymentOptions}</select>
            </label>
            <label>Canal
              <select name="channel">${channelOptions}</select>
            </label>
            <label>Cliente ou apelido
              <input name="customerName" value="${U.escapeHtml(draft.customerName || '')}" placeholder="Nome para identificar">
            </label>
            ${sellerTargetField}
            ${paidInitialField}
            <label>Validade do link
              <select name="expiresHours">
                <option value="24">24 horas</option>
                <option value="48" selected>48 horas</option>
                <option value="72">72 horas</option>
                <option value="168">7 dias</option>
              </select>
            </label>
            <label class="wide">Observacoes
              <input name="notes" value="${U.escapeHtml(draft.notes || '')}" placeholder="Entrega, combinado, ajuste, troca...">
            </label>
          </form>

          <div class="cart-product-grid">
            ${productCards || '<div class="empty-state"><strong>Nenhum produto disponivel.</strong><span>Use estoque do admin ou peca reposicao.</span></div>'}
          </div>

          <form data-cart-add-item class="cart-manual-add">
            <select name="productId" required>${productOptions(products)}</select>
            <input name="quantity" type="number" step="0.001" min="0.001" placeholder="Qtd." required>
            <input name="unitPrice" type="number" step="0.01" min="0.01" placeholder="Preco">
            <button type="submit">Adicionar</button>
          </form>
        </article>

        <article class="panel-card sales-cart-summary">
          <div class="cart-panel-head">
            <div>
              <h3>Carrinho atual</h3>
              <p>${draft.items.length} item(ns)</p>
            </div>
            <strong>${U.money(cartTotal(draft.items))}</strong>
          </div>
          <div class="cart-draft-list">${itemCards || '<div class="empty-state"><strong>Carrinho vazio.</strong><span>Toque em um produto para adicionar.</span></div>'}</div>
          ${draft.paymentMode === 'parcial' ? `<p class="hint-inline">Fica devendo antes do ajuste do admin: <strong>${U.money(Math.max(cartTotal(draft.items) - U.number(draft.paidInitialAmount), 0))}</strong></p>` : ''}
          <div class="actions cart-primary-actions">
            <button type="button" data-cart-action="save-cart" ${draft.items.length ? '' : 'disabled'}>${editingCart ? 'Salvar alteracoes' : 'Salvar carrinho'}</button>
            <button type="button" class="secondary" data-cart-action="share-cart" ${draft.items.length && draft.paymentMode === 'avista' && settings.allowPublicCartLinks ? '' : 'disabled'}>Gerar link</button>
            <button type="button" class="ghost" data-cart-action="clear-draft">Limpar</button>
          </div>
        </article>
      </div>
    `;
  }

  function renderCartStats(carts) {
    const sales = (state().sales || []).filter((sale) => String(sale.sellerId || '') === String(user()?.id || '') || isAdmin());
    const openDebt = (state().sellerAccountEntries || []).reduce((sum, entry) => sum + (entry.direction === 'debit' ? U.number(entry.amount) : -U.number(entry.amount)), 0);
    const saved = carts.filter((cart) => ['draft', 'submitted', 'shared'].includes(cart.status)).length;
    const waiting = carts.filter((cart) => cart.status === 'pending_approval').length;
    return `
      <div class="sales-cart-kpis">
        ${UI.metric('Carrinhos salvos', String(saved))}
        ${UI.metric('Aguardando admin', String(waiting))}
        ${UI.metric('Faturamento', U.money(sales.reduce((sum, sale) => sum + U.number(sale.netRevenue), 0)))}
        ${!isAdmin() ? UI.metric('Debito com central', U.money(Math.max(openDebt, 0))) : ''}
      </div>
    `;
  }

  function renderCarts() {
    const carts = state().saleCarts || [];
    const cards = carts.slice(0, 60).map((cart) => {
      const items = itemsForCart(cart.id);
      const itemText = items.map((item) => {
        const product = productById(item.productId);
        return `<li><span>${U.escapeHtml(product ? product.name : 'Produto')}</span><strong>${U.qty(item.quantity, product?.unit)}</strong></li>`;
      }).join('');
      const actions = [];
      if (canConfirmOwnStockCart(cart)) actions.push(`<button type="button" class="small" data-cart-action="confirm-own-stock" data-cart-id="${U.escapeHtml(cart.id)}">Confirmar venda</button>`);
      if (canEditCart(cart)) actions.push(`<button type="button" class="small secondary" data-cart-action="edit-cart" data-cart-id="${U.escapeHtml(cart.id)}">${cart.status === 'converted' ? 'Criar acerto' : 'Editar'}</button>`);
      if (cart.publicToken) actions.push(`<button type="button" class="small secondary" data-cart-action="copy-link" data-cart-id="${U.escapeHtml(cart.id)}">Copiar link</button>`);
      if (canDeleteCart(cart)) actions.push(`<button type="button" class="small danger" data-cart-action="delete-cart" data-cart-id="${U.escapeHtml(cart.id)}">Excluir</button>`);
      return `
        <article class="cart-saved-card">
          <header>
            <div>
              <strong>${U.escapeHtml(cart.customerName || 'Carrinho sem nome')}</strong>
              <span>${U.escapeHtml(sourceLabel(cart.source))} - ${U.escapeHtml(PAYMENT_MODE_LABELS[cart.paymentMode] || cart.paymentMode)} - ${U.escapeHtml(cart.channel || 'Canal')}</span>
            </div>
            ${statusBadge(cart.status)}
          </header>
          <ul>${itemText || '<li><span>Sem itens</span></li>'}</ul>
          <footer>
            <strong>${U.money(cartTotal(items))}</strong>
            <div class="actions">${actions.join('')}</div>
          </footer>
        </article>
      `;
    }).join('');
    return UI.section(
      'Carrinhos e vendas',
      'Salve varios carrinhos, edite antes da aprovacao e confirme a venda quando entregar ou enviar.',
      `${renderCartStats(carts)}<div class="cart-saved-grid">${cards || '<div class="empty-state"><strong>Nenhum carrinho ainda.</strong><span>Crie o primeiro carrinho acima.</span></div>'}</div>`
    );
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

  function mountSettings(container, options = {}) {
    if (!container) return null;
    let settingsFeedback = null;

    function paint() {
      container.innerHTML = renderAdminSettings(settingsFeedback);
    }

    container.addEventListener('submit', async (event) => {
      const settingsForm = event.target.closest('[data-seller-settings-form]');
      if (!settingsForm) return;
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
          <p>Pagamento: <strong>${U.escapeHtml(PAYMENT_MODE_LABELS[cart.paymentMode] || cart.paymentMode)}</strong>${cart.paymentMode !== 'avista' ? ` - Pago no pedido: <strong>${U.money(cart.paidInitialAmount)}</strong>` : ''}</p>
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

  // ---------------------------------------------------------------------
  // Regras de negocio do carrinho — vivem no escopo do modulo (nao dentro
  // de mount()) para que mountApprovals() (aba "Aprovacoes", tela dedicada
  // do admin) reuse a mesma logica sem duplicar codigo. Ver
  // docs/replication-v1/03-fase2-reposicao-carrinhos.md.
  // ---------------------------------------------------------------------

  // Valor pago no ato do pedido: a vista = tudo; consignado = nada; parcial
  // = o que o vendedor informar (nunca mais que o total do carrinho). Vira
  // sale_carts.paid_initial_amount.
  function resolvePaidInitialAmount(draft) {
    const total = cartTotal(draft.items);
    if (draft.paymentMode === 'avista') return total;
    if (draft.paymentMode === 'parcial') return Math.min(U.number(draft.paidInitialAmount), total);
    return 0;
  }

  async function createCart(draft, status) {
    const currentUser = user();
    if (!currentUser) throw new Error('Entre na sua conta antes de criar carrinho.');
    const expiresAt = new Date(Date.now() + U.number(draft.expiresHours, 48) * 60 * 60 * 1000).toISOString();
    const finalStatus = status || 'draft';
    const cart = await S().add('saleCarts', {
      sellerId: isAdmin() && draft.targetSellerId ? draft.targetSellerId : currentUser.id,
      source: draft.source,
      paymentMode: draft.paymentMode,
      status: 'draft',
      channel: draft.channel || 'WhatsApp',
      customerName: draft.customerName || null,
      publicExpiresAt: null,
      paidInitialAmount: resolvePaidInitialAmount(draft),
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
    const finalPatch = {
      status: finalStatus,
      publicExpiresAt: finalStatus === 'shared' ? expiresAt : null,
    };
    const finalCart = finalStatus === 'draft' ? cart : await S().update('saleCarts', cart.id, finalPatch);
    await S().refresh();
    return { ...cart, ...finalCart };
  }

  async function replaceCartItems(cartId, items) {
    const currentItems = itemsForCart(cartId);
    for (const item of currentItems) {
      // eslint-disable-next-line no-await-in-loop
      await S().remove('saleCartItems', item.id);
    }
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await S().add('saleCartItems', {
        cartId,
        productId: item.productId,
        quantity: U.number(item.quantity),
        unitPrice: U.number(item.unitPrice),
      });
    }
  }

  async function saveDraftAsCart(draft, status) {
    if (!draft.editingCartId) return createCart(draft, status);
    const currentUser = user();
    const expiresAt = new Date(Date.now() + U.number(draft.expiresHours, 48) * 60 * 60 * 1000).toISOString();
    const cart = await S().update('saleCarts', draft.editingCartId, {
      sellerId: isAdmin() && draft.targetSellerId ? draft.targetSellerId : currentUser.id,
      source: draft.source,
      paymentMode: draft.paymentMode,
      status,
      channel: draft.channel || 'WhatsApp',
      customerName: draft.customerName || null,
      publicExpiresAt: status === 'shared' ? expiresAt : null,
      paidInitialAmount: resolvePaidInitialAmount(draft),
      notes: draft.notes || '',
    });
    await replaceCartItems(draft.editingCartId, draft.items);
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

  // amountPaid: fatia ja quitada deste envio (0 para consignado puro; >0
  // para reposicao parcial aprovada — ver approveCart). Registrado tanto no
  // consignments.amount_paid quanto num consignment_events tipo 'pagamento',
  // para o historico bater com o que o admin ve na tela de consignado.
  async function transferAdminStockToSeller({ sellerId, productId, quantity, unitPrice, amountPaid = 0, cartId, note }) {
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
      if (paid > 0) {
        await S().add('consignmentEvents', {
          consignmentId: consignment.id,
          type: 'pagamento',
          date: U.today(),
          quantity: 0,
          amount: paid,
        });
      }
    }
  }

  async function createAdminSellerConsignment(draft) {
    if (!isAdmin()) throw new Error('Somente o administrador pode enviar consignado ao vendedor por aqui.');
    if (!draft.targetSellerId) throw new Error('Selecione o vendedor que recebera o consignado.');
    if (!draft.items.length) throw new Error('Adicione pelo menos um item ao carrinho.');
    draft.source = 'admin_stock';
    draft.paymentMode = 'consignado';
    const targetSellerId = draft.targetSellerId;
    const cart = await createCart(draft, 'converted');
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

  function saleMathForCart({ quantity, unitPrice, unitCost }) {
    if (Calc && typeof Calc.saleMath === 'function') {
      return Calc.saleMath({ quantity, unitPrice, discount: 0, fixedFees: 0, feePercent: 0, unitCost });
    }
    const grossRevenue = U.number(quantity) * U.number(unitPrice);
    const cogs = U.number(quantity) * U.number(unitCost);
    const grossProfit = grossRevenue - cogs;
    return {
      grossRevenue,
      netRevenue: grossRevenue,
      percentFees: 0,
      cogs,
      grossProfit,
      margin: grossRevenue > 0 ? grossProfit / grossRevenue : 0,
    };
  }

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
        channel: cart.channel || 'Carrinho',
        clientId: cart.clientId || null,
        productId: item.productId,
        quantity,
        unitPrice,
        discount: 0,
        fixedFees: 0,
        feePercent: 0,
        unitCost,
        ...math,
        notes: `Venda pelo carrinho ${cart.id}${cart.customerName ? ` - ${cart.customerName}` : ''}`,
        origin: 'pedido',
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
        notes: `Venda pelo carrinho ${cart.id}`,
      });
      if (consignment && consignment.id) {
        // eslint-disable-next-line no-await-in-loop
        await S().add('consignmentEvents', {
          consignmentId: consignment.id,
          type: 'venda_cliente',
          date: U.today(),
          quantity,
          amount: quantity * unitPrice,
        });
      }
      if (sale && sale.id) {
        // venda gravada para painel/metas; consignado guarda acerto com admin
      }
    }
    await S().update('saleCarts', cart.id, { status: 'converted' });
    await S().refresh();
  }

  // Aprovacao com ajuste/parcial: admin decide quanto de cada item libera
  // (approvedQuantity), o financeiro usa sempre o total APROVADO (nunca o
  // solicitado — regra central do pacote de replicacao). Reposicao
  // consignado ou parcial vira consignacao admin->vendedor (com a fatia
  // proporcional do que ja foi pago); a vista vira so um registro
  // logistico em orders (sem divida).
  async function approveCart(container, cartId, approvedByAdmin) {
    const card = container.querySelector(`[data-approval-cart="${CSS.escape(cartId)}"]`);
    const cart = (state().saleCarts || []).find((item) => String(item.id) === String(cartId));
    if (!cart) throw new Error('Carrinho nao encontrado.');
    const items = itemsForCart(cartId);
    const note = card?.querySelector('[data-rejection-note]')?.value || '';

    const approvedQuantities = items.map((item) => {
      const input = card?.querySelector(`[data-approve-item="${CSS.escape(item.id)}"]`);
      return approvedByAdmin ? Math.min(U.number(input?.value), U.number(item.quantity)) : 0;
    });
    const totalAprovado = items.reduce((sum, item, index) => sum + approvedQuantities[index] * U.number(item.unitPrice), 0);
    const paidInitial = Math.min(U.number(cart.paidInitialAmount), totalAprovado);

    let approvedAny = false;
    let rejectedAny = false;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const qty = approvedQuantities[index];
      if (qty > 0) approvedAny = true;
      if (qty < U.number(item.quantity)) rejectedAny = true;
      // eslint-disable-next-line no-await-in-loop
      await S().update('saleCartItems', item.id, {
        approvedQuantity: qty,
        rejectionReason: qty < U.number(item.quantity) ? (note || 'Quantidade nao liberada pelo admin.') : null,
      });
      if (qty > 0) {
        const itemTotal = qty * U.number(item.unitPrice);
        const itemPaid = totalAprovado > 0 ? (itemTotal / totalAprovado) * paidInitial : 0;
        const itemDebt = Math.max(itemTotal - itemPaid, 0);
        if (cart.paymentMode === 'consignado' || cart.paymentMode === 'parcial') {
          // eslint-disable-next-line no-await-in-loop
          await transferAdminStockToSeller({
            sellerId: cart.sellerId,
            productId: item.productId,
            quantity: qty,
            unitPrice: item.unitPrice,
            amountPaid: itemPaid,
            cartId: cart.id,
            note: `${cart.paymentMode === 'parcial' ? 'Reposicao parcial' : 'Consignado'} aprovado para ${sellerName(cart.sellerId)} via carrinho ${cart.id}${note ? ` - ${note}` : ''}`,
          });
          if (itemDebt > 0) {
            // Fase 3 (ledger): a divida so entra sobre a quantidade
            // APROVADA, nunca a solicitada. Ver docs/replication-v1/
            // 04-fase3-ledger-vendedor.md.
            // eslint-disable-next-line no-await-in-loop
            await S().add('sellerAccountEntries', {
              sellerId: cart.sellerId,
              type: 'debit_replenishment',
              direction: 'debit',
              amount: itemDebt,
              sourceType: 'sale_cart_item',
              sourceId: item.id,
              notes: `Reposicao (${PAYMENT_MODE_LABELS[cart.paymentMode] || cart.paymentMode}) via carrinho ${cart.id}`,
            });
          }
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

  function mount(container, options = {}) {
    const draft = persistentDraft;
    let feedback = null;
    let settingsFeedback = null;

    function paint() {
      container.innerHTML = [
        renderBuilder(draft, feedback),
        renderAdminSettings(settingsFeedback),
        renderCarts(),
      ].join('');
      const config = container.querySelector('[data-cart-config]');
      if (config) {
        config.source.value = draft.source;
        config.paymentMode.value = draft.paymentMode;
        if (config.channel) config.channel.value = draft.channel || 'WhatsApp';
        if (config.customerName) config.customerName.value = draft.customerName || '';
        if (config.targetSellerId) config.targetSellerId.value = draft.targetSellerId || '';
        if (config.paidInitialAmount) config.paidInitialAmount.value = draft.paidInitialAmount || '0';
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
      draft.paidInitialAmount = data.paidInitialAmount || draft.paidInitialAmount || '0';
      if (isAdmin() && draft.paymentMode === 'consignado') draft.source = 'admin_stock';
      if (!isAdmin()) draft.targetSellerId = '';
    }

    container.addEventListener('change', (event) => {
      if (event.target.closest('[data-cart-config]')) {
        readConfig();
        paint();
        return;
      }
      const qtyInput = event.target.closest('[data-draft-qty]');
      if (qtyInput) {
        const item = draft.items[Number(qtyInput.dataset.draftQty)];
        if (item) item.quantity = U.number(qtyInput.value);
        draft.items = draft.items.filter((item) => U.number(item.quantity) > 0);
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
      if (event.target.closest('[data-cart-add-item] input[name="unitPrice"]')) {
        event.target.dataset.touched = '1';
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
      addDraftItem(draft, {
        productId: data.productId,
        quantity: U.number(data.quantity),
        unitPrice: U.number(data.unitPrice || resolvedUnitPrice(product)),
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
        } else if (action === 'save-cart') {
          if (isAdmin() && draft.paymentMode === 'consignado' && !draft.editingCartId) {
            await createAdminSellerConsignment(draft);
            resetDraft(draft);
            feedback = { message: 'Consignado enviado ao vendedor. Estoque central baixado e estoque proprio atualizado.', type: 'success' };
          } else {
            const status = draft.source === 'admin_stock' ? 'pending_approval' : 'submitted';
            await saveDraftAsCart(draft, status);
            resetDraft(draft);
            feedback = { message: status === 'pending_approval' ? 'Pedido enviado para aprovacao do admin.' : 'Carrinho salvo. Confirme a venda quando entregar ou enviar.', type: 'success' };
          }
        } else if (action === 'share-cart') {
          const cart = await saveDraftAsCart(draft, 'shared');
          resetDraft(draft, true);
          draft.lastLink = publicUrl(cart);
          feedback = { message: 'Link publico criado. Ele expira no prazo escolhido.', type: 'success' };
        } else if (action === 'copy-link') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart) await navigator.clipboard.writeText(publicUrl(cart));
          feedback = { message: 'Link copiado.', type: 'success' };
        } else if (action === 'confirm-own-stock' || action === 'convert-own-stock') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart) await convertOwnStockCart(cart);
          feedback = { message: 'Venda confirmada. O estoque proprio foi baixado automaticamente.', type: 'success' };
        } else if (action === 'edit-cart') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart) {
            loadDraftFromCart(draft, cart, cart.status === 'converted');
            feedback = { message: cart.status === 'converted' ? 'Carrinho vendido carregado como novo acerto.' : 'Carrinho carregado para edicao.', type: 'success' };
          }
        } else if (action === 'delete-cart') {
          const cart = (state().saleCarts || []).find((item) => String(item.id) === String(button.dataset.cartId));
          if (cart && confirm('Excluir este carrinho?')) {
            await S().remove('saleCarts', cart.id);
            await S().refresh();
            feedback = { message: 'Carrinho excluido.', type: 'success' };
          }
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

  // Tela dedicada "Aprovações" (admin) — só a fila de carrinhos pendentes do
  // estoque do administrador, com aprovação completa/ajustada/parcial ou
  // rejeição. Substitui a antiga tela de aprovação binária de `orders`
  // (Decisão 2, docs/replication-v1/01-decisoes-de-produto.md): reposição
  // padronizada em carrinhos, então este é o único lugar onde o admin
  // aprova pedidos de reposição do vendedor.
  function mountApprovals(container, options = {}) {
    let approvalFeedback = null;

    function paint() {
      container.innerHTML = renderAdminApprovals(approvalFeedback);
    }

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cart-action]');
      if (!button) return;
      const action = button.dataset.cartAction;
      try {
        if (action === 'approve-cart') {
          await approveCart(container, button.dataset.cartId, true);
          approvalFeedback = { message: 'Carrinho aprovado. Quantidades nao liberadas ficaram rejeitadas.', type: 'success' };
        } else if (action === 'reject-cart') {
          if (!confirm('Rejeitar este carrinho?')) return;
          await approveCart(container, button.dataset.cartId, false);
          approvalFeedback = { message: 'Carrinho rejeitado.', type: 'warning' };
        } else {
          return;
        }
      } catch (error) {
        approvalFeedback = { message: error.message, type: 'danger' };
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

  window.C360.salesCart = { mount, mountApprovals, mountSettings, mountPublic };
})();
