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
  adminName = '',
  plannerDepts = ['Loadmaster', 'Pilot'],
  plannerName = '',
  tgId = '6982215470',
  delay = 0,
  bravoAtCap = false,
  hasDownloadFile = false,
  width = 390,
  colorScheme = 'light',
  extraFlights = [],
  extraCells = [],
} = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.emulateMedia({ colorScheme });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.addInitScript(
    ({
      initData,
      joined,
      isAdmin,
      adminName,
      plannerDepts,
      plannerName,
      tgId,
      delay,
      bravoAtCap,
      hasDownloadFile,
      colorScheme,
      extraFlights,
      extraCells,
    }) => {
      window.APP_TODAY = '2026-11-24';
      window.FAKE_OPTS = {
        joined,
        isAdmin,
        adminName,
        plannerDepts,
        plannerName,
        tgId,
        delay,
        bravoAtCap,
        extraFlights,
        extraCells,
      };
      window.DOWNLOAD_CALLS = [];
      const webApp = {
        initData,
        colorScheme,
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
    {
      initData,
      joined,
      isAdmin,
      adminName,
      plannerDepts,
      plannerName,
      tgId,
      delay,
      bravoAtCap,
      hasDownloadFile,
      colorScheme,
      extraFlights,
      extraCells,
    },
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

test('Highest Admin sees "Your rank and name" on Admin tab and saving updates the Planner chip', async () => {
  const page = await open({
    joined: false,
    isAdmin: true,
    adminName: 'BRANDON',
    tgId: '5520881904',
  });
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  assert.equal(await page.locator('.apptitle .chip').innerText(), 'BRANDON');

  await page.locator('#tabAdmin').click();
  await page.getByLabel('Your rank and name').waitFor();
  assert.equal(await page.locator('#adName').inputValue(), 'BRANDON');

  await page.locator('#adName').fill('maj brandon tan');
  await page.locator('#saveAdName').click();
  await page.getByText('Saved as MAJ BRANDON TAN').waitFor();
  assert.equal(await page.locator('#adName').inputValue(), 'MAJ BRANDON TAN');

  await page.locator('#tabPlanner').click();
  await page.getByRole('heading', { name: 'Planner' }).waitFor();
  assert.equal(await page.locator('.apptitle .chip').innerText(), 'MAJ BRANDON TAN');

  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Select days mode: tick 3 dates, Mark available, flight-days shortcut, cross-month, planned confirm, Done restores single tap', async () => {
  const page = await open({
    plannerDepts: [],
    extraFlights: [
      { dept: 'Loadmaster', date: '2026-11-20', type: 'C-130', time: '0800-1500' }, // past flight
      { dept: 'Loadmaster', date: '2026-12-11', type: 'C-130', time: '0800-1500' }, // planned flight
      { dept: 'Loadmaster', date: '2026-12-18', type: 'C-130', time: '0900-1600' }, // markable future flight
      { dept: 'Loadmaster', date: '2026-12-22', type: 'C-130 night', time: '1800-0100' }, // markable future flight
    ],
    extraCells: [
      { nsman_id: 1, date: '2026-12-08', state: 'received' },
      { nsman_id: 1, date: '2026-12-11', state: 'planned', planned_by: 'ME4 ONG S.H.' },
      { nsman_id: 1, date: '2026-12-12', state: 'planned', planned_by: 'ME4 ONG S.H.' },
    ],
  });
  await page.getByRole('heading', { name: 'My days' }).waitFor();

  // Go to December 2026 and enter Select days mode
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByText('December 2026').waitFor();
  await page.getByRole('button', { name: 'Select days' }).click();
  await page.locator('#selbar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#selCount').innerText(), '0 days selected');
  assert.equal(await page.locator('#selMarkBtn').isDisabled(), true);
  assert.equal(await page.locator('#selRemoveBtn').isDisabled(), true);

  // Sent and received dates are not selectable
  assert.equal(await page.locator('#nscal [data-d="2026-12-09"]').isDisabled(), true);
  assert.equal(await page.locator('#nscal [data-d="2026-12-08"]').isDisabled(), true);

  // Tick 3 dates; no bottom sheet opens; Mark available updates calendar and toast
  await page.locator('#nscal [data-d="2026-12-16"]').click();
  await page.locator('#nscal [data-d="2026-12-17"]').click();
  await page.locator('#nscal [data-d="2026-12-19"]').click();
  assert.equal(await page.locator('.sheet').count(), 0);
  assert.equal(await page.locator('#selCount').innerText(), '3 days selected');
  assert.equal(await page.locator('#selMarkBtn').isDisabled(), false);
  assert.equal(await page.locator('#selRemoveBtn').isDisabled(), true);

  await page.locator('#selMarkBtn').click();
  await page.getByText('Marked 3 days available').waitFor();
  await page.locator('#nscal [data-d="2026-12-16"].s-available').waitFor();
  await page.locator('#nscal [data-d="2026-12-17"].s-available').waitFor();
  await page.locator('#nscal [data-d="2026-12-19"].s-available').waitFor();
  assert.equal(await page.locator('#selCount').innerText(), '0 days selected');

  // Flight-days shortcut ticks ONLY future markable Loadmaster flight days (Dec 18 & 22; skips Dec 9 sent, Dec 11 planned, Dec 15 available, Dec 10 Pilot)
  await page.getByRole('button', { name: 'All Loadmaster flight days this month' }).click();
  const tickedDec = await page.locator('#nscal .day.picked').evaluateAll((els) => els.map((e) => e.dataset.d));
  assert.deepEqual(tickedDec, ['2026-12-18', '2026-12-22']);
  assert.equal(await page.locator('#selCount').innerText(), '2 days selected');

  // Changing month keeps ticks on December; past dates in November are disabled; bar counts all ticks
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByText('November 2026').waitFor();
  assert.equal(await page.locator('#nscal [data-d="2026-11-20"]').isDisabled(), true);
  assert.equal(await page.locator('#selFlightsBtn').isDisabled(), true);
  await page.locator('#nscal [data-d="2026-11-28"]').click();
  assert.equal(await page.locator('#selCount').innerText(), '3 days selected');

  // Mark all 3 across months
  await page.locator('#selMarkBtn').click();
  await page.getByText('Marked 3 days available').waitFor();
  await page.locator('#nscal [data-d="2026-11-28"].s-available').waitFor();

  // Back to December: verify Dec 18 & 22 are available; test planned removal double-confirm in bar
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.locator('#nscal [data-d="2026-12-18"].s-available').waitFor();
  await page.locator('#nscal [data-d="2026-12-22"].s-available').waitFor();

  await page.locator('#nscal [data-d="2026-12-11"]').click();
  await page.locator('#nscal [data-d="2026-12-12"]').click();
  assert.equal(await page.locator('#selMarkBtn').isDisabled(), true, 'planned dates cannot be marked available');
  assert.equal(await page.locator('#selRemoveBtn').isDisabled(), false);

  await page.locator('#selRemoveBtn').click();
  await page.getByText('2 of these are planned; your planner will be told. Tap Remove again to confirm.').waitFor();
  assert.equal(await page.locator('#nscal [data-d="2026-12-11"].s-planned').count(), 1);

  await page.locator('#selRemoveBtn').click();
  await page.getByText('Removed 2 days').waitFor();
  await page.locator('#nscal [data-d="2026-12-11"].s-none').waitFor();
  await page.locator('#nscal [data-d="2026-12-12"].s-none').waitFor();

  // Skipped reconciliation toast & revert
  await page.locator('#nscal [data-d="2026-12-23"]').click();
  await page.locator('#nscal [data-d="2026-12-24"]').click();
  await page.evaluate(() => {
    window.FAKE.state.cells.push({
      id: 999,
      nsman_id: 1,
      date: '2026-12-24',
      state: 'sent',
      dept: 'Loadmaster',
      planned_by: 'ME4 ONG S.H.',
      sent_at: '2026-11-24T00:00:00Z',
      received_at: '',
      ended_at: '',
      ended_by: '',
      reason: '',
    });
  });
  await page.locator('#selMarkBtn').click();
  await page.getByText('Marked 1 day; 1 skipped (SAF100 already sent)').waitFor();
  await page.locator('#nscal [data-d="2026-12-23"].s-available').waitFor();
  assert.equal(await page.locator('#nscal [data-d="2026-12-24"].s-available').count(), 0);

  // Done leaves select mode and single tap opens the bottom sheet again
  await page.locator('#selDoneBtn').click();
  await page.locator('#selbar').waitFor({ state: 'hidden' });
  await page.locator('#nscal [data-d="2026-12-20"]').click();
  await page.locator('.sheet').waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Sun 20 Dec' }).waitFor();

  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Select days mode fits 360px viewport and saves light/dark screenshots', async () => {
  const screensDir = path.join(ROOT, 'tests', 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const shotOpts = {
    plannerDepts: [],
    extraFlights: [
      { dept: 'Loadmaster', date: '2026-12-18', type: 'C-130', time: '0900-1600' },
      { dept: 'Loadmaster', date: '2026-12-22', type: 'C-130 night', time: '1800-0100' },
    ],
    extraCells: [
      { nsman_id: 1, date: '2026-12-04', state: 'received' },
      { nsman_id: 1, date: '2026-12-11', state: 'planned', planned_by: 'ME4 ONG S.H.' },
      { nsman_id: 1, date: '2026-12-12', state: 'planned', planned_by: 'ME4 ONG S.H.' },
    ],
  };

  for (const theme of ['light', 'dark']) {
    const page = await open({ ...shotOpts, colorScheme: theme, width: 390 });
    await page.getByRole('heading', { name: 'My days' }).waitFor();
    await page.getByRole('button', { name: 'Next month' }).click();
    await page.getByText('December 2026').waitFor();
    await page.getByRole('button', { name: 'Select days' }).click();
    await page.locator('#nscal [data-d="2026-12-18"]').click();
    await page.locator('#nscal [data-d="2026-12-22"]').click();
    await page.locator('#nscal [data-d="2026-12-11"]').click();
    await page.locator('#selbar').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(screensDir, `select-${theme}.png`) });
    assert.deepEqual(page.errors, []);
    await page.close();
  }

  // 360px phone viewport overflow check in select mode
  const narrow = await open({ ...shotOpts, width: 360 });
  await narrow.getByRole('heading', { name: 'My days' }).waitFor();
  await narrow.getByRole('button', { name: 'Next month' }).click();
  await narrow.getByRole('button', { name: 'Select days' }).click();
  await narrow.locator('#selbar').waitFor({ state: 'visible' });
  assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= 360));
  await narrow.close();
});
