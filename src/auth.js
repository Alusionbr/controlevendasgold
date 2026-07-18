(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Autenticação (login/logout/sessão) + tela de gestão de vendedores (admin).
  //
  // Depende de window.C360.api e window.C360.state, implementados em paralelo
  // por outro agente (ver docs/backend.md). Os métodos são acessados de forma
  // preguiçosa (api()/state() abaixo) em vez de capturados no topo do arquivo,
  // porque a ordem de carregamento dos <script> entre auth.js/api.js/state.js
  // é responsabilidade do integrador — não presumimos qual carrega primeiro.
  //
  // API consumida (contrato, ver docs/backend.md):
  //   C360.api.signInWithPassword(email, password) -> {accessToken, refreshToken, expiresAt, user}
  //   C360.api.refreshSession(refreshToken)         -> {accessToken, refreshToken, expiresAt, user}
  //   C360.api.signOut(accessToken)                 -> void
  //   C360.api.getAuthUser(accessToken)              -> {id, email}
  //   C360.api.getProfile(userId)                    -> {id, role, name, businessId, active}
  //   C360.api.createSeller({email, password, name}) -> {id, email, name, role, businessId}
  //   C360.api.listSellers()                         -> Array<{id, name, active}>
  //   (opcional, usado só se existir) C360.api.update('profiles', id, patch)
  //
  //   C360.state.getState() / C360.state.refresh() / C360.state.getCurrentUser()
  //   C360.state.isAdmin() / (opcional) C360.state.update('profiles', id, patch)
  //   (opcional) C360.state.reset()
  //
  // Premissa assumida (não coberta explicitamente pelo contrato): os métodos
  // de domínio do C360.api que não recebem accessToken como parâmetro (ex.:
  // listSellers, createSeller) presumem que o próprio C360.api guarda
  // internamente o token da sessão ativa a partir das chamadas a
  // signInWithPassword/refreshSession. Este módulo não expõe o token para
  // fora de si mesmo além de passá-lo explicitamente nas chamadas que o
  // contrato define com esse parâmetro (getAuthUser, signOut). Se essa
  // premissa estiver errada, o integrador precisa adicionar uma ponte entre
  // auth.js e api.js para compartilhar o token atual.
  // ==========================================================================

  const STORAGE_KEY = 'controle360_session_v1';

  // ---------------------------------------------------------------------
  // Acesso preguiçoso aos módulos vizinhos
  // ---------------------------------------------------------------------
  function api() {
    return window.C360.api || null;
  }

  function state() {
    return window.C360.state || null;
  }

  // ---------------------------------------------------------------------
  // Armazenamento da sessão (accessToken / refreshToken / expiresAt)
  // ---------------------------------------------------------------------
  function persistSession(session) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      }));
    } catch (error) {
      console.error('C360.auth: erro ao salvar sessão local.', error);
    }
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.refreshToken) return null;
      return parsed;
    } catch (error) {
      console.error('C360.auth: erro ao ler sessão local.', error);
      return null;
    }
  }

  function clearStoredSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('C360.auth: erro ao limpar sessão local.', error);
    }
  }

  // ---------------------------------------------------------------------
  // Perfil + validação de conta ativa
  // ---------------------------------------------------------------------
  async function fetchProfile(accessToken) {
    const authUser = await api().getAuthUser(accessToken);
    if (!authUser || !authUser.id) throw new Error('Não foi possível identificar o usuário logado.');
    return api().getProfile(authUser.id);
  }

  async function safeSignOutToken(accessToken) {
    try {
      await api().signOut(accessToken);
    } catch (error) {
      console.error('C360.auth: erro ao encerrar sessão desativada no servidor.', error);
    }
  }

  // ---------------------------------------------------------------------
  // Mapeamento de erros -> mensagens amigáveis em PT-BR
  // ---------------------------------------------------------------------
  function mapSignInError(error) {
    const message = String((error && error.message) || '').trim();
    const lower = message.toLowerCase();
    if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
      return 'E-mail ou senha inválidos.';
    }
    if (lower.includes('email not confirmed')) {
      return 'Confirme seu e-mail antes de entrar.';
    }
    if (error && error.status === 429) {
      return 'Muitas tentativas. Aguarde um instante e tente novamente.';
    }
    if (message) return message;
    return 'Não foi possível entrar. Verifique sua conexão e tente novamente.';
  }

  function mapCreateSellerError(error) {
    const status = error && error.status;
    const message = String((error && error.message) || '').trim();
    const lower = message.toLowerCase();

    if (status === 403 || lower.includes('permiss')) {
      return 'Você não tem permissão para criar vendedores.';
    }
    if (status === 409 || lower.includes('já está em uso') || lower.includes('already') || lower.includes('duplicate')) {
      return 'Este e-mail já está em uso.';
    }
    if (status === 401) {
      return 'Sua sessão expirou. Faça login novamente.';
    }
    if (status === 400) {
      return message || 'Dados inválidos. Verifique nome, e-mail e senha (mínimo 6 caracteres).';
    }
    if (status === 500) {
      return message || 'Erro interno do servidor. Tente novamente em instantes.';
    }
    return message || 'Não foi possível criar o vendedor. Tente novamente.';
  }

  // ---------------------------------------------------------------------
  // API pública: signIn / signOut / restoreSession
  // ---------------------------------------------------------------------
  async function signIn(email, password) {
    const trimmedEmail = String(email || '').trim();
    const pwd = String(password || '');
    if (!trimmedEmail || !pwd) {
      return { ok: false, error: 'Informe e-mail e senha.' };
    }
    if (!api() || typeof api().signInWithPassword !== 'function') {
      return { ok: false, error: 'Serviço de autenticação indisponível no momento.' };
    }

    let session;
    try {
      session = await api().signInWithPassword(trimmedEmail, pwd);
    } catch (error) {
      return { ok: false, error: mapSignInError(error) };
    }

    persistSession(session);

    try {
      const profile = await fetchProfile(session.accessToken);
      if (!profile || profile.active === false) {
        await safeSignOutToken(session.accessToken);
        clearStoredSession();
        return { ok: false, error: 'Sua conta foi desativada. Fale com o administrador.' };
      }
    } catch (error) {
      clearStoredSession();
      console.error('C360.auth: erro ao carregar perfil após login.', error);
      return { ok: false, error: 'Login feito, mas não foi possível carregar seu perfil. Tente novamente.' };
    }

    try {
      if (state() && typeof state().refresh === 'function') {
        await state().refresh();
      }
    } catch (error) {
      // Sessão e perfil são válidos; não bloqueamos o login por uma falha ao
      // atualizar o cache de dados — o usuário pode tentar recarregar depois.
      console.error('C360.auth: erro ao atualizar estado após login.', error);
    }

    return { ok: true };
  }

  async function signOut() {
    const stored = readStoredSession();
    if (stored && stored.accessToken && api() && typeof api().signOut === 'function') {
      try {
        await api().signOut(stored.accessToken);
      } catch (error) {
        console.error('C360.auth: erro ao encerrar sessão no servidor.', error);
      }
    }
    clearStoredSession();
    if (state() && typeof state().reset === 'function') {
      try {
        state().reset();
      } catch (error) {
        console.error('C360.auth: erro ao limpar estado local.', error);
      }
    }
  }

  async function restoreSession() {
    const stored = readStoredSession();
    if (!stored || !stored.refreshToken) return false;
    if (!api() || typeof api().refreshSession !== 'function') return false;

    let session;
    try {
      session = await api().refreshSession(stored.refreshToken);
    } catch (error) {
      clearStoredSession();
      return false;
    }

    persistSession(session);

    try {
      const profile = await fetchProfile(session.accessToken);
      if (!profile || profile.active === false) {
        clearStoredSession();
        return false;
      }
    } catch (error) {
      clearStoredSession();
      return false;
    }

    try {
      if (state() && typeof state().refresh === 'function') {
        await state().refresh();
      }
    } catch (error) {
      console.error('C360.auth: erro ao atualizar estado ao restaurar sessão.', error);
    }

    return true;
  }

  function getCurrentUser() {
    return (state() && typeof state().getCurrentUser === 'function') ? state().getCurrentUser() : null;
  }

  function isAdmin() {
    return !!(state() && typeof state().isAdmin === 'function' && state().isAdmin());
  }

  // ---------------------------------------------------------------------
  // Tela de login (também serve como gate "não autenticado")
  // Classes novas: .auth-screen, .auth-title, .auth-subtitle (ver relatório).
  // Demais classes são reaproveitadas de styles/main.css (.grid-form,
  // .notice/.notice.error, botão padrão).
  // ---------------------------------------------------------------------
  function render() {
    return `
      <div class="auth-screen">
        <h1 class="auth-title">Controle360</h1>
        <p class="auth-subtitle">Entre com seu e-mail e senha para continuar.</p>
        <div id="authError"></div>
        <form id="authLoginForm" class="grid-form" novalidate>
          <label class="full">E-mail
            <input type="email" name="email" required autocomplete="username" inputmode="email" placeholder="voce@exemplo.com">
          </label>
          <label class="full">Senha
            <input type="password" name="password" required autocomplete="current-password" placeholder="Sua senha">
          </label>
          <button type="submit">Entrar</button>
        </form>
      </div>
    `;
  }

  function mount(container, options = {}) {
    if (!container) return;
    const onSuccess = (options && typeof options.onSuccess === 'function') ? options.onSuccess : function () {};

    function errorHost() {
      return container.querySelector('#authError');
    }

    function showError(message) {
      const host = errorHost();
      if (host) host.innerHTML = UI.formNotice(message, 'error');
    }

    function clearError() {
      const host = errorHost();
      if (host) host.innerHTML = '';
    }

    async function handleSubmit(event) {
      const form = event.target.closest('#authLoginForm');
      if (!form || !container.contains(form)) return;
      event.preventDefault();
      clearError();

      const data = U.formData(form);
      const email = (data.email || '').trim();
      const password = data.password || '';
      if (!email || !password) {
        showError('Informe e-mail e senha.');
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const originalLabel = submitButton ? submitButton.textContent : '';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Entrando...';
      }

      try {
        const result = await signIn(email, password);
        if (result.ok) {
          onSuccess();
        } else {
          showError(result.error || 'Não foi possível entrar.');
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalLabel;
        }
      }
    }

    container.addEventListener('submit', handleSubmit);
  }

  // ---------------------------------------------------------------------
  // Tela de gestão de vendedores (admin) — painel consolidado: cada vendedor
  // vira um card expansível ("Gerenciar") com saldo/pagamento, estoque e
  // envio de consignado ali mesmo, sem trocar de aba. Reaproveita a lógica
  // já existente em C360.sellerLedger (saldo/pagamento) e C360.salesCart
  // (envio de consignado com débito no ledger) em vez de duplicá-la.
  // ---------------------------------------------------------------------
  function fullState() {
    return (window.C360.state && window.C360.state.getState()) || {};
  }

  function ledger() { return window.C360.sellerLedger || null; }

  function stockRowsForSeller(sellerId) {
    const st = fullState();
    return (st.sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0)
      .map((row) => {
        const product = (st.products || []).find((item) => String(item.id) === String(row.productId));
        return [
          product ? U.escapeHtml(product.name) : 'Produto removido',
          U.qty(row.quantity, product ? product.unit : ''),
        ];
      });
  }

  // Opções de produto para o form de devolução/desperdício/brinde — só o que
  // o vendedor tem de fato em mãos (mesma fonte de stockRowsForSeller).
  function sellerStockOptions(sellerId) {
    const st = fullState();
    return (st.sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0)
      .map((row) => {
        const product = (st.products || []).find((item) => String(item.id) === String(row.productId));
        return product ? { id: product.id, name: `${product.name} (${U.qty(row.quantity, product.unit)} com o vendedor)`, avgCost: product.avgCost } : null;
      })
      .filter(Boolean);
  }

  function productOptionsForConsignment() {
    return (fullState().products || []).filter((product) => product.type !== 'servico');
  }

  function sellerManagePanel(seller, feedback) {
    const L = ledger();
    const balance = L ? L.balanceFor(seller.id) : 0;
    const entries = L ? L.entriesForSeller(seller.id).slice(0, 5) : [];
    const stockRows = stockRowsForSeller(seller.id);
    const products = productOptionsForConsignment();
    const heldProducts = sellerStockOptions(seller.id);

    return `
      <div class="seller-manage-panel" data-seller-manage="${U.escapeHtml(seller.id)}">
        ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}
        <div class="seller-manage-grid">
          ${UI.metric(balance > 0 ? 'Deve ao admin' : 'Situação', balance > 0 ? U.money(balance) : 'Em dia', null)}
        </div>

        <h3>Estoque atual do vendedor</h3>
        ${UI.table(['Produto', 'Quantidade'], stockRows, 'Nenhum estoque com este vendedor.')}

        <details class="seller-manage-section">
          <summary>Enviar estoque consignado</summary>
          <p class="ss-hint">Baixa do estoque central, credita o estoque do vendedor e gera dívida no valor enviado (${UI.help('consignado')}).</p>
          <form class="grid-form compact-form" data-consign-form data-seller-id="${U.escapeHtml(seller.id)}">
            <label>Produto
              <select name="productId" required>${UI.optionList(products, '', products.length ? 'Selecione o produto' : 'Nenhum produto cadastrado')}</select>
            </label>
            <label>Quantidade
              <input name="quantity" type="number" step="0.001" min="0.001" required>
            </label>
            <label>Preço unitário (dívida)
              <input name="unitPrice" type="number" step="0.01" min="0" required>
            </label>
            <button type="submit" class="small">Enviar consignado</button>
          </form>
        </details>

        <details class="seller-manage-section">
          <summary>Registrar pagamento</summary>
          <form class="grid-form compact-form" data-ledger-payment-form data-seller-id="${U.escapeHtml(seller.id)}">
            <label>Valor recebido
              <input name="amount" type="number" step="0.01" min="0.01" required>
            </label>
            <label>Forma
              <input name="method" placeholder="Pix, dinheiro...">
            </label>
            <label class="wide">Observação
              <input name="notes" placeholder="Opcional">
            </label>
            <button type="submit" class="small">Registrar pagamento</button>
          </form>
        </details>

        <details class="seller-manage-section">
          <summary>Devolver, desperdício ou brinde</summary>
          <p class="ss-hint">Tira do estoque do vendedor. "Devolução" volta pro estoque central; desperdício/brinde não voltam.</p>
          <form class="grid-form compact-form" data-return-form data-seller-id="${U.escapeHtml(seller.id)}">
            <label>Tipo
              <select name="type">
                <option value="return">Devolução ao estoque central</option>
                <option value="waste">Desperdício</option>
                <option value="gift">Brinde</option>
              </select>
            </label>
            <label>Produto
              <select name="productId" required>${UI.optionList(heldProducts, '', heldProducts.length ? 'Selecione o produto' : 'Nenhum estoque com este vendedor')}</select>
            </label>
            <label>Quantidade
              <input name="quantity" type="number" step="0.001" min="0.001" required>
            </label>
            <label data-return-credit-field>Valor unitário (para o crédito)
              <input name="unitValue" type="number" step="0.01" min="0">
            </label>
            <label class="wide" data-return-credit-field><input type="checkbox" name="affectsFinance" checked> Abater da dívida do vendedor</label>
            <label class="wide">Motivo
              <input name="reason" required placeholder="Ex.: cliente desistiu, caiu no chão, amostra para cliente">
            </label>
            <button type="submit" class="small">Registrar</button>
          </form>
        </details>

        <details class="seller-manage-section" data-adjust-details>
          <summary>Ajuste manual / correção</summary>
          <p class="ss-hint">Cria um novo lançamento (nunca edita um antigo) — use para corrigir valor errado ou perdoar/ajustar dívida.</p>
          <form class="grid-form compact-form" data-adjust-form data-seller-id="${U.escapeHtml(seller.id)}">
            <label>Valor
              <input name="amount" type="number" step="0.01" min="0.01" required>
            </label>
            <label>Direção
              <select name="direction">
                <option value="debit">Aumentar dívida</option>
                <option value="credit">Reduzir dívida</option>
              </select>
            </label>
            <label class="wide">Motivo
              <input name="notes" required placeholder="Ex.: correção do lançamento de 10/07, valor lançado errado">
            </label>
            <button type="submit" class="small">Lançar ajuste</button>
          </form>
        </details>

        <h3>Histórico de lançamentos</h3>
        ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor', ''], entries.map((entry) => {
          const label = ({
            debit_replenishment: 'Reposição', payment: 'Pagamento', return_credit: 'Devolução',
            manual_adjustment: 'Ajuste manual', writeoff: 'Baixa de dívida', bonus_credit: 'Bonificação',
          })[entry.type] || entry.type;
          const signed = entry.direction === 'credit' ? -U.number(entry.amount) : U.number(entry.amount);
          const oppositeDirection = entry.direction === 'credit' ? 'debit' : 'credit';
          const correctNotes = `Correção do lançamento de ${(entry.createdAt || '').slice(0, 10)} (${label})`;
          return [
            (entry.createdAt || '').slice(0, 10),
            U.escapeHtml(label),
            UI.badge(entry.direction === 'credit' ? 'Crédito' : 'Débito', entry.direction === 'credit' ? 'ok' : ''),
            U.escapeHtml(entry.notes || ''),
            `<strong>${signed < 0 ? '- ' : ''}${U.money(Math.abs(signed))}</strong>`,
            `<button type="button" class="small secondary" data-action="prefill-correction"
              data-amount="${U.escapeHtml(entry.amount)}" data-direction="${oppositeDirection}"
              data-notes="${U.escapeHtml(correctNotes)}">Corrigir</button>`,
          ];
        }), 'Nenhum lançamento ainda.')}
      </div>
    `;
  }

  function sellerRow(seller, expandedId, feedback) {
    const isActive = seller.active !== false;
    const statusBadge = isActive ? UI.badge('Ativo', 'ok') : UI.badge('Inativo', 'warn');
    const toggleAction = isActive ? 'deactivate-seller' : 'activate-seller';
    const toggleLabel = isActive ? 'Desativar' : 'Reativar';
    const toggleClass = isActive ? 'danger' : 'secondary';
    const isExpanded = String(expandedId) === String(seller.id);
    const L = ledger();
    const balance = L ? L.balanceFor(seller.id) : 0;

    return `
      <article class="panel-card seller-manage-card" data-seller-card="${U.escapeHtml(seller.id)}">
        <div class="approval-card-head">
          <strong>${U.escapeHtml(seller.name || '—')}</strong>
          ${statusBadge}
        </div>
        <p class="ss-approval-detail">${U.escapeHtml(seller.email || '—')}${balance > 0 ? ` · ${UI.badge(`Deve ${U.money(balance)}`, 'danger')}` : ''}</p>
        <div class="actions">
          <button type="button" class="small" data-action="toggle-manage" data-id="${U.escapeHtml(seller.id)}">${isExpanded ? 'Fechar' : 'Gerenciar'}</button>
          ${UI.actionButton(toggleAction, seller.id, toggleLabel, toggleClass)}
        </div>
        ${isExpanded ? sellerManagePanel(seller, feedback) : ''}
      </article>
    `;
  }

  function renderSellers(data = {}) {
    const sellers = Array.isArray(data.sellers) ? data.sellers : [];
    const loading = !!data.loading;
    const listHtml = loading
      ? UI.formNotice('Carregando vendedores...', 'info')
      : (sellers.length
        ? `<div class="seller-ledger-grid">${sellers.map((seller) => sellerRow(seller, data.expandedId, data.manageFeedback)).join('')}</div>`
        : '<div class="empty-state"><strong>Nenhum vendedor cadastrado ainda.</strong><span>Crie um vendedor abaixo.</span></div>');

    const L = ledger();
    const totalOpen = !loading && L
      ? sellers.filter((seller) => seller.active !== false).reduce((sum, seller) => sum + Math.max(L.balanceFor(seller.id), 0), 0)
      : 0;

    return UI.section(
      'Vendedores',
      'Crie contas de vendedores e gerencie tudo pelo painel: acesso, estoque consignado, saldo e pendências.',
      `
        ${!loading ? UI.metric('Total em aberto (todos os vendedores)', U.money(totalOpen), null) : ''}
        <div id="authSellersError"></div>
        <form id="authCreateSellerForm" class="grid-form">
          <label class="full">Nome
            <input name="name" required placeholder="Nome do vendedor">
          </label>
          <label>E-mail
            <input type="email" name="email" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="vendedor@exemplo.com">
          </label>
          <label>Senha provisória
            <input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
          </label>
          <button type="submit">Criar vendedor</button>
        </form>
        ${listHtml}
      `
    );
  }

  function mountSellers(container) {
    if (!container) return null;

    let sellers = [];
    let loading = true;
    let expandedId = null;
    let manageFeedback = null;

    function paint() {
      container.innerHTML = renderSellers({ sellers, loading, expandedId, manageFeedback });
    }

    function errorHost() {
      return container.querySelector('#authSellersError');
    }

    function showError(message) {
      const host = errorHost();
      if (host) host.innerHTML = UI.formNotice(message, 'error');
    }

    function clearError() {
      const host = errorHost();
      if (host) host.innerHTML = '';
    }

    async function loadSellers() {
      loading = true;
      paint();
      let list = [];
      let loadError = '';
      try {
        if (!api() || typeof api().listSellers !== 'function') {
          throw new Error('Serviço de vendedores indisponível no momento.');
        }
        const result = await api().listSellers();
        list = Array.isArray(result) ? result : [];
      } catch (error) {
        loadError = (error && error.message) || 'Não foi possível carregar os vendedores.';
      }
      sellers = list;
      loading = false;
      paint();
      if (loadError) showError(loadError);
    }

    container.addEventListener('submit', async (event) => {
      const createForm = event.target.closest('#authCreateSellerForm');
      const consignForm = event.target.closest('[data-consign-form]');
      const paymentForm = event.target.closest('[data-ledger-payment-form]');
      const returnForm = event.target.closest('[data-return-form]');
      const adjustForm = event.target.closest('[data-adjust-form]');

      if (createForm && container.contains(createForm)) {
        event.preventDefault();
        clearError();

        const data = U.formData(createForm);
        const name = (data.name || '').trim();
        const email = (data.email || '').trim();
        const password = data.password || '';

        if (!name) { showError('Informe o nome do vendedor.'); return; }
        if (!email) { showError('Informe o e-mail do vendedor.'); return; }
        if (password.length < 6) { showError('A senha provisória precisa ter ao menos 6 caracteres.'); return; }

        const submitButton = createForm.querySelector('button[type="submit"]');
        const originalLabel = submitButton ? submitButton.textContent : '';
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = 'Criando...';
        }

        try {
          if (!api() || typeof api().createSeller !== 'function') {
            throw new Error('Serviço de vendedores indisponível no momento.');
          }
          const created = await api().createSeller({ email, password, name });
          createForm.reset();
          await loadSellers();
          // Confirmação explícita do e-mail que ficou gravado: o navegador pode
          // ter alterado o que foi digitado (autopreenchimento/sugestão de
          // domínio), então mostramos de volta o valor que o servidor realmente
          // salvou, não o que o admin digitou.
          alert(`Vendedor criado. Login: ${(created && created.email) || email} / senha provisória informada.`);
        } catch (error) {
          showError(mapCreateSellerError(error));
        } finally {
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
          }
        }
        return;
      }

      if (consignForm && container.contains(consignForm)) {
        event.preventDefault();
        const sellerId = consignForm.dataset.sellerId;
        const data = U.formData(consignForm);
        const submitButton = consignForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        try {
          if (!window.C360.salesCart || typeof window.C360.salesCart.sendConsignmentToSeller !== 'function') {
            throw new Error('Envio de consignado indisponível no momento.');
          }
          await window.C360.salesCart.sendConsignmentToSeller({
            sellerId,
            productId: data.productId,
            quantity: data.quantity,
            unitPrice: data.unitPrice,
          });
          manageFeedback = { message: 'Consignado enviado. Estoque baixado e dívida lançada no saldo do vendedor.', type: 'success' };
        } catch (error) {
          manageFeedback = { message: (error && error.message) || 'Não foi possível enviar o consignado.', type: 'danger' };
        }
        paint();
        return;
      }

      if (paymentForm && container.contains(paymentForm)) {
        event.preventDefault();
        const sellerId = paymentForm.dataset.sellerId;
        const data = U.formData(paymentForm);
        try {
          const L = ledger();
          if (!L || typeof L.registerPayment !== 'function') throw new Error('Registro de pagamento indisponível no momento.');
          await L.registerPayment(sellerId, { amount: data.amount, method: data.method, notes: data.notes });
          manageFeedback = { message: 'Pagamento registrado.', type: 'success' };
        } catch (error) {
          manageFeedback = { message: (error && error.message) || 'Não foi possível registrar o pagamento.', type: 'danger' };
        }
        paint();
        return;
      }

      if (returnForm && container.contains(returnForm)) {
        event.preventDefault();
        const sellerId = returnForm.dataset.sellerId;
        const data = U.formData(returnForm);
        try {
          const OM = window.C360.operationalMovements;
          if (!OM || typeof OM.adminRecordMovement !== 'function') throw new Error('Registro de devolução indisponível no momento.');
          await OM.adminRecordMovement({
            sellerId,
            productId: data.productId,
            type: data.type,
            quantity: data.quantity,
            unitValue: data.unitValue,
            affectsFinance: !!data.affectsFinance,
            reason: data.reason,
          });
          manageFeedback = { message: 'Movimentação registrada e aplicada.', type: 'success' };
        } catch (error) {
          manageFeedback = { message: (error && error.message) || 'Não foi possível registrar a movimentação.', type: 'danger' };
        }
        paint();
        return;
      }

      if (adjustForm && container.contains(adjustForm)) {
        event.preventDefault();
        const sellerId = adjustForm.dataset.sellerId;
        const data = U.formData(adjustForm);
        try {
          const L = ledger();
          if (!L || typeof L.registerAdjustment !== 'function') throw new Error('Ajuste manual indisponível no momento.');
          await L.registerAdjustment(sellerId, { amount: data.amount, direction: data.direction, notes: data.notes });
          manageFeedback = { message: 'Ajuste lançado.', type: 'success' };
        } catch (error) {
          manageFeedback = { message: (error && error.message) || 'Não foi possível lançar o ajuste.', type: 'danger' };
        }
        paint();
      }
    });

    container.addEventListener('change', (event) => {
      const select = event.target.closest('[data-return-form] select[name="type"]');
      if (!select) return;
      const form = select.closest('[data-return-form]');
      const isReturn = select.value === 'return';
      // .grid-form label tem display:flex (mais específico que [hidden]),
      // então o toggle precisa ser via style inline, não o atributo hidden.
      form.querySelectorAll('[data-return-credit-field]').forEach((field) => {
        field.style.display = isReturn ? '' : 'none';
      });
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const { action, id } = button.dataset;

      if (action === 'toggle-manage') {
        expandedId = String(expandedId) === String(id) ? null : id;
        manageFeedback = null;
        paint();
        return;
      }

      if (action === 'prefill-correction') {
        const panel = button.closest('.seller-manage-panel');
        const details = panel?.querySelector('[data-adjust-details]');
        const form = panel?.querySelector('[data-adjust-form]');
        if (form) {
          if (details) details.open = true;
          form.querySelector('[name="amount"]').value = button.dataset.amount || '';
          form.querySelector('[name="direction"]').value = button.dataset.direction || 'debit';
          form.querySelector('[name="notes"]').value = button.dataset.notes || '';
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          form.querySelector('[name="notes"]').focus();
        }
        return;
      }

      if (action !== 'deactivate-seller' && action !== 'activate-seller') return;

      const nextActive = action === 'activate-seller';
      if (action === 'deactivate-seller'
        && !confirm('Desativar este vendedor? Os dados dele são mantidos, só o acesso é bloqueado.')) {
        return;
      }

      clearError();
      button.disabled = true;
      try {
        if (state() && typeof state().update === 'function') {
          await state().update('profiles', id, { active: nextActive });
        } else if (api() && typeof api().update === 'function') {
          await api().update('profiles', id, { active: nextActive });
        } else {
          throw new Error('Não foi possível atualizar o status do vendedor: nenhuma API disponível.');
        }
        await loadSellers();
      } catch (error) {
        showError((error && error.message) || 'Não foi possível atualizar o status do vendedor.');
        button.disabled = false;
      }
    });

    paint();
    loadSellers();

    return { refresh: loadSellers };
  }

  window.C360.auth = {
    signIn,
    signOut,
    restoreSession,
    getCurrentUser,
    isAdmin,
    render,
    mount,
    renderSellers,
    mountSellers,
  };
})();
