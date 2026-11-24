import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportToken, verifyExportToken, verifyInitData } from '../worker/src/auth.js';
import { initDataFor } from './tg_sign.js';

const TOKEN = '123456:TEST-bot-token';
const NOW = 1796000000;
const USER = { id: 90001, first_name: 'Test', username: 'test_nsman' };

async function errCode(fn) {
  try {
    await fn();
  } catch (err) {
    return err.code;
  }
  return 'NO_ERROR';
}

test('valid initData returns user id and username', async () => {
  const initData = initDataFor(USER, TOKEN, NOW - 60);
  const res = await verifyInitData(initData, TOKEN, NOW);
  assert.equal(res.id, '90001');
  assert.equal(res.username, 'test_nsman');
});

test('tampered user id is rejected', async () => {
  const good = initDataFor(USER, TOKEN, NOW - 60);
  const tampered = good.replace(encodeURIComponent('90001'), encodeURIComponent('99999'));
  assert.notEqual(tampered, good);
  assert.equal(await errCode(() => verifyInitData(tampered, TOKEN, NOW)), 'AUTH');
});

test('wrong bot token is rejected', async () => {
  const initData = initDataFor(USER, 'other:token', NOW);
  assert.equal(await errCode(() => verifyInitData(initData, TOKEN, NOW)), 'AUTH');
});

test('missing or malformed hash is rejected', async () => {
  const noHash = initDataFor(USER, TOKEN, NOW).replace(/&hash=[0-9a-f]+$/, '');
  assert.equal(await errCode(() => verifyInitData(noHash, TOKEN, NOW)), 'AUTH');
  assert.equal(await errCode(() => verifyInitData('', TOKEN, NOW)), 'AUTH');
  assert.equal(await errCode(() => verifyInitData(null, TOKEN, NOW)), 'AUTH');
});

test('initData older than 24 hours is rejected', async () => {
  const expired = initDataFor(USER, TOKEN, NOW - 86401);
  assert.equal(await errCode(() => verifyInitData(expired, TOKEN, NOW)), 'AUTH');

  const fresh = initDataFor(USER, TOKEN, NOW - 86400);
  const res = await verifyInitData(fresh, TOKEN, NOW);
  assert.equal(res.id, '90001');
});

test('auth error message guides user to Telegram link', async () => {
  await assert.rejects(
    () => verifyInitData('', TOKEN, NOW),
    (err) => err.code === 'AUTH' && err.status === 401 && /Telegram link/.test(err.message),
  );
});

test('export token verifies when valid and rejects expired, tampered, or wrong-key tokens', async () => {
  const tok = await createExportToken(
    { tgId: '90001', dept: 'Loadmaster', workYear: 2026, exp: NOW + 300 },
    TOKEN,
  );
  const ok = await verifyExportToken(tok, TOKEN, NOW + 60);
  assert.deepEqual(ok, { tgId: '90001', dept: 'Loadmaster', workYear: 2026, exp: NOW + 300 });

  // Expired after 5 minutes
  assert.equal(await errCode(() => verifyExportToken(tok, TOKEN, NOW + 301)), 'EXPIRED_TOKEN');

  // Tampered payload or signature
  const [payload, sig] = tok.split('.');
  const badSig = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
  assert.equal(await errCode(() => verifyExportToken(`${payload}.${badSig}`, TOKEN, NOW)), 'BAD_TOKEN');
  assert.equal(await errCode(() => verifyExportToken(`x${payload}.${sig}`, TOKEN, NOW)), 'BAD_TOKEN');

  // Wrong bot token
  assert.equal(await errCode(() => verifyExportToken(tok, 'other:token', NOW)), 'BAD_TOKEN');
});
