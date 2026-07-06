(function () {
  'use strict';

  // Motor .xlsx mínimo, em JavaScript puro, sem dependências externas.
  // Escrita: monta um ZIP "stored" (sem compressão), aceito pelo Excel e Google Sheets.
  // Leitura: lê o ZIP, descomprime com a API nativa do navegador quando necessário.
  // Mantém o projeto offline e revisável, conforme CLAUDE.md.

  window.C360 = window.C360 || {};

  const ENC = new TextEncoder();
  const DEC = new TextDecoder('utf-8');

  // ----- CRC32 (necessário para o cabeçalho do ZIP) -----
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ----- Escrita de bytes em um array dinâmico -----
  function pushU16(arr, value) {
    arr.push(value & 0xff, (value >>> 8) & 0xff);
  }
  function pushU32(arr, value) {
    arr.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }
  function pushBytes(arr, bytes) {
    for (let i = 0; i < bytes.length; i += 1) arr.push(bytes[i]);
  }

  function xmlEscape(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  function colLetter(index) {
    let n = index;
    let letters = '';
    do {
      letters = String.fromCharCode(65 + (n % 26)) + letters;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters;
  }

  function sanitizeSheetName(name, fallback) {
    let clean = String(name || fallback || 'Planilha').replace(/[:\\/?*\[\]]/g, ' ').trim();
    if (!clean) clean = fallback || 'Planilha';
    if (clean.length > 31) clean = clean.slice(0, 31);
    return clean;
  }

  // ----- Geração do XML de uma planilha -----
  function sheetXml(rows) {
    const body = rows.map((cells, rowIndex) => {
      const r = rowIndex + 1;
      const cellsXml = cells.map((value, colIndex) => {
        const ref = `${colLetter(colIndex)}${r}`;
        if (value === null || value === undefined || value === '') {
          return '';
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`;
        }
        if (typeof value === 'boolean') {
          return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }).join('');
      return `<row r="${r}">${cellsXml}</row>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${body}</sheetData></worksheet>`;
  }

  // ----- Monta o arquivo .xlsx (Blob) a partir de [{name, rows}] -----
  function buildXlsx(sheets) {
    const usedNames = new Set();
    const prepared = sheets.map((sheet, i) => {
      let name = sanitizeSheetName(sheet.name, `Planilha${i + 1}`);
      let unique = name;
      let suffix = 2;
      while (usedNames.has(unique.toLowerCase())) {
        unique = `${name.slice(0, 28)} ${suffix}`;
        suffix += 1;
      }
      usedNames.add(unique.toLowerCase());
      return { name: unique, rows: sheet.rows || [] };
    });

    const files = [];

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      prepared.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      `</Types>`;
    files.push({ path: '[Content_Types].xml', data: ENC.encode(contentTypes) });

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`;
    files.push({ path: '_rels/.rels', data: ENC.encode(rootRels) });

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      prepared.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      `</sheets></workbook>`;
    files.push({ path: 'xl/workbook.xml', data: ENC.encode(workbook) });

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      prepared.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `</Relationships>`;
    files.push({ path: 'xl/_rels/workbook.xml.rels', data: ENC.encode(workbookRels) });

    prepared.forEach((sheet, i) => {
      files.push({ path: `xl/worksheets/sheet${i + 1}.xml`, data: ENC.encode(sheetXml(sheet.rows)) });
    });

    return zipStored(files);
  }

  // ----- Empacota arquivos em um ZIP sem compressão -----
  function zipStored(files) {
    const out = [];
    const central = [];
    let offset = 0;

    files.forEach((file) => {
      const nameBytes = ENC.encode(file.path);
      const crc = crc32(file.data);
      const size = file.data.length;

      // Cabeçalho local
      pushU32(out, 0x04034b50);
      pushU16(out, 20); // versão necessária
      pushU16(out, 0); // flags
      pushU16(out, 0); // método: 0 = stored
      pushU16(out, 0); // hora
      pushU16(out, 0x21); // data (1980-01-01)
      pushU32(out, crc);
      pushU32(out, size);
      pushU32(out, size);
      pushU16(out, nameBytes.length);
      pushU16(out, 0); // extra
      pushBytes(out, nameBytes);
      pushBytes(out, file.data);

      // Entrada do diretório central
      pushU32(central, 0x02014b50);
      pushU16(central, 20); // versão criadora
      pushU16(central, 20); // versão necessária
      pushU16(central, 0);
      pushU16(central, 0);
      pushU16(central, 0);
      pushU16(central, 0x21);
      pushU32(central, crc);
      pushU32(central, size);
      pushU32(central, size);
      pushU16(central, nameBytes.length);
      pushU16(central, 0);
      pushU16(central, 0);
      pushU16(central, 0);
      pushU16(central, 0);
      pushU32(central, 0);
      pushU32(central, offset);
      pushBytes(central, nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    const centralOffset = offset;
    const centralSize = central.length;

    const eocd = [];
    pushU32(eocd, 0x06054b50);
    pushU16(eocd, 0);
    pushU16(eocd, 0);
    pushU16(eocd, files.length);
    pushU16(eocd, files.length);
    pushU32(eocd, centralSize);
    pushU32(eocd, centralOffset);
    pushU16(eocd, 0);

    const total = new Uint8Array(out.length + central.length + eocd.length);
    total.set(out, 0);
    total.set(central, out.length);
    total.set(eocd, out.length + central.length);

    return new Blob([total], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ----- Leitura -----
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador não consegue ler planilhas compactadas. Atualize o navegador ou use o backup JSON.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  function findEocd(view, length) {
    for (let i = length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function unzip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const eocd = findEocd(view, bytes.length);
    if (eocd === -1) throw new Error('Arquivo não é um .xlsx válido.');

    const count = view.getUint16(eocd + 10, true);
    let pointer = view.getUint32(eocd + 16, true);
    const entries = {};

    for (let n = 0; n < count; n += 1) {
      if (view.getUint32(pointer, true) !== 0x02014b50) break;
      const method = view.getUint16(pointer + 10, true);
      const compSize = view.getUint32(pointer + 20, true);
      const nameLen = view.getUint16(pointer + 28, true);
      const extraLen = view.getUint16(pointer + 30, true);
      const commentLen = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const name = DEC.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));

      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);

      // eslint-disable-next-line no-await-in-loop
      entries[name] = method === 0 ? raw : await inflateRaw(raw);
      pointer += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Não foi possível ler o conteúdo da planilha.');
    }
    return doc;
  }

  function readSharedStrings(entries) {
    const file = entries['xl/sharedStrings.xml'];
    if (!file) return [];
    const doc = parseXml(DEC.decode(file));
    return [...doc.getElementsByTagName('si')].map((si) => {
      return [...si.getElementsByTagName('t')].map((t) => t.textContent).join('');
    });
  }

  function colRefToIndex(ref) {
    const letters = String(ref || '').replace(/[0-9]/g, '');
    let index = 0;
    for (let i = 0; i < letters.length; i += 1) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return Math.max(index - 1, 0);
  }

  function readSheetRows(xml, shared) {
    const doc = parseXml(xml);
    const rows = [];
    [...doc.getElementsByTagName('row')].forEach((rowEl) => {
      const cells = [];
      [...rowEl.getElementsByTagName('c')].forEach((cellEl) => {
        const colIndex = colRefToIndex(cellEl.getAttribute('r'));
        const type = cellEl.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = [...cellEl.getElementsByTagName('t')].map((t) => t.textContent).join('');
        } else {
          const vEl = cellEl.getElementsByTagName('v')[0];
          const raw = vEl ? vEl.textContent : '';
          if (type === 's') {
            value = shared[Number(raw)] ?? '';
          } else if (type === 'str') {
            value = raw;
          } else if (type === 'b') {
            value = raw === '1';
          } else {
            value = raw === '' ? '' : Number(raw);
          }
        }
        cells[colIndex] = value;
      });
      for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
    });
    return rows;
  }

  async function parseXlsx(arrayBuffer) {
    const entries = await unzip(arrayBuffer);
    const shared = readSharedStrings(entries);

    const relsFile = entries['xl/_rels/workbook.xml.rels'];
    const rels = {};
    if (relsFile) {
      const relsDoc = parseXml(DEC.decode(relsFile));
      [...relsDoc.getElementsByTagName('Relationship')].forEach((rel) => {
        rels[rel.getAttribute('Id')] = rel.getAttribute('Target');
      });
    }

    const workbookFile = entries['xl/workbook.xml'];
    if (!workbookFile) throw new Error('Planilha sem workbook.xml.');
    const workbookDoc = parseXml(DEC.decode(workbookFile));

    const result = [];
    [...workbookDoc.getElementsByTagName('sheet')].forEach((sheetEl, i) => {
      const name = sheetEl.getAttribute('name') || `Planilha${i + 1}`;
      const rid = sheetEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
        sheetEl.getAttribute('r:id');
      let target = rels[rid];
      if (!target) target = `worksheets/sheet${i + 1}.xml`;
      target = target.replace(/^\//, '').replace(/^xl\//, '');
      const path = `xl/${target}`;
      const file = entries[path];
      const rows = file ? readSheetRows(DEC.decode(file), shared) : [];
      result.push({ name, rows });
    });

    return result;
  }

  window.C360.xlsx = {
    buildXlsx,
    parseXlsx,
  };
})();
