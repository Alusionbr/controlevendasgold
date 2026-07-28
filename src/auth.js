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

  // Aviso visível quando refresh() falha (ex.: blip de rede numa das várias
  // chamadas paralelas em src/state.js) — sem isto, o login/restauração de
  // sessão prossegue normalmente mas com todos os dados zerados e nenhum
  // sinal do motivo, fácil de confundir com "o dashboard sumiu". app.js
  // carrega depois de auth.js (ver ordem de <script> em index.html), então
  // window.C360.app já existe quando login/restoreSession de fato rodam
  // (são sempre disparados por interação do usuário após o boot completo) —
  // a checagem defensiva é só para nunca quebrar o fluxo de login por causa
  // do aviso em si.
  function notifyRefreshFailure() {
    if (window.C360.app && typeof window.C360.app.toast === 'function') {
      window.C360.app.toast('Não foi possível carregar todos os dados agora. Recarregue a página.', 'error');
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
      // Mas isso não pode ficar silencioso: sem aviso, a tela carrega com tudo
      // zerado (produtos, vendas, estoque) e parece "o dashboard sumiu" sem
      // nenhuma pista do motivo real (blip de rede).
      console.error('C360.auth: erro ao atualizar estado após login.', error);
      notifyRefreshFailure();
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
      notifyRefreshFailure();
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

  // Resumo da mercadoria física em mãos do vendedor (seller_stock), avaliada
  // pelo custo médio real do produto — o admin tem acesso a avg_cost pela RLS,
  // então este valor bate com "Valor em estoque" do dashboard.
  function sellerStockSummary(sellerId) {
    const st = fullState();
    const rows = (st.sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0);
    let value = 0;
    let units = 0;
    rows.forEach((row) => {
      const product = (st.products || []).find((item) => String(item.id) === String(row.productId));
      value += U.number(row.quantity) * U.number(product ? product.avgCost : 0);
      units += U.number(row.quantity);
    });
    return { value, units, productCount: rows.length };
  }

  // Último pagamento recebido deste vendedor (seller_payments é a fonte —
  // tem paymentDate; o ledger só espelha como crédito).
  function lastPaymentForSeller(sellerId) {
    const st = fullState();
    const payments = (st.sellerPayments || [])
      .filter((payment) => String(payment.sellerId) === String(sellerId))
      .sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')));
    return payments[0] || null;
  }

  function pendingReturnsCountForSeller(sellerId) {
    const st = fullState();
    return (st.operationalMovements || []).filter((movement) => String(movement.sellerId) === String(sellerId)
      && ['a_devolver', 'pending'].includes(movement.status)).length;
  }

  function productOptionsForConsignment() {
    return (fullState().products || []).filter((product) => product.type !== 'servico');
  }

  // Só o que o vendedor tem fisicamente em mãos pode ser devolvido, perdido
  // ou virar brinde — oferecer o catálogo inteiro aqui só produziria erro de
  // "estoque próprio insuficiente" no envio.
  function productsInSellerHands(sellerId) {
    const st = fullState();
    const inHand = new Set((st.sellerStock || [])
      .filter((row) => String(row.sellerId) === String(sellerId) && U.number(row.quantity) > 0)
      .map((row) => String(row.productId)));
    return (st.products || []).filter((product) => inHand.has(String(product.id)));
  }

  const LEDGER_TYPE_LABELS = {
    debit_replenishment: 'Reposição', payment: 'Pagamento', return_credit: 'Devolução',
    manual_adjustment: 'Ajuste manual', writeoff: 'Baixa de dívida', bonus_credit: 'Bonificação',
  };

  // Bloco recolhido: o painel tem 4 ações e, abertas todas de uma vez, o card
  // do vendedor passava de 1.000px de altura — o admin rolava a tela inteira
  // para achar o botão certo. Recolhido, o painel cabe numa tela e cada ação
  // abre onde está.
  function manageAction(title, hint, body, open) {
    return `
      <details class="seller-action" ${open ? 'open' : ''}>
        <summary>${U.escapeHtml(title)}</summary>
        ${hint ? `<p class="ss-hint">${hint}</p>` : ''}
        ${body}
      </details>
    `;
  }

  function sellerManagePanel(seller, feedback, adjustPrefill) {
    const L = ledger();
    const balance = L ? L.balanceFor(seller.id) : 0;
    const entries = L ? L.entriesForSeller(seller.id).slice(0, 8) : [];
    const stockRows = stockRowsForSeller(seller.id);
    const products = productOptionsForConsignment();
    const inHand = productsInSellerHands(seller.id);
    const prefill = adjustPrefill && String(adjustPrefill.sellerId) === String(seller.id) ? adjustPrefill : null;

    const consignBody = `
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
    `;

    const paymentBody = `
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
    `;

    // Devolução / desperdício / brinde em um passo só: o admin está com a
    // mercadoria na mão, então não existe fila de conferência aqui (ver
    // src/operationalMovements.js adminRecordMovement).
    const returnBody = `
      <form class="grid-form compact-form" data-om-seller-form data-seller-id="${U.escapeHtml(seller.id)}">
        <label>O que aconteceu
          <select name="type" required>
            <option value="return">Devolveu ao estoque central</option>
            <option value="gift">Virou brinde</option>
            <option value="waste">Perdeu / quebrou (desperdício)</option>
          </select>
        </label>
        <label>Produto
          <select name="productId" required>${UI.optionList(inHand, '', inHand.length ? 'Selecione o produto' : 'Nada em mãos com este vendedor')}</select>
        </label>
        <label>Quantidade
          <input name="quantity" type="number" step="0.001" min="0.001" required ${inHand.length ? '' : 'disabled'}>
        </label>
        <label>Valor unitário
          <input name="unitValue" type="number" step="0.01" min="0" value="0" ${inHand.length ? '' : 'disabled'}>
        </label>
        <label class="wide checkbox-line">
          <input type="checkbox" name="affectsFinance" checked ${inHand.length ? '' : 'disabled'}>
          Abater esse valor da dívida do vendedor
        </label>
        <label class="wide">Motivo
          <input name="reason" required placeholder="Ex.: cliente desistiu, amostra autorizada, caiu no chão" ${inHand.length ? '' : 'disabled'}>
        </label>
        <button type="submit" class="small" ${inHand.length ? '' : 'disabled'}>Registrar</button>
      </form>
    `;

    const adjustBody = `
      <form class="grid-form compact-form" data-ledger-adjust-form data-seller-id="${U.escapeHtml(seller.id)}">
        <label>Valor
          <input name="amount" type="number" step="0.01" min="0.01" required value="${prefill ? U.escapeHtml(prefill.amount) : ''}">
        </label>
        <label>Efeito
          <select name="direction" required>
            <option value="credit" ${prefill && prefill.direction === 'credit' ? 'selected' : ''}>Reduzir a dívida (crédito)</option>
            <option value="debit" ${prefill && prefill.direction === 'debit' ? 'selected' : ''}>Aumentar a dívida (débito)</option>
          </select>
        </label>
        <label class="wide">Motivo
          <input name="notes" required placeholder="Ex.: correção de valor lançado errado" value="${prefill ? U.escapeHtml(prefill.notes) : ''}">
        </label>
        <button type="submit" class="small">Lançar ajuste</button>
      </form>
    `;

    return `
      <div class="seller-manage-panel" data-seller-manage="${U.escapeHtml(seller.id)}">
        ${feedback ? UI.formNotice(feedback.message, feedback.type) : ''}

        <h3>O que está com este vendedor</h3>
        ${UI.table(['Produto', 'Quantidade'], stockRows, 'Nenhum estoque com este vendedor.')}

        ${manageAction('Enviar estoque consignado',
          `Baixa do estoque central, credita o estoque do vendedor e gera dívida no valor enviado (${UI.help('consignado')}).`,
          consignBody)}

        ${manageAction('Registrar pagamento recebido',
          balance > 0 ? `Em aberto hoje: <strong>${U.money(balance)}</strong>.` : 'Este vendedor está em dia.',
          paymentBody)}

        ${manageAction('Devolução, brinde ou desperdício',
          'Tira a mercadoria das mãos do vendedor. Devolução volta ao estoque central; brinde e desperdício saem de circulação. Marque "abater da dívida" para o vendedor não ficar devendo o que não vendeu.',
          returnBody)}

        ${manageAction('Ajuste manual / correção',
          'Lançou errado? Não apagamos histórico: isto cria um lançamento novo que corrige o saldo, com o motivo registrado.',
          adjustBody, !!prefill)}

        <h3>Histórico de lançamentos</h3>
        ${UI.table(['Data', 'Tipo', '', 'Nota', 'Valor', ''], entries.map((entry) => {
          const label = LEDGER_TYPE_LABELS[entry.type] || entry.type;
          const signed = entry.direction === 'credit' ? -U.number(entry.amount) : U.number(entry.amount);
          return [
            (entry.createdAt || '').slice(0, 10),
            U.escapeHtml(label),
            UI.badge(entry.direction === 'credit' ? 'Crédito' : 'Débito', entry.direction === 'credit' ? 'ok' : ''),
            U.escapeHtml(entry.notes || ''),
            `<strong>${signed < 0 ? '- ' : ''}${U.money(Math.abs(signed))}</strong>`,
            `<button type="button" class="small secondary" data-action="prefill-adjust"
               data-id="${U.escapeHtml(seller.id)}"
               data-amount="${U.escapeHtml(U.number(entry.amount))}"
               data-direction="${entry.direction === 'credit' ? 'debit' : 'credit'}"
               data-label="${U.escapeHtml(label)}"
               data-date="${U.escapeHtml((entry.createdAt || '').slice(0, 10))}">Corrigir</button>`,
          ];
        }), 'Nenhum lançamento ainda.')}
      </div>
    `;
  }

  function sellerRow(seller, expandedId, feedback, adjustPrefill) {
    const isActive = seller.active !== false;
    const statusBadge = isActive ? UI.badge('Ativo', 'ok') : UI.badge('Inativo', 'warn');
    const toggleAction = isActive ? 'deactivate-seller' : 'activate-seller';
    const toggleLabel = isActive ? 'Desativar' : 'Reativar';
    const toggleClass = isActive ? 'danger' : 'secondary';
    const isExpanded = String(expandedId) === String(seller.id);
    const L = ledger();
    const balance = L ? L.balanceFor(seller.id) : 0;
    const stock = sellerStockSummary(seller.id);
    const lastPayment = lastPaymentForSeller(seller.id);
    const pendingTotal = pendingReturnsCountForSeller(seller.id);

    return `
      <article class="panel-card seller-manage-card" data-seller-card="${U.escapeHtml(seller.id)}">
        <div class="approval-card-head">
          <strong>${U.escapeHtml(seller.name || '—')}</strong>
          ${statusBadge}
          ${pendingTotal > 0 ? UI.badge(`${pendingTotal} devolução${pendingTotal === 1 ? '' : 'ões'} a conferir`, 'warn') : ''}
        </div>
        <p class="ss-approval-detail">${U.escapeHtml(seller.email || '—')}</p>
        <div class="seller-stat-strip">
          <div class="seller-stat">
            <span>Mercadoria em mãos</span>
            <strong>${U.money(stock.value)}</strong>
            <small>${stock.productCount} produto${stock.productCount === 1 ? '' : 's'}</small>
          </div>
          <div class="seller-stat ${balance > 0 ? 'is-debt' : 'is-ok'}">
            <span>Dívida</span>
            <strong>${balance > 0 ? U.money(balance) : 'Em dia'}</strong>
            <small>${balance > 0 ? 'a receber' : 'sem saldo'}</small>
          </div>
          <div class="seller-stat">
            <span>Último pagamento</span>
            <strong>${lastPayment ? U.money(U.number(lastPayment.amount)) : '—'}</strong>
            <small>${lastPayment ? U.escapeHtml((lastPayment.paymentDate || '').slice(0, 10)) : 'nenhum'}</small>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="small" data-action="toggle-manage" data-id="${U.escapeHtml(seller.id)}">${isExpanded ? 'Fechar' : 'Abrir'}</button>
          ${UI.actionButton(toggleAction, seller.id, toggleLabel, toggleClass)}
        </div>
        ${isExpanded ? sellerManagePanel(seller, feedback, adjustPrefill) : ''}
      </article>
    `;
  }

  function renderSellers(data = {}) {
    const sellers = Array.isArray(data.sellers) ? data.sellers : [];
    const loading = !!data.loading;
    const activeSellers = sellers.filter((seller) => seller.active !== false);
    const inactiveSellers = sellers.filter((seller) => seller.active === false);
    // Vendedor desativado não recebe mercadoria nem paga nada: manter os dois
    // grupos na mesma lista fazia a tela crescer sem limite (contas de teste
    // desativadas empurravam os vendedores reais para fora da primeira tela).
    const showInactive = !!data.showInactive;
    const visible = showInactive ? sellers : activeSellers;

    const listHtml = loading
      ? UI.formNotice('Carregando vendedores...', 'info')
      : (visible.length
        ? `<div class="seller-ledger-grid">${visible.map((seller) => sellerRow(seller, data.expandedId, data.manageFeedback, data.adjustPrefill)).join('')}</div>`
        : `<div class="empty-state"><strong>${activeSellers.length ? 'Nenhum vendedor ativo em exibição.' : 'Nenhum vendedor cadastrado ainda.'}</strong><span>Use "Cadastrar novo vendedor" para começar.</span></div>`);

    const L = ledger();
    const totalOpen = !loading && L
      ? activeSellers.reduce((sum, seller) => sum + Math.max(L.balanceFor(seller.id), 0), 0)
      : 0;
    const totalStockOut = !loading
      ? activeSellers.reduce((sum, seller) => sum + sellerStockSummary(seller.id).value, 0)
      : 0;

    return UI.section(
      'Vendedores',
      'Onde está sua mercadoria e quem deve, num lugar só. Abra um vendedor para enviar consignado, receber pagamento, registrar devolução/brinde ou corrigir um lançamento.',
      `
        ${!loading ? `<div class="dashboard seller-overview-metrics">
          ${UI.metric('Mercadoria com vendedores', U.money(totalStockOut), 'consignadoAberto')}
          ${UI.metric('Total a receber', U.money(totalOpen), null)}
        </div>` : ''}
        <div id="authSellersError"></div>
        ${!loading && inactiveSellers.length ? `
          <p class="seller-list-filter">
            <button type="button" class="small secondary" data-action="toggle-inactive">
              ${showInactive ? `Ocultar ${inactiveSellers.length} desativado${inactiveSellers.length === 1 ? '' : 's'}` : `Mostrar ${inactiveSellers.length} desativado${inactiveSellers.length === 1 ? '' : 's'}`}
            </button>
          </p>` : ''}
        ${listHtml}
        <details class="seller-action seller-create">
          <summary>Cadastrar novo vendedor</summary>
          <form id="authCreateSellerForm" class="grid-form compact-form">
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
        </details>
      `
    );
  }

  function mountSellers(container) {
    if (!container) return null;

    let sellers = [];
    let loading = true;
    let expandedId = null;
    let manageFeedback = null;
    let showInactive = false;
    let adjustPrefill = null;

    function paint() {
      container.innerHTML = renderSellers({ sellers, loading, expandedId, manageFeedback, showInactive, adjustPrefill });
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
      const movementForm = event.target.closest('[data-om-seller-form]');
      const adjustForm = event.target.closest('[data-ledger-adjust-form]');

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

      if (movementForm && container.contains(movementForm)) {
        event.preventDefault();
        const sellerId = movementForm.dataset.sellerId;
        const data = U.formData(movementForm);
        const submitButton = movementForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        try {
          const OM = window.C360.operationalMovements;
          if (!OM || typeof OM.adminRecordMovement !== 'function') {
            throw new Error('Registro de devolução indisponível no momento.');
          }
          await OM.adminRecordMovement({
            sellerId,
            productId: data.productId,
            type: data.type,
            quantity: data.quantity,
            unitValue: data.unitValue,
            affectsFinance: !!data.affectsFinance,
            reason: data.reason,
          });
          const done = ({ return: 'Devolução registrada: mercadoria de volta no estoque central.',
            gift: 'Brinde registrado: mercadoria saiu das mãos do vendedor.',
            waste: 'Desperdício registrado: mercadoria saiu das mãos do vendedor.' })[data.type];
          manageFeedback = {
            message: `${done}${data.affectsFinance ? ' Dívida abatida no valor informado.' : ''}`,
            type: 'success',
          };
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
          adjustPrefill = null;
          manageFeedback = { message: 'Ajuste lançado. O histórico original continua intacto.', type: 'success' };
        } catch (error) {
          manageFeedback = { message: (error && error.message) || 'Não foi possível lançar o ajuste.', type: 'danger' };
        }
        paint();
      }
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const { action, id, tab } = button.dataset;

      if (action === 'toggle-manage') {
        expandedId = String(expandedId) === String(id) ? null : id;
        manageFeedback = null;
        adjustPrefill = null;
        paint();
        return;
      }

      if (action === 'toggle-inactive') {
        showInactive = !showInactive;
        paint();
        return;
      }

      // "Corrigir" não edita nem apaga o lançamento clicado: só abre o
      // formulário de ajuste manual já preenchido com o estorno dele, para o
      // admin conferir valor/motivo antes de confirmar.
      if (action === 'prefill-adjust') {
        adjustPrefill = {
          sellerId: id,
          amount: button.dataset.amount,
          direction: button.dataset.direction,
          notes: `Correção do lançamento de ${button.dataset.date} (${button.dataset.label})`,
        };
        paint();
        const form = container.querySelector('[data-ledger-adjust-form]');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      if (action === 'goto-tab') {
        if (window.C360.app && typeof window.C360.app.setTab === 'function') window.C360.app.setTab(tab);
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
