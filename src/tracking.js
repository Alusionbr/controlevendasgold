(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  const STATUS = {
    in_transit: ['Em trânsito', 'warn'],
    delivered: ['Entregue', 'ok'],
    closed: ['Encerrada', 'ok'],
    cancelled: ['Cancelada', 'danger'],
  };
  const SETTLEMENT = { upon_sale: 'Conforme vende', weekly: 'Semanal', monthly: 'Mensal' };
  let draftItems = [];
  let feedback = null;
  let filters = { direction: '', status: '', partner: '' };

  function S() { return window.C360.state; }
  function api() { return window.C360.api; }
  function state() { return S().getState(); }
  function isAdmin() { return S().isAdmin(); }
  function shipments() { return state().trackingShipments || []; }
  function shipmentItems(id) { return (state().trackingShipmentItems || []).filter((row) => row.shipmentId === id); }
  function shipmentEvents(id) { return (state().trackingShipmentEvents || []).filter((row) => row.shipmentId === id); }
  function product(id) { return (state().products || []).find((row) => row.id === id) || null; }
  function client(id) { return (state().clients || []).find((row) => row.id === id) || null; }
  function supplier(id) { return (state().suppliers || []).find((row) => row.id === id) || null; }
  function seller(id) { return [state().profile, ...(state().profiles || []), ...(state().sellers || [])].filter(Boolean).find((row) => row.id === id) || null; }

  function partnerName(shipment) {
    if (shipment.partnerType === 'supplier') return supplier(shipment.supplierId)?.name || 'Fornecedor';
    if (shipment.partnerType === 'seller') return seller(shipment.sellerId)?.name || 'Vendedor';
    return client(shipment.clientId)?.name || 'Cliente/parceiro';
  }

  function code(id) { return `#${String(id || '').slice(0, 8).toUpperCase()}`; }

  function daysSince(dateText) {
    if (!dateText) return null;
    const start = new Date(`${String(dateText).slice(0, 10)}T12:00:00`);
    const now = new Date(`${U.today()}T12:00:00`);
    return Math.max(0, Math.floor((now - start) / 86400000));
  }

  function statusBadge(shipment) {
    const [label, tone] = STATUS[shipment.status] || [shipment.status, ''];
    return UI.badge(label, tone);
  }

  function sourceAvailable(sourceItem) {
    const allocated = (state().trackingShipmentItems || [])
      .filter((item) => item.sourceItemId === sourceItem.id)
      .reduce((sum, item) => sum + U.number(item.quantity) - U.number(item.quantityReturned), 0);
    return Math.max(0, U.number(sourceItem.quantity) - U.number(sourceItem.quantityReturned) - allocated);
  }

  function sourceOptions() {
    const options = [];
    (state().trackingShipmentItems || []).forEach((item) => {
      const shipment = shipments().find((row) => row.id === item.shipmentId);
      const available = sourceAvailable(item);
      if (!shipment || shipment.direction !== 'inbound' || !['delivered', 'closed'].includes(shipment.status) || available <= 0) return;
      const p = product(item.productId);
      options.push({
        id: item.id,
        name: `${p?.name || 'Produto'} · ${partnerName(shipment)} · ${U.qty(available, p?.unit)} disponíveis · ${code(shipment.id)}`,
      });
    });
    return options;
  }

  function settlementDayLabel(shipment) {
    if (shipment.settlementMode === 'weekly') {
      return ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][U.number(shipment.settlementDay) - 1] || '';
    }
    if (shipment.settlementMode === 'monthly') return `dia ${shipment.settlementDay}`;
    return '';
  }

  function renderDraftItems() {
    const rows = draftItems.map((item, index) => {
      const p = product(item.productId);
      const source = item.sourceItemId ? sourceOptions().find((row) => row.id === item.sourceItemId) : null;
      return [
        UI.productName(p), U.qty(item.quantity, p?.unit), UI.moneyCell(item.unitPrice),
        source ? U.escapeHtml(source.name) : 'Estoque próprio/sem origem cadastrada',
        `<button type="button" class="small danger ghost" data-tracking-action="remove-draft-item" data-index="${index}">Remover</button>`,
      ];
    });
    return UI.table(['Produto', 'Quantidade', 'Valor unitário', 'Origem', ''], rows, 'Adicione ao menos um produto à remessa.');
  }

  function renderCreateForm() {
    const products = (state().products || []).filter((row) => row.type !== 'servico');
    const sellers = (state().profiles || []).filter((row) => row.role === 'vendedor' && row.active !== false);
    return `
      <details class="tracking-create" open>
        <summary>Nova remessa rastreada</summary>
        ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
        <form id="trackingShipmentForm" class="grid-form">
          <label>Sentido
            <select name="direction" required>
              <option value="outbound">Enviada a vendedor/loja</option>
              <option value="inbound">Recebida de fornecedor</option>
            </select>
          </label>
          <label>Fornecedor da entrada
            <select name="supplierId">${UI.optionList(state().suppliers || [], '', 'Selecione para entrada')}</select>
          </label>
          <label>Tipo de destino
            <select name="outboundPartnerType"><option value="client">Cliente/loja</option><option value="seller">Vendedor</option></select>
          </label>
          <label>Cliente/loja de destino
            <select name="clientId">${UI.optionList(state().clients || [], '', 'Selecione')}</select>
          </label>
          <label>Vendedor de destino
            <select name="sellerId">${UI.optionList(sellers, '', 'Selecione')}</select>
          </label>
          <label>Data de saída<input type="date" name="departedAt" value="${U.today()}" required></label>
          <label>Data de entrega<input type="date" name="deliveredAt"><small>Deixe em branco enquanto estiver em trânsito.</small></label>
          <label>Forma de acerto
            <select name="settlementMode" required>
              <option value="upon_sale">Conforme vende</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
            </select>
          </label>
          <label>Dia do acerto<input type="number" name="settlementDay" min="1" max="31"><small>Semanal: 1=segunda e 7=domingo. Mensal: 1 a 31.</small></label>
          <label class="wide">Observações<textarea name="notes" rows="2"></textarea></label>
          <div class="wide tracking-item-builder">
            <h3>Produtos da remessa</h3>
            <div class="grid-form compact-grid">
              <label>Produto<select name="itemProductId">${UI.optionList(products, '', 'Produto')}</select></label>
              <label>Quantidade<input type="number" name="itemQuantity" min="0.001" step="0.001"></label>
              <label>Valor acordado/unidade<input type="number" name="itemUnitPrice" min="0" step="0.01"></label>
              <label>Custo/unidade<input type="number" name="itemUnitCost" min="0" step="0.0001"><small>Na entrada, use o custo de aquisição.</small></label>
              <label>Remessa de origem<select name="itemSourceId">${UI.optionList(sourceOptions(), '', 'Estoque próprio/sem origem')}</select></label>
              <button type="button" class="secondary" data-tracking-action="add-draft-item">Adicionar produto</button>
            </div>
            <div data-tracking-draft>${renderDraftItems()}</div>
          </div>
          <button type="submit">Registrar remessa</button>
        </form>
      </details>
    `;
  }

  function renderItemActions(item, shipment) {
    if (!isAdmin() || !['delivered', 'closed'].includes(shipment.status)) return '';
    const available = Math.max(0, U.number(item.quantity) - U.number(item.quantitySold) - U.number(item.quantityReturned));
    if (available <= 0) return '';
    const p = product(item.productId);
    return `
      <div class="tracking-item-actions">
        ${shipment.direction === 'outbound' ? `
          <form data-tracking-form="sale" class="inline-form">
            <input type="hidden" name="itemId" value="${U.escapeHtml(item.id)}">
            <label>Qtd. vendida<input name="quantity" type="number" min="0.001" max="${available}" step="0.001" required></label>
            <label>Preço ao consumidor<input name="unitPrice" type="number" min="0" step="0.01" value="${U.number(item.unitPrice)}"></label>
            <label>Cliente final (opcional)<select name="clientId">${UI.optionList(state().clients || [], '', 'Não informado')}</select></label>
            <label>Data<input name="soldAt" type="datetime-local" required></label>
            <button type="submit" class="small">Informar venda</button>
          </form>` : ''}
        <form data-tracking-form="return" class="inline-form">
          <input type="hidden" name="itemId" value="${U.escapeHtml(item.id)}">
          <label>Qtd. devolvida<input name="quantity" type="number" min="0.001" max="${available}" step="0.001" required></label>
          <label>Data<input name="returnedAt" type="date" value="${U.today()}" required></label>
          <label>Motivo<input name="notes" placeholder="Motivo/condição"></label>
          <button type="submit" class="small secondary">${shipment.direction === 'inbound' ? 'Devolver ao fornecedor' : 'Receber devolução'}</button>
        </form>
      </div>
    `;
  }

  function renderShipmentItem(item, shipment) {
    const p = product(item.productId);
    const available = Math.max(0, U.number(item.quantity) - U.number(item.quantitySold) - U.number(item.quantityReturned));
    const sourceItem = item.sourceItemId ? (state().trackingShipmentItems || []).find((row) => row.id === item.sourceItemId) : null;
    const sourceShipment = sourceItem ? shipments().find((row) => row.id === sourceItem.shipmentId) : null;
    return `
      <article class="tracking-line">
        <div>
          <strong>${UI.productName(p)}</strong>
          <p>Enviado: ${U.qty(item.quantity, p?.unit)} · Vendido: ${U.qty(item.quantitySold, p?.unit)} · Devolvido: ${U.qty(item.quantityReturned, p?.unit)} · Em mãos: ${U.qty(available, p?.unit)}</p>
          <p>Valor acordado: ${U.money(item.unitPrice)} por unidade · Custo registrado: ${U.money(item.unitCost)}</p>
          ${sourceShipment ? `<p>Origem: ${code(sourceShipment.id)} · ${U.escapeHtml(partnerName(sourceShipment))}</p>` : '<p>Origem: estoque próprio ou histórico anterior.</p>'}
        </div>
        ${renderItemActions(item, shipment)}
      </article>
    `;
  }

  function eventText(event) {
    const item = event.shipmentItemId ? (state().trackingShipmentItems || []).find((row) => row.id === event.shipmentItemId) : null;
    const p = item ? product(item.productId) : null;
    const names = { dispatch: 'Saída', delivery: 'Entrega', sale: 'Venda informada', return: 'Devolução', payment: 'Pagamento', note: 'Observação' };
    const detail = event.quantity > 0 ? ` · ${U.qty(event.quantity, p?.unit)}` : '';
    const amount = event.amount > 0 ? ` · ${U.money(event.amount)}` : '';
    const customer = event.clientId ? ` · ${client(event.clientId)?.name || 'Cliente final'}` : '';
    return `<li><strong>${names[event.type] || event.type}</strong> · ${new Date(event.eventAt).toLocaleString('pt-BR')}${detail}${amount}${customer}${event.notes ? `<br><small>${U.escapeHtml(event.notes)}</small>` : ''}</li>`;
  }

  function renderShipment(shipment) {
    const items = shipmentItems(shipment.id);
    const events = shipmentEvents(shipment.id);
    const age = daysSince(shipment.deliveredAt || shipment.departedAt);
    const balance = Math.max(0, U.number(shipment.totalAmount) - U.number(shipment.paidAmount));
    const overdue = shipment.dueDate && shipment.dueDate < U.today() && balance > 0;
    return `
      <details class="tracking-card" data-shipment-id="${U.escapeHtml(shipment.id)}">
        <summary>
          <span><strong>${code(shipment.id)}</strong> ${shipment.direction === 'inbound' ? 'Recebida de' : 'Enviada para'} ${U.escapeHtml(partnerName(shipment))}</span>
          <span>${statusBadge(shipment)} ${overdue ? UI.badge('Acerto atrasado', 'danger') : ''}</span>
        </summary>
        <div class="tracking-summary-grid">
          <div><span>Em posse/trânsito há</span><strong>${age === null ? '—' : `${age} dia(s)`}</strong></div>
          <div><span>Valor ajustado</span><strong>${U.money(shipment.totalAmount)}</strong></div>
          <div><span>Pago</span><strong>${U.money(shipment.paidAmount)}</strong></div>
          <div><span>Em aberto</span><strong>${U.money(balance)}</strong></div>
          <div><span>Crédito</span><strong>${U.money(shipment.creditAmount)}</strong></div>
          <div><span>Acerto</span><strong>${U.escapeHtml(SETTLEMENT[shipment.settlementMode] || '')} ${U.escapeHtml(settlementDayLabel(shipment))}</strong></div>
        </div>
        <p>Saída: <strong>${U.escapeHtml(shipment.departedAt)}</strong> · Entrega: <strong>${U.escapeHtml(shipment.deliveredAt || 'a confirmar')}</strong> · Próximo acerto: <strong>${U.escapeHtml(shipment.dueDate || 'conforme venda')}</strong></p>
        ${shipment.notes ? `<p>${U.escapeHtml(shipment.notes)}</p>` : ''}
        ${items.map((item) => renderShipmentItem(item, shipment)).join('')}
        ${isAdmin() && !shipment.deliveredAt ? `
          <form data-tracking-form="delivery" class="inline-form">
            <input type="hidden" name="shipmentId" value="${U.escapeHtml(shipment.id)}">
            <label>Data da entrega<input name="deliveredAt" type="date" value="${U.today()}" required></label>
            <button type="submit">Confirmar entrega</button>
          </form>` : ''}
        ${isAdmin() && shipment.deliveredAt && balance > 0 ? `
          <form data-tracking-form="payment" class="inline-form">
            <input type="hidden" name="shipmentId" value="${U.escapeHtml(shipment.id)}">
            <label>Valor do acerto<input name="amount" type="number" min="0.01" step="0.01" required></label>
            <label>Data<input name="paymentDate" type="date" value="${U.today()}" required></label>
            <label>Forma<input name="method" placeholder="Pix, dinheiro..."></label>
            <label>Observação<input name="notes"></label>
            <button type="submit">Registrar pagamento</button>
          </form>` : ''}
        <details class="tracking-timeline"><summary>Linha do tempo (${events.length})</summary><ol>${events.map(eventText).join('')}</ol></details>
      </details>
    `;
  }

  function filteredShipments() {
    return shipments().filter((shipment) => {
      if (filters.direction && shipment.direction !== filters.direction) return false;
      if (filters.status && shipment.status !== filters.status) return false;
      if (filters.partner && !partnerName(shipment).toLocaleLowerCase('pt-BR').includes(filters.partner.toLocaleLowerCase('pt-BR'))) return false;
      return true;
    });
  }

  function renderDashboard() {
    const rows = shipments();
    const inTransit = rows.filter((row) => row.status === 'in_transit').length;
    const open = rows.reduce((sum, row) => sum + Math.max(0, U.number(row.totalAmount) - U.number(row.paidAmount)), 0);
    const overdue = rows.filter((row) => row.dueDate && row.dueDate < U.today() && U.number(row.totalAmount) > U.number(row.paidAmount));
    const withPartners = (state().trackingShipmentItems || []).reduce((sum, item) => {
      const shipment = rows.find((row) => row.id === item.shipmentId);
      return shipment?.direction === 'outbound' && shipment.status !== 'cancelled'
        ? sum + Math.max(0, U.number(item.quantity) - U.number(item.quantitySold) - U.number(item.quantityReturned)) * U.number(item.unitCost)
        : sum;
    }, 0);
    return `<div class="metrics-grid tracking-metrics">
      ${UI.metric('Remessas em trânsito', String(inTransit))}
      ${UI.metric('Mercadoria com parceiros', U.money(withPartners))}
      ${UI.metric('Acertos em aberto', U.money(open))}
      ${UI.metric('Acertos atrasados', `${overdue.length} · ${U.money(overdue.reduce((sum, row) => sum + U.number(row.totalAmount) - U.number(row.paidAmount), 0))}`)}
    </div>`;
  }

  function render() {
    const rows = filteredShipments();
    return UI.section('Rastreio 360', 'Veja de onde veio, onde está, quanto vendeu, há quanto tempo e quanto falta acertar.', `
      ${renderDashboard()}
      ${isAdmin() ? renderCreateForm() : ''}
      <div class="tracking-filters">
        <label>Sentido<select data-tracking-filter="direction"><option value="">Todos</option><option value="outbound" ${filters.direction === 'outbound' ? 'selected' : ''}>Enviadas</option><option value="inbound" ${filters.direction === 'inbound' ? 'selected' : ''}>Recebidas</option></select></label>
        <label>Situação<select data-tracking-filter="status"><option value="">Todas</option>${Object.entries(STATUS).map(([value, [label]]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Parceiro<input data-tracking-filter="partner" value="${U.escapeHtml(filters.partner)}" placeholder="Buscar nome"></label>
      </div>
      <div class="tracking-list">${rows.length ? rows.map(renderShipment).join('') : '<div class="empty-state"><strong>Nenhuma remessa encontrada.</strong><span>Registre uma remessa ou ajuste os filtros.</span></div>'}</div>
    `, 'Rastreio completo de mercadorias e acertos.');
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button, input, select, textarea').forEach((element) => { element.disabled = busy; });
  }

  function fail(error) {
    feedback = { message: error?.message || 'Não foi possível concluir a operação.', type: 'danger' };
    window.C360.app?.toast(feedback.message, 'danger');
  }

  async function run(form, operation) {
    setBusy(form, true);
    try {
      await operation();
      await S().refresh();
      feedback = { message: 'Operação registrada com sucesso.', type: 'success' };
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(form, false);
    }
  }

  function mount(container) {
    if (!container) return;
    const paint = () => { container.innerHTML = render(); };
    paint();

    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tracking-action]');
      if (!button) return;
      if (button.dataset.trackingAction === 'remove-draft-item') {
        draftItems.splice(Number(button.dataset.index), 1);
        paint();
        return;
      }
      if (button.dataset.trackingAction === 'add-draft-item') {
        const form = button.closest('form');
        const data = U.formData(form);
        try {
          U.assertPositive(data.itemQuantity, 'Quantidade');
          if (!data.itemProductId) throw new Error('Selecione o produto.');
          const p = product(data.itemProductId);
          const unitPrice = U.number(data.itemUnitPrice);
          if (unitPrice < 0) throw new Error('Valor unitário inválido.');
          draftItems.push({
            productId: data.itemProductId,
            quantity: U.number(data.itemQuantity),
            unitPrice,
            unitCost: data.itemUnitCost === '' ? U.number(p?.avgCost) : U.number(data.itemUnitCost),
            sourceItemId: data.itemSourceId || null,
          });
          feedback = null;
          paint();
        } catch (error) { fail(error); paint(); }
      }
    });

    container.addEventListener('input', (event) => {
      const input = event.target.closest('[data-tracking-filter]');
      if (!input) return;
      filters[input.dataset.trackingFilter] = input.value;
      if (input.dataset.trackingFilter === 'partner') {
        container.querySelector('.tracking-list').innerHTML = filteredShipments().map(renderShipment).join('') || '<div class="empty-state"><strong>Nenhuma remessa encontrada.</strong></div>';
      } else paint();
    });

    container.addEventListener('submit', async (event) => {
      const form = event.target;
      if (form.id !== 'trackingShipmentForm' && !form.dataset.trackingForm) return;
      event.preventDefault();
      const data = U.formData(form);
      if (form.id === 'trackingShipmentForm') {
        try {
          if (!draftItems.length) throw new Error('Adicione ao menos um produto à remessa.');
          const direction = data.direction;
          const partnerType = direction === 'inbound' ? 'supplier' : data.outboundPartnerType;
          const partnerId = direction === 'inbound' ? data.supplierId : (partnerType === 'seller' ? data.sellerId : data.clientId);
          if (!partnerId) throw new Error('Selecione o parceiro da remessa.');
          const day = data.settlementMode === 'upon_sale' ? null : U.number(data.settlementDay);
          if (data.settlementMode === 'weekly' && (day < 1 || day > 7)) throw new Error('No acerto semanal, informe um dia entre 1 e 7.');
          if (data.settlementMode === 'monthly' && (day < 1 || day > 31)) throw new Error('No acerto mensal, informe um dia entre 1 e 31.');
          const items = draftItems.map((item) => ({
            product_id: item.productId, quantity: item.quantity, unit_price: item.unitPrice,
            unit_cost: item.unitCost, source_item_id: item.sourceItemId,
          }));
          const ok = await run(form, () => api().createTrackingShipment({
            direction, partnerType, partnerId, departedAt: data.departedAt,
            deliveredAt: data.deliveredAt || null, settlementMode: data.settlementMode,
            settlementDay: day, notes: data.notes, items, requestId: crypto.randomUUID(),
          }));
          if (ok) draftItems = [];
        } catch (error) { fail(error); }
        paint();
        return;
      }

      const requestId = crypto.randomUUID();
      let operation;
      if (form.dataset.trackingForm === 'delivery') operation = () => api().confirmTrackingShipmentDelivery({ ...data, requestId });
      if (form.dataset.trackingForm === 'sale') operation = () => api().registerTrackingShipmentSale({ ...data, requestId, soldAt: new Date(data.soldAt).toISOString() });
      if (form.dataset.trackingForm === 'return') operation = () => api().registerTrackingShipmentReturn({ ...data, requestId });
      if (form.dataset.trackingForm === 'payment') operation = () => api().registerTrackingShipmentPayment({ ...data, requestId });
      if (operation && await run(form, operation)) paint();
      else paint();
    });
  }

  window.C360.tracking = { mount };
})();
