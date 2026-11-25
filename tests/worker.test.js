import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Miniflare } from 'miniflare';
import { handleRequest } from '../worker/src/index.js';
import { todaySGT, workYearOf } from '../worker/src/rules.js';
import { initDataFor } from './tg_sign.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = [
  fs.readFileSync(path.join(ROOT, 'worker/migrations/0001_init.sql'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'worker/migrations/0002_admin.sql'), 'utf8'),
];

// Windows MAX_PATH workaround when the repo lives in a deeply nested directory (>250 chars).
if (process.platform === 'win32' && !process.env.MINIFLARE_WORKERD_PATH) {
  const req = createRequire(import.meta.url);
  const workerdBin = req('workerd').default;
  if (typeof workerdBin === 'string' && workerdBin.length >= 250) {
    const shortBin = path.join(os.tmpdir(), 'workerd-enforcer-nsmen.exe');
    const srcStat = fs.statSync(workerdBin);
    if (!fs.existsSync(shortBin) || fs.statSync(shortBin).size !== srcStat.size) {
      fs.copyFileSync(workerdBin, shortBin);
    }
    process.env.MINIFLARE_WORKERD_PATH = shortBin;
  }
}

const BOT_TOKEN = '123456:TEST-worker-token';
const ORIGIN = 'https://test.github.io';
const APP_URL = 'https://test.github.io/enforcer-nsmen/';
const HIGHEST_ADMIN_TG_ID = '5520881904';

function addDays(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

const TODAY = todaySGT(new Date());
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const DAY_AFTER = addDays(TODAY, 2);
const CUR_WY = workYearOf(TODAY);
const NEXT_WY_FIRST = `${CUR_WY + 1}-04-01`;

const ADMIN_SEED = { id: 5520881904, first_name: 'Ltc Tay', username: 'ltctay' };
const ADMIN_NEW = { id: 5520889999, first_name: 'Ltc New', username: 'ltcnew' };
const PLANNER_NON_NSMAN = { id: 6120458831, first_name: 'Ong', username: 'ong_pl' };
const NSMAN_LM = { id: 200001, first_name: 'LmOne', username: 'lm1' };
const NSMAN_LM2 = { id: 200002, first_name: 'LmTwo', username: 'lm2' };
const NSMAN_PILOT = { id: 300001, first_name: 'PilotOne', username: 'pilot1' };

const mockFetchOk = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const mockFetchFail = async () => new Response(JSON.stringify({ ok: false, description: 'Forbidden' }), { status: 403 });

async function execMigration(database, sql) {
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await database.prepare(stmt).run();
  }
}

const mf = new Miniflare({
  modules: true,
  modulesRoot: path.join(ROOT, 'worker/src'),
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  scriptPath: path.join(ROOT, 'worker/src/index.js'),
  compatibilityDate: '2025-09-06',
  d1Databases: ['DB'],
  bindings: {
    BOT_TOKEN,
    ALLOWED_ORIGIN: ORIGIN,
    APP_URL,
    HIGHEST_ADMIN_TG_ID,
  },
});

const db = await mf.getD1Database('DB');
for (const sql of MIGRATIONS) {
  await execMigration(db, sql);
}
const env = {
  DB: db,
  BOT_TOKEN,
  ALLOWED_ORIGIN: ORIGIN,
  APP_URL,
  HIGHEST_ADMIN_TG_ID,
};

test.after(async () => {
  await Promise.race([
    mf.dispose(),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
});

async function resetDb() {
  await db.batch([
    db.prepare('DELETE FROM cells'),
    db.prepare('DELETE FROM flight_days'),
    db.prepare('DELETE FROM planners'),
    db.prepare('DELETE FROM nsmen'),
    db.prepare('DELETE FROM admin'),
    db.prepare('DELETE FROM log'),
  ]);
}

async function apiReq(user, method, urlPath, body, { fetchImpl = mockFetchOk, origin = ORIGIN, now } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (user) {
    const authSec = now ? Math.floor(now().getTime() / 1000) : Math.floor(Date.now() / 1000);
    headers['X-Telegram-Init-Data'] = initDataFor(user, BOT_TOKEN, authSec);
  }
  const req = new Request(`https://worker.test${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p)); } };
  const res = await handleRequest(req, env, ctx, { fetchImpl, now });
  await Promise.all(pending);
  return res;
}

test('workerd runtime serves health, CORS, and rejects unauthenticated requests via Miniflare dispatchFetch', async () => {
  await resetDb();
  const health = await mf.dispatchFetch('https://worker.test/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const preflight = await mf.dispatchFetch('https://worker.test/api/init', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  const badOrigin = await mf.dispatchFetch('https://worker.test/api/init', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(badOrigin.headers.get('Access-Control-Allow-Origin'), null);

  const noAuth = await mf.dispatchFetch('https://worker.test/api/init');
  assert.equal(noAuth.status, 401);
  assert.equal((await noAuth.json()).code, 'AUTH');
});

test('HIGHEST_ADMIN_TG_ID seeds only while no admin stored; after pass-on, env-var ID is NOT admin any more', async () => {
  await resetDb();

  // Non-matching user does not seed admin
  const otherInit = await (await apiReq(NSMAN_LM, 'GET', '/api/init')).json();
  assert.equal(otherInit.isAdmin, false);
  assert.equal(otherInit.admin, null);

  // Matching HIGHEST_ADMIN_TG_ID seeds admin and gets all 5 departments
  const init1 = await mf.dispatchFetch('https://worker.test/api/init', {
    headers: { 'X-Telegram-Init-Data': initDataFor(ADMIN_SEED, BOT_TOKEN) },
  });
  const d1 = await init1.json();
  assert.equal(d1.ok, true);
  assert.equal(d1.me, null);
  assert.equal(d1.isAdmin, true);
  assert.equal(d1.admin.tg_id, HIGHEST_ADMIN_TG_ID);
  assert.deepEqual(d1.plannerDepts, ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2']);

  // Capture DM sent on pass-on
  const sentDms = [];
  const captureFetch = async (_url, init) => {
    sentDms.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  // Pass on Highest Admin to ADMIN_NEW
  const passRes = await apiReq(
    ADMIN_SEED,
    'POST',
    '/api/admin/pass',
    { tgId: String(ADMIN_NEW.id), name: 'LTC NEW IC' },
    { fetchImpl: captureFetch },
  );
  assert.equal(passRes.status, 200);
  const passData = await passRes.json();
  assert.equal(passData.isAdmin, false);
  assert.equal(passData.admin, null);
  assert.deepEqual(passData.plannerDepts, []);

  assert.equal(sentDms.length, 1);
  assert.equal(sentDms[0].chat_id, String(ADMIN_NEW.id));
  assert.equal(sentDms[0].text, "You're now the Highest Admin of Enforcer NSMEN.");

  // Even on subsequent requests, the env-var ID is NOT admin any more
  const afterInit = await (await apiReq(ADMIN_SEED, 'GET', '/api/init')).json();
  assert.equal(afterInit.isAdmin, false);
  assert.deepEqual(afterInit.plannerDepts, []);
  const deniedPass = await apiReq(ADMIN_SEED, 'POST', '/api/admin/pass', {
    tgId: String(ADMIN_SEED.id),
    name: 'TRY RECLAIM',
  });
  assert.equal(deniedPass.status, 403);

  // New admin IS admin and acts for all departments
  const newInit = await (await apiReq(ADMIN_NEW, 'GET', '/api/init')).json();
  assert.equal(newInit.isAdmin, true);
  assert.equal(newInit.admin.name, 'LTC NEW IC');
  assert.deepEqual(newInit.plannerDepts, ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2']);
});

test('non-NSman planner added by Telegram ID can load /api/init, plan, and planners.name appears in logs', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  const lm1 = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Loadmaster' })).json()).me;
  await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TOMORROW });

  // Add a planner who has NEVER joined as an NSman
  const addRes = await apiReq(ADMIN_SEED, 'POST', '/api/planners', {
    tgId: String(PLANNER_NON_NSMAN.id),
    name: 'me4 ong s.h.',
    dept: 'Loadmaster',
  });
  assert.equal(addRes.status, 200);

  // Non-NSman planner loads /api/init
  const plInit = await (await apiReq(PLANNER_NON_NSMAN, 'GET', '/api/init')).json();
  assert.equal(plInit.me, null);
  assert.equal(plInit.isAdmin, false);
  assert.equal(plInit.plannerName, 'ME4 ONG S.H.');
  assert.deepEqual(plInit.plannerDepts, ['Loadmaster']);
  assert.equal(plInit.nsmen.length, 1);

  // Non-NSman planner plans and sends SAF100, then withdraws
  const planRes = await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/cells/plan', { nsmanId: lm1.id, date: TOMORROW });
  assert.equal(planRes.status, 200);
  assert.equal((await planRes.json()).cell.planned_by, 'ME4 ONG S.H.');

  assert.equal((await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: TOMORROW })).status, 200);
  const wdRes = await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/cells/withdraw', {
    nsmanId: lm1.id,
    date: TOMORROW,
    reason: 'Sortie cancelled',
  });
  assert.equal(wdRes.status, 200);
  assert.equal((await wdRes.json()).cell.ended_by, 'ME4 ONG S.H.');

  const logs = await db.prepare("SELECT actor, action FROM log WHERE action IN ('plan', 'withdraw_saf100')").all();
  assert.ok(logs.results.every((l) => l.actor === 'ME4 ONG S.H.'));

  // Non-NSman Loadmaster planner cannot act on Pilot
  assert.equal((await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/flights', { dept: 'Pilot', date: TOMORROW })).status, 403);
});

test('full lifecycle: flight days, batch plan, un-mark planned, send, receive, cancel, same-day & past locks', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  const lm1 = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Loadmaster' })).json()).me;
  const lm2 = (await (await apiReq(NSMAN_LM2, 'POST', '/api/join', { name: 'ME2 BRAVO', dept: 'Loadmaster' })).json()).me;

  // Cannot join twice
  const dup = await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Pilot' });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, 'ALREADY_JOINED');

  // Post flight day
  const flRes = await apiReq(ADMIN_SEED, 'POST', '/api/flights', {
    dept: 'Loadmaster',
    date: TOMORROW,
    type: 'C-130',
    time: '0800-1500',
  });
  assert.equal(flRes.status, 200);

  // Past date refused
  const pastAvail = await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: YESTERDAY });
  assert.equal(pastAvail.status, 400);
  assert.equal((await pastAvail.json()).code, 'PAST');

  // Mark available for tomorrow & today
  assert.equal((await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TOMORROW })).status, 200);
  assert.equal((await apiReq(NSMAN_LM2, 'POST', '/api/cells/available', { date: TOMORROW })).status, 200);
  assert.equal((await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TODAY })).status, 200);

  // Batch plan both on tomorrow
  const batch = await apiReq(ADMIN_SEED, 'POST', '/api/cells/plan-batch', {
    nsmanIds: [lm1.id, lm2.id],
    date: TOMORROW,
  });
  assert.equal(batch.status, 200);
  assert.equal((await batch.json()).cells.length, 2);

  // Removing flight day leaves planned cells intact
  assert.equal((await apiReq(ADMIN_SEED, 'DELETE', '/api/flights', { dept: 'Loadmaster', date: TOMORROW })).status, 200);
  const checkInit = await (await apiReq(ADMIN_SEED, 'GET', '/api/init')).json();
  assert.equal(checkInit.flightDays.length, 0);
  assert.equal(checkInit.cells.filter((c) => c.date === TOMORROW && c.state === 'planned').length, 2);

  // Un-marking a planned day un-plans it
  const unmark = await apiReq(NSMAN_LM2, 'POST', '/api/cells/unavailable', { date: TOMORROW });
  assert.equal(unmark.status, 200);
  assert.equal((await unmark.json()).wasPlanned, true);

  // Send SAF100 -> Mark received -> Cancel -> Re-mark available
  assert.equal((await apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: TOMORROW })).status, 200);
  assert.equal((await apiReq(NSMAN_LM, 'POST', '/api/cells/received', { date: TOMORROW })).status, 200);
  const cancelRes = await apiReq(NSMAN_LM, 'POST', '/api/cells/cancel', { date: TOMORROW, reason: 'Work trip' });
  assert.equal(cancelRes.status, 200);
  assert.equal((await cancelRes.json()).cell.state, 'cancelled');
  assert.equal((await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TOMORROW })).status, 200);

  // Duty day itself: send ok, cancel and withdraw refused
  assert.equal((await apiReq(ADMIN_SEED, 'POST', '/api/cells/plan', { nsmanId: lm1.id, date: TODAY })).status, 200);
  assert.equal((await apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: TODAY })).status, 200);
  const cancelToday = await apiReq(NSMAN_LM, 'POST', '/api/cells/cancel', { date: TODAY, reason: '' });
  assert.equal(cancelToday.status, 400);
  assert.equal((await cancelToday.json()).code, 'TOO_LATE');
  const withdrawToday = await apiReq(ADMIN_SEED, 'POST', '/api/cells/withdraw', { nsmanId: lm1.id, date: TODAY, reason: '' });
  assert.equal(withdrawToday.status, 400);
  assert.equal((await withdrawToday.json()).code, 'TOO_LATE');
});

test('enforces 40-day cap atomically under concurrency, respects 1 Apr work year boundary, and returns withdrawn days', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  const lm1 = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME3 CAPTEST', dept: 'Loadmaster' })).json()).me;

  const seedStart = `${CUR_WY}-04-01`;
  const seedStmts = [];
  for (let i = 0; i < 39; i++) {
    const d = addDays(seedStart, i);
    seedStmts.push(
      db.prepare(
        `INSERT INTO cells (nsman_id, date, state, dept, planned_by, sent_at, received_at)
         VALUES (?, ?, 'received', 'Loadmaster', 'PLANNER', '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z')`,
      ).bind(lm1.id, d),
    );
  }
  for (const d of [TOMORROW, DAY_AFTER, NEXT_WY_FIRST]) {
    seedStmts.push(
      db.prepare(
        `INSERT INTO cells (nsman_id, date, state, dept, planned_by)
         VALUES (?, ?, 'planned', 'Loadmaster', 'PLANNER')`,
      ).bind(lm1.id, d),
    );
  }
  await db.batch(seedStmts);

  const [r1, r2] = await Promise.all([
    apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: TOMORROW }),
    apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: DAY_AFTER }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);

  const winnerDate = r1.status === 200 ? TOMORROW : DAY_AFTER;
  const loserDate = r1.status === 200 ? DAY_AFTER : TOMORROW;

  const nextWyRes = await apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: NEXT_WY_FIRST });
  assert.equal(nextWyRes.status, 200);

  const wdRes = await apiReq(ADMIN_SEED, 'POST', '/api/cells/withdraw', {
    nsmanId: lm1.id,
    date: winnerDate,
    reason: 'Sortie change',
  });
  assert.equal(wdRes.status, 200);
  const retryRes = await apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: loserDate });
  assert.equal(retryRes.status, 200);
});

test('department isolation, planner step-down vs admin removal, NSman edit/move/remove, and failed DM logging', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  const pilotNs = (await (await apiReq(NSMAN_PILOT, 'POST', '/api/join', { name: 'CPT PILOT', dept: 'Pilot' })).json()).me;
  const lmNs = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 LOAD', dept: 'Loadmaster' })).json()).me;
  await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TOMORROW });

  // Add CPT PILOT as sole Pilot planner with failing DM -> action succeeds and logs "message to X not delivered"
  const addPl = await apiReq(
    ADMIN_SEED,
    'POST',
    '/api/planners',
    { tgId: pilotNs.tg_id, name: 'CPT PILOT', dept: 'Pilot' },
    { fetchImpl: mockFetchFail },
  );
  assert.equal(addPl.status, 200);

  const failedLogs = await db.prepare("SELECT detail FROM log WHERE action = 'dm_failed'").all();
  assert.ok(failedLogs.results.some((l) => l.detail === 'message to CPT PILOT not delivered'));

  // Sole Pilot planner cannot step down
  const lastRm = await apiReq(NSMAN_PILOT, 'DELETE', '/api/planners', { tgId: pilotNs.tg_id, dept: 'Pilot' });
  assert.equal(lastRm.status, 409);
  assert.equal((await lastRm.json()).code, 'LAST_PLANNER');

  // Pilot planner cannot act on Loadmaster NSman, flight days, or CSV export
  assert.equal((await apiReq(NSMAN_PILOT, 'POST', '/api/cells/plan', { nsmanId: lmNs.id, date: TOMORROW })).status, 403);
  assert.equal((await apiReq(NSMAN_PILOT, 'POST', '/api/flights', { dept: 'Loadmaster', date: TOMORROW })).status, 403);
  assert.equal((await apiReq(NSMAN_PILOT, 'POST', '/api/export-link', { workYear: CUR_WY, dept: 'Loadmaster' })).status, 403);

  // Highest Admin CAN remove the last planner of Pilot
  const adminRm = await apiReq(ADMIN_SEED, 'DELETE', '/api/planners', { tgId: pilotNs.tg_id, dept: 'Pilot' });
  assert.equal(adminRm.status, 200);
  const pilotPlanners = await db.prepare("SELECT * FROM planners WHERE dept = 'Pilot'").all();
  assert.equal(pilotPlanners.results.length, 0);

  // Edit & move NSman, then remove
  const editRes = await apiReq(ADMIN_SEED, 'PATCH', `/api/nsmen/${lmNs.id}`, {
    name: 'ME3 LOAD NEW',
    dept: 'Tacco',
  });
  assert.equal(editRes.status, 200);
  assert.equal((await editRes.json()).nsman.dept, 'Tacco');
  assert.equal((await apiReq(ADMIN_SEED, 'DELETE', `/api/nsmen/${lmNs.id}`)).status, 200);
});

test('signed export-link token works without initData, rejects expired/tampered tokens, and guards CSV formulas', async () => {
  await resetDb();
  const baseMs = Date.now();
  const nowBase = () => new Date(baseMs);

  await apiReq(ADMIN_SEED, 'GET', '/api/init', undefined, { now: nowBase });
  const lm1 = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 FORMULA', dept: 'Loadmaster' }, { now: nowBase })).json()).me;
  await apiReq(NSMAN_LM, 'POST', '/api/cells/available', { date: TOMORROW }, { now: nowBase });
  await apiReq(ADMIN_SEED, 'POST', '/api/cells/plan', { nsmanId: lm1.id, date: TOMORROW }, { now: nowBase });
  await apiReq(ADMIN_SEED, 'POST', '/api/cells/send', { nsmanId: lm1.id, date: TOMORROW }, { now: nowBase });
  await apiReq(
    NSMAN_LM,
    'POST',
    '/api/cells/cancel',
    { date: TOMORROW, reason: '=CMD|calc!A0' },
    { now: nowBase },
  );
  await apiReq(
    ADMIN_SEED,
    'POST',
    '/api/flights',
    { dept: 'Loadmaster', date: TOMORROW, type: '+C-130', time: '@0800' },
    { now: nowBase },
  );

  // Request short-lived signed export URL
  const linkRes = await apiReq(
    ADMIN_SEED,
    'POST',
    '/api/export-link',
    { workYear: CUR_WY, dept: 'Loadmaster' },
    { now: nowBase },
  );
  assert.equal(linkRes.status, 200);
  const linkData = await linkRes.json();
  assert.match(linkData.url, /^\/api\/export\.csv\?token=/);
  assert.equal(linkData.filename, `enforcer-nsmen-WY${CUR_WY}-loadmaster.csv`);

  // Download CSV using ONLY the signed URL (no X-Telegram-Init-Data header)
  const dlRes = await apiReq(null, 'GET', linkData.url, undefined, { now: () => new Date(baseMs + 60 * 1000) });
  assert.equal(dlRes.status, 200);
  assert.match(dlRes.headers.get('Content-Type'), /text\/csv/);
  assert.match(dlRes.headers.get('Content-Disposition'), /^attachment; filename="enforcer-nsmen-/);
  const csv = await dlRes.text();
  assert.ok(csv.includes('name,department,date,state,flight_type,flight_time,sent_at,received_at,ended_at,ended_by,reason'));
  assert.ok(csv.includes("'+C-130"));
  assert.ok(csv.includes("'@0800"));
  assert.ok(csv.includes("'=CMD|calc!A0"));

  // Tampered token is rejected (401)
  const tamperedUrl = linkData.url.slice(0, -1) + (linkData.url.endsWith('a') ? 'b' : 'a');
  const badRes = await apiReq(null, 'GET', tamperedUrl, undefined, { now: nowBase });
  assert.equal(badRes.status, 401);
  assert.equal((await badRes.json()).code, 'BAD_TOKEN');

  // Expired token (> 5 minutes) is rejected (401)
  const expRes = await apiReq(null, 'GET', linkData.url, undefined, { now: () => new Date(baseMs + 301 * 1000) });
  assert.equal(expRes.status, 401);
  assert.equal((await expRes.json()).code, 'EXPIRED_TOKEN');
});

test('Highest Admin can rename self via PATCH /api/admin/me; planner and others get 403; bad name gets 400', async () => {
  await resetDb();

  // Seed admin from Telegram first_name ("LTC TAY")
  const init1 = await (await apiReq(ADMIN_SEED, 'GET', '/api/init')).json();
  assert.equal(init1.isAdmin, true);
  assert.equal(init1.admin.name, 'LTC TAY');
  assert.equal(init1.plannerName, 'LTC TAY');

  // Add a department planner and join a regular NSman
  await apiReq(ADMIN_SEED, 'POST', '/api/planners', {
    tgId: String(PLANNER_NON_NSMAN.id),
    name: 'ME4 ONG S.H.',
    dept: 'Loadmaster',
  });
  await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Loadmaster' });

  // Department planner cannot rename Highest Admin (403)
  const plannerRes = await apiReq(PLANNER_NON_NSMAN, 'PATCH', '/api/admin/me', { name: 'ME4 HACK' });
  assert.equal(plannerRes.status, 403);
  assert.equal((await plannerRes.json()).code, 'FORBIDDEN');

  // Regular NSman cannot rename Highest Admin (403)
  const nsmanRes = await apiReq(NSMAN_LM, 'PATCH', '/api/admin/me', { name: 'ME2 HACK' });
  assert.equal(nsmanRes.status, 403);
  assert.equal((await nsmanRes.json()).code, 'FORBIDDEN');

  // Unjoined outsider cannot rename Highest Admin (403)
  const outsiderRes = await apiReq(ADMIN_NEW, 'PATCH', '/api/admin/me', { name: 'OUTSIDER' });
  assert.equal(outsiderRes.status, 403);

  // Bad names rejected with 400
  const emptyRes = await apiReq(ADMIN_SEED, 'PATCH', '/api/admin/me', { name: '   ' });
  assert.equal(emptyRes.status, 400);
  assert.equal((await emptyRes.json()).code, 'BAD_NAME');

  const longRes = await apiReq(ADMIN_SEED, 'PATCH', '/api/admin/me', { name: 'A'.repeat(61) });
  assert.equal(longRes.status, 400);
  assert.equal((await longRes.json()).code, 'BAD_NAME');

  // Highest Admin renames self -> trimmed & uppercased, returned in payload & persisted
  const okRes = await apiReq(ADMIN_SEED, 'PATCH', '/api/admin/me', { name: '  maj   brandon tan  ' });
  assert.equal(okRes.status, 200);
  const okData = await okRes.json();
  assert.equal(okData.admin.name, 'MAJ BRANDON TAN');
  assert.equal(okData.plannerName, 'MAJ BRANDON TAN');

  // Subsequent /api/init reflects new name
  const init2 = await (await apiReq(ADMIN_SEED, 'GET', '/api/init')).json();
  assert.equal(init2.admin.name, 'MAJ BRANDON TAN');
  assert.equal(init2.plannerName, 'MAJ BRANDON TAN');

  // Rename log row written, and subsequent actions log the new name as actor
  await apiReq(ADMIN_SEED, 'POST', '/api/flights', { dept: 'Loadmaster', date: TOMORROW, type: 'C-130', time: '0800-1500' });
  const logs = await db
    .prepare("SELECT actor, action, detail FROM log WHERE action IN ('rename_highest_admin', 'set_flight_day') ORDER BY id")
    .all();
  assert.equal(logs.results.length, 2);
  assert.equal(logs.results[0].action, 'rename_highest_admin');
  assert.equal(logs.results[0].actor, 'MAJ BRANDON TAN');
  assert.equal(logs.results[0].detail, 'LTC TAY -> MAJ BRANDON TAN');
  assert.equal(logs.results[1].action, 'set_flight_day');
  assert.equal(logs.results[1].actor, 'MAJ BRANDON TAN');
});

test('batch availability: marks only valid, skips past/out-of-window/sent/received, un-plans with ONE planner DM, isolates users, refuses >120', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  const lm1 = (await (await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Loadmaster' })).json()).me;
  const lm2 = (await (await apiReq(NSMAN_LM2, 'POST', '/api/join', { name: 'ME3 BRAVO', dept: 'Loadmaster' })).json()).me;
  await apiReq(ADMIN_SEED, 'POST', '/api/planners', {
    tgId: String(PLANNER_NON_NSMAN.id),
    name: 'ME4 ONG S.H.',
    dept: 'Loadmaster',
  });

  // Non-NSman planner is refused with 403
  const nonNsRes = await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/cells/available-batch', { dates: [TOMORROW] });
  assert.equal(nonNsRes.status, 403);
  assert.equal((await nonNsRes.json()).code, 'NOT_JOINED');

  // >120 dates refused with 400 on both endpoints
  const over120 = Array.from({ length: 121 }, (_, i) => addDays(TODAY, i));
  const tooManyMark = await apiReq(NSMAN_LM, 'POST', '/api/cells/available-batch', { dates: over120 });
  assert.equal(tooManyMark.status, 400);
  assert.equal((await tooManyMark.json()).code, 'TOO_MANY_DATES');
  const tooManyUnmark = await apiReq(NSMAN_LM, 'POST', '/api/cells/unavailable-batch', { dates: over120 });
  assert.equal(tooManyUnmark.status, 400);
  assert.equal((await tooManyUnmark.json()).code, 'TOO_MANY_DATES');

  const d1 = TOMORROW;
  const d2 = DAY_AFTER;
  const d3 = addDays(TODAY, 3);
  const d4 = addDays(TODAY, 4);
  const d5 = addDays(TODAY, 5);
  const d6 = addDays(TODAY, 6);
  const outOfWindow = `${CUR_WY + 2}-04-01`;

  // Seed lm1 cells in various states + lm2 cells on overlapping dates
  await db.batch([
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept) VALUES (?, ?, 'cancelled', 'Loadmaster')`).bind(lm1.id, d2),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept, sent_at) VALUES (?, ?, 'sent', 'Loadmaster', '2026-11-24T00:00:00Z')`).bind(lm1.id, d3),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept, sent_at, received_at) VALUES (?, ?, 'received', 'Loadmaster', '2026-11-24T00:00:00Z', '2026-11-24T01:00:00Z')`).bind(lm1.id, d4),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept, planned_by) VALUES (?, ?, 'planned', 'Loadmaster', 'ME4 ONG S.H.')`).bind(lm1.id, d5),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept, planned_by) VALUES (?, ?, 'planned', 'Loadmaster', 'ME4 ONG S.H.')`).bind(lm1.id, d6),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept) VALUES (?, ?, 'available', 'Loadmaster')`).bind(lm2.id, d1),
    db.prepare(`INSERT INTO cells (nsman_id, date, state, dept, planned_by) VALUES (?, ?, 'planned', 'Loadmaster', 'ME4 ONG S.H.')`).bind(lm2.id, d5),
  ]);

  // available-batch marks only d1 (none) and d2 (cancelled), skips sent/received/planned/past/out-of-window
  const markRes = await apiReq(NSMAN_LM, 'POST', '/api/cells/available-batch', {
    nsmanId: lm2.id, // ignored; own cells only
    dates: [d1, d2, d3, d4, d5, YESTERDAY, outOfWindow],
  });
  assert.equal(markRes.status, 200);
  const markData = await markRes.json();
  assert.equal(markData.ok, true);
  assert.deepEqual(markData.done, [d1, d2]);
  assert.deepEqual(markData.skipped, [
    { date: d3, reason: 'SAF100 already sent' },
    { date: d4, reason: 'SAF100 already sent' },
    { date: d5, reason: 'already planned' },
    { date: YESTERDAY, reason: 'past date' },
    { date: outOfWindow, reason: 'outside marking window' },
  ]);

  // Verify lm1 states updated and lm2 untouched
  const lm1AfterMark = (await db.prepare('SELECT date, state FROM cells WHERE nsman_id = ? ORDER BY date').bind(lm1.id).all()).results;
  assert.deepEqual(lm1AfterMark, [
    { date: d1, state: 'available' },
    { date: d2, state: 'available' },
    { date: d3, state: 'sent' },
    { date: d4, state: 'received' },
    { date: d5, state: 'planned' },
    { date: d6, state: 'planned' },
  ]);
  const lm2AfterMark = (await db.prepare('SELECT date, state FROM cells WHERE nsman_id = ? ORDER BY date').bind(lm2.id).all()).results;
  assert.deepEqual(lm2AfterMark, [
    { date: d1, state: 'available' },
    { date: d5, state: 'planned' },
  ]);

  // unavailable-batch un-marks d1 (available) + d5 & d6 (planned), skips sent/received/past, sends ONE planner message
  const sentDms = [];
  const captureFetch = async (_url, init) => {
    sentDms.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const unmarkRes = await apiReq(
    NSMAN_LM,
    'POST',
    '/api/cells/unavailable-batch',
    { nsmanId: lm2.id, dates: [d1, d5, d6, d3, d4, YESTERDAY] },
    { fetchImpl: captureFetch },
  );
  assert.equal(unmarkRes.status, 200);
  const unmarkData = await unmarkRes.json();
  assert.equal(unmarkData.ok, true);
  assert.deepEqual(unmarkData.done, [d1, d5, d6]);
  assert.deepEqual(unmarkData.skipped, [
    { date: d3, reason: 'SAF100 already sent' },
    { date: d4, reason: 'SAF100 already sent' },
    { date: YESTERDAY, reason: 'past date' },
  ]);

  // Exactly ONE Telegram DM sent to the Loadmaster planner listing both un-planned dates
  assert.equal(sentDms.length, 1);
  assert.equal(sentDms[0].chat_id, String(PLANNER_NON_NSMAN.id));
  assert.match(sentDms[0].text, /ME2 ALPHA/);
  assert.match(sentDms[0].text, /2 dates where they were planned/);

  // Verify lm1 cells: d1, d5, d6 removed; d2, d3, d4 remain; lm2 still completely untouched
  const lm1AfterUnmark = (await db.prepare('SELECT date, state FROM cells WHERE nsman_id = ? ORDER BY date').bind(lm1.id).all()).results;
  assert.deepEqual(lm1AfterUnmark, [
    { date: d2, state: 'available' },
    { date: d3, state: 'sent' },
    { date: d4, state: 'received' },
  ]);
  const lm2AfterUnmark = (await db.prepare('SELECT date, state FROM cells WHERE nsman_id = ? ORDER BY date').bind(lm2.id).all()).results;
  assert.deepEqual(lm2AfterUnmark, [
    { date: d1, state: 'available' },
    { date: d5, state: 'planned' },
  ]);

  // Verify batch summary log rows were recorded
  const batchLogs = (await db.prepare("SELECT actor, action, detail FROM log WHERE action LIKE '%_batch' ORDER BY id").all()).results;
  assert.equal(batchLogs.length, 2);
  assert.equal(batchLogs[0].action, 'mark_available_batch');
  assert.equal(batchLogs[1].action, 'unmark_planned_batch');
});

test('flight broadcast: messages every NSman in the dept with upcoming flights, logs it, shows last send in init, and guards access', async () => {
  await resetDb();
  await apiReq(ADMIN_SEED, 'GET', '/api/init');
  await apiReq(NSMAN_LM, 'POST', '/api/join', { name: 'ME2 ALPHA', dept: 'Loadmaster' });
  await apiReq(NSMAN_LM2, 'POST', '/api/join', { name: 'ME3 BRAVO', dept: 'Loadmaster' });
  await apiReq(NSMAN_PILOT, 'POST', '/api/join', { name: 'CPT DELTA', dept: 'Pilot' });
  await apiReq(ADMIN_SEED, 'POST', '/api/planners', {
    tgId: String(PLANNER_NON_NSMAN.id),
    name: 'ME4 ONG S.H.',
    dept: 'Loadmaster',
  });

  const month = TOMORROW.slice(0, 7);
  assert.equal(
    (await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/flights', { dept: 'Loadmaster', date: TOMORROW, type: 'C-130', time: '0800-1500' })).status,
    200,
  );
  // A flight that has already passed in the same month is left out of the message
  await db
    .prepare("INSERT INTO flight_days (dept, date, type, time) VALUES ('Loadmaster', ?, 'Old sortie', '')")
    .bind(`${month}-01` < TODAY ? `${month}-01` : '2000-01-01')
    .run();

  const sentDms = [];
  const captureFetch = async (_url, init) => {
    sentDms.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const res = await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/flights/broadcast', { dept: 'Loadmaster', month }, { fetchImpl: captureFetch });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.recipients, 2);
  assert.equal(data.flights, 1);
  assert.equal(data.broadcast.dept, 'Loadmaster');
  assert.equal(data.broadcast.month, month);
  assert.equal(data.broadcast.actor, 'ME4 ONG S.H.');

  // Background sends finish on their own; wait briefly for them
  for (let i = 0; i < 50 && sentDms.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sentDms.map((m) => m.chat_id).sort(), [String(NSMAN_LM.id), String(NSMAN_LM2.id)]);
  for (const m of sentDms) {
    assert.match(m.text, /^Loadmaster flights for \w+ \d{4} are out:\n• \w{3} \d{1,2} \w{3} – C-130, 0800-1500\n\nOpen the app and select the days you can fly\.$/);
    assert.ok(!m.text.includes('Old sortie'));
    assert.equal(m.reply_markup.inline_keyboard[0][0].web_app.url, APP_URL);
  }

  const logs = await db.prepare("SELECT actor, detail FROM log WHERE action = 'broadcast_flights'").all();
  assert.equal(logs.results.length, 1);
  assert.equal(logs.results[0].actor, 'ME4 ONG S.H.');
  assert.equal(logs.results[0].detail, `Loadmaster ${month} to 2 NSmen`);

  // Planner's init shows the last broadcast for their dept; an NSman's does not
  const plInit = await (await apiReq(PLANNER_NON_NSMAN, 'GET', '/api/init')).json();
  assert.equal(plInit.broadcasts.length, 1);
  assert.deepEqual(
    { dept: plInit.broadcasts[0].dept, month: plInit.broadcasts[0].month, actor: plInit.broadcasts[0].actor },
    { dept: 'Loadmaster', month, actor: 'ME4 ONG S.H.' },
  );
  const nsInit = await (await apiReq(NSMAN_LM, 'GET', '/api/init')).json();
  assert.deepEqual(nsInit.broadcasts, []);

  // Sending again is allowed and the newest send wins in init
  assert.equal((await apiReq(ADMIN_SEED, 'POST', '/api/flights/broadcast', { dept: 'Loadmaster', month })).status, 200);
  const plInit2 = await (await apiReq(PLANNER_NON_NSMAN, 'GET', '/api/init')).json();
  assert.equal(plInit2.broadcasts.length, 1);
  assert.equal(plInit2.broadcasts[0].actor, 'LTC TAY');

  // Guards: other dept, NSman, bad month, no upcoming flights, no NSmen
  assert.equal((await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/flights/broadcast', { dept: 'Pilot', month })).status, 403);
  assert.equal((await apiReq(NSMAN_LM, 'POST', '/api/flights/broadcast', { dept: 'Loadmaster', month })).status, 403);
  assert.equal((await apiReq(PLANNER_NON_NSMAN, 'POST', '/api/flights/broadcast', { dept: 'Loadmaster', month: '2026-13' })).status, 400);
  const noFl = await apiReq(ADMIN_SEED, 'POST', '/api/flights/broadcast', { dept: 'Pilot', month });
  assert.equal(noFl.status, 400);
  assert.match((await noFl.json()).error, /No upcoming Pilot flights/);
  await apiReq(ADMIN_SEED, 'POST', '/api/flights', { dept: 'Tacco', date: TOMORROW });
  const noNs = await apiReq(ADMIN_SEED, 'POST', '/api/flights/broadcast', { dept: 'Tacco', month });
  assert.equal(noNs.status, 400);
  assert.match((await noNs.json()).error, /No Tacco NSmen/);
});
