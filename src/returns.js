(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Devoluções e desperdícios — lançáveis para QUALQUER venda, independente
  // de `origin` (manual | pedido | consignado | ...). Módulo autocontido.
  //
  // Contrato remoto esperado (implementado por outro agente em paralelo em
  // window.C360.api / window.C360.state — ver docs/backend.md §5 e §7):
  //
  //   C360.api.list(table, query)      -> Promise<Array<object>>
  //   C360.api.insert(table, payload)  -> Promise<object>
  //   C360.api.update(table, id, patch)-> Promise<object>
  //
  //   C360.state.getState()            -> object
  //   C360.state.getCurrentUser()      -> { id, role, name, businessId } | null
  //   C360.state.isAdmin()             -> boolean
  //   C360.state.add(collectionName, payload)    -> Promise<object>
  //   C360.state.recordMovement(payload)         -> Promise<object>
  //
  // Como em src/goals.js, cada chamada a C360.state é feita de forma
  // defensiva: se o método ainda não existir (módulo de dados não montado
  // nesta tela/teste), a função retorna { ok: false, error } em vez de
  // quebrar a UI.
  //
  // sale (camelCase) esperado por este módulo:
  //   { id, productId, clientId, quantity, unitPrice, unitCost, sellerId,
  //     businessId, origin, date }
  // ==========================================================================

  const FALLBACK_ERROR_DEVOLUCAO = 'Não foi possível registrar a devolução. Tente novamente.';
  const FALLBACK_ERROR_DESPERDICIO = 'Não foi possível registrar o desperdício. Tente novamente.';

  // ---------------------------------------------------------------------
  // Acesso defensivo a C360.state (mesmo padrão de src/goals.js)
  // ---------------------------------------------------------------------
  function stateApi() {
    return window.C360.state || null;
  }

  function hasState(method) {
    return !!(stateApi() && typeof stateApi()[method] === 'function');
  }

  function calc() {
    return window.C360.calc || null;
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function panelDomId(sale, suffix) {
    return `returns-${U.escapeHtml(sale.id)}-${suffix}`;
  }

  function render(sale) {
    if (!sale || !sale.id) {
      return UI.formNotice('Venda não encontrada para lançar devolução/desperdício.', 'warning');
    }

    const maxQty = U.number(sale.quantity) > 0 ? U.number(sale.quantity) : '';
    const devQtyId = panelDomId(sale, 'dev-qtd');
    const devNotesId = panelDomId(sale, 'dev-notes');
    const despQtyId = panelDomId(sale, 'desp-qtd');
    const despNotesId = panelDomId(sale, 'desp-notes');

    return `
      <div class="returns-panel" data-returns-panel data-sale-id="${U.escapeHtml(sale.id)}">
        <div class="returns-panel-head">
          <h3>Devolução / Desperdício</h3>
          <button type="button" class="small ghost" data-role="close-returns">Fechar</button>
        </div>
        <div class="returns-panel-grid">
          <form class="stack-form returns-form" data-role="devolucao-form" novalidate>
            <h4>Registrar devolução</h4>
            <p class="returns-hint">O cliente devolveu parte ou toda a quantidade: o dinheiro e o estoque voltam.</p>
            <label>
              <span class="field-label">Quantidade devolvida</span>
              <input id="${devQtyId}" name="quantity" type="number" step="any" min="0" ${maxQty !== '' ? `max="${U.escapeHtml(maxQty)}"` : ''} required>
            </label>
            <label>
              <span class="field-label">Motivo (opcional)</span>
              <textarea id="${devNotesId}" name="notes" rows="2" maxlength="500" placeholder="Ex.: cliente desistiu de parte do pedido"></textarea>
            </label>
            <button type="submit">Registrar devolução</button>
            <div class="notice" data-role="feedback" hidden></div>
          </form>

          <form class="stack-form returns-form" data-role="desperdicio-form" novalidate>
            <h4>Registrar desperdício</h4>
            <p class="returns-hint">Produto perdido/estragado/quebrado: só o estoque sai, sem envolver dinheiro.</p>
            <label>
              <span class="field-label">Quantidade perdida</span>
              <input id="${despQtyId}" name="quantity" type="number" step="any" min="0" required>
            </label>
            <label>
              <span class="field-label">Motivo (opcional)</span>
              <textarea id="${despNotesId}" name="notes" rows="2" maxlength="500" placeholder="Ex.: caiu no chão, validade vencida"></textarea>
            </label>
            <button type="submit" class="secondary">Registrar desperdício</button>
            <div class="notice" data-role="feedback" hidden></div>
          </form>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Feedback inline (dentro do próprio mini-form, sem alert())
  // ---------------------------------------------------------------------
  function showFeedback(form, message, type) {
    const box = form.querySelector('[data-role="feedback"]');
    if (!box) return;
    box.hidden = false;
    box.className = `notice ${type}`;
    box.innerHTML = U.escapeHtml(message);
  }

  function setFormBusy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = busy;
    form.querySelectorAll('input, textarea').forEach((field) => {
      field.disabled = busy;
    });
  }

  // ---------------------------------------------------------------------
  // Mount — wiring escopado ao container (mesmo padrão de src/goals.js:
  // listeners presos ao container recebido, não ao documento inteiro)
  // ---------------------------------------------------------------------
  function mount(container, sale, options = {}) {
    if (!container || !sale || !sale.id) return null;
    const onDone = typeof options.onDone === 'function' ? options.onDone : null;
    const onClose = typeof options.onClose === 'function' ? options.onClose : null;

    const isFreshOpen = container.getAttribute('data-returns-sale-id') !== String(sale.id) || !container.querySelector('[data-returns-panel]');
    if (isFreshOpen) {
      container.innerHTML = render(sale);
      container.setAttribute('data-returns-sale-id', String(sale.id));
      // O botão que abre este painel (na linha da venda) pode estar longe -
      // topo de uma tabela longa - e o painel sempre renderiza no fim da
      // seção Vendas. Sem isto, o painel "aparece em outro lugar da tela"
      // sem o usuário perceber onde foi parar.
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (container.dataset.c360ReturnsWired === '1') return { container, sale };
    container.dataset.c360ReturnsWired = '1';

    container.addEventListener('click', (event) => {
      if (event.target.closest('[data-role="close-returns"]') && onClose) onClose();
    });

    container.addEventListener('submit', async (event) => {
      const devForm = event.target.closest('[data-role="devolucao-form"]');
      const despForm = event.target.closest('[data-role="desperdicio-form"]');
      if (!devForm && !despForm) return;
      event.preventDefault();

      const form = devForm || despForm;
      const data = U.formData(form);
      const quantity = U.number(data.quantity);
      const notes = (data.notes || '').trim();

      setFormBusy(form, true);
      try {
        const result = devForm
          ? await recordDevolucao({ sale, quantity, notes })
          : await recordDesperdicio({ sale, quantity, notes });

        if (result.ok) {
          const label = devForm ? 'Devolução registrada com sucesso.' : 'Desperdício registrado com sucesso.';
          showFeedback(form, notes ? `${label} (${notes})` : label, 'success');
          form.reset();
          if (onDone) onDone();
        } else {
          showFeedback(form, result.error, 'error');
        }
      } finally {
        setFormBusy(form, false);
      }
    });

    return { container, sale };
  }

  // ---------------------------------------------------------------------
  // recordDevolucao
  // ---------------------------------------------------------------------
  async function recordDevolucao({ sale, quantity, notes } = {}) {
    try {
      const qty = U.number(quantity);
      const maxQty = U.number(sale?.quantity);

      if (!sale || !sale.id) return { ok: false, error: 'Venda inválida.' };
      if (qty <= 0) return { ok: false, error: 'Informe uma quantidade maior que zero.' };
      if (maxQty > 0 && qty > maxQty) {
        return { ok: false, error: `Quantidade não pode ser maior que a vendida (${maxQty}).` };
      }
      if (!hasState('add')) return { ok: false, error: FALLBACK_ERROR_DEVOLUCAO };

      let money = { grossRevenue: -qty * U.number(sale.unitPrice), netRevenue: -qty * U.number(sale.unitPrice), cogs: -qty * U.number(sale.unitCost), grossProfit: 0, percentFees: 0, margin: 0 };
      if (calc() && typeof calc().saleMath === 'function') {
        money = calc().saleMath({
          quantity: -qty,
          unitPrice: sale.unitPrice,
          discount: 0,
          fixedFees: 0,
          feePercent: 0,
          unitCost: sale.unitCost,
        });
      }

      const salePayload = {
        businessId: sale.businessId,
        productId: sale.productId,
        clientId: sale.clientId,
        sellerId: sale.sellerId,
        quantity: -qty,
        unitPrice: sale.unitPrice,
        unitCost: sale.unitCost,
        discount: 0,
        fixedFees: 0,
        feePercent: 0,
        percentFees: money.percentFees,
        grossRevenue: money.grossRevenue,
        netRevenue: money.netRevenue,
        cogs: money.cogs,
        grossProfit: money.grossProfit,
        margin: money.margin,
        parentSaleId: sale.id,
        origin: 'devolucao',
        date: U.today(),
        notes: notes || '',
      };

      const saleRecord = await stateApi().add('sales', salePayload);

      let movement = null;
      if (hasState('recordMovement')) {
        movement = await stateApi().recordMovement({
          type: 'entrada_devolucao_venda',
          productId: sale.productId,
          quantity: qty,
          unitCost: sale.unitCost,
          refType: 'sale',
          refId: sale.id,
          notes: notes || '',
          date: U.today(),
        });
      }

      return { ok: true, saleRecord, movement };
    } catch (error) {
      console.error('C360.returns: erro em recordDevolucao', error);
      return { ok: false, error: error?.message || FALLBACK_ERROR_DEVOLUCAO };
    }
  }

  // ---------------------------------------------------------------------
  // recordDesperdicio
  // ---------------------------------------------------------------------
  async function recordDesperdicio({ sale, quantity, notes } = {}) {
    try {
      const qty = U.number(quantity);
      if (!sale || !sale.id) return { ok: false, error: 'Venda inválida.' };
      if (qty <= 0) return { ok: false, error: 'Informe uma quantidade maior que zero.' };
      if (!hasState('recordMovement')) return { ok: false, error: FALLBACK_ERROR_DESPERDICIO };

      const movement = await stateApi().recordMovement({
        type: 'saida_desperdicio',
        productId: sale.productId,
        quantity: -qty,
        unitCost: sale.unitCost,
        refType: 'sale',
        refId: sale.id,
        notes: notes || '',
        date: U.today(),
      });

      return { ok: true, movement };
    } catch (error) {
      console.error('C360.returns: erro em recordDesperdicio', error);
      return { ok: false, error: error?.message || FALLBACK_ERROR_DESPERDICIO };
    }
  }

  window.C360.returns = {
    render,
    mount,
    recordDevolucao,
    recordDesperdicio,
  };
})();
