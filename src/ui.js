(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const { escapeHtml, money, qty, compact, number } = window.C360.utils;

  // Textos de ajuda em linguagem simples, pensados para quem não é da área.
  // Cada chave aparece como balão ao passar o mouse ou tocar no ícone "ⓘ".
  const HELP = {
    // Painel
    valorEstoque: 'Quanto dinheiro está "parado" no seu estoque agora: soma de (quantidade em estoque × custo médio) de cada produto.',
    alertasEstoque: 'Quantos produtos estão no estoque mínimo ou abaixo dele. Servem de aviso para você repor a tempo.',
    receitaLiquida: 'Tudo que entrou com as vendas, já tirando descontos e taxas. É o valor antes de descontar o custo dos produtos.',
    lucroBruto: 'O que sobra das vendas depois de tirar o custo dos produtos vendidos (CMV). Ainda não desconta despesas fixas como aluguel.',
    consignadoAberto: 'Valor que clientes com produtos em consignação já venderam, mas ainda não te pagaram.',
    pedidosPendentes: 'Pedidos que ainda não foram despachados nem concluídos.',
    // Negócio
    margemDesejada: 'Quanto você quer ganhar sobre o preço de venda, em %. Ex.: 50% = metade do preço é lucro planejado. O sistema usa isso para sugerir o preço de venda.',
    taxasPadrao: 'Taxas que costumam cair nas suas vendas, em %: maquininha de cartão, comissão de marketplace, etc. Entram no cálculo do preço sugerido.',
    // Produto
    tipoProduto: 'Matéria-prima e embalagem são insumos. Produto final / kit é o que você fabrica. Mercadoria é revenda pronta. Serviço não controla estoque.',
    estoqueInicial: 'Quantas unidades desse item você já tem hoje, antes de lançar compras.',
    custoMedioInicial: 'Quanto custa, em média, cada unidade que você já tem. Depois as compras recalculam esse valor sozinhas.',
    precoVendaManual: 'Preço fixo de venda, se quiser definir na mão. Deixe 0 para usar o preço sugerido calculado pela ficha técnica.',
    estoqueMinimo: 'Quando o estoque chegar nesse número, o painel mostra um alerta para você repor.',
    maoDeObra: 'Quanto custa o trabalho (seu ou de funcionário) para fazer 1 unidade.',
    custoFixo: 'Parte das despesas fixas (luz, gás, aluguel) que você joga em cada unidade. É um rateio aproximado.',
    perdaTecnica: 'Quanto se perde na produção, em %: sobra, evaporação, quebra. Aumenta o custo final da unidade.',
    margemDesejadaProduto: 'Lucro planejado sobre o preço deste produto, em %. Se deixar vazio, usa a margem padrão do negócio.',
    taxasProduto: 'Taxas sobre a venda deste produto, em %: cartão, marketplace, etc. Se deixar vazio, usa a taxa padrão do negócio.',
    // Compras
    valorTotalCompra: 'Valor total pago na compra (todas as unidades juntas). O sistema divide pela quantidade e recalcula o custo médio.',
    // Fichas e custos
    fichaTecnica: 'A "receita" do produto: quais insumos e embalagens entram e quanto de cada um para fazer 1 unidade. Serve para calcular o custo.',
    qtdPorUnidade: 'Quanto desse insumo entra em 1 unidade do produto final. Ex.: 100 ml de essência, 1 vidro, 1 rótulo.',
    precoSugerido: 'Preço de venda que o sistema calcula para você bater a margem desejada, já considerando custo e taxas.',
    // Produção
    qtdProduzida: 'Quantas unidades do produto final você está fabricando agora. O sistema baixa os insumos da ficha e dá entrada no produto pronto.',
    // Vendas
    canal: 'Onde a venda aconteceu: loja, WhatsApp, marketplace, consignado, etc.',
    descontoTotal: 'Desconto dado nesta venda, em dinheiro (não em %).',
    taxaFixaTotal: 'Taxa em dinheiro cobrada na venda (ex.: taxa fixa da maquininha por transação).',
    taxaPercentual: 'Taxa em % sobre o valor da venda (ex.: comissão do marketplace, % do cartão).',
    cmv: 'CMV = Custo da Mercadoria Vendida. Quanto te custou o que você vendeu: quantidade × custo médio no momento da venda.',
    // Pedidos
    precoCombinado: 'Preço por unidade combinado com o cliente neste pedido.',
    statusInicial: 'Em que etapa o pedido começa. Depois você arrasta o cartão entre as colunas.',
    // Consignado
    consignado: 'Você entrega produtos ao cliente sem vender ainda: o estoque sai do seu controle e fica "com o cliente". A venda só conta quando ele avisa que vendeu.',
    qtdEnviada: 'Quantas unidades você está entregando ao cliente para ele tentar vender.',
    precoCombinadoConsig: 'Preço por unidade combinado para quando o cliente vender.',
  };

  // Ícone de ajuda. Aceita uma chave do dicionário HELP ou um texto direto.
  function help(keyOrText) {
    const text = HELP[keyOrText] || keyOrText || '';
    if (!text) return '';
    return `<span class="help" tabindex="0" role="button" aria-label="Ajuda: ${escapeHtml(text)}" data-tip="${escapeHtml(text)}">i</span>`;
  }

  // Rótulo de campo com ícone de ajuda na mesma linha.
  function fieldLabel(text, helpKey) {
    return `<span class="field-label">${escapeHtml(text)} ${help(helpKey)}</span>`;
  }

  function optionList(items, selectedValue = '', placeholder = 'Selecione') {
    const first = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '';
    return first + items.map((item) => {
      const value = typeof item === 'string' ? item : item.value ?? item.id;
      const label = typeof item === 'string' ? item : item.label ?? item.name;
      const selected = String(value) === String(selectedValue) ? 'selected' : '';
      return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function table(headers, rows, emptyMessage = 'Nenhum registro ainda.') {
    if (!rows.length) {
      return `<div class="empty-state"><strong>${escapeHtml(emptyMessage)}</strong><span>Os dados aparecerão aqui após os lançamentos.</span></div>`;
    }

    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function metric(label, value, helpKey) {
    return `<article class="metric-card"><span>${escapeHtml(label)}${helpKey ? ' ' + help(helpKey) : ''}</span><strong>${value}</strong></article>`;
  }

  function badge(text, type = '') {
    return `<span class="badge ${escapeHtml(type)}">${escapeHtml(text)}</span>`;
  }

  function productName(product) {
    if (!product) return 'Produto removido';
    return `${escapeHtml(product.name)} <span class="badge">${escapeHtml(product.unit)}</span>`;
  }

  function moneyCell(value) {
    return `<strong>${money(value)}</strong>`;
  }

  function stockCell(product) {
    const current = number(product.currentStock);
    const minimum = number(product.minStock);
    const warning = minimum > 0 && current <= minimum ? 'warn' : 'ok';
    return `${qty(current, product.unit)} ${minimum > 0 ? badge(`mín. ${qty(minimum, product.unit)}`, warning) : ''}`;
  }

  function actionButton(action, id, label, extraClass = 'secondary') {
    return `<button type="button" class="small ${extraClass}" data-action="${escapeHtml(action)}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  }

  function section(title, description, content, titleHelp = '', right = '') {
    return `
      <div class="section-head">
        <div>
          <h2>${escapeHtml(title)}${titleHelp ? ' ' + help(titleHelp) : ''}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <div>${right}</div>
      </div>
      ${content}
    `;
  }

  function formNotice(message, type = '') {
    return `<div class="notice ${type}">${escapeHtml(message)}</div>`;
  }

  function costBox(cost) {
    return `
      <div class="cost-box">
        <div class="cost-item"><span>Materiais por unidade</span><strong>${money(cost.materialsCost)}</strong></div>
        <div class="cost-item"><span>Mão de obra + fixos</span><strong>${money(cost.laborCost + cost.overheadCost)}</strong></div>
        <div class="cost-item"><span>Custo final por unidade</span><strong>${money(cost.totalCostPerUnit)}</strong></div>
        <div class="cost-item"><span>Preço sugerido ${help('precoSugerido')}</span><strong>${money(cost.suggestedSalePrice)}</strong></div>
      </div>
    `;
  }

  function kanban({ statuses, cards, type }) {
    return `<div class="kanban" data-kanban-type="${escapeHtml(type)}">
      ${statuses.map((status) => {
        const filtered = cards.filter((card) => card.status === status.value);
        return `
          <div class="kanban-column" data-status="${escapeHtml(status.value)}">
            <h3>${escapeHtml(status.label)} ${badge(String(filtered.length))}</h3>
            <div class="kanban-dropzone">
              ${filtered.map((card) => `
                <article class="kanban-card" draggable="true" data-card-id="${escapeHtml(card.id)}">
                  <strong>${escapeHtml(card.title)}</strong>
                  ${card.subtitle ? `<p>${escapeHtml(card.subtitle)}</p>` : ''}
                  ${card.detail ? `<p>${escapeHtml(card.detail)}</p>` : ''}
                  <div class="actions">${card.actions || ''}</div>
                </article>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>`;
  }

  window.C360.ui = {
    HELP,
    help,
    fieldLabel,
    optionList,
    table,
    metric,
    badge,
    productName,
    moneyCell,
    stockCell,
    actionButton,
    section,
    formNotice,
    costBox,
    kanban,
    compact,
  };
})();
