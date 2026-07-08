(function () {
  'use strict';

  window.C360 = window.C360 || {};

  // ==========================================================================
  // C360.api - camada fina de acesso a Supabase (Auth + PostgREST + Edge
  // Function), vanilla JS/fetch. Ver docs/backend.md para o contrato completo
  // (tabelas, RLS, trigger de piso de preco, trigger de aprovacao, edge
  // function create-seller).
  // ==========================================================================

  const SUPABASE_URL = 'https://zcwnfrhtlhjfprsjktlx.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpjd25mcmh0bGhqZnByc2prdGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMDMyMDIsImV4cCI6MjA5ODg3OTIwMn0.jeOJBNGWXUY9HUU7WTEpGpD98Dqdtv-fcL-iBK0M5eM';

  const session = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    userId: null,
  };

  function camelToSnakeKey(key) {
    return String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  function snakeToCamelKey(key) {
    return String(key).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
  }

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

  async function restRequest(path, { method = 'GET', headers = {}, body, allowRetry = true } = {}) {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: baseHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && allowRetry) {
      const refreshed = await tryRefreshOnce();
      if (refreshed) return restRequest(path, { method, headers, body, allowRetry: false });
    }

    if (!res.ok) {
      const parsedBody = await parseBodySafe(res);
      throw buildError(parsedBody, res.status);
    }

    if (res.status === 204) return null;
    return parseBodySafe(res);
  }

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

  async function update(table, id, patch) {
    const result = await restRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: patch,
    });
    if (Array.isArray(result) && result.length === 0) throw buildError('Nenhum registro atualizado (sem permissao ou registro nao encontrado).', 403);
    return Array.isArray(result) ? result[0] : result;
  }

  async function remove(table, id) {
    const result = await restRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (Array.isArray(result) && result.length === 0) throw buildError('Nenhum registro excluido (sem permissao ou registro nao encontrado).', 403);
  }

  async function upsert(table, payload, conflictColumns) {
    const result = await restRequest(`/rest/v1/${table}?on_conflict=${conflictColumns}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: payload,
    });
    return Array.isArray(result) ? result[0] : result;
  }

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

  function getCurrentAuthUserId() {
    return session.userId;
  }

  async function currentBusinessId() {
    if (!session.userId) return null;
    const profile = await getProfile(session.userId);
    return profile ? profile.businessId : null;
  }

  async function getProfile(userId) {
    const rows = await list('profiles', { id: userId });
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, role: row.role, name: row.name, businessId: row.business_id, active: row.active };
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
    return { id: parsed.id, email: parsed.email, name: parsed.name, role: parsed.role, businessId: parsed.business_id };
  }

  async function listSellers() {
    const rows = await list('profiles', { role: 'vendedor', _order: 'name.asc' });
    return rows.map((row) => ({ id: row.id, name: row.name, active: row.active, email: row.email || null }));
  }

  function mapProductRow(row) {
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      type: row.type,
      unit: row.unit,
      currentStock: row.current_stock,
      stockAvailable: row.stock_available,
      stockHidden: row.stock_hidden === true || row.current_stock === null,
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
    const payload = { business_id: businessId, seller_id: sellerId, product_id: productId, price: price === undefined ? null : price, floor: floor === undefined ? null : floor };
    const row = await upsert('seller_prices', payload, 'seller_id,product_id');
    if (!row) return null;
    return { id: row.id, businessId: row.business_id, sellerId: row.seller_id, productId: row.product_id, price: row.price, floor: row.floor };
  }

  async function listSellerStock(sellerId) {
    const rows = await list('seller_stock', { seller_id: sellerId });
    return rows.map((row) => ({ id: row.id, businessId: row.business_id, sellerId: row.seller_id, productId: row.product_id, quantity: row.quantity }));
  }

  async function setSellerStock({ sellerId, productId, quantity }) {
    const businessId = await currentBusinessId();
    const payload = { business_id: businessId, seller_id: sellerId, product_id: productId, quantity: quantity === undefined ? 0 : quantity };
    const row = await upsert('seller_stock', payload, 'seller_id,product_id');
    if (!row) return null;
    return { id: row.id, businessId: row.business_id, sellerId: row.seller_id, productId: row.product_id, quantity: row.quantity };
  }

  async function consumeSellerStock({ productId, quantity }) {
    const row = await restRequest('/rest/v1/rpc/consume_seller_stock', {
      method: 'POST',
      body: { p_product_id: productId, p_quantity: quantity },
    });
    if (!row) return null;
    return { id: row.id, businessId: row.business_id, sellerId: row.seller_id, productId: row.product_id, quantity: row.quantity };
  }

  // Acerto de estoque próprio do vendedor: só funciona se o admin liberou 1
  // crédito em seller_settings.stock_adjustment_credits (RPC consome esse
  // crédito e grava trilha de auditoria em seller_stock_adjustments).
  async function adjustOwnStock({ productId, newQuantity, reason }) {
    const row = await restRequest('/rest/v1/rpc/seller_adjust_own_stock', {
      method: 'POST',
      body: { p_product_id: productId, p_new_quantity: newQuantity, p_reason: reason },
    });
    if (!row) return null;
    return { id: row.id, businessId: row.business_id, sellerId: row.seller_id, productId: row.product_id, quantity: row.quantity };
  }

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
      stockAdjustmentCredits: row.stock_adjustment_credits,
      notes: row.notes,
    }));
  }

  async function setSellerSettings({ sellerId, allowAdminStockSales, allowConsignment, allowPublicCartLinks, maxDiscountPercent, stockAdjustmentCredits, notes }) {
    const businessId = await currentBusinessId();
    const payload = {
      business_id: businessId,
      seller_id: sellerId,
      allow_admin_stock_sales: !!allowAdminStockSales,
      allow_consignment: !!allowConsignment,
      allow_public_cart_links: allowPublicCartLinks !== false,
      max_discount_percent: maxDiscountPercent === undefined ? 0 : maxDiscountPercent,
      ...(stockAdjustmentCredits === undefined ? {} : { stock_adjustment_credits: stockAdjustmentCredits }),
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
      stockAdjustmentCredits: row.stock_adjustment_credits,
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
      paidInitialAmount: row.paid_initial_amount,
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
    const res = await fetch(`${SUPABASE_URL}/functions/v1/public-cart?${qs.toString()}`, { method: 'GET', headers: { apikey: SUPABASE_ANON_KEY } });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return parsed;
  }

  async function publicCartSubmit(token, formData) {
    const qs = new URLSearchParams({ token });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/public-cart?${qs.toString()}`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY }, body: formData });
    const parsed = await parseBodySafe(res);
    if (!res.ok) throw buildError(parsed, res.status);
    return parsed;
  }

  async function listSalesGoals(params = {}) {
    const query = { _order: 'period_start.desc' };
    if (params.sellerId) query.seller_id = params.sellerId;
    else {
      const businessId = await currentBusinessId();
      if (businessId) query.business_id = businessId;
    }
    return list('sales_goals', query);
  }

  async function listGoalsProgress(params = {}) {
    const query = {};
    if (params.sellerId) query.seller_id = params.sellerId;
    else {
      const businessId = await currentBusinessId();
      if (businessId) query.business_id = businessId;
    }
    return list('sales_goals_progress', query);
  }

  async function createSalesGoal(payload) {
    const businessId = await currentBusinessId();
    return insert('sales_goals', { business_id: businessId, ...payload });
  }

  async function updateSalesGoal(id, patch) { return update('sales_goals', id, patch); }
  async function deleteSalesGoal(id) { return remove('sales_goals', id); }
  async function approveOrder(id) { return update('orders', id, { approval_status: 'aprovado' }); }
  async function rejectOrder(id) { return update('orders', id, { approval_status: 'rejeitado' }); }

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
    adjustOwnStock,
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
    getCurrentAuthUserId,
  };
})();
