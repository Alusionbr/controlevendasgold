'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('login aceita usuário técnico sem expor chave privilegiada', () => {
  const api = read('src/api.js');
  assert.match(api, /function loginEmailFor\(identifier\)/);
  assert.match(api, /return `c360\.\$\{normalized\}@\$\{SELLER_LOGIN_DOMAIN\}`/);
  assert.match(api, /if \(normalized\.includes\('@'\)\) return normalized/);
  assert.doesNotMatch(api, /service[_-]?role/i);
});

test('admin cadastra usuário e redefine usuário e senha', () => {
  const auth = read('src/auth.js');
  assert.match(auth, /name="identifier"/);
  assert.match(auth, /name="username"/);
  assert.match(auth, /data-reset-password-form/);
  assert.match(auth, /resetSellerPassword\(\{ sellerId, username, password \}\)/);
  assert.match(auth, /minlength="8"/);
});

test('edge function valida admin, negócio e não envia e-mail', () => {
  const edge = read('supabase/functions/create-seller/index.ts');
  assert.match(edge, /callerProfile\.role !== 'admin'/);
  assert.match(edge, /eq\('business_id', callerProfile\.business_id\)/);
  assert.match(edge, /email_confirm: true/);
  assert.match(edge, /auth\.admin\.updateUserById/);
  assert.match(edge, /WEB_ORIGIN = 'https:\/\/alusionbr\.github\.io'/);
  assert.match(edge, /LOCAL_FILE_ORIGIN = 'null'/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin': '\*'/);
  assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY[^\n]*(console|jsonResponse)/);
});

test('migração impõe formato e unicidade do usuário', () => {
  const sql = read('supabase/migrations/20260729195013_seller_username_login.sql');
  assert.match(sql, /add column if not exists username text/);
  assert.match(sql, /profiles_username_format_check/);
  assert.match(sql, /create unique index if not exists idx_profiles_username_unique/);
  assert.match(sql, /where username is not null/);
});
