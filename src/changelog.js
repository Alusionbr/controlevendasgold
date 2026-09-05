(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;

  // ==========================================================================
  // Histórico de atualizações do sistema.
  //
  // Fonte única de verdade da tela "Novidades" e do selo de versão no
  // cabeçalho. É só DADO — nenhuma regra de negócio aqui.
  //
  // COMO MANTER (importante para quem continuar o projeto):
  //  1. Ao terminar uma alteração que o usuário perceba, adicione um item no
  //     RELEASE do topo (ou crie um novo release com a data de hoje).
  //  2. `date` é sempre AAAA-MM-DD; a lista deve ficar em ordem decrescente
  //     (mais recente primeiro) — a tela não reordena nada.
  //  3. `kind` aceita: 'novo' (funcionalidade nova), 'correcao' (bug),
  //     'melhoria' (ajuste de uso/desempenho) e 'tecnico' (mudança interna,
  //     sem efeito direto na tela).
  //  4. `version` é a data no formato AAAA.MM.DD — é o que aparece no
  //     cabeçalho. Mantenha igual à `date` do release mais recente.
  //  5. O mesmo conteúdo, em texto, fica em docs/historico-atualizacoes.md.
  // ==========================================================================

  const SEEN_KEY = 'controle360_changelog_visto_v1';

  const KIND_LABELS = {
    novo: 'Novo',
    correcao: 'Correção',
    melhoria: 'Melhoria',
    tecnico: 'Interno',
  };

  const RELEASES = [
    {
      date: '2026-09-04',
      title: 'Histórico de atualizações e revisão geral',
      summary: 'Agora dá para ver, dentro do sistema, o que mudou e quando. Junto, uma rodada de correções encontradas na revisão.',
      changes: [
        { kind: 'novo', text: 'Tela "Novidades": lista das atualizações do sistema com data, tipo (novo, correção, melhoria) e resumo do que mudou.' },
        { kind: 'novo', text: 'Selo de versão no cabeçalho, com aviso quando existe atualização que você ainda não leu.' },
        { kind: 'correcao', text: 'Receita recebida contava duas vezes a entrada de um pedido de revenda pago à vista/parcial (uma vez como pagamento do vendedor, outra como pagamento de consignado). Agora conta uma só vez.' },
        { kind: 'correcao', text: 'Mensagens de sucesso e de erro do painel de Vendas (lançar venda, aprovar/rejeitar pedido, gerar link) sumiam da tela no mesmo instante em que apareciam. Agora ficam visíveis.' },
        { kind: 'correcao', text: 'O mesmo acontecia na conferência de devoluções, desperdícios e brindes: confirmar ou recusar não mostrava nem confirmação nem o motivo do erro.' },
        { kind: 'correcao', text: 'Permissões do vendedor (pode pedir consignado, pode gerar link público, desconto máximo, liberação de acerto de estoque e de alinhamento de saldo) tinham ficado sem tela: voltaram para dentro da aba Vendedores.' },
        { kind: 'correcao', text: 'Uma falha ao carregar as contas por pedido derrubava o carregamento inteiro e a tela abria zerada, sem explicação.' },
        { kind: 'correcao', text: 'Na aba Preços, salvar preço padrão ou piso gravava no servidor mas a tela continuava mostrando o valor antigo — parecia que não tinha salvado, e a validação de preço mínimo na venda seguia usando o valor velho.' },
        { kind: 'melhoria', text: 'Backup em Excel passou a incluir piso de preço e preço padrão do produto, além do valor pago na entrada do carrinho.' },
        { kind: 'correcao', text: 'Na tela do vendedor, o título e a explicação de cada quadro apareciam grudados ("Informar pagamentoO saldo muda somente..."). Agora ficam em linhas separadas.' },
        { kind: 'melhoria', text: 'Textos do acompanhamento de pagamento do vendedor corrigidos (acentuação).' },
      ],
    },
    {
      date: '2026-08-10',
      title: 'Conta do vendedor mais direta',
      summary: 'A tela do vendedor passou a abrir pelo acompanhamento de pagamento e o administrador ganhou o lançamento de débito avulso.',
      changes: [
        { kind: 'novo', text: 'Acompanhamento de pagamento no topo da tela do vendedor: há quantos dias foi o último pagamento confirmado.' },
        { kind: 'novo', text: 'Aba Vendedores: "Incluir dívida sem carrinho", para acertar um débito que não nasceu de venda, pedido ou envio de estoque.' },
        { kind: 'melhoria', text: 'Saldo do vendedor simplificado: "Total pendente" quando há dívida e "Em dia" quando não há.' },
        { kind: 'correcao', text: 'Sequência de logins diários do vendedor exibia o número errado.' },
        { kind: 'correcao', text: 'Conta do vendedor podia abrir sem carregar os lançamentos.' },
      ],
    },
    {
      date: '2026-07-30',
      title: 'Pagamentos com comprovante e senha do vendedor',
      summary: 'O vendedor informa o pagamento com comprovante e o administrador confere antes de o valor entrar na receita.',
      changes: [
        { kind: 'novo', text: 'Vendedor informa pagamento com foto ou PDF do comprovante; enquanto não é conferido, nada muda no saldo.' },
        { kind: 'novo', text: 'Fila de conferência de pagamentos na aba Vendedores, com ajuste de valor, data e forma antes de lançar.' },
        { kind: 'novo', text: 'Vendedor pode trocar a própria senha; o administrador pode redefinir usuário e senha de qualquer vendedor.' },
        { kind: 'novo', text: 'Tarefa de entrar 15 dias seguidos, com brindes acumulados.' },
        { kind: 'correcao', text: 'Envio de comprovante pelo vendedor falhava em alguns casos.' },
      ],
    },
    {
      date: '2026-07-29',
      title: 'Conta por pedido, login por usuário e receita só quando paga',
      summary: 'Cada envio para o vendedor virou uma conta separada, com seus itens, pagamentos e saldo.',
      changes: [
        { kind: 'novo', text: 'Contas por pedido: cada envio mantém itens, pagamentos e saldo próprios, em vez de um saldo único e opaco.' },
        { kind: 'novo', text: 'Login do vendedor por nome de usuário (sem precisar de e-mail).' },
        { kind: 'melhoria', text: 'Consignado só vira receita quando o pagamento é registrado — informar a venda não conta como dinheiro entrando.' },
        { kind: 'melhoria', text: 'Cadastro de produto reduzido ao essencial, com o resto em "Mais opções".' },
        { kind: 'novo', text: 'Histórico de alterações por registro (quem mudou o quê e quando) em produtos e clientes.' },
      ],
    },
    {
      date: '2026-07-28',
      title: 'Backup completo',
      summary: 'O Excel exportado passou a levar tudo que o sistema guarda.',
      changes: [
        { kind: 'correcao', text: 'O backup em Excel deixava de fora a dívida dos vendedores, pagamentos, estoque em mãos, devoluções, preços por vendedor e metas.' },
      ],
    },
    {
      date: '2026-07-27',
      title: 'Recebimentos do dia, custos e correções de gravação',
      summary: 'Rodada grande de correções: telas que não salvavam, números que não atualizavam e estoque valendo R$ 0.',
      changes: [
        { kind: 'novo', text: '"Recebimentos do dia" na tela Hoje, separando pagamentos de vendedores, de clientes e vendas à vista.' },
        { kind: 'correcao', text: 'Editar produto, editar cliente e baixar lançamento financeiro não salvavam nada — sem erro na tela.' },
        { kind: 'correcao', text: 'Estoque cadastrado sem custo ficava valendo R$ 0 para sempre; agora o ajuste pede o custo e existe correção em massa.' },
        { kind: 'correcao', text: 'Os números do painel do topo ficavam parados depois de um pagamento, envio ou devolução.' },
        { kind: 'correcao', text: 'Consignado enviado ao vendedor não aparecia na aba Consignado e parecia não ter sido registrado.' },
        { kind: 'melhoria', text: 'Relatórios com gráficos e filtros por produto, canal e período.' },
        { kind: 'melhoria', text: 'Interface do computador mais compacta, com mais informação sem rolar a tela.' },
      ],
    },
    {
      date: '2026-07-25',
      title: 'Despacho de pedido à prova de falha',
      summary: 'O despacho passou a acontecer inteiro ou não acontecer — nunca pela metade.',
      changes: [
        { kind: 'correcao', text: 'Despacho de pedido podia gravar estoque e consignação e falhar no meio, deixando o pedido travado e permitindo duplicar na segunda tentativa.' },
        { kind: 'melhoria', text: 'Dívida da revenda passa a nascer na aprovação do pedido, não só no despacho.' },
      ],
    },
    {
      date: '2026-07-24',
      title: 'Painel do vendedor somente leitura',
      summary: 'Toda movimentação de estoque e dinheiro passou a ser do administrador.',
      changes: [
        { kind: 'melhoria', text: 'O vendedor passou a ter uma única tela, de consulta: saldo, pedidos e pagamentos. Quem movimenta estoque e dinheiro é o administrador.' },
      ],
    },
    {
      date: '2026-07-14',
      title: 'Financeiro, compras com vários itens e visão 360',
      summary: 'Contas a pagar e a receber, compras agrupadas e telas de detalhe de cliente e produto.',
      changes: [
        { kind: 'novo', text: 'Aba Financeiro com contas a pagar e a receber, vencimento, baixa parcial e envelhecimento.' },
        { kind: 'novo', text: 'Compra com vários itens no mesmo lançamento, atualizando estoque, custo médio e conta a pagar de uma vez.' },
        { kind: 'novo', text: 'Visão 360 do cliente e do produto, com histórico e edição.' },
        { kind: 'novo', text: 'Relatórios operacionais com filtro por período.' },
      ],
    },
    {
      date: '2026-07-08',
      title: 'Conta corrente do vendedor, devoluções e relatórios',
      summary: 'Pacote que organizou a relação com o vendedor de ponta a ponta.',
      changes: [
        { kind: 'novo', text: 'Conta corrente do vendedor: o saldo é sempre a soma dos lançamentos, nunca um número sobrescrito.' },
        { kind: 'novo', text: 'Devolução com status, desperdício e brinde — só a conferência do administrador altera estoque e dívida.' },
        { kind: 'novo', text: 'Reposição em carrinhos, com pagamento parcial de valor real.' },
        { kind: 'novo', text: 'Navegação por celular com barra inferior, menu "Mais" e tela "Hoje".' },
        { kind: 'novo', text: 'Relatórios de saldo por vendedor, pedidos em aberto, devoluções pendentes, desperdício, brindes e estoque em trânsito.' },
      ],
    },
    {
      date: '2026-07-07',
      title: 'Carrinho de vendas, aprovações e links públicos',
      summary: 'Venda e pedido passaram a nascer de um carrinho, com aprovação do administrador.',
      changes: [
        { kind: 'novo', text: 'Carrinho de produtos em Vendas e Pedidos, com aprovação do administrador antes de o estoque sair.' },
        { kind: 'novo', text: 'Link público de carrinho para o cliente montar o próprio pedido.' },
        { kind: 'correcao', text: 'Pedidos, vendas, compras e tarefas falhavam ao salvar quando um campo opcional ficava em branco.' },
        { kind: 'correcao', text: 'E-mail do vendedor não aparecia na tela de gestão — causa do "senha inválida" ao tentar entrar.' },
      ],
    },
  ];

  const VERSION = String(RELEASES[0].date).replace(/-/g, '.');

  function latest() {
    return RELEASES[0];
  }

  function lastSeenDate() {
    try {
      return localStorage.getItem(SEEN_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, latest().date);
    } catch (error) {
      // Navegador sem armazenamento local: o aviso só aparece de novo, sem quebrar nada.
    }
  }

  function hasUnseen() {
    return lastSeenDate() !== latest().date;
  }

  function formatDate(isoDate) {
    const [year, month, day] = String(isoDate || '').split('-');
    if (!year || !month || !day) return String(isoDate || '');
    return `${day}/${month}/${year}`;
  }

  function changeItem(change) {
    const kind = KIND_LABELS[change.kind] ? change.kind : 'melhoria';
    return `
      <li class="changelog-change is-${U.escapeHtml(kind)}">
        <span class="changelog-kind">${U.escapeHtml(KIND_LABELS[kind])}</span>
        <span>${U.escapeHtml(change.text)}</span>
      </li>`;
  }

  function releaseCard(release, index) {
    return `
      <article class="panel-card changelog-release">
        <div class="changelog-release-head">
          <div>
            <h3>${U.escapeHtml(release.title)}</h3>
            <p class="hint-inline">${U.escapeHtml(release.summary || '')}</p>
          </div>
          <div class="changelog-release-meta">
            ${UI.badge(formatDate(release.date), index === 0 ? 'ok' : '')}
            ${index === 0 ? UI.badge('Última atualização', 'warn') : ''}
          </div>
        </div>
        <ul class="changelog-change-list">${release.changes.map(changeItem).join('')}</ul>
      </article>`;
  }

  function render() {
    const current = latest();
    return UI.section(
      'Novidades do sistema',
      'O que mudou em cada atualização, da mais recente para a mais antiga.',
      `
        <div class="dashboard changelog-metrics">
          ${UI.metric('Versão atual', U.escapeHtml(VERSION), null)}
          ${UI.metric('Última atualização', formatDate(current.date), null)}
          ${UI.metric('Alterações nesta versão', String(current.changes.length), null)}
        </div>
        <div class="changelog-list">${RELEASES.map(releaseCard).join('')}</div>
        <p class="hint-inline">Precisa do histórico em texto (para enviar a alguém ou continuar o projeto)? Ele fica em <strong>docs/historico-atualizacoes.md</strong>, no código do sistema.</p>
      `
    );
  }

  function mount(container) {
    if (!container) return;
    container.innerHTML = render();
    markSeen();
  }

  window.C360.changelog = {
    VERSION,
    RELEASES,
    latest,
    render,
    mount,
    hasUnseen,
    markSeen,
  };
})();
