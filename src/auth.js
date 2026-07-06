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
  // Tela de gestão de vendedores (admin)
  // ---------------------------------------------------------------------
  function sellerRow(seller) {
    const isActive = seller.active !== false;
    const statusBadge = isActive ? UI.badge('Ativo', 'ok') : UI.badge('Inativo', 'warn');
    const toggleAction = isActive ? 'deactivate-seller' : 'activate-seller';
    const toggleLabel = isActive ? 'Desativar' : 'Reativar';
    const toggleClass = isActive ? 'danger' : 'secondary';
    return [
      U.escapeHtml(seller.name || '—'),
      U.escapeHtml(seller.email || '—'),
      statusBadge,
      `<div class="actions">${UI.actionButton(toggleAction, seller.id, toggleLabel, toggleClass)}</div>`,
    ];
  }

  function renderSellers(data = {}) {
    const sellers = Array.isArray(data.sellers) ? data.sellers : [];
    const loading = !!data.loading;
    const rows = sellers.map(sellerRow);
    const listHtml = loading
      ? UI.formNotice('Carregando vendedores...', 'info')
      : UI.table(['Nome', 'E-mail', 'Status', 'Ações'], rows, 'Nenhum vendedor cadastrado ainda.');

    return UI.section(
      'Vendedores',
      'Crie contas de vendedores e gerencie o acesso deles. Desativar não apaga os dados do vendedor.',
      `
        <div id="authSellersError"></div>
        <form id="authCreateSellerForm" class="grid-form">
          <label class="full">Nome
            <input name="name" required placeholder="Nome do vendedor">
          </label>
          <label>E-mail
            <input type="email" name="email" required autocomplete="off" placeholder="vendedor@exemplo.com">
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

    function paint() {
      container.innerHTML = renderSellers({ sellers, loading });
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
      const form = event.target.closest('#authCreateSellerForm');
      if (!form || !container.contains(form)) return;
      event.preventDefault();
      clearError();

      const data = U.formData(form);
      const name = (data.name || '').trim();
      const email = (data.email || '').trim();
      const password = data.password || '';

      if (!name) { showError('Informe o nome do vendedor.'); return; }
      if (!email) { showError('Informe o e-mail do vendedor.'); return; }
      if (password.length < 6) { showError('A senha provisória precisa ter ao menos 6 caracteres.'); return; }

      const submitButton = form.querySelector('button[type="submit"]');
      const originalLabel = submitButton ? submitButton.textContent : '';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Criando...';
      }

      try {
        if (!api() || typeof api().createSeller !== 'function') {
          throw new Error('Serviço de vendedores indisponível no momento.');
        }
        await api().createSeller({ email, password, name });
        form.reset();
        await loadSellers();
      } catch (error) {
        showError(mapCreateSellerError(error));
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalLabel;
        }
      }
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const { action, id } = button.dataset;
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
