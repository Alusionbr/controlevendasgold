(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Conta corrente do vendedor com o admin (Fase 3 do pacote de replicação —
  // ver docs/replication-v1/04-fase3-ledger-vendedor.md). O saldo é sempre a
  // soma dos lançamentos em `seller_account_entries` (nunca um número
  // sobrescrito). Débito de reposição consignado/parcial é lançado por
  // src/salesCart.js na aprovação; este módulo só cuida de:
  //   - admin: ver saldo de cada vendedor e registrar pagamento recebido;
  //   - vendedor: ver o próprio saldo e histórico (só leitura).
  //
  // "Vendedor informar pagamento" fica fora de escopo por ora (decisão
  // registrada no doc da fase): toda escrita no ledger é ação do admin.
  // ==========================================================================

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
  function isAdmin() { return S().isAdmin(); }
  function user() { return S().getCurrentUser(); }

  function entriesForSeller(sellerId) {
    return (state().sellerAccountEntries || []).filter((entry) => String(entry.sellerId) === String(sellerId));
  }

  function paymentsForSeller(sellerId) {
    return (state().sellerPayments || []).filter((payment) => String(payment.sellerId) === String(sellerId));
  }

  function balanceFor(sellerId) {
    return Calc().sellerBalance(entriesForSeller(sellerId));
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

  // ---------------------------------------------------------------------
  // Admin — saldo de todos os vendedores + registrar pagamento recebido
  // ---------------------------------------------------------------------
  function renderAdmin(feedback) {
    const sellers = (state().sellers || []).filter((seller) => seller.active !== false);
    const totalOpen = sellers.reduce((sum, seller) => sum + Math.max(balanceFor(seller.id), 0), 0);

    const cards = sellers.map((seller) => {
      const balance = balanceFor(seller.id);
      const entries = entriesForSeller(seller.id).slice(0, 8);
      return `
        <article class="panel-card seller-ledger-card" data-seller-ledger-card="${U.escapeHtml(seller.id)}">
          <div class="approval-card-head">
            <strong>${U.escapeHtml(seller.name || 'Vendedor')}</strong>
            ${UI.badge(balance > 0 ? `Deve ${U.money(balance)}` : 'Em dia', balance > 0 ? 'danger' : 'ok')}
          </div>
          <form class="grid-form compact-form" data-ledger-payment-form data-seller-id="${U.escapeHtml(seller.id)}">
            <label>Valor recebido
              <input name="amount" type="number" step="0.01" min="0.01" required>
            </label>
            <label>Forma
              <input name="method" placeholder="Pix, dinheiro...">
            </label>
            <label class="wide">Observação
              <input name="notes" placeholder="Opcional">
            </label>
            <button type="submit" class="small">Registrar pagamento</button>
          </form>
          ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor'], entries.map(entryRow), 'Nenhum lançamento ainda.')}
        </article>
      `;
    }).join('');

    return UI.section(
      'Débitos dos vendedores',
      'Conta corrente de reposição consignado/parcial: saldo é sempre a soma dos lançamentos.',
      `${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
       ${UI.metric('Total em aberto', U.money(totalOpen), null)}
       <div class="seller-ledger-grid">${cards || '<div class="empty-state"><strong>Nenhum vendedor ativo.</strong><span>Crie vendedores para acompanhar débitos.</span></div>'}</div>`
    );
  }

  function mountAdmin(container, options = {}) {
    if (!container) return;
    let feedback = null;

    function paint() {
      container.innerHTML = isAdmin() ? renderAdmin(feedback) : UI.formNotice('Somente admin.', 'warning');
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-ledger-payment-form]');
      if (!form) return;
      event.preventDefault();
      const sellerId = form.dataset.sellerId;
      const data = U.formData(form);
      const amount = U.number(data.amount);
      try {
        if (amount <= 0) throw new Error('Informe um valor maior que zero.');
        const payment = await S().add('sellerPayments', {
          sellerId,
          amount,
          paymentDate: U.today(),
          method: data.method || null,
          notes: data.notes || '',
          receivedBy: user()?.id || null,
        });
        await S().add('sellerAccountEntries', {
          sellerId,
          type: 'payment',
          direction: 'credit',
          amount,
          sourceType: 'seller_payment',
          sourceId: payment?.id || null,
          notes: data.notes || '',
        });
        await S().refresh();
        feedback = { message: 'Pagamento registrado.', type: 'success' };
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    paint();
  }

  // ---------------------------------------------------------------------
  // Vendedor — só o próprio saldo e histórico, sem escrita
  // ---------------------------------------------------------------------
  function renderSeller() {
    const currentUser = user();
    if (!currentUser) return UI.formNotice('Entre na sua conta.', 'warning');
    const balance = balanceFor(currentUser.id);
    const entries = entriesForSeller(currentUser.id).slice(0, 30);
    const payments = paymentsForSeller(currentUser.id).slice(0, 10);

    return UI.section(
      'Meu saldo com admin',
      'Reposição consignado/parcial vira débito aqui; pagamentos recebidos abatem o saldo.',
      `
        ${UI.metric(balance > 0 ? 'Você deve' : 'Situação', U.money(Math.max(balance, 0)), null)}
        <h3>Histórico</h3>
        ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor'], entries.map(entryRow), 'Nenhum lançamento ainda.')}
        <h3>Pagamentos já registrados</h3>
        ${UI.table(
          ['Data', 'Forma', 'Nota', 'Valor'],
          payments.map((payment) => [
            (payment.paymentDate || '').slice(0, 10),
            U.escapeHtml(payment.method || '—'),
            U.escapeHtml(payment.notes || ''),
            UI.moneyCell(payment.amount),
          ]),
          'Nenhum pagamento registrado ainda.'
        )}
      `
    );
  }

  function mountSeller(container) {
    if (!container) return;
    container.innerHTML = renderSeller();
  }

  window.C360.sellerLedger = { mountAdmin, mountSeller };
})();
