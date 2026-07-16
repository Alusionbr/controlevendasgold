(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Rascunho de pedidos: bloco de notas para anotar rapidamente um pedido
  // combinado (cliente, produto, quantidade, observação) antes de virar uma
  // venda de verdade. Não mexe em estoque nem financeiro — só guarda a nota
  // em `order_drafts` (ver supabase/migrations/0026_order_drafts.sql).
  // "Lançar" joga os dados para o carrinho de vendas (src/salesCart.js
  // prefillFromDraft) e apaga a nota; "Descartar" só apaga. Sem status/
  // arquivo: a lista é sempre "o que ainda falta lançar".
  // ==========================================================================

  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }

  function productById(id) {
    return (state().products || []).find((item) => String(item.id) === String(id)) || null;
  }

  function currentDrafts() {
    const businessId = state().activeBusinessId;
    return (state().orderDrafts || []).filter((row) => row.businessId === businessId);
  }

  function draftCardHtml(draft) {
    const product = draft.productId ? productById(draft.productId) : null;
    const summaryParts = [];
    if (draft.clientName) summaryParts.push(`<strong>${U.escapeHtml(draft.clientName)}</strong>`);
    if (product) summaryParts.push(`${U.escapeHtml(product.name)}${draft.quantity ? ` · ${U.qty(draft.quantity, product.unit)}` : ''}`);
    else if (draft.quantity) summaryParts.push(`Qtd. ${U.qty(draft.quantity)}`);

    return `
      <article class="panel-card order-draft-card" data-draft-id="${U.escapeHtml(draft.id)}">
        ${summaryParts.length ? `<p class="od-summary">${summaryParts.join(' — ')}</p>` : ''}
        ${draft.notes ? `<p class="od-notes">${U.escapeHtml(draft.notes)}</p>` : ''}
        <div class="actions">
          ${UI.actionButton('draft-launch', draft.id, 'Lançar')}
          ${UI.actionButton('draft-discard', draft.id, 'Descartar', 'danger')}
        </div>
      </article>
    `;
  }

  function render(data = {}) {
    const drafts = data.drafts || [];
    const products = (state().products || []).filter((product) => product.type !== 'servico');

    return UI.section(
      'Rascunho de pedidos',
      'Anote rapidamente um pedido combinado e lance quando estiver pronto — nada aqui mexe em estoque ou financeiro.',
      `
        ${data.feedback ? UI.formNotice(data.feedback.message, data.feedback.type) : ''}
        <form id="orderDraftForm" class="grid-form compact-form">
          <label>Cliente
            <input name="clientName" placeholder="Nome ou apelido">
          </label>
          <label>Produto
            <select name="productId">${UI.optionList(products, '', 'Opcional')}</select>
          </label>
          <label>Quantidade
            <input name="quantity" type="number" step="0.001" min="0" placeholder="Opcional">
          </label>
          <label class="wide">Observação
            <input name="notes" placeholder="Ex.: combinou buscar sexta, quer 2 caixas...">
          </label>
          <button type="submit">Anotar</button>
        </form>
        ${drafts.length
          ? `<div class="order-draft-grid">${drafts.map(draftCardHtml).join('')}</div>`
          : '<div class="empty-state"><strong>Nenhum rascunho no momento.</strong><span>Anote aqui um pedido combinado antes de lançar a venda de verdade.</span></div>'}
      `
    );
  }

  function mount(container) {
    if (!container) return null;
    let feedback = null;

    function paint() {
      const drafts = U.sortByDateDesc(currentDrafts(), 'createdAt');
      container.innerHTML = render({ drafts, feedback });
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('#orderDraftForm');
      if (!form || !container.contains(form)) return;
      event.preventDefault();
      const data = U.formData(form);
      const notes = (data.notes || '').trim();
      const clientName = (data.clientName || '').trim();
      if (!notes && !clientName && !data.productId) {
        feedback = { message: 'Preencha ao menos um campo para anotar o pedido.', type: 'danger' };
        paint();
        return;
      }
      try {
        await S().add('orderDrafts', {
          createdBy: user()?.id || null,
          clientName: clientName || null,
          productId: data.productId || null,
          quantity: data.quantity ? U.number(data.quantity) : null,
          notes: notes || null,
        });
        feedback = null;
        paint();
      } catch (error) {
        feedback = { message: (error && error.message) || 'Não foi possível salvar o rascunho.', type: 'danger' };
        paint();
      }
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const { action, id } = button.dataset;

      if (action === 'draft-discard') {
        if (!confirm('Descartar este rascunho?')) return;
        await S().remove('orderDrafts', id);
        paint();
        return;
      }

      if (action === 'draft-launch') {
        const draft = currentDrafts().find((item) => String(item.id) === String(id));
        if (!draft) return;
        if (window.C360.salesCart && typeof window.C360.salesCart.prefillFromDraft === 'function') {
          window.C360.salesCart.prefillFromDraft({
            productId: draft.productId,
            quantity: draft.quantity,
            notes: draft.notes,
            clientName: draft.clientName,
          });
        }
        await S().remove('orderDrafts', id);
        if (window.C360.app && typeof window.C360.app.setTab === 'function') window.C360.app.setTab('vendas');
        if (window.C360.app && typeof window.C360.app.toast === 'function') {
          window.C360.app.toast('Rascunho movido para o carrinho de vendas. Confira e finalize.', 'success');
        }
      }
    });

    paint();
    return { refresh: paint };
  }

  window.C360.orderDrafts = { render, mount };
})();
