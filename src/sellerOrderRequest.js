/**
 * Tela "Pedir produtos" (vendedor).
 *
 * O vendedor monta um carrinho com os produtos que o admin liberou e envia
 * como pedido de reposição. Nada de estoque ou financeiro acontece aqui: o
 * envio só cria `orders` com approval_status = 'pendente_aprovacao'. Quem
 * aprova, lança a dívida e baixa o estoque é o admin, pela esteira de pedidos
 * — código que já existia e não mudou.
 *
 * Catálogo: `state().products` para o vendedor vem de `seller_products`, que
 * a RLS já filtra por `orderable_by_sellers` (migration
 * 20260801143000_seller_cart_requests). O filtro daqui é só conveniência de
 * interface — a garantia é do banco.
 */
(function () {
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const Calc = window.C360.calc;

  function S() { return window.C360.state; }
  function state() { return S().getState(); }
  function user() { return S().getCurrentUser(); }

  function catalog() {
    return (state().products || [])
      .filter((product) => product.orderableBySellers !== false)
      .filter((product) => product.type !== 'servico');
  }

  function sellerPriceFor(productId) {
    return (state().sellerPrices || []).find((row) => String(row.productId) === String(productId)) || null;
  }

  function priceInfo(product) {
    if (Calc && typeof Calc.resolveSellerPrice === 'function') {
      return Calc.resolveSellerPrice({ product, sellerPrice: sellerPriceFor(product.id) });
    }
    return { price: U.number(product.salePrice) || U.number(product.defaultPrice), floor: null };
  }

  function myPendingOrders() {
    const me = user();
    if (!me) return [];
    return (state().orders || [])
      .filter((order) => String(order.sellerId) === String(me.id))
      .filter((order) => order.approvalStatus === 'pendente_aprovacao' || order.approvalStatus === 'rejeitado');
  }

  // Pedido é enviado como um grupo (orderGroupId comum), então a tela agrupa
  // de volta para mostrar "1 pedido com 3 itens" em vez de 3 linhas soltas.
  function groupOrders(orders) {
    const groups = new Map();
    orders.forEach((order) => {
      const key = String(order.orderGroupId || order.id);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          createdAt: order.createdAt,
          approvalStatus: order.approvalStatus,
          paymentMode: order.paymentMode,
          items: [],
          total: 0,
        });
      }
      const group = groups.get(key);
      group.items.push(order);
      group.total += U.number(order.quantity) * U.number(order.unitPrice);
    });
    return [...groups.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function productCard(product, quantityInCart) {
    const { price } = priceInfo(product);
    const inCart = U.number(quantityInCart);
    return `
      <article class="request-product ${inCart > 0 ? 'is-in-cart' : ''}">
        <div class="request-product-info">
          <strong>${U.escapeHtml(product.name)}</strong>
          <span>${U.money(price)} <small>/ ${U.escapeHtml(product.unit || 'un')}</small></span>
        </div>
        <div class="request-stepper">
          <button type="button" class="small secondary" data-request-action="dec" data-product="${U.escapeHtml(product.id)}" aria-label="Diminuir ${U.escapeHtml(product.name)}">−</button>
          <input type="number" min="0" step="1" value="${inCart}" data-request-qty="${U.escapeHtml(product.id)}" aria-label="Quantidade de ${U.escapeHtml(product.name)}">
          <button type="button" class="small" data-request-action="inc" data-product="${U.escapeHtml(product.id)}" aria-label="Aumentar ${U.escapeHtml(product.name)}">+</button>
        </div>
      </article>`;
  }

  function cartSummary(cart, products) {
    const lines = Object.entries(cart)
      .filter(([, quantity]) => U.number(quantity) > 0)
      .map(([productId, quantity]) => {
        const product = products.find((item) => String(item.id) === String(productId));
        if (!product) return null;
        const { price } = priceInfo(product);
        return { product, quantity: U.number(quantity), price, total: U.number(quantity) * price };
      })
      .filter(Boolean);
    const total = lines.reduce((sum, line) => sum + line.total, 0);
    return { lines, total };
  }

  function statusBadge(approvalStatus) {
    if (approvalStatus === 'rejeitado') return UI.badge('Recusado', 'danger');
    return UI.badge('Aguardando aprovação', 'warn');
  }

  function render(data = {}) {
    const { cart = {}, feedback = null, sending = false } = data;
    const products = catalog();
    const { lines, total } = cartSummary(cart, products);
    const pendingGroups = groupOrders(myPendingOrders());

    const catalogHtml = products.length
      ? `<div class="request-catalog">${products.map((product) => productCard(product, cart[product.id])).join('')}</div>`
      : UI.formNotice('O administrador ainda não liberou nenhum produto para pedido. Fale com ele.', 'warning');

    const cartHtml = lines.length
      ? `
        <ul class="request-cart-lines">
          ${lines.map((line) => `<li><span>${U.escapeHtml(line.product.name)} <small>× ${line.quantity}</small></span><strong>${U.money(line.total)}</strong></li>`).join('')}
        </ul>
        <form class="request-send-form" data-request-form>
          <label>Como você vai pagar
            <select name="paymentMode">
              <option value="consignado">A prazo (entra como dívida)</option>
              <option value="avista">À vista</option>
            </select>
          </label>
          <label>Observações
            <input name="notes" placeholder="Opcional: prazo, urgência, combinado...">
          </label>
          <button type="submit" ${sending ? 'disabled' : ''}>${sending ? 'Enviando...' : `Enviar pedido de ${U.money(total)}`}</button>
        </form>`
      : UI.formNotice('Toque em + nos produtos para montar seu pedido.', '');

    const pendingHtml = pendingGroups.length
      ? `<div class="request-pending-list">${pendingGroups.map((group) => `
          <article class="panel-card request-pending">
            <div class="approval-card-head">
              <div>
                <strong>${U.money(group.total)}</strong>
                <small>${group.items.length} item(ns) · ${group.paymentMode === 'avista' ? 'À vista' : 'A prazo'} · ${U.escapeHtml(new Date(group.createdAt).toLocaleDateString('pt-BR'))}</small>
              </div>
              ${statusBadge(group.approvalStatus)}
            </div>
            <ul class="today-list">
              ${group.items.map((order) => {
                const product = (state().products || []).find((item) => String(item.id) === String(order.productId));
                return `<li><span>${U.escapeHtml(product ? product.name : 'Produto')} <small>× ${U.number(order.quantity)}</small></span><strong>${U.money(U.number(order.quantity) * U.number(order.unitPrice))}</strong></li>`;
              }).join('')}
            </ul>
          </article>`).join('')}</div>`
      : UI.formNotice('Nenhum pedido aguardando resposta do administrador.', '');

    return UI.section(
      'Pedir produtos',
      'Monte seu pedido com os produtos liberados e envie para o administrador aprovar. O estoque só sai depois que ele aprovar e despachar.',
      `
        ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
        <div class="request-layout">
          <div>
            <h3>Catálogo</h3>
            ${catalogHtml}
          </div>
          <aside class="panel-card request-cart">
            <div class="approval-card-head">
              <div><strong>Meu pedido</strong><small>${lines.length} produto(s)</small></div>
              <strong class="request-cart-total">${U.money(total)}</strong>
            </div>
            ${cartHtml}
          </aside>
        </div>

        <h3>Aguardando aprovação</h3>
        ${pendingHtml}
      `
    );
  }

  function mount(container) {
    if (!container) return null;
    let cart = {};
    let feedback = null;
    let sending = false;

    function paint() {
      container.innerHTML = render({ cart, feedback, sending });
    }

    function setQuantity(productId, quantity) {
      const value = Math.max(0, Math.round(U.number(quantity)));
      if (value <= 0) delete cart[productId];
      else cart[productId] = value;
      feedback = null;
      paint();
    }

    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-request-action]');
      if (!button) return;
      const productId = button.dataset.product;
      const current = U.number(cart[productId]);
      setQuantity(productId, button.dataset.requestAction === 'inc' ? current + 1 : current - 1);
    });

    container.addEventListener('change', (event) => {
      const input = event.target.closest('[data-request-qty]');
      if (!input) return;
      setQuantity(input.dataset.requestQty, input.value);
    });

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-request-form]');
      if (!form) return;
      event.preventDefault();
      const products = catalog();
      const { lines } = cartSummary(cart, products);
      if (!lines.length) return;

      sending = true;
      feedback = null;
      paint();
      try {
        await window.C360.salesCart.requestStockFromAdmin({
          paymentMode: form.elements.paymentMode.value,
          notes: form.elements.notes.value,
          items: lines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            unitPrice: line.price,
          })),
        });
        cart = {};
        feedback = { message: 'Pedido enviado. O administrador vai analisar e você acompanha aqui.', type: 'success' };
      } catch (error) {
        feedback = { message: error.message || 'Não foi possível enviar o pedido.', type: 'error' };
      } finally {
        sending = false;
        paint();
      }
    });

    paint();
    return { refresh: paint };
  }

  window.C360.sellerOrderRequest = { render, mount };
})();
