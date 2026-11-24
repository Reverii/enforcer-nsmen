// Enforcer NSMEN Mini App page.
// Static client with no build step; talks only to the Cloudflare Worker configured in config.js.
(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ON_PLAN = ['planned', 'sent', 'received'];
  const STATE_WORD = {
    none: 'Not marked',
    available: 'Available',
    planned: 'Planned',
    sent: 'SAF100 sent',
    received: 'SAF100 received',
    cancelled: 'Cancelled by NSman',
    withdrawn: 'Withdrawn by planner',
  };

  const $ = (id) => document.getElementById(id);

  // ---- client state ----
  const S = {
    screen: 'loading', // loading | outside | fatal | main
    fatal: '',
    today: '',
    workYear: 2026,
    maxDate: '',
    cap: 40,
    departments: ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2'],
    tgUser: null,
    me: null,
    isAdmin: false,
    admin: null,
    plannerName: '',
    plannerDepts: [],
    nsmen: [],
    flightDays: [],
    cells: [],
    planners: [],
    tab: 'mine',       // mine | planner | admin
    nsMonth: null,     // [year, monthIndex]
    plMonth: null,     // [year, monthIndex]
    plDept: '',
    plView: 'grid',    // grid | flights | people
    exportWy: null,
    inFlight: 0,
  };

  let toastTimer = null;
  let refreshTimer = null;
  let refreshing = false;

  // ---- helpers ----
  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const dowIdx = (s) => (parse(s).getUTCDay() + 6) % 7; // Mon=0
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const nice = (s) => {
    const d = parse(s);
    return `${DOW[dowIdx(s)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]));
  const todayStr = () => {
    if (window.APP_TODAY) return window.APP_TODAY;
    if (S.today) return S.today;
    const sgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return sgt.toISOString().slice(0, 10);
  };
  const isPast = (d) => d < todayStr();
  const isToday = (d) => d === todayStr();
  const beforeDay = (d) => d > todayStr();
  const workYearOf = (s) => {
    const d = parse(s);
    return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  };
  const wyLabel = (y) => `Apr ${y} – Mar ${y + 1}`;
  const countsTowardCap = (st) => st === 'sent' || st === 'received';
  const pillCls = (s) => (s === 'cancelled' || s === 'withdrawn' ? 'p-ended' : 'p-' + s);
  const sCls = (s) => (s === 'cancelled' || s === 'withdrawn' ? 's-ended' : 's-' + s);
  const tagOf = (s) => ({ planned: 'P', sent: 'S', received: 'R' }[s] || '');
  const flInfo = (f) => (f ? [f.type, f.time].filter(Boolean).join(' · ') || 'No details added' : '');
  const chev = (dir) =>
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${dir < 0 ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'}"/></svg>`;

  function myTgId() {
    if (S.tgUser && S.tgUser.id) return String(S.tgUser.id);
    if (S.me && S.me.tg_id) return String(S.me.tg_id);
    if (S.admin && S.admin.tg_id) return String(S.admin.tg_id);
    return '';
  }

  function cellOf(nsmanId, date) {
    return S.cells.find((c) => Number(c.nsman_id) === Number(nsmanId) && c.date === date) || { state: 'none' };
  }

  function flightOf(dept, date) {
    return S.flightDays.find((f) => f.dept === dept && f.date === date) || null;
  }

  function usedInWy(nsmanId, wy) {
    const y = wy != null ? wy : workYearOf(todayStr());
    const start = `${y}-04-01`;
    const end = `${y + 1}-03-31`;
    let n = 0;
    for (let i = 0; i < S.cells.length; i++) {
      const c = S.cells[i];
      if (Number(c.nsman_id) === Number(nsmanId) && countsTowardCap(c.state) && c.date >= start && c.date <= end) {
        n++;
      }
    }
    return n;
  }

  function tally(crew, date) {
    const t = { free: 0, on: 0, none: 0 };
    for (let i = 0; i < crew.length; i++) {
      const st = cellOf(crew[i].id, date).state;
      if (st === 'available') t.free++;
      else if (ON_PLAN.includes(st)) t.on++;
      else t.none++;
    }
    return t;
  }

  function shiftMonth(ym, step) {
    const t = ym[0] * 12 + ym[1] + step;
    return [Math.floor(t / 12), t % 12];
  }

  function monthOK(ym, step) {
    const [ny, nm] = shiftMonth(ym, step);
    const curWy = workYearOf(todayStr());
    const minT = curWy * 12 + 3; // April of current work year
    const maxParts = (S.maxDate || `${curWy + 2}-03-31`).split('-').map(Number);
    const maxT = maxParts[0] * 12 + (maxParts[1] - 1);
    const nextT = ny * 12 + nm;
    return nextT >= minT && nextT <= maxT;
  }

  function daysBetween(a, b) {
    return Math.floor((parse(b).getTime() - parse(a).getTime()) / 86400000);
  }

  function isNewJoiner(p) {
    if (!p || !p.joined_at) return false;
    const jd = String(p.joined_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jd)) return false;
    const diff = daysBetween(jd, todayStr());
    return diff >= 0 && diff <= 30;
  }

  function toast(msg, isError) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.setAttribute('role', isError ? 'alert' : 'status');
    el.textContent = msg;
    $('app').appendChild(el);
    toastTimer = setTimeout(() => el.remove(), isError ? 3400 : 2400);
  }

  // ---- Telegram theme & helpers ----

  function applyTheme() {
    if (!tg) return;
    const root = document.documentElement;
    if (tg.colorScheme === 'dark' || tg.colorScheme === 'light') {
      root.setAttribute('data-theme', tg.colorScheme);
    }
    const t = tg.themeParams || {};
    if (t.bg_color) root.style.setProperty('--surface', t.bg_color);
    if (t.secondary_bg_color) root.style.setProperty('--raised', t.secondary_bg_color);
    if (t.text_color) root.style.setProperty('--text', t.text_color);
    if (t.hint_color) root.style.setProperty('--muted', t.hint_color);
    if (t.button_color) root.style.setProperty('--hue', t.button_color);
    if (t.button_text_color) root.style.setProperty('--on-hue', t.button_text_color);
  }

  function askWriteAccess() {
    return new Promise((resolve) => {
      if (tg && tg.requestWriteAccess) {
        try { tg.requestWriteAccess(() => resolve()); return; } catch { /* ignore */ }
      }
      resolve();
    });
  }

  function wireCopy(btnId, valId, text) {
    const b = $(btnId);
    const el = $(valId);
    if (!b || !el || !text) return;
    b.onclick = () => {
      const done = () => { b.textContent = 'Copied'; };
      const fallback = () => {
        try {
          const sel = window.getSelection();
          if (sel) sel.selectAllChildren(el);
        } catch { /* ignore */ }
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback);
        } else {
          fallback();
        }
      } catch {
        fallback();
      }
    };
  }

  function tgIdBoxHtml(help) {
    const id = myTgId();
    if (!id) return '';
    return `<div class="cap" style="margin-top:18px">
      <div class="row" style="align-items:center;gap:10px">
        <span>Your Telegram ID<span class="big num" style="display:block;font-size:18px;line-height:24px" id="myTg">${esc(id)}</span></span>
        <button class="btn sec small" id="copyTg" type="button">Copy</button>
      </div>
      <p class="note" style="margin:6px 0 0">${help}</p>
    </div>`;
  }

  function aboutMeHtml() {
    const id = myTgId();
    if (!id) return '';
    return `<div class="aboutme" id="aboutMe">
      <span class="note">About me · Your Telegram ID: <b class="num" id="aboutTg">${esc(id)}</b></span>
      <button class="btn sec small" id="copyAboutTg" type="button">Copy</button>
    </div>`;
  }

  // ---- API client ----

  function apiBase() {
    return ((window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '').replace(/\/$/, '');
  }

  async function api(method, path, body) {
    if (window.APP_FAKE_API) {
      const res = await window.APP_FAKE_API(method, path, body);
      if (!res || !res.ok) {
        throw new Error((res && res.error) || 'Something went wrong. Try again.');
      }
      return res;
    }
    let res;
    try {
      res = await fetch(apiBase() + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': (tg && tg.initData) || '',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Can't reach Enforcer NSMEN. Check your connection.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || 'Something went wrong. Try again.');
    }
    return data;
  }

  async function apiExportCsv(workYear, dept) {
    const qs = `?workYear=${encodeURIComponent(workYear)}&dept=${encodeURIComponent(dept)}`;
    if (window.APP_FAKE_API) {
      const res = await window.APP_FAKE_API('GET', '/api/export' + qs);
      if (!res || !res.ok) throw new Error((res && res.error) || 'Export failed.');
      return { csv: res.csv, filename: res.filename || `enforcer-nsmen-WY${workYear}.csv` };
    }
    const res = await fetch(apiBase() + '/api/export' + qs, {
      method: 'GET',
      headers: { 'X-Telegram-Init-Data': (tg && tg.initData) || '' },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && data.error) || 'Export failed.');
    }
    const csv = await res.text();
    const filename = `enforcer-nsmen-WY${workYear}-${dept.toLowerCase()}.csv`;
    return { csv, filename };
  }

  // ---- state updates & optimistic mutations ----

  function upsertLocalCell(nextCell) {
    const idx = S.cells.findIndex(
      (c) => Number(c.nsman_id) === Number(nextCell.nsman_id) && c.date === nextCell.date,
    );
    if (nextCell.state === 'none') {
      if (idx >= 0) S.cells.splice(idx, 1);
    } else if (idx >= 0) {
      S.cells[idx] = Object.assign({}, S.cells[idx], nextCell);
    } else {
      S.cells.push(nextCell);
    }
  }

  function snapshot() {
    return {
      cells: JSON.parse(JSON.stringify(S.cells)),
      flightDays: JSON.parse(JSON.stringify(S.flightDays)),
      nsmen: JSON.parse(JSON.stringify(S.nsmen)),
      planners: JSON.parse(JSON.stringify(S.planners)),
      plannerDepts: S.plannerDepts.slice(),
      plDept: S.plDept,
      tab: S.tab,
    };
  }

  function restore(snap) {
    S.cells = snap.cells;
    S.flightDays = snap.flightDays;
    S.nsmen = snap.nsmen;
    S.planners = snap.planners;
    S.plannerDepts = snap.plannerDepts;
    S.plDept = snap.plDept;
    S.tab = snap.tab;
  }

  async function optimistic(applyLocal, requestFn, onSuccess, successToast) {
    const snap = snapshot();
    S.inFlight++;
    try {
      applyLocal();
      render();
      const res = await requestFn();
      if (onSuccess) onSuccess(res);
      if (successToast) toast(successToast);
      render();
      return true;
    } catch (err) {
      restore(snap);
      render();
      toast(err.message || 'Action refused.', true);
      return false;
    } finally {
      S.inFlight = Math.max(0, S.inFlight - 1);
    }
  }

  function applyInit(d, isRefresh) {
    S.today = d.today || todayStr();
    S.workYear = d.workYear != null ? d.workYear : workYearOf(S.today);
    S.maxDate = d.maxDate || `${S.workYear + 2}-03-31`;
    S.cap = d.cap || 40;
    S.departments = d.departments || S.departments;
    S.tgUser = d.tgUser || S.tgUser;
    S.me = d.me || null;
    S.isAdmin = Boolean(d.isAdmin);
    S.admin = d.admin || null;
    S.plannerName = d.plannerName || '';
    S.plannerDepts = d.plannerDepts || [];
    S.nsmen = d.nsmen || [];
    S.flightDays = d.flightDays || [];
    S.cells = d.cells || [];
    S.planners = d.planners || [];

    const [ty, tm] = S.today.split('-').map(Number);
    if (!S.nsMonth) S.nsMonth = [ty, tm - 1];
    if (!S.plMonth) S.plMonth = [ty, tm - 1];
    if (!S.exportWy) S.exportWy = S.workYear;

    if (!S.plannerDepts.includes(S.plDept)) {
      S.plDept = S.plannerDepts[0] || '';
    }

    const isPlanner = S.isAdmin || S.plannerDepts.length > 0;
    if (!isRefresh) {
      if (!S.me && isPlanner) S.tab = 'planner';
      else if (S.me) S.tab = 'mine';
      else S.tab = 'mine';
    } else {
      if (S.tab === 'admin' && !S.isAdmin) S.tab = isPlanner ? 'planner' : 'mine';
      if (S.tab === 'planner' && !isPlanner) S.tab = 'mine';
      if (S.tab === 'mine' && !S.me && isPlanner) S.tab = 'planner';
    }

    S.screen = 'main';
    render();
  }

  // ---- background refresh ----

  function isOverlayOrTyping() {
    if ($('overlay') && $('overlay').innerHTML) return true;
    const a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }

  function refresh() {
    if (S.screen !== 'main' || S.inFlight > 0 || refreshing || document.hidden || isOverlayOrTyping()) return;
    refreshing = true;
    api('GET', '/api/init')
      .then((d) => {
        if (S.inFlight === 0 && !isOverlayOrTyping()) applyInit(d, true);
      })
      .catch(() => { /* retry next cycle */ })
      .finally(() => { refreshing = false; });
  }

  function startRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(refresh, window.APP_REFRESH_MS || 60000);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if (tg && tg.onEvent) {
    try { tg.onEvent('activated', refresh); } catch { /* older Telegram */ }
    try { tg.onEvent('themeChanged', applyTheme); } catch { /* older Telegram */ }
  }

  // ---- domain actions (optimistic) ----

  const act = {
    avail(date) {
      const me = S.me;
      if (!me) return;
      optimistic(
        () => upsertLocalCell({ nsman_id: me.id, date, state: 'available', dept: me.dept, reason: '' }),
        () => api('POST', '/api/cells/available', { date }),
        (res) => upsertLocalCell(res.cell),
        `Marked available: ${nice(date)}`,
      );
    },
    unavail(date) {
      const me = S.me;
      if (!me) return;
      optimistic(
        () => upsertLocalCell({ nsman_id: me.id, date, state: 'none' }),
        () => api('POST', '/api/cells/unavailable', { date }),
        () => upsertLocalCell({ nsman_id: me.id, date, state: 'none' }),
        `Removed: ${nice(date)}`,
      );
    },
    received(date) {
      const me = S.me;
      if (!me) return;
      optimistic(
        () => upsertLocalCell({ nsman_id: me.id, date, state: 'received' }),
        () => api('POST', '/api/cells/received', { date }),
        (res) => upsertLocalCell(res.cell),
        `SAF100 received for ${nice(date)}`,
      );
    },
    cancel(date, reason) {
      const me = S.me;
      if (!me) return;
      optimistic(
        () => upsertLocalCell({ nsman_id: me.id, date, state: 'cancelled', reason, ended_by: me.name }),
        () => api('POST', '/api/cells/cancel', { date, reason }),
        (res) => upsertLocalCell(res.cell),
        `SAF100 cancelled for ${nice(date)}`,
      );
    },
    plan(nsmanId, date) {
      const p = S.nsmen.find((x) => Number(x.id) === Number(nsmanId));
      optimistic(
        () => upsertLocalCell({ nsman_id: nsmanId, date, state: 'planned', dept: p ? p.dept : S.plDept }),
        () => api('POST', '/api/cells/plan', { nsmanId, date }),
        (res) => upsertLocalCell(res.cell),
        `${p ? p.name : 'NSman'} planned for ${nice(date)}`,
      );
    },
    planBatch(nsmanIds, date) {
      optimistic(
        () => nsmanIds.forEach((id) => upsertLocalCell({ nsman_id: id, date, state: 'planned', dept: S.plDept })),
        () => api('POST', '/api/cells/plan-batch', { nsmanIds, date }),
        (res) => (res.cells || []).forEach(upsertLocalCell),
        `${nsmanIds.length} planned for ${nice(date)}`,
      );
    },
    unplan(nsmanId, date) {
      optimistic(
        () => upsertLocalCell({ nsman_id: nsmanId, date, state: 'available' }),
        () => api('POST', '/api/cells/unplan', { nsmanId, date }),
        (res) => upsertLocalCell(res.cell),
        'Un-planned',
      );
    },
    send(nsmanId, date) {
      const p = S.nsmen.find((x) => Number(x.id) === Number(nsmanId));
      optimistic(
        () => upsertLocalCell({ nsman_id: nsmanId, date, state: 'sent' }),
        () => api('POST', '/api/cells/send', { nsmanId, date }),
        (res) => upsertLocalCell(res.cell),
        `SAF100 sent: ${p ? p.name : 'NSman'}, ${nice(date)}`,
      );
    },
    withdraw(nsmanId, date, reason) {
      optimistic(
        () => upsertLocalCell({ nsman_id: nsmanId, date, state: 'withdrawn', reason }),
        () => api('POST', '/api/cells/withdraw', { nsmanId, date, reason }),
        (res) => upsertLocalCell(res.cell),
        'SAF100 withdrawn',
      );
    },
    saveFlight(dept, date, type, time, isEdit) {
      optimistic(
        () => {
          const idx = S.flightDays.findIndex((f) => f.dept === dept && f.date === date);
          if (idx >= 0) S.flightDays[idx] = Object.assign({}, S.flightDays[idx], { type, time });
          else S.flightDays.push({ dept, date, type, time });
        },
        () => api('POST', '/api/flights', { dept, date, type, time }),
        (res) => {
          const idx = S.flightDays.findIndex((f) => f.dept === dept && f.date === date);
          if (idx >= 0) S.flightDays[idx] = res.flightDay;
          else S.flightDays.push(res.flightDay);
        },
        `${isEdit ? 'Saved' : 'Posted'}: ${nice(date)}`,
      );
    },
    removeFlight(dept, date) {
      optimistic(
        () => {
          S.flightDays = S.flightDays.filter((f) => !(f.dept === dept && f.date === date));
        },
        () => api('DELETE', '/api/flights', { dept, date }),
        () => {
          S.flightDays = S.flightDays.filter((f) => !(f.dept === dept && f.date === date));
        },
        `Flight day removed: ${nice(date)}`,
      );
    },
    editNsman(id, name, dept) {
      optimistic(
        () => {
          const idx = S.nsmen.findIndex((x) => Number(x.id) === Number(id));
          if (idx >= 0) S.nsmen[idx] = Object.assign({}, S.nsmen[idx], { name, dept });
        },
        () => api('PATCH', `/api/nsmen/${id}`, { name, dept }),
        (res) => {
          const idx = S.nsmen.findIndex((x) => Number(x.id) === Number(id));
          if (idx >= 0) {
            if (S.plannerDepts.includes(res.nsman.dept)) S.nsmen[idx] = res.nsman;
            else S.nsmen.splice(idx, 1);
          }
          if (S.me && Number(S.me.id) === Number(id)) S.me = res.nsman;
        },
        `Updated ${name}`,
      );
    },
    removeNsman(id, name) {
      optimistic(
        () => {
          S.nsmen = S.nsmen.filter((x) => Number(x.id) !== Number(id));
        },
        () => api('DELETE', `/api/nsmen/${id}`),
        () => {
          S.nsmen = S.nsmen.filter((x) => Number(x.id) !== Number(id));
        },
        `Removed ${name}`,
      );
    },
    addPlanner(tgId, name, dept) {
      optimistic(
        () => {
          S.planners.push({ tg_id: String(tgId), dept, name });
        },
        () => api('POST', '/api/planners', { tgId, name, dept }),
        (res) => {
          S.planners = res.planners || S.planners;
        },
        `${name} added as ${dept} planner`,
      );
    },
    removePlanner(tgId, dept, name) {
      const meId = myTgId();
      const isSelf = String(tgId) === meId;
      optimistic(
        () => {
          S.planners = S.planners.filter((p) => !(p.dept === dept && String(p.tg_id) === String(tgId)));
          if (isSelf && !S.isAdmin) {
            S.plannerDepts = S.plannerDepts.filter((d) => d !== dept);
            if (!S.plannerDepts.includes(S.plDept)) S.plDept = S.plannerDepts[0] || '';
            if (S.plannerDepts.length === 0) S.tab = 'mine';
          }
        },
        () => api('DELETE', '/api/planners', { tgId, dept }),
        (res) => {
          S.plannerDepts = res.plannerDepts || S.plannerDepts;
          S.planners = res.planners || [];
          if (!S.plannerDepts.includes(S.plDept)) S.plDept = S.plannerDepts[0] || '';
          if (S.plannerDepts.length === 0 && !S.isAdmin) S.tab = 'mine';
        },
        isSelf ? `Stepped down as ${dept} planner` : `${name} removed from ${dept} planners`,
      );
    },
  };

  // ---- shared planner / admin form helpers ----

  function plannerFormHtml(depts) {
    return `<form id="addPl">
      <label class="f" for="apTg">Telegram ID</label>
      <input class="field num" id="apTg" inputmode="numeric" autocomplete="off" placeholder="e.g. 6120458831" required>
      <label class="f" for="apName">Rank and name</label>
      <input class="field" id="apName" autocomplete="off" autocapitalize="characters" maxlength="60" placeholder="e.g. ME4 ONG S.H." required>
      ${depts.length > 1
        ? `<label class="f" for="apDept">Department</label><select class="field" id="apDept">${depts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>`
        : `<input type="hidden" id="apDept" value="${esc(depts[0])}">`}
      <div id="apMsg"></div>
      <button class="btn block" id="addPlBtn" type="submit">Add planner</button>
      <p class="note" style="margin-top:8px">They don't need to join as an NSman. They get a bot message once added.</p>
    </form>`;
  }

  function wirePlannerForm() {
    const f = $('addPl');
    if (!f) return;
    f.onsubmit = (e) => {
      e.preventDefault();
      const tgVal = $('apTg').value.trim();
      const nameVal = $('apName').value.trim().toUpperCase();
      const deptVal = $('apDept').value;
      if (!/^\d{5,15}$/.test(tgVal)) {
        $('apMsg').innerHTML = `<div class="why">A Telegram ID is a number of 5 to 15 digits. Ask the person to copy it from the app.</div>`;
        return;
      }
      if (!nameVal) {
        $('apMsg').innerHTML = `<div class="why">Enter a rank and name.</div>`;
        return;
      }
      if (S.planners.some((p) => p.dept === deptVal && String(p.tg_id) === tgVal)) {
        $('apMsg').innerHTML = `<div class="warn">${esc(nameVal)} is already a ${esc(deptVal)} planner.</div>`;
        return;
      }
      $('apMsg').innerHTML = '';
      act.addPlanner(tgVal, nameVal, deptVal);
    };
  }

  function plannerRowsHtml(dept, canRemoveOthers, meId) {
    const list = S.planners.filter((p) => p.dept === dept);
    if (!list.length) return `<p class="note" style="margin:0">No planner yet.</p>`;
    return list.map((p) => {
      const self = String(p.tg_id) === meId;
      const only = list.length === 1;
      const btn = canRemoveOthers
        ? `<button class="btn danger small" type="button" data-rm="${esc(dept)}|${esc(p.tg_id)}">Remove</button>`
        : self
          ? (only
              ? `<span class="note">Only planner</span>`
              : `<button class="btn danger small" type="button" data-rm="${esc(dept)}|${esc(p.tg_id)}">Step down</button>`)
          : '';
      return `<div class="plrow"><span><b style="font-weight:500">${esc(p.name)}${self ? ' (you)' : ''}</b><span class="sub num">TG ${esc(p.tg_id)}</span></span>${btn}</div>`;
    }).join('');
  }

  function wireRemovePlanners() {
    $('screen').querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => {
        const [dept, tgId] = b.dataset.rm.split('|');
        const p = S.planners.find((x) => x.dept === dept && String(x.tg_id) === String(tgId));
        if (b.dataset.ok !== '1') {
          b.dataset.ok = '1';
          b.textContent = 'Tap again to confirm';
          return;
        }
        act.removePlanner(tgId, dept, p ? p.name : tgId);
      };
    });
  }

  // ---- rendering ----

  function render() {
    const screen = $('screen');
    const tabs = $('tabs');

    if (S.screen === 'outside') {
      tabs.hidden = true;
      tabs.innerHTML = '';
      screen.innerHTML = `<p class="center">Open Enforcer NSMEN from the Telegram link.</p>`;
      return;
    }
    if (S.screen === 'fatal') {
      tabs.hidden = true;
      tabs.innerHTML = '';
      screen.innerHTML = `<p class="center">${esc(S.fatal)}</p>`;
      return;
    }
    if (S.screen === 'loading') {
      tabs.hidden = true;
      tabs.innerHTML = '';
      screen.innerHTML = `<p class="center note">Loading…</p>`;
      return;
    }

    const isAdmin = S.isAdmin;
    const isPlanner = isAdmin || S.plannerDepts.length > 0;
    const isJoined = !!S.me;

    if (!isJoined && !isPlanner) {
      tabs.hidden = true;
      tabs.innerHTML = '';
      renderJoin();
      return;
    }

    if (S.tab === 'admin' && isAdmin) {
      renderAdmin();
    } else if (S.tab === 'planner' && isPlanner) {
      renderPlanner();
    } else if (isJoined) {
      renderMine();
    } else {
      // A planner or admin who is not an NSman never sees the joining screen.
      S.tab = 'planner';
      renderPlanner();
    }

    const tabList = [];
    if (isPlanner) tabList.push({ id: 'tabPlanner', key: 'planner', label: 'Planner' });
    if (isAdmin) tabList.push({ id: 'tabAdmin', key: 'admin', label: 'Admin' });
    if (isJoined) tabList.push({ id: 'tabMine', key: 'mine', label: 'My days' });

    tabs.hidden = false;
    tabs.className = tabList.length === 1 ? 'tabs one' : tabList.length === 3 ? 'tabs three' : 'tabs';
    tabs.innerHTML = tabList
      .map((t) => `<button id="${t.id}" ${S.tab === t.key ? 'aria-current="page"' : ''}>${t.label}</button>`)
      .join('');
    tabList.forEach((t) => {
      const btn = $(t.id);
      if (btn) btn.onclick = () => { S.tab = t.key; closeSheet(); render(); };
    });
  }

  function renderJoin() {
    $('screen').innerHTML = `<div class="pad">
      <div class="mark" style="margin:8px 0 18px">
        <span class="mono" aria-hidden="true">EN</span>
        <div><b style="font-size:16px">Enforcer NSMEN</b><div class="note">Flying duty planning for NSmen</div></div>
      </div>
      <h3 style="font-size:20px;line-height:26px;margin:0 0 6px">Join your department</h3>
      <p style="margin:0 0 18px;color:var(--muted)">Your planner uses this to see when you can fly and to send your SAF100.</p>
      <form id="joinf">
        <label class="f" for="jname">Rank and name</label>
        <input class="field" id="jname" autocomplete="off" autocapitalize="characters" maxlength="60" placeholder="Rank and initials" required>
        <p class="help">As your planner knows you. Shown to your department's planners only.</p>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="f" style="padding:0">Department</legend>
          <div class="depts">${S.departments.map((d) =>
            `<label><input type="radio" name="dept" value="${esc(d)}" required>${esc(d)}</label>`,
          ).join('')}</div>
        </fieldset>
        <button class="btn block" id="joinBtn" type="submit">Join</button>
        <p class="note" style="margin-top:10px">Telegram tells the app who you are. You can't join twice from one account.</p>
      </form>
      ${tgIdBoxHtml("Planner, not an NSman? Send this to the Highest Admin or your department's planner. They'll add you and you won't need to join.")}
    </div>`;

    wireCopy('copyTg', 'myTg', myTgId());

    $('joinf').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('jname').value.trim().toUpperCase();
      const picked = document.querySelector('input[name="dept"]:checked');
      if (!name || !picked) return;
      const btn = $('joinBtn');
      btn.disabled = true;
      btn.textContent = 'Joining…';
      try {
        await askWriteAccess();
        const data = await api('POST', '/api/join', { name, dept: picked.value });
        S.tab = 'mine';
        applyInit(data, false);
        toast(`Joined ${picked.value}. Tap any date you're free.`);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Join';
        toast(err.message || 'Could not join.', true);
      }
    };
  }

  function renderAdmin() {
    const meId = myTgId();
    $('screen').innerHTML = `<div class="pad">
      <div class="apptitle"><h3>Admin</h3><span class="chip">Highest Admin</span></div>
      <div class="finding"><p>You assign planners by Telegram ID. Each department's planners can also add planners for their own department.</p></div>
      ${S.departments.map((d) => {
        const count = S.planners.filter((p) => p.dept === d).length;
        return `<div class="list" style="margin-top:14px">
          <h4>${esc(d)} planners <span class="num">${count}</span></h4>
          ${plannerRowsHtml(d, true, meId)}
        </div>`;
      }).join('')}
      <div class="secblock">
        <h4>Add a planner</h4>
        ${plannerFormHtml(S.departments)}
      </div>
      <div class="secblock">
        <h4>Pass on Highest Admin</h4>
        <p class="note" style="margin:0 0 10px">For a handover. You stop being Highest Admin as soon as it's passed on.</p>
        <form id="passAd">
          <label class="f" for="paTg">New Highest Admin's Telegram ID</label>
          <input class="field num" id="paTg" inputmode="numeric" autocomplete="off" placeholder="e.g. 5520881904" required>
          <label class="f" for="paName">Rank and name</label>
          <input class="field" id="paName" autocomplete="off" autocapitalize="characters" maxlength="60" placeholder="e.g. LTC TAY W.K." required>
          <div id="paMsg"></div>
          <button class="btn danger block" id="passAdBtn" type="submit">Pass on Highest Admin</button>
        </form>
      </div>
    </div>`;

    wirePlannerForm();
    wireRemovePlanners();

    const passForm = $('passAd');
    const resetPassConfirm = () => {
      if (passForm.dataset.ok) {
        delete passForm.dataset.ok;
        $('paMsg').innerHTML = '';
      }
    };
    $('paTg').oninput = resetPassConfirm;
    $('paName').oninput = resetPassConfirm;

    passForm.onsubmit = async (e) => {
      e.preventDefault();
      const tgVal = $('paTg').value.trim();
      const nameVal = $('paName').value.trim().toUpperCase();
      if (!/^\d{5,15}$/.test(tgVal)) {
        $('paMsg').innerHTML = `<div class="why">A Telegram ID is a number of 5 to 15 digits.</div>`;
        return;
      }
      if (!nameVal) {
        $('paMsg').innerHTML = `<div class="why">Enter a rank and name.</div>`;
        return;
      }
      const sig = `${tgVal}|${nameVal}`;
      if (passForm.dataset.ok !== sig) {
        passForm.dataset.ok = sig;
        $('paMsg').innerHTML = `<div class="warn">${esc(nameVal)} (TG ${esc(tgVal)}) becomes Highest Admin and you lose the Admin tab. Tap Pass on Highest Admin again to confirm.</div>`;
        return;
      }
      const btn = $('passAdBtn');
      btn.disabled = true;
      btn.textContent = 'Passing on…';
      try {
        const data = await api('POST', '/api/admin/pass', { tgId: tgVal, name: nameVal });
        applyInit(data, true);
        toast(`Highest Admin passed to ${nameVal}`);
      } catch (err) {
        delete passForm.dataset.ok;
        btn.disabled = false;
        btn.textContent = 'Pass on Highest Admin';
        $('paMsg').innerHTML = `<div class="why">${esc(err.message || 'Could not pass on Highest Admin.')}</div>`;
      }
    };
  }

  function renderMine() {
    const p = S.me;
    const [y, m] = S.nsMonth;
    const wy = workYearOf(todayStr());
    const u = usedInWy(p.id, wy);
    const waiting = S.cells
      .filter((c) => Number(c.nsman_id) === Number(p.id) && c.state === 'sent' && !isPast(c.date))
      .map((c) => c.date)
      .sort();

    const first = dowIdx(iso(y, m, 1));
    const n = daysIn(y, m);
    let grid = DOW.map((d) => `<div class="dow">${d.slice(0, 2)}</div>`).join('');
    for (let i = 0; i < first; i++) grid += `<span class="day blank"></span>`;
    for (let d = 1; d <= n; d++) {
      const ds = iso(y, m, d);
      const c = cellOf(p.id, ds);
      const f = flightOf(p.dept, ds);
      const cls = ['day', sCls(c.state), f ? 'flight' : '', isPast(ds) ? 'past' : '', isToday(ds) ? 'today' : '']
        .filter(Boolean)
        .join(' ');
      const lab = `${nice(ds)}: ${STATE_WORD[c.state]}${f ? ', ' + p.dept + ' flight' : ''}`;
      grid += `<button class="${cls}" data-d="${ds}" aria-label="${esc(lab)}"><span class="d num">${d}</span>${
        tagOf(c.state) ? `<span class="tag">${tagOf(c.state)}</span>` : ''
      }</button>`;
    }

    const mk = `${y}-${pad2(m + 1)}`;
    const fl = S.flightDays
      .filter((f) => f.dept === p.dept && f.date.startsWith(mk))
      .sort((a, b) => a.date.localeCompare(b.date));
    const rows = fl.map((f) => {
      const c = cellOf(p.id, f.date);
      return `<button class="lrow" data-d="${f.date}"><span class="dt num">${nice(f.date).replace(/ \w+$/, '')}</span><span>${esc(f.type || 'Flight')}<span class="sub num">${esc(f.time || 'Time not set')}</span></span><span class="pill ${pillCls(c.state)}">${STATE_WORD[c.state]}</span></button>`;
    }).join('');

    $('screen').innerHTML = `<div class="pad">
      <div class="apptitle"><h3>My days</h3><span class="chip">${esc(p.dept)}</span></div>
      <div class="cap">
        <div class="row"><span>SAF100 this work year</span><span class="note">${wyLabel(wy)}</span></div>
        <div class="big num">${u} <small>of ${S.cap} days</small></div>
        <div class="bar ${u >= S.cap ? 'full' : ''}"><i style="width:${Math.min(100, (u / S.cap) * 100)}%"></i></div>
      </div>
      ${waiting.length ? `<div class="finding"><p>SAF100 for <b>${nice(waiting[0])}</b> is waiting for you to confirm.</p><button class="btn small" id="conf" data-d="${waiting[0]}">I've received it</button></div>` : ''}
      <div class="monthbar">
        <h4>${MONTHS[m]} ${y}</h4>
        <div class="arrows">
          <button class="icon" id="pm" aria-label="Previous month" ${monthOK(S.nsMonth, -1) ? '' : 'disabled'}>${chev(-1)}</button>
          <button class="icon" id="nm" aria-label="Next month" ${monthOK(S.nsMonth, 1) ? '' : 'disabled'}>${chev(1)}</button>
        </div>
      </div>
      <div class="cal" id="nscal">${grid}</div>
      <p class="note" style="margin:8px 0 0">Tap a date you're free to mark it. A bar under the date means ${esc(p.dept)} is flying.</p>
      <div class="list">
        <h4>${esc(p.dept)} flights in ${MONTHS[m]} <span class="num">${fl.length}</span></h4>
        ${rows || `<p class="note" style="margin:0">No ${esc(p.dept)} flights posted for ${MONTHS[m]} yet. You can still mark the days you're free.</p>`}
      </div>
      ${aboutMeHtml()}
    </div>`;

    wireCopy('copyAboutTg', 'aboutTg', myTgId());

    $('pm').onclick = () => { if (monthOK(S.nsMonth, -1)) { S.nsMonth = shiftMonth(S.nsMonth, -1); render(); } };
    $('nm').onclick = () => { if (monthOK(S.nsMonth, 1)) { S.nsMonth = shiftMonth(S.nsMonth, 1); render(); } };
    const conf = $('conf');
    if (conf) conf.onclick = () => act.received(conf.dataset.d);

    $('screen').querySelectorAll('[data-d]').forEach((b) => {
      if (b.id !== 'conf') b.onclick = () => nsSheet(b.dataset.d);
    });

    // Swipe left/right to change month on NSman calendar
    const calEl = $('nscal');
    let touchX = null;
    calEl.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 1) touchX = ev.touches[0].clientX;
    }, { passive: true });
    calEl.addEventListener('touchend', (ev) => {
      if (touchX == null || ev.changedTouches.length !== 1) return;
      const dx = ev.changedTouches[0].clientX - touchX;
      touchX = null;
      if (dx < -48 && monthOK(S.nsMonth, 1)) { S.nsMonth = shiftMonth(S.nsMonth, 1); render(); }
      else if (dx > 48 && monthOK(S.nsMonth, -1)) { S.nsMonth = shiftMonth(S.nsMonth, -1); render(); }
    }, { passive: true });
  }

  function nsSheet(d) {
    const p = S.me;
    const c = cellOf(p.id, d);
    const f = flightOf(p.dept, d);
    let body = '';
    const btns = [];

    if (isPast(d)) {
      body = `<p class="sub">Past dates are locked.</p>`;
    } else if (c.state === 'none') {
      btns.push(['Mark available', 'primary', () => act.avail(d)]);
    } else if (c.state === 'available') {
      btns.push(['Remove', 'sec', () => act.unavail(d)]);
    } else if (c.state === 'planned') {
      body = `<div class="warn">Removing this date also takes you off the plan. Your planner is told.</div>`;
      btns.push(['Remove and come off the plan', 'sec', () => act.unavail(d)]);
    } else if (c.state === 'sent' || c.state === 'received') {
      if (c.state === 'sent') btns.push(["I've received my SAF100", 'primary', () => act.received(d)]);
      if (beforeDay(d)) btns.push(['Cancel SAF100', 'danger', () => { cancelSheet(d); return false; }]);
      else body = `<p class="sub">SAF100 can be cancelled up to the day before.</p>`;
    } else {
      btns.push(['Mark available again', 'sec', () => act.avail(d)]);
    }

    openSheet(
      `<h5>${nice(d)}</h5>
       <p class="sub">${f ? `${esc(p.dept)} flight` : `No ${esc(p.dept)} flight posted`}</p>
       <div class="kv">
         ${f ? `<div><span>Flight</span><span>${esc(flInfo(f))}</span></div>` : ''}
         <div><span>You</span><span><span class="pill ${pillCls(c.state)}">${STATE_WORD[c.state]}</span></span></div>
         ${c.reason ? `<div><span>Reason</span><span>${esc(c.reason)}</span></div>` : ''}
       </div>${body}`,
      btns,
    );
  }

  function cancelSheet(d) {
    openSheet(
      `<h5>Cancel SAF100</h5>
       <p class="sub">${nice(d)}. The day goes back to your ${S.cap}, and your planner is told.</p>
       <label class="f" for="why">Reason (optional)</label>
       <textarea class="field" id="why" maxlength="200" placeholder="e.g. Overseas work trip"></textarea>`,
      [
        ['Cancel SAF100 for ' + nice(d), 'danger', () => act.cancel(d, $('why').value.trim())],
        ['Keep it', 'sec', () => {}],
      ],
    );
  }

  function renderPlanner() {
    const [y, m] = S.plMonth;
    const n = daysIn(y, m);
    const dept = S.plDept;
    const crew = S.nsmen.filter((p) => p.dept === dept).sort((a, b) => a.name.localeCompare(b.name));
    const mk = `${y}-${pad2(m + 1)}`;
    const fl = S.flightDays
      .filter((f) => f.dept === dept && f.date.startsWith(mk))
      .sort((a, b) => a.date.localeCompare(b.date));
    const crewIds = new Set(crew.map((p) => Number(p.id)));
    const outstanding = S.cells.filter((c) => c.state === 'sent' && crewIds.has(Number(c.nsman_id)) && !isPast(c.date)).length;
    const curWy = workYearOf(todayStr());
    const atCap = crew.filter((p) => usedInWy(p.id, curWy) >= S.cap);

    const finding = [
      outstanding
        ? `${outstanding} SAF100 ${outstanding === 1 ? 'is' : 'are'} waiting for the NSman to confirm`
        : 'Every SAF100 sent has been confirmed',
      atCap.length
        ? `${atCap.map((p) => p.name).join(', ')} ${atCap.length === 1 ? 'is' : 'are'} at ${S.cap} of ${S.cap}`
        : '',
    ].filter(Boolean).join('. ') + '.';

    let view = '';

    if (S.plView === 'grid') {
      let head = `<th class="nm" scope="col">NSman · SAF100</th>`;
      for (let d = 1; d <= n; d++) {
        const ds = iso(y, m, d);
        const di = dowIdx(ds);
        const f = flightOf(dept, ds);
        head += `<th class="dh ${f ? 'fl' : ''} ${di > 4 ? 'we' : ''} ${isToday(ds) ? 'today' : ''}" scope="col"><button data-h="${ds}" aria-label="${nice(ds)}${f ? ', flight day' : ''}. Open day">${DOW[di].slice(0, 2)}<b class="num">${d}</b></button></th>`;
      }
      let freeRow = `<th class="nm sum" scope="row">Free</th>`;
      let onRow = `<th class="nm sum" scope="row">On the plan</th>`;
      for (let d = 1; d <= n; d++) {
        const ds = iso(y, m, d);
        const f = flightOf(dept, ds);
        const t = tally(crew, ds);
        freeRow += `<td class="sum ${f ? 'fl' : ''} num">${isPast(ds) ? '' : t.free || '–'}</td>`;
        onRow += `<td class="sum ${f ? 'fl' : ''} num">${isPast(ds) ? '' : t.on || '–'}</td>`;
      }
      head += `</tr><tr>${freeRow}</tr><tr>${onRow}`;

      const body = crew.map((p) => {
        const u = usedInWy(p.id, workYearOf(iso(y, m, 1)));
        let r = `<th class="nm" scope="row"><b>${esc(p.name)}</b><span class="cnt num ${u >= S.cap ? 'full' : u >= 35 ? 'hi' : ''}">${u}/${S.cap}</span></th>`;
        for (let d = 1; d <= n; d++) {
          const ds = iso(y, m, d);
          const c = cellOf(p.id, ds);
          const f = flightOf(dept, ds);
          r += `<td class="c ${f ? 'fl' : ''}"><button class="${sCls(c.state)} ${isPast(ds) ? 'past' : ''}" data-p="${p.id}" data-d="${ds}" aria-label="${esc(p.name)}, ${nice(ds)}: ${STATE_WORD[c.state]}">${tagOf(c.state)}</button></td>`;
        }
        return `<tr>${r}</tr>`;
      }).join('');

      view = `<div class="gridwrap"><table class="plan"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${n + 1}" class="note" style="padding:16px 0">No NSmen in ${esc(dept)} yet.</td></tr>`}</tbody></table></div>
        <p class="note flnote">Tap a date to see who's free and plan several at once. Shaded columns are ${esc(dept)} flight days.</p>`;
    } else if (S.plView === 'flights') {
      const rows = fl.map((f) => {
        const cs = crew.map((p) => cellOf(p.id, f.date).state);
        const on = cs.filter((s) => ON_PLAN.includes(s)).length;
        const av = cs.filter((s) => s === 'available').length;
        const se = cs.filter((s) => s === 'sent').length;
        return `<button class="lrow" data-h="${f.date}"><span class="dt num">${nice(f.date).replace(/ \w+$/, '')}</span><span>${esc(f.type || 'Flight')} <span class="note num">${esc(f.time || '')}</span><span class="sub num">${on} on the plan · ${av} more available · ${se} SAF100 to confirm</span></span><span class="pill p-none num">${on} planned</span></button>`;
      }).join('');
      view = `<div class="list" style="margin-top:0"><h4>${esc(dept)} flights in ${MONTHS[m]} <span class="num">${fl.length}</span></h4>${rows || `<p class="note">No flights posted for ${MONTHS[m]} yet.</p>`}</div>
        <button class="btn sec block" id="addfl" style="margin-top:12px">Post a flight day</button>`;
    } else {
      const meId = myTgId();
      const rows = crew.map((p) => {
        const u = usedInWy(p.id, curWy);
        const jd = p.joined_at ? String(p.joined_at).slice(0, 10) : '';
        const joinedLabel = /^\d{4}-\d{2}-\d{2}$/.test(jd)
          ? `Joined ${nice(jd).replace(/^\w+ /, '')} ${jd.slice(0, 4)}`
          : '';
        return `<button class="lrow" data-edit-ns="${p.id}"><span><b style="font-weight:500">${esc(p.name)}</b><span class="sub">${esc(joinedLabel)}</span></span><span style="text-align:right"><span class="num" style="${u >= S.cap ? 'color:var(--negative);font-weight:500' : ''}">${u} of ${S.cap}</span><span class="mini ${u >= S.cap ? 'full' : ''}"><i style="width:${Math.min(100, (u / S.cap) * 100)}%"></i></span></span></button>`;
      }).join('');

      const deptPlanners = S.planners.filter((p) => p.dept === dept);
      const wyOptions = [curWy - 1, curWy, curWy + 1]
        .map((wy) => `<option value="${wy}" ${wy === S.exportWy ? 'selected' : ''}>${wyLabel(wy)}</option>`)
        .join('');

      view = `<div class="list peop" style="margin-top:0">
          <h4>${esc(dept)} NSmen <span class="num">${crew.length}</span></h4>
          ${rows || `<p class="note">No NSmen in ${esc(dept)} yet.</p>`}
        </div>
        <p class="note" style="margin-top:8px">SAF100 days used in ${wyLabel(curWy)}. Tap an NSman to rename, move department, or remove.</p>

        <div class="secblock" id="exportSec">
          <h4>Export CSV</h4>
          <p class="note" style="margin:0 0 8px">Downloads duties and the audit log for ${esc(dept)} in the chosen work year.</p>
          <div class="addrow">
            <select id="exportWySel" aria-label="Work year to export">${wyOptions}</select>
            <button class="btn sec" id="exportBtn" type="button">Export CSV</button>
          </div>
        </div>

        <div class="secblock" id="plannersSec">
          <h4>${esc(dept)} planners <span class="num">${deptPlanners.length}</span></h4>
          ${plannerRowsHtml(dept, S.isAdmin, meId)}
        </div>

        <div class="secblock" id="addPlannerSec">
          <h4>Add a ${esc(dept)} planner</h4>
          ${plannerFormHtml([dept])}
        </div>`;
    }

    const plannerLabel =
      S.plannerName ||
      (S.isAdmin && S.admin && S.admin.name) ||
      (S.me && S.me.name) ||
      (S.tgUser && S.tgUser.username ? '@' + S.tgUser.username : 'Planner');
    const deptCtrl = S.plannerDepts.length > 1
      ? `<label for="dsel" class="note" style="flex:none">Department</label><select id="dsel">${S.plannerDepts.map((d) => `<option value="${esc(d)}" ${d === dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>`
      : `<span class="deptlabel">${esc(dept)}</span>`;

    $('screen').innerHTML = `<div class="pad">
      <div class="apptitle"><h3>Planner</h3><span class="chip">${esc(plannerLabel)}</span></div>
      <div class="pltop">
        ${deptCtrl}
        <button class="icon" id="pm" aria-label="Previous month" ${monthOK(S.plMonth, -1) ? '' : 'disabled'}>${chev(-1)}</button>
        <button class="icon" id="nm" aria-label="Next month" ${monthOK(S.plMonth, 1) ? '' : 'disabled'}>${chev(1)}</button>
      </div>
      <div class="monthbar" style="margin-top:0"><h4>${MONTHS[m]} ${y}</h4><span class="note num">${fl.length} flight days · ${crew.length} NSmen</span></div>
      <div class="finding"><p>${esc(finding)}</p></div>
      <div class="segrow"><div class="seg" role="group" aria-label="Planner view">
        ${[['grid', 'Plan'], ['flights', 'Flights'], ['people', 'NSmen']].map(([k, l]) =>
          `<button data-v="${k}" aria-pressed="${S.plView === k}">${l}</button>`,
        ).join('')}
      </div></div>
      ${view}
      ${aboutMeHtml()}
    </div>`;

    wireCopy('copyAboutTg', 'aboutTg', myTgId());

    const dsel = $('dsel');
    if (dsel) dsel.onchange = (e) => { S.plDept = e.target.value; render(); };
    $('pm').onclick = () => { if (monthOK(S.plMonth, -1)) { S.plMonth = shiftMonth(S.plMonth, -1); render(); } };
    $('nm').onclick = () => { if (monthOK(S.plMonth, 1)) { S.plMonth = shiftMonth(S.plMonth, 1); render(); } };
    $('screen').querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { S.plView = b.dataset.v; render(); }; });
    $('screen').querySelectorAll('[data-h]').forEach((b) => { b.onclick = () => daySheet(b.dataset.h); });
    $('screen').querySelectorAll('td.c button').forEach((b) => { b.onclick = () => plSheet(Number(b.dataset.p), b.dataset.d); });

    const af = $('addfl');
    if (af) af.onclick = () => flightSheet(null);

    $('screen').querySelectorAll('[data-edit-ns]').forEach((b) => {
      b.onclick = () => {
        const ns = S.nsmen.find((x) => Number(x.id) === Number(b.dataset.editNs));
        if (ns) nsmanEditSheet(ns);
      };
    });

    wirePlannerForm();
    wireRemovePlanners();

    const wySel = $('exportWySel');
    if (wySel) wySel.onchange = (e) => { S.exportWy = Number(e.target.value); };
    const expBtn = $('exportBtn');
    if (expBtn) {
      expBtn.onclick = async () => {
        expBtn.disabled = true;
        expBtn.textContent = 'Exporting…';
        try {
          if (tg && typeof tg.downloadFile === 'function') {
            const link = await api('POST', '/api/export-link', { workYear: S.exportWy, dept });
            const fullUrl = /^https?:\/\//i.test(link.url) ? link.url : apiBase() + link.url;
            tg.downloadFile({ url: fullUrl, file_name: link.filename });
            toast(`Exported ${link.filename}`);
          } else {
            const { csv, filename } = await apiExportCsv(S.exportWy, dept);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast(`Exported ${filename}`);
          }
        } catch (err) {
          toast(err.message || 'Export failed.', true);
        } finally {
          expBtn.disabled = false;
          expBtn.textContent = 'Export CSV';
        }
      };
    }
  }

  function plSheet(nsmanId, d) {
    const p = S.nsmen.find((x) => Number(x.id) === Number(nsmanId));
    if (!p) return;
    const c = cellOf(nsmanId, d);
    const f = flightOf(p.dept, d);
    const wy = workYearOf(d);
    const u = usedInWy(nsmanId, wy);
    let body = '';
    const btns = [];

    if (isPast(d)) {
      body = `<p class="sub">Past dates are locked.</p>`;
    } else if (c.state === 'none') {
      body = `<p class="sub">${esc(p.name)} hasn't marked this day available, so they can't be planned on it.</p>`;
    } else if (c.state === 'available') {
      btns.push(['Plan for this day', 'primary', () => act.plan(nsmanId, d)]);
    } else if (c.state === 'planned') {
      if (u >= S.cap) {
        body = `<div class="why">${esc(p.name)} has used ${u} of ${S.cap} SAF100 days in ${wyLabel(wy)}. SAF100 can't be sent until 1 Apr ${wy + 1}.</div>`;
        btns.push(['SAF100 sent', 'primary', null]);
      } else {
        btns.push(['SAF100 sent', 'primary', () => act.send(nsmanId, d)]);
      }
      btns.push(['Un-plan', 'sec', () => act.unplan(nsmanId, d)]);
    } else if (c.state === 'sent' || c.state === 'received') {
      if (beforeDay(d)) btns.push(['Withdraw SAF100', 'danger', () => { withdrawSheet(nsmanId, d); return false; }]);
      else body = `<p class="sub">SAF100 can be withdrawn up to the day before.</p>`;
    }

    openSheet(
      `<h5>${esc(p.name)}</h5>
       <p class="sub">${nice(d)}${f ? ` · ${esc(p.dept)} flight` : ' · no flight posted'}</p>
       <div class="kv">
         ${f ? `<div><span>Flight</span><span>${esc(flInfo(f))}</span></div>` : ''}
         <div><span>Status</span><span><span class="pill ${pillCls(c.state)}">${STATE_WORD[c.state]}</span></span></div>
         <div><span>SAF100 used</span><span class="num">${u} of ${S.cap}${countsTowardCap(c.state) ? ' (incl. this day)' : ''}</span></div>
         ${c.reason ? `<div><span>Reason</span><span>${esc(c.reason)}</span></div>` : ''}
       </div>${body}`,
      btns,
    );
  }

  function daySheet(d) {
    const dept = S.plDept;
    const f = flightOf(dept, d);
    const crew = S.nsmen.filter((p) => p.dept === dept);
    const t = tally(crew, d);
    const wy = workYearOf(d);
    const byLoad = (a, b) => usedInWy(a.id, wy) - usedInWy(b.id, wy) || a.name.localeCompare(b.name);
    const onPlan = crew.filter((p) => ON_PLAN.includes(cellOf(p.id, d).state)).sort(byLoad);
    const free = crew.filter((p) => cellOf(p.id, d).state === 'available').sort(byLoad);
    const ended = crew.filter((p) => ['cancelled', 'withdrawn'].includes(cellOf(p.id, d).state));
    const capNote = (p) => (usedInWy(p.id, wy) >= S.cap ? ` · <span style="color:var(--negative)">at ${S.cap}, can't get SAF100</span>` : '');
    const newNote = (p) => (isNewJoiner(p) ? ' · new' : '');
    const past = isPast(d);

    const html = `<h5>${nice(d)}</h5>
      <p class="sub">${f ? `${esc(dept)} flight · ${esc(flInfo(f))}` : `No ${esc(dept)} flight posted`}</p>
      <div style="margin:-6px 0 14px"><span class="pill p-none num">${t.on} planned</span></div>
      <div class="daylist"><h6>On the plan <span class="num">${onPlan.length}</span></h6>
        ${onPlan.map((p) => `<div class="drow"><span></span><span>${esc(p.name)}<span class="sub num">${usedInWy(p.id, wy)}/${S.cap} used${capNote(p)}</span></span><span class="pill ${pillCls(cellOf(p.id, d).state)}">${STATE_WORD[cellOf(p.id, d).state]}</span></div>`).join('') || `<p class="note" style="margin:0">Nobody planned yet.</p>`}
      </div>
      <div class="daylist"><h6>Available <span>fewest SAF100 days first</span></h6>
        ${free.map((p) => `<div class="drow"><input type="checkbox" id="pk-${p.id}" data-pick="${p.id}" ${past ? 'disabled' : ''}><label for="pk-${p.id}">${esc(p.name)}<span class="sub num">${usedInWy(p.id, wy)}/${S.cap} used${newNote(p)}${capNote(p)}</span></label><span class="pill p-available">Available</span></div>`).join('') || `<p class="note" style="margin:0">Nobody else has marked this day.</p>`}
      </div>
      ${ended.length ? `<div class="daylist"><h6>Dropped out <span class="num">${ended.length}</span></h6>${ended.map((p) => `<div class="drow"><span></span><span>${esc(p.name)}<span class="sub">${esc(cellOf(p.id, d).reason || '')}</span></span><span class="pill p-ended">${cellOf(p.id, d).state === 'cancelled' ? 'Cancelled' : 'Withdrawn'}</span></div>`).join('')}</div>` : ''}
      <p class="note" style="margin:0 0 14px">${t.none} not marked this day.</p>
      <div id="pickmsg"></div>`;

    openSheet(
      html,
      past
        ? []
        : [
            [
              'Plan selected',
              'primary',
              () => {
                const ids = [...document.querySelectorAll('[data-pick]:checked')].map((i) => Number(i.dataset.pick));
                if (!ids.length) {
                  $('pickmsg').innerHTML = `<div class="warn">Tick at least one person to plan.</div>`;
                  return false;
                }
                act.planBatch(ids, d);
              },
            ],
            [f ? 'Edit flight details' : 'Post as flight day', 'sec', () => { flightSheet(d); return false; }],
          ],
    );

    const pb = document.querySelector('.sheet [data-i="0"]');
    const upd = () => {
      const k = document.querySelectorAll('[data-pick]:checked').length;
      if (pb) pb.textContent = k ? `Plan ${k} selected` : 'Plan selected';
    };
    document.querySelectorAll('[data-pick]').forEach((i) => { i.onchange = upd; });
  }

  function withdrawSheet(nsmanId, d) {
    const p = S.nsmen.find((x) => Number(x.id) === Number(nsmanId));
    openSheet(
      `<h5>Withdraw SAF100</h5>
       <p class="sub">${esc(p ? p.name : '')}, ${nice(d)}. The day goes back to their ${S.cap}, and they get a message.</p>
       <label class="f" for="why">Reason (optional)</label>
       <textarea class="field" id="why" maxlength="200" placeholder="e.g. Sortie cancelled"></textarea>`,
      [
        ['Withdraw SAF100', 'danger', () => act.withdraw(nsmanId, d, $('why').value.trim())],
        ['Keep it', 'sec', () => {}],
      ],
    );
  }

  function flightSheet(d) {
    const dept = S.plDept;
    const f = d ? flightOf(dept, d) : null;
    const affected = d
      ? S.nsmen.filter((p) => p.dept === dept && ON_PLAN.includes(cellOf(p.id, d).state)).length
      : 0;
    const firstOfMonth = iso(S.plMonth[0], S.plMonth[1], 1);
    const minD = firstOfMonth < todayStr() ? todayStr() : firstOfMonth;

    openSheet(
      `<h5>${d ? nice(d) : 'Post a flight day'}</h5>
       <p class="sub">${esc(dept)} · ${f ? 'Flight day' : 'Not a flight day yet'}</p>
       ${d ? '' : `<label class="f" for="fd">Date</label><input class="field" type="date" id="fd" min="${todayStr()}" max="${S.maxDate}" value="${minD}">`}
       ${d && isPast(d) ? `<p class="sub">Past dates are locked.</p>` : `
         <label class="f" for="ft">Type (optional)</label>
         <input class="field" id="ft" maxlength="100" value="${esc(f ? f.type : '')}" placeholder="e.g. C-130">
         <label class="f" for="fti">Time (optional)</label>
         <input class="field" id="fti" maxlength="100" value="${esc(f ? f.time : '')}" placeholder="e.g. 0800-1500">
         <div id="rmwarn"></div>
       `}`,
      d && isPast(d)
        ? []
        : [
            [
              f ? 'Save flight details' : 'Post flight day',
              'primary',
              () => {
                const day = d || $('fd').value;
                if (!day || isPast(day)) {
                  toast('Pick today or a future date.', true);
                  return false;
                }
                act.saveFlight(dept, day, $('ft').value.trim(), $('fti').value.trim(), !!f);
              },
            ],
            ...(f
              ? [[
                  'Remove flight day',
                  'danger',
                  () => {
                    if (affected && !$('rmwarn').dataset.ok) {
                      $('rmwarn').dataset.ok = '1';
                      $('rmwarn').innerHTML = `<div class="warn">${affected} NSm${affected === 1 ? 'an is' : 'en are'} planned on this day. Removing the flight day keeps them planned; un-plan them on the Plan view if they're not needed. Tap Remove flight day again to confirm.</div>`;
                      return false;
                    }
                    act.removeFlight(dept, d);
                  },
                ]]
              : []),
          ],
    );
  }

  function nsmanEditSheet(ns) {
    openSheet(
      `<h5>Edit NSman</h5>
       <p class="sub">${esc(ns.dept)}</p>
       <label class="f" for="ename">Rank and name</label>
       <input class="field" id="ename" maxlength="60" value="${esc(ns.name)}">
       <label class="f" for="edept">Department</label>
       <select class="field" id="edept">${S.departments.map((d) => `<option value="${esc(d)}" ${d === ns.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
       <div id="rmnswarn"></div>`,
      [
        [
          'Save changes',
          'primary',
          () => {
            const nextName = $('ename').value.trim().toUpperCase();
            if (!nextName) {
              $('rmnswarn').innerHTML = `<div class="warn">Enter a name.</div>`;
              return false;
            }
            act.editNsman(ns.id, nextName, $('edept').value);
          },
        ],
        [
          'Remove NSman',
          'danger',
          () => {
            if (!$('rmnswarn').dataset.ok) {
              $('rmnswarn').dataset.ok = '1';
              $('rmnswarn').innerHTML = `<div class="warn">Remove ${esc(ns.name)} from ${esc(ns.dept)}? Past SAF100 records stay in exports. Tap Remove NSman again to confirm.</div>`;
              return false;
            }
            act.removeNsman(ns.id, ns.name);
          },
        ],
      ],
    );
  }

  function closeSheet() {
    const o = $('overlay');
    if (o) o.innerHTML = '';
  }

  function openSheet(html, btns) {
    const o = $('overlay');
    o.innerHTML = `<div class="scrim" id="scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Details">
        <div class="grab"></div>
        ${html}
        <div class="actions">
          ${btns.map(([l, k, fn], i) =>
            `<button class="btn block ${k === 'sec' ? 'sec' : k === 'danger' ? 'danger' : ''}" data-i="${i}" ${fn ? '' : 'disabled'}>${esc(l)}</button>`,
          ).join('')}
          <button class="btn block sec" id="close">Close</button>
        </div>
      </div>`;
    $('scrim').onclick = closeSheet;
    $('close').onclick = closeSheet;
    o.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = () => {
        const fn = btns[Number(b.dataset.i)][2];
        if (!fn) return;
        const r = fn();
        if (r === false) return;
        closeSheet();
      };
    });
    const first = o.querySelector('.sheet button:not(:disabled), .sheet input, .sheet textarea');
    if (first) first.focus();
    o.onkeydown = (e) => { if (e.key === 'Escape') closeSheet(); };
  }

  // ---- boot ----

  async function start() {
    if (!tg || !tg.initData) {
      S.screen = 'outside';
      return render();
    }
    try { tg.ready(); tg.expand(); } catch { /* not fatal */ }
    applyTheme();
    if (!window.APP_FAKE_API && (!window.APP_CONFIG || /REPLACE_WITH_/.test(window.APP_CONFIG.apiUrl))) {
      S.screen = 'fatal';
      S.fatal = "Enforcer NSMEN isn't set up yet: the Worker URL is missing from config.js.";
      return render();
    }
    try {
      const data = await api('GET', '/api/init');
      applyInit(data, false);
      startRefresh();
    } catch (err) {
      S.screen = 'fatal';
      S.fatal = err.message || 'Could not load Enforcer NSMEN.';
      render();
    }
  }

  start();
})();
