(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const { escapeHtml } = U;

  // ---------------------------------------------------------------------
  // Conteúdo — Central de Ajuda do vendedor.
  // Tudo em português simples, pensado para quem vende cosméticos/perfumes
  // pelo celular e não é da área de tecnologia.
  // ---------------------------------------------------------------------

  const STEPS = [
    {
      title: 'Faça login',
      text: 'Entre com o usuário e a senha que o dono do negócio criou para você. Se esquecer a senha, peça para o administrador criar uma nova.',
    },
    {
      title: 'Cadastre seu primeiro cliente',
      text: 'Antes de lançar uma venda, cadastre o cliente: nome e um contato (telefone ou WhatsApp) já ajudam bastante. Isso deixa seu histórico de vendas organizado.',
    },
    {
      title: 'Lance sua primeira venda',
      text: 'Escolha o cliente, os produtos e a forma de pagamento. O sistema calcula o total sozinho — você só confere e confirma.',
    },
    {
      title: 'Se algo voltar ou estragar',
      text: 'Cliente devolveu produto? Registre a devolução na própria venda. Um produto estragou ou foi perdido (desperdício)? Registre como desperdício para o estoque continuar certinho — isso não é um erro seu, faz parte do dia a dia.',
    },
    {
      title: 'Vender do seu próprio estoque',
      text: 'Se você compra produtos e leva para revender por conta própria, esse estoque fica como "consignado" com o administrador: ele sabe o que está com você e o que já foi vendido, sem confusão na hora de acertar as contas.',
    },
    {
      title: 'Peça reposição quando o estoque estiver baixo',
      text: 'Encontrou um produto acabando? Solicite um pedido de reposição pelo app. O administrador recebe o pedido e aprova ou recusa — você acompanha o status direto por aqui, sem precisar ficar perguntando.',
    },
    {
      title: 'Acompanhe suas metas',
      text: 'Veja sua meta semanal e mensal e quanto falta para batê-la. Bater a meta pode valer premiações — fique de olho no painel para saber como está indo.',
    },
  ];

  const TIPS = [
    {
      title: 'Ofereça kits',
      text: 'Combine produtos que combinam entre si (perfume + hidratante, por exemplo). O valor do kit parece melhor para o cliente e aumenta o total da venda.',
    },
    {
      title: 'Sugira reposição no momento certo',
      text: 'Se um cliente comprou um perfume há algumas semanas, ele provavelmente está acabando. Mande uma mensagem simples perguntando se ele quer repor.',
    },
    {
      title: 'Peça indicação depois de um elogio',
      text: 'Quando o cliente disser que gostou do produto, aproveite para pedir a indicação de mais alguém. É o momento em que ele está mais satisfeito.',
    },
    {
      title: 'Fique de olho nos consignados vencidos',
      text: 'Revise de tempos em tempos o que está consignado com você. Consignado parado há muito tempo é dinheiro que ainda não virou venda — resolva ou devolva.',
    },
    {
      title: 'Use a calculadora antes de negociar',
      text: 'Antes de topar um desconto, use a calculadora para ver até onde dá para negociar sem vender abaixo do preço mínimo.',
    },
    {
      title: 'Lance a venda na hora',
      text: 'Registre a venda assim que ela acontecer. Deixar acumulando aumenta a chance de esquecer detalhes e bagunça o controle de estoque.',
    },
    {
      title: 'Faça o pós-venda',
      text: 'Uma mensagem simples perguntando se o cliente gostou do produto fortalece a relação e abre espaço para a próxima venda.',
    },
    {
      title: 'Avise sobre novidades e promoções',
      text: 'Clientes antigos costumam comprar de novo quando sabem que chegou produto novo ou tem alguma condição especial.',
    },
  ];

  const FAQS = [
    {
      question: 'Posso vender por um preço menor que o preço mínimo?',
      answer: 'Não. O preço mínimo (piso) é definido pelo administrador e o sistema bloqueia vendas abaixo dele. Isso protege a margem do negócio — se o cliente pedir desconto maior, converse com o administrador.',
      keywords: 'preço mínimo piso desconto bloqueado bloqueio venda barato',
    },
    {
      question: 'Meu pedido de reposição está demorando para ser aprovado. O que eu faço?',
      answer: 'Pedidos de reposição dependem da aprovação do administrador, que pode levar um tempo dependendo da correria do dia. Você pode acompanhar o status do pedido pelo app; se estiver muito atrasado, fale diretamente com o administrador.',
      keywords: 'pedido reposição demora aprovação aprovado rejeitado status estoque',
    },
    {
      question: 'Como sei se já bati minha meta?',
      answer: 'Na tela de metas você vê sua meta semanal e mensal, quanto já vendeu e quanto ainda falta. O progresso é atualizado conforme você lança as vendas.',
      keywords: 'meta metas semanal mensal premiação premiacoes progresso bater meta',
    },
    {
      question: 'Meus clientes aparecem para outros vendedores?',
      answer: 'Não. Os clientes que você cadastra são só seus — outros vendedores não veem sua carteira de clientes nem seu histórico de vendas com eles.',
      keywords: 'clientes privado outros vendedores carteira visibilidade compartilhado',
    },
    {
      question: 'O que é consignado e por que aparece no meu estoque?',
      answer: 'Consignado é quando você vende usando o seu próprio estoque de produtos: esse estoque fica registrado como consignado com o administrador, para que fique claro o que já foi vendido e o que ainda está com você.',
      keywords: 'consignado consignação estoque próprio vender do meu estoque',
    },
    {
      question: 'Um cliente devolveu um produto. Como eu registro isso?',
      answer: 'Abra a venda correspondente e registre a devolução. O estoque é ajustado automaticamente, então você não precisa fazer nenhuma conta manual.',
      keywords: 'devolução devolver cliente devolveu produto voltou',
    },
    {
      question: 'Um produto estragou ou foi perdido. O que eu faço?',
      answer: 'Registre como desperdício. Isso acontece e faz parte do dia a dia — o importante é registrar para o estoque e os custos continuarem corretos.',
      keywords: 'desperdício perda estragou quebrou vencido perdido',
    },
    {
      question: 'Esqueci minha senha. Como faço para entrar?',
      answer: 'Peça para o administrador do negócio criar uma nova senha para você. Por segurança, apenas ele pode redefinir o acesso de vendedores.',
      keywords: 'senha esqueci login entrar acesso redefinir',
    },
    {
      question: 'Consigo usar o app pelo celular?',
      answer: 'Sim, o app foi pensado para funcionar bem no celular. Você pode cadastrar clientes, lançar vendas e acompanhar metas direto da tela do seu telefone, no meio de um atendimento.',
      keywords: 'celular telefone mobile app funciona no celular',
    },
    {
      question: 'Como funciona a calculadora de preço?',
      answer: 'A calculadora ajuda a conferir valores antes de fechar uma venda ou negociar um desconto, mostrando se o preço final ainda fica acima do mínimo permitido.',
      keywords: 'calculadora calcular preço conta valores',
    },
  ];

  function renderSteps() {
    return STEPS.map((step, index) => `
      <li class="help-step">
        <span class="help-step-number">${index + 1}</span>
        <div class="help-step-body">
          <strong>${escapeHtml(step.title)}</strong>
          <p>${escapeHtml(step.text)}</p>
        </div>
      </li>
    `).join('');
  }

  function renderTips() {
    return TIPS.map((tip) => `
      <li class="tip-card">
        <strong>${escapeHtml(tip.title)}</strong>
        <p>${escapeHtml(tip.text)}</p>
      </li>
    `).join('');
  }

  function renderFaqs() {
    return FAQS.map((faq, index) => {
      const keywords = `${faq.question} ${faq.answer} ${faq.keywords}`.toLowerCase();
      return `
        <div class="accordion-item" data-faq-item data-keywords="${escapeHtml(keywords)}">
          <button type="button" class="accordion-trigger" data-action="toggle-faq" aria-expanded="false" aria-controls="sellerHelpFaqPanel${index}">
            <span>${escapeHtml(faq.question)}</span>
            <span class="accordion-icon" aria-hidden="true">+</span>
          </button>
          <div class="accordion-panel" id="sellerHelpFaqPanel${index}" hidden>
            <p>${escapeHtml(faq.answer)}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  function render() {
    return `
      <section class="help-center" id="sellerHelpCenter" aria-label="Central de ajuda do vendedor">
        <div class="section-head">
          <div>
            <h2>Central de Ajuda</h2>
            <p>Um guia rápido para você vender com confiança pelo celular. Sempre que tiver dúvida, é só voltar aqui.</p>
          </div>
        </div>

        <div class="panel-card help-onboarding">
          <h3>Guia rápido — primeiros passos</h3>
          <ol class="help-steps">
            ${renderSteps()}
          </ol>
        </div>

        <div class="panel-card help-tips-panel">
          <h3>Dicas de venda</h3>
          <ul class="tip-list">
            ${renderTips()}
          </ul>
        </div>

        <form class="panel-card help-report-panel" data-help-report-form>
          <h3>Relatar bug ou pedir ajuda</h3>
          <p class="hint-inline">A mensagem vira uma tarefa para o administrador olhar.</p>
          <label>Tipo
            <select name="type">
              <option value="bug">Bug no app</option>
              <option value="duvida">Duvida de uso</option>
              <option value="melhoria">Sugestao de melhoria</option>
            </select>
          </label>
          <label>Mensagem
            <textarea name="message" required placeholder="Descreva o que aconteceu e em qual tela."></textarea>
          </label>
          <button type="submit">Enviar ao admin</button>
          <div data-help-report-feedback></div>
        </form>

        <div class="panel-card help-faq-panel">
          <h3>Perguntas frequentes</h3>
          <div class="help-search">
            <input
              type="search"
              id="sellerHelpSearch"
              data-help-search
              placeholder="Buscar por palavra-chave (ex.: preço, pedido, meta)"
              aria-label="Buscar pergunta frequente"
            />
          </div>
          <div class="accordion" id="sellerHelpFaqList" data-faq-list>
            ${renderFaqs()}
          </div>
          <div class="empty-state" data-faq-empty hidden></div>
        </div>
      </section>
    `;
  }

  function filterFaqs(root, rawQuery) {
    const query = String(rawQuery ?? '').trim().toLowerCase();
    const items = root.querySelectorAll('[data-faq-item]');
    let visibleCount = 0;

    items.forEach((item) => {
      const haystack = item.getAttribute('data-keywords') || '';
      const matches = !query || haystack.includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    const emptyState = root.querySelector('[data-faq-empty]');
    if (!emptyState) return;

    if (visibleCount === 0 && query) {
      emptyState.hidden = false;
      emptyState.innerHTML = `
        <strong>Nenhuma pergunta encontrada para "${escapeHtml(rawQuery.trim())}"</strong>
        <span>Tente outra palavra, como "preço", "pedido" ou "meta".</span>
      `;
    } else {
      emptyState.hidden = true;
      emptyState.innerHTML = '';
    }
  }

  function toggleFaq(trigger) {
    const item = trigger.closest('[data-faq-item]');
    if (!item) return;
    const panel = item.querySelector('.accordion-panel');
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!expanded));
    if (panel) panel.hidden = expanded;
    item.classList.toggle('open', !expanded);
  }

  function mount(container) {
    if (!container) return;

    let root = container.querySelector('#sellerHelpCenter');
    if (!root) {
      container.innerHTML = render();
      root = container.querySelector('#sellerHelpCenter');
    }
    if (!root) return;

    const searchInput = root.querySelector('[data-help-search]');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        filterFaqs(root, event.target.value);
      });
    }

    root.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-help-report-form]');
      if (!form) return;
      event.preventDefault();
      const feedback = form.querySelector('[data-help-report-feedback]');
      try {
        const data = U.formData(form);
        const typeLabel = data.type === 'bug' ? 'BUG' : data.type === 'melhoria' ? 'MELHORIA' : 'AJUDA';
        const currentUser = window.C360.state && window.C360.state.getCurrentUser ? window.C360.state.getCurrentUser() : null;
        await window.C360.state.add('tasks', {
          title: `[${typeLabel}] ${currentUser && currentUser.name ? currentUser.name : 'Usuario'}`,
          status: 'a_fazer',
          dueDate: null,
          notes: (data.message || '').trim(),
        });
        form.reset();
        if (feedback) feedback.innerHTML = '<div class="notice success">Mensagem enviada ao administrador.</div>';
      } catch (error) {
        if (feedback) feedback.innerHTML = `<div class="notice danger">${escapeHtml(error.message || 'Nao foi possivel enviar.')}</div>`;
      }
    });

    root.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-action="toggle-faq"]');
      if (!trigger || !root.contains(trigger)) return;
      toggleFaq(trigger);
    });
  }

  window.C360.sellerHelp = {
    render,
    mount,
  };
})();
