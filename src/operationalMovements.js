(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Devolução com status, desperdício e brinde (Fase 4 do pacote de
  // replicação — ver docs/replication-v1/05-fase4-devolucoes-desperdicio-brinde.md).
  //
  // Regra central: "a_devolver"/"pending" NÃO mexe em estoque nem
  // financeiro. Só a CONFERÊNCIA do admin dispara o impacto. Por isso não
  // há RPC de banco aqui — confirmar é sempre uma ação do admin logado
  // (mesmo padrão de src/salesCart.js approveCart / src/sellerLedger.js).
  //
  // Distinto de src/returns.js: aquele módulo é para devolução/desperdício
  // IMEDIATOS a partir de uma venda direta (dinheiro e estoque voltam na
  // hora). Este módulo é para mercadoria que está fisicamente com o
  // vendedor (reposição/consignado) voltando, se perdendo ou virando
  // brinde — sempre passando por conferência do admin antes de valer.
  // ==========================================================================

  const TYPE_LABELS = { return: 'Devolução', waste: 'Desperdício', gift: 'Brinde' };
  const RETURN_STATUS_LABELS = {
    a_devolver: 'A devolver', enviado: 'Enviado', recebido: 'Recebido',
    devolvido: 'Devolvido', devolvido_parcialmente: 'Devolvido parcialmente', recusado: 'Recusado',
  };
  const SIMPLE_STATUS_LABELS = { pending: 'Pendente', confirmed: 'Confirmado', cancelled: 'Cancelado' };

  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }
  function productById(id) { return (state().products || []).find((item) => String(item.id) === String(id)) || null; }
  function sellerName(id) {
    const profile = (state().profiles || []).find((item) => String(item.id) === String(id));
    return profile ? profile.name : 'Vendedor';
  }
  function sellerStockRow(sellerId, productId) {
    return (state().sellerStock || []).find((row) => String(row.sellerId) === String(sellerId) && String(row.productId) === String(productId)) || null;
  }
  function assertSellerStockAvailable(sellerId, productId, quantity) {
    if (!sellerId) return null;
    const current = sellerStockRow(sellerId, productId);
    const available = U.number(current?.quantity);
    if (!current || available < U.number(quantity)) {
      const product = productById(productId);
      throw new Error(`Estoque proprio insuficiente para ${product ? product.name : 'este produto'}. Disponivel: ${U.qty(available, product?.unit)}.`);
    }
    return current;
  }

  function statusLabel(movement) {
    const map = movement.type === 'return' ? RETURN_STATUS_LABELS : SIMPLE_STATUS_LABELS;
    return map[movement.status] || movement.status;
  }

  function statusBadgeType(movement) {
    if (['devolvido', 'confirmed'].includes(movement.status)) return 'ok';
    if (['recusado', 'cancelled'].includes(movement.status)) return 'danger';
    return '';
  }

  // ---------------------------------------------------------------------
  // Efeito real (estoque + financeiro) — só chamado na conferência.
  // ---------------------------------------------------------------------
  async function decrementSellerStock(sellerId, productId, quantity) {
    const current = assertSellerStockAvailable(sellerId, productId, quantity);
    const nextQuantity = U.number(current.quantity) - U.number(quantity);
    await S().update('sellerStock', current.id, { quantity: nextQuantity });
  }

  async function applyMovementEffects(movement, { quantityReceived, unitValue, affectsFinance }) {
    const qty = U.number(quantityReceived);
    if (qty <= 0) return;
    const product = productById(movement.productId);
    if (!product) throw new Error('Produto não encontrado.');

    if (movement.type === 'return') {
      // Mercadoria consignada/reposição volta do vendedor para o estoque
      // central do admin — sempre incrementa products.currentStock e gera
      // o mesmo tipo de movimento já usado em outros retornos consignados.
      if (movement.sellerId) await decrementSellerStock(movement.sellerId, movement.productId, qty);
      await S().update('products', product.id, { currentStock: U.number(product.currentStock) + qty });
      await S().recordMovement({
        date: U.today(),
        type: 'entrada_devolucao_consignado',
        productId: product.id,
        quantity: qty,
        unitCost: U.number(product.avgCost),
        totalCost: qty * U.number(product.avgCost),
        refType: 'operational_movement',
        refId: movement.id,
        notes: `Devolução conferida${movement.reason ? ` - ${movement.reason}` : ''}`,
      });
      if (affectsFinance && movement.sellerId) {
        const total = qty * U.number(unitValue);
        if (total > 0) {
          await S().add('sellerAccountEntries', {
            sellerId: movement.sellerId,
            type: 'return_credit',
            direction: 'credit',
            amount: total,
            sourceType: 'operational_movement',
            sourceId: movement.id,
            notes: `Devolução conferida (${U.qty(qty, product.unit)})`,
          });
        }
      }
      return;
    }

    // waste | gift: se a mercadoria era do estoque próprio do vendedor, só
    // sai de lá (o central já tinha sido baixado no envio consignado); se
    // era do estoque central do admin, baixa direto e gera stock_movements
    // (mesmo padrão de src/returns.js recordDesperdicio).
    if (movement.sellerId) {
      await decrementSellerStock(movement.sellerId, movement.productId, qty);
      return;
    }
    await S().update('products', product.id, { currentStock: Math.max(U.number(product.currentStock) - qty, 0) });
    await S().recordMovement({
      date: U.today(),
      type: movement.type === 'waste' ? 'saida_desperdicio' : 'saida_brinde',
      productId: product.id,
      quantity: -qty,
      unitCost: U.number(product.avgCost),
      totalCost: -(qty * U.number(product.avgCost)),
      refType: 'operational_movement',
      refId: movement.id,
      notes: `${movement.type === 'waste' ? 'Desperdício' : 'Brinde'} conferido${movement.reason ? ` - ${movement.reason}` : ''}`,
    });
  }

  async function confirmMovement(movement, { quantityReceived, unitValue, affectsFinance }) {
    const qty = U.number(quantityReceived);
    const declared = U.number(movement.quantityDeclared);
    const status = movement.type === 'return'
      ? (qty <= 0 ? 'recusado' : (qty < declared ? 'devolvido_parcialmente' : 'devolvido'))
      : (qty <= 0 ? 'cancelled' : 'confirmed');

    await applyMovementEffects(movement, { quantityReceived: qty, unitValue, affectsFinance });
    await S().update('operationalMovements', movement.id, {
      status,
      quantityReceived: qty,
      unitValue: U.number(unitValue),
      totalValue: qty * U.number(unitValue),
      affectsFinance: !!affectsFinance,
      approvedBy: user()?.id || null,
      confirmedAt: new Date().toISOString(),
    });
    await S().refresh();
  }

  async function rejectMovement(movement) {
    await S().update('operationalMovements', movement.id, {
      status: movement.type === 'return' ? 'recusado' : 'cancelled',
      approvedBy: user()?.id || null,
      confirmedAt: new Date().toISOString(),
    });
    await S().refresh();
  }

  // ---------------------------------------------------------------------
  // Vendedor — solicitar + acompanhar (só leitura depois de criado)
  // ---------------------------------------------------------------------
  function movementRow(movement) {
    const product = productById(movement.productId);
    return [
      U.escapeHtml(TYPE_LABELS[movement.type] || movement.type),
      UI.badge(statusLabel(movement), statusBadgeType(movement)),
      U.escapeHtml(product ? product.name : 'Produto removido'),
      U.qty(movement.quantityDeclared, product?.unit),
      U.escapeHtml(movement.reason || ''),
      (movement.createdAt || '').slice(0, 10),
    ];
  }

  function renderSellerForm(feedback) {
    const ownStockIds = new Set((state().sellerStock || [])
      .filter((row) => U.number(row.quantity) > 0)
      .map((row) => String(row.productId)));
    const products = (state().products || [])
      .filter((product) => product.type !== 'servico' && ownStockIds.has(String(product.id)));
    const productSelect = UI.optionList(products, '', products.length ? 'Produto' : 'Sem estoque proprio');
    return `
      ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
      <form class="grid-form" data-om-form novalidate>
        <label>Tipo
          <select name="type">
            <option value="return">Devolução (ao admin)</option>
            <option value="waste">Desperdício</option>
            <option value="gift">Brinde</option>
          </select>
        </label>
        <label>Produto
          <select name="productId" required>${productSelect}</select>
        </label>
        <label>Quantidade
          <input name="quantityDeclared" type="number" step="0.001" min="0.001" required>
        </label>
        <label class="wide">Motivo
          <input name="reason" required placeholder="Ex.: cliente desistiu, caiu no chão, amostra para cliente">
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Opcional">
        </label>
        <button type="submit">Registrar</button>
      </form>
    `;
  }

  function renderSellerList() {
    const currentUser = user();
    const movements = (state().operationalMovements || []).filter((movement) => String(movement.sellerId) === String(currentUser?.id));
    return UI.section(
      'Minhas devoluções, desperdícios e brindes',
      '"A devolver"/pendente não altera estoque nem financeiro — só depois que o admin confere.',
      UI.table(['Tipo', 'Status', 'Produto', 'Qtd.', 'Motivo', 'Data'], movements.map(movementRow), 'Nenhuma movimentação ainda.')
    );
  }

  function mountSeller(container) {
    if (!container) return;
    let feedback = null;

    function paint() {
      container.innerHTML = renderSellerForm(feedback) + renderSellerList();
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-om-form]');
      if (!form) return;
      event.preventDefault();
      const data = U.formData(form);
      try {
        const currentUser = user();
        const qty = U.number(data.quantityDeclared);
        if (!currentUser) throw new Error('Entre na sua conta antes de registrar.');
        if (qty <= 0) throw new Error('Informe uma quantidade maior que zero.');
        if (!data.productId) throw new Error('Selecione um produto.');
        if (!data.reason || !data.reason.trim()) throw new Error('Informe o motivo.');
        assertSellerStockAvailable(currentUser.id, data.productId, qty);
        await S().add('operationalMovements', {
          type: data.type,
          status: data.type === 'return' ? 'a_devolver' : 'pending',
          productId: data.productId,
          quantityDeclared: qty,
          reason: data.reason.trim(),
          notes: data.notes || '',
          affectsStock: true,
        });
        await S().refresh();
        feedback = { message: 'Registrado. Aguarde a conferência do admin.', type: 'success' };
        form.reset();
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
    });

    paint();
  }

  // ---------------------------------------------------------------------
  // Admin — fila de conferência
  // ---------------------------------------------------------------------
  function renderAdminQueue(feedback) {
    const pending = (state().operationalMovements || []).filter((movement) => ['a_devolver', 'pending'].includes(movement.status));
    const cards = pending.map((movement) => {
      const product = productById(movement.productId);
      const sellerLabel = movement.sellerId ? sellerName(movement.sellerId) : 'Estoque do admin';
      return `
        <article class="panel-card om-card" data-om-card="${U.escapeHtml(movement.id)}">
          <div class="approval-card-head">
            <strong>${U.escapeHtml(TYPE_LABELS[movement.type] || movement.type)}</strong>
            ${UI.badge(statusLabel(movement))}
          </div>
          <p>Vendedor: <strong>${U.escapeHtml(sellerLabel)}</strong> — Produto: <strong>${U.escapeHtml(product ? product.name : 'Removido')}</strong></p>
          <p>Solicitado: <strong>${U.qty(movement.quantityDeclared, product?.unit)}</strong> — Motivo: ${U.escapeHtml(movement.reason || '')}</p>
          <form class="grid-form compact-form" data-om-confirm-form>
            <label>Qtd. recebida/confirmada
              <input name="quantityReceived" type="number" step="0.001" min="0" value="${U.escapeHtml(movement.quantityDeclared)}">
            </label>
            ${movement.type === 'return' ? `
              <label>Valor unitário (para o crédito)
                <input name="unitValue" type="number" step="0.01" min="0" value="${U.escapeHtml(product?.avgCost || 0)}">
              </label>
              <label class="wide"><input type="checkbox" name="affectsFinance" ${movement.sellerId ? 'checked' : ''}> Abater da dívida do vendedor</label>
            ` : ''}
            <div class="actions">
              <button type="submit">Confirmar</button>
              <button type="button" class="danger" data-om-reject="${U.escapeHtml(movement.id)}">Recusar</button>
            </div>
          </form>
        </article>
      `;
    }).join('');
    return UI.section(
      'Devoluções, desperdícios e brindes',
      '"A devolver"/pendente não mexe em estoque nem financeiro até você conferir.',
      `${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}<div class="om-admin-list">${cards || '<div class="empty-state"><strong>Nada aguardando conferência.</strong></div>'}</div>`
    );
  }

  function mountAdmin(container, options = {}) {
    if (!container) return;
    let feedback = null;

    function paint() {
      container.innerHTML = renderAdminQueue(feedback);
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-om-confirm-form]');
      if (!form) return;
      event.preventDefault();
      const card = form.closest('[data-om-card]');
      const movement = (state().operationalMovements || []).find((item) => String(item.id) === card?.dataset.omCard);
      if (!movement) return;
      const data = U.formData(form);
      try {
        await confirmMovement(movement, {
          quantityReceived: data.quantityReceived,
          unitValue: data.unitValue,
          affectsFinance: !!data.affectsFinance,
        });
        feedback = { message: 'Movimentação conferida.', type: 'success' };
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-om-reject]');
      if (!button) return;
      if (!confirm('Recusar esta movimentação?')) return;
      const movement = (state().operationalMovements || []).find((item) => String(item.id) === button.dataset.omReject);
      if (!movement) return;
      try {
        await rejectMovement(movement);
        feedback = { message: 'Movimentação recusada.', type: 'warning' };
      } catch (error) {
        feedback = { message: error.message, type: 'danger' };
      }
      paint();
      if (typeof options.onDone === 'function') options.onDone();
    });

    paint();
  }

  window.C360.operationalMovements = { mountAdmin, mountSeller };
})();
