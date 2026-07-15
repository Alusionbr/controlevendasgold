(function () {
  'use strict';

  const U = window.C360.utils;
  const S = window.C360.state;
  const Calc = window.C360.calc;
  const UI = window.C360.ui;

  // ---------------------------------------------------------------------
  // Navegação: fonte única de abas (ordem + rótulo + papéis permitidos).
  // A barra de abas do desktop, a bottom-nav mobile e o menu "Mais" são
  // todos gerados a partir deste mapa, em vez de listas duplicadas em
  // index.html e aqui (fonte antiga do bug de dessincronização).
  // ---------------------------------------------------------------------
  const TAB_ORDER = [
    'hoje', 'negocios', 'produtos', 'clientes', 'fornecedores', 'compras',
    'fichas', 'producao', 'vendas', 'consignado', 'financeiro', 'estoque',
    'tarefas', 'relatorios', 'vendedores', 'precos',
    'meusaldo', 'devolucoes', 'minhasdevolucoes', 'calculadora', 'metas',
    'ajuda', 'dados',
  ];

  const TAB_LABELS = {
    hoje: 'Hoje',
    negocios: 'Negócios',
    produtos: 'Produtos',
    clientes: 'Clientes',
    fornecedores: 'Fornecedores',
    compras: 'Compras',
    fichas: 'Fichas e custos',
    producao: 'Produção',
    vendas: 'Vendas',
    consignado: 'Consignado',
    financeiro: 'Financeiro',
    estoque: 'Meu estoque',
    tarefas: 'Tarefas',
    relatorios: 'Relatórios',
    vendedores: 'Vendedores',
    precos: 'Preços',
    meusaldo: 'Meu saldo com admin',
    devolucoes: 'Devoluções, desperdícios e brindes',
    minhasdevolucoes: 'Devoluções e brindes',
    calculadora: 'Calculadora',
    metas: 'Metas',
    ajuda: 'Ajuda',
    dados: 'Dados',
  };

  // Defesa em profundidade: a RLS do banco já bloqueia o acesso real, isto
  // só evita que a interface ofereça botões que dariam erro de permissão.
  const TAB_ROLES = {
    hoje: ['admin', 'vendedor'],
    negocios: ['admin'],
    produtos: ['admin'],
    clientes: ['admin', 'vendedor'],
    fornecedores: ['admin'],
    compras: ['admin'],
    fichas: ['admin'],
    producao: ['admin'],
    vendas: ['admin', 'vendedor'],
    consignado: ['admin', 'vendedor'],
    financeiro: ['admin'],
    estoque: ['vendedor'],
    tarefas: ['admin'],
    relatorios: ['admin'],
    vendedores: ['admin'],
    precos: ['admin'],
    meusaldo: ['vendedor'],
    devolucoes: ['admin'],
    minhasdevolucoes: ['vendedor'],
    calculadora: ['admin', 'vendedor'],
    metas: ['admin', 'vendedor'],
    ajuda: ['admin', 'vendedor'],
    dados: ['admin'],
  };

  // Bottom-nav mobile: 4 destinos principais por perfil + botão "Mais"
  // (sempre o 5º item) para o restante das abas permitidas ao papel.
  const BOTTOM_NAV_PRIMARY = {
    admin: ['hoje', 'vendas', 'financeiro', 'produtos'],
    vendedor: ['hoje', 'vendas', 'clientes', 'estoque'],
  };
  const BOTTOM_NAV_SHORT_LABELS = { vendas: 'Vender', produtos: 'Estoque', financeiro: 'Financeiro' };

  function buildTabsBar() {
    const bar = document.getElementById('tabsBar');
    if (!bar) return;
    bar.innerHTML = TAB_ORDER.map((tab) => `<button class="tab-button" data-tab="${tab}">${U.escapeHtml(TAB_LABELS[tab])}</button>`).join('');
  }

  function buildBottomNav() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;
    nav.innerHTML = Object.keys(BOTTOM_NAV_PRIMARY).map((role) => {
      const items = BOTTOM_NAV_PRIMARY[role].map((tab) => `
        <button type="button" class="bottom-nav-item" data-tab="${tab}">
          <span class="bottom-nav-label">${U.escapeHtml(BOTTOM_NAV_SHORT_LABELS[tab] || TAB_LABELS[tab])}</span>
        </button>
      `).join('');
      return `
        <div class="bottom-nav-set" data-role-set="${role}" hidden>
          ${items}
          <button type="button" class="bottom-nav-item" data-more-menu-open>
            <span class="bottom-nav-label">Mais</span>
          </button>
        </div>
      `;
    }).join('');
  }

  function buildMoreMenu() {
    const list = document.getElementById('moreMenuList');
    if (!list) return;
    list.innerHTML = Object.keys(BOTTOM_NAV_PRIMARY).map((role) => {
      const primary = new Set(BOTTOM_NAV_PRIMARY[role]);
      const items = TAB_ORDER.filter((tab) => tab !== 'hoje' && !primary.has(tab) && (TAB_ROLES[tab] || []).includes(role));
      return `
        <div class="more-menu-role" data-role-set="${role}" hidden>
          ${items.map((tab) => `<button type="button" class="more-menu-item" data-tab="${tab}">${U.escapeHtml(TAB_LABELS[tab])}</button>`).join('')}
        </div>
      `;
    }).join('');
  }

  buildTabsBar();
  buildBottomNav();
  buildMoreMenu();

  const els = {
    view: document.getElementById('view'),
    dashboard: document.getElementById('dashboard'),
    activeBusiness: document.getElementById('activeBusiness'),
    btnExport: document.getElementById('btnExport'),
    btnDataTab: document.getElementById('btnDataTab'),
    btnHelp: document.getElementById('btnHelp'),
    btnReset: document.getElementById('btnReset'),
    btnLogout: document.getElementById('btnLogout'),
    toastHost: document.getElementById('toastHost'),
    headerActions: document.getElementById('headerActions'),
    appShell: document.getElementById('appShell'),
    authRoot: document.getElementById('authRoot'),
    businessBar: document.querySelector('.business-bar'),
    tabs: [...document.querySelectorAll('.tab-button')],
    bottomNav: document.getElementById('bottomNav'),
    moreMenu: document.getElementById('moreMenu'),
  };

  let activeTab = 'hoje';
  const todayDate = new Date();
  let dashboardStart = todayDate.getFullYear() + '-' + String(todayDate.getMonth() + 1).padStart(2, '0') + '-01';
  let dashboardEnd = U.today();
  let dashboardSellerId = '';
  let dashboardChannel = '';
  let draggedCard = null;
  let openReturnsSaleId = null;
  let purchaseDraft = [];
  // Vendedor selecionado para o cockpit de pagina inteira (aba Vendedores).
  // null = mostra a lista; setado = mostra o cockpit desse vendedor.
  let cockpitSellerId = null;

  function currentRole() {
    const user = S.getCurrentUser();
    return user ? user.role : 'admin';
  }

  function tabAllowed(tab) {
    const roles = TAB_ROLES[tab];
    return !roles || roles.includes(currentRole());
  }

  function firstAllowedTab() {
    return TAB_ORDER.find(tabAllowed) || 'hoje';
  }

  function syncActiveNav() {
    document.querySelectorAll('.tab-button, .bottom-nav-item[data-tab], .more-menu-item').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === activeTab);
    });
  }

  function openMoreMenu() {
    if (els.moreMenu) els.moreMenu.hidden = false;
  }

  function closeMoreMenu() {
    if (els.moreMenu) els.moreMenu.hidden = true;
  }

  function applyRoleVisibility() {
    const role = currentRole();
    els.tabs.forEach((button) => {
      const allowed = tabAllowed(button.dataset.tab);
      button.hidden = !allowed;
    });
    if (els.businessBar) els.businessBar.hidden = role !== 'admin';
    if (els.bottomNav) {
      els.bottomNav.querySelectorAll('[data-role-set]').forEach((node) => {
        node.hidden = node.dataset.roleSet !== role;
      });
    }
    if (els.moreMenu) {
      els.moreMenu.querySelectorAll('.more-menu-role').forEach((node) => {
        node.hidden = node.dataset.roleSet !== role;
      });
    }
    if (!tabAllowed(activeTab)) {
      activeTab = firstAllowedTab();
    }
    syncActiveNav();
  }

  function state() {
    return S.getState();
  }

  function businessScoped(name) {
    return S.byBusiness(name);
  }

  function currentProducts() { return businessScoped('products'); }
  function currentClients() { return businessScoped('clients'); }
  function currentSuppliers() { return businessScoped('suppliers'); }
  function currentPurchases() { return businessScoped('purchases'); }
  function currentRecipes() { return businessScoped('recipes'); }
  function currentProductions() { return businessScoped('productions'); }
  function currentSales() { return businessScoped('sales'); }
  function currentOrders() { return businessScoped('orders'); }
  function currentConsignments() { return businessScoped('consignments'); }
  function currentFinancialEntries() { return businessScoped('financialEntries'); }
  function currentTasks() { return businessScoped('tasks'); }

  function productById(id) { return state().products.find((product) => product.id === id) || null; }
  function clientById(id) { return state().clients.find((client) => client.id === id) || null; }
  function supplierById(id) { return state().suppliers.find((supplier) => supplier.id === id) || null; }

  function activeBusinessRequiredHtml() {
    return UI.formNotice('Cadastre ou selecione um negócio ativo para usar este módulo.', 'warning');
  }

  function renderAll() {
    renderBusinessSelector();
    renderDashboard();
    renderTab();
  }

  function renderBusinessSelector() {
    const businesses = state().businesses;
    els.activeBusiness.innerHTML = UI.optionList(businesses, state().activeBusinessId, businesses.length ? 'Selecione' : 'Nenhum negócio cadastrado');
    els.activeBusiness.disabled = businesses.length === 0;
  }

  // Filtros de vendedor/canal (sem data): usados pelo gráfico de 7 dias, que
  // tem janela própria (últimos 7 dias) e não deve respeitar o período.
  function saleMatchesSellerChannel(sale) {
    if (dashboardSellerId && String(sale.sellerId) !== String(dashboardSellerId)) return false;
    if (dashboardChannel && (sale.channel || '') !== dashboardChannel) return false;
    return true;
  }

  // Aplica os filtros do dashboard (período + vendedor + canal) a uma venda.
  function saleMatchesDashboardFilters(sale) {
    const date = sale.date || '';
    if (dashboardStart && date < dashboardStart) return false;
    if (dashboardEnd && date > dashboardEnd) return false;
    return saleMatchesSellerChannel(sale);
  }

  function renderDashboard() {
    const baseState = state();
    const periodSales = baseState.sales.filter(saleMatchesDashboardFilters);
    const periodMetrics = Calc.businessMetrics({ ...baseState, sales: periodSales });
    const stockMetrics = Calc.businessMetrics(baseState);
    const sellers = (baseState.sellers || []).filter((seller) => seller.active !== false);
    const channels = (baseState.settings && baseState.settings.channels) || [];
    els.dashboard.innerHTML = `
      <article class="metric-card dashboard-period-card">
        <span>Periodo</span>
        <div class="dashboard-period-fields">
          <input type="date" data-dashboard-date="start" value="${U.escapeHtml(dashboardStart)}" aria-label="Inicio do periodo">
          <input type="date" data-dashboard-date="end" value="${U.escapeHtml(dashboardEnd)}" aria-label="Fim do periodo">
        </div>
      </article>
      ${S.isAdmin() ? `
      <article class="metric-card dashboard-filter-card">
        <span>Filtros</span>
        <select data-dashboard-filter="seller" aria-label="Filtrar por vendedor">
          <option value="">Todos os vendedores</option>
          ${sellers.map((seller) => `<option value="${U.escapeHtml(seller.id)}" ${String(dashboardSellerId) === String(seller.id) ? 'selected' : ''}>${U.escapeHtml(seller.name || 'Vendedor')}</option>`).join('')}
        </select>
        <select data-dashboard-filter="channel" aria-label="Filtrar por canal">
          <option value="">Todos os canais</option>
          ${channels.map((channel) => `<option value="${U.escapeHtml(channel)}" ${dashboardChannel === channel ? 'selected' : ''}>${U.escapeHtml(channel)}</option>`).join('')}
        </select>
      </article>` : ''}
      ${[
        UI.metric('Vendas no periodo', U.money(periodMetrics.netRevenue), 'receitaLiquida'),
        UI.metric('Lucro bruto', U.money(periodMetrics.grossProfit), 'lucroBruto'),
        UI.metric('Valor em estoque', U.money(stockMetrics.stockValue), 'valorEstoque'),
        UI.metric('Alertas de estoque', String(stockMetrics.lowStockCount), 'alertasEstoque'),
        UI.metric('Consignado em aberto', U.money(stockMetrics.consignmentsOpen), 'consignadoAberto'),
        UI.metric('Pedidos pendentes', String(stockMetrics.pendingOrders), 'pedidosPendentes'),
      ].join('')}
      ${S.isAdmin() ? renderOperationsSnapshot(baseState, baseState.sales.filter(saleMatchesSellerChannel)) : ''}
    `;
  }

  function renderOperationsSnapshot(baseState, salesForTrend = baseState.sales) {
    const businessId = baseState.activeBusinessId;
    const products = (baseState.products || []).filter((product) => product.businessId === businessId);
    const productMap = new Map(products.map((product) => [String(product.id), product]));
    const withSellers = (baseState.sellerStock || []).filter((row) => row.businessId === businessId)
      .reduce((sum, row) => sum + U.number(row.quantity) * U.number(productMap.get(String(row.productId))?.avgCost), 0);
    const openOrders = (baseState.orders || []).filter((order) => order.businessId === businessId && !['despachado', 'concluido'].includes(order.status));
    const approvalOrders = openOrders.filter((order) => order.approvalStatus === 'pendente_aprovacao');
    const readyToShip = openOrders.filter((order) => order.approvalStatus === 'aprovado');
    const financialOpen = (baseState.financialEntries || []).filter((entry) => entry.businessId === businessId && entry.status !== 'paid' && entry.status !== 'cancelled');
    const overdueFinancial = financialOpen.filter((entry) => entry.dueDate && entry.dueDate < U.today());
    const overdueFinancialValue = overdueFinancial.reduce((sum, entry) => sum + Math.max(0, U.number(entry.amount) - U.number(entry.paidAmount)), 0);
    const orderTotal = (rows) => rows.reduce((sum, order) => sum + U.number(order.quantity) * U.number(order.unitPrice), 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), amount: 0 };
    });
    const daysByKey = new Map(days.map((day) => [day.key, day]));
    (salesForTrend || []).forEach((sale) => { const day = daysByKey.get(sale.date); if (day) day.amount += U.number(sale.netRevenue); });
    const maxDay = Math.max(...days.map((day) => day.amount), 1);
    return `
      <section class='operations-snapshot' aria-label='Resumo operacional'>
        <div class='operations-snapshot-head'><div><span>Visão operacional</span><h2>O que exige atenção agora</h2></div><button type='button' class='small secondary quick-action' data-tab='vendas'>Abrir esteira</button></div>
        <div class='operations-kpis'>
          <article><span>Com vendedores</span><strong>${U.money(withSellers)}</strong><small>Mercadoria já repassada, pelo custo.</small><button type='button' class='link-button quick-action' data-tab='vendedores'>Ver vendedores</button></article>
          <article><span>A receber</span><strong>${U.money(Calc.businessMetrics(baseState).consignmentsOpen)}</strong><small>Somente itens já vendidos e não pagos.</small><button type='button' class='link-button quick-action' data-tab='consignado'>Ver consignado</button></article>
          <article class='${approvalOrders.length ? 'needs-attention' : ''}'><span>Aprovações</span><strong>${approvalOrders.length}</strong><small>${U.money(orderTotal(approvalOrders))} aguardando decisão.</small><button type='button' class='link-button quick-action' data-tab='vendas'>Revisar pedidos</button></article>
          <article><span>Para despachar</span><strong>${readyToShip.length}</strong><small>${U.money(orderTotal(readyToShip))} aprovado, ainda no estoque central.</small><button type='button' class='link-button quick-action' data-tab='vendas'>Preparar envios</button></article>
          <article class='${overdueFinancial.length ? 'needs-attention' : ''}'><span>Financeiro vencido</span><strong>${U.money(overdueFinancialValue)}</strong><small>${overdueFinancial.length} lançamento(s) exigem atenção.</small><button type='button' class='link-button quick-action' data-tab='financeiro'>Abrir financeiro</button></article>
        </div>
        <div class='sales-trend-card'><div><h3>Vendas dos últimos 7 dias</h3><p>Receita líquida já registrada, por dia.</p></div><div class='sales-bars' role='img' aria-label='Gráfico de vendas dos últimos sete dias'>${days.map((day) => `<div class='sales-bar'><i style='height:${Math.max(4, Math.round((day.amount / maxDay) * 100))}%'></i><span>${U.escapeHtml(day.label)}</span></div>`).join('')}</div></div>
      </section>`;
  }

  // Tela "Hoje" — abertura padrão da navegação mobile (ver
  // docs/replication-v1/02-fase1-navegacao-mobile.md). Reaproveita o mesmo
  // Calc.businessMetrics do dashboard, filtrado só no dia de hoje, mais
  // ações rápidas e listas curtas para não exigir rolar as abas completas.
  function renderToday() {
    const isAdminUser = S.isAdmin();
    const todayStr = U.today();
    const sales = currentSales();
    const todaySales = sales.filter((sale) => sale.date === todayStr);
    const todayMetrics = Calc.businessMetrics({ ...state(), sales: todaySales });
    const stockMetrics = Calc.businessMetrics(state());

    const quickActions = isAdminUser
      ? [
          { tab: 'vendas', label: 'Nova venda / esteira' },
          { tab: 'clientes', label: 'Novo cliente' },
          { tab: 'produtos', label: 'Estoque' },
          { tab: 'vendedores', label: 'Vendedores' },
        ]
      : [
          { tab: 'vendas', label: 'Vender / pedir' },
          { tab: 'clientes', label: 'Novo cliente' },
          { tab: 'estoque', label: 'Meu estoque' },
          { tab: 'meusaldo', label: 'Meu saldo' },
        ];

    const recentSales = U.sortByDateDesc(sales).slice(0, 5);
    const recentSalesHtml = recentSales.length
      ? `<ul class="today-list">${recentSales.map((sale) => {
          const product = productById(sale.productId);
          const client = clientById(sale.clientId);
          const label = `${U.escapeHtml(product ? product.name : 'Produto removido')}${client ? ' · ' + U.escapeHtml(client.name) : ''}`;
          return `<li><span>${label}</span><strong>${U.money(sale.netRevenue)}</strong></li>`;
        }).join('')}</ul>`
      : UI.formNotice('Nenhuma venda registrada ainda.', '');

    const lowStockProducts = currentProducts()
      .filter((product) => U.number(product.minStock) > 0 && U.number(product.currentStock) <= U.number(product.minStock))
      .slice(0, 5);
    const lowStockHtml = lowStockProducts.length
      ? `<ul class="today-list">${lowStockProducts.map((product) => `<li><span>${U.escapeHtml(product.name)}</span>${UI.stockCell(product)}</li>`).join('')}</ul>`
      : UI.formNotice('Nenhum produto abaixo do estoque mínimo.', 'success');

    return `
      <div class="today-screen">
        <div class="dashboard">
          ${[
            UI.metric(isAdminUser ? 'Vendas hoje' : 'Minhas vendas hoje', U.money(todayMetrics.netRevenue), 'receitaLiquida'),
            UI.metric('Lucro bruto hoje', U.money(todayMetrics.grossProfit), 'lucroBruto'),
            isAdminUser
              ? UI.metric('Valor em estoque', U.money(stockMetrics.stockValue), 'valorEstoque')
              : UI.metric('Consignado em aberto', U.money(stockMetrics.consignmentsOpen), 'consignadoAberto'),
            UI.metric('Pedidos pendentes', String(stockMetrics.pendingOrders), 'pedidosPendentes'),
          ].join('')}
        </div>

        <section class="today-section">
          <h3>Ações rápidas</h3>
          <div class="quick-actions">
            ${quickActions.map((action) => `<button type="button" class="quick-action" data-tab="${U.escapeHtml(action.tab)}">${U.escapeHtml(action.label)}</button>`).join('')}
          </div>
        </section>

        ${isAdminUser ? renderOperationsSnapshot(state()) : ''}

        <section class="today-section">
          <h3>Últimas vendas</h3>
          ${recentSalesHtml}
        </section>

        <section class="today-section">
          <h3>${isAdminUser ? 'Estoque crítico' : 'Meu estoque baixo'}</h3>
          ${lowStockHtml}
        </section>
      </div>
    `;
  }

  function setTab(tab) {
    // Sair da aba Vendedores fecha o cockpit: voltar depois mostra a lista.
    if (tab !== 'vendedores') cockpitSellerId = null;
    activeTab = tab;
    syncActiveNav();
    closeMoreMenu();
    renderTab();
  }

  // Abre o cockpit de pagina inteira de um vendedor (chamado pelo botao
  // "Abrir painel" de cada card em src/auth.js).
  function openSellerCockpit(sellerId) {
    cockpitSellerId = sellerId;
    if (activeTab !== 'vendedores') {
      setTab('vendedores');
      cockpitSellerId = sellerId; // setTab limpa ao trocar de aba; re-seta aqui
    }
    renderTab();
  }

  function handleQuickAction(event) {
    const trigger = event.target.closest('.quick-action[data-tab]');
    if (!trigger) return;
    setTab(trigger.dataset.tab);
  }

  // Abas "clássicas": a função devolve uma string HTML, que é jogada em
  // els.view.innerHTML e usa o delegador global de cliques/submits (handleClick/
  // handleSubmit) definido mais abaixo neste arquivo.
  const LEGACY_RENDERERS = {
    hoje: renderToday,
    negocios: renderBusinesses,
    produtos: renderProducts,
    clientes: renderClients,
    fornecedores: renderSuppliers,
    compras: renderPurchases,
    fichas: renderRecipes,
    producao: renderProduction,
    vendas: renderSales,
    consignado: renderConsignments,
    financeiro: renderFinancial,
    tarefas: renderTasks,
    relatorios: renderReports,
    dados: renderData,
  };

  // Abas "modulares": vêm de src/auth.js, src/pricing.js, src/sellerStock.js,
  // src/calculator.js, src/goals.js, src/sellerHelp.js — cada uma gerencia seu
  // próprio HTML e listeners escopados a um container (padrão mount/refresh),
  // em vez de usar o delegador global. Não presumimos qual módulo carregou
  // primeiro: acessamos window.C360.<modulo> no momento do mount.
  function renderTab() {
    if (!tabAllowed(activeTab)) {
      activeTab = firstAllowedTab();
      syncActiveNav();
    }
    const legacy = LEGACY_RENDERERS[activeTab];
    if (legacy) {
      els.view.innerHTML = legacy();
      if (activeTab === 'vendas') mountSalesExtras();
      return;
    }
    mountModuleTab(activeTab);
  }

  function mountModuleTab(tab) {
    const isAdminUser = S.isAdmin();
    switch (tab) {
      case 'vendedores':
        // Aba unica do admin para tudo sobre vendedores. Com um vendedor
        // selecionado (C360.app.openSellerCockpit), abre o cockpit de pagina
        // inteira (src/sellerCockpit.js) com vendas/estoque/saldo/pedidos dele
        // num so lugar. Sem selecao, mostra a lista + permissoes + concessao
        // direta de estoque.
        if (cockpitSellerId && window.C360.sellerCockpit && typeof window.C360.sellerCockpit.mount === 'function') {
          els.view.innerHTML = '<div id="sellerCockpitPanel"></div>';
          window.C360.sellerCockpit.mount(document.getElementById('sellerCockpitPanel'), cockpitSellerId, {
            onBack: () => { cockpitSellerId = null; renderTab(); },
          });
          break;
        }
        els.view.innerHTML = '<div id="sellersPanel"></div><div id="sellerPermissionsPanel"></div><div id="grantStockPanel"></div>';
        if (window.C360.auth && typeof window.C360.auth.mountSellers === 'function') {
          window.C360.auth.mountSellers(document.getElementById('sellersPanel'));
        }
        if (window.C360.salesCart && typeof window.C360.salesCart.mountSettings === 'function') {
          window.C360.salesCart.mountSettings(document.getElementById('sellerPermissionsPanel'), { onDone: renderAll });
        }
        if (window.C360.sellerStock && typeof window.C360.sellerStock.mountGrantStock === 'function') {
          window.C360.sellerStock.mountGrantStock(document.getElementById('grantStockPanel'));
        }
        break;
      case 'precos':
        els.view.innerHTML = '<div id="pricingPanel"></div>';
        if (window.C360.pricing && typeof window.C360.pricing.mountAdmin === 'function') {
          window.C360.pricing.mountAdmin(document.getElementById('pricingPanel'));
        }
        break;
      case 'meusaldo':
        els.view.innerHTML = '<div id="sellerLedgerPanel"></div>';
        if (window.C360.sellerLedger && typeof window.C360.sellerLedger.mountSeller === 'function') {
          window.C360.sellerLedger.mountSeller(document.getElementById('sellerLedgerPanel'));
        }
        break;
      case 'devolucoes':
        els.view.innerHTML = '<div id="operationalMovementsAdminPanel"></div>';
        if (window.C360.operationalMovements && typeof window.C360.operationalMovements.mountAdmin === 'function') {
          window.C360.operationalMovements.mountAdmin(document.getElementById('operationalMovementsAdminPanel'), { onDone: renderAll });
        }
        break;
      case 'minhasdevolucoes':
        els.view.innerHTML = '<div id="operationalMovementsPanel"></div>';
        if (window.C360.operationalMovements && typeof window.C360.operationalMovements.mountSeller === 'function') {
          window.C360.operationalMovements.mountSeller(document.getElementById('operationalMovementsPanel'));
        }
        break;
      case 'estoque':
        els.view.innerHTML = '<div id="myStockPanel"></div>';
        if (window.C360.sellerStock && typeof window.C360.sellerStock.mountMyStock === 'function') {
          window.C360.sellerStock.mountMyStock(document.getElementById('myStockPanel'));
        }
        break;
      case 'calculadora':
        if (window.C360.calculator) {
          els.view.innerHTML = window.C360.calculator.render();
          window.C360.calculator.mount(els.view);
        } else {
          els.view.innerHTML = UI.formNotice('Calculadora indisponível.', 'warning');
        }
        break;
      case 'metas':
        els.view.innerHTML = '<div id="goalsPanel"></div>';
        if (window.C360.goals) {
          const panel = document.getElementById('goalsPanel');
          if (isAdminUser && typeof window.C360.goals.mountAdmin === 'function') {
            window.C360.goals.mountAdmin(panel);
          } else if (!isAdminUser && typeof window.C360.goals.mountSeller === 'function') {
            window.C360.goals.mountSeller(panel);
          }
        }
        break;
      case 'ajuda':
        els.view.innerHTML = '';
        if (window.C360.sellerHelp && typeof window.C360.sellerHelp.mount === 'function') {
          window.C360.sellerHelp.mount(els.view);
        }
        break;
      default:
        els.view.innerHTML = renderBusinesses();
    }
  }

  // Painel de devolução/desperdício (src/returns.js) para a venda cujo id está
  // em `openReturnsSaleId`, aberto/fechado pelo botão "Devolução/Desperdício"
  // na tabela de vendas (ver handleClick, case 'toggle-returns').
  function mountSalesExtras() {
    mountSalesCartPanel('salesCartPanel');
    const container = document.getElementById('returnsPanel');
    if (!container) return;
    if (!openReturnsSaleId) {
      container.innerHTML = '';
      return;
    }
    const sale = state().sales.find((item) => item.id === openReturnsSaleId);
    if (!sale) {
      container.innerHTML = '';
      return;
    }
    if (window.C360.returns && typeof window.C360.returns.mount === 'function') {
      window.C360.returns.mount(container, sale, {
        onDone: () => {
          openReturnsSaleId = null;
          renderAll();
          toast('Registro salvo.', 'success');
        },
        onClose: () => {
          openReturnsSaleId = null;
          renderAll();
        },
      });
    }
  }

  function mountSalesCartPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (window.C360.salesCart && typeof window.C360.salesCart.mount === 'function') {
      window.C360.salesCart.mount(container, { onDone: renderAll });
    }
  }

  // Cada conta admin já vem vinculada a exatamente um negócio (provisionado
  // manualmente no backend — ver docs/backend.md, seção "Gaps"). Não existe
  // policy de INSERT/DELETE para `businesses`, só UPDATE do próprio negócio;
  // esta tela edita os dados do negócio já vinculado, não cria nem exclui.
  function renderBusinesses() {
    const business = S.activeBusiness();
    if (!business) {
      return UI.formNotice('Sua conta ainda não está vinculada a um negócio. Fale com o administrador do sistema.', 'warning');
    }
    return UI.section('Negócios', 'Dados do seu negócio. Cada conta já vem vinculada a um único negócio — não é possível criar outro por aqui.', `
      <form id="businessForm" class="grid-form">
        <label>Nome do negócio
          <input name="name" required value="${U.escapeHtml(business.name)}" placeholder="Ex.: Essências / Marmitas / Revenda">
        </label>
        <label>Segmento
          <select name="segment">${UI.optionList(state().settings.businessSegments, business.segment || '', 'Escolha')}</select>
        </label>
        <label>${UI.fieldLabel('Margem desejada padrão (%)', 'margemDesejada')}
          <input name="defaultTargetMargin" type="number" step="0.01" value="${U.escapeHtml(business.defaultTargetMargin ?? 50)}">
        </label>
        <label>${UI.fieldLabel('Taxas padrão de venda (%)', 'taxasPadrao')}
          <input name="defaultFeePercent" type="number" step="0.01" value="${U.escapeHtml(business.defaultFeePercent ?? 0)}">
        </label>
        <label class="wide">Observações
          <textarea name="notes" placeholder="Regras próprias, fornecedores, particularidades...">${U.escapeHtml(business.notes || '')}</textarea>
        </label>
        <button type="submit">Salvar negócio</button>
      </form>
    `);
  }

  function renderProducts() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const products = currentProducts();
    const rows = products.map((product) => {
      const cost = product.type === 'produto_final' || product.type === 'kit' ? Calc.calculateRecipeCost(product.id, state()) : null;
      return [
        UI.productName(product),
        UI.badge(labelForProductType(product.type)),
        U.escapeHtml(product.unit),
        UI.stockCell(product),
        UI.moneyCell(product.avgCost),
        cost ? UI.moneyCell(cost.totalCostPerUnit) : '—',
        UI.moneyCell(product.salePrice),
        `${U.number(product.targetMarginPercent)}%`,
        `<div class="actions">
          ${UI.actionButton('edit-product', product.id, 'Editar')}
          ${product.type !== 'servico' ? UI.actionButton('adjust-stock', product.id, 'Ajustar estoque') : ''}
          ${UI.actionButton('delete-product', product.id, 'Excluir', 'danger')}
        </div>`,
      ];
    });

    return UI.section('Produtos, insumos e embalagens', 'Cadastre matéria-prima, vidro, rótulo, caixa, produto final, kit, mercadoria ou serviço. Não há dados modelo preenchidos.', `
      <form id="productForm" class="grid-form">
        <label>Nome
          <input name="name" required placeholder="Ex.: Vidro âmbar 100 ml / Rótulo / Essência pronta">
        </label>
        <label>${UI.fieldLabel('Tipo', 'tipoProduto')}
          <select name="type" required>${UI.optionList(state().settings.productTypes, '', 'Tipo')}</select>
        </label>
        <label>Unidade
          <select name="unit" required>${UI.optionList(state().settings.units, 'un', '')}</select>
        </label>
        <label>${UI.fieldLabel('Estoque inicial', 'estoqueInicial')}
          <input name="currentStock" type="number" step="0.001" value="0">
        </label>
        <label>${UI.fieldLabel('Custo médio inicial', 'custoMedioInicial')}
          <input name="avgCost" type="number" step="0.0001" value="0">
        </label>
        <label>${UI.fieldLabel('Preço de venda manual', 'precoVendaManual')}
          <input name="salePrice" type="number" step="0.01" value="0">
          <span>Opcional. Se deixar 0, use o preço sugerido no módulo Fichas e custos.</span>
        </label>
        <label>${UI.fieldLabel('Estoque mínimo', 'estoqueMinimo')}
          <input name="minStock" type="number" step="0.001" value="0">
        </label>
        <label>${UI.fieldLabel('Mão de obra por unidade', 'maoDeObra')}
          <input name="laborCostPerUnit" type="number" step="0.01" value="0">
        </label>
        <label>${UI.fieldLabel('Custo fixo rateado por unidade', 'custoFixo')}
          <input name="overheadCostPerUnit" type="number" step="0.01" value="0">
        </label>
        <label>${UI.fieldLabel('Perda técnica (%)', 'perdaTecnica')}
          <input name="lossPercent" type="number" step="0.01" value="0">
        </label>
        <label>${UI.fieldLabel('Margem desejada (%)', 'margemDesejadaProduto')}
          <input name="targetMarginPercent" type="number" step="0.01" value="">
          <span>Se vazio, usa a margem padrão do negócio.</span>
        </label>
        <label>${UI.fieldLabel('Taxas sobre venda (%)', 'taxasProduto')}
          <input name="taxFeePercent" type="number" step="0.01" value="">
          <span>Marketplace, cartão ou taxa estimada.</span>
        </label>
        <label class="full">Observações
          <textarea name="notes" placeholder="Lote, fornecedor preferencial, uso na produção..."></textarea>
        </label>
        <button type="submit">Cadastrar produto</button>
      </form>
      ${UI.table(['Produto', 'Tipo', 'Un.', 'Estoque', 'Custo médio', 'Custo ficha', 'Preço manual', 'Margem', 'Ações'], rows)}
    `);
  }

  function labelForProductType(type) {
    return state().settings.productTypes.find((item) => item.value === type)?.label || type;
  }

  function renderClients() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const rows = currentClients().map((client) => [
      U.escapeHtml(client.name),
      U.escapeHtml(client.phone || '—'),
      UI.badge(client.type || 'cliente'),
      U.escapeHtml(client.notes || '—'),
      `<div class="actions">${UI.actionButton('client-history', client.id, 'Abrir')}${UI.actionButton('edit-client', client.id, 'Editar')}${UI.actionButton('delete-client', client.id, 'Excluir', 'danger')}</div>`,
    ]);
    return UI.section('Clientes', 'Cadastro usado em vendas, pedidos e consignados.', `
      <form id="clientForm" class="grid-form">
        <label>Nome
          <input name="name" required placeholder="Nome do cliente">
        </label>
        <label>Telefone / WhatsApp
          <input name="phone" placeholder="Opcional">
        </label>
        <label>Tipo
          <select name="type">
            <option value="cliente">Cliente</option>
            <option value="consignado">Consignado</option>
            <option value="ambos">Ambos</option>
          </select>
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Endereço, regra de pagamento, etc.">
        </label>
        <button type="submit">Cadastrar cliente</button>
      </form>
      ${UI.table(['Nome', 'Telefone', 'Tipo', 'Observações', 'Ações'], rows)}
    `);
  }

  function renderSuppliers() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const rows = currentSuppliers().map((supplier) => [
      U.escapeHtml(supplier.name),
      U.escapeHtml(supplier.phone || '—'),
      U.escapeHtml(supplier.notes || '—'),
      `<div class="actions">${UI.actionButton('delete-supplier', supplier.id, 'Excluir', 'danger')}</div>`,
    ]);
    return UI.section('Fornecedores', 'Fornecedores alimentam as compras e ajudam a rastrear custo de matéria-prima e embalagem.', `
      <form id="supplierForm" class="grid-form">
        <label>Nome
          <input name="name" required placeholder="Fornecedor">
        </label>
        <label>Telefone / contato
          <input name="phone" placeholder="Opcional">
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Prazo, desconto, pedido mínimo...">
        </label>
        <button type="submit">Cadastrar fornecedor</button>
      </form>
      ${UI.table(['Nome', 'Contato', 'Observações', 'Ações'], rows)}
    `);
  }

  function renderPurchases() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const products = currentProducts().filter((product) => product.type !== 'servico');
    const suppliers = currentSuppliers();
    const groups = new Map();
    U.sortByDateDesc(currentPurchases()).forEach((purchase) => {
      const groupId = purchase.purchaseGroupId || purchase.id;
      if (!groups.has(groupId)) groups.set(groupId, { ...purchase, items: [], total: 0, paid: 0 });
      const group = groups.get(groupId);
      group.items.push(purchase);
      group.total += U.number(purchase.totalCost);
      group.paid += U.number(purchase.paidAmount);
    });
    const rows = [...groups.values()].map((group) => {
      const supplier = supplierById(group.supplierId);
      const itemNames = group.items.map((item) => productById(item.productId)?.name || 'Produto removido').join(', ');
      return [
        U.escapeHtml(group.date),
        U.escapeHtml(group.dueDate || group.date),
        U.escapeHtml(supplier?.name || '—'),
        U.escapeHtml(itemNames),
        String(group.items.length),
        UI.moneyCell(group.total),
        UI.moneyCell(group.paid),
        UI.badge(group.paid >= group.total ? 'Pago' : group.paid > 0 ? 'Parcial' : 'Em aberto'),
        U.escapeHtml(group.notes || '—'),
      ];
    });
    const draftRows = purchaseDraft.map((item) => {
      const product = productById(item.productId);
      return [
        UI.productName(product),
        U.qty(item.quantity, product?.unit),
        UI.moneyCell(item.totalCost),
        UI.moneyCell(U.number(item.totalCost) / U.number(item.quantity)),
        UI.actionButton('remove-purchase-draft', item.productId, 'Remover', 'danger'),
      ];
    });
    const draftTotal = purchaseDraft.reduce((sum, item) => sum + U.number(item.totalCost), 0);

    return UI.section('Compras', 'Monte uma compra com vários itens. Estoque, custo médio, movimentações e conta a pagar são atualizados juntos.', `
      <div class="two-columns purchase-builder">
        <section class="panel-card">
          <h3>1. Adicionar produtos</h3>
          <form id="purchaseItemForm" class="stack-form">
            <label>Produto<select name="productId" required>${UI.optionList(products, '', 'Produto')}</select></label>
            <label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" required></label>
            <label>Valor total do item<input name="totalCost" type="number" min="0.01" step="0.01" required></label>
            <button type="submit">Adicionar à compra</button>
          </form>
        </section>
        <section class="panel-card purchase-draft-summary">
          <div class="purchase-draft-head"><div><span>Compra atual</span><strong>${U.money(draftTotal)}</strong></div><small>${purchaseDraft.length} item(ns)</small></div>
          ${UI.table(['Produto', 'Qtd.', 'Total', 'Custo unit.', 'Ação'], draftRows, 'Adicione produtos à compra.')}
        </section>
      </div>
      <details class="panel-card purchase-finalize" ${purchaseDraft.length ? 'open' : ''}>
        <summary>2. Fornecedor e pagamento</summary>
        <form id="purchaseGroupForm" class="grid-form">
          <label>Data<input name="date" type="date" required value="${U.today()}"></label>
          <label>Vencimento<input name="dueDate" type="date" value="${U.today()}"></label>
          <label>Fornecedor<select name="supplierId">${UI.optionList(suppliers, '', 'Opcional')}</select></label>
          <label>Pagamento<select name="paymentMode"><option value="a_prazo">A prazo</option><option value="a_vista">À vista</option><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="outro">Outro</option></select></label>
          <label>Valor já pago<input name="paidAmount" type="number" min="0" max="${draftTotal}" step="0.01" value="0"></label>
          <label class="wide">Observações<input name="notes" placeholder="Nota, lote, parcela, responsável..."></label>
          <button type="submit" ${purchaseDraft.length ? '' : 'disabled'}>Finalizar compra de ${U.money(draftTotal)}</button>
        </form>
      </details>
      <h3>Histórico de compras</h3>
      ${UI.table(['Data', 'Vencimento', 'Fornecedor', 'Produtos', 'Itens', 'Total', 'Pago', 'Situação', 'Obs.'], rows, 'Nenhuma compra registrada.')}
    `);
  }

  function renderRecipes() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const finalProducts = currentProducts().filter((product) => ['produto_final', 'kit'].includes(product.type));
    const inputProducts = currentProducts().filter((product) => product.type !== 'servico' && !['produto_final', 'kit'].includes(product.type));
    const selectedFinalId = finalProducts[0]?.id || '';
    const selectedCost = selectedFinalId ? Calc.calculateRecipeCost(selectedFinalId, state()) : null;
    const recipeRows = currentRecipes().map((row) => {
      const finalProduct = productById(row.finalProductId);
      const input = productById(row.inputProductId);
      return [
        U.escapeHtml(finalProduct?.name || 'Produto final removido'),
        UI.productName(input),
        U.qty(row.quantityPerUnit, input?.unit),
        UI.moneyCell(U.number(row.quantityPerUnit) * U.number(input?.avgCost)),
        `<div class="actions">${UI.actionButton('delete-recipe', row.id, 'Excluir', 'danger')}</div>`,
      ];
    });

    return UI.section('Fichas técnicas e cálculo de custo', 'Monte a composição do produto: matéria-prima, vidro, rótulo, caixa, embalagem e custos rateados. O sistema calcula custo e preço sugerido.', `
      <div class="two-columns">
        <div class="panel-card">
          <h3>Adicionar item à ficha ${UI.help('fichaTecnica')}</h3>
          <form id="recipeForm" class="stack-form">
            <label>Produto final / kit
              <select name="finalProductId" required>${UI.optionList(finalProducts, '', 'Produto final')}</select>
            </label>
            <label>Matéria-prima ou embalagem
              <select name="inputProductId" required>${UI.optionList(inputProducts, '', 'Insumo/embalagem')}</select>
            </label>
            <label>${UI.fieldLabel('Quantidade usada por unidade final', 'qtdPorUnidade')}
              <input name="quantityPerUnit" type="number" step="0.0001" required placeholder="Ex.: 100 ml, 1 un, 0.05 kg">
            </label>
            <button type="submit">Adicionar à ficha</button>
          </form>
          <div class="notice">Para essência aromática, cadastre cada item separadamente: base/fragrância, vidro, válvula/tampa, rótulo, caixa e lacre. Depois vincule tudo aqui.</div>
        </div>
        <div class="panel-card">
          <h3>Simulador rápido</h3>
          <form id="costPreviewForm" class="stack-form">
            <label>Produto para calcular
              <select name="finalProductId">${UI.optionList(finalProducts, selectedFinalId, 'Produto final')}</select>
            </label>
            <button type="submit">Calcular</button>
          </form>
          <div id="costPreview">${selectedCost ? renderCostPreview(selectedCost) : UI.formNotice('Cadastre um produto final/kit e sua ficha técnica para calcular.', 'warning')}</div>
        </div>
      </div>
      <h3>Itens cadastrados nas fichas</h3>
      ${UI.table(['Produto final', 'Insumo/embalagem', 'Qtd. por unidade', 'Custo na ficha', 'Ações'], recipeRows)}
    `);
  }

  function renderCostPreview(cost) {
    if (!cost.finalProduct) return UI.formNotice('Produto não encontrado.', 'danger');
    const rows = cost.items.map((item) => [
      UI.productName(item.input),
      U.qty(item.quantityPerUnit, item.input?.unit),
      UI.moneyCell(item.avgCost),
      UI.moneyCell(item.costPerUnit),
    ]);
    return `
      ${UI.costBox(cost)}
      <div class="notice">
        Produto: <strong>${U.escapeHtml(cost.finalProduct.name)}</strong><br>
        Margem desejada: <strong>${(cost.targetMarginPercent * 100).toFixed(2)}%</strong> · Taxas: <strong>${(cost.taxFeePercent * 100).toFixed(2)}%</strong><br>
        Lucro bruto estimado no preço escolhido: <strong>${U.money(cost.grossProfitAtSelectedPrice)}</strong> · Margem real: <strong>${(cost.marginAtSelectedPrice * 100).toFixed(2)}%</strong>
      </div>
      ${UI.table(['Item', 'Qtd.', 'Custo médio', 'Custo por unidade final'], rows, 'Nenhum item na ficha ainda.')}
    `;
  }

  function renderProduction() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const finalProducts = currentProducts().filter((product) => ['produto_final', 'kit'].includes(product.type));
    const rows = U.sortByDateDesc(currentProductions()).map((prod) => {
      const product = productById(prod.finalProductId);
      return [
        U.escapeHtml(prod.date),
        UI.productName(product),
        U.qty(prod.quantity, product?.unit),
        UI.moneyCell(prod.totalCost),
        UI.moneyCell(prod.unitCost),
        U.escapeHtml(prod.notes || '—'),
      ];
    });
    return UI.section('Produção', 'Produção consome a ficha técnica, baixa insumos/embalagens e dá entrada no produto final com custo calculado.', `
      <form id="productionForm" class="grid-form">
        <label>Data
          <input name="date" type="date" required value="${U.today()}">
        </label>
        <label>Produto final / kit
          <select name="finalProductId" required>${UI.optionList(finalProducts, '', 'Produto final')}</select>
        </label>
        <label>${UI.fieldLabel('Quantidade produzida', 'qtdProduzida')}
          <input name="quantity" type="number" step="0.001" required>
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Lote, produção, perdas reais...">
        </label>
        <button type="submit">Lançar produção</button>
      </form>
      ${UI.table(['Data', 'Produto', 'Qtd.', 'Custo total', 'Custo unitário', 'Obs.'], rows)}
    `);
  }

  function renderSales() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const rows = U.sortByDateDesc(currentSales()).map((sale) => {
      const product = productById(sale.productId);
      const client = clientById(sale.clientId);
      const isReturnOrScrap = sale.quantity < 0 || !!sale.parentSaleId;
      return [
        U.escapeHtml(sale.date),
        U.escapeHtml(sale.channel || '—'),
        U.escapeHtml(client?.name || '—'),
        UI.productName(product),
        U.qty(sale.quantity, product?.unit),
        UI.moneyCell(sale.netRevenue),
        UI.moneyCell(sale.cogs),
        UI.moneyCell(sale.grossProfit),
        `${(U.number(sale.margin) * 100).toFixed(2)}%`,
        isReturnOrScrap ? '—' : `<div class="actions">${UI.actionButton('toggle-returns', sale.id, openReturnsSaleId === sale.id ? 'Fechar' : 'Devolução/Desperdício')}</div>`,
      ];
    });
    const desc = S.isAdmin()
      ? 'Escolha o tipo de venda, monte o carrinho e lance. O pedido entra na esteira em Pendente e você avança até Despachado (quando o estoque baixa e a venda conta).'
      : 'Venda o que já está no seu estoque (baixa na hora) ou peça reposição ao admin. Acompanhe seus pedidos na esteira abaixo.';
    return UI.section('Vendas', desc, `
      <div id="salesCartPanel"></div>
      <h3>Histórico de vendas</h3>
      ${UI.table(['Data', 'Canal', 'Cliente', 'Produto', 'Qtd.', 'Receita líquida', 'CMV', 'Lucro', 'Margem', 'Ações'], rows)}
      <div id="returnsPanel"></div>
    `, 'cmv');
  }

  function renderConsignments() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const products = currentProducts().filter((product) => product.type !== 'servico');
    const rows = currentConsignments().map((item) => {
      const product = productById(item.productId);
      const client = clientById(item.clientId);
      const available = Calc.consignmentAvailableWithClient(item);
      const openAmount = Calc.consignmentOpenAmount(item);
      return [
        U.escapeHtml(item.date),
        U.escapeHtml(client?.name || 'Cliente removido'),
        UI.productName(product),
        U.qty(item.quantitySent, product?.unit),
        U.qty(item.quantitySold, product?.unit),
        U.qty(item.quantityReturned, product?.unit),
        U.qty(available, product?.unit),
        UI.moneyCell(openAmount),
        `<div class="actions">
          ${UI.actionButton('consign-sell', item.id, 'Registrar venda')}
          ${UI.actionButton('consign-return', item.id, 'Devolver')}
          ${UI.actionButton('consign-pay', item.id, 'Registrar pagamento')}
          ${UI.actionButton('delete-consignment', item.id, 'Excluir', 'danger')}
        </div>`,
      ];
    });

    return UI.section('Consignado', 'Envio consignado transfere estoque para o cliente. Venda, devolução e pagamento fazem o acerto sem perder rastreio.', `
      <form id="consignmentForm" class="grid-form">
        <label>Data
          <input name="date" type="date" required value="${U.today()}">
        </label>
        <label>Cliente consignado
          <select name="clientId" required>${UI.optionList(currentClients(), '', 'Cliente')}</select>
        </label>
        <label>Produto
          <select name="productId" required>${UI.optionList(products, '', 'Produto')}</select>
        </label>
        <label>${UI.fieldLabel('Quantidade enviada', 'qtdEnviada')}
          <input name="quantitySent" type="number" step="0.001" required>
        </label>
        <label>${UI.fieldLabel('Preço unitário combinado', 'precoCombinadoConsig')}
          <input name="unitPrice" type="number" step="0.01" required>
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Prazo de acerto, caixa, lote, combinado...">
        </label>
        <button type="submit">Enviar consignado</button>
      </form>
      ${UI.table(['Data', 'Cliente', 'Produto', 'Enviado', 'Vendido', 'Devolvido', 'Com cliente', 'Em aberto', 'Ações'], rows)}
    `, 'consignado');
  }

  function financialDisplayStatus(entry) {
    if (entry.status === 'cancelled') return 'Cancelado';
    if (entry.status === 'paid') return 'Pago';
    if (entry.dueDate && entry.dueDate < U.today()) return 'Vencido';
    if (entry.status === 'partial') return 'Parcial';
    return 'Em aberto';
  }

  function financialCounterparty(entry) {
    if (entry.clientId) return clientById(entry.clientId)?.name || 'Cliente removido';
    if (entry.supplierId) return supplierById(entry.supplierId)?.name || 'Fornecedor removido';
    if (entry.sellerId) return sellerName(entry.sellerId);
    return '—';
  }

  function renderFinancial() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const entries = currentFinancialEntries();
    const active = entries.filter((entry) => entry.status !== 'cancelled');
    const remaining = (entry) => Math.max(0, U.number(entry.amount) - U.number(entry.paidAmount));
    const receivable = active.filter((entry) => entry.direction === 'receivable').reduce((sum, entry) => sum + remaining(entry), 0);
    const payable = active.filter((entry) => entry.direction === 'payable').reduce((sum, entry) => sum + remaining(entry), 0);
    const overdue = active.filter((entry) => entry.status !== 'paid' && entry.dueDate && entry.dueDate < U.today()).reduce((sum, entry) => sum + remaining(entry), 0);
    const cashResult = active.reduce((sum, entry) => sum + (entry.direction === 'receivable' ? 1 : -1) * U.number(entry.paidAmount), 0);
    const rows = [...entries].sort((a, b) => String(a.dueDate || a.issueDate).localeCompare(String(b.dueDate || b.issueDate))).map((entry) => {
      const canCancel = entry.status !== 'cancelled' && U.number(entry.paidAmount) === 0;
      return [
        U.escapeHtml(entry.dueDate || entry.issueDate),
        UI.badge(entry.direction === 'receivable' ? 'Receber' : 'Pagar'),
        U.escapeHtml(entry.description),
        U.escapeHtml(financialCounterparty(entry)),
        UI.moneyCell(entry.amount),
        UI.moneyCell(entry.paidAmount),
        UI.moneyCell(remaining(entry)),
        UI.badge(financialDisplayStatus(entry)),
        '<div class="actions">' +
          (entry.status !== 'paid' && entry.status !== 'cancelled' ? UI.actionButton('financial-pay', entry.id, entry.direction === 'receivable' ? 'Receber' : 'Pagar') : '') +
          (canCancel ? UI.actionButton('financial-cancel', entry.id, 'Cancelar', 'danger') : '') +
          (entry.status === 'cancelled' ? UI.actionButton('financial-restore', entry.id, 'Reabrir') : '') +
        '</div>',
      ];
    });

    return UI.section('Financeiro', 'Contas a pagar e receber conectadas à operação. Compras novas geram uma conta automaticamente.', `
      <div class="metric-grid finance-metrics">
        <article><span>A receber</span><strong>${U.money(receivable)}</strong><small>Saldo ainda não recebido.</small></article>
        <article><span>A pagar</span><strong>${U.money(payable)}</strong><small>Saldo ainda não pago.</small></article>
        <article class="${overdue > 0 ? 'needs-attention' : ''}"><span>Vencido</span><strong>${U.money(overdue)}</strong><small>Exige cobrança ou pagamento.</small></article>
        <article><span>Caixa realizado</span><strong>${U.money(cashResult)}</strong><small>Recebido menos pago.</small></article>
      </div>
      <details class="panel-card finance-entry-create">
        <summary>Novo lançamento manual</summary>
        <form id="financialEntryForm" class="grid-form">
          <label>Tipo<select name="direction"><option value="receivable">Conta a receber</option><option value="payable">Conta a pagar</option></select></label>
          <label>Categoria<select name="category"><option value="sale">Venda</option><option value="purchase">Compra</option><option value="consignment">Consignado</option><option value="commission">Comissão</option><option value="operational">Operacional</option><option value="other">Outro</option></select></label>
          <label class="wide">Descrição<input name="description" required placeholder="Ex.: aluguel, venda balcão, material de embalagem"></label>
          <label>Emissão<input name="issueDate" type="date" required value="${U.today()}"></label>
          <label>Vencimento<input name="dueDate" type="date" value="${U.today()}"></label>
          <label>Valor<input name="amount" type="number" min="0.01" step="0.01" required></label>
          <label>Valor já pago<input name="paidAmount" type="number" min="0" step="0.01" value="0"></label>
          <label>Cliente<select name="clientId">${UI.optionList(currentClients(), '', 'Opcional')}</select></label>
          <label>Fornecedor<select name="supplierId">${UI.optionList(currentSuppliers(), '', 'Opcional')}</select></label>
          <label>Forma de pagamento<input name="paymentMethod" placeholder="Pix, dinheiro, cartão..."></label>
          <label class="wide">Observações<input name="notes" placeholder="Referência, parcela, responsável..."></label>
          <button type="submit">Salvar lançamento</button>
        </form>
      </details>
      ${UI.table(['Vencimento', 'Tipo', 'Descrição', 'Pessoa', 'Valor', 'Pago', 'Saldo', 'Situação', 'Ações'], rows, 'Nenhum lançamento financeiro.')}
    `);
  }

  function renderTasks() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const statuses = state().settings.taskStatuses;
    const cards = currentTasks().map((task) => ({
      id: task.id,
      status: task.status,
      title: task.title,
      subtitle: task.dueDate ? `Prazo: ${task.dueDate}` : 'Sem prazo',
      detail: task.notes || '',
      actions: UI.actionButton('delete-task', task.id, 'Excluir', 'danger'),
    }));
    return UI.section('Quadro de tarefas', 'Arraste tarefas entre as colunas (ou use o campo "Mover para" no celular). Use para compras, produção, cobrança, despachos e revisão.', `
      <form id="taskForm" class="grid-form">
        <label>Tarefa
          <input name="title" required placeholder="Ex.: Comprar vidros / cobrar cliente / despachar pedido">
        </label>
        <label>Prazo
          <input name="dueDate" type="date">
        </label>
        <label>Status inicial
          <select name="status">${UI.optionList(statuses, 'a_fazer', '')}</select>
        </label>
        <label class="wide">Observações
          <input name="notes" placeholder="Detalhes da tarefa">
        </label>
        <button type="submit">Criar tarefa</button>
      </form>
      ${UI.kanban({ statuses, cards, type: 'tasks' })}
    `);
  }

  function renderReports() {
    if (!state().activeBusinessId) return activeBusinessRequiredHtml();
    const products = currentProducts();
    const inPeriod = (date) => (!dashboardStart || String(date || '') >= dashboardStart) && (!dashboardEnd || String(date || '') <= dashboardEnd);
    const periodSales = currentSales().filter((sale) => inPeriod(sale.date));
    const periodMovements = currentMovements().filter((movement) => inPeriod(movement.date || movement.createdAt?.slice(0, 10)));
    const periodFinancial = currentFinancialEntries().filter((entry) => inPeriod(entry.issueDate));
    const salesTotal = periodSales.reduce((sum, sale) => sum + U.number(sale.netRevenue), 0);
    const profitTotal = periodSales.reduce((sum, sale) => sum + U.number(sale.grossProfit), 0);
    const ticket = periodSales.length ? salesTotal / new Set(periodSales.map((sale) => sale.originId || sale.id)).size : 0;
    const financialReceived = periodFinancial.filter((entry) => entry.direction === 'receivable' && entry.status !== 'cancelled').reduce((sum, entry) => sum + U.number(entry.paidAmount), 0);
    const financialPaid = periodFinancial.filter((entry) => entry.direction === 'payable' && entry.status !== 'cancelled').reduce((sum, entry) => sum + U.number(entry.paidAmount), 0);
    const byProduct = new Map();
    periodSales.forEach((sale) => {
      const key = String(sale.productId);
      const row = byProduct.get(key) || { product: productById(sale.productId), quantity: 0, revenue: 0, profit: 0 };
      row.quantity += U.number(sale.quantity); row.revenue += U.number(sale.netRevenue); row.profit += U.number(sale.grossProfit); byProduct.set(key, row);
    });
    const topProductRows = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 12).map((row) => [UI.productName(row.product), U.qty(row.quantity, row.product?.unit), UI.moneyCell(row.revenue), UI.moneyCell(row.profit), row.revenue ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : '0%']);
    const costRows = products.filter((product) => ['produto_final', 'kit'].includes(product.type)).map((product) => {
      const cost = Calc.calculateRecipeCost(product.id, state());
      return [
        U.escapeHtml(product.name),
        UI.moneyCell(cost.materialsCost),
        UI.moneyCell(cost.totalCostPerUnit),
        UI.moneyCell(cost.suggestedSalePrice),
        UI.moneyCell(product.salePrice || cost.suggestedSalePrice),
        `${(cost.marginAtSelectedPrice * 100).toFixed(2)}%`,
      ];
    });
    const stockRows = products.map((product) => [
      UI.productName(product),
      UI.badge(labelForProductType(product.type)),
      UI.stockCell(product),
      UI.moneyCell(product.avgCost),
      UI.moneyCell(U.number(product.currentStock) * U.number(product.avgCost)),
    ]);
    const movementRows = U.sortByDateDesc(periodMovements).slice(0, 80).map((mov) => {
      const product = productById(mov.productId);
      return [
        U.escapeHtml(mov.date || mov.createdAt?.slice(0, 10) || '—'),
        U.escapeHtml(mov.type),
        UI.productName(product),
        U.qty(mov.quantity, product?.unit),
        UI.moneyCell(mov.unitCost),
        U.escapeHtml(mov.notes || '—'),
      ];
    });

    return UI.section('Relatórios', 'Indicadores filtráveis de vendas, financeiro, produtos, estoque e movimentações.', `
      <div class="panel-card report-period-bar">
        <div><span>Período analisado</span><strong>${U.escapeHtml(dashboardStart || 'Início')} até ${U.escapeHtml(dashboardEnd || 'Hoje')}</strong></div>
        <label>De<input type="date" data-dashboard-date="start" value="${U.escapeHtml(dashboardStart)}"></label>
        <label>Até<input type="date" data-dashboard-date="end" value="${U.escapeHtml(dashboardEnd)}"></label>
      </div>
      <div class="metric-grid report-metrics">
        <article><span>Receita líquida</span><strong>${U.money(salesTotal)}</strong><small>${periodSales.length} item(ns) vendidos.</small></article>
        <article><span>Lucro bruto</span><strong>${U.money(profitTotal)}</strong><small>${salesTotal ? ((profitTotal / salesTotal) * 100).toFixed(1) : '0'}% de margem.</small></article>
        <article><span>Ticket médio</span><strong>${U.money(ticket)}</strong><small>Por venda ou pedido.</small></article>
        <article><span>Caixa no período</span><strong>${U.money(financialReceived - financialPaid)}</strong><small>${U.money(financialReceived)} recebido · ${U.money(financialPaid)} pago.</small></article>
      </div>
      <div class="panel-card"><h3>Produtos mais vendidos</h3>${UI.table(['Produto', 'Qtd.', 'Receita', 'Lucro', 'Margem'], topProductRows, 'Nenhuma venda no período.')}</div>
      <div class="three-columns">
        <div class="panel-card"><h3>Produtos finais e preço</h3>${UI.table(['Produto', 'Materiais', 'Custo final', 'Preço sugerido', 'Preço usado', 'Margem'], costRows, 'Nenhum produto final cadastrado.')}</div>
        <div class="panel-card"><h3>Estoque atual</h3>${UI.table(['Produto', 'Tipo', 'Estoque', 'Custo médio', 'Valor em estoque'], stockRows, 'Nenhum produto cadastrado.')}</div>
        <div class="panel-card"><h3>Últimas movimentações</h3>${UI.table(['Data', 'Tipo', 'Produto', 'Qtd.', 'Custo unit.', 'Obs.'], movementRows, 'Nenhuma movimentação.')}</div>
      </div>
      ${renderReplicationReports()}
    `);
  }

  function sellerName(id) {
    const profile = state().profiles.find((item) => String(item.id) === String(id));
    return profile ? profile.name : 'Vendedor';
  }

  // Fase 5 do pacote de replicação (docs/replication-v1/06-fases5-6-relatorios-e-seguranca.md):
  // relatórios que consomem o que as Fases 2-4 criaram. Sem tabela nova —
  // só leitura do que já está em cache (sellerAccountEntries, saleCarts,
  // orders, operationalMovements).
  function renderReplicationReports() {
    const businessId = state().activeBusinessId;

    const sellerBalanceRows = state().sellers
      .filter((seller) => seller.active !== false)
      .map((seller) => {
        const entries = state().sellerAccountEntries.filter((entry) => String(entry.sellerId) === String(seller.id));
        return { seller, balance: Calc.sellerBalance(entries) };
      })
      .filter((row) => row.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
      .map((row) => [U.escapeHtml(row.seller.name || 'Vendedor'), UI.moneyCell(row.balance)]);

    const openCarts = (state().saleCarts || []).filter((cart) => ['pending_approval', 'partially_approved'].includes(cart.status));
    const openOrders = currentOrders().filter((order) => !['despachado', 'concluido'].includes(order.status));
    const openOrderRows = [
      ...openCarts.map((cart) => [
        'Carrinho', U.escapeHtml(sellerName(cart.sellerId)), U.escapeHtml(cart.customerName || '—'),
        U.escapeHtml(cart.status), (cart.createdAt || '').slice(0, 10),
      ]),
      ...openOrders.map((order) => [
        'Pedido', U.escapeHtml(sellerName(order.sellerId)), U.escapeHtml(clientById(order.clientId)?.name || '—'),
        U.escapeHtml(order.status), (order.dueDate || '').slice(0, 10),
      ]),
    ];

    const movements = state().operationalMovements || [];
    const pendingReturns = movements.filter((movement) => movement.type === 'return' && ['a_devolver', 'enviado', 'recebido'].includes(movement.status));
    const pendingReturnRows = pendingReturns.map((movement) => {
      const product = productById(movement.productId);
      return [
        U.escapeHtml(sellerName(movement.sellerId)), U.escapeHtml(product ? product.name : 'Produto removido'),
        U.qty(movement.quantityDeclared, product?.unit), U.escapeHtml(movement.status),
      ];
    });

    const wasteByMonth = {};
    movements.filter((movement) => movement.type === 'waste' && movement.status === 'confirmed').forEach((movement) => {
      const month = (movement.confirmedAt || movement.createdAt || '').slice(0, 7) || '—';
      const product = productById(movement.productId);
      const value = U.number(movement.quantityReceived) * U.number(product?.avgCost);
      wasteByMonth[month] = (wasteByMonth[month] || 0) + value;
    });
    const wasteRows = Object.entries(wasteByMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([month, value]) => [U.escapeHtml(month), UI.moneyCell(value)]);

    const giftsByResponsible = {};
    movements.filter((movement) => movement.type === 'gift' && movement.status === 'confirmed').forEach((movement) => {
      const label = movement.sellerId ? sellerName(movement.sellerId) : 'Admin';
      const product = productById(movement.productId);
      const qty = U.number(movement.quantityReceived);
      if (!giftsByResponsible[label]) giftsByResponsible[label] = [];
      giftsByResponsible[label].push(`${qty} ${product?.unit || ''} de ${product?.name || 'produto removido'}`);
    });
    const giftRows = Object.entries(giftsByResponsible).map(([label, items]) => [U.escapeHtml(label), U.escapeHtml(items.join(', '))]);

    const inTransit = movements.filter((movement) => movement.type === 'return' && ['a_devolver', 'enviado'].includes(movement.status));
    const inTransitRows = inTransit.map((movement) => {
      const product = productById(movement.productId);
      return [U.escapeHtml(sellerName(movement.sellerId)), U.escapeHtml(product ? product.name : 'Produto removido'), U.qty(movement.quantityDeclared, product?.unit)];
    });

    if (!businessId) return '';

    return `
      <div class="three-columns" style="margin-top: 1.2rem;">
        <div class="panel-card"><h3>Saldo por vendedor</h3>${UI.table(['Vendedor', 'Saldo'], sellerBalanceRows, 'Nenhum vendedor com saldo em aberto.')}</div>
        <div class="panel-card"><h3>Pedidos em aberto</h3>${UI.table(['Origem', 'Vendedor', 'Cliente', 'Status', 'Data'], openOrderRows, 'Nenhum pedido em aberto.')}</div>
        <div class="panel-card"><h3>Devoluções pendentes</h3>${UI.table(['Vendedor', 'Produto', 'Qtd.', 'Status'], pendingReturnRows, 'Nenhuma devolução pendente.')}</div>
        <div class="panel-card"><h3>Desperdício por período</h3>${UI.table(['Mês', 'Valor perdido'], wasteRows, 'Nenhum desperdício confirmado ainda.')}</div>
        <div class="panel-card"><h3>Brindes por responsável</h3>${UI.table(['Responsável', 'Itens'], giftRows, 'Nenhum brinde confirmado ainda.')}</div>
        <div class="panel-card"><h3>Estoque em trânsito</h3>${UI.table(['Vendedor', 'Produto', 'Qtd.'], inTransitRows, 'Nada em trânsito.')}</div>
      </div>
    `;
  }

  function currentMovements() {
    return state().stockMovements.filter((movement) => movement.businessId === state().activeBusinessId);
  }

  function renderData() {
    const collections = window.C360.io.COLLECTIONS;
    const countRows = collections.map((collection) => [
      U.escapeHtml(collection.sheet),
      String((state()[collection.key] || []).length),
    ]);

    const csvButtons = collections.map((collection) => {
      const scope = collection.key === 'businesses' ? 'todos' : 'negócio ativo';
      return `<button type="button" class="small secondary" data-io="export-csv" data-collection="${collection.key}">${U.escapeHtml(collection.sheet)} <span class="hint-inline">${scope}</span></button>`;
    }).join('');

    return UI.section('Backup e exportação', 'Salve, leve para outro computador ou abra seus dados no Excel. Os dados ficam apenas neste navegador — exporte com frequência.', `
      <div class="export-grid">
        <article class="export-card highlight">
          <div class="export-card-head"><span class="export-tag">Recomendado</span><h3>Excel (.xlsx)</h3></div>
          <p>Backup completo com uma aba por módulo. Abre no Excel ou Google Sheets, pode ser editado e reimportado.</p>
          <div class="export-actions">
            <button type="button" data-io="export-xlsx">Baixar Excel completo</button>
            <label class="file-button">
              Importar Excel
              <input type="file" accept=".xlsx" data-io-import="xlsx">
            </label>
          </div>
        </article>

        <article class="export-card">
          <div class="export-card-head"><h3>Backup JSON</h3></div>
          <p>Cópia técnica fiel de tudo, incluindo configurações. Ideal como backup de segurança.</p>
          <div class="export-actions">
            <button type="button" class="secondary" data-io="export-json">Baixar JSON</button>
            <label class="file-button">
              Importar JSON
              <input type="file" accept="application/json,.json" data-io-import="json">
            </label>
          </div>
        </article>

        <article class="export-card">
          <div class="export-card-head"><h3>CSV por módulo</h3></div>
          <p>Uma tabela por vez, para abrir em qualquer planilha ou enviar para alguém.</p>
          <div class="export-actions wrap">${csvButtons}</div>
        </article>
      </div>

      <div class="notice info">Importar substitui os dados atuais deste navegador. Faça um backup antes se tiver dúvida.</div>

      <div class="panel-card">
        <h3>O que está salvo agora</h3>
        ${UI.table(['Módulo', 'Registros'], countRows, 'Nenhum dado ainda.')}
      </div>
    `);
  }

  function openClientEditor(clientId, focusEdit = false) {
    const client = clientById(clientId);
    if (!client) throw new Error('Cliente não encontrado.');
    const sales = currentSales().filter((sale) => String(sale.clientId) === String(client.id) && U.number(sale.quantity) > 0);
    const orders = currentOrders().filter((order) => String(order.clientId) === String(client.id));
    const consignments = currentConsignments().filter((item) => String(item.clientId) === String(client.id));
    const financial = currentFinancialEntries().filter((entry) => String(entry.clientId) === String(client.id) && entry.status !== 'cancelled');
    const sold = sales.reduce((sum, sale) => sum + U.number(sale.netRevenue), 0);
    const openConsignment = consignments.reduce((sum, item) => sum + Calc.consignmentOpenAmount(item), 0);
    const openFinancial = financial.reduce((sum, entry) => sum + Math.max(0, U.number(entry.amount) - U.number(entry.paidAmount)), 0);
    const recentRows = sales.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map((sale) => [
      U.escapeHtml(sale.date),
      UI.productName(productById(sale.productId)),
      U.qty(sale.quantity, productById(sale.productId)?.unit),
      UI.moneyCell(sale.netRevenue),
    ]);
    document.getElementById('clientEditor')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'clientEditor';
    dialog.className = 'product-editor-dialog client-editor-dialog';
    dialog.innerHTML = `
      <div class="client-editor-shell">
        <header><div><span>Cliente 360°</span><h2>${U.escapeHtml(client.name)}</h2></div><button type="button" class="ghost small" data-action="close-client-editor">Fechar</button></header>
        <div class="metric-grid client-history-metrics">
          <article><span>Vendas</span><strong>${U.money(sold)}</strong><small>${sales.length} itens vendidos.</small></article>
          <article><span>Pedidos</span><strong>${orders.length}</strong><small>${orders.filter((order) => !['despachado', 'concluido'].includes(order.status)).length} em andamento.</small></article>
          <article><span>Consignado</span><strong>${U.money(openConsignment)}</strong><small>Vendido e ainda não pago.</small></article>
          <article><span>A receber</span><strong>${U.money(openFinancial)}</strong><small>Contas financeiras abertas.</small></article>
        </div>
        <div class="two-columns client-editor-columns">
          <section class="panel-card">
            <h3>Dados do cliente</h3>
            <form id="clientEditForm" class="stack-form">
              <input type="hidden" name="id" value="${U.escapeHtml(client.id)}">
              <label>Nome<input name="name" required value="${U.escapeHtml(client.name)}"></label>
              <label>Telefone / WhatsApp<input name="phone" value="${U.escapeHtml(client.phone || '')}"></label>
              <label>Tipo<select name="type">
                <option value="cliente" ${client.type === 'cliente' ? 'selected' : ''}>Cliente</option>
                <option value="consignado" ${client.type === 'consignado' ? 'selected' : ''}>Consignado</option>
                <option value="ambos" ${client.type === 'ambos' ? 'selected' : ''}>Ambos</option>
              </select></label>
              <label>Observações<textarea name="notes">${U.escapeHtml(client.notes || '')}</textarea></label>
              <button type="submit">Salvar alterações</button>
            </form>
          </section>
          <section class="panel-card">
            <h3>Últimas vendas</h3>
            ${UI.table(['Data', 'Produto', 'Qtd.', 'Valor'], recentRows, 'Nenhuma venda registrada.')}
          </section>
        </div>
      </div>`;
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    if (focusEdit) dialog.querySelector('[name="name"]')?.focus();
  }

  async function updateClient(data) {
    await S.update('clients', data.id, {
      name: data.name.trim(),
      phone: data.phone || '',
      type: data.type || 'cliente',
      notes: data.notes || '',
    });
  }

  function openProductEditor(productId) {
    const product = productById(productId);
    if (!product) throw new Error('Produto não encontrado.');
    const movements = currentMovements().filter((item) => String(item.productId) === String(product.id)).slice().sort((a, b) => String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt))).slice(0, 12);
    const sellerQuantity = (state().sellerStock || []).filter((item) => String(item.productId) === String(product.id)).reduce((sum, item) => sum + U.number(item.quantity), 0);
    const consignedQuantity = currentConsignments().filter((item) => String(item.productId) === String(product.id)).reduce((sum, item) => sum + Calc.consignmentAvailableWithClient(item), 0);
    const pendingQuantity = currentOrders().filter((item) => String(item.productId) === String(product.id) && !['despachado', 'concluido'].includes(item.status)).reduce((sum, item) => sum + U.number(item.quantity), 0);
    const movementRows = movements.map((item) => [U.escapeHtml(item.date || item.createdAt?.slice(0, 10) || '—'), U.escapeHtml(item.type), U.qty(item.quantity, product.unit), UI.moneyCell(item.unitCost), U.escapeHtml(item.notes || '—')]);
    document.getElementById('productEditor')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'productEditor';
    dialog.className = 'product-editor-dialog';
    dialog.innerHTML = `
      <form id='productEditForm' class='grid-form product-editor-form'>
        <header><div><span>Produto 360°</span><h2>${U.escapeHtml(product.name)}</h2></div><button type='button' class='ghost small' data-action='close-product-editor'>Fechar</button></header>
        <div class='full metric-grid product-history-metrics'>
          <article><span>Estoque central</span><strong>${U.qty(product.currentStock, product.unit)}</strong><small>${U.money(U.number(product.currentStock) * U.number(product.avgCost))} pelo custo.</small></article>
          <article><span>Com vendedores</span><strong>${U.qty(sellerQuantity, product.unit)}</strong><small>Estoque distribuído à equipe.</small></article>
          <article><span>Com clientes</span><strong>${U.qty(consignedQuantity, product.unit)}</strong><small>Consignado ainda disponível.</small></article>
          <article><span>Em pedidos</span><strong>${U.qty(pendingQuantity, product.unit)}</strong><small>Ainda não concluído.</small></article>
        </div>
        <details class='full panel-card product-movement-history'><summary>Últimas movimentações</summary>${UI.table(['Data', 'Tipo', 'Qtd.', 'Custo', 'Observação'], movementRows, 'Nenhuma movimentação registrada.')}</details>
        <input type='hidden' name='id' value='${U.escapeHtml(product.id)}'>
        <label>Nome<input name='name' required value='${U.escapeHtml(product.name)}'></label>
        <label>Tipo<select name='type' required>${UI.optionList(state().settings.productTypes, product.type, '')}</select></label>
        <label>Unidade<select name='unit' required>${UI.optionList(state().settings.units, product.unit, '')}</select></label>
        <label>Preço de venda<input name='salePrice' type='number' min='0' step='0.01' value='${U.escapeHtml(product.salePrice || 0)}'></label>
        <label>Piso de preço<input name='priceFloor' type='number' min='0' step='0.01' value='${U.escapeHtml(product.priceFloor ?? '')}'></label>
        <label>Estoque mínimo<input name='minStock' type='number' min='0' step='0.001' value='${U.escapeHtml(product.minStock || 0)}'></label>
        <label>Margem desejada (%)<input name='targetMarginPercent' type='number' min='0' step='0.01' value='${U.escapeHtml(product.targetMarginPercent || 0)}'></label>
        <label>Taxas (%)<input name='taxFeePercent' type='number' min='0' step='0.01' value='${U.escapeHtml(product.taxFeePercent || 0)}'></label>
        <label class='full'>Observações<textarea name='notes'>${U.escapeHtml(product.notes || '')}</textarea></label>
        <footer><button type='button' class='ghost' data-action='close-product-editor'>Cancelar</button><button type='submit'>Salvar alterações</button></footer>
      </form>`;
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function openFinancialPayment(entryId) {
    const entry = currentFinancialEntries().find((item) => item.id === entryId);
    if (!entry) throw new Error('Lançamento financeiro não encontrado.');
    const remaining = Math.max(0, U.number(entry.amount) - U.number(entry.paidAmount));
    document.getElementById('financialPaymentEditor')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'financialPaymentEditor';
    dialog.className = 'product-editor-dialog financial-payment-dialog';
    dialog.innerHTML = `
      <form id="financialPaymentForm" class="stack-form product-editor-form">
        <header><div><span>Baixar lançamento</span><h2>${U.escapeHtml(entry.description)}</h2></div><button type="button" class="ghost small" data-action="close-financial-payment">Fechar</button></header>
        <input type="hidden" name="id" value="${U.escapeHtml(entry.id)}">
        <div class="notice">Saldo atual: <strong>${U.money(remaining)}</strong></div>
        <label>Valor desta baixa<input name="amount" type="number" min="0.01" max="${remaining}" step="0.01" required value="${remaining}"></label>
        <label>Forma de pagamento<input name="paymentMethod" value="${U.escapeHtml(entry.paymentMethod || '')}" placeholder="Pix, dinheiro, cartão..."></label>
        <footer><button type="button" class="ghost" data-action="close-financial-payment">Cancelar</button><button type="submit">Confirmar baixa</button></footer>
      </form>`;
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  async function addFinancialEntry(data) {
    U.assertPositive(data.amount, 'Valor');
    const amount = U.number(data.amount);
    const paidAmount = U.number(data.paidAmount);
    if (paidAmount < 0 || paidAmount > amount) throw new Error('Valor pago precisa ficar entre zero e o valor total.');
    await S.add('financialEntries', {
      direction: data.direction,
      category: data.category || 'other',
      description: data.description.trim(),
      issueDate: data.issueDate || U.today(),
      dueDate: data.dueDate || null,
      amount,
      paidAmount,
      clientId: data.clientId || null,
      supplierId: data.supplierId || null,
      paymentMethod: data.paymentMethod || null,
      notes: data.notes || '',
    });
  }

  async function applyFinancialPayment(data) {
    const entry = currentFinancialEntries().find((item) => item.id === data.id);
    if (!entry) throw new Error('Lançamento financeiro não encontrado.');
    U.assertPositive(data.amount, 'Valor da baixa');
    const nextPaid = U.number(entry.paidAmount) + U.number(data.amount);
    if (nextPaid > U.number(entry.amount) + 0.001) throw new Error('A baixa não pode superar o saldo do lançamento.');
    await S.update('financialEntries', entry.id, { paidAmount: nextPaid, paymentMethod: data.paymentMethod || entry.paymentMethod || null });
  }

  async function updateProduct(data) {
    const business = S.activeBusiness();
    await S.update('products', data.id, {
      name: data.name.trim(),
      type: data.type,
      unit: data.unit,
      salePrice: U.number(data.salePrice),
      priceFloor: data.priceFloor === '' ? null : U.number(data.priceFloor),
      minStock: U.number(data.minStock),
      targetMarginPercent: U.number(data.targetMarginPercent ?? business?.defaultTargetMargin),
      taxFeePercent: U.number(data.taxFeePercent ?? business?.defaultFeePercent),
      notes: data.notes || '',
    });
  }
  async function updateBusiness(data) {
    const business = S.activeBusiness();
    if (!business) throw new Error('Sua conta ainda não está vinculada a um negócio.');
    await S.update('businesses', business.id, {
      name: data.name.trim(),
      segment: data.segment,
      defaultTargetMargin: U.number(data.defaultTargetMargin),
      defaultFeePercent: U.number(data.defaultFeePercent),
      notes: data.notes || '',
    });
  }

  async function addProduct(data) {
    const business = S.activeBusiness();
    await S.add('products', {
      name: data.name.trim(),
      type: data.type,
      unit: data.unit,
      currentStock: U.number(data.currentStock),
      avgCost: U.number(data.avgCost),
      salePrice: U.number(data.salePrice),
      minStock: U.number(data.minStock),
      laborCostPerUnit: U.number(data.laborCostPerUnit),
      overheadCostPerUnit: U.number(data.overheadCostPerUnit),
      lossPercent: U.number(data.lossPercent),
      targetMarginPercent: data.targetMarginPercent === '' ? U.number(business?.defaultTargetMargin) : U.number(data.targetMarginPercent),
      taxFeePercent: data.taxFeePercent === '' ? U.number(business?.defaultFeePercent) : U.number(data.taxFeePercent),
      notes: data.notes || '',
    });
  }

  async function addPurchaseDraftItem(data) {
    U.assertPositive(data.quantity, 'Quantidade');
    U.assertPositive(data.totalCost, 'Valor do item');
    const product = productById(data.productId);
    if (!product) throw new Error('Produto não encontrado.');
    const existing = purchaseDraft.find((item) => String(item.productId) === String(data.productId));
    if (existing) {
      existing.quantity = U.number(existing.quantity) + U.number(data.quantity);
      existing.totalCost = U.number(existing.totalCost) + U.number(data.totalCost);
    } else {
      purchaseDraft.push({ productId: data.productId, quantity: U.number(data.quantity), totalCost: U.number(data.totalCost) });
    }
  }

  async function finalizePurchaseGroup(data) {
    if (!purchaseDraft.length) throw new Error('Adicione pelo menos um produto à compra.');
    const total = purchaseDraft.reduce((sum, item) => sum + U.number(item.totalCost), 0);
    const paidAmount = U.number(data.paidAmount);
    if (paidAmount < 0 || paidAmount > total) throw new Error('Valor pago precisa ficar entre zero e o total da compra.');
    await window.C360.api.registerPurchaseGroup({
      supplierId: data.supplierId || null,
      date: data.date,
      dueDate: data.dueDate || data.date,
      paymentMode: data.paymentMode || 'a_prazo',
      paidAmount,
      notes: data.notes || '',
      items: purchaseDraft.map((item) => ({ productId: item.productId, quantity: item.quantity, totalCost: item.totalCost })),
    });
    purchaseDraft = [];
    await S.refresh();
  }

  async function addPurchase(data) {
    U.assertPositive(data.quantity, 'Quantidade');
    U.assertPositive(data.totalCost, 'Valor total');
    const product = productById(data.productId);
    if (!product) throw new Error('Produto não encontrado.');
    const quantity = U.number(data.quantity);
    const totalCost = U.number(data.totalCost);
    const paidAmount = U.number(data.paidAmount);
    if (paidAmount < 0 || paidAmount > totalCost) throw new Error('Valor pago precisa ficar entre zero e o total da compra.');
    const unitCost = totalCost / quantity;
    const nextAvg = Calc.weightedAverageCost(product.currentStock, product.avgCost, quantity, totalCost);
    await S.update('products', product.id, {
      currentStock: U.number(product.currentStock) + quantity,
      avgCost: nextAvg,
    });
    await S.add('purchases', {
      date: data.date,
      supplierId: data.supplierId || null,
      productId: product.id,
      quantity,
      totalCost,
      unitCost,
      notes: data.notes || '',
      dueDate: data.dueDate || data.date,
      paymentMode: data.paymentMode || 'a_prazo',
      paidAmount,
    });
    await S.recordMovement({
      date: data.date,
      type: 'entrada_compra',
      productId: product.id,
      quantity,
      unitCost,
      totalCost,
      notes: data.notes || '',
    });
    await S.refresh();
  }

  async function addRecipe(data) {
    U.assertPositive(data.quantityPerUnit, 'Quantidade por unidade');
    if (data.finalProductId === data.inputProductId) throw new Error('Produto final não pode consumir ele mesmo.');
    const duplicate = currentRecipes().find((row) => row.finalProductId === data.finalProductId && row.inputProductId === data.inputProductId);
    if (duplicate) throw new Error('Este item já existe na ficha técnica. Exclua o anterior antes de lançar novo valor.');
    await S.add('recipes', {
      finalProductId: data.finalProductId,
      inputProductId: data.inputProductId,
      quantityPerUnit: U.number(data.quantityPerUnit),
    });
  }

  async function addProduction(data) {
    U.assertPositive(data.quantity, 'Quantidade produzida');
    const finalProduct = productById(data.finalProductId);
    if (!finalProduct) throw new Error('Produto final não encontrado.');
    const recipe = Calc.calculateRecipeCost(finalProduct.id, state());
    if (!recipe.items.length) throw new Error('Produto final sem ficha técnica.');
    const quantity = U.number(data.quantity);

    const shortages = recipe.items.filter((item) => U.number(item.input?.currentStock) < item.quantityPerUnit * quantity);
    if (shortages.length) {
      const names = shortages.map((item) => item.input?.name || 'item removido').join(', ');
      throw new Error(`Estoque insuficiente para: ${names}.`);
    }

    let totalCost = 0;
    for (const item of recipe.items) {
      const consumedQty = item.quantityPerUnit * quantity;
      const cost = consumedQty * U.number(item.input.avgCost);
      totalCost += cost;
      // eslint-disable-next-line no-await-in-loop
      await S.update('products', item.input.id, { currentStock: U.number(item.input.currentStock) - consumedQty });
      // eslint-disable-next-line no-await-in-loop
      await S.recordMovement({
        date: data.date,
        type: 'saida_producao_insumo',
        productId: item.input.id,
        quantity: -consumedQty,
        unitCost: U.number(item.input.avgCost),
        totalCost: -cost,
        notes: `Produção de ${finalProduct.name}`,
      });
    }

    const extraCosts = (U.number(finalProduct.laborCostPerUnit) + U.number(finalProduct.overheadCostPerUnit)) * quantity;
    const lossCost = (totalCost + extraCosts) * (U.number(finalProduct.lossPercent) / 100);
    totalCost += extraCosts + lossCost;
    const unitCost = totalCost / quantity;
    const nextAvg = Calc.weightedAverageCost(finalProduct.currentStock, finalProduct.avgCost, quantity, totalCost);

    await S.update('products', finalProduct.id, {
      currentStock: U.number(finalProduct.currentStock) + quantity,
      avgCost: nextAvg,
    });
    await S.add('productions', {
      date: data.date,
      finalProductId: finalProduct.id,
      quantity,
      totalCost,
      unitCost,
      notes: data.notes || '',
    });
    await S.recordMovement({
      date: data.date,
      type: 'entrada_producao_produto_final',
      productId: finalProduct.id,
      quantity,
      unitCost,
      totalCost,
      notes: data.notes || '',
    });
  }

  // Vendedor logado tem um preço/piso específico para este produto? (linha de
  // seller_prices já carregada no cache pelo refresh — ver src/state.js).
  function sellerPriceForProduct(productId) {
    return (state().sellerPrices || []).find((row) => String(row.productId) === String(productId)) || null;
  }

  // Bloqueio client-side do piso de preço (UX): o trigger do banco (ver
  // docs/backend.md §7) é a garantia final, isto só evita uma viagem ao
  // servidor para descobrir que o preço está abaixo do piso.
  function validateSaleFloor(data) {
    const user = S.getCurrentUser();
    if (!user || user.role !== 'vendedor') return;
    if (!Calc.resolveSellerPrice || !Calc.validatePriceFloor) return;
    const product = productById(data.productId);
    if (!product) return;
    const sellerPrice = sellerPriceForProduct(data.productId);
    const { floor } = Calc.resolveSellerPrice({ product, sellerPrice });
    const result = Calc.validatePriceFloor({ unitPrice: data.unitPrice, floor });
    if (!result.ok) throw new Error(result.message);
  }

  async function addSale(data, options = {}) {
    U.assertPositive(data.quantity, 'Quantidade');
    U.assertPositive(data.unitPrice, 'Preço unitário');
    const product = productById(data.productId);
    if (!product) throw new Error('Produto não encontrado.');
    // Vendedor não tem permissão (RLS) para dar baixa no estoque central nem
    // registrar stock_movements do tipo saida_venda — só admin controla o
    // estoque central. Produto físico vendido por vendedor precisa vir do
    // próprio estoque (aba "Meu estoque", vira consignado), não desta venda
    // direta. Barrar aqui evita criar a venda e falhar depois no meio do
    // fluxo (registro de venda órfão, sem baixa de estoque).
    if (!options.skipStockMovement && product.type !== 'servico') {
      const currentUser = S.getCurrentUser();
      if (currentUser && currentUser.role === 'vendedor') {
        throw new Error('Vendedores vendem produtos físicos pela aba "Meu estoque" (vira consignado). Aqui você só pode lançar vendas de serviços.');
      }
    }
    const quantity = U.number(data.quantity);
    if (product.type !== 'servico' && U.number(product.currentStock) < quantity && !options.skipStockCheck) {
      throw new Error(`Estoque insuficiente. Disponível: ${U.qty(product.currentStock, product.unit)}.`);
    }
    const unitCost = options.unitCostOverride ?? U.number(product.avgCost);
    const math = Calc.saleMath({
      quantity,
      unitPrice: data.unitPrice,
      discount: data.discount,
      fixedFees: data.fixedFees,
      feePercent: data.feePercent,
      unitCost,
    });
    const sale = await S.add('sales', {
      date: data.date,
      channel: data.channel || 'Direto',
      clientId: data.clientId || null,
      productId: product.id,
      quantity,
      unitPrice: U.number(data.unitPrice),
      discount: U.number(data.discount),
      fixedFees: U.number(data.fixedFees),
      feePercent: U.number(data.feePercent),
      unitCost,
      ...math,
      notes: data.notes || '',
      origin: options.origin || 'manual',
      originId: options.originId || null,
    });

    if (product.type !== 'servico' && !options.skipStockMovement) {
      await S.update('products', product.id, { currentStock: U.number(product.currentStock) - quantity });
      await S.recordMovement({
        date: data.date,
        type: 'saida_venda',
        productId: product.id,
        quantity: -quantity,
        unitCost,
        totalCost: -(quantity * unitCost),
        notes: data.notes || '',
      });
    }
    return sale;
  }

  // Wrapper usado pelo #saleForm (lançamento manual de venda): valida o piso
  // de preço do vendedor antes de chamar addSale. Fluxos internos (conversão
  // de pedido, baixa de consignado) chamam addSale diretamente, sem esta
  // validação extra, porque o preço já vem combinado/aprovado antes.
  async function submitSale(data) {
    validateSaleFloor(data);
    return addSale(data);
  }

  async function addOrder(data) {
    U.assertPositive(data.quantity, 'Quantidade');
    U.assertPositive(data.unitPrice, 'Preço unitário');
    await S.add('orders', {
      clientId: data.clientId || null,
      productId: data.productId,
      quantity: U.number(data.quantity),
      unitPrice: U.number(data.unitPrice),
      dueDate: data.dueDate || null,
      status: 'pendente',
      notes: data.notes || '',
      convertedSaleId: null,
      approvalStatus: S.isAdmin() ? 'aprovado' : 'pendente_aprovacao',
    });
  }

  async function addConsignment(data) {
    U.assertPositive(data.quantitySent, 'Quantidade enviada');
    U.assertPositive(data.unitPrice, 'Preço unitário');
    const product = productById(data.productId);
    if (!product) throw new Error('Produto não encontrado.');
    const quantitySent = U.number(data.quantitySent);
    if (U.number(product.currentStock) < quantitySent) throw new Error(`Estoque insuficiente. Disponível: ${U.qty(product.currentStock, product.unit)}.`);
    const costAtSend = U.number(product.avgCost);
    await S.update('products', product.id, { currentStock: U.number(product.currentStock) - quantitySent });
    const record = await S.add('consignments', {
      date: data.date,
      clientId: data.clientId,
      productId: product.id,
      quantitySent,
      quantitySold: 0,
      quantityReturned: 0,
      amountPaid: 0,
      unitPrice: U.number(data.unitPrice),
      costAtSend,
      notes: data.notes || '',
      status: 'com_cliente',
    });
    await S.recordMovement({
      date: data.date,
      type: 'saida_envio_consignado',
      productId: product.id,
      quantity: -quantitySent,
      unitCost: costAtSend,
      totalCost: -(quantitySent * costAtSend),
      notes: `Envio consignado ${record.id}`,
    });
  }

  async function deleteRecord(collection, id) {
    await S.remove(collection, id);
  }

  async function handleSubmit(event) {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    try {
      const data = U.formData(form);
      const handlers = {
        businessForm: updateBusiness,
        productForm: addProduct,
        productEditForm: updateProduct,
        clientEditForm: updateClient,
        clientForm: (d) => S.add('clients', { name: d.name.trim(), phone: d.phone || '', type: d.type || 'cliente', notes: d.notes || '' }),
        supplierForm: (d) => S.add('suppliers', { name: d.name.trim(), phone: d.phone || '', notes: d.notes || '' }),
        purchaseItemForm: addPurchaseDraftItem,
        purchaseGroupForm: finalizePurchaseGroup,
        financialEntryForm: addFinancialEntry,
        financialPaymentForm: applyFinancialPayment,
        recipeForm: addRecipe,
        productionForm: addProduction,
        saleForm: submitSale,
        orderForm: addOrder,
        consignmentForm: addConsignment,
        taskForm: (d) => S.add('tasks', { title: d.title.trim(), dueDate: d.dueDate || null, status: d.status || 'a_fazer', notes: d.notes || '' }),
      };
      const handler = handlers[form.id];
      if (!handler) return;
      await handler(data);
      if (form.id === 'productEditForm') document.getElementById('productEditor')?.close();
      if (form.id === 'clientEditForm') document.getElementById('clientEditor')?.close();
      if (form.id === 'financialPaymentForm') document.getElementById('financialPaymentEditor')?.close();
      form.reset();
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    try {
      if (action === 'edit-product') { openProductEditor(id); return; }
      if (action === 'client-history') { openClientEditor(id, false); return; }
      if (action === 'edit-client') { openClientEditor(id, true); return; }
      if (action === 'close-client-editor') { document.getElementById('clientEditor')?.close(); return; }
      if (action === 'close-product-editor') { document.getElementById('productEditor')?.close(); return; }
      if (action === 'financial-pay') { openFinancialPayment(id); return; }
      if (action === 'close-financial-payment') { document.getElementById('financialPaymentEditor')?.close(); return; }
      if (action === 'financial-cancel') { await S.update('financialEntries', id, { status: 'cancelled' }); renderAll(); return; }
      if (action === 'financial-restore') { await S.update('financialEntries', id, { status: 'open' }); renderAll(); return; }
      switch (action) {
        case 'delete-product':
          if (confirm('Excluir produto? As movimentações antigas ficam no histórico com item removido.')) await deleteRecord('products', id);
          break;
        case 'adjust-stock':
          await adjustStock(id);
          break;
        case 'delete-client': await deleteRecord('clients', id); break;
        case 'delete-supplier': await deleteRecord('suppliers', id); break;
        case 'remove-purchase-draft':
          purchaseDraft = purchaseDraft.filter((item) => String(item.productId) !== String(id));
          break;
        case 'delete-recipe': await deleteRecord('recipes', id); break;
        case 'delete-order':
          if (!S.isAdmin()) throw new Error('Somente o administrador pode excluir pedidos.');
          await deleteRecord('orders', id);
          break;
        case 'delete-task': await deleteRecord('tasks', id); break;
        case 'delete-consignment':
          if (confirm('Excluir consignação? Isso não desfaz estoque automaticamente. Use apenas para correção manual/revisão.')) await deleteRecord('consignments', id);
          break;
        case 'consign-sell':
          await consignmentSell(id);
          break;
        case 'consign-return':
          await consignmentReturn(id);
          break;
        case 'consign-pay':
          await consignmentPay(id);
          break;
        case 'toggle-returns':
          openReturnsSaleId = openReturnsSaleId === id ? null : id;
          break;
        default:
          return;
      }
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  }

  async function consignmentSell(id) {
    const item = state().consignments.find((record) => record.id === id);
    if (!item) throw new Error('Consignação não encontrada.');
    const product = productById(item.productId);
    if (!product) throw new Error('Produto da consignação não encontrado.');
    const available = Calc.consignmentAvailableWithClient(item);
    const qtyText = prompt(`Quantidade vendida pelo cliente? Disponível com cliente: ${U.qty(available, product?.unit)}`);
    if (qtyText === null) return;
    const quantity = U.number(qtyText);
    U.assertPositive(quantity, 'Quantidade vendida');
    if (quantity > available) throw new Error('Quantidade maior que o disponível com o cliente.');
    await addSale({
      date: U.today(),
      channel: 'Consignado',
      clientId: item.clientId,
      productId: item.productId,
      quantity,
      unitPrice: item.unitPrice,
      discount: 0,
      fixedFees: 0,
      feePercent: 0,
      notes: `Venda informada na consignação ${item.id}`,
    }, { skipStockMovement: true, skipStockCheck: true, unitCostOverride: item.costAtSend, origin: 'consignado', originId: item.id });
    await S.update('consignments', item.id, { quantitySold: U.number(item.quantitySold) + quantity });
    await S.add('consignmentEvents', { consignmentId: item.id, type: 'venda_cliente', date: U.today(), quantity, amount: quantity * U.number(item.unitPrice) });
  }

  async function consignmentReturn(id) {
    const item = state().consignments.find((record) => record.id === id);
    if (!item) throw new Error('Consignação não encontrada.');
    const product = productById(item.productId);
    if (!product) throw new Error('Produto da consignação não encontrado.');
    const available = Calc.consignmentAvailableWithClient(item);
    const qtyText = prompt(`Quantidade devolvida? Disponível com cliente: ${U.qty(available, product?.unit)}`);
    if (qtyText === null) return;
    const quantity = U.number(qtyText);
    U.assertPositive(quantity, 'Quantidade devolvida');
    if (quantity > available) throw new Error('Quantidade maior que o disponível com o cliente.');
    await S.update('products', product.id, { currentStock: U.number(product.currentStock) + quantity });
    await S.update('consignments', item.id, { quantityReturned: U.number(item.quantityReturned) + quantity });
    await S.recordMovement({
      date: U.today(),
      type: 'entrada_devolucao_consignado',
      productId: product.id,
      quantity,
      unitCost: U.number(item.costAtSend),
      totalCost: quantity * U.number(item.costAtSend),
      notes: `Devolução consignado ${item.id}`,
    });
    await S.add('consignmentEvents', { consignmentId: item.id, type: 'devolucao', date: U.today(), quantity, amount: 0 });
  }

  async function consignmentPay(id) {
    const item = state().consignments.find((record) => record.id === id);
    if (!item) throw new Error('Consignação não encontrada.');
    const open = Calc.consignmentOpenAmount(item);
    if (open <= 0) throw new Error('Não há valor em aberto nesta consignação.');
    const amountText = prompt(`Valor pago pelo cliente? Em aberto: ${U.money(open)}`);
    if (amountText === null) return;
    const amount = U.number(amountText);
    U.assertPositive(amount, 'Valor pago');
    if (amount > open) throw new Error('Valor pago maior que o valor em aberto.');
    await S.update('consignments', item.id, { amountPaid: U.number(item.amountPaid) + amount });
    await S.add('consignmentEvents', { consignmentId: item.id, type: 'pagamento', date: U.today(), quantity: 0, amount });
  }

  // Correção de contagem/perda fora dos fluxos normais (compra, produção,
  // venda, consignado): sempre gera stockMovements com type 'ajuste_manual'
  // e motivo obrigatório, nunca muda o estoque em silêncio (ver CLAUDE.md,
  // regra "Estoque nunca deve ser alterado sem movimentação").
  async function adjustStock(productId) {
    const product = productById(productId);
    if (!product) throw new Error('Produto não encontrado.');
    const newQtyText = prompt(`Novo estoque de "${product.name}"? Atual: ${U.qty(product.currentStock, product.unit)}`);
    if (newQtyText === null) return;
    const newQty = U.number(newQtyText);
    if (newQty < 0) throw new Error('Estoque não pode ficar negativo.');
    const diff = newQty - U.number(product.currentStock);
    if (diff === 0) return;
    const reason = prompt('Motivo do ajuste (obrigatório):');
    if (!reason || !reason.trim()) throw new Error('Informe o motivo do ajuste.');
    const unitCost = U.number(product.avgCost);
    await S.update('products', product.id, { currentStock: newQty });
    await S.recordMovement({
      date: U.today(),
      type: 'ajuste_manual',
      productId: product.id,
      quantity: diff,
      unitCost,
      totalCost: diff * unitCost,
      notes: reason.trim(),
    });
  }

  function handleCostPreview(event) {
    const form = event.target.closest('#costPreviewForm');
    if (!form) return;
    event.preventDefault();
    const data = U.formData(form);
    const el = document.getElementById('costPreview');
    if (!el || !data.finalProductId) return;
    el.innerHTML = renderCostPreview(Calc.calculateRecipeCost(data.finalProductId, state()));
  }

  function handleKanbanDragStart(event) {
    const card = event.target.closest('.kanban-card');
    if (!card) return;
    const board = event.target.closest('[data-kanban-type]');
    draggedCard = { id: card.dataset.cardId, type: board.dataset.kanbanType };
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleKanbanDragOver(event) {
    const column = event.target.closest('.kanban-column');
    if (!column) return;
    event.preventDefault();
    column.classList.add('drag-over');
  }

  function handleKanbanDragLeave(event) {
    const column = event.target.closest('.kanban-column');
    if (column) column.classList.remove('drag-over');
  }

  async function handleKanbanDrop(event) {
    const column = event.target.closest('.kanban-column');
    if (!column || !draggedCard) return;
    event.preventDefault();
    column.classList.remove('drag-over');
    const collection = draggedCard.type === 'orders' ? 'orders' : 'tasks';
    const cardId = draggedCard.id;
    draggedCard = null;
    // So admin altera status de pedido - a coluna ja nao e arrastavel para
    // vendedor (readOnly em UI.kanban), isto e so defesa extra; o banco
    // tambem bloqueia via trigger.
    if (collection === 'orders' && !S.isAdmin()) return;
    try {
      await S.update(collection, cardId, { status: column.dataset.status });
    } catch (error) {
      alert(error.message);
    }
    renderAll();
  }

  // Alternativa ao arrastar-e-soltar (arrastar com o dedo não dispara os
  // eventos HTML5 de drag-and-drop): select "mover para" em cada cartão,
  // ver UI.kanban() em src/ui.js.
  async function handleKanbanMove(event) {
    const select = event.target.closest('[data-kanban-move]');
    if (!select) return;
    const board = select.closest('[data-kanban-type]');
    if (!board) return;
    const collection = board.dataset.kanbanType === 'orders' ? 'orders' : 'tasks';
    if (collection === 'orders' && !S.isAdmin()) return;
    const cardId = select.dataset.cardId;
    try {
      await S.update(collection, cardId, { status: select.value });
    } catch (error) {
      alert(error.message);
    }
    renderAll();
  }

  // ---------- Ajuda contextual (balão do ícone "ⓘ") ----------
  let tipEl = null;
  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'help-tip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    const tip = ensureTip();
    tip.textContent = text;
    tip.classList.add('show');
    const margin = 10;
    const r = target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tr.width - margin));
    let top = r.top - tr.height - 8;
    if (top < margin) top = r.bottom + 8; // sem espaço acima: mostra abaixo
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }
  function hideTip() {
    if (tipEl) tipEl.classList.remove('show');
  }
  function bindHelpTips() {
    document.addEventListener('mouseover', (event) => {
      const target = event.target.closest('[data-tip]');
      if (target) showTip(target);
    });
    document.addEventListener('mouseout', (event) => {
      if (event.target.closest('[data-tip]')) hideTip();
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target.closest('[data-tip]');
      if (target) showTip(target);
    });
    document.addEventListener('focusout', hideTip);
    // Toque fora do ícone fecha o balão no celular.
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-tip]')) hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
  }

  // Sugestão/piso de preço no formulário de venda (vendedor): ao escolher o
  // produto, prefixa o preço unitário com C360.calc.resolveSellerPrice(...) e
  // mostra o piso efetivo. Não bloqueia digitação livre — a validação real
  // acontece em validateSaleFloor() no submit (ver submitSale).
  function updateSalePriceHint(form) {
    const hint = form.querySelector('#salePriceHint');
    if (!hint) return;
    const user = S.getCurrentUser();
    const productId = form.elements.productId ? form.elements.productId.value : '';
    const product = productId ? productById(productId) : null;
    if (!product || !user || user.role !== 'vendedor' || !Calc.resolveSellerPrice) {
      hint.innerHTML = '';
      return;
    }
    const sellerPrice = sellerPriceForProduct(productId);
    const resolved = Calc.resolveSellerPrice({ product, sellerPrice });
    const unitPriceInput = form.elements.unitPrice;
    if (unitPriceInput && !unitPriceInput.dataset.touched && resolved.price > 0) {
      unitPriceInput.value = resolved.price;
    }
    const floorText = resolved.floor === null || resolved.floor === undefined
      ? 'sem piso mínimo definido'
      : `mínimo permitido: ${U.money(resolved.floor)}`;
    hint.innerHTML = UI.formNotice(`Preço sugerido: ${U.money(resolved.price)} · ${floorText}`, 'info');
  }

  function handleSalePriceHint(event) {
    const form = event.target.closest('#saleForm');
    if (!form) return;
    if (event.target.name === 'productId') updateSalePriceHint(form);
    if (event.target.name === 'unitPrice') event.target.dataset.touched = '1';
  }

  function bindEvents() {
    bindHelpTips();
    els.tabs.forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    document.querySelectorAll('.bottom-nav-item[data-tab], .more-menu-item[data-tab]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-more-menu-open]')) openMoreMenu();
      if (event.target.closest('[data-more-menu-close]')) closeMoreMenu();
    });
    document.addEventListener('click', handleQuickAction);
    els.activeBusiness.addEventListener('change', (event) => { S.setActiveBusiness(event.target.value); renderAll(); });
    els.btnExport.addEventListener('click', () => window.C360.io.exportXlsx());
    els.btnDataTab.addEventListener('click', () => setTab('dados'));
    if (els.btnHelp) els.btnHelp.addEventListener('click', () => setTab('ajuda'));
    els.btnReset.addEventListener('click', () => {
      if (confirm('Zerar todos os dados locais deste navegador? Faça um backup antes.')) {
        S.reset();
        renderAll();
        toast('Dados locais zerados.', 'success');
      }
    });
    if (els.btnLogout) {
      els.btnLogout.addEventListener('click', async () => {
        if (!confirm('Sair da sua conta?')) return;
        try {
          if (window.C360.auth && typeof window.C360.auth.signOut === 'function') {
            await window.C360.auth.signOut();
          }
        } catch (error) {
          console.error('C360.app: erro ao sair', error);
        }
        showLogin();
      });
    }
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('click', handleClick);
    document.addEventListener('click', handleDataActions);
    document.addEventListener('change', handleFileInputs);
    document.addEventListener('change', handleSalePriceHint);
    document.addEventListener('change', handleDashboardPeriod);
    document.addEventListener('change', handleDashboardFilter);
    document.addEventListener('submit', handleCostPreview, true);
    document.addEventListener('dragstart', handleKanbanDragStart);
    document.addEventListener('dragover', handleKanbanDragOver);
    document.addEventListener('dragleave', handleKanbanDragLeave);
    document.addEventListener('drop', handleKanbanDrop);
    document.addEventListener('change', handleKanbanMove);
  }

  function handleDashboardPeriod(event) {
    const input = event.target.closest('[data-dashboard-date]');
    if (!input) return;
    if (input.dataset.dashboardDate === 'start') dashboardStart = input.value || '';
    if (input.dataset.dashboardDate === 'end') dashboardEnd = input.value || '';
    renderDashboard();
  }

  function handleDashboardFilter(event) {
    const select = event.target.closest('[data-dashboard-filter]');
    if (!select) return;
    if (select.dataset.dashboardFilter === 'seller') dashboardSellerId = select.value || '';
    if (select.dataset.dashboardFilter === 'channel') dashboardChannel = select.value || '';
    renderDashboard();
  }

  function handleDataActions(event) {
    const trigger = event.target.closest('[data-io]');
    if (!trigger) return;
    const action = trigger.dataset.io;
    const io = window.C360.io;
    if (action === 'export-xlsx') io.exportXlsx();
    else if (action === 'export-json') io.exportJson();
    else if (action === 'export-csv') io.exportCsv(trigger.dataset.collection);
  }

  function handleFileInputs(event) {
    const input = event.target.closest('[data-io-import]');
    if (!input || !input.files || !input.files[0]) return;
    const kind = input.dataset.ioImport;
    const file = input.files[0];
    if (kind === 'xlsx') window.C360.io.importXlsx(file);
    else if (kind === 'json') window.C360.io.importJson(file);
    input.value = '';
  }

  function toast(message, type = '') {
    if (!els.toastHost) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastHost.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 250);
    }, 3200);
  }

  // addSale é exposto para src/salesCart.js materializar a venda "propria"
  // quando o admin move um pedido da esteira para "Despachado" (mesma baixa de
  // estoque central, movimento saida_venda, CMV e lucro do lançamento manual).
  window.C360.app = { refresh: renderAll, toast, setTab, addSale, openSellerCockpit };

  // ---------------------------------------------------------------------
  // Bootstrap com portão de autenticação (src/auth.js): a tela de login é
  // mostrada enquanto não houver sessão válida; o dashboard/abas só montam
  // depois que C360.auth confirma o perfil (via restoreSession() ou o
  // onSuccess do formulário de login). `bindEvents()` é chamado só uma vez,
  // na primeira entrada — logout/login de novo não rebinda os listeners
  // globais (eles não dependem de sessão para existir, só a renderização
  // muda com applyRoleVisibility()).
  // ---------------------------------------------------------------------
  let eventsBound = false;

  function showAppShell() {
    if (els.authRoot) els.authRoot.innerHTML = '';
    if (els.appShell) els.appShell.hidden = false;
    if (els.headerActions) els.headerActions.hidden = false;
    if (els.bottomNav) els.bottomNav.hidden = false;
  }

  function showLogin() {
    if (els.appShell) els.appShell.hidden = true;
    if (els.headerActions) els.headerActions.hidden = true;
    if (els.bottomNav) els.bottomNav.hidden = true;
    closeMoreMenu();
    if (els.authRoot && window.C360.auth) {
      els.authRoot.innerHTML = window.C360.auth.render();
      window.C360.auth.mount(els.authRoot, { onSuccess: boot });
    }
  }

  function boot() {
    showAppShell();
    activeTab = firstAllowedTab();
    if (!eventsBound) {
      bindEvents();
      eventsBound = true;
    }
    applyRoleVisibility();
    if (window.C360.calculator && typeof window.C360.calculator.mountFloating === 'function') {
      window.C360.calculator.mountFloating();
    }
    renderAll();
  }

  function publicCartToken() {
    try {
      return new URLSearchParams(window.location.search).get('cart') || '';
    } catch (error) {
      return '';
    }
  }

  async function init() {
    const token = publicCartToken();
    if (token && window.C360.salesCart && typeof window.C360.salesCart.mountPublic === 'function') {
      if (els.appShell) els.appShell.hidden = true;
      if (els.headerActions) els.headerActions.hidden = true;
      if (els.bottomNav) els.bottomNav.hidden = true;
      closeMoreMenu();
      window.C360.salesCart.mountPublic(els.authRoot || document.body, token);
      return;
    }

    let authenticated = false;
    try {
      if (window.C360.auth && typeof window.C360.auth.restoreSession === 'function') {
        authenticated = await window.C360.auth.restoreSession();
      }
    } catch (error) {
      console.error('C360.app: erro ao restaurar sessao', error);
    }
    if (authenticated) {
      boot();
    } else {
      showLogin();
    }
  }

  init();
})();






