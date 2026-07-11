(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const S = window.C360.state;
  const XLSX = window.C360.xlsx;

  // Rótulos das colunas em português. As planilhas são legíveis para humanos,
  // mas continuam reversíveis na importação porque cada rótulo aponta de volta
  // para a chave técnica do dado.
  const LABELS = {
    id: 'ID', businessId: 'ID do negócio', name: 'Nome', segment: 'Segmento',
    defaultTargetMargin: 'Margem padrão (%)', defaultFeePercent: 'Taxas padrão (%)',
    notes: 'Observações', createdAt: 'Criado em', updatedAt: 'Atualizado em',
    type: 'Tipo', unit: 'Unidade', currentStock: 'Estoque atual', avgCost: 'Custo médio',
    salePrice: 'Preço de venda', minStock: 'Estoque mínimo',
    laborCostPerUnit: 'Mão de obra por unidade', overheadCostPerUnit: 'Custo fixo por unidade',
    lossPercent: 'Perda técnica (%)', targetMarginPercent: 'Margem desejada (%)',
    taxFeePercent: 'Taxas sobre venda (%)', phone: 'Telefone', date: 'Data',
    supplierId: 'ID do fornecedor', productId: 'ID do produto', quantity: 'Quantidade',
    totalCost: 'Custo total', unitCost: 'Custo unitário',
    finalProductId: 'ID do produto final', inputProductId: 'ID do insumo',
    quantityPerUnit: 'Qtd. por unidade', channel: 'Canal', clientId: 'ID do cliente',
    unitPrice: 'Preço unitário', discount: 'Desconto', fixedFees: 'Taxa fixa',
    feePercent: 'Taxa (%)', grossRevenue: 'Receita bruta', percentFees: 'Taxas percentuais',
    netRevenue: 'Receita líquida', cogs: 'CMV', grossProfit: 'Lucro bruto', margin: 'Margem',
    origin: 'Origem', originId: 'ID de origem', dueDate: 'Prazo / entrega', status: 'Status',
    convertedSaleId: 'ID da venda gerada', quantitySent: 'Qtd. enviada',
    quantitySold: 'Qtd. vendida', quantityReturned: 'Qtd. devolvida',
    amountPaid: 'Valor pago', costAtSend: 'Custo no envio',
    consignmentId: 'ID da consignação', amount: 'Valor', title: 'Título',
    sellerId: 'ID do vendedor', source: 'Origem do estoque', paymentMode: 'Pagamento', publicToken: 'Token publico',
    publicExpiresAt: 'Expira em', submittedAt: 'Enviado em', approvedAt: 'Aprovado em', approvedBy: 'Aprovado por',
    paymentProofPath: 'Comprovante', customerName: 'Cliente', customerPhone: 'Telefone do cliente', customerNotes: 'Obs. do cliente',
    cartId: 'ID do carrinho', approvedQuantity: 'Qtd. aprovada', rejectionReason: 'Motivo rejeicao',
    allowAdminStockSales: 'Pode estoque admin', allowConsignment: 'Pode consignado', allowPublicCartLinks: 'Pode link publico', maxDiscountPercent: 'Desconto maximo (%)',
  };

  const NUMERIC_KEYS = new Set([
    'defaultTargetMargin', 'defaultFeePercent', 'currentStock', 'avgCost', 'salePrice',
    'minStock', 'laborCostPerUnit', 'overheadCostPerUnit', 'lossPercent', 'targetMarginPercent',
    'taxFeePercent', 'quantity', 'totalCost', 'unitCost', 'quantityPerUnit', 'unitPrice',
    'discount', 'fixedFees', 'feePercent', 'grossRevenue', 'percentFees', 'netRevenue',
    'cogs', 'grossProfit', 'margin', 'quantitySent', 'quantitySold', 'quantityReturned',
    'amountPaid', 'costAtSend', 'amount', 'approvedQuantity', 'maxDiscountPercent',
    'paidAmount',
  ]);

  const DATE_KEYS = new Set(['date', 'dueDate', 'publicExpiresAt', 'submittedAt', 'approvedAt']);

  // Coleção -> nome da aba + ordem de colunas.
  const COLLECTIONS = [
    { key: 'businesses', sheet: 'Negócios', fields: ['id', 'name', 'segment', 'defaultTargetMargin', 'defaultFeePercent', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'products', sheet: 'Produtos', fields: ['id', 'businessId', 'name', 'type', 'unit', 'currentStock', 'avgCost', 'salePrice', 'minStock', 'laborCostPerUnit', 'overheadCostPerUnit', 'lossPercent', 'targetMarginPercent', 'taxFeePercent', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'clients', sheet: 'Clientes', fields: ['id', 'businessId', 'name', 'phone', 'type', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'suppliers', sheet: 'Fornecedores', fields: ['id', 'businessId', 'name', 'phone', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'purchases', sheet: 'Compras', fields: ['id', 'businessId', 'date', 'supplierId', 'productId', 'quantity', 'totalCost', 'unitCost', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'stockMovements', sheet: 'Movimentações', fields: ['id', 'businessId', 'date', 'type', 'productId', 'quantity', 'unitCost', 'totalCost', 'notes', 'createdAt'] },
    { key: 'recipes', sheet: 'Fichas técnicas', fields: ['id', 'businessId', 'finalProductId', 'inputProductId', 'quantityPerUnit', 'createdAt', 'updatedAt'] },
    { key: 'productions', sheet: 'Produção', fields: ['id', 'businessId', 'date', 'finalProductId', 'quantity', 'totalCost', 'unitCost', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'sales', sheet: 'Vendas', fields: ['id', 'businessId', 'date', 'channel', 'clientId', 'productId', 'quantity', 'unitPrice', 'discount', 'fixedFees', 'feePercent', 'unitCost', 'grossRevenue', 'percentFees', 'netRevenue', 'cogs', 'grossProfit', 'margin', 'notes', 'origin', 'originId', 'createdAt', 'updatedAt'] },
    { key: 'orders', sheet: 'Pedidos', fields: ['id', 'businessId', 'sellerId', 'clientId', 'productId', 'quantity', 'unitPrice', 'dueDate', 'status', 'approvalStatus', 'saleType', 'paymentMode', 'paidAmount', 'orderGroupId', 'notes', 'convertedSaleId', 'createdAt', 'updatedAt'] },
    { key: 'consignments', sheet: 'Consignado', fields: ['id', 'businessId', 'date', 'clientId', 'productId', 'quantitySent', 'quantitySold', 'quantityReturned', 'amountPaid', 'unitPrice', 'costAtSend', 'notes', 'status', 'createdAt', 'updatedAt'] },
    { key: 'consignmentEvents', sheet: 'Eventos consignado', fields: ['id', 'businessId', 'consignmentId', 'type', 'date', 'quantity', 'amount', 'createdAt', 'updatedAt'] },
    { key: 'tasks', sheet: 'Tarefas', fields: ['id', 'businessId', 'title', 'dueDate', 'status', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'sellerSettings', sheet: 'Permissoes vendedores', fields: ['id', 'businessId', 'sellerId', 'allowAdminStockSales', 'allowConsignment', 'allowPublicCartLinks', 'maxDiscountPercent', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'saleCarts', sheet: 'Carrinhos', fields: ['id', 'businessId', 'sellerId', 'clientId', 'source', 'paymentMode', 'status', 'channel', 'customerName', 'customerPhone', 'customerNotes', 'publicToken', 'publicExpiresAt', 'submittedAt', 'approvedAt', 'approvedBy', 'paymentProofPath', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'saleCartItems', sheet: 'Itens carrinho', fields: ['id', 'cartId', 'businessId', 'productId', 'quantity', 'unitPrice', 'approvedQuantity', 'rejectionReason', 'createdAt', 'updatedAt'] },
  ];

  const BACKUP_SHEET = 'Backup_NAO_EDITAR';
  const BACKUP_MARKER = '__c360_config__';

  function deburr(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function label(key) {
    return LABELS[key] || key;
  }

  function fieldsFor(collection, records) {
    const ordered = [...collection.fields];
    const seen = new Set(ordered);
    records.forEach((record) => {
      Object.keys(record).forEach((key) => {
        if (!seen.has(key)) {
          ordered.push(key);
          seen.add(key);
        }
      });
    });
    return ordered;
  }

  function cellValue(key, value) {
    if (value === undefined || value === null) return '';
    if (NUMERIC_KEYS.has(key)) {
      if (value === '') return '';
      const num = Number(value);
      return Number.isFinite(num) ? num : value;
    }
    return String(value);
  }

  function excelSerialToDate(serial) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(Number(serial)) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  function notify(message, type) {
    const app = window.C360.app;
    if (app && typeof app.toast === 'function') app.toast(message, type);
  }

  function refresh() {
    const app = window.C360.app;
    if (app && typeof app.refresh === 'function') app.refresh();
  }

  // TODO(integrador): quando existir login com papéis (admin/vendedor), este
  // backup Excel exporta TODO o negócio (todas as coleções, todos os
  // registros). Antes de montar `sheets`, se currentUser.role === 'vendedor',
  // filtrar cada coleção relevante (clients, sales, orders, consignments,
  // consignmentEvents e qualquer outra com dono por vendedor) para manter só
  // os registros com seller_id === currentUser.id — um vendedor nunca deve
  // conseguir baixar o backup completo dos outros vendedores/do negócio todo.
  // Coleções sem dono individual (businesses, products, suppliers, recipes,
  // etc.) provavelmente continuam completas mesmo para vendedor; confirmar
  // com a regra de negócio quando o papel existir.
  //
  // Nota sobre injeção de fórmula (ver csvField() abaixo, seção CSV): este
  // motor .xlsx (src/xlsx-lite.js, função sheetXml) escreve toda string como
  // célula tipada `t="inlineStr"` (texto explícito no XML da planilha), nunca
  // como fórmula (`<f>`). Excel/Sheets respeitam esse tipo ao abrir um .xlsx
  // de verdade e não reinterpretam o conteúdo como fórmula — diferente de CSV
  // puro, que não carrega tipo de célula. Por isso o backup Excel não precisa
  // do mesmo prefixo de apóstrofo aplicado no CSV.
  // ---------- Exportar Excel (backup completo) ----------
  function exportXlsx() {
    const state = S.getState();
    const sheets = [];

    const summary = [
      ['Controle360 Multi — backup completo'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      [''],
      ['Aba', 'Registros'],
    ];
    COLLECTIONS.forEach((collection) => {
      summary.push([collection.sheet, (state[collection.key] || []).length]);
    });
    summary.push(['']);
    summary.push(['Como reimportar: use "Importar Excel" na aba Dados.']);
    summary.push(['Pode editar as abas de dados. Não apague a aba ' + BACKUP_SHEET + '.']);
    sheets.push({ name: 'Resumo', rows: summary });

    COLLECTIONS.forEach((collection) => {
      const records = state[collection.key] || [];
      const fields = fieldsFor(collection, records);
      const rows = [fields.map(label)];
      records.forEach((record) => {
        rows.push(fields.map((key) => cellValue(key, record[key])));
      });
      sheets.push({ name: collection.sheet, rows });
    });

    const config = {
      marker: BACKUP_MARKER,
      schemaVersion: state.meta?.schemaVersion,
      activeBusinessId: state.activeBusinessId,
      settings: state.settings,
      meta: state.meta,
    };
    sheets.push({
      name: BACKUP_SHEET,
      rows: [
        ['Não edite esta aba. Ela guarda configurações para restaurar o backup.'],
        [BACKUP_MARKER, JSON.stringify(config)],
      ],
    });

    const blob = XLSX.buildXlsx(sheets);
    U.downloadBlob(`controle360-completo-${U.today()}.xlsx`, blob);
    notify('Backup Excel exportado.', 'success');
  }

  // ---------- Importar Excel ----------
  function buildReverseMap(collection) {
    const map = {};
    collection.fields.forEach((key) => {
      map[deburr(label(key))] = key;
      map[deburr(key)] = key;
    });
    // Também aceita rótulos de chaves que não estão na ordem padrão.
    Object.keys(LABELS).forEach((key) => {
      if (!(deburr(label(key)) in map)) map[deburr(label(key))] = key;
    });
    return map;
  }

  function rowToRecord(headerKeys, cells) {
    const record = {};
    let hasValue = false;
    headerKeys.forEach((key, index) => {
      if (!key) return;
      let value = cells[index];
      if (value === undefined || value === '') return;
      hasValue = true;
      if (NUMERIC_KEYS.has(key)) {
        const num = Number(value);
        value = Number.isFinite(num) ? num : 0;
      } else if (DATE_KEYS.has(key) && typeof value === 'number') {
        value = excelSerialToDate(value);
      } else {
        value = String(value);
      }
      record[key] = value;
    });
    return hasValue ? record : null;
  }

  function collectionsFromSheets(sheetMap) {
    const result = {};
    COLLECTIONS.forEach((collection) => {
      const sheet = sheetMap[deburr(collection.sheet)] || sheetMap[deburr(collection.key)];
      result[collection.key] = [];
      if (!sheet || !sheet.rows.length) return;
      const reverse = buildReverseMap(collection);
      const headerKeys = sheet.rows[0].map((cell) => reverse[deburr(cell)] || null);
      for (let i = 1; i < sheet.rows.length; i += 1) {
        const record = rowToRecord(headerKeys, sheet.rows[i]);
        if (!record) continue;
        if (!record.id) record.id = U.uid(collection.key);
        result[collection.key].push(record);
      }
    });
    return result;
  }

  async function importXlsx(file) {
    try {
      const buffer = await file.arrayBuffer();
      const sheets = await XLSX.parseXlsx(buffer);
      const sheetMap = {};
      sheets.forEach((sheet) => { sheetMap[deburr(sheet.name)] = sheet; });

      const collections = collectionsFromSheets(sheetMap);

      const current = S.getState();
      const next = {
        meta: current.meta,
        settings: current.settings,
        activeBusinessId: current.activeBusinessId,
        ...collections,
      };

      const backupSheet = sheetMap[deburr(BACKUP_SHEET)];
      if (backupSheet) {
        const configCell = backupSheet.rows.find((row) => row[0] === BACKUP_MARKER);
        if (configCell && configCell[1]) {
          try {
            const config = JSON.parse(configCell[1]);
            if (config.settings) next.settings = config.settings;
            if (config.meta) next.meta = config.meta;
            if (config.activeBusinessId) next.activeBusinessId = config.activeBusinessId;
          } catch (error) {
            /* configuração ilegível: mantém a atual */
          }
        }
      }

      const validBusiness = next.businesses.some((b) => b.id === next.activeBusinessId);
      if (!validBusiness) next.activeBusinessId = next.businesses[0]?.id || null;

      const total = COLLECTIONS.reduce((sum, c) => sum + (next[c.key] || []).length, 0);
      if (!window.confirm(`Importar esta planilha vai substituir os dados locais atuais por ${total} registro(s). Continuar?`)) {
        return;
      }

      S.replaceState(next);
      refresh();
      notify('Planilha importada com sucesso.', 'success');
    } catch (error) {
      notify('Não foi possível importar: ' + error.message, 'error');
      window.alert('Não foi possível importar: ' + error.message);
    }
  }

  // ---------- CSV por módulo ----------
  // Proteção contra injeção de fórmula (CSV/Excel formula injection): um
  // cliente chamado "=HYPERLINK(...)" ou "+SUM(...)" pode virar fórmula viva
  // quando o CSV é aberto no Excel/Sheets, porque CSV não tem tipo de célula
  // — o programa decide na hora se o texto "parece" fórmula. Mitigação padrão
  // (OWASP): se o campo (depois de tirar espaços nas pontas) começa com
  // = + - @, prefixar com um apóstrofo antes de aplicar a citação normal.
  // Só se aplica a valores de TEXTO: campos numéricos de verdade (NUMERIC_KEYS,
  // já convertidos para Number em cellValue) não passam por aqui — um custo
  // negativo como -45.5 continua sendo número, não texto, então não corre
  // risco de virar fórmula e não deve ganhar apóstrofo.
  function csvField(value) {
    const isRealNumber = typeof value === 'number';
    let text = String(value ?? '');
    if (!isRealNumber && /^[=+\-@]/.test(text.trim())) {
      text = `'${text}`;
    }
    if (/[;"\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  // TODO(integrador): este CSV por módulo já filtra por negócio ativo
  // (activeBusinessId), mas não por vendedor. Quando currentUser.role ===
  // 'vendedor' existir, adicionar aqui um segundo filtro — depois do filtro
  // de activeBusinessId e antes de montar `fields`/`lines` — restringindo
  // `records` a `record.seller_id === currentUser.id` para as coleções que
  // pertencem a um vendedor específico: clients, sales, orders, consignments
  // (e consignmentEvents, que é filho de consignments). Um vendedor não pode
  // exportar CSV de clientes/vendas/pedidos/consignados de outro vendedor.
  function exportCsv(collectionKey) {
    const collection = COLLECTIONS.find((item) => item.key === collectionKey);
    if (!collection) return;
    const state = S.getState();
    let records = state[collectionKey] || [];
    if (collectionKey !== 'businesses' && state.activeBusinessId) {
      records = records.filter((record) => record.businessId === state.activeBusinessId);
    }
    const fields = fieldsFor(collection, records);
    const lines = [fields.map((key) => csvField(label(key))).join(';')];
    records.forEach((record) => {
      lines.push(fields.map((key) => csvField(cellValue(key, record[key]))).join(';'));
    });
    const content = '\ufeff' + lines.join('\r\n');
    U.downloadText(`controle360-${deburr(collection.sheet).replaceAll(' ', '-')}-${U.today()}.csv`, content, 'text/csv;charset=utf-8');
    notify(`CSV de ${collection.sheet} exportado.`, 'success');
  }

  // TODO(integrador): exportJson() serializa S.getState() inteiro — todas as
  // coleções, de todos os negócios, sem filtro nenhum (é o backup bruto).
  // Quando currentUser.role === 'vendedor' existir, este backup completo
  // provavelmente deve ficar bloqueado para vendedor (ou passar por um clone
  // do estado com clients/sales/orders/consignments/consignmentEvents
  // filtrados por seller_id === currentUser.id antes do JSON.stringify) —
  // decidir com a regra de negócio se vendedor tem acesso a este botão.
  // ---------- JSON ----------
  function exportJson() {
    U.downloadText(`controle360-backup-${U.today()}.json`, JSON.stringify(S.getState(), null, 2));
    notify('Backup JSON exportado.', 'success');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!window.confirm('Importar este backup JSON vai substituir os dados locais atuais. Continuar?')) return;
        S.replaceState(parsed);
        refresh();
        notify('Backup JSON importado.', 'success');
      } catch (error) {
        notify('Backup inválido: ' + error.message, 'error');
        window.alert('Backup inválido: ' + error.message);
      }
    };
    reader.readAsText(file);
  }

  window.C360.io = {
    COLLECTIONS,
    exportXlsx,
    importXlsx,
    exportCsv,
    exportJson,
    importJson,
  };
})();

