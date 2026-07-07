(function () {
  'use strict';

  window.C360 = window.C360 || {};

  // ==========================================================================
  // C360.api â€” camada fina de acesso Ã  Supabase (Auth + PostgREST + Edge
  // Function), vanilla JS/fetch. Ver docs/backend.md para o contrato completo
  // (tabelas, RLS, trigger de piso de preÃ§o, trigger de aprovaÃ§Ã£o, edge
  // function create-seller).
  //
  // ConvenÃ§Ã£o camelCase <-> snake_case (ver relatÃ³rio do agente para detalhes
  // completos):
  //   - list/insert/update/remove (genÃ©ricos) fazem PASSTHROUGH em
  //     snake_case: o payload enviado e a linha recebida usam os nomes de
  //     coluna reais do banco. EXCEÃ‡ÃƒO: as CHAVES do objeto `query` de list()
  //     sÃ£o normalizadas de camelCase para snake_case antes de virar filtro
  //     PostgREST (ex.: `{ businessId: x }` vira `business_id=eq.x`), porque
  //     src/pricing.js jÃ¡ foi escrito chamando
  //     `C360.api.list('profiles', { role: 'vendedor', businessId })`.
  //   - Os helpers de domÃ­nio nomeados (getProfile, createSeller, listSellers,
  //     listSellerProducts, listSellerPrices, setSellerPrice, listSellerStock,
  //     setSellerStock) fazem mapeamento camelCase <-> snake_case completo
  //     (payload de entrada e linha de saÃ­da), porque Ã© assim que
  //     src/auth.js e src/pricing.js os consomem.
  //   - EXCEÃ‡ÃƒO dentro dos helpers nomeados: listSalesGoals, listGoalsProgress,
  //     createSalesGoal, updateSalesGoal, deleteSalesGoal ficam em snake_case
  //     puro (payload e linha), porque src/goals.js (jÃ¡ escrito) lÃª/grava
  //     `period_type`, `period_start`, `target_amount`, `reward_description`,
  //     `achieved_amount`, `progress_pct`, `is_achieved` etc. diretamente.
  // ==========================================================================

  const SUPABASE_URL = 'https://zcwnfrhtlhjfprsjktlx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpjd25mcmh0bGhqZnByc2prdGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDMyMDIsImV4cCI6MjA5ODg3OTIwMn0.jeOJBNGWXUY9HUU7WTEpGpD98Dqdtv-fcL-iBK0M5eM';

  // ---------------------------------------------------------------------
  // SessÃ£o (mantida em memÃ³ria; src/auth.js Ã© quem persiste tokens em
  // localStorage e chama signInWithPassword/refreshSession para repovoar
  // este mÃ³dulo apÃ³s reload).
  // ---------------------------------------------------------------------
  const session = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    userId: null,
  };

  // ---------------------------------------------------------------------
  // camelCase <-> snake_case
  // ---------------------------------------------------------------------
  function camelToSnakeKey(key) {
    return String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  function snakeToCamelKey(key) {
    return String(key).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
  }

  function mapKeys(obj, keyFn) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      result[keyFn(key)] = value;
    });
    return result;
  }

  // ---------------------------------------------------------------------
  // Erros: sempre Error com .status; mensagem = campo de erro do PostgREST/
  // GoTrue/Edge Function quando existir.
  // ---------------------------------------------------------------------
  async function parseBodySafe(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }

  function messageFromBody(body, status) {
    if (body && typeof body === 'object') {
      if (body.message) return body.message;
      if (body.error_description) return body.error_description;
      if (body.error) return body.error;
      if (body.msg) return body.msg;
    }
    if (typeof body === 'string' && body.trim()) return body;
    return `Erro ${status} ao comunicar com o servidor.`;
  }

  function buildError(body, status) {
    const error = new Error(messageFromBody(body, status));
    error.status = status;
    error.body = body;
    return error;
  }

  // ---------------------------------------------------------------------
  // Fetch helpers
  // ---------------------------------------------------------------------
  function baseHeaders(extra = {}) {
    const headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...extra };
    if (session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    return headers;
  }

  async function tryRefreshOnce() {
    if (!session.refreshToken) return false;
    try {
      await refreshSession(session.refreshToken);
      return true;
    } catch (error) {
      return false;
    }
  }

  // requisiÃ§Ã£o autenticada a PostgREST (rest/v1/...). Em 401, tenta renovar a
  // sessÃ£o UMA vez com o refresh_token guardado e repete a chamada original.
  async function restRequest(path, { method = 'GET', headers = {}, body, allowRetry = true } = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: baseHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && allowRetry) {
      const refreshed = await tryRefreshOnce();
      if (refreshed) {
        return restRequest(path, { method, headers, body, allowRetry: false });
      }
    }

    if (!res.ok) {
      const parsedBody = await parseBodySafe(res);
      throw buildError(parsedBody, res.status);
    }

    if (res.status === 204) return null;
    return parseBodySafe(res);
  }

  // ---------------------------------------------------------------------
  // Query string para list(): eq simples por coluna + `_order`/`_select`
  // reservados. Chaves camelCase sÃ£o convertidas para snake_case (ver nota
  // de reconciliaÃ§Ã£o no topo do arquivo).
  // ---------------------------------------------------------------------
  function buildQueryString(query = {}) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === '_order') {
        params.set('order', value);
        return;
      }
      if (key === '_select') {
        params.set('select', value);
        return;
      }
      params.set(camelToSnakeKey(key), `eq.${value}`);
    });
    return params.toString();
  }

  // ---------------------------------------------------------------------
  // CRUD genÃ©rico (passthrough snake_case)
  // ---------------------------------------------------------------------
  async function list(table, query = {}) {
    const qs = buildQueryString(query);
    const rows = await restRequest(`/rest/v1/${table}${qs ? `?${qs}` : ''}`, { method: 'GET' });
    return Array.isArray(rows) ? rows : [];
  }

  async function insert(table, payload) {
    const result = await restRequest(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: payload,
    });
    return Array.isArray(result) ? result[0] : result;
  }

  // Nota: PostgREST devolve 200/204 com corpo vazio quando o RLS filtra a
  // linha (id existe, mas a policy nÃ£o libera) â€” nÃ£o Ã© um erro HTTP, entÃ£o
  // sem checar o resultado o chamador acharia que a operaÃ§Ã£o funcionou. Os
  // dois `throw` abaixo transformam esse "sucesso vazio" num erro real.
  async function update(table, id, patch) {
    const result = await restRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: patch,
    });
    if (Array.isArray(result) && result.length === 0) {
      throw buildError('Nenhum registro atualizado (sem permissÃ£o ou registro nÃ£o encontrado).', 403);
    }
    return Array.isArray(result) ? result[0] : result;
  }

  async function remove(table, id) {
    const result = await restRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (Array.isArray(result) && result.length === 0) {
      throw buildError('Nenhum registro excluÃ­do (sem permissÃ£o ou registro nÃ£o encontrado).', 403);
    }
  }

  // Upsert por (seller_id, product_id) â€” usado por setSellerPrice/setSellerStock.
  async function upsert(table, payload, conflictColumns) {
    const result = await restRequest(`/rest/v1/${table}?on_conflict=${conflictColumns}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: payload,
    });
    return Array.isArray(result) ? result[0] : result;
  }

  // ---------------------------------------------------------------------
  // Auth (GoTrue)
  // ---------------------------------------------------------------------
  async function authPost(path, body, extraHeaders = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...extraHeaders },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return parsed;
  }

  function applySession(raw) {
    session.accessToken = raw.access_token || null;
    session.refreshToken = raw.refresh_token || null;
    session.expiresAt = raw.expires_at != null ? raw.expires_at : null;
    session.userId = raw.user && raw.user.id ? raw.user.id : null;
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: raw.user ? { id: raw.user.id, email: raw.user.email } : null,
    };
  }

  async function signInWithPassword(email, password) {
    const raw = await authPost('/auth/v1/token?grant_type=password', { email, password });
    return applySession(raw);
  }

  async function refreshSession(refreshToken) {
    const raw = await authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
    return applySession(raw);
  }

  async function signOut(accessToken) {
    const token = accessToken || session.accessToken;
    try {
      if (token) {
        await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      session.accessToken = null;
      session.refreshToken = null;
      session.expiresAt = null;
      session.userId = null;
    }
  }

  async function getAuthUser(accessToken) {
    const token = accessToken || session.accessToken;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || ''}` },
    });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return { id: parsed.id, email: parsed.email };
  }

  // Convenience â€” nÃ£o faz parte do contrato original, mas Ã© necessÃ¡ria para
  // que src/state.js saiba QUEM Ã© o usuÃ¡rio logado sem que api.js precise
  // vazar o access_token para fora de si mesmo (ver comentÃ¡rio em src/auth.js
  // sobre essa premissa). Ver relatÃ³rio do agente.
  function getCurrentAuthUserId() {
    return session.userId;
  }

  async function currentBusinessId() {
    if (!session.userId) return null;
    const profile = await getProfile(session.userId);
    return profile ? profile.businessId : null;
  }

  // ---------------------------------------------------------------------
  // profiles / seller management
  // ---------------------------------------------------------------------
  async function getProfile(userId) {
    const rows = await list('profiles', { id: userId });
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      businessId: row.business_id,
      active: row.active,
    };
  }

  async function createSeller({ email, password, name }) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-seller`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken || ''}`,
      },
      body: JSON.stringify({ email, password, name }),
    });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      businessId: parsed.business_id,
    };
  }

  // `profiles.email` Ã© preenchido pela Edge Function create-seller no momento
  // do cadastro (migraÃ§Ã£o 0006) â€” cÃ³pia do e-mail real gravado em auth.users,
  // que nÃ£o Ã© exposto via PostgREST para anon/authenticated.
  async function listSellers() {
    const rows = await list('profiles', { role: 'vendedor', _order: 'name.asc' });
    return rows.map((row) => ({ id: row.id, name: row.name, active: row.active, email: row.email || null }));
  }

  // ---------------------------------------------------------------------
  // Produtos (view seller_products para vendedor / tabela products p/ admin
  // jÃ¡ Ã© acessada via list('products', ...) genÃ©rico pelo state.js; este
  // helper nomeado serve o catÃ¡logo do vendedor com mapeamento camelCase).
  // ---------------------------------------------------------------------
  function mapProductRow(row) {
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      type: row.type,
      unit: row.unit,
      currentStock: row.current_stock,
      salePrice: row.sale_price,
      defaultPrice: row.default_price,
      priceFloor: row.price_floor,
      minStock: row.min_stock,
      notes: row.notes,
      avgCost: row.avg_cost,
      laborCostPerUnit: row.labor_cost_per_unit,
      overheadCostPerUnit: row.overhead_cost_per_unit,
      lossPercent: row.loss_percent,
      targetMarginPercent: row.target_margin_percent,
      taxFeePercent: row.tax_fee_percent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async function listSellerProducts(businessId) {
    const rows = await list('seller_products', { business_id: businessId, _order: 'name.asc' });
    return rows.map(mapProductRow);
  }

  // ---------------------------------------------------------------------
  // seller_prices / seller_stock (camelCase in/out, upsert por par Ãºnico)
  // ---------------------------------------------------------------------
  async function listSellerPrices(sellerId) {
    const rows = await list('seller_prices', { seller_id: sellerId });
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      productId: row.product_id,
      price: row.price,
      floor: row.floor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async function setSellerPrice({ sellerId, productId, price, floor }) {
    const businessId = await currentBusinessId();
    const payload = {
      business_id: businessId,
      seller_id: sellerId,
      product_id: productId,
      price: price === undefined ? null : price,
      floor: floor === undefined ? null : floor,
    };
    const row = await upsert('seller_prices', payload, 'seller_id,product_id');
    if (!row) return null;
    return {
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      productId: row.product_id,
      price: row.price,
      floor: row.floor,
    };
  }

  async function listSellerStock(sellerId) {
    const rows = await list('seller_stock', { seller_id: sellerId });
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      productId: row.product_id,
      quantity: row.quantity,
    }));
  }

  async function setSellerStock({ sellerId, productId, quantity }) {
    const businessId = await currentBusinessId();
    const payload = {
      business_id: businessId,
      seller_id: sellerId,
      product_id: productId,
      quantity: quantity === undefined ? 0 : quantity,
    };
    const row = await upsert('seller_stock', payload, 'seller_id,product_id');
    if (!row) return null;
    return {
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      productId: row.product_id,
      quantity: row.quantity,
    };
  }


  // ---------------------------------------------------------------------
  // Carrinhos de venda, permissoes do vendedor e link publico
  // ---------------------------------------------------------------------
  async function listSellerSettings(params = {}) {
    const query = {};
    if (params.sellerId) query.seller_id = params.sellerId;
    else {
      const businessId = await currentBusinessId();
      if (businessId) query.business_id = businessId;
    }
    const rows = await list('seller_settings', query);
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      allowAdminStockSales: row.allow_admin_stock_sales,
      allowConsignment: row.allow_consignment,
      allowPublicCartLinks: row.allow_public_cart_links,
      maxDiscountPercent: row.max_discount_percent,
      notes: row.notes,
    }));
  }

  async function setSellerSettings({ sellerId, allowAdminStockSales, allowConsignment, allowPublicCartLinks, maxDiscountPercent, notes }) {
    const businessId = await currentBusinessId();
    const payload = {
      business_id: businessId,
      seller_id: sellerId,
      allow_admin_stock_sales: !!allowAdminStockSales,
      allow_consignment: !!allowConsignment,
      allow_public_cart_links: allowPublicCartLinks !== false,
      max_discount_percent: maxDiscountPercent === undefined ? 0 : maxDiscountPercent,
      notes: notes || null,
    };
    const row = await upsert('seller_settings', payload, 'seller_id');
    if (!row) return null;
    return {
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      allowAdminStockSales: row.allow_admin_stock_sales,
      allowConsignment: row.allow_consignment,
      allowPublicCartLinks: row.allow_public_cart_links,
      maxDiscountPercent: row.max_discount_percent,
      notes: row.notes,
    };
  }

  async function listSaleCarts(query = {}) {
    const rows = await list('sale_carts', { _order: 'created_at.desc', ...query });
    return rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      sellerId: row.seller_id,
      clientId: row.client_id,
      source: row.source,
      paymentMode: row.payment_mode,
      status: row.status,
      channel: row.channel,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerNotes: row.customer_notes,
      publicToken: row.public_token,
      publicExpiresAt: row.public_expires_at,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      paymentProofPath: row.payment_proof_path,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async function listSaleCartItems(query = {}) {
    const rows = await list('sale_cart_items', query);
    return rows.map((row) => ({
      id: row.id,
      cartId: row.cart_id,
      businessId: row.business_id,
      productId: row.product_id,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      approvedQuantity: row.approved_quantity,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async function publicCartLookup(token) {
    const qs = new URLSearchParams({ token });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/public-cart?${qs.toString()}`, {
      method: 'GET',
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return parsed;
  }

  async function publicCartSubmit(token, formData) {
    const qs = new URLSearchParams({ token });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/public-cart?${qs.toString()}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY },
      body: formData,
    });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return parsed;
  }

  // ---------------------------------------------------------------------
  // Metas de vendas â€” snake_case puro (ver nota de reconciliaÃ§Ã£o no topo:
  // src/goals.js jÃ¡ foi escrito lendo/gravando os nomes de coluna crus).
  // ---------------------------------------------------------------------
  async function listSalesGoals(params = {}) {
    const query = { _order: 'period_start.desc' };
    if (params.sellerId) {
      query.seller_id = params.sellerId;
    } else {
      const businessId = await currentBusinessId();
      if (businessId) query.business_id = businessId;
    }
    return list('sales_goals', query);
  }

  async function listGoalsProgress(params = {}) {
    const query = {};
    if (params.sellerId) {
      query.seller_id = params.sellerId;
    } else {
      const businessId = await currentBusinessId();
      if (businessId) query.business_id = businessId;
    }
    return list('sales_goals_progress', query);
  }

  async function createSalesGoal(payload) {
    const businessId = await currentBusinessId();
    return insert('sales_goals', { business_id: businessId, ...payload });
  }

  async function updateSalesGoal(id, patch) {
    return update('sales_goals', id, patch);
  }

  async function deleteSalesGoal(id) {
    return remove('sales_goals', id);
  }

  // ---------------------------------------------------------------------
  // AprovaÃ§Ã£o de pedidos (admin only â€” RLS/trigger barram vendedor)
  // ---------------------------------------------------------------------
  async function approveOrder(id) {
    return update('orders', id, { approval_status: 'aprovado' });
  }

  async function rejectOrder(id) {
    return update('orders', id, { approval_status: 'rejeitado' });
  }

  window.C360.api = {
    list,
    insert,
    update,
    remove,

    signInWithPassword,
    refreshSession,
    signOut,
    getAuthUser,
    getProfile,
    createSeller,

    listSellers,
    listSellerProducts,
    listSellerPrices,
    setSellerPrice,
    listSellerStock,
    setSellerStock,
    consumeSellerStock,
    listSellerSettings,
    setSellerSettings,
    listSaleCarts,
    listSaleCartItems,
    publicCartLookup,
    publicCartSubmit,
    listSalesGoals,
    listGoalsProgress,
    createSalesGoal,
    updateSalesGoal,
    deleteSalesGoal,
    approveOrder,
    rejectOrder,

    // Extra (fora do contrato literal, necessÃ¡ria para state.js â€” ver relatÃ³rio).
    getCurrentAuthUserId,
  };
})();


