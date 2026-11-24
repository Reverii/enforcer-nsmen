import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let server, base, browser;

test.before(async () => {
  server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, clean === '/' ? 'index.html' : clean);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function open({
  initData = 'test-init-data',
  joined = true,
  isAdmin = false,
  plannerDepts = ['Loadmaster', 'Pilot'],
  plannerName = '',
  tgId = '6982215470',
  delay = 0,
  bravoAtCap = false,
  hasDownloadFile = false,
  width = 390,
} = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.addInitScript(
    ({ initData, joined, isAdmin, plannerDepts, plannerName, tgId, delay, bravoAtCap, hasDownloadFile }) => {
      window.APP_TODAY = '2026-11-24';
      window.FAKE_OPTS = { joined, isAdmin, plannerDepts, plannerName, tgId, delay, bravoAtCap };
      window.DOWNLOAD_CALLS = [];
      const webApp = {
        initData,
        colorScheme: 'light',
        themeParams: {},
        ready() {},
        expand() {},
        requestWriteAccess(cb) { cb(true); },
      };
      if (hasDownloadFile) {
        webApp.downloadFile = (opts) => { window.DOWNLOAD_CALLS.push(opts); };
      }
      window.Telegram = { WebApp: webApp };
    },
    { initData, joined, isAdmin, plannerDepts, plannerName, tgId, delay, bravoAtCap, hasDownloadFile },
  );
  await page.addInitScript({ content: fs.readFileSync(path.join(import.meta.dirname, 'fake_api.js'), 'utf8') });
  await page.goto(base);
  page.errors = errors;
  return page;
}

test('outside Telegram shows link message and makes no requests', async () => {
  const page = await open({ initData: '' });
  await page.getByText('Open Enforcer NSMEN from the Telegram link.').waitFor();
  const count = await page.evaluate(() => window.FAKE.calls.length);
  assert.equal(count, 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('joining screen shows Telegram ID with Copy button, help line, and joins department', async () => {
  const page = await open({ joined: false, plannerDepts: [], tgId: '6982215470' });
  await page.getByText('Join your department').waitFor();
  await page.getByText('Your Telegram ID').waitFor();
  assert.equal(await page.locator('#myTg').innerText(), '6982215470');
  await page.getByText(/Planner, not an NSman\?/).waitFor();
  await page.locator('#copyTg').click();

  await page.locator('#jname').fill('3sg echo');
  await page.locator('input[name="dept"][value="Loadmaster"]').check();
  await page.locator('#joinBtn').click();
  await page.getByRole('heading', { name: 'My days' }).waitFor();
  // About me line shows Telegram ID on My days
  assert.equal(await page.locator('#aboutTg').innerText(), '6982215470');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('non-NSman planner never sees the joining screen and lands directly on Planner tab', async () => {
  const page = await open({
    joined: false,
    isAdmin: false,
    plannerDepts: ['Loadmaster'],
    plannerName: 'ME4 ONG S.H.',
    tgId: '6120458831',
  });
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  assert.equal(await page.getByText('Join your department').count(), 0);
  assert.equal(await page.locator('#tabMine').count(), 0);
  assert.equal(await page.locator('#tabAdmin').count(), 0);
  assert.equal(await page.locator('#aboutTg').innerText(), '6120458831');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Highest Admin sees Admin tab, adds/removes planners, and passes on Highest Admin', async () => {
  const page = await open({
    joined: false,
    isAdmin: true,
    tgId: '5520881904',
  });
  // Non-NSman Highest Admin lands on Planner tab, never sees joining screen, and sees Admin tab
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  assert.equal(await page.getByText('Join your department').count(), 0);
  assert.equal(await page.locator('#tabAdmin').count(), 1);
  assert.equal(await page.locator('#tabMine').count(), 0);

  // Open Admin tab
  await page.locator('#tabAdmin').click();
  await page.getByRole('heading', { name: 'Admin', exact: true }).waitFor();
  await page.getByText('MAJ RAHMAN A.').waitFor();

  // Add a planner by Telegram ID
  await page.locator('#apTg').fill('7741902256');
  await page.locator('#apName').fill('ME3 KUMAR R.');
  await page.locator('#apDept').selectOption('Tacco');
  await page.locator('#addPlBtn').click();
  await page.getByText('ME3 KUMAR R. added as Tacco planner').waitFor();
  await page.getByText('TG 7741902256').waitFor();

  // Remove the sole Tacco planner (two-tap confirm)
  const rmBtn = page.locator('[data-rm="Tacco|7741902256"]');
  await rmBtn.click();
  assert.equal(await rmBtn.innerText(), 'Tap again to confirm');
  await rmBtn.click();
  await page.getByText('ME3 KUMAR R. removed from Tacco planners').waitFor();

  // Pass on Highest Admin (two-tap confirm -> loses Admin tab)
  await page.locator('#paTg').fill('5520889999');
  await page.locator('#paName').fill('LTC NEW IC');
  await page.locator('#passAdBtn').click();
  await page.getByText(/becomes Highest Admin and you lose the Admin tab/).waitFor();
  await page.locator('#passAdBtn').click();
  await page.getByText('Highest Admin passed to LTC NEW IC').waitFor();
  assert.equal(await page.locator('#tabAdmin').count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('NSman marks available, confirms SAF100 received, and cancels SAF100 with reason', async () => {
  const page = await open({ plannerDepts: [] });
  await page.getByRole('heading', { name: 'My days' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.FAKE.calls.map((c) => c.path)), ['/api/init']);

  await page.locator('#conf').click();
  await page.getByText('SAF100 received for Wed 9 Dec').waitFor();

  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByText('December 2026').waitFor();
  await page.locator('#nscal [data-d="2026-12-18"]').click();
  await page.getByRole('button', { name: 'Mark available' }).click();
  await page.locator('#nscal [data-d="2026-12-18"].s-available').waitFor();

  await page.locator('#nscal [data-d="2026-12-09"]').click();
  await page.getByRole('button', { name: 'Cancel SAF100' }).click();
  await page.locator('#why').fill('Work trip');
  await page.getByRole('button', { name: 'Cancel SAF100 for Wed 9 Dec' }).click();
  await page.locator('#nscal [data-d="2026-12-09"].s-ended').waitFor();

  assert.deepEqual(page.errors, []);
  await page.close();
});

test('optimistic update reverts with error toast when server refuses', async () => {
  const page = await open({ plannerDepts: [] });
  await page.getByRole('heading', { name: 'My days' }).waitFor();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.evaluate(() => { window.FAKE.state.failNext = 'Server refused test'; });
  await page.locator('#nscal [data-d="2026-12-20"]').click();
  await page.getByRole('button', { name: 'Mark available' }).click();
  await page.getByRole('alert', { name: '' }).or(page.locator('.toast.err')).waitFor();
  assert.match(await page.locator('.toast.err').innerText(), /Server refused test/);
  const hasAvail = await page.locator('#nscal [data-d="2026-12-20"].s-available').count();
  assert.equal(hasAvail, 0, 'cell reverted to unmarked');
  await page.close();
});

test('planner grid, day counts, who-is-free sheet batch plan, 40-cap block, add-by-TG-ID planner and Telegram downloadFile export', async () => {
  const page = await open({ bravoAtCap: true, hasDownloadFile: true });
  await page.locator('#tabPlanner').click();
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByText('December 2026').waitFor();

  await page.getByRole('rowheader', { name: 'Free' }).waitFor();
  await page.getByRole('rowheader', { name: 'On the plan' }).waitFor();
  assert.doesNotMatch(await page.locator('#screen').innerText(), /short/i);

  await page.locator('th.dh button[data-h="2026-12-15"]').click();
  await page.getByText('fewest SAF100 days first').waitFor();
  await page.getByText("at 40, can't get SAF100").waitFor();
  await page.locator('#pk-3').check();
  await page.getByRole('button', { name: 'Plan 1 selected' }).click();
  await page.getByText('1 planned for Tue 15 Dec').waitFor();

  await page.locator('td.c button[data-p="2"][data-d="2026-12-09"]').click();
  assert.equal(await page.locator('.sheet').getByRole('button', { name: 'SAF100 sent', exact: true }).isDisabled(), true);
  await page.locator('.sheet').getByRole('button', { name: 'Close', exact: true }).click();

  // Switch to NSmen view -> sole planner shows "Only planner", add planner by Telegram ID -> Step down appears
  await page.locator('[data-v="people"]').click();
  await page.getByText('Only planner').waitFor();
  await page.locator('#apTg').fill('6120458832');
  await page.locator('#apName').fill('ME3 BRAVO');
  await page.locator('#addPlBtn').click();
  await page.getByText('ME3 BRAVO added as Loadmaster planner').waitFor();
  await page.getByRole('button', { name: 'Step down' }).waitFor();

  // Export CSV uses Telegram.WebApp.downloadFile with signed /api/export-link URL
  await page.locator('#exportBtn').click();
  await page.getByText('Exported enforcer-nsmen-WY2026-loadmaster.csv').waitFor();
  const dlCalls = await page.evaluate(() => window.DOWNLOAD_CALLS);
  assert.equal(dlCalls.length, 1);
  assert.match(dlCalls[0].url, /\/api\/export\.csv\?token=/);
  assert.equal(dlCalls[0].file_name, 'enforcer-nsmen-WY2026-loadmaster.csv');

  assert.deepEqual(page.errors, []);
  await page.close();
});

test('fits at 360px phone viewport without page-level horizontal overflow (including Admin tab)', async () => {
  const page = await open({ width: 360, isAdmin: true, joined: true });
  await page.getByRole('heading', { name: 'My days' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360));
  await page.locator('#tabPlanner').click();
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360));
  await page.locator('#tabAdmin').click();
  await page.getByRole('heading', { name: 'Admin', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360));
  await page.close();
});
