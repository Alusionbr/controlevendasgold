(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  const TYPE_LABELS = {
    debit_replenishment: 'Reposição',
    payment: 'Pagamento',
    return_credit: 'Devolução',
    manual_adjustment: 'Ajuste manual',
    writeoff: 'Baixa de dívida',
    bonus_credit: 'Bonificação',
  };

  function S() { return window.C360.state; }
  function Calc() { return window.C360.calc; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }

  function entriesForSeller(sellerId) {
    return (state().sellerAccountEntries || []).filter((entry) => String(entry.sellerId) === String(sellerId));
  }

  function paymentsForSeller(sellerId) {
    return (state().sellerPayments || []).filter((payment) => String(payment.sellerId) === String(sellerId));
  }

  function accountsForSeller(sellerId) {
    return (state().sellerOrderAccounts || []).filter((account) => String(account.sellerId) === String(sellerId));
  }

  function balanceFor(sellerId) {
    return Calc().sellerBalance(entriesForSeller(sellerId));
  }

  function openOrdersTotalFor(sellerId) {
    return accountsForSeller(sellerId).reduce((sum, account) => sum + U.number(account.openAmount), 0);
  }

  function legacyBalanceFor(sellerId) {
    return Math.max(balanceFor(sellerId) - openOrdersTotalFor(sellerId), 0);
  }

  function entryRow(entry) {
    const label = TYPE_LABELS[entry.type] || entry.type;
    const signedAmount = entry.direction === 'credit' ? -U.number(entry.amount) : U.number(entry.amount);
    return [
      (entry.createdAt || '').slice(0, 10),
      U.escapeHtml(label),
      UI.badge(entry.direction === 'credit' ? 'Crédito' : 'Débito', entry.direction === 'credit' ? 'ok' : ''),
      U.escapeHtml(entry.notes || ''),
      `<strong>${signedAmount < 0 ? '- ' : ''}${U.money(Math.abs(signedAmount))}</strong>`,
    ];
  }

  async function registerPayment(sellerId, { amount, method, notes } = {}) {
    const value = U.number(amount);
    if (value <= 0) throw new Error('Informe um valor maior que zero.');
    const api = window.C360.api;
    if (!api || typeof api.registerSellerPayment !== 'function') {
      throw new Error('Registro atômico de pagamento indisponível.');
    }
    const paymentId = await api.registerSellerPayment({
      sellerId,
      amount: value,
      method: method || null,
      notes: notes || '',
    });
    await S().refresh();
    return { id: paymentId };
  }

  async function registerOrderPayment(orderGroupId, { amount, method, notes } = {}) {
    const value = U.number(amount);
    if (!orderGroupId) throw new Error('Selecione o pedido que está sendo pago.');
    if (value <= 0) throw new Error('Informe um valor maior que zero.');
    const api = window.C360.api;
    if (!api || typeof api.registerSellerOrderPayment !== 'function') {
      throw new Error('Pagamento por pedido indisponível.');
    }
    const paymentId = await api.registerSellerOrderPayment({
      orderGroupId,
      amount: value,
      method: method || null,
      notes: notes || '',
    });
    await S().refresh();
    return { id: paymentId };
  }

  function ownStockRows(sellerId) {
    const st = state();
    return (st.sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0)
      .map((row) => {
        const product = (st.products || []).find((item) => String(item.id) === String(row.productId));
        return [
          product ? U.escapeHtml(product.name) : 'Produto removido',
          U.qty(row.quantity, product ? product.unit : ''),
        ];
      });
  }

  function accountStatus(account) {
    if (account.accountStatus === 'quitado' || U.number(account.openAmount) < 0.005) return UI.badge('Quitado', 'ok');
    if (account.accountStatus === 'parcial') return UI.badge('Parcial', 'warn');
    return UI.badge('Em aberto', 'warn');
  }

  function orderItemRows(account) {
    return (Array.isArray(account.items) ? account.items : []).map((item) => [
      U.escapeHtml(item.productName || 'Produto'),
      U.qty(item.quantity, item.unit || ''),
      U.qty(item.remainingQuantity, item.unit || ''),
      UI.moneyCell(item.unitPrice),
    ]);
  }

  function orderPaymentRows(account) {
    return (Array.isArray(account.payments) ? account.payments : []).map((payment) => [
      String(payment.date || '').slice(0, 10),
      U.escapeHtml(payment.method || '—'),
      U.escapeHtml(payment.notes || ''),
      UI.moneyCell(payment.amount),
    ]);
  }

  function renderOrderAccount(account, { editable = false } = {}) {
    const groupId = String(account.orderGroupId || '');
    const shortId = groupId ? groupId.slice(0, 8).toUpperCase() : '—';
    const open = Math.max(U.number(account.openAmount), 0);
    const paid = U.number(account.initialPaid) + U.number(account.paidAmount);
    const canPay = editable && open >= 0.005;
    const paymentRows = orderPaymentRows(account);

    return `
      <article class="seller-order-account" data-order-account="${U.escapeHtml(groupId)}">
        <div class="approval-card-head">
          <div><strong>Pedido #${U.escapeHtml(shortId)}</strong><small>${U.escapeHtml(String(account.createdAt || '').slice(0, 10))}</small></div>
          ${accountStatus(account)}
        </div>
        <div class="seller-account-summary">
          <div><span>Total do pedido</span><strong>${U.money(account.orderTotal)}</strong></div>
          <div><span>Pagamentos</span><strong>${U.money(paid)}</strong></div>
          <div class="${open > 0 ? 'is-open' : 'is-paid'}"><span>Em aberto</span><strong>${U.money(open)}</strong></div>
        </div>
        <h4>Estoque deste pedido</h4>
        ${UI.table(['Produto', 'Enviado', 'Em mãos', 'Unitário'], orderItemRows(account), 'Nenhum item neste pedido.')}
        <h4>Pagamentos deste pedido</h4>
        ${UI.table(['Data', 'Forma', 'Nota', 'Valor'], paymentRows, paid > 0 ? 'Pago na entrada do pedido.' : 'Nenhum pagamento neste pedido.')}
        ${canPay ? `
          <form class="grid-form compact-form seller-order-payment" data-order-payment-form data-order-group-id="${U.escapeHtml(groupId)}">
            <label>Valor recebido
              <input name="amount" type="number" step="0.01" min="0.01" max="${open.toFixed(2)}" value="${open.toFixed(2)}" required>
            </label>
            <label>Forma
              <input name="method" placeholder="Pix, dinheiro...">
            </label>
            <label class="wide">Observação
              <input name="notes" placeholder="Opcional">
            </label>
            <div class="actions">
              <button type="button" class="small secondary" data-action="fill-order-balance" data-open-amount="${open.toFixed(2)}">Usar saldo total</button>
              <button type="submit" class="small">Registrar pagamento</button>
            </div>
          </form>` : ''}
      </article>`;
  }

  function renderOrderAccounts(sellerId, options = {}) {
    const accounts = accountsForSeller(sellerId);
    if (!accounts.length) {
      const legacyStock = ownStockRows(sellerId);
      return legacyStock.length
        ? `${UI.formNotice('Este estoque é anterior ao controle por pedido. Ele continua preservado no saldo geral.', 'warning')}${UI.table(['Produto', 'Quantidade'], legacyStock, '')}`
        : '<div class="empty-state"><strong>Nenhum pedido enviado ainda.</strong><span>Os próximos envios aparecerão aqui com estoque, pagamentos e saldo.</span></div>';
    }
    return `<div class="seller-order-account-list">${accounts.map((account) => renderOrderAccount(account, options)).join('')}</div>`;
  }

  function renderSeller() {
    const currentUser = user();
    if (!currentUser) return UI.formNotice('Entre na sua conta.', 'warning');
    const balance = balanceFor(currentUser.id);
    const entries = entriesForSeller(currentUser.id).slice(0, 30);
    const legacy = legacyBalanceFor(currentUser.id);

    return UI.section(
      'Minha conta',
      'Cada envio aparece como um pedido, com os produtos que chegaram, os pagamentos registrados e o saldo ainda aberto.',
      `
        <div class="dashboard seller-overview-metrics">
          ${UI.metric(balance > 0 ? 'Você deve' : 'Situação', balance > 0 ? U.money(balance) : 'Em dia', null)}
          ${UI.metric('Pedidos em aberto', String(accountsForSeller(currentUser.id).filter((item) => U.number(item.openAmount) >= 0.005).length), null)}
        </div>
        ${legacy >= 0.005 ? UI.formNotice(`Existe ${U.money(legacy)} de saldo anterior ou ajuste sem pedido. O administrador pode acertar essa conta separadamente.`, 'warning') : ''}
        <h3>Estoque e contas por pedido</h3>
        ${renderOrderAccounts(currentUser.id)}
        <h3>Histórico geral da conta</h3>
        ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor'], entries.map(entryRow), 'Nenhum lançamento ainda.')}
      `
    );
  }

  function mountSeller(container) {
    if (!container) return;
    container.innerHTML = renderSeller();
  }

  window.C360.sellerLedger = {
    mountSeller,
    balanceFor,
    entriesForSeller,
    paymentsForSeller,
    accountsForSeller,
    openOrdersTotalFor,
    legacyBalanceFor,
    renderOrderAccounts,
    registerPayment,
    registerOrderPayment,
  };
})();