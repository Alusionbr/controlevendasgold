(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const Calc = window.C360.calc;

  // ==========================================================================
  // Cockpit do vendedor — página inteira com TUDO de um vendedor num só lugar,
  // sem trocar de aba (pedido explícito do usuário: "clico no vendedor e abre
  // vendas, estoque, dívidas, lançar pagamento, criar venda").
  //
  // Não implementa regra de negócio nova: só recompõe, numa tela com
  // sub-seções, a lógica JÁ existente e exportada por outros módulos:
  //   - saldo/pagamento:   C360.sellerLedger.balanceFor / entriesForSeller /
  //                        registerPayment
  //   - envio consignado:  C360.salesCart.sendConsignmentToSeller
  //   - aprovar/rejeitar:  C360.salesCart.approveGroup / rejectGroup
  //   - devoluções:        atalho para a aba de conferência (C360.app.setTab)
  //
  // Montado por src/app.js (mountModuleTab, aba "vendedores") quando há um
  // vendedor selecionado (C360.app.openSellerCockpit(id)).
  // ==========================================================================

  const SECTIONS = [
    { id: 'resumo', label: 'Resumo' },
    { id: 'vendas', label: 'Vendas' },
    { id: 'estoque', label: 'Estoque' },
    { id: 'saldo', label: 'Saldo e pagamentos' },
    { id: 'pedidos', label: 'Pedidos' },
    { id: 'devolucoes', label: 'Devoluções' },
  ];

  // Preservado entre remounts (um renderAll() global re-monta o cockpit): a
  // sub-seção aberta só volta a "resumo" quando muda o vendedor.
  let activeSection = 'resumo';
  let activeSellerId = null;

  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function ledger() { return window.C360.sellerLedger || null; }
  function cart() { return window.C360.salesCart || null; }

  function productById(id) {
    return (state().products || []).find((item) => String(item.id) === String(id)) || null;
  }
  function clientById(id) {
    return (state().clients || []).find((item) => String(item.id) === String(id)) || null;
  }
  function sellerProfile(sellerId) {
    return (state().profiles || state().sellers || []).find((item) => String(item.id) === String(sellerId))
      || (state().sellers || []).find((item) => String(item.id) === String(sellerId))
      || null;
  }

  // ---------------------------------------------------------------------
  // Coletas de dados por vendedor (leitura pura do cache)
  // ---------------------------------------------------------------------
  function salesFor(sellerId) {
    return (state().sales || []).filter((sale) => String(sale.sellerId) === String(sellerId));
  }
  function consignmentsFor(sellerId) {
    return (state().consignments || []).filter((row) => String(row.sellerId) === String(sellerId));
  }
  function stockFor(sellerId) {
    return (state().sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0);
  }
  function movementsFor(sellerId) {
    return (state().operationalMovements || []).filter((row) => String(row.sellerId) === String(sellerId));
  }
  function pendingReturnsFor(sellerId) {
    return movementsFor(sellerId).filter((row) => ['a_devolver', 'pending'].includes(row.status));
  }
  function stockValueFor(sellerId) {
    return stockFor(sellerId).reduce((sum, row) => {
      const product = productById(row.productId);
      return sum + U.number(row.quantity) * U.number(product && product.avgCost);
    }, 0);
  }

  // Agrupa os pedidos (orders) do vendedor pelo orderGroupId — mesma chave que
  // a esteira de src/salesCart.js usa, para os botões Aprovar/Rejeitar baterem.
  function groupsFor(sellerId) {
    const map = new Map();
    (state().orders || [])
      .filter((order) => String(order.sellerId) === String(sellerId))
      .forEach((order) => {
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
        paymentMode: first.paymentMode,
        total: rows.reduce((sum, order) => sum + U.number(order.quantity) * U.number(order.unitPrice), 0),
      };
    });
  }
  function pendingGroupsFor(sellerId) {
    return groupsFor(sellerId).filter((group) => group.approvalStatus === 'pendente_aprovacao');
  }

  function productOptionsForConsignment() {
    return (state().products || []).filter((product) => product.type !== 'servico');
  }

  // ---------------------------------------------------------------------
  // Render de cada sub-seção
  // ---------------------------------------------------------------------
  function renderResumo(sellerId) {
    const L = ledger();
    const balance = L ? L.balanceFor(sellerId) : 0;
    const sales = salesFor(sellerId);
    const salesTotal = sales.reduce((sum, sale) => sum + U.number(sale.netRevenue), 0);
    const pendingCount = pendingGroupsFor(sellerId).length;
    const returnsCount = pendingReturnsFor(sellerId).length;
    return `
      <div class="cockpit-metrics">
        ${UI.metric(balance > 0 ? 'Deve ao admin' : 'Situação', balance > 0 ? U.money(balance) : 'Em dia', null)}
        ${UI.metric('Valor em estoque com ele', U.money(stockValueFor(sellerId)), 'valorEstoque')}
        ${UI.metric('Vendas registradas', U.money(salesTotal), 'receitaLiquida')}
        ${UI.metric('Pedidos aguardando aprovação', String(pendingCount), null)}
        ${UI.metric('Devoluções pendentes', String(returnsCount), null)}
      </div>
      <p class="cockpit-hint">Use as seções acima para ver vendas, mexer no estoque, registrar pagamento e aprovar pedidos deste vendedor sem sair desta tela.</p>
    `;
  }

  function renderVendas(sellerId) {
    const sales = U.sortByDateDesc(salesFor(sellerId));
    const rows = sales.map((sale) => {
      const product = productById(sale.productId);
      const client = clientById(sale.clientId);
      return [
        U.escapeHtml(sale.date),
        U.escapeHtml(sale.channel || '—'),
        U.escapeHtml(client ? client.name : '—'),
        UI.productName(product),
        U.qty(sale.quantity, product && product.unit),
        UI.moneyCell(sale.netRevenue),
        UI.moneyCell(sale.cogs),
        UI.moneyCell(sale.grossProfit),
      ];
    });
    const consignments = consignmentsFor(sellerId).filter((row) => U.number(row.quantitySent) > 0);
    const consRows = consignments.map((item) => {
      const product = productById(item.productId);
      return [
        U.escapeHtml(item.date || '—'),
        UI.productName(product),
        U.qty(item.quantitySent, product && product.unit),
        U.qty(item.quantitySold, product && product.unit),
        UI.moneyCell(Calc.consignmentOpenAmount(item)),
      ];
    });
    return `
      <h3>Vendas do vendedor</h3>
      ${UI.table(['Data', 'Canal', 'Cliente', 'Produto', 'Qtd.', 'Receita líquida', 'CMV', 'Lucro'], rows, 'Este vendedor ainda não tem vendas.')}
      <h3>Consignações</h3>
      ${UI.table(['Data', 'Produto', 'Enviado', 'Vendido', 'Em aberto'], consRows, 'Nenhuma consignação com este vendedor.')}
    `;
  }

  function renderEstoque(sellerId) {
    const stockRows = stockFor(sellerId).map((row) => {
      const product = productById(row.productId);
      return [
        product ? U.escapeHtml(product.name) : 'Produto removido',
        U.qty(row.quantity, product ? product.unit : ''),
      ];
    });
    const products = productOptionsForConsignment();
    return `
      <h3>Enviar estoque consignado</h3>
      <p class="cockpit-hint">Baixa do estoque central, credita o estoque do vendedor e gera dívida no valor enviado (${UI.help('consignado')}).</p>
      <form class="grid-form compact-form" data-cockpit-consign>
        <label>Produto
          <select name="productId" required>${UI.optionList(products, '', products.length ? 'Selecione o produto' : 'Nenhum produto cadastrado')}</select>
        </label>
        <label>Quantidade
          <input name="quantity" type="number" step="0.001" min="0.001" required>
        </label>
        <label>Preço unitário (dívida)
          <input name="unitPrice" type="number" step="0.01" min="0" required>
        </label>
        <button type="submit" class="small">Enviar consignado</button>
      </form>
      <h3>Estoque atual do vendedor</h3>
      ${UI.table(['Produto', 'Quantidade'], stockRows, 'Nenhum estoque com este vendedor.')}
    `;
  }

  function renderSaldo(sellerId) {
    const L = ledger();
    const balance = L ? L.balanceFor(sellerId) : 0;
    const entries = L ? L.entriesForSeller(sellerId).slice(0, 20) : [];
    const payments = (state().sellerPayments || [])
      .filter((payment) => String(payment.sellerId) === String(sellerId)).slice(0, 10);
    const typeLabel = {
      debit_replenishment: 'Reposição', payment: 'Pagamento', return_credit: 'Devolução',
      manual_adjustment: 'Ajuste manual', writeoff: 'Baixa de dívida', bonus_credit: 'Bonificação',
    };
    const entryRows = entries.map((entry) => {
      const signed = entry.direction === 'credit' ? -U.number(entry.amount) : U.number(entry.amount);
      return [
        (entry.createdAt || '').slice(0, 10),
        U.escapeHtml(typeLabel[entry.type] || entry.type),
        UI.badge(entry.direction === 'credit' ? 'Crédito' : 'Débito', entry.direction === 'credit' ? 'ok' : ''),
        U.escapeHtml(entry.notes || ''),
        `<strong>${signed < 0 ? '- ' : ''}${U.money(Math.abs(signed))}</strong>`,
      ];
    });
    return `
      ${UI.metric(balance > 0 ? 'Deve ao admin' : 'Situação', balance > 0 ? U.money(balance) : 'Em dia', null)}
      <h3>Registrar pagamento recebido</h3>
      <form class="grid-form compact-form" data-cockpit-payment>
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
      <h3>Histórico do saldo</h3>
      ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor'], entryRows, 'Nenhum lançamento ainda.')}
      <h3>Pagamentos registrados</h3>
      ${UI.table(['Data', 'Forma', 'Nota', 'Valor'], payments.map((payment) => [
        (payment.paymentDate || '').slice(0, 10),
        U.escapeHtml(payment.method || '—'),
        U.escapeHtml(payment.notes || ''),
        UI.moneyCell(payment.amount),
      ]), 'Nenhum pagamento registrado ainda.')}
    `;
  }

  function renderPedidos(sellerId) {
    const groups = groupsFor(sellerId);
    const statusLabel = {
      pendente: 'Pendente', em_preparo: 'Em montagem', pronto: 'Pronto',
      despachado: 'Despachado', concluido: 'Concluído',
    };
    const cards = groups
      .filter((group) => group.approvalStatus !== 'rejeitado')
      .map((group) => {
        const pending = group.approvalStatus === 'pendente_aprovacao';
        const items = group.rows.map((order) => {
          const product = productById(order.productId);
          return `<li><span>${U.escapeHtml(product ? product.name : 'Produto')}</span><strong>${U.qty(order.quantity, product && product.unit)}</strong></li>`;
        }).join('');
        const actions = pending
          ? `<div class="actions">
              <button type="button" class="small" data-cockpit-approve="${U.escapeHtml(group.key)}">Aprovar</button>
              <button type="button" class="small danger" data-cockpit-reject="${U.escapeHtml(group.key)}">Rejeitar</button>
            </div>`
          : UI.badge(statusLabel[group.status] || group.status, group.status === 'concluido' ? 'ok' : '');
        return `
          <article class="panel-card cockpit-order-card ${pending ? 'board-card-pending' : ''}">
            <div class="approval-card-head">
              <strong>${U.escapeHtml(({ avista: 'À vista', parcial: 'Parcial', consignado: 'Consignado' })[group.paymentMode] || 'Pedido')}</strong>
              ${pending ? UI.badge('Aguardando aprovação', 'warn') : ''}
            </div>
            <ul class="board-card-items">${items}</ul>
            <div class="board-card-foot"><span>Total</span><strong>${U.money(group.total)}</strong></div>
            ${actions}
          </article>`;
      }).join('');
    return `
      <h3>Pedidos do vendedor</h3>
      <p class="cockpit-hint">Aprove ou rejeite as reposições pedidas por este vendedor. Depois de aprovado, o despacho acontece na esteira em Vendas.</p>
      ${cards ? `<div class="cockpit-order-grid">${cards}</div>` : UI.formNotice('Nenhum pedido deste vendedor.', 'info')}
    `;
  }

  function renderDevolucoes(sellerId) {
    const movements = movementsFor(sellerId).slice(0, 20);
    const kindLabel = { devolucao: 'Devolução', desperdicio: 'Desperdício', brinde: 'Brinde' };
    const statusLabel = { a_devolver: 'A devolver', pending: 'Aguardando', reviewed: 'Conferido', rejected: 'Rejeitado' };
    const rows = movements.map((movement) => {
      const product = productById(movement.productId);
      return [
        (movement.createdAt || '').slice(0, 10),
        U.escapeHtml(kindLabel[movement.kind] || movement.kind || '—'),
        UI.productName(product),
        U.qty(movement.quantity, product && product.unit),
        UI.badge(statusLabel[movement.status] || movement.status || '—', ['a_devolver', 'pending'].includes(movement.status) ? 'warn' : 'ok'),
      ];
    });
    return `
      <h3>Devoluções, desperdícios e brindes</h3>
      ${UI.table(['Data', 'Tipo', 'Produto', 'Qtd.', 'Status'], rows, 'Nada registrado para este vendedor.')}
      <p class="cockpit-hint">A conferência (que dá baixa no estoque/dívida) é feita na fila do admin.</p>
      <button type="button" class="small secondary" data-cockpit-goto="devolucoes">Abrir fila de conferência</button>
    `;
  }

  function renderSection(sellerId) {
    switch (activeSection) {
      case 'vendas': return renderVendas(sellerId);
      case 'estoque': return renderEstoque(sellerId);
      case 'saldo': return renderSaldo(sellerId);
      case 'pedidos': return renderPedidos(sellerId);
      case 'devolucoes': return renderDevolucoes(sellerId);
      default: return renderResumo(sellerId);
    }
  }

  // ---------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------
  function mount(container, sellerId, options = {}) {
    if (!container) return;
    if (String(sellerId) !== String(activeSellerId)) {
      activeSellerId = sellerId;
      activeSection = 'resumo';
    }
    let feedback = null;

    function paint() {
      const seller = sellerProfile(sellerId);
      const L = ledger();
      const balance = L ? L.balanceFor(sellerId) : 0;
      const nav = SECTIONS.map((section) => `
        <button type="button" class="cockpit-tab ${section.id === activeSection ? 'active' : ''}" data-cockpit-section="${section.id}">${U.escapeHtml(section.label)}</button>
      `).join('');
      container.innerHTML = `
        <div class="cockpit">
          <div class="cockpit-head">
            <button type="button" class="link-button" data-cockpit-back>← Voltar aos vendedores</button>
            <div class="cockpit-title">
              <h2>${U.escapeHtml((seller && seller.name) || 'Vendedor')}</h2>
              <p>${U.escapeHtml((seller && seller.email) || '')}${balance > 0 ? ` · ${UI.badge('Deve ' + U.money(balance), 'danger')}` : ` · ${UI.badge('Em dia', 'ok')}`}</p>
            </div>
          </div>
          <nav class="cockpit-nav">${nav}</nav>
          ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
          <div class="cockpit-body">${renderSection(sellerId)}</div>
        </div>
      `;
    }

    async function withFeedback(fn, okMessage) {
      try {
        await fn();
        feedback = { message: okMessage, type: 'success' };
      } catch (error) {
        feedback = { message: (error && error.message) || 'Não foi possível concluir a ação.', type: 'danger' };
      }
      paint();
    }

    container.addEventListener('click', async (event) => {
      const back = event.target.closest('[data-cockpit-back]');
      if (back) { if (typeof options.onBack === 'function') options.onBack(); return; }

      const tab = event.target.closest('[data-cockpit-section]');
      if (tab) { activeSection = tab.dataset.cockpitSection; feedback = null; paint(); return; }

      const goto = event.target.closest('[data-cockpit-goto]');
      if (goto) {
        if (window.C360.app && typeof window.C360.app.setTab === 'function') window.C360.app.setTab(goto.dataset.cockpitGoto);
        return;
      }

      const approve = event.target.closest('[data-cockpit-approve]');
      if (approve) {
        await withFeedback(() => cart().approveGroup(approve.dataset.cockpitApprove), 'Pedido aprovado e despachado. O estoque ja esta com o vendedor.');
        return;
      }
      const reject = event.target.closest('[data-cockpit-reject]');
      if (reject) {
        if (!confirm('Rejeitar este pedido?')) return;
        await withFeedback(() => cart().rejectGroup(reject.dataset.cockpitReject), 'Pedido rejeitado.');
        return;
      }
    });

    container.addEventListener('submit', async (event) => {
      const consignForm = event.target.closest('[data-cockpit-consign]');
      if (consignForm) {
        event.preventDefault();
        const data = U.formData(consignForm);
        await withFeedback(() => cart().sendConsignmentToSeller({
          sellerId,
          productId: data.productId,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
        }), 'Consignado enviado. Estoque baixado e dívida lançada no saldo do vendedor.');
        return;
      }

      const paymentForm = event.target.closest('[data-cockpit-payment]');
      if (paymentForm) {
        event.preventDefault();
        const data = U.formData(paymentForm);
        const L = ledger();
        if (!L || typeof L.registerPayment !== 'function') { feedback = { message: 'Registro de pagamento indisponível.', type: 'danger' }; paint(); return; }
        await withFeedback(() => L.registerPayment(sellerId, { amount: data.amount, method: data.method, notes: data.notes }), 'Pagamento registrado.');
        return;
      }
    });

    paint();
  }

  window.C360.sellerCockpit = { mount };
})();
