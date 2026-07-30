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

  function settingsForSeller(sellerId) {
    return (state().sellerSettings || []).find((item) => String(item.sellerId) === String(sellerId)) || {};
  }

  function loginRewardForSeller(sellerId) {
    const ownReward = state().sellerLoginReward;
    if (ownReward && String(ownReward.sellerId) === String(sellerId)) return ownReward;
    return (state().sellerLoginRewards || []).find((item) => String(item.sellerId) === String(sellerId)) || {};
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

  function localDateTimeValue(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function paymentReportsForSeller(sellerId) {
    return (state().sellerPaymentReports || []).filter((report) => String(report.sellerId) === String(sellerId));
  }

  function paymentReportStatus(report) {
    if (report.status === 'approved') return UI.badge('Lançado', 'ok');
    if (report.status === 'rejected') return UI.badge('Recusado', 'warn');
    return UI.badge('Aguardando conferência', 'warn');
  }

  function renderPaymentReport(sellerId) {
    const accounts = accountsForSeller(sellerId).filter((account) => U.number(account.openAmount) >= 0.005);
    const legacy = legacyBalanceFor(sellerId);
    const options = accounts.map((account) => {
      const id = String(account.orderGroupId || '');
      return `<option value="${U.escapeHtml(id)}">Pedido #${U.escapeHtml(id.slice(0, 8).toUpperCase())} — ${U.money(account.openAmount)} em aberto</option>`;
    });
    if (legacy >= 0.005) options.push(`<option value="legacy">Saldo anterior — ${U.money(legacy)} em aberto</option>`);
    const reports = paymentReportsForSeller(sellerId).slice(0, 10);
    const rows = reports.map((report) => [
      U.escapeHtml(new Date(report.reportedAt).toLocaleString('pt-BR')),
      U.escapeHtml(report.orderGroupId ? `Pedido #${String(report.orderGroupId).slice(0, 8).toUpperCase()}` : 'Saldo anterior'),
      UI.moneyCell(report.reportedAmount),
      report.status === 'approved' ? `<strong>${U.money(report.reviewedAmount)}</strong>` : '—',
      paymentReportStatus(report),
      `<button type="button" class="small secondary" data-payment-proof="${U.escapeHtml(report.id)}">Ver comprovante</button>`,
    ]);
    return `
      <section class="panel-card seller-payment-report-card">
        <div class="approval-card-head">
          <div><strong>Informar pagamento</strong><small>O saldo muda somente depois da conferência do administrador.</small></div>
          ${UI.badge(`${reports.filter((item) => item.status === 'pending').length} pendente(s)`, reports.some((item) => item.status === 'pending') ? 'warn' : '')}
        </div>
        ${options.length ? `
          <form class="grid-form compact-form" data-seller-payment-report-form>
            <label class="wide">Conta ou pedido
              <select name="orderGroupId" required>${options.join('')}</select>
            </label>
            <label>Data e hora do pagamento
              <input name="reportedAt" type="datetime-local" max="${localDateTimeValue(new Date(Date.now() + 5 * 60000))}" value="${localDateTimeValue()}" required>
            </label>
            <label>Valor pago
              <input name="amount" type="number" min="0.01" step="0.01" required>
            </label>
            <label>Forma
              <input name="method" maxlength="80" placeholder="Pix, dinheiro, transferência...">
            </label>
            <label class="wide">Comprovante (foto ou PDF, até 10 MB)
              <input name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>
            </label>
            <label class="wide">Observação
              <input name="notes" maxlength="1000" placeholder="Opcional">
            </label>
            <div class="actions"><button type="submit">Enviar para conferência</button></div>
          </form>` : UI.formNotice('Você não tem pedido ou saldo anterior em aberto para informar pagamento.', 'info')}
        <h4>Pagamentos informados</h4>
        ${UI.table(['Data/hora', 'Conta', 'Informado', 'Lançado', 'Situação', ''], rows, 'Nenhum pagamento informado ainda.')}
      </section>`;
  }
  function renderLoginTask(sellerId) {
    const reward = loginRewardForSeller(sellerId);
    const streak = U.number(reward.currentStreak);
    const gifts = U.number(reward.giftCredits);
    const cycleProgress = streak > 0 && streak % 15 === 0 ? 15 : streak % 15;
    const remaining = Math.max(15 - cycleProgress, 0);
    return `
      <section class="panel-card seller-login-task">
        <div class="approval-card-head">
          <div><strong>Tarefa: entrar 15 dias seguidos</strong><small>Uma entrada por dia conta para a sequência.</small></div>
          ${UI.badge(`${gifts} brinde(s) disponível(is)`, gifts > 0 ? 'ok' : '')}
        </div>
        <div class="dashboard seller-overview-metrics">
          ${UI.metric('Sequência atual', `${streak} dia(s)`, null)}
          ${UI.metric('Progresso do próximo brinde', `${cycleProgress}/15`, null)}
        </div>
        <p class="hint-inline">${remaining > 0 ? `Faltam ${remaining} dia(s) seguido(s) para ganhar 1 brinde.` : 'Brinde conquistado! O administrador pode marcar a entrega.'}</p>
      </section>`;
  }

  function renderBalanceAlignment(sellerId, balance) {
    const settings = settingsForSeller(sellerId);
    if (U.number(settings.balanceAlignmentCredits) < 1) return '';
    return `
      <section class="panel-card seller-balance-alignment">
        <div class="approval-card-head">
          <div><strong>Alinhamento de saldo liberado</strong><small>Disponível uma única vez.</small></div>
          ${UI.badge('Ação liberada', 'ok')}
        </div>
        ${UI.formNotice(`O sistema mostra ${U.money(balance)}. Informe abaixo o total que você reconhece como devido. A diferença será registrada no histórico e esta opção desaparecerá após o uso.`, 'warning')}
        <form class="grid-form compact-form" data-balance-alignment-form>
          <label>Quanto devo no total
            <input name="reportedBalance" type="number" min="0" step="0.01" value="${U.number(balance).toFixed(2)}" required>
          </label>
          <label class="wide">Observação
            <input name="notes" maxlength="500" placeholder="Ex.: conferido com extrato e pagamentos">
          </label>
          <div class="actions"><button type="submit">Confirmar alinhamento</button></div>
        </form>
      </section>`;
  }

  function renderPasswordForm() {
    return `
      <details class="panel-card seller-password-card">
        <summary><strong>Alterar minha senha</strong></summary>
        <form class="grid-form compact-form" data-change-password-form>
          <label>Senha atual<input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label>Nova senha<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirmar nova senha<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <div class="actions"><button type="submit">Salvar nova senha</button></div>
        </form>
      </details>`;
  }

  function renderSeller(feedback) {
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
        ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
        ${renderLoginTask(currentUser.id)}
        ${renderPaymentReport(currentUser.id)}
        ${renderBalanceAlignment(currentUser.id, balance)}
        ${legacy >= 0.005 ? UI.formNotice(`Existe ${U.money(legacy)} de saldo anterior ou ajuste sem pedido. O administrador pode acertar essa conta separadamente.`, 'warning') : ''}
        <h3>Estoque e contas por pedido</h3>
        ${renderOrderAccounts(currentUser.id)}
        <h3>Histórico geral da conta</h3>
        ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor'], entries.map(entryRow), 'Nenhum lançamento ainda.')}
        ${renderPasswordForm()}
      `
    );
  }

  function mountSeller(container) {
    if (!container) return;
    let feedback = null;
    function paint() { container.innerHTML = renderSeller(feedback); }
    container.addEventListener('submit', async (event) => {
      const paymentReportForm = event.target.closest('[data-seller-payment-report-form]');
      const alignmentForm = event.target.closest('[data-balance-alignment-form]');
      const passwordForm = event.target.closest('[data-change-password-form]');
      if (!paymentReportForm && !alignmentForm && !passwordForm) return;
      event.preventDefault();
      try {
        const data = U.formData(event.target);
        if (paymentReportForm) {
          const proofFile = paymentReportForm.elements.proof.files[0];
          const submitButton = paymentReportForm.querySelector('button[type="submit"]');
          if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Enviando comprovante...'; }
          await window.C360.api.submitSellerPaymentReport({
            orderGroupId: data.orderGroupId === 'legacy' ? null : data.orderGroupId,
            reportedAt: data.reportedAt,
            amount: U.number(data.amount),
            method: data.method || '',
            notes: data.notes || '',
            proofFile,
          });
          feedback = { message: 'Pagamento enviado para conferência. Ele ainda não alterou seu saldo.', type: 'success' };
        } else if (alignmentForm) {
          if (!confirm(`Confirmar que o saldo devido correto é ${U.money(data.reportedBalance)}? Esta liberação será consumida.`)) return;
          await window.C360.api.alignOwnSellerBalance({ reportedBalance: U.number(data.reportedBalance), notes: data.notes || '' });
          feedback = { message: 'Saldo alinhado com sucesso. A liberação foi utilizada.', type: 'success' };
        } else {
          if (String(data.newPassword || '').length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
          if (data.newPassword !== data.confirmPassword) throw new Error('A confirmação da nova senha não confere.');
          if (data.currentPassword === data.newPassword) throw new Error('A nova senha precisa ser diferente da senha atual.');
          await window.C360.api.changeOwnPassword({ currentPassword: data.currentPassword, newPassword: data.newPassword });
          feedback = { message: 'Senha alterada com sucesso.', type: 'success' };
        }
        await S().refresh();
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
    });
    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-payment-proof]');
      if (!button) return;
      const report = (state().sellerPaymentReports || []).find((item) => String(item.id) === String(button.dataset.paymentProof));
      if (!report || !report.proofPath) return;
      button.disabled = true;
      try {
        const url = await window.C360.api.createSellerPaymentProofUrl(report.proofPath);
        window.open(url, '_blank', 'noopener');
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
        paint();
      } finally {
        button.disabled = false;
      }
    });
    paint();
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