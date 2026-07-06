(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Preços por produto (padrão + piso) e preços específicos por vendedor.
  //
  // Camada de dados esperada em window.C360.api (implementada por outro
  // agente, em paralelo). Este módulo checa a existência de cada método
  // antes de chamar e cai em um placeholder inofensivo ("modo demonstração")
  // quando ela ainda não existe — mesmo padrão defensivo usado em
  // src/goals.js:
  //
  //   C360.api.list(table, query)                       -> Promise<Array<object>>
  //   C360.api.update(table, id, patch)                  -> Promise<object>
  //   C360.api.listSellerPrices(sellerId)                -> Promise<Array<{id, sellerId, productId, price, floor}>>
  //   C360.api.setSellerPrice({sellerId, productId, price, floor}) -> Promise<object> (upsert)
  //
  //   C360.state.getState()       -> objeto síncrono com cache; para ADMIN
  //                                   inclui `products` completo (com
  //                                   defaultPrice/priceFloor).
  //   C360.state.getCurrentUser() -> {id, role, name, businessId} | null
  //
  // Ver docs/backend.md §5 (products/seller_prices) e §7 (regra do piso de
  // preço) para o contrato completo destes campos.
  // ==========================================================================

  // ---------------------------------------------------------------------
  // Acesso defensivo a C360.api / C360.state
  // ---------------------------------------------------------------------
  function api() {
    return window.C360.api || null;
  }

  function hasApi(method) {
    return !!(api() && typeof api()[method] === 'function');
  }

  async function safeCall(method, ...args) {
    if (!hasApi(method)) return null;
    try {
      return await api()[method](...args);
    } catch (error) {
      console.error(`C360.pricing: erro ao chamar C360.api.${method}`, error);
      return null;
    }
  }

  function currentUser() {
    try {
      if (window.C360.state && typeof window.C360.state.getCurrentUser === 'function') {
        return window.C360.state.getCurrentUser() || null;
      }
    } catch (error) {
      console.error('C360.pricing: erro ao ler usuário atual', error);
    }
    return null;
  }

  function readProductsFromState() {
    try {
      if (window.C360.state && typeof window.C360.state.getState === 'function') {
        const st = window.C360.state.getState();
        return Array.isArray(st?.products) ? st.products : [];
      }
    } catch (error) {
      console.error('C360.pricing: erro ao ler produtos do estado', error);
    }
    return [];
  }

  // ---------------------------------------------------------------------
  // Botão de ação escopado ao módulo (não usa o delegador global de
  // cliques da aplicação — os listeners abaixo ficam presos ao container).
  // ---------------------------------------------------------------------
  function pricingActionButton(action, id, label, extraClass = 'secondary') {
    return `<button type="button" class="small ${extraClass}" data-pricing-action="${U.escapeHtml(action)}" data-id="${U.escapeHtml(id)}">${U.escapeHtml(label)}</button>`;
  }

  // ---------------------------------------------------------------------
  // Render — admin
  // ---------------------------------------------------------------------
  function productDefaultsForm(products, editingProduct) {
    const defaults = editingProduct || {};
    return `
      <form id="pricingProductForm" class="grid-form">
        <label>Produto
          <select name="productId" required ${editingProduct ? 'disabled' : ''}>
            ${UI.optionList(products, defaults.id || '', products.length ? 'Selecione' : 'Nenhum produto cadastrado')}
          </select>
        </label>
        <label>Preço padrão sugerido (R$)
          <input name="defaultPrice" type="number" step="0.01" min="0" value="${U.escapeHtml(defaults.defaultPrice ?? '')}">
        </label>
        <label>Piso mínimo de venda (R$)
          <input name="priceFloor" type="number" step="0.01" min="0" value="${U.escapeHtml(defaults.priceFloor ?? '')}">
          <span>Deixe vazio para este produto não ter piso mínimo.</span>
        </label>
        <button type="submit">${editingProduct ? 'Salvar preço padrão' : 'Definir preço padrão'}</button>
        ${editingProduct ? '<button type="button" class="ghost" data-pricing-action="cancel-edit-product">Cancelar edição</button>' : ''}
      </form>
    `;
  }

  function sellerOverrideForm(sellers, products) {
    return `
      <form id="pricingSellerForm" class="grid-form">
        <label>Vendedor
          <select name="sellerId" required>
            ${UI.optionList(sellers, '', sellers.length ? 'Selecione' : 'Nenhum vendedor disponível')}
          </select>
        </label>
        <label>Produto
          <select name="productId" required>
            ${UI.optionList(products, '', products.length ? 'Selecione' : 'Nenhum produto cadastrado')}
          </select>
        </label>
        <label>Preço deste vendedor (R$)
          <input name="price" type="number" step="0.01" min="0" placeholder="Vazio = usa o preço padrão do produto">
        </label>
        <label>Piso deste vendedor (R$)
          <input name="floor" type="number" step="0.01" min="0" placeholder="Vazio = usa o piso padrão do produto">
        </label>
        <button type="submit">Salvar preço do vendedor</button>
      </form>
    `;
  }

  function productsTable(products) {
    const rows = products.map((product) => [
      U.escapeHtml(product.name),
      U.escapeHtml(product.unit || '—'),
      UI.moneyCell(product.defaultPrice),
      product.priceFloor === null || product.priceFloor === undefined ? '—' : UI.moneyCell(product.priceFloor),
      pricingActionButton('edit-product', product.id, 'Editar'),
    ]);
    return UI.table(['Produto', 'Un.', 'Preço padrão', 'Piso mínimo', 'Ações'], rows, 'Nenhum produto cadastrado ainda.');
  }

  function overridesTable(sellerPrices, sellersById, productsById) {
    const rows = sellerPrices.map((row) => [
      U.escapeHtml(sellersById.get(String(row.sellerId))?.name || 'Vendedor removido'),
      U.escapeHtml(productsById.get(String(row.productId))?.name || 'Produto removido'),
      row.price === null || row.price === undefined ? '—' : UI.moneyCell(row.price),
      row.floor === null || row.floor === undefined ? '—' : UI.moneyCell(row.floor),
    ]);
    return UI.table(['Vendedor', 'Produto', 'Preço', 'Piso'], rows, 'Nenhum preço específico de vendedor cadastrado ainda.');
  }

  function renderAdmin(data = {}) {
    const products = data.products || [];
    const sellers = data.sellers || [];
    const sellerPrices = data.sellerPrices || [];
    const editingProduct = data.editingProductId
      ? products.find((product) => String(product.id) === String(data.editingProductId)) || null
      : null;
    const apiAvailable = data.apiAvailable !== false;
    const loading = !!data.loading;

    const sellersById = new Map(sellers.map((seller) => [String(seller.id), seller]));
    const productsById = new Map(products.map((product) => [String(product.id), product]));

    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api (update, listSellerPrices, setSellerPrice) e C360.state.getState para gerenciar preços reais.', 'warning');
    const loadingNotice = loading ? UI.formNotice('Carregando preços...', 'info') : '';

    return UI.section(
      'Preços e piso mínimo',
      'Defina o preço padrão e o piso mínimo de venda de cada produto, e ajuste preços específicos por vendedor quando necessário.',
      `
        ${notice}${loadingNotice}
        <div class="two-columns">
          <div class="panel-card">
            <h3>Preço padrão do produto</h3>
            ${productDefaultsForm(products, editingProduct)}
          </div>
          <div class="panel-card">
            <h3>Preço específico por vendedor</h3>
            ${sellerOverrideForm(sellers, products)}
          </div>
        </div>
        <h3>Produtos</h3>
        ${productsTable(products)}
        <h3>Preços por vendedor cadastrados</h3>
        ${overridesTable(sellerPrices, sellersById, productsById)}
      `
    );
  }

  // ---------------------------------------------------------------------
  // Mount — admin (listeners escopados ao container, sem depender do
  // delegador global de cliques da aplicação)
  // ---------------------------------------------------------------------
  function mountAdmin(container, options = {}) {
    if (!container) return null;

    let products = options.products || readProductsFromState();
    let sellers = options.sellers || [];
    let sellerPrices = [];
    let editingProductId = null;
    let loading = true;

    function paint() {
      container.innerHTML = renderAdmin({
        products,
        sellers,
        sellerPrices,
        editingProductId,
        loading,
        apiAvailable: hasApi('update') || hasApi('setSellerPrice') || hasApi('listSellerPrices') || hasApi('list'),
      });
    }

    // Estratégia de busca:
    // - produtos: lidos de C360.state.getState().products (o contrato diz
    //   que a visão do admin já inclui defaultPrice/priceFloor), sem round-trip
    //   de rede extra;
    // - vendedores: C360.api.list('profiles', { role: 'vendedor', businessId })
    //   — método genérico documentado no contrato (não há um listSellers
    //   dedicado nesta entrega);
    // - preços por vendedor: C360.api.listSellerPrices(sellerId) chamado uma
    //   vez por vendedor encontrado e agregado em uma lista só, com sellerId
    //   preenchido defensivamente caso a linha não venha com o campo.
    async function fetchSellers() {
      if (!hasApi('list')) return [];
      const user = currentUser();
      try {
        const rows = await api().list('profiles', { role: 'vendedor', businessId: user?.businessId });
        return Array.isArray(rows) ? rows : [];
      } catch (error) {
        console.error('C360.pricing: erro ao listar vendedores', error);
        return [];
      }
    }

    async function fetchSellerPrices(sellerList) {
      if (!hasApi('listSellerPrices') || !sellerList.length) return [];
      try {
        const perSeller = await Promise.all(sellerList.map((seller) => safeCall('listSellerPrices', seller.id)));
        return perSeller.flatMap((rows, index) => {
          if (!Array.isArray(rows)) return [];
          return rows.map((row) => ({ ...row, sellerId: row.sellerId ?? sellerList[index].id }));
        });
      } catch (error) {
        console.error('C360.pricing: erro ao listar preços por vendedor', error);
        return [];
      }
    }

    async function loadAll() {
      loading = true;
      paint();
      products = readProductsFromState();
      sellers = await fetchSellers();
      sellerPrices = await fetchSellerPrices(sellers);
      loading = false;
      paint();
    }

    container.addEventListener('submit', async (event) => {
      const productForm = event.target.closest('#pricingProductForm');
      const sellerForm = event.target.closest('#pricingSellerForm');

      if (productForm) {
        event.preventDefault();
        try {
          const data = U.formData(productForm);
          const productId = editingProductId || data.productId;
          if (!productId) throw new Error('Selecione um produto.');
          const patch = {
            default_price: data.defaultPrice === '' ? 0 : U.number(data.defaultPrice),
            price_floor: data.priceFloor === '' ? null : U.number(data.priceFloor),
          };
          if (hasApi('update')) {
            await api().update('products', productId, patch);
          } else {
            alert('Modo demonstração: conecte C360.api.update para salvar preços reais.');
          }
          editingProductId = null;
          await loadAll();
        } catch (error) {
          alert(error.message);
        }
        return;
      }

      if (sellerForm) {
        event.preventDefault();
        try {
          const data = U.formData(sellerForm);
          if (!data.sellerId) throw new Error('Selecione um vendedor.');
          if (!data.productId) throw new Error('Selecione um produto.');
          const payload = {
            sellerId: data.sellerId,
            productId: data.productId,
            price: data.price === '' ? null : U.number(data.price),
            floor: data.floor === '' ? null : U.number(data.floor),
          };
          if (hasApi('setSellerPrice')) {
            await api().setSellerPrice(payload);
          } else {
            alert('Modo demonstração: conecte C360.api.setSellerPrice para salvar preços reais.');
          }
          await loadAll();
        } catch (error) {
          alert(error.message);
        }
      }
    });

    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pricing-action]');
      if (!button) return;
      const { pricingAction, id } = button.dataset;
      if (pricingAction === 'edit-product') {
        editingProductId = id;
        paint();
      } else if (pricingAction === 'cancel-edit-product') {
        editingProductId = null;
        paint();
      }
    });

    paint();
    loadAll();

    return { refresh: loadAll };
  }

  // ---------------------------------------------------------------------
  // Vendedor — hint de preço sugerido/mínimo e validação reutilizável
  //
  // Ponto de integração para a tela de VENDAS/DEVOLUÇÕES (dono: outro
  // agente): antes de enviar o formulário de venda, chamar
  //
  //   const result = C360.pricing.validateSalePriceInput(inputValue, { product, sellerPrice });
  //   if (!result.ok) { mostrar result.message e bloquear o envio; }
  //   // caso contrário, usar result.parsedPrice como unitPrice numérico.
  //
  // `product` é o item vindo de seller_products/products (precisa apenas de
  // salePrice/defaultPrice/priceFloor). `sellerPrice` é a linha de
  // seller_prices do vendedor logado para este produto, ou null/undefined
  // se ele não tiver override. Quem monta o formulário de venda decide como
  // obter esses dois objetos (ex.: via C360.api.listSellerPrices(currentUser.id)
  // filtrado pelo productId) — esta função não faz a busca sozinha para não
  // acoplar ao layout do formulário de vendas.
  // ---------------------------------------------------------------------
  function renderSellerFloorHint(product, sellerPrice) {
    const Calc = window.C360.calc;
    if (!Calc || typeof Calc.resolveSellerPrice !== 'function') return '';
    const resolved = Calc.resolveSellerPrice({ product, sellerPrice });
    const suggestedText = `Preço sugerido: ${U.money(resolved.price)}`;
    const floorText = resolved.floor === null || resolved.floor === undefined
      ? 'sem piso mínimo definido'
      : `Mínimo: ${U.money(resolved.floor)}`;
    return `<p class="pricing-hint">${suggestedText} · ${floorText}</p>`;
  }

  function validateSalePriceInput(unitPriceString, context = {}) {
    const parsedPrice = U.number(unitPriceString);
    const Calc = window.C360.calc;
    if (!Calc || typeof Calc.resolveSellerPrice !== 'function' || typeof Calc.validatePriceFloor !== 'function') {
      // Camadas de cálculo indisponíveis: não bloqueia o vendedor, o servidor
      // (trigger de piso de preço) continua sendo a garantia final.
      return { ok: true, message: null, parsedPrice };
    }
    const { floor } = Calc.resolveSellerPrice({ product: context.product, sellerPrice: context.sellerPrice });
    const result = Calc.validatePriceFloor({ unitPrice: parsedPrice, floor });
    return { ok: result.ok, message: result.message, parsedPrice };
  }

  window.C360.pricing = {
    renderAdmin,
    mountAdmin,
    renderSellerFloorHint,
    validateSalePriceInput,
  };
})();
