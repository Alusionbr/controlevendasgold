'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = 'supabase/migrations/20260730125828_seller_balance_alignment_login_rewards.sql';

test('alinhamento é atômico, auditável e consumido uma única vez', () => {
  const sql = read(migration);
  for (const required of [
    'balance_alignment_credits between 0 and 1',
    'for update',
    'lock table public.seller_account_entries in share row exclusive mode',
    "'manual_adjustment'",
    "'balance_alignment'",
    'insert into public.seller_balance_alignments',
    'set balance_alignment_credits = 0',
    'revoke all on function public.seller_align_balance(numeric, text) from public, anon',
  ]) assert.ok(sql.toLowerCase().includes(required.toLowerCase()), `regra ausente: ${required}`);
});

test('sequência diária é idempotente e entrega um crédito a cada 15 dias', () => {
  const sql = read(migration);
  for (const required of [
    "time zone 'America/Sao_Paulo'",
    'on conflict (seller_id) do nothing',
    'for update',
    'v_row.last_login_date = v_today',
    'v_row.last_login_date = v_today - 1',
    'mod(v_next_streak, 15) = 0',
    'gift_credits = gift_credits + v_earned',
    'gift_credits = gift_credits - 1',
  ]) assert.ok(sql.includes(required), `regra de sequência ausente: ${required}`);
});

test('resgate do brinde exige administrador e vendedor da mesma empresa', () => {
  const sql = read(migration);
  assert.match(sql, /v_role <> 'admin'/);
  assert.match(sql, /p\.business_id = v_business_id/);
  assert.match(sql, /insert into public\.seller_gift_redemptions/);
});

test('troca de senha própria confirma a senha atual antes da atualização', () => {
  const api = read('src/api.js');
  const start = api.indexOf('async function changeOwnPassword');
  const end = api.indexOf('async function listSellers', start);
  const block = api.slice(start, end);
  assert.match(block, /getAuthUser\(\)/);
  assert.match(block, /grant_type=password/);
  assert.match(block, /currentPassword/);
  assert.match(block, /method: 'PUT'/);
  assert.match(block, /body: JSON\.stringify\(\{ password:/);
});

test('interfaces expõem a tarefa, a liberação do admin e a troca de senha', () => {
  const seller = read('src/sellerLedger.js');
  const admin = read('src/salesCart.js');
  assert.match(seller, /Tarefa: entrar 15 dias seguidos/);
  assert.match(seller, /Alterar minha senha/);
  assert.match(admin, /grant-balance-alignment/);
  assert.match(admin, /redeem-login-gift/);
});