(function () {
  'use strict';

  window.C360 = window.C360 || {};
  const U = window.C360.utils;
  const S = window.C360.state;
  const XLSX = window.C360.xlsx;

  // RÃ³tulos das colunas em portuguÃªs. As planilhas sÃ£o legÃ­veis para humanos,
  // mas continuam reversÃ­veis na importaÃ§Ã£o porque cada rÃ³tulo aponta de volta
  // para a chave tÃ©cnica do dado.
  const LABELS = {
    id: 'ID', businessId: 'ID do negÃ³cio', name: 'Nome', segment: 'Segmento',
    defaultTargetMargin: 'Margem padrÃ£o (%)', defaultFeePercent: 'Taxas padrÃ£o (%)',
    notes: 'ObservaÃ§Ãµes', createdAt: 'Criado em', updatedAt: 'Atualizado em',
    type: 'Tipo', unit: 'Unidade', currentStock: 'Estoque atual', avgCost: 'Custo mÃ©dio',
    salePrice: 'PreÃ§o de venda', minStock: 'Estoque mÃ­nimo',
    laborCostPerUnit: 'MÃ£o de obra por unidade', overheadCostPerUnit: 'Custo fixo por unidade',
    lossPercent: 'Perda tÃ©cnica (%)', targetMarginPercent: 'Margem desejada (%)',
    taxFeePercent: 'Taxas sobre venda (%)', phone: 'Telefone', date: 'Data',
    supplierId: 'ID do fornecedor', productId: 'ID do produto', quantity: 'Quantidade',
    totalCost: 'Custo total', unitCost: 'Custo unitÃ¡rio',
    finalProductId: 'ID do produto final', inputProductId: 'ID do insumo',
    quantityPerUnit: 'Qtd. por unidade', channel: 'Canal', clientId: 'ID do cliente',
    unitPrice: 'PreÃ§o unitÃ¡rio', discount: 'Desconto', fixedFees: 'Taxa fixa',
    feePercent: 'Taxa (%)', grossRevenue: 'Receita bruta', percentFees: 'Taxas percentuais',
    netRevenue: 'Receita lÃ­quida', cogs: 'CMV', grossProfit: 'Lucro bruto', margin: 'Margem',
    origin: 'Origem', originId: 'ID de origem', dueDate: 'Prazo / entrega', status: 'Status',
    convertedSaleId: 'ID da venda gerada', quantitySent: 'Qtd. enviada',
    quantitySold: 'Qtd. vendida', quantityReturned: 'Qtd. devolvida',
    amountPaid: 'Valor pago', costAtSend: 'Custo no envio',
    consignmentId: 'ID da consignaÃ§Ã£o', amount: 'Valor', title: 'TÃ­tulo',
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
  ]);

  const DATE_KEYS = new Set(['date', 'dueDate', 'publicExpiresAt', 'submittedAt', 'approvedAt']);

  // ColeÃ§Ã£o -> nome da aba + ordem de colunas.
  const COLLECTIONS = [
    { key: 'businesses', sheet: 'NegÃ³cios', fields: ['id', 'name', 'segment', 'defaultTargetMargin', 'defaultFeePercent', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'products', sheet: 'Produtos', fields: ['id', 'businessId', 'name', 'type', 'unit', 'currentStock', 'avgCost', 'salePrice', 'minStock', 'laborCostPerUnit', 'overheadCostPerUnit', 'lossPercent', 'targetMarginPercent', 'taxFeePercent', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'clients', sheet: 'Clientes', fields: ['id', 'businessId', 'name', 'phone', 'type', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'suppliers', sheet: 'Fornecedores', fields: ['id', 'businessId', 'name', 'phone', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'purchases', sheet: 'Compras', fields: ['id', 'businessId', 'date', 'supplierId', 'productId', 'quantity', 'totalCost', 'unitCost', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'stockMovements', sheet: 'MovimentaÃ§Ãµes', fields: ['id', 'businessId', 'date', 'type', 'productId', 'quantity', 'unitCost', 'totalCost', 'notes', 'createdAt'] },
    { key: 'recipes', sheet: 'Fichas tÃ©cnicas', fields: ['id', 'businessId', 'finalProductId', 'inputProductId', 'quantityPerUnit', 'createdAt', 'updatedAt'] },
    { key: 'productions', sheet: 'ProduÃ§Ã£o', fields: ['id', 'businessId', 'date', 'finalProductId', 'quantity', 'totalCost', 'unitCost', 'notes', 'createdAt', 'updatedAt'] },
    { key: 'sales', sheet: 'Vendas', fields: ['id', 'businessId', 'date', 'channel', 'clientId', 'productId', 'quantity', 'unitPrice', 'discount', 'fixedFees', 'feePercent', 'unitCost', 'grossRevenue', 'percentFees', 'netRevenue', 'cogs', 'grossProfit', 'margin', 'notes', 'origin', 'originId', 'createdAt', 'updatedAt'] },
    { key: 'orders', sheet: 'Pedidos', fields: ['id', 'businessId', 'clientId', 'productId', 'quantity', 'unitPrice', 'dueDate', 'status', 'notes', 'convertedSaleId', 'createdAt', 'updatedAt'] },
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

  // TODO(integrador): quando existir login com papÃ©is (admin/vendedor), este
  // backup Excel exporta TODO o negÃ³cio (todas as coleÃ§Ãµes, todos os
  // registros). Antes de montar `sheets`, se currentUser.role === 'vendedor',
  // filtrar cada coleÃ§Ã£o relevante (clients, sales, orders, consignments,
  // consignmentEvents e qualquer outra com dono por vendedor) para manter sÃ³
  // os registros com seller_id === currentUser.id â€” um vendedor nunca deve
  // conseguir baixar o backup completo dos outros vendedores/do negÃ³cio todo.
  // ColeÃ§Ãµes sem dono individual (businesses, products, suppliers, recipes,
  // etc.) provavelmente continuam completas mesmo para vendedor; confirmar
  // com a regra de negÃ³cio quando o papel existir.
  //
  // Nota sobre injeÃ§Ã£o de fÃ³rmula (ver csvField() abaixo, seÃ§Ã£o CSV): este
  // motor .xlsx (src/xlsx-lite.js, funÃ§Ã£o sheetXml) escreve toda string como
  // cÃ©lula tipada `t="inlineStr"` (texto explÃ­cito no XML da planilha), nunca
  // como fÃ³rmula (`<f>`). Excel/Sheets respeitam esse tipo ao abrir um .xlsx
  // de verdade e nÃ£o reinterpretam o conteÃºdo como fÃ³rmula â€” diferente de CSV
  // puro, que nÃ£o carrega tipo de cÃ©lula. Por isso o backup Excel nÃ£o precisa
  // do mesmo prefixo de apÃ³strofo aplicado no CSV.
  // ---------- Exportar Excel (backup completo) ----------
  function exportXlsx() {
    const state = S.getState();
    const sheets = [];

    const summary = [
      ['Controle360 Multi â€” backup completo'],
      ['Gerado em', new Date().toLocaleString('pt-BR')],
      [''],
      ['Aba', 'Registros'],
    ];
    COLLECTIONS.forEach((collection) => {
      summary.push([collection.sheet, (state[collection.key] || []).length]);
    });
    summary.push(['']);
    summary.push(['Como reimportar: use "Importar Excel" na aba Dados.']);
    summary.push(['Pode editar as abas de dados. NÃ£o apague a aba ' + BACKUP_SHEET + '.']);
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
        ['NÃ£o edite esta aba. Ela guarda configuraÃ§Ãµes para restaurar o backup.'],
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
    // TambÃ©m aceita rÃ³tulos de chaves que nÃ£o estÃ£o na ordem padrÃ£o.
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
            /* configuraÃ§Ã£o ilegÃ­vel: mantÃ©m a atual */
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
      notify('NÃ£o foi possÃ­vel importar: ' + error.message, 'error');
      window.alert('NÃ£o foi possÃ­vel importar: ' + error.message);
    }
  }

  // ---------- CSV por mÃ³dulo ----------
  // ProteÃ§Ã£o contra injeÃ§Ã£o de fÃ³rmula (CSV/Excel formula injection): um
  // cliente chamado "=HYPERLINK(...)" ou "+SUM(...)" pode virar fÃ³rmula viva
  // quando o CSV Ã© aberto no Excel/Sheets, porque CSV nÃ£o tem tipo de cÃ©lula
  // â€” o programa decide na hora se o texto "parece" fÃ³rmula. MitigaÃ§Ã£o padrÃ£o
  // (OWASP): se o campo (depois de tirar espaÃ§os nas pontas) comeÃ§a com
  // = + - @, prefixar com um apÃ³strofo antes de aplicar a citaÃ§Ã£o normal.
  // SÃ³ se aplica a valores de TEXTO: campos numÃ©ricos de verdade (NUMERIC_KEYS,
  // jÃ¡ convertidos para Number em cellValue) nÃ£o passam por aqui â€” um custo
  // negativo como -45.5 continua sendo nÃºmero, nÃ£o texto, entÃ£o nÃ£o corre
  // risco de virar fÃ³rmula e nÃ£o deve ganhar apÃ³strofo.
  function csvField(value) {
    const isRealNumber = typeof value === 'number';
    let text = String(value ?? '');
    if (!isRealNumber && /^[=+\-@]/.test(text.trim())) {
      text = `'${text}`;
    }
    if (/[;"\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  // TODO(integrador): este CSV por mÃ³dulo jÃ¡ filtra por negÃ³cio ativo
  // (activeBusinessId), mas nÃ£o por vendedor. Quando currentUser.role ===
  // 'vendedor' existir, adicionar aqui um segundo filtro â€” depois do filtro
  // de activeBusinessId e antes de montar `fields`/`lines` â€” restringindo
  // `records` a `record.seller_id === currentUser.id` para as coleÃ§Ãµes que
  // pertencem a um vendedor especÃ­fico: clients, sales, orders, consignments
  // (e consignmentEvents, que Ã© filho de consignments). Um vendedor nÃ£o pode
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

  // TODO(integrador): exportJson() serializa S.getState() inteiro â€” todas as
  // coleÃ§Ãµes, de todos os negÃ³cios, sem filtro nenhum (Ã© o backup bruto).
  // Quando currentUser.role === 'vendedor' existir, este backup completo
  // provavelmente deve ficar bloqueado para vendedor (ou passar por um clone
  // do estado com clients/sales/orders/consignments/consignmentEvents
  // filtrados por seller_id === currentUser.id antes do JSON.stringify) â€”
  // decidir com a regra de negÃ³cio se vendedor tem acesso a este botÃ£o.
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
        notify('Backup invÃ¡lido: ' + error.message, 'error');
        window.alert('Backup invÃ¡lido: ' + error.message);
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

