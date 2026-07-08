(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const { uid, nowIso } = window.C360.utils;

  // ==========================================================================
  // C360.state — cache em memória alimentado por C360.api (Supabase), com
  // espelho em localStorage só para pintura instantânea no reload (a rede é
  // sempre a fonte de verdade assim que `refresh()` resolve).
  //
  // MIGRAÇÃO IMPORTANTE para quem integra com src/app.js: `add`, `addGlobal`,
  // `update` e `remove` agora são ASSÍNCRONOS (retornam Promise). Todo
  // call-site em app.js que hoje faz `const rec = C360.state.add(...)` de
  // forma síncrona precisa virar `async function renderX/addX() { ... const
  // rec = await C360.state.add(...); ... }`, e todo handler de formulário
  // (`form.addEventListener('submit', ...)`) precisa ser `async`. Ver
  // relatório do agente para a lista completa de pontos identificados em
  // src/app.js.
  //
  // Chaves do cache (getState()): igual ao shape antigo (schemaVersion 2)
  // MAIS: sellerPrices, sellerStock, salesGoals, goalsProgress, profile
  // (perfil do usuário logado, singular), profiles (array — todos os perfis
  // visíveis ao usuário atual: para admin, todo mundo do negócio; para
  // vendedor, só a própria linha) e sellers (alias de profiles filtrado por
  // role === 'vendedor' — src/sellerStock.js lê `getState().profiles`
  // diretamente, então os dois nomes precisam existir).
  // ==========================================================================

  const CACHE_KEY = 'controle360_cache_v1'; // novo espelho pós-refresh (fonte: rede)
  const LEGACY_STORAGE_KEY = 'controle360_multi_v2'; // formato antigo (100% localStorage, pré multi-usuário)

  const DEFAULT_SETTINGS = {
    productTypes: [
      { value: 'materia_prima', label: 'Matéria-prima' },
      { value: 'embalagem', label: 'Embalagem / vidro / rótulo / caixa' },
      { value: 'produto_final', label: 'Produto final produzido' },
      { value: 'mercadoria', label: 'Mercadoria comprada pronta' },
      { value: 'kit', label: 'Kit / composição' },
      { value: 'servico', label: 'Serviço sem estoque físico' },
    ],
    units: ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'm', 'cm'],
    businessSegments: [
      'Essências aromáticas',
      'Alimentos / marmitas',
      'Revenda de mercadorias',
      'Consignado',
      'Serviços com materiais',
      'Outro',
    ],
    channels: ['Direto', 'WhatsApp', 'Instagram', 'Site', 'Marketplace', 'Consignado', 'Outro'],
    orderStatuses: [
      { value: 'pendente', label: 'Pendente' },
      { value: 'em_preparo', label: 'Em preparo' },
      { value: 'pronto', label: 'Pronto' },
      { value: 'despachado', label: 'Despachado' },
      { value: 'concluido', label: 'Concluído' },
    ],
    taskStatuses: [
      { value: 'a_fazer', label: 'A fazer' },
      { value: 'fazendo', label: 'Fazendo' },
      { value: 'aguardando', label: 'Aguardando' },
      { value: 'feito', label: 'Feito' },
    ],
  };

  function emptyState() {
    return {
      meta: {
        schemaVersion: 2,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      activeBusinessId: null,
      settings: structuredClone(DEFAULT_SETTINGS),
      businesses: [],
      products: [],
      clients: [],
      suppliers: [],
      purchases: [],
      stockMovements: [],
      recipes: [],
      productions: [],
      sales: [],
      orders: [],
      consignments: [],
      consignmentEvents: [],
      tasks: [],
      // Novo (multi-usuário):
      sellerPrices: [],
      sellerStock: [],
      salesGoals: [],
      goalsProgress: [],
      sellerSettings: [],
      saleCarts: [],
      saleCartItems: [],
      // Fase 3 (conta corrente do vendedor):
      sellerAccountEntries: [],
      sellerPayments: [],
      // Fase 4 (devolução com status, desperdício, brinde):
      operationalMovements: [],
      profile: null,
      profiles: [],
      sellers: [],
    };
  }

  function normalize(raw) {
    const base = emptyState();
    const state = { ...base, ...(raw || {}) };
    state.meta = { ...base.meta, ...(state.meta || {}) };
    state.settings = { ...base.settings, ...(state.settings || {}) };
    Object.keys(base).forEach((key) => {
      if (Array.isArray(base[key]) && !Array.isArray(state[key])) state[key] = [];
    });
    return state;
  }

  function load() {
    try {
      const stored = localStorage.getItem(CACHE_KEY);
      if (!stored) return emptyState();
      return normalize(JSON.parse(stored));
    } catch (error) {
      console.error('C360.state: erro ao carregar cache local.', error);
      return emptyState();
    }
  }

  let state = load();

  function getState() {
    return state;
  }

  function persistCacheMirror() {
    try {
      state.meta.updatedAt = nowIso();
      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('C360.state: erro ao salvar cache local.', error);
    }
  }

  // Mantido por compatibilidade de nome (ver instrução de manter toda a API
  // antiga funcionando); agora só persiste o espelho de cache, não é mais a
  // fonte de verdade.
  function save() {
    persistCacheMirror();
  }

  function replaceState(nextState) {
    state = normalize(nextState);
    persistCacheMirror();
  }

  function reset() {
    state = emptyState();
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      console.error('C360.state: erro ao limpar cache local.', error);
    }
  }

  function activeBusiness() {
    return state.businesses.find((business) => business.id === state.activeBusinessId) || null;
  }

  function ensureBusiness() {
    if (!state.activeBusinessId) {
      throw new Error('Cadastre ou selecione um negócio antes de lançar dados.');
    }
  }

  function byBusiness(collectionName) {
    const businessId = state.activeBusinessId;
    if (!businessId) return [];
    return (state[collectionName] || []).filter((item) => item.businessId === businessId);
  }

  function setActiveBusiness(id) {
    // Nota: no modelo multi-usuário cada perfil pertence a UM negócio só
    // (profiles.business_id), então isto deixa de escolher entre vários
    // negócios do mesmo usuário — vira essencialmente um no-op fora do valor
    // já vindo de profile.businessId. Mantido pela compatibilidade de API.
    state.activeBusinessId = id || null;
    persistCacheMirror();
  }

  function getCurrentUser() {
    return state.profile || null;
  }

  function isAdmin() {
    return !!(state.profile && state.profile.role === 'admin');
  }

  // ---------------------------------------------------------------------
  // camelCase <-> snake_case (independente do conversor de src/api.js — cada
  // arquivo só pode depender do que expõe publicamente, não de internals).
  // ---------------------------------------------------------------------
  function camelToSnakeKey(key) {
    return String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  function snakeToCamelKey(key) {
    return String(key).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
  }

  function toSnakeCasePayload(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      result[camelToSnakeKey(key)] = value;
    });
    return result;
  }

  function toCamelCaseRow(row) {
    if (!row || typeof row !== 'object') return row;
    const result = {};
    Object.entries(row).forEach(([key, value]) => {
      result[snakeToCamelKey(key)] = value;
    });
    return result;
  }

  // ---------------------------------------------------------------------
  // Nome de coleção local (camelCase, shape antigo do app) <-> nome de
  // tabela real no Postgres (snake_case). Chamadores que já passam o nome de
  // tabela snake_case diretamente (ex.: src/sellerStock.js chamando
  // `state.add('consignment_events', ...)`) continuam funcionando porque
  // tableFor() devolve a própria string quando ela não é uma chave conhecida
  // do mapa (ou seja, já assume que é o nome real da tabela).
  // ---------------------------------------------------------------------
  const TABLE_BY_COLLECTION = {
    businesses: 'businesses',
    products: 'products',
    clients: 'clients',
    suppliers: 'suppliers',
    purchases: 'purchases',
    stockMovements: 'stock_movements',
    recipes: 'recipes',
    productions: 'productions',
    sales: 'sales',
    orders: 'orders',
    consignments: 'consignments',
    consignmentEvents: 'consignment_events',
    tasks: 'tasks',
    sellerPrices: 'seller_prices',
    sellerStock: 'seller_stock',
    salesGoals: 'sales_goals',
    sellerSettings: 'seller_settings',
    saleCarts: 'sale_carts',
    saleCartItems: 'sale_cart_items',
    sellerAccountEntries: 'seller_account_entries',
    sellerPayments: 'seller_payments',
    operationalMovements: 'operational_movements',
    profiles: 'profiles',
  };

  function tableFor(collectionName) {
    return TABLE_BY_COLLECTION[collectionName] || collectionName;
  }

  // Acha a chave do cache (array) correspondente ao nome de coleção recebido,
  // aceitando tanto o nome "local" camelCase (ex.: 'stockMovements') quanto o
  // nome de tabela snake_case (ex.: 'stock_movements' / 'consignment_events').
  function cacheKeyFor(collectionName) {
    if (Array.isArray(state[collectionName])) return collectionName;
    const camel = snakeToCamelKey(collectionName);
    if (Array.isArray(state[camel])) return camel;
    return null;
  }

  // Coleções cujas linhas pertencem a um vendedor (seller_id NOT NULL/():
  // usado para auto-carimbar sellerId em add() quando quem está logado é
  // vendedor, do mesmo jeito que o add() síncrono antigo carimbava
  // businessId automaticamente.
  const SELLER_OWNED_COLLECTIONS = new Set(['clients', 'sales', 'orders', 'consignments', 'saleCarts', 'operationalMovements']);

  async function add(collectionName, payload) {
    ensureBusiness();
    const table = tableFor(collectionName);
    const stamped = { ...payload };
    if (stamped.businessId === undefined) stamped.businessId = state.activeBusinessId;
    const user = getCurrentUser();
    if (user && user.role === 'vendedor' && stamped.sellerId === undefined && SELLER_OWNED_COLLECTIONS.has(collectionName)) {
      stamped.sellerId = user.id;
    }
    const rawRow = await window.C360.api.insert(table, toSnakeCasePayload(stamped));
    const record = toCamelCaseRow(rawRow) || { id: uid(table), ...stamped };
    const cacheKey = cacheKeyFor(collectionName);
    if (cacheKey) state[cacheKey].push(record);
    persistCacheMirror();
    return record;
  }

  async function addGlobal(collectionName, payload) {
    const table = tableFor(collectionName);
    const rawRow = await window.C360.api.insert(table, toSnakeCasePayload(payload));
    const record = toCamelCaseRow(rawRow) || { id: uid(table), ...payload };
    const cacheKey = cacheKeyFor(collectionName);
    if (cacheKey) state[cacheKey].push(record);
    persistCacheMirror();
    return record;
  }

  async function update(collectionName, id, patch) {
    const table = tableFor(collectionName);
    const rawRow = await window.C360.api.update(table, id, toSnakeCasePayload(patch));
    const record = toCamelCaseRow(rawRow) || null;
    const cacheKey = cacheKeyFor(collectionName);
    if (cacheKey) {
      const list = state[cacheKey];
      const idx = list.findIndex((item) => item.id === id);
      const merged = record ? { ...(idx !== -1 ? list[idx] : {}), ...record } : { ...(idx !== -1 ? list[idx] : {}), ...patch, id };
      if (idx !== -1) list[idx] = merged;
      else list.push(merged);
    }
    if (state.profile && state.profile.id === id) {
      state.profile = { ...state.profile, ...(record || patch) };
    }
    persistCacheMirror();
    return record || { id, ...patch };
  }

  async function remove(collectionName, id) {
    const table = tableFor(collectionName);
    await window.C360.api.remove(table, id);
    const cacheKey = cacheKeyFor(collectionName);
    if (cacheKey) {
      const list = state[cacheKey];
      const idx = list.findIndex((item) => item.id === id);
      if (idx !== -1) list.splice(idx, 1);
    }
    persistCacheMirror();
  }

  // NOTA/gap de backend (ver relatório do agente): `stock_movements` está
  // descrito em docs/backend.md §6 como admin-only (única policy de RLS é
  // `stock_movements_all_admin`; não existe policy de INSERT para
  // vendedor). Se um vendedor chamar recordMovement() hoje, o PostgREST
  // devolve 401/permission denied — src/returns.js (recordDevolucao/
  // recordDesperdicio) depende deste método também para o fluxo do
  // vendedor, então esta é uma lacuna real a resolver no schema/RLS, não
  // algo que este arquivo possa contornar sozinho.
  async function recordMovement(payload) {
    ensureBusiness();
    const stamped = { ...payload };
    if (stamped.businessId === undefined) stamped.businessId = state.activeBusinessId;
    const rawRow = await window.C360.api.insert('stock_movements', toSnakeCasePayload(stamped));
    const record = toCamelCaseRow(rawRow) || { id: uid('mov'), ...stamped };
    state.stockMovements.push(record);
    persistCacheMirror();
    return record;
  }

  // ---------------------------------------------------------------------
  // refresh() — repovoa o cache a partir de C360.api, de acordo com o papel
  // do usuário logado.
  // ---------------------------------------------------------------------
  async function refreshAsAdmin(businessId) {
    const api = window.C360.api;
    const [
      businesses, products, clients, suppliers, purchases, stockMovements,
      recipes, productions, sales, orders, consignments, consignmentEvents, tasks,
      profiles, sellerPrices, sellerStock, sellerSettings, saleCarts, saleCartItems,
      sellerAccountEntries, sellerPayments, operationalMovements,
    ] = await Promise.all([
      api.list('businesses', { id: businessId }),
      api.list('products', { business_id: businessId, _order: 'name.asc' }),
      api.list('clients', { business_id: businessId }),
      api.list('suppliers', { business_id: businessId }),
      api.list('purchases', { business_id: businessId }),
      api.list('stock_movements', { business_id: businessId }),
      api.list('recipes', { business_id: businessId }),
      api.list('productions', { business_id: businessId }),
      api.list('sales', { business_id: businessId }),
      api.list('orders', { business_id: businessId }),
      api.list('consignments', { business_id: businessId }),
      api.list('consignment_events', { business_id: businessId }),
      api.list('tasks', { business_id: businessId }),
      api.list('profiles', { business_id: businessId }),
      api.list('seller_prices', { business_id: businessId }),
      api.list('seller_stock', { business_id: businessId }),
      api.list('seller_settings', { business_id: businessId }),
      api.list('sale_carts', { business_id: businessId, _order: 'created_at.desc' }),
      api.list('sale_cart_items', { business_id: businessId }),
      api.list('seller_account_entries', { business_id: businessId, _order: 'created_at.desc' }),
      api.list('seller_payments', { business_id: businessId, _order: 'created_at.desc' }),
      api.list('operational_movements', { business_id: businessId, _order: 'created_at.desc' }),
    ]);

    state.businesses = businesses.map(toCamelCaseRow);
    state.products = products.map(toCamelCaseRow);
    state.clients = clients.map(toCamelCaseRow);
    state.suppliers = suppliers.map(toCamelCaseRow);
    state.purchases = purchases.map(toCamelCaseRow);
    state.stockMovements = stockMovements.map(toCamelCaseRow);
    state.recipes = recipes.map(toCamelCaseRow);
    state.productions = productions.map(toCamelCaseRow);
    state.sales = sales.map(toCamelCaseRow);
    state.orders = orders.map(toCamelCaseRow);
    state.consignments = consignments.map(toCamelCaseRow);
    state.consignmentEvents = consignmentEvents.map(toCamelCaseRow);
    state.tasks = tasks.map(toCamelCaseRow);
    state.profiles = profiles.map(toCamelCaseRow);
    state.sellers = state.profiles.filter((profile) => profile.role === 'vendedor');
    state.sellerPrices = sellerPrices.map(toCamelCaseRow);
    state.sellerStock = sellerStock.map(toCamelCaseRow);
    state.sellerSettings = sellerSettings.map(toCamelCaseRow);
    state.saleCarts = saleCarts.map(toCamelCaseRow);
    state.saleCartItems = saleCartItems.map(toCamelCaseRow);
    state.sellerAccountEntries = sellerAccountEntries.map(toCamelCaseRow);
    state.sellerPayments = sellerPayments.map(toCamelCaseRow);
    state.operationalMovements = operationalMovements.map(toCamelCaseRow);

    const [salesGoals, goalsProgress] = await Promise.all([
      api.listSalesGoals(),
      api.listGoalsProgress(),
    ]);
    state.salesGoals = salesGoals;
    state.goalsProgress = goalsProgress;
  }

  async function refreshAsSeller(businessId, userId) {
    const api = window.C360.api;
    const [
      businesses, sellerProducts, clients, sales, orders, consignments,
      consignmentEvents, sellerPrices, sellerStock, sellerSettings, saleCarts, saleCartItems,
      sellerAccountEntries, sellerPayments, operationalMovements,
    ] = await Promise.all([
      api.list('businesses', { id: businessId }),
      api.listSellerProducts(businessId),
      api.list('clients', { seller_id: userId }),
      api.list('sales', { seller_id: userId }),
      api.list('orders', { seller_id: userId }),
      api.list('consignments', { seller_id: userId }),
      api.list('consignment_events', { business_id: businessId }),
      api.listSellerPrices(userId),
      api.listSellerStock(userId),
      api.listSellerSettings({ sellerId: userId }),
      api.listSaleCarts({ seller_id: userId }),
      api.listSaleCartItems({ business_id: businessId }),
      api.list('seller_account_entries', { seller_id: userId, _order: 'created_at.desc' }),
      api.list('seller_payments', { seller_id: userId, _order: 'created_at.desc' }),
      api.list('operational_movements', { seller_id: userId, _order: 'created_at.desc' }),
    ]);

    state.businesses = businesses.map(toCamelCaseRow);
    state.products = sellerProducts; // já camelCase (seller_products, sem custo)
    state.clients = clients.map(toCamelCaseRow);
    state.sales = sales.map(toCamelCaseRow);
    state.orders = orders.map(toCamelCaseRow);
    state.consignments = consignments.map(toCamelCaseRow);
    state.consignmentEvents = consignmentEvents.map(toCamelCaseRow);
    state.sellerPrices = sellerPrices;
    state.sellerStock = sellerStock;
    state.sellerSettings = sellerSettings;
    state.saleCarts = saleCarts;
    state.saleCartItems = saleCartItems;
    state.sellerAccountEntries = sellerAccountEntries.map(toCamelCaseRow);
    state.sellerPayments = sellerPayments.map(toCamelCaseRow);
    state.operationalMovements = operationalMovements.map(toCamelCaseRow);

    // Tabelas admin-only (RLS devolveria [] mesmo se chamássemos): evitamos
    // o round-trip de rede e já deixamos vazio.
    state.suppliers = [];
    state.purchases = [];
    state.stockMovements = [];
    state.recipes = [];
    state.productions = [];
    state.tasks = [];
    state.profiles = [];
    state.sellers = [];

    const [salesGoals, goalsProgress] = await Promise.all([
      api.listSalesGoals({ sellerId: userId }),
      api.listGoalsProgress({ sellerId: userId }),
    ]);
    state.salesGoals = salesGoals;
    state.goalsProgress = goalsProgress;
  }

  async function refresh() {
    const api = window.C360.api;
    if (!api || typeof api.getCurrentAuthUserId !== 'function') return;

    const userId = api.getCurrentAuthUserId();
    if (!userId) return; // não autenticado; getState() segue servindo o cache atual

    const profile = await api.getProfile(userId);
    if (!profile) return;

    state.profile = profile;
    state.activeBusinessId = profile.businessId || null;

    if (!profile.businessId) {
      // Perfil provisionado sem negócio ainda (bootstrap pendente) — nada
      // mais para buscar além do próprio perfil.
      persistCacheMirror();
      return;
    }

    if (profile.role === 'admin') {
      await refreshAsAdmin(profile.businessId);
    } else {
      await refreshAsSeller(profile.businessId, userId);
    }

    persistCacheMirror();
  }

  window.C360.state = {
    DEFAULT_SETTINGS,
    getState,
    save,
    replaceState,
    reset,
    activeBusiness,
    ensureBusiness,
    byBusiness,
    add,
    addGlobal,
    update,
    remove,
    setActiveBusiness,
    recordMovement,
    getCurrentUser,
    isAdmin,
    refresh,
  };
})();

