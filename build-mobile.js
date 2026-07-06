/*
 * build-mobile.js — gera a versão de arquivo único (controle360-mobile.html)
 * a partir da versão desktop (index.html + styles/main.css + src/*.js).
 *
 * Objetivo: manter as duas versões sempre iguais. Edite só os arquivos da
 * versão desktop e rode `node build-mobile.js` para atualizar o mobile.
 *
 * Uso:
 *   node build-mobile.js [caminho/de/saida/controle360-mobile.html]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const indexPath = path.join(projectDir, 'index.html');
const cssPath = path.join(projectDir, 'styles', 'main.css');
const outPath = process.argv[2] || path.join(projectDir, 'controle360-mobile.html');

let html = fs.readFileSync(indexPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

// 1) Inlinar o CSS no lugar do <link>.
html = html.replace(
  /\s*<link\s+rel="stylesheet"\s+href="styles\/main\.css"\s*>/,
  `\n  <style>\n${css}\n  </style>`
);

// 2) Inlinar cada <script src="src/X.js"></script> com o conteúdo do arquivo,
//    preservando a ordem em que aparecem no index.html.
html = html.replace(/<script\s+src="(src\/[^"]+)"><\/script>/g, (match, src) => {
  const code = fs.readFileSync(path.join(projectDir, src), 'utf8').replace(/\s+$/, '');
  return `<script>\n${code}\n</script>`;
});

if (/<script\s+src=/.test(html) || /<link\s+rel="stylesheet"/.test(html)) {
  throw new Error('Sobrou referência externa: o arquivo mobile não ficaria autossuficiente.');
}

fs.writeFileSync(outPath, html, 'utf8');
console.log('Mobile gerado:', outPath, `(${html.length} bytes)`);
