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

  // Reaproveitado pelo painel consolidado da aba Vendedores (src/auth.js) —
  // mesma escrita que o formulario de pagamento aqui, sem duplicar a regra
  // de negocio (pagamento sempre vira um credito no ledger, nunca sobrescreve
  // saldo).
  async function registerPayment(sellerId, { amount, method, notes } = {}) {
    const value = U.number(amount);
    if (value <= 0) throw new Error('Informe um valor maior que zero.');
    const payment = await S().add('sellerPayments', {
      sellerId,
      amount: value,
      paymentDate: U.today(),
      method: method || null,
      notes: notes || '',
      receivedBy: user()?.id || null,
    });
    await S().add('sellerAccountEntries', {
      sellerId,
      type: 'payment',
      direction: 'credit',
      amount: value,
      sourceType: 'seller_payment',
      sourceId: payment?.id || null,
      notes: notes || '',
    });
    await S().refresh();
    return payment;
  }

  // Ajuste manual / correção de lançamento — nunca edita ou apaga um
  // lançamento existente (mesmo princípio de `ajuste_manual` em
  // stockMovements, CLAUDE.md): toda correção é um novo lançamento tipo
  // 'manual_adjustment' com motivo obrigatório, na direção escolhida pelo
  // admin. Reaproveitado tanto pelo formulário "Ajuste manual" quanto pelo
  // botão "Corrigir" de um lançamento específico (src/auth.js), que só
  // pré-preenche direção/valor invertidos — a escrita é sempre esta mesma.
  async function registerAdjustment(sellerId, { amount, direction, notes, sourceId } = {}) {
    const value = U.number(amount);
    if (value <= 0) throw new Error('Informe um valor maior que zero.');
    if (direction !== 'debit' && direction !== 'credit') throw new Error('Selecione se o ajuste aumenta ou reduz a dívida.');
    if (!notes || !notes.trim()) throw new Error('Informe o motivo do ajuste.');
    const entry = await S().add('sellerAccountEntries', {
      sellerId,
      type: 'manual_adjustment',
      direction,
      amount: value,
      sourceType: sourceId ? 'entry_correction' : 'manual',
      sourceId: sourceId || null,
      notes: notes.trim(),
    });
    await S().refresh();
    return entry;
  }

  // Leitura do que está fisicamente com o vendedor (mesmo filtro de
  // stockRowsForSeller em src/auth.js, aplicado ao próprio usuário). Sem
  // formulário, sem botão de venda — é só o vendedor conseguir conferir o
  // que embasa a dívida que ele vê acima.
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

  // ---------------------------------------------------------------------
  // Vendedor — só o próprio saldo, histórico e o que está com ele, sem
  // escrita nenhuma (nenhuma opção de venda ou pedido neste painel).
  // ---------------------------------------------------------------------
  function renderSeller() {
    const currentUser = user();
    if (!currentUser) return UI.formNotice('Entre na sua conta.', 'warning');
    const balance = balanceFor(currentUser.id);
    const entries = entriesForSeller(currentUser.id).slice(0, 30);
    const payments = paymentsForSeller(currentUser.id).slice(0, 10);
    const stockRows = ownStockRows(currentUser.id);

    return UI.section(
      'Minha conta',
      'Reposição consignado/parcial vira débito aqui; pagamentos e ajustes do admin abatem o saldo.',
      `
        ${UI.metric(balance > 0 ? 'Você deve' : 'Situação', U.money(Math.max(balance, 0)), null)}
        <h3>O que está com você</h3>
        ${UI.table(['Produto', 'Quantidade'], stockRows, 'Nenhum estoque consignado com você no momento.')}
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

  window.C360.sellerLedger = { mountSeller, balanceFor, entriesForSeller, registerPayment, registerAdjustment };
})();
