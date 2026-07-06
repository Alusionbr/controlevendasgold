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
        ${renderBusinessTools()}
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
          <button type="button" class="calc-key secondary" data-calc="op" data-op="-" aria-label="Subtrair">−</button>

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
    wireMargemTool(container);
    wireMarkupTool(container);
    wireDescontoTool(container);
    wireMargemAlvoTool(container);
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

  window.C360.calculator = { render, mount };
})();
