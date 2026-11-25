// Browser-side fake API for Playwright page tests.
// Options via window.FAKE_OPTS: { joined, isAdmin, plannerDepts, plannerName, tgId, delay, failNext, bravoAtCap }
(function () {
  const o = window.FAKE_OPTS || {};
  const TODAY = window.APP_TODAY || '2026-11-24';
  const CUR_WY = Number(TODAY.slice(5, 7)) >= 4 ? Number(TODAY.slice(0, 4)) : Number(TODAY.slice(0, 4)) - 1;
  const MAX_DATE = `${CUR_WY + 2}-03-31`;
  const MAX_BATCH_DATES = 120;
  const DEPARTMENTS = ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2'];
  const CAP = 40;
  const ME_TG = String(o.tgId || '6982215470');

  const isAdminInit = Boolean(o.isAdmin);
  const initialPlannerDepts = isAdminInit
    ? DEPARTMENTS.slice()
    : Array.isArray(o.plannerDepts)
      ? o.plannerDepts.slice()
      : ['Loadmaster', 'Pilot'];

  const state = {
    nextId: 10,
    isAdmin: isAdminInit,
    admin: isAdminInit ? { tg_id: ME_TG, name: o.adminName || 'LTC TAY W.K.' } : null,
    plannerName: o.plannerName || (isAdminInit ? (o.adminName || 'LTC TAY W.K.') : 'ME2 ALPHA'),
    nsmen: [
      ...(o.joined === false
        ? []
        : [{ id: 1, name: 'ME2 ALPHA', dept: 'Loadmaster', tg_id: ME_TG, tg_username: 'alpha', active: 1, joined_at: '2025-05-01T00:00:00Z' }]),
      { id: 2, name: 'ME3 BRAVO', dept: 'Loadmaster', tg_id: '6120458832', tg_username: 'bravo', active: 1, joined_at: '2024-06-01T00:00:00Z' },
      { id: 3, name: 'ME1 CHARLIE', dept: 'Loadmaster', tg_id: '6120458833', tg_username: 'charlie', active: 1, joined_at: '2026-11-20T00:00:00Z' },
      { id: 4, name: 'CPT DELTA', dept: 'Pilot', tg_id: '6120458834', tg_username: 'delta', active: 1, joined_at: '2024-03-01T00:00:00Z' },
    ],
    plannerDepts: initialPlannerDepts,
    planners: isAdminInit
      ? [
          { tg_id: '5829104473', dept: 'Pilot', name: 'MAJ RAHMAN A.' },
          { tg_id: '6120458831', dept: 'Loadmaster', name: 'ME4 ONG S.H.' },
        ]
      : initialPlannerDepts.map((d) => ({
          tg_id: ME_TG,
          dept: d,
          name: o.plannerName || 'ME2 ALPHA',
        })),
    flightDays: [
      { id: 1, dept: 'Loadmaster', date: '2026-12-09', type: 'C-130', time: '0800-1500' },
      { id: 2, dept: 'Loadmaster', date: '2026-12-15', type: 'C-130 night', time: '1800-0100' },
      { id: 3, dept: 'Pilot', date: '2026-12-10', type: 'KC-130', time: '1300-2000' },
    ],
    cells: [
      { id: 1, nsman_id: 1, date: '2026-12-09', state: 'sent', dept: 'Loadmaster', planned_by: 'ME2 ALPHA', sent_at: '2026-11-23T10:00:00Z', received_at: '', ended_at: '', ended_by: '', reason: '' },
      { id: 2, nsman_id: 1, date: '2026-12-15', state: 'available', dept: 'Loadmaster', planned_by: '', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' },
      { id: 3, nsman_id: 2, date: '2026-12-15', state: 'available', dept: 'Loadmaster', planned_by: '', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' },
      { id: 4, nsman_id: 3, date: '2026-12-15', state: 'available', dept: 'Loadmaster', planned_by: '', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' },
      { id: 5, nsman_id: 2, date: '2026-12-09', state: 'planned', dept: 'Loadmaster', planned_by: 'ME2 ALPHA', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' },
    ],
    failNext: o.failNext || null,
    skipDates: {},
  };

  if (o.bravoAtCap) {
    for (let i = 0; i < 40; i++) {
      const dt = new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10);
      state.cells.push({
        id: 100 + i,
        nsman_id: 2,
        date: dt,
        state: 'received',
        dept: 'Loadmaster',
        planned_by: 'ME2 ALPHA',
        sent_at: '2026-04-01T00:00:00Z',
        received_at: '2026-04-01T01:00:00Z',
        ended_at: '',
        ended_by: '',
        reason: '',
      });
    }
  }

  if (Array.isArray(o.extraFlights)) {
    for (const f of o.extraFlights) {
      state.flightDays.push(Object.assign({ id: state.nextId++, type: '', time: '' }, f));
    }
  }
  if (Array.isArray(o.extraCells)) {
    for (const c of o.extraCells) {
      state.cells.push(
        Object.assign(
          {
            id: state.nextId++,
            nsman_id: 1,
            dept: 'Loadmaster',
            planned_by: '',
            sent_at: '',
            received_at: '',
            ended_at: '',
            ended_by: '',
            reason: '',
          },
          c,
        ),
      );
    }
  }

  state.broadcasts = Array.isArray(o.broadcasts) ? o.broadcasts.slice() : [];
  window.FAKE = { calls: [], state };

  function me() {
    return state.nsmen.find((n) => n.tg_id === ME_TG && n.active === 1) || null;
  }

  function effectiveDepts() {
    return state.isAdmin ? DEPARTMENTS.slice() : state.plannerDepts.slice();
  }

  function initPayload() {
    const m = me();
    const eff = effectiveDepts();
    const isPl = eff.length > 0;
    const active = state.nsmen.filter((n) => n.active === 1);
    return {
      ok: true,
      today: TODAY,
      workYear: CUR_WY,
      maxDate: MAX_DATE,
      cap: CAP,
      departments: DEPARTMENTS,
      tgUser: { id: ME_TG, username: 'alpha' },
      me: m,
      isAdmin: state.isAdmin,
      admin: state.isAdmin ? state.admin : null,
      plannerName: state.plannerName,
      plannerDepts: eff,
      nsmen: isPl ? active.filter((n) => eff.includes(n.dept)) : [],
      flightDays: state.flightDays.filter((f) => eff.includes(f.dept) || (m && f.dept === m.dept)),
      cells: isPl ? state.cells.slice() : state.cells.filter((c) => m && c.nsman_id === m.id),
      broadcasts: isPl ? state.broadcasts.filter((b) => eff.includes(b.dept)) : [],
      planners: state.isAdmin
        ? state.planners.slice()
        : isPl
          ? state.planners.filter((p) => eff.includes(p.dept))
          : [],
    };
  }

  function upsertCell(nsmanId, date, patch) {
    const idx = state.cells.findIndex((c) => c.nsman_id === nsmanId && c.date === date);
    if (patch.state === 'none') {
      if (idx >= 0) state.cells.splice(idx, 1);
      return null;
    }
    if (idx >= 0) {
      state.cells[idx] = Object.assign({}, state.cells[idx], patch);
      return state.cells[idx];
    }
    const row = Object.assign(
      { id: state.nextId++, nsman_id: nsmanId, date, state: 'available', dept: 'Loadmaster', planned_by: '', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' },
      patch,
    );
    state.cells.push(row);
    return row;
  }

  function run(method, path, body) {
    if (state.failNext) {
      const msg = state.failNext;
      state.failNext = null;
      return { ok: false, error: msg };
    }
    if (method === 'GET' && path === '/api/init') return initPayload();

    if (method === 'POST' && path === '/api/join') {
      const ns = {
        id: state.nextId++,
        name: body.name.trim().toUpperCase(),
        dept: body.dept,
        tg_id: ME_TG,
        tg_username: 'alpha',
        active: 1,
        joined_at: TODAY + 'T00:00:00Z',
      };
      state.nsmen.push(ns);
      return initPayload();
    }

    if (method === 'POST' && path === '/api/cells/available') {
      const m = me();
      const cell = upsertCell(m.id, body.date, { state: 'available', dept: m.dept, reason: '' });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/unavailable') {
      const m = me();
      upsertCell(m.id, body.date, { state: 'none' });
      return { ok: true, date: body.date, wasPlanned: false };
    }
    if (method === 'POST' && (path === '/api/cells/available-batch' || path === '/api/cells/unavailable-batch')) {
      const m = me();
      if (!m) return { ok: false, code: 'NOT_JOINED', error: 'Join your department first.' };
      const dates = body.dates;
      if (!Array.isArray(dates) || dates.length === 0) {
        return { ok: false, code: 'BAD_INPUT', error: 'Select at least one date.' };
      }
      if (dates.length > MAX_BATCH_DATES) {
        return { ok: false, code: 'TOO_MANY_DATES', error: `You can update at most ${MAX_BATCH_DATES} dates at a time.` };
      }
      const isMark = path === '/api/cells/available-batch';
      const seen = new Set();
      const done = [];
      const skipped = [];
      for (const d of dates) {
        if (seen.has(d)) continue;
        seen.add(d);
        if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          skipped.push({ date: d, reason: 'invalid date' });
          continue;
        }
        const [yy, mm, dd] = d.split('-').map(Number);
        const dt = new Date(Date.UTC(yy, mm - 1, dd));
        if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) {
          skipped.push({ date: d, reason: 'invalid date' });
          continue;
        }
        if (d < TODAY) {
          skipped.push({ date: d, reason: 'past date' });
          continue;
        }
        if (state.skipDates && state.skipDates[d]) {
          skipped.push({ date: d, reason: state.skipDates[d] });
          delete state.skipDates[d];
          continue;
        }
        const existing = state.cells.find((c) => c.nsman_id === m.id && c.date === d);
        const st = existing ? existing.state : 'none';
        if (isMark) {
          if (d > MAX_DATE) {
            skipped.push({ date: d, reason: 'outside marking window' });
            continue;
          }
          if (st === 'available') {
            skipped.push({ date: d, reason: 'already available' });
            continue;
          }
          if (st === 'planned') {
            skipped.push({ date: d, reason: 'already planned' });
            continue;
          }
          if (st === 'sent' || st === 'received') {
            skipped.push({ date: d, reason: 'SAF100 already sent' });
            continue;
          }
          upsertCell(m.id, d, {
            state: 'available',
            dept: m.dept,
            planned_by: '',
            sent_at: '',
            received_at: '',
            ended_at: '',
            ended_by: '',
            reason: '',
          });
          done.push(d);
        } else {
          if (st === 'sent' || st === 'received') {
            skipped.push({ date: d, reason: 'SAF100 already sent' });
            continue;
          }
          if (st !== 'available' && st !== 'planned') {
            skipped.push({ date: d, reason: 'not marked' });
            continue;
          }
          upsertCell(m.id, d, { state: 'none' });
          done.push(d);
        }
      }
      return { ok: true, done, skipped };
    }
    if (method === 'POST' && path === '/api/cells/received') {
      const m = me();
      const cell = upsertCell(m.id, body.date, { state: 'received', received_at: TODAY + 'T01:00:00Z' });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/cancel') {
      const m = me();
      const cell = upsertCell(m.id, body.date, { state: 'cancelled', reason: body.reason || '', ended_by: m.name });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/plan') {
      const ns = state.nsmen.find((n) => n.id === body.nsmanId);
      const cell = upsertCell(body.nsmanId, body.date, { state: 'planned', dept: ns.dept });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/plan-batch') {
      const cells = body.nsmanIds.map((id) => {
        const ns = state.nsmen.find((n) => n.id === id);
        return upsertCell(id, body.date, { state: 'planned', dept: ns.dept });
      });
      return { ok: true, cells };
    }
    if (method === 'POST' && path === '/api/cells/unplan') {
      const cell = upsertCell(body.nsmanId, body.date, { state: 'available' });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/send') {
      const cell = upsertCell(body.nsmanId, body.date, { state: 'sent', sent_at: TODAY + 'T00:00:00Z' });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/cells/withdraw') {
      const cell = upsertCell(body.nsmanId, body.date, { state: 'withdrawn', reason: body.reason || '' });
      return { ok: true, cell };
    }
    if (method === 'POST' && path === '/api/flights') {
      const idx = state.flightDays.findIndex((f) => f.dept === body.dept && f.date === body.date);
      const f = { id: state.nextId++, dept: body.dept, date: body.date, type: body.type || '', time: body.time || '' };
      if (idx >= 0) state.flightDays[idx] = f;
      else state.flightDays.push(f);
      return { ok: true, flightDay: f };
    }
    if (method === 'POST' && path === '/api/flights/broadcast') {
      const crew = state.nsmen.filter((n) => n.active && n.dept === body.dept);
      const upcoming = state.flightDays.filter(
        (f) => f.dept === body.dept && f.date.startsWith(body.month + '-') && f.date >= TODAY,
      );
      if (!upcoming.length) return { ok: false, error: `No upcoming ${body.dept} flights to broadcast.` };
      if (!crew.length) return { ok: false, error: `No ${body.dept} NSmen have joined yet, so there's no one to message.` };
      const broadcast = { dept: body.dept, month: body.month, at: `${TODAY}T02:00:00.000Z`, actor: state.plannerName || 'ME2 ALPHA' };
      state.broadcasts = state.broadcasts.filter((b) => !(b.dept === body.dept && b.month === body.month));
      state.broadcasts.unshift(broadcast);
      return { ok: true, recipients: crew.length, flights: upcoming.length, broadcast };
    }
    if (method === 'DELETE' && path === '/api/flights') {
      state.flightDays = state.flightDays.filter((f) => !(f.dept === body.dept && f.date === body.date));
      return { ok: true, dept: body.dept, date: body.date };
    }
    const nm = path.match(/^\/api\/nsmen\/(\d+)$/);
    if (nm && method === 'PATCH') {
      const id = Number(nm[1]);
      const ns = state.nsmen.find((n) => n.id === id);
      ns.name = body.name;
      ns.dept = body.dept;
      return { ok: true, nsman: ns };
    }
    if (nm && method === 'DELETE') {
      const id = Number(nm[1]);
      const ns = state.nsmen.find((n) => n.id === id);
      ns.active = 0;
      return { ok: true, id };
    }
    if (method === 'POST' && path === '/api/planners') {
      const tg = String(body.tgId || '').trim();
      const name = String(body.name || '').trim().toUpperCase();
      if (!/^\d{5,15}$/.test(tg)) return { ok: false, error: 'A Telegram ID is a number of 5 to 15 digits.' };
      if (!name) return { ok: false, error: 'Enter a name.' };
      state.planners.push({ tg_id: tg, dept: body.dept, name });
      const eff = effectiveDepts();
      return { ok: true, planners: state.isAdmin ? state.planners.slice() : state.planners.filter((p) => eff.includes(p.dept)) };
    }
    if (method === 'DELETE' && (path === '/api/planners' || path === '/api/planners/self')) {
      const tg = path === '/api/planners/self' || body.tgId == null ? ME_TG : String(body.tgId);
      const inDept = state.planners.filter((p) => p.dept === body.dept);
      if (!state.isAdmin) {
        if (tg !== ME_TG) return { ok: false, error: 'Planners can only remove themselves.' };
        if (inDept.length < 2) return { ok: false, error: 'You are the only planner.' };
      }
      state.planners = state.planners.filter((p) => !(p.dept === body.dept && p.tg_id === tg));
      if (!state.isAdmin && tg === ME_TG) {
        state.plannerDepts = state.plannerDepts.filter((d) => d !== body.dept);
      }
      const eff = effectiveDepts();
      return { ok: true, plannerDepts: eff, planners: state.isAdmin ? state.planners.slice() : state.planners.filter((p) => eff.includes(p.dept)) };
    }
    if (method === 'PATCH' && path === '/api/admin/me') {
      if (!state.isAdmin) return { ok: false, error: 'Only the Highest Admin can update this name.' };
      const name = String(body.name || '').trim().toUpperCase().replace(/\s+/g, ' ');
      if (!name || name.length > 60) return { ok: false, error: 'Enter a name (1 to 60 characters).' };
      state.admin = Object.assign({}, state.admin || { tg_id: ME_TG }, { name });
      state.plannerName = name;
      return initPayload();
    }
    if (method === 'POST' && path === '/api/admin/pass') {
      if (!state.isAdmin) return { ok: false, error: 'Only the Highest Admin can pass on this role.' };
      state.isAdmin = false;
      state.admin = null;
      state.plannerDepts = state.planners.filter((p) => p.tg_id === ME_TG).map((p) => p.dept);
      return initPayload();
    }
    if (method === 'POST' && path === '/api/export-link') {
      const dept = body.dept || 'all';
      const wy = body.workYear || 2026;
      const suffix = dept !== 'all' ? `-${dept.toLowerCase()}` : '';
      return {
        ok: true,
        url: '/api/export.csv?token=fake-signed-token',
        filename: `enforcer-nsmen-WY${wy}${suffix}.csv`,
        expiresAt: '2026-11-24T12:05:00.000Z',
      };
    }
    if (method === 'GET' && path.startsWith('/api/export')) {
      return {
        ok: true,
        filename: 'enforcer-nsmen-WY2026-loadmaster.csv',
        csv: 'name,department,date,state,flight_type,flight_time,sent_at,received_at,ended_at,ended_by,reason\r\nME2 ALPHA,Loadmaster,2026-12-09,sent,C-130,0800-1500,,,,,\r\n\r\nat,actor,action,detail\r\n',
      };
    }
    return { ok: false, error: 'Unknown route' };
  }

  window.APP_FAKE_API = function (method, path, body) {
    window.FAKE.calls.push({ method, path, body });
    return new Promise((resolve) => {
      setTimeout(() => resolve(JSON.parse(JSON.stringify(run(method, path, body || {})))), o.delay || 0);
    });
  };
})();
