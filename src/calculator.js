(function () {
  'use strict';

  // Módulo "Calculadora" (aba Calculadora).
  // Expõe window.C360.calculator = { render, mount }.
  //
  // CSS novo necessário (ainda não existe em styles/main.css — não editado por
  // este arquivo, apenas listado aqui e no relatório para o agente MOBILE/SEC):
  //   .calculator-card   — cartão que envolve a calculadora padrão (pode herdar de .panel-card)
  //   .calc-display      — moldura do visor (número grande, alinhado à direita)
  //   .calc-expression   — linha pequena acima do visor com a operação pendente
  //   .calc-value        — número grande do visor
  //   .calc-keypad       — grid 4 colunas para as teclas
  //   .calc-key          — tamanho/toque das teclas (usadas junto com .secondary/.ghost/.danger já existentes)
  //   .calc-key.span2    — tecla que ocupa 2 colunas (o "0")
  //   .calc-field        — rótulo + input empilhados nos mini-formulários de negócio

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const UI = window.C360.ui;
  const S = window.C360.state;
  const Calc = window.C360.calc;

  const OPERATORS = ['+', '-', '×', '÷'];

  function formatPercent(value) {
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  }

  function placeholderResult() {
    return '<div class="cost-item"><span>Resultado</span><strong>—</strong></div>';
  }

  // ---------- HTML ----------

  function render() {
    return `
      <div class="calculator-page">
        ${renderStandardCalculator()}
        ${renderQuickSale()}
        ${renderBusinessTools()}
      </div>
    `;
  }

  function state() { return S.getState(); }
  function currentUser() { return S.getCurrentUser(); }
  function isAdmin() { return S.isAdmin(); }
  function productById(id) { return (state().products || []).find((item) => String(item.id) === String(id)) || null; }
  function sellerPriceForProduct(productId) {
    return (state().sellerPrices || []).find((row) => String(row.productId) === String(productId)) || null;
  }

  function quickSaleProductOptions() {
    const products = (state().products || []).filter((product) => !['materia_prima', 'embalagem'].includes(product.type));
    return UI.optionList(products.map((product) => ({
      id: product.id,
      name: `${product.name} - ${U.money(product.defaultPrice || product.salePrice || 0)}`,
    })), '', 'Produto');
  }

  function renderQuickSale() {
    return `
      <div class="panel-card calc-quick-sale" data-calc-sale-root>
        <h3>Venda rapida</h3>
        <form class="grid-form compact-form" data-calc-sale-add>
          <label>Produto
            <select name="productId" required>${quickSaleProductOptions()}</select>
          </label>
          <label>Qtd.
            <input name="quantity" type="number" min="0.001" step="0.001" required>
          </label>
          <label>Preco unitario
            <input name="unitPrice" type="number" min="0.01" step="0.01" required>
          </label>
          <button type="submit">Adicionar</button>
        </form>
        <div data-calc-sale-feedback></div>
        <div data-calc-sale-items></div>
        <div class="cart-total"><span>Total</span><strong data-calc-sale-total>${U.money(0)}</strong></div>
        <div class="actions">
          <button type="button" data-calc-sale-save disabled>Salvar venda</button>
          <button type="button" class="ghost" data-calc-sale-clear>Limpar</button>
        </div>
      </div>
    `;
  }

  function renderStandardCalculator() {
    return `
      <div class="panel-card calculator-card" id="calcStandard" tabindex="0" aria-label="Calculadora. Use o teclado numérico ou toque nos botões.">
        <h3>Calculadora</h3>
        <div class="calc-display" id="calcDisplay" aria-live="polite">
          <div class="calc-expression" id="calcExpression">&nbsp;</div>
          <div class="calc-value" id="calcValue">0</div>
        </div>
        <div class="calc-keypad" id="calcKeypad" role="group" aria-label="Teclado da calculadora">
          <button type="button" class="calc-key ghost danger" data-calc="clear" aria-label="Limpar tudo">C</button>
          <button type="button" class="calc-key ghost" data-calc="backspace" aria-label="Apagar último dígito">⌫</button>
          <button type="button" class="calc-key ghost" data-calc="percent" aria-label="Porcentagem">%</button>
          <button type="button" class="calc-key secondary" data-calc="op" data-op="÷" aria-label="Dividir">÷</button>

          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="7">7</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="8">8</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="9">9</button>
          <button type="button" class="calc-key secondary" data-calc="op" data-op="×" aria-label="Multiplicar">×</button>

          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="4">4</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="5">5</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="6">6</button>
          <button type="button" class="calc-key secondary" data-calc="op" data-op="-" aria-label="Subtrair">âˆ’</button>

          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="1">1</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="2">2</button>
          <button type="button" class="calc-key ghost" data-calc="digit" data-digit="3">3</button>
          <button type="button" class="calc-key secondary" data-calc="op" data-op="+" aria-label="Somar">+</button>

          <button type="button" class="calc-key ghost span2" data-calc="digit" data-digit="0">0</button>
          <button type="button" class="calc-key ghost" data-calc="decimal" aria-label="Vírgula decimal">,</button>
          <button type="button" class="calc-key" data-calc="equals" aria-label="Igual">=</button>
        </div>
      </div>
    `;
  }

  function renderBusinessTools() {
    return UI.section(
      'Cálculos do negócio',
      'Ferramentas rápidas de precificação para cosméticos e perfumaria: margem, markup, desconto e preço com margem alvo.',
      `
        <div class="three-columns">
          ${renderMargemTool()}
          ${renderMarkupTool()}
          ${renderDescontoTool()}
          ${renderMargemAlvoTool()}
        </div>
      `
    );
  }

  function renderMargemTool() {
    return `
      <div class="panel-card calc-tool" data-calc-tool="margem">
        <h3>Margem ${UI.help('Informe o custo e o preço de venda para ver a margem % e o lucro em R$.')}</h3>
        <div class="calc-field">
          <label for="calcMargemCusto">Custo (R$)</label>
          <input id="calcMargemCusto" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        </div>
        <div class="calc-field">
          <label for="calcMargemPreco">Preço de venda (R$)</label>
          <input id="calcMargemPreco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        </div>
        <div class="cost-box" id="calcMargemResultado">${placeholderResult()}</div>
      </div>
    `;
  }

  function renderMarkupTool() {
    return `
      <div class="panel-card calc-tool" data-calc-tool="markup">
        <h3>Markup ${UI.help('Informe o custo e o percentual de markup para ver o preço de venda sugerido.')}</h3>
        <div class="calc-field">
          <label for="calcMarkupCusto">Custo (R$)</label>
          <input id="calcMarkupCusto" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        </div>
        <div class="calc-field">
          <label for="calcMarkupPercent">Markup (%)</label>
          <input id="calcMarkupPercent" type="number" inputmode="decimal" step="0.01" placeholder="Ex.: 150">
        </div>
        <div class="cost-box" id="calcMarkupResultado">${placeholderResult()}</div>
      </div>
    `;
  }

  function renderDescontoTool() {
    return `
      <div class="panel-card calc-tool" data-calc-tool="desconto">
        <h3>Desconto ${UI.help('Informe o preço e o percentual de desconto para ver o preço final e o valor descontado.')}</h3>
        <div class="calc-field">
          <label for="calcDescontoPreco">Preço (R$)</label>
          <input id="calcDescontoPreco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        </div>
        <div class="calc-field">
          <label for="calcDescontoPercent">Desconto (%)</label>
          <input id="calcDescontoPercent" type="number" inputmode="decimal" step="0.01" min="0" max="100" placeholder="Ex.: 10">
        </div>
        <div class="cost-box" id="calcDescontoResultado">${placeholderResult()}</div>
      </div>
    `;
  }

  function renderMargemAlvoTool() {
    return `
      <div class="panel-card calc-tool" data-calc-tool="margem-alvo">
        <h3>Preço com margem alvo ${UI.help('Informe o custo e a margem que você quer ganhar para ver o preço sugerido.')}</h3>
        <div class="calc-field">
          <label for="calcAlvoCusto">Custo (R$)</label>
          <input id="calcAlvoCusto" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00">
        </div>
        <div class="calc-field">
          <label for="calcAlvoPercent">Margem alvo (%)</label>
          <input id="calcAlvoPercent" type="number" inputmode="decimal" step="0.01" min="0" max="99.99" placeholder="Ex.: 50">
        </div>
        <div class="cost-box" id="calcAlvoResultado">${placeholderResult()}</div>
      </div>
    `;
  }

  // ---------- Wiring (escopado ao container, sem depender do delegador global) ----------

  function mount(container) {
    if (!container) return;
    wireStandardCalculator(container);
    wireQuickSale(container);
    wireMargemTool(container);
    wireMarkupTool(container);
    wireDescontoTool(container);
    wireMargemAlvoTool(container);
  }

  async function saveCalculatorSaleItems(items) {
    const user = currentUser();
    if (!user) throw new Error('Entre na sua conta antes de vender.');
    if (!items.length) throw new Error('Adicione pelo menos um item.');

    for (const item of items) {
      const product = productById(item.productId);
      const quantity = U.number(item.quantity);
      const unitPrice = U.number(item.unitPrice);
      if (!product) throw new Error('Produto nao encontrado.');
      if (quantity <= 0) throw new Error('Quantidade precisa ser maior que zero.');
      if (unitPrice <= 0) throw new Error('Preco unitario precisa ser maior que zero.');

      if (user.role === 'vendedor' && Calc.resolveSellerPrice && Calc.validatePriceFloor) {
        const sellerPrice = sellerPriceForProduct(product.id);
        const { floor } = Calc.resolveSellerPrice({ product, sellerPrice });
        const floorCheck = Calc.validatePriceFloor({ unitPrice, floor });
        if (!floorCheck.ok) throw new Error(floorCheck.message);
      }

      const unitCost = U.number(product.avgCost);
      const math = Calc.saleMath({ quantity, unitPrice, discount: 0, fixedFees: 0, feePercent: 0, unitCost });

      if (user.role === 'vendedor' && product.type !== 'servico') {
        const stockRow = (state().sellerStock || []).find((row) => String(row.sellerId) === String(user.id) && String(row.productId) === String(product.id));
        if (!stockRow || U.number(stockRow.quantity) < quantity) {
          throw new Error(`${product.name} nao tem estoque proprio suficiente.`);
        }
        // eslint-disable-next-line no-await-in-loop
        await window.C360.api.consumeSellerStock({ productId: product.id, quantity });
        // eslint-disable-next-line no-await-in-loop
        const sale = await S.add('sales', {
          date: U.today(),
          channel: 'Calculadora',
          clientId: null,
          productId: product.id,
          quantity,
          unitPrice,
          discount: 0,
          fixedFees: 0,
          feePercent: 0,
          unitCost,
          ...math,
          notes: 'Venda rapida pela calculadora',
          origin: 'calculadora',
          originId: null,
        });
        // eslint-disable-next-line no-await-in-loop
        const consignment = await S.add('consignments', {
          sellerId: user.id,
          clientId: null,
          productId: product.id,
          quantitySent: quantity,
          quantitySold: quantity,
          quantityReturned: 0,
          unitPrice,
          costAtSend: unitCost,
          amountPaid: 0,
          status: 'com_cliente',
          date: U.today(),
          notes: `Venda calculadora ${sale.id}`,
        });
        if (consignment && consignment.id) {
          // eslint-disable-next-line no-await-in-loop
          await S.add('consignmentEvents', {
            consignmentId: consignment.id,
            type: 'venda_cliente',
            date: U.today(),
            quantity,
            amount: quantity * unitPrice,
          });
        }
      } else {
        if (product.type !== 'servico' && U.number(product.currentStock) < quantity) {
          throw new Error(`${product.name} nao tem estoque suficiente.`);
        }
        // eslint-disable-next-line no-await-in-loop
        await S.add('sales', {
          date: U.today(),
          channel: 'Calculadora',
          clientId: null,
          productId: product.id,
          quantity,
          unitPrice,
          discount: 0,
          fixedFees: 0,
          feePercent: 0,
          unitCost,
          ...math,
          notes: 'Venda rapida pela calculadora',
          origin: 'calculadora',
          originId: null,
        });
        if (isAdmin() && product.type !== 'servico') {
          // eslint-disable-next-line no-await-in-loop
          await S.update('products', product.id, { currentStock: U.number(product.currentStock) - quantity });
          // eslint-disable-next-line no-await-in-loop
          await S.recordMovement({
            date: U.today(),
            type: 'saida_venda',
            productId: product.id,
            quantity: -quantity,
            unitCost,
            totalCost: -(quantity * unitCost),
            notes: 'Venda rapida pela calculadora',
          });
        }
      }
    }
    await S.refresh();
  }

  function wireQuickSale(container) {
    const root = container.querySelector('[data-calc-sale-root]');
    if (!root) return;
    const form = root.querySelector('[data-calc-sale-add]');
    const itemsEl = root.querySelector('[data-calc-sale-items]');
    const totalEl = root.querySelector('[data-calc-sale-total]');
    const feedbackEl = root.querySelector('[data-calc-sale-feedback]');
    const saveButton = root.querySelector('[data-calc-sale-save]');
    const clearButton = root.querySelector('[data-calc-sale-clear]');
    const items = [];

    function setFeedback(message, type = 'info') {
      feedbackEl.innerHTML = message ? UI.formNotice(message, type) : '';
    }

    function suggestedPrice(product) {
      if (!product) return 0;
      if (currentUser()?.role === 'vendedor' && Calc.resolveSellerPrice) {
        return Calc.resolveSellerPrice({ product, sellerPrice: sellerPriceForProduct(product.id) }).price;
      }
      return product.defaultPrice || product.salePrice || 0;
    }

    function renderItems() {
      const rows = items.map((item, index) => {
        const product = productById(item.productId);
        return [
          U.escapeHtml(product ? product.name : 'Produto'),
          U.qty(item.quantity, product?.unit),
          UI.moneyCell(item.unitPrice),
          UI.moneyCell(U.number(item.quantity) * U.number(item.unitPrice)),
          `<button type="button" class="small danger" data-calc-sale-remove="${index}">Remover</button>`,
        ];
      });
      itemsEl.innerHTML = UI.table(['Produto', 'Qtd.', 'Unitario', 'Total', ''], rows, 'Nenhum item na venda.');
      totalEl.textContent = U.money(items.reduce((sum, item) => sum + U.number(item.quantity) * U.number(item.unitPrice), 0));
      saveButton.disabled = items.length === 0;
    }

    form.addEventListener('change', (event) => {
      if (event.target.name !== 'productId') return;
      const product = productById(event.target.value);
      if (product && form.elements.unitPrice && !form.elements.unitPrice.dataset.touched) {
        form.elements.unitPrice.value = suggestedPrice(product);
      }
    });
    form.elements.unitPrice?.addEventListener('input', (event) => { event.target.dataset.touched = '1'; });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = U.formData(form);
      const product = productById(data.productId);
      if (!product) return;
      items.push({
        productId: data.productId,
        quantity: U.number(data.quantity),
        unitPrice: U.number(data.unitPrice || suggestedPrice(product)),
      });
      form.reset();
      if (form.elements.unitPrice) delete form.elements.unitPrice.dataset.touched;
      setFeedback('');
      renderItems();
    });

    itemsEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-calc-sale-remove]');
      if (!button) return;
      items.splice(Number(button.dataset.calcSaleRemove), 1);
      renderItems();
    });

    clearButton.addEventListener('click', () => {
      items.splice(0, items.length);
      setFeedback('');
      renderItems();
    });

    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        await saveCalculatorSaleItems(items);
        items.splice(0, items.length);
        setFeedback('Venda salva e estoque atualizado.', 'success');
        renderItems();
        if (window.C360.app && typeof window.C360.app.refresh === 'function') window.C360.app.refresh();
      } catch (error) {
        setFeedback(error.message, 'danger');
        saveButton.disabled = items.length === 0;
      }
    });

    renderItems();
  }

  function wireStandardCalculator(container) {
    const card = container.querySelector('#calcStandard');
    const keypad = container.querySelector('#calcKeypad');
    const valueEl = container.querySelector('#calcValue');
    const exprEl = container.querySelector('#calcExpression');
    if (!card || !keypad || !valueEl || !exprEl) return;

    let current = '0'; // string bruta digitada: dígitos + no máximo uma vírgula
    let previous = null; // número (operando anterior)
    let operator = null; // '+' | '-' | '×' | '÷'
    let overwrite = false; // true logo após operador/igual/porcentagem: próximo dígito começa número novo
    let errorState = false;

    function parseCurrent() {
      const normalized = current.replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatNumber(value) {
      return value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
    }

    function formatRawForDisplay(raw) {
      const [intPart, decPart] = raw.split(',');
      const cleanInt = intPart.replace(/^0+(?=\d)/, '') || '0';
      const grouped = Number(cleanInt).toLocaleString('pt-BR');
      return decPart !== undefined ? `${grouped},${decPart}` : grouped;
    }

    function numberToRaw(value) {
      if (!Number.isFinite(value)) return '0';
      let text = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
      if (text === '' || text === '-0') text = '0';
      return text.replace('.', ',');
    }

    function round(value) {
      return Math.round(value * 1e10) / 1e10;
    }

    function calculate(a, op, b) {
      switch (op) {
        case '+': return round(a + b);
        case '-': return round(a - b);
        case '×': return round(a * b);
        case '÷': return b === 0 ? null : round(a / b);
        default: return b;
      }
    }

    function updateDisplay() {
      valueEl.textContent = errorState ? 'Erro' : formatRawForDisplay(current);
      exprEl.textContent = operator && previous !== null ? `${formatNumber(previous)} ${operator}` : ' ';
    }

    function showError() {
      errorState = true;
      current = '0';
      previous = null;
      operator = null;
      overwrite = true;
      updateDisplay();
    }

    function pressDigit(digit) {
      if (errorState) { current = '0'; errorState = false; overwrite = false; }
      if (overwrite) {
        current = digit;
        overwrite = false;
      } else if (current === '0') {
        current = digit;
      } else if (current.length < 15) {
        current += digit;
      }
      updateDisplay();
    }

    function pressDecimal() {
      if (errorState) { current = '0'; errorState = false; overwrite = false; }
      if (overwrite) {
        current = '0,';
        overwrite = false;
        updateDisplay();
        return;
      }
      if (!current.includes(',')) current += ',';
      updateDisplay();
    }

    function pressOperator(nextOperator) {
      if (errorState) return;
      const value = parseCurrent();
      if (operator && !overwrite) {
        const result = calculate(previous, operator, value);
        if (result === null) { showError(); return; }
        previous = result;
      } else {
        previous = value;
      }
      operator = nextOperator;
      overwrite = true;
      updateDisplay();
    }

    function pressEquals() {
      if (errorState) return;
      if (operator === null || previous === null) return;
      const value = parseCurrent();
      const result = calculate(previous, operator, value);
      if (result === null) { showError(); return; }
      current = numberToRaw(result);
      previous = null;
      operator = null;
      overwrite = true;
      updateDisplay();
    }

    function pressPercent() {
      if (errorState) return;
      const value = parseCurrent();
      const result = operator && previous !== null ? previous * (value / 100) : value / 100;
      current = numberToRaw(result);
      overwrite = true;
      updateDisplay();
    }

    function pressBackspace() {
      if (errorState) { current = '0'; errorState = false; updateDisplay(); return; }
      if (overwrite) return;
      current = current.length > 1 ? current.slice(0, -1) : '0';
      updateDisplay();
    }

    function pressClear() {
      current = '0';
      previous = null;
      operator = null;
      overwrite = false;
      errorState = false;
      updateDisplay();
    }

    keypad.addEventListener('click', (event) => {
      const button = event.target.closest('[data-calc]');
      if (!button) return;
      const kind = button.dataset.calc;
      if (kind === 'digit') pressDigit(button.dataset.digit);
      else if (kind === 'decimal') pressDecimal();
      else if (kind === 'op') pressOperator(button.dataset.op);
      else if (kind === 'equals') pressEquals();
      else if (kind === 'percent') pressPercent();
      else if (kind === 'clear') pressClear();
      else if (kind === 'backspace') pressBackspace();
    });

    card.addEventListener('keydown', (event) => {
      const key = event.key;
      if (/^[0-9]$/.test(key)) { pressDigit(key); event.preventDefault(); }
      else if (key === ',' || key === '.') { pressDecimal(); event.preventDefault(); }
      else if (key === '+') { pressOperator('+'); event.preventDefault(); }
      else if (key === '-') { pressOperator('-'); event.preventDefault(); }
      else if (key === '*' || key.toLowerCase() === 'x') { pressOperator('×'); event.preventDefault(); }
      else if (key === '/') { pressOperator('÷'); event.preventDefault(); }
      else if (key === '%') { pressPercent(); event.preventDefault(); }
      else if (key === 'Enter' || key === '=') { pressEquals(); event.preventDefault(); }
      else if (key === 'Backspace') { pressBackspace(); event.preventDefault(); }
      else if (key === 'Escape') { pressClear(); event.preventDefault(); }
      else if (OPERATORS.includes(key)) { pressOperator(key); event.preventDefault(); }
    });

    updateDisplay();
  }

  function wireMargemTool(container) {
    const custoEl = container.querySelector('#calcMargemCusto');
    const precoEl = container.querySelector('#calcMargemPreco');
    const resultEl = container.querySelector('#calcMargemResultado');
    if (!custoEl || !precoEl || !resultEl) return;

    function recompute() {
      if (!custoEl.value.trim() && !precoEl.value.trim()) {
        resultEl.innerHTML = placeholderResult();
        return;
      }
      const custo = U.number(custoEl.value);
      const preco = U.number(precoEl.value);
      if (preco <= 0) {
        resultEl.innerHTML = UI.formNotice('Informe um preço de venda maior que zero.', 'warning');
        return;
      }
      if (custo < 0) {
        resultEl.innerHTML = UI.formNotice('O custo não pode ser negativo.', 'warning');
        return;
      }
      const lucro = preco - custo;
      const margem = (lucro / preco) * 100;
      resultEl.innerHTML = `
        <div class="cost-item"><span>Margem</span><strong>${formatPercent(margem)}</strong></div>
        <div class="cost-item"><span>Lucro</span><strong>${U.money(lucro)}</strong></div>
      `;
    }

    custoEl.addEventListener('input', recompute);
    precoEl.addEventListener('input', recompute);
  }

  function wireMarkupTool(container) {
    const custoEl = container.querySelector('#calcMarkupCusto');
    const markupEl = container.querySelector('#calcMarkupPercent');
    const resultEl = container.querySelector('#calcMarkupResultado');
    if (!custoEl || !markupEl || !resultEl) return;

    function recompute() {
      if (!custoEl.value.trim() && !markupEl.value.trim()) {
        resultEl.innerHTML = placeholderResult();
        return;
      }
      const custo = U.number(custoEl.value);
      const markup = U.number(markupEl.value);
      if (custo <= 0) {
        resultEl.innerHTML = UI.formNotice('Informe um custo maior que zero.', 'warning');
        return;
      }
      const preco = custo * (1 + markup / 100);
      if (!Number.isFinite(preco) || preco <= 0) {
        resultEl.innerHTML = UI.formNotice('Esse markup resulta em preço inválido. Use um percentual maior.', 'warning');
        return;
      }
      const lucro = preco - custo;
      resultEl.innerHTML = `
        <div class="cost-item"><span>Preço de venda</span><strong>${U.money(preco)}</strong></div>
        <div class="cost-item"><span>Lucro</span><strong>${U.money(lucro)}</strong></div>
      `;
    }

    custoEl.addEventListener('input', recompute);
    markupEl.addEventListener('input', recompute);
  }

  function wireDescontoTool(container) {
    const precoEl = container.querySelector('#calcDescontoPreco');
    const descontoEl = container.querySelector('#calcDescontoPercent');
    const resultEl = container.querySelector('#calcDescontoResultado');
    if (!precoEl || !descontoEl || !resultEl) return;

    function recompute() {
      if (!precoEl.value.trim() && !descontoEl.value.trim()) {
        resultEl.innerHTML = placeholderResult();
        return;
      }
      const preco = U.number(precoEl.value);
      const desconto = U.number(descontoEl.value);
      if (preco <= 0) {
        resultEl.innerHTML = UI.formNotice('Informe um preço maior que zero.', 'warning');
        return;
      }
      if (desconto < 0 || desconto > 100) {
        resultEl.innerHTML = UI.formNotice('O desconto deve ficar entre 0% e 100%.', 'warning');
        return;
      }
      const valorDesconto = preco * (desconto / 100);
      const precoFinal = preco - valorDesconto;
      resultEl.innerHTML = `
        <div class="cost-item"><span>Preço final</span><strong>${U.money(precoFinal)}</strong></div>
        <div class="cost-item"><span>Desconto</span><strong>${U.money(valorDesconto)}</strong></div>
      `;
    }

    precoEl.addEventListener('input', recompute);
    descontoEl.addEventListener('input', recompute);
  }

  function wireMargemAlvoTool(container) {
    const custoEl = container.querySelector('#calcAlvoCusto');
    const margemEl = container.querySelector('#calcAlvoPercent');
    const resultEl = container.querySelector('#calcAlvoResultado');
    if (!custoEl || !margemEl || !resultEl) return;

    function recompute() {
      if (!custoEl.value.trim() && !margemEl.value.trim()) {
        resultEl.innerHTML = placeholderResult();
        return;
      }
      const custo = U.number(custoEl.value);
      const margemAlvo = U.number(margemEl.value);
      if (custo <= 0) {
        resultEl.innerHTML = UI.formNotice('Informe um custo maior que zero.', 'warning');
        return;
      }
      if (margemAlvo < 0 || margemAlvo >= 100) {
        resultEl.innerHTML = UI.formNotice('A margem alvo deve ficar entre 0% e 99,99%.', 'warning');
        return;
      }
      const preco = custo / (1 - margemAlvo / 100);
      if (!Number.isFinite(preco) || preco <= 0) {
        resultEl.innerHTML = UI.formNotice('Não foi possível calcular um preço válido com esses valores.', 'warning');
        return;
      }
      const lucro = preco - custo;
      resultEl.innerHTML = `
        <div class="cost-item"><span>Preço sugerido</span><strong>${U.money(preco)}</strong></div>
        <div class="cost-item"><span>Lucro</span><strong>${U.money(lucro)}</strong></div>
      `;
    }

    custoEl.addEventListener('input', recompute);
    margemEl.addEventListener('input', recompute);
  }

  function mountFloating() {
    if (document.getElementById('calcFloatingButton')) return;
    const button = document.createElement('button');
    button.id = 'calcFloatingButton';
    button.type = 'button';
    button.className = 'calc-fab';
    button.setAttribute('aria-label', 'Abrir calculadora');
    button.textContent = 'R$';

    const panel = document.createElement('section');
    panel.id = 'calcFloatingPanel';
    panel.className = 'calc-floating-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="calc-floating-head">
        <h2>Calculadora</h2>
        <button type="button" class="small ghost" data-close-floating-calc>Fechar</button>
      </div>
      ${render()}
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);
    mount(panel);

    function toggle(force) {
      const open = typeof force === 'boolean' ? force : panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-label', open ? 'Fechar calculadora' : 'Abrir calculadora');
    }

    button.addEventListener('click', () => toggle());
    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-floating-calc]')) toggle(false);
    });
  }

  window.C360.calculator = { render, mount, mountFloating };
})();

