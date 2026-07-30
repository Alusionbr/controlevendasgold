const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

test('tela de produtos oferece cadastro rápido e visível', () => {
  assert.match(app, /data-action="focus-new-product"/);
  assert.match(app, /Adicionar novo produto/);
  assert.match(app, /<button type="submit">Adicionar produto<\/button>/);
  assert.match(app, /Mais opções: estoque mínimo, custos, margem e observações/);
});

test('cadastro rápido mantém os campos necessários e o salvamento existente', () => {
  for (const field of ['name', 'type', 'unit', 'currentStock', 'avgCost', 'salePrice']) {
    assert.match(app, new RegExp(`name="${field}"`));
  }
  assert.match(app, /productForm: addProduct/);
  assert.match(app, /S\.add\('products'/);
});

test('atalho da tela Hoje abre o campo de nome do produto', () => {
  assert.match(app, /focus: 'new-product'/);
  assert.match(app, /trigger\.dataset\.focus === 'new-product'/);
  assert.match(app, /#productForm \[name="name"\]/);
});