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
const crypto = require('crypto');

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
//    preservando a ordem em que aparecem no index.html. A CSP do index.html
//    (script-src 'self') bloquearia esses <script> inline sem 'unsafe-inline'
//    ou hash — em vez de afrouxar a política, calculamos o hash sha256 exato
//    de cada bloco inline e listamos em script-src (passo 3), do mesmo jeito
//    que já é feito para o <style> inline com 'unsafe-inline' em style-src.
const scriptHashes = [];
html = html.replace(/<script\s+src="(src\/[^"]+)"><\/script>/g, (match, src) => {
  const code = fs.readFileSync(path.join(projectDir, src), 'utf8').replace(/\s+$/, '');
  const text = `\n${code}\n`;
  scriptHashes.push(`'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`);
  return `<script>${text}</script>`;
});

if (/<script\s+src=/.test(html) || /<link\s+rel="stylesheet"/.test(html)) {
  throw new Error('Sobrou referência externa: o arquivo mobile não ficaria autossuficiente.');
}

// 3) Autorizar os scripts inline na CSP (ver comentário do passo 2).
html = html.replace(
  /script-src 'self'/,
  `script-src 'self' ${scriptHashes.join(' ')}`
);
if (!new RegExp(scriptHashes[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html)) {
  throw new Error('CSP não foi atualizada com os hashes dos scripts inline.');
}

fs.writeFileSync(outPath, html, 'utf8');
console.log('Mobile gerado:', outPath, `(${html.length} bytes)`);
