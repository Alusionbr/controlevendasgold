(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Metas de vendas (semanais/mensais) com premiação — módulo autocontido.
  //
  // API remota esperada (implementada por outro agente em window.C360.api).
  // Este módulo checa a existência de cada método antes de chamar e cai em
  // um placeholder inofensivo quando ela ainda não existe:
  //
  //   C360.api.listSellers()                 -> Promise<Array<{ id, name }>>
  //   C360.api.listSalesGoals(params?)        -> Promise<Array<SalesGoal>>
  //   C360.api.listGoalsProgress(params?)      -> Promise<Array<GoalProgress>>
  //   C360.api.createSalesGoal(payload)        -> Promise<SalesGoal>
  //   C360.api.updateSalesGoal(id, patch)      -> Promise<SalesGoal>
  //   C360.api.deleteSalesGoal(id)             -> Promise<void>
  //
  //   params (opcional em listSalesGoals/listGoalsProgress): { sellerId }
  //
  //   SalesGoal (linha de public.sales_goals, ver supabase/migrations/0002_goals.sql):
  //     { id, seller_id, period_type: 'semana'|'mes', period_start, period_end,
  //       target_amount, reward_description, reward_value, achieved, achieved_at }
  //
  //   GoalProgress (linha da view public.sales_goals_progress):
  //     { goal_id, seller_id, period_type, period_start, period_end, target_amount,
  //       reward_description, reward_value, achieved_amount, progress_pct, is_achieved }
  //
  // Contexto do usuário logado (opcional, usado por mountSeller quando
  // options.sellerId não é informado):
  //   C360.state.getCurrentUser() -> { id, name, role, businessId } | null
  // ==========================================================================

  const PERIOD_TYPES = [
    { value: 'semana', label: 'Semana' },
    { value: 'mes', label: 'Mês' },
  ];

  // ---------------------------------------------------------------------
  // Datas
  // ---------------------------------------------------------------------
  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function parseDateLocal(dateStr) {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  function formatDateLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDays(dateStr, days) {
    if (!dateStr) return '';
    const date = parseDateLocal(dateStr);
    date.setDate(date.getDate() + days);
    return formatDateLocal(date);
  }

  function endOfMonth(dateStr) {
    if (!dateStr) return '';
    const date = parseDateLocal(dateStr);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return formatDateLocal(end);
  }

  // Regra pedida: semana = início + 7 dias; mês = fim do mês do início.
  function suggestPeriodEnd(periodType, startDate) {
    if (!startDate) return '';
    return periodType === 'mes' ? endOfMonth(startDate) : addDays(startDate, 7);
  }

  // ---------------------------------------------------------------------
  // Estilos (injetados uma única vez; o módulo não edita styles/main.css).
  // Novas variáveis --accent-gold* usam fallback inline via var(--x, #hex)
  // para funcionar standalone; se o tema oficial definir essas variáveis em
  // styles/main.css, o valor real do tema prevalece automaticamente.
  // ---------------------------------------------------------------------
  const STYLE_ID = 'c360-goals-inline-styles';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .goals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.85rem; margin-bottom: 1.2rem; }
      .goals-seller-group { margin-bottom: 1.4rem; }
      .goals-seller-name { font-size: 1rem; font-weight: 700; color: var(--ink, #14302f); margin-bottom: 0.6rem; }
      .goals-seller-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
      .goal-card {
        background: var(--surface, #fff);
        border: 1px solid var(--line, #d8e1df);
        border-radius: var(--radius, 14px);
        padding: 1rem;
        box-shadow: var(--shadow-sm, 0 4px 14px rgba(12, 60, 56, 0.07));
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .goal-card--achieved {
        border-color: var(--accent-gold, #c9a227);
        background: linear-gradient(180deg, var(--accent-gold-soft, #faf1d4), var(--surface, #fff) 65%);
      }
      .goal-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
      .goal-period { font-size: 0.8rem; color: var(--muted, #5d6f6d); margin: 0; }
      .goal-badge-gold { background: var(--accent-gold-soft, #faf1d4); color: var(--accent-gold-deep, #8a6f14); }
      .goal-progress { display: flex; flex-direction: column; gap: 0.35rem; }
      .goal-progress-bar {
        position: relative;
        height: 10px;
        border-radius: 999px;
        background: var(--surface-soft, #f6f8f7);
        border: 1px solid var(--line, #d8e1df);
        overflow: hidden;
      }
      .goal-progress-bar--lg { height: 14px; }
      .goal-progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        height: 100%;
        border-radius: 999px;
        background: var(--accent, #c9610c);
        transition: width 0.4s ease;
      }
      .goal-progress-fill--gold { background: linear-gradient(90deg, var(--accent-gold-deep, #8a6f14), var(--accent-gold, #c9a227)); }
      .goal-progress-label { font-size: 0.78rem; color: var(--muted, #5d6f6d); font-variant-numeric: tabular-nums; }
      .goal-reward { font-size: 0.85rem; margin: 0; }
      .goal-incentive { font-size: 0.88rem; color: var(--muted, #5d6f6d); margin: 0; }
      .goal-reward-highlight { font-size: 0.9rem; margin: 0.2rem 0 0; }
      .goal-celebrate {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.15rem;
        padding: 0.6rem 0.7rem;
        border-radius: var(--radius-sm, 10px);
        background: var(--accent-gold-soft, #faf1d4);
        color: var(--accent-gold-deep, #8a6f14);
        animation: c360GoalPulse 1.8s ease-in-out infinite;
      }
      .goal-trophy { font-size: 1.3rem; line-height: 1; }
      @keyframes c360GoalPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(201, 162, 39, 0.35); }
        50% { box-shadow: 0 0 0 6px rgba(201, 162, 39, 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .goal-celebrate { animation: none; }
        .goal-progress-fill { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

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
      console.error(`C360.goals: erro ao chamar C360.api.${method}`, error);
      return null;
    }
  }

  function currentUser() {
    try {
      if (window.C360.state && typeof window.C360.state.getCurrentUser === 'function') {
        return window.C360.state.getCurrentUser() || null;
      }
    } catch (error) {
      console.error('C360.goals: erro ao ler usuário atual', error);
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Render — admin
  // ---------------------------------------------------------------------
  function adminForm(sellers, editingGoal) {
    const defaults = editingGoal || {};
    const periodType = defaults.period_type || 'semana';
    const start = defaults.period_start || U.today();
    const end = defaults.period_end || suggestPeriodEnd(periodType, start);

    return `
      <form id="goalsAdminForm" class="grid-form">
        <label>Vendedor
          <select name="sellerId" required ${editingGoal ? 'disabled' : ''}>
            ${UI.optionList(sellers, defaults.seller_id || '', sellers.length ? 'Selecione' : 'Nenhum vendedor disponível')}
          </select>
        </label>
        <label>Tipo de período
          <select name="periodType" required>
            ${UI.optionList(PERIOD_TYPES, periodType, '')}
          </select>
        </label>
        <label>Início do período
          <input name="periodStart" type="date" required value="${U.escapeHtml(start)}">
        </label>
        <label>Fim do período
          <input name="periodEnd" type="date" required value="${U.escapeHtml(end)}">
        </label>
        <label>Meta de vendas (R$)
          <input name="targetAmount" type="number" step="0.01" min="0.01" required value="${U.escapeHtml(defaults.target_amount ?? '')}">
        </label>
        <label>Premiação (descrição)
          <input name="rewardDescription" placeholder="Ex.: R$50 de bônus, dia de folga..." value="${U.escapeHtml(defaults.reward_description || '')}">
        </label>
        <label>Valor da premiação (R$, opcional)
          <input name="rewardValue" type="number" step="0.01" min="0" value="${U.escapeHtml(defaults.reward_value ?? '')}">
        </label>
        <button type="submit">${editingGoal ? 'Salvar alterações' : 'Criar meta'}</button>
        ${editingGoal ? '<button type="button" class="ghost" data-goal-action="cancel-edit">Cancelar edição</button>' : ''}
      </form>
    `;
  }

  function adminGoalCard(goal, progressRow) {
    const pct = progressRow ? U.number(progressRow.progress_pct) : 0;
    const achievedAmount = progressRow ? U.number(progressRow.achieved_amount) : 0;
    const isAchieved = !!(progressRow ? progressRow.is_achieved : goal.achieved);
    const clampedPct = Math.max(0, Math.min(100, pct));
    const periodLabel = goal.period_type === 'mes' ? 'Mensal' : 'Semanal';

    return `
      <article class="goal-card ${isAchieved ? 'goal-card--achieved' : ''}">
        <div class="goal-card-head">
          <span class="badge">${U.escapeHtml(periodLabel)}</span>
          ${isAchieved ? '<span class="badge goal-badge-gold">🏆 Meta batida</span>' : ''}
        </div>
        <p class="goal-period">${U.escapeHtml(goal.period_start)} — ${U.escapeHtml(goal.period_end)}</p>
        <div class="goal-progress">
          <div class="goal-progress-bar"><div class="goal-progress-fill ${isAchieved ? 'goal-progress-fill--gold' : ''}" style="width:${clampedPct}%"></div></div>
          <span class="goal-progress-label">${U.money(achievedAmount)} de ${U.money(goal.target_amount)} (${clampedPct.toFixed(0)}%)</span>
        </div>
        ${goal.reward_description ? `<p class="goal-reward">Prêmio: <strong>${U.escapeHtml(goal.reward_description)}</strong>${goal.reward_value ? ` (${U.money(goal.reward_value)})` : ''}</p>` : ''}
        <div class="actions">
          <button type="button" class="small secondary" data-goal-action="edit" data-goal-id="${U.escapeHtml(goal.id)}">Editar</button>
          <button type="button" class="small danger" data-goal-action="delete" data-goal-id="${U.escapeHtml(goal.id)}">Excluir</button>
        </div>
      </article>
    `;
  }

  function renderAdmin(data = {}) {
    ensureStyles();
    const sellers = data.sellers || [];
    const goals = data.goals || [];
    const progress = data.progress || [];
    const editingGoal = data.editingGoal || null;
    const apiAvailable = data.apiAvailable !== false;
    const loading = !!data.loading;

    const progressByGoal = new Map(progress.map((row) => [row.goal_id, row]));
    const sellersById = new Map(sellers.map((seller) => [String(seller.id), seller]));

    const grouped = new Map();
    goals.forEach((goal) => {
      const key = String(goal.seller_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(goal);
    });

    let listHtml;
    if (loading) {
      listHtml = UI.formNotice('Carregando metas...', 'info');
    } else if (!goals.length) {
      listHtml = '<div class="empty-state"><strong>Nenhuma meta cadastrada ainda.</strong><span>Crie a primeira meta usando o formulário acima.</span></div>';
    } else {
      listHtml = [...grouped.entries()].map(([sellerId, sellerGoals]) => {
        const seller = sellersById.get(sellerId);
        const name = seller ? seller.name : 'Vendedor';
        const cards = sellerGoals.map((goal) => adminGoalCard(goal, progressByGoal.get(goal.id))).join('');
        return `
          <div class="goals-seller-group">
            <h3 class="goals-seller-name">${U.escapeHtml(name)}</h3>
            <div class="goals-grid">${cards}</div>
          </div>
        `;
      }).join('');
    }

    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api (listSellers, listSalesGoals, listGoalsProgress, createSalesGoal, updateSalesGoal, deleteSalesGoal) para salvar e carregar metas reais.', 'warning');

    return UI.section(
      'Metas de vendas',
      'Defina metas semanais e mensais por vendedor, com premiação, para incentivar as vendas.',
      `${notice}${adminForm(sellers, editingGoal)}${listHtml}`
    );
  }

  // ---------------------------------------------------------------------
  // Render — vendedor (gamificado)
  // ---------------------------------------------------------------------
  function sellerGoalCard(row) {
    const pct = U.number(row.progress_pct);
    const achievedAmount = U.number(row.achieved_amount);
    const target = U.number(row.target_amount);
    const remaining = Math.max(0, target - achievedAmount);
    const isAchieved = !!row.is_achieved;
    const clampedPct = Math.max(0, Math.min(100, pct));
    const periodLabel = row.period_type === 'mes' ? 'Meta mensal' : 'Meta semanal';

    const statusHtml = isAchieved
      ? `
        <div class="goal-celebrate">
          <span class="goal-trophy" aria-hidden="true">🏆</span>
          <strong>Meta batida! Parabéns!</strong>
          ${row.reward_description ? `<p class="goal-reward-highlight">Seu prêmio: <strong>${U.escapeHtml(row.reward_description)}</strong>${row.reward_value ? ` — ${U.money(row.reward_value)}` : ''}</p>` : ''}
        </div>
      `
      : `<p class="goal-incentive">Faltam <strong>${U.money(remaining)}</strong> para bater a meta!</p>`;

    return `
      <article class="goal-card goal-card-seller ${isAchieved ? 'goal-card--achieved' : ''}">
        <div class="goal-card-head">
          <span class="badge">${U.escapeHtml(periodLabel)}</span>
          <span class="goal-period">${U.escapeHtml(row.period_start)} – ${U.escapeHtml(row.period_end)}</span>
        </div>
        <div class="goal-progress">
          <div class="goal-progress-bar goal-progress-bar--lg">
            <div class="goal-progress-fill ${isAchieved ? 'goal-progress-fill--gold' : ''}" style="width:${clampedPct}%"></div>
          </div>
          <span class="goal-progress-label">${clampedPct.toFixed(0)}% • ${U.money(achievedAmount)} de ${U.money(target)}</span>
        </div>
        ${statusHtml}
      </article>
    `;
  }

  function renderSeller(data = {}) {
    ensureStyles();
    const rows = data.goals || [];
    const sellerName = data.sellerName || '';
    const loading = !!data.loading;
    const apiAvailable = data.apiAvailable !== false;

    const title = sellerName ? `Minhas metas — ${sellerName}` : 'Minhas metas';

    if (loading) {
      return UI.section(title, 'Acompanhe sua meta semanal e mensal.', UI.formNotice('Carregando suas metas...', 'info'));
    }

    const cards = rows.slice().sort((a, b) => String(b.period_start || '').localeCompare(String(a.period_start || '')));

    const notice = apiAvailable
      ? ''
      : UI.formNotice('Modo demonstração: conecte C360.api.listGoalsProgress para ver suas metas reais.', 'warning');

    const body = cards.length
      ? `<div class="goals-seller-cards">${cards.map(sellerGoalCard).join('')}</div>`
      : '<div class="empty-state"><strong>Nenhuma meta ativa no momento.</strong><span>Assim que o administrador definir uma meta para você, ela aparece aqui.</span></div>';

    return UI.section(
      title,
      'Bata sua meta semanal e mensal e garanta sua premiação!',
      `${notice}${body}`
    );
  }

  // ---------------------------------------------------------------------
  // Mount — admin (listeners escopados ao container, sem depender do
  // delegador global de cliques da aplicação)
  // ---------------------------------------------------------------------
  function mountAdmin(container, options = {}) {
    if (!container) return null;

    let sellers = options.sellers || [];
    let goals = [];
    let progress = [];
    let editingId = null;
    let loading = true;

    function paint() {
      container.innerHTML = renderAdmin({
        sellers,
        goals,
        progress,
        editingGoal: editingId ? goals.find((goal) => goal.id === editingId) || null : null,
        loading,
        apiAvailable: hasApi('listSalesGoals') || hasApi('createSalesGoal'),
      });
    }

    async function loadAll() {
      loading = true;
      paint();
      const [sellersRes, goalsRes, progressRes] = await Promise.all([
        hasApi('listSellers') ? safeCall('listSellers') : Promise.resolve(null),
        safeCall('listSalesGoals'),
        safeCall('listGoalsProgress'),
      ]);
      if (Array.isArray(sellersRes)) sellers = sellersRes;
      goals = Array.isArray(goalsRes) ? goalsRes : [];
      progress = Array.isArray(progressRes) ? progressRes : [];
      loading = false;
      paint();
    }

    container.addEventListener('submit', async (event) => {
      const form = event.target.closest('#goalsAdminForm');
      if (!form) return;
      event.preventDefault();
      try {
        const data = U.formData(form);
        const payload = {
          period_type: data.periodType,
          period_start: data.periodStart,
          period_end: data.periodEnd,
          target_amount: U.number(data.targetAmount),
          reward_description: (data.rewardDescription || '').trim(),
          reward_value: data.rewardValue ? U.number(data.rewardValue) : null,
        };
        U.assertPositive(payload.target_amount, 'Meta de vendas');

        if (editingId) {
          if (hasApi('updateSalesGoal')) {
            await api().updateSalesGoal(editingId, payload);
          } else {
            alert('Modo demonstração: conecte C360.api.updateSalesGoal para salvar alterações de verdade.');
          }
          editingId = null;
        } else {
          if (!data.sellerId) throw new Error('Selecione um vendedor.');
          payload.seller_id = data.sellerId;
          if (hasApi('createSalesGoal')) {
            await api().createSalesGoal(payload);
          } else {
            alert('Modo demonstração: conecte C360.api.createSalesGoal para criar metas de verdade.');
          }
        }
        await loadAll();
      } catch (error) {
        alert(error.message);
      }
    });

    container.addEventListener('change', (event) => {
      const trigger = event.target.closest('[name="periodType"], [name="periodStart"]');
      if (!trigger) return;
      const form = event.target.closest('#goalsAdminForm');
      if (!form) return;
      const periodType = form.elements.periodType.value;
      const start = form.elements.periodStart.value;
      if (periodType && start) {
        form.elements.periodEnd.value = suggestPeriodEnd(periodType, start);
      }
    });

    container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-goal-action]');
      if (!button) return;
      const { goalAction, goalId } = button.dataset;
      try {
        if (goalAction === 'edit') {
          editingId = goalId;
          paint();
        } else if (goalAction === 'cancel-edit') {
          editingId = null;
          paint();
        } else if (goalAction === 'delete') {
          if (!confirm('Excluir esta meta?')) return;
          if (hasApi('deleteSalesGoal')) {
            await api().deleteSalesGoal(goalId);
          } else {
            alert('Modo demonstração: conecte C360.api.deleteSalesGoal para excluir de verdade.');
          }
          if (editingId === goalId) editingId = null;
          await loadAll();
        }
      } catch (error) {
        alert(error.message);
      }
    });

    paint();
    if (hasApi('listSalesGoals') || hasApi('listGoalsProgress') || hasApi('listSellers')) {
      loadAll();
    } else {
      loading = false;
      paint();
    }

    return { refresh: loadAll };
  }

  // ---------------------------------------------------------------------
  // Mount — vendedor
  // ---------------------------------------------------------------------
  function mountSeller(container, options = {}) {
    if (!container) return null;

    const user = currentUser();
    const sellerId = options.sellerId || (user && user.id) || null;
    const sellerName = options.sellerName || (user && user.name) || '';
    let goalsRows = [];
    let loading = true;

    function paint() {
      container.innerHTML = renderSeller({
        goals: goalsRows,
        sellerName,
        loading,
        apiAvailable: hasApi('listGoalsProgress'),
      });
    }

    async function loadAll() {
      loading = true;
      paint();
      const rows = await safeCall('listGoalsProgress', sellerId ? { sellerId } : {});
      goalsRows = Array.isArray(rows) ? rows : [];
      loading = false;
      paint();
    }

    paint();
    if (hasApi('listGoalsProgress')) {
      loadAll();
    } else {
      loading = false;
      paint();
    }

    return { refresh: loadAll };
  }

  window.C360.goals = {
    renderAdmin,
    renderSeller,
    mountAdmin,
    mountSeller,
  };
})();
