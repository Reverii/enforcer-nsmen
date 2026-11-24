// Cloudflare Worker entry point for Enforcer NSMEN.
// Handles CORS, Telegram initData authentication, JSON API routes, signed CSV export, and DMs.

import {
  EXPORT_TOKEN_TTL_SEC,
  createExportToken,
  verifyExportToken,
  verifyInitData,
} from './auth.js';
import {
  addPlannerDb,
  cancelSaf100Db,
  deleteFlightDayDb,
  ensureHighestAdmin,
  getAdmin,
  getAllPlanners,
  getCell,
  getDeptPlanners,
  getExportData,
  getFlightDay,
  getNsmanById,
  getNsmanByTgId,
  getPlannerDepts,
  getPlannersForDepts,
  getUserPlannerRows,
  joinNsman,
  loadInitData,
  markAvailableDb,
  markReceivedDb,
  passAdminDb,
  planCellDb,
  removeNsmanDb,
  removePlannerAdminDb,
  removeSelfPlannerAtomicDb,
  renameAdminDb,
  sendSaf100AtomicDb,
  unmarkAvailableDb,
  unplanCellDb,
  updateNsmanDb,
  upsertFlightDayDb,
  withdrawSaf100Db,
  writeLog,
} from './db.js';
import {
  CAP,
  DEPARTMENTS,
  RuleError,
  assertPlannerForDept,
  buildExportCsv,
  canAddPlanner,
  canEditFlightDay,
  canRemovePlanner,
  checkTransition,
  effectivePlannerDepts,
  fmtDate,
  fmtFlightInfo,
  isHighestAdmin,
  maxMarkingDate,
  passHighestAdmin,
  todaySGT,
  validateDept,
  validateFlightText,
  validateName,
  workYearBounds,
  workYearOf,
} from './rules.js';
import { notifyInBackground } from './telegram.js';

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed && (!origin || origin === allowed)) {
    headers['Access-Control-Allow-Origin'] = allowed;
  }
  return headers;
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
    },
  });
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    throw new RuleError('BAD_JSON', 'Invalid request body.', 400);
  }
}

function resolveActorName({ plannerRows, dept, adminRow, isAdmin, me, tgUser }) {
  if (isAdmin && adminRow && adminRow.name) return adminRow.name;
  if (dept && plannerRows) {
    const inDept = plannerRows.find((r) => r.dept === dept && r.name);
    if (inDept) return inDept.name;
  }
  if (plannerRows) {
    const any = plannerRows.find((r) => r.name);
    if (any) return any.name;
  }
  if (me && me.name) return me.name;
  if (tgUser && tgUser.username) return '@' + tgUser.username;
  return tgUser ? String(tgUser.id) : 'unknown';
}

function appUrlFor(env) {
  return env.APP_URL || env.ALLOWED_ORIGIN || '';
}

function exportFilename(wy, depts) {
  const fileDept = depts.length === 1 ? `-${depts[0].toLowerCase()}` : '';
  return `enforcer-nsmen-WY${wy}${fileDept}.csv`;
}

export async function handleRequest(request, env, ctx, opts = {}) {
  const now = opts.now ? opts.now() : new Date();
  const fetchImpl = opts.fetchImpl || fetch;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (method === 'GET' && (path === '/' || path === '/api/health')) {
    return jsonResponse(request, env, { ok: true, service: 'enforcer-nsmen' });
  }

  try {
    const nowSec = Math.floor(now.getTime() / 1000);

    // Signed CSV download (checks short-lived HMAC token instead of initData)
    if (method === 'GET' && path === '/api/export.csv') {
      const token = url.searchParams.get('token') || '';
      const payload = await verifyExportToken(token, env.BOT_TOKEN, nowSec);
      const [adminRow, ownDepts] = await Promise.all([
        getAdmin(env.DB),
        getPlannerDepts(env.DB, payload.tgId),
      ]);
      const tokenIsAdmin = isHighestAdmin(adminRow, payload.tgId);
      const allowedDepts = effectivePlannerDepts({ isAdmin: tokenIsAdmin, plannerDepts: ownDepts });
      if (allowedDepts.length === 0) {
        throw new RuleError('FORBIDDEN', 'Only planners can export CSV.', 403);
      }
      let depts = allowedDepts;
      if (payload.dept && payload.dept !== 'all') {
        assertPlannerForDept(allowedDepts, payload.dept, { isAdmin: tokenIsAdmin });
        depts = [payload.dept];
      }
      const { start, end } = workYearBounds(payload.workYear);
      const { duties, logs } = await getExportData(env.DB, { depts, wyStart: start, wyEnd: end });
      const csv = buildExportCsv({ duties, logs });
      const filename = exportFilename(payload.workYear, depts);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          ...corsHeaders(request, env),
        },
      });
    }

    const initData = request.headers.get('X-Telegram-Init-Data') || '';
    const tgUser = await verifyInitData(initData, env.BOT_TOKEN, nowSec);
    const today = todaySGT(now);
    const nowIso = now.toISOString();

    const adminRow = await ensureHighestAdmin(env.DB, tgUser, env.HIGHEST_ADMIN_TG_ID, nowIso);
    const isAdmin = isHighestAdmin(adminRow, tgUser.id);

    // Combined initial load
    if (method === 'GET' && path === '/api/init') {
      const data = await loadInitData(env.DB, tgUser.id, adminRow);
      return jsonResponse(request, env, {
        ok: true,
        today,
        workYear: workYearOf(today),
        maxDate: maxMarkingDate(today),
        cap: CAP,
        departments: DEPARTMENTS,
        tgUser: { id: tgUser.id, username: tgUser.username },
        ...data,
      });
    }

    // Self-onboarding
    if (method === 'POST' && path === '/api/join') {
      const body = await readJson(request);
      const name = validateName(body.name);
      const dept = validateDept(body.dept);
      const nsman = await joinNsman(env.DB, {
        tgId: tgUser.id,
        username: tgUser.username,
        name,
        dept,
        nowIso,
      });
      await writeLog(env.DB, {
        at: nowIso,
        actor: name,
        action: 'join',
        detail: `${name} joined ${dept}`,
      });
      const deptPlanners = await getDeptPlanners(env.DB, dept);
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: deptPlanners
          .filter((p) => String(p.tg_id) !== String(tgUser.id))
          .map((p) => ({ tgId: p.tg_id, label: p.name })),
        text: `New NSman joined ${dept}: ${name}.`,
        nowIso,
        fetchImpl,
      });
      const data = await loadInitData(env.DB, tgUser.id, adminRow);
      return jsonResponse(request, env, {
        ok: true,
        today,
        workYear: workYearOf(today),
        maxDate: maxMarkingDate(today),
        cap: CAP,
        departments: DEPARTMENTS,
        tgUser: { id: tgUser.id, username: tgUser.username },
        nsman,
        ...data,
      });
    }

    const [me, myPlannerRows] = await Promise.all([
      getNsmanByTgId(env.DB, tgUser.id),
      getUserPlannerRows(env.DB, tgUser.id),
    ]);
    const ownPlannerDepts = myPlannerRows.map((r) => r.dept);
    const plannerDepts = effectivePlannerDepts({ isAdmin, plannerDepts: ownPlannerDepts });
    const actorFor = (dept) =>
      resolveActorName({ plannerRows: myPlannerRows, dept, adminRow, isAdmin, me, tgUser });

    // ---- NSman cell actions ----

    if (method === 'POST' && path === '/api/cells/available') {
      if (!me) throw new RuleError('NOT_JOINED', 'Join your department first.', 403);
      const { date } = await readJson(request);
      const existing = await getCell(env.DB, me.id, date);
      const currentState = existing ? existing.state : 'none';
      checkTransition({ action: 'mark_available', currentState, date, today, actorRole: 'nsman' });
      const cell = await markAvailableDb(env.DB, { nsmanId: me.id, dept: me.dept, date, currentState });
      await writeLog(env.DB, { at: nowIso, actor: me.name, action: 'mark_available', detail: `${me.dept} ${date}` });
      return jsonResponse(request, env, { ok: true, cell });
    }

    if (method === 'POST' && path === '/api/cells/unavailable') {
      if (!me) throw new RuleError('NOT_JOINED', 'Join your department first.', 403);
      const { date } = await readJson(request);
      const existing = await getCell(env.DB, me.id, date);
      const currentState = existing ? existing.state : 'none';
      const { wasPlanned } = checkTransition({
        action: 'unmark_available',
        currentState,
        date,
        today,
        actorRole: 'nsman',
      });
      await unmarkAvailableDb(env.DB, { nsmanId: me.id, date, expectedState: currentState });
      await writeLog(env.DB, {
        at: nowIso,
        actor: me.name,
        action: wasPlanned ? 'unmark_planned' : 'unmark_available',
        detail: `${me.dept} ${date}`,
      });
      if (wasPlanned) {
        const deptPlanners = await getDeptPlanners(env.DB, me.dept);
        notifyInBackground({
          ctx,
          db: env.DB,
          botToken: env.BOT_TOKEN,
          recipients: deptPlanners.map((p) => ({ tgId: p.tg_id, label: p.name })),
          text: `${me.name} removed availability for ${fmtDate(date)}, where they were planned.`,
          nowIso,
          fetchImpl,
        });
      }
      return jsonResponse(request, env, { ok: true, date, wasPlanned });
    }

    if (method === 'POST' && path === '/api/cells/received') {
      if (!me) throw new RuleError('NOT_JOINED', 'Join your department first.', 403);
      const { date } = await readJson(request);
      const existing = await getCell(env.DB, me.id, date);
      const currentState = existing ? existing.state : 'none';
      checkTransition({ action: 'mark_received', currentState, date, today, actorRole: 'nsman' });
      const cell = await markReceivedDb(env.DB, { nsmanId: me.id, date, nowIso });
      await writeLog(env.DB, { at: nowIso, actor: me.name, action: 'mark_received', detail: `${me.dept} ${date}` });
      return jsonResponse(request, env, { ok: true, cell });
    }

    if (method === 'POST' && path === '/api/cells/cancel') {
      if (!me) throw new RuleError('NOT_JOINED', 'Join your department first.', 403);
      const { date, reason } = await readJson(request);
      const existing = await getCell(env.DB, me.id, date);
      const currentState = existing ? existing.state : 'none';
      const { reason: cleanReason } = checkTransition({
        action: 'cancel',
        currentState,
        date,
        today,
        actorRole: 'nsman',
        reason,
      });
      const cell = await cancelSaf100Db(env.DB, {
        nsmanId: me.id,
        date,
        actorName: me.name,
        reason: cleanReason,
        nowIso,
      });
      await writeLog(env.DB, {
        at: nowIso,
        actor: me.name,
        action: 'cancel',
        detail: `${me.dept} ${date}${cleanReason ? ': ' + cleanReason : ''}`,
      });
      const deptPlanners = await getDeptPlanners(env.DB, me.dept);
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: deptPlanners.map((p) => ({ tgId: p.tg_id, label: p.name })),
        text: `${me.name} cancelled SAF100 for ${fmtDate(date)}${cleanReason ? ': ' + cleanReason : '.'} The day goes back to their ${CAP}.`,
        nowIso,
        fetchImpl,
      });
      return jsonResponse(request, env, { ok: true, cell });
    }

    // ---- Planner cell actions ----

    if (method === 'POST' && path === '/api/cells/plan') {
      const { nsmanId, date } = await readJson(request);
      const target = await getNsmanById(env.DB, nsmanId);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      const existing = await getCell(env.DB, target.id, date);
      const currentState = existing ? existing.state : 'none';
      checkTransition({
        action: 'plan',
        currentState,
        date,
        today,
        actorRole: 'planner',
        actorDepts: plannerDepts,
        isAdmin,
        targetDept: target.dept,
      });
      const actor = actorFor(target.dept);
      const cell = await planCellDb(env.DB, { nsmanId: target.id, dept: target.dept, date, actorName: actor });
      const flight = await getFlightDay(env.DB, target.dept, date);
      const info = fmtFlightInfo(flight);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'plan',
        detail: `${target.name} (${target.dept}) ${date}`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: target.tg_id, label: target.name }],
        text: `You're planned for ${fmtDate(date)}. ${target.dept}${info ? ', ' + info : ''}.`,
        nowIso,
        fetchImpl,
      });
      return jsonResponse(request, env, { ok: true, cell });
    }

    if (method === 'POST' && path === '/api/cells/plan-batch') {
      const { nsmanIds, date } = await readJson(request);
      if (!Array.isArray(nsmanIds) || nsmanIds.length === 0) {
        throw new RuleError('BAD_INPUT', 'Select at least one NSman to plan.', 400);
      }
      const uniqueIds = [...new Set(nsmanIds.map(Number))];
      const targets = [];
      for (const id of uniqueIds) {
        const target = await getNsmanById(env.DB, id);
        if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
        const existing = await getCell(env.DB, target.id, date);
        const currentState = existing ? existing.state : 'none';
        checkTransition({
          action: 'plan',
          currentState,
          date,
          today,
          actorRole: 'planner',
          actorDepts: plannerDepts,
          isAdmin,
          targetDept: target.dept,
        });
        targets.push(target);
      }
      const plannedCells = [];
      for (const target of targets) {
        const actor = actorFor(target.dept);
        const cell = await planCellDb(env.DB, { nsmanId: target.id, dept: target.dept, date, actorName: actor });
        plannedCells.push(cell);
        const flight = await getFlightDay(env.DB, target.dept, date);
        const info = fmtFlightInfo(flight);
        await writeLog(env.DB, {
          at: nowIso,
          actor,
          action: 'plan',
          detail: `${target.name} (${target.dept}) ${date}`,
        });
        notifyInBackground({
          ctx,
          db: env.DB,
          botToken: env.BOT_TOKEN,
          recipients: [{ tgId: target.tg_id, label: target.name }],
          text: `You're planned for ${fmtDate(date)}. ${target.dept}${info ? ', ' + info : ''}.`,
          nowIso,
          fetchImpl,
        });
      }
      return jsonResponse(request, env, { ok: true, cells: plannedCells });
    }

    if (method === 'POST' && path === '/api/cells/unplan') {
      const { nsmanId, date } = await readJson(request);
      const target = await getNsmanById(env.DB, nsmanId);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      const existing = await getCell(env.DB, target.id, date);
      const currentState = existing ? existing.state : 'none';
      checkTransition({
        action: 'unplan',
        currentState,
        date,
        today,
        actorRole: 'planner',
        actorDepts: plannerDepts,
        isAdmin,
        targetDept: target.dept,
      });
      const actor = actorFor(target.dept);
      const cell = await unplanCellDb(env.DB, { nsmanId: target.id, date });
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'unplan',
        detail: `${target.name} (${target.dept}) ${date}`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: target.tg_id, label: target.name }],
        text: `You're no longer planned for ${fmtDate(date)}. You're still marked available.`,
        nowIso,
        fetchImpl,
      });
      return jsonResponse(request, env, { ok: true, cell });
    }

    if (method === 'POST' && path === '/api/cells/send') {
      const { nsmanId, date } = await readJson(request);
      const target = await getNsmanById(env.DB, nsmanId);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      const existing = await getCell(env.DB, target.id, date);
      const currentState = existing ? existing.state : 'none';
      checkTransition({
        action: 'send',
        currentState,
        date,
        today,
        actorRole: 'planner',
        actorDepts: plannerDepts,
        isAdmin,
        targetDept: target.dept,
        usedInWorkYear: 0, // Enforced atomically in SQL below
      });
      const actor = actorFor(target.dept);
      const cell = await sendSaf100AtomicDb(env.DB, { nsmanId: target.id, date, nowIso });
      const flight = await getFlightDay(env.DB, target.dept, date);
      const info = fmtFlightInfo(flight);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'send_saf100',
        detail: `${target.name} (${target.dept}) ${date}`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: target.tg_id, label: target.name }],
        text: `SAF100 sent for ${fmtDate(date)}. ${target.dept}${info ? ', ' + info : ''}. Open the app to confirm you received it.`,
        openUrl: appUrlFor(env),
        nowIso,
        fetchImpl,
      });
      return jsonResponse(request, env, { ok: true, cell });
    }

    if (method === 'POST' && path === '/api/cells/withdraw') {
      const { nsmanId, date, reason } = await readJson(request);
      const target = await getNsmanById(env.DB, nsmanId);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      const existing = await getCell(env.DB, target.id, date);
      const currentState = existing ? existing.state : 'none';
      const { reason: cleanReason } = checkTransition({
        action: 'withdraw',
        currentState,
        date,
        today,
        actorRole: 'planner',
        actorDepts: plannerDepts,
        isAdmin,
        targetDept: target.dept,
        reason,
      });
      const actor = actorFor(target.dept);
      const cell = await withdrawSaf100Db(env.DB, {
        nsmanId: target.id,
        date,
        actorName: actor,
        reason: cleanReason,
        nowIso,
      });
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'withdraw_saf100',
        detail: `${target.name} (${target.dept}) ${date}${cleanReason ? ': ' + cleanReason : ''}`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: target.tg_id, label: target.name }],
        text: `Your SAF100 for ${fmtDate(date)} was withdrawn${cleanReason ? ': ' + cleanReason : '.'} The day goes back to your ${CAP}.`,
        nowIso,
        fetchImpl,
      });
      return jsonResponse(request, env, { ok: true, cell });
    }

    // ---- Flight days ----

    if (method === 'POST' && path === '/api/flights') {
      const body = await readJson(request);
      const dept = validateDept(body.dept);
      const date = body.date;
      canEditFlightDay({ actorDepts: plannerDepts, isAdmin, dept, date, today, removing: false });
      const type = validateFlightText(body.type, 'Flight type');
      const time = validateFlightText(body.time, 'Flight time');
      const flightDay = await upsertFlightDayDb(env.DB, { dept, date, type, time });
      const actor = actorFor(dept);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'set_flight_day',
        detail: `${dept} ${date}${type || time ? ' (' + [type, time].filter(Boolean).join(' · ') + ')' : ''}`,
      });
      return jsonResponse(request, env, { ok: true, flightDay });
    }

    if (method === 'DELETE' && path === '/api/flights') {
      const body = await readJson(request);
      const dept = validateDept(body.dept);
      const date = body.date;
      canEditFlightDay({ actorDepts: plannerDepts, isAdmin, dept, date, today, removing: true });
      await deleteFlightDayDb(env.DB, { dept, date });
      const actor = actorFor(dept);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'remove_flight_day',
        detail: `${dept} ${date}`,
      });
      return jsonResponse(request, env, { ok: true, dept, date });
    }

    // ---- NSman management ----

    const nsmanMatch = path.match(/^\/api\/nsmen\/(\d+)$/);
    if (nsmanMatch && method === 'PATCH') {
      const id = Number(nsmanMatch[1]);
      const target = await getNsmanById(env.DB, id);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      assertPlannerForDept(plannerDepts, target.dept, { isAdmin });
      const body = await readJson(request);
      const nextName = body.name !== undefined ? validateName(body.name) : target.name;
      const nextDept = body.dept !== undefined ? validateDept(body.dept) : target.dept;
      const updated = await updateNsmanDb(env.DB, { id, name: nextName, dept: nextDept, today });
      const actor = actorFor(target.dept);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'edit_nsman',
        detail: `${target.name} (${target.dept}) -> ${nextName} (${nextDept})`,
      });
      return jsonResponse(request, env, { ok: true, nsman: updated });
    }

    if (nsmanMatch && method === 'DELETE') {
      const id = Number(nsmanMatch[1]);
      const target = await getNsmanById(env.DB, id);
      if (!target) throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
      assertPlannerForDept(plannerDepts, target.dept, { isAdmin });
      await removeNsmanDb(env.DB, { id });
      const actor = actorFor(target.dept);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'remove_nsman',
        detail: `${target.name} (${target.dept})`,
      });
      return jsonResponse(request, env, { ok: true, id });
    }

    // ---- Planners management ----

    if (method === 'POST' && path === '/api/planners') {
      const body = await readJson(request);
      const dept = validateDept(body.dept);
      const existing = await getDeptPlanners(env.DB, dept);
      const validated = canAddPlanner({
        actorDepts: plannerDepts,
        isAdmin,
        dept,
        existingPlannersInDept: existing.map((p) => p.tg_id),
        targetTgId: body.tgId,
        targetName: body.name,
      });
      await addPlannerDb(env.DB, validated);
      const actor = actorFor(dept);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'add_planner',
        detail: `${validated.name} (TG ${validated.tgId}) added as ${dept} planner`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: validated.tgId, label: validated.name }],
        text: `You're now a planner for ${dept}.`,
        openUrl: appUrlFor(env),
        nowIso,
        fetchImpl,
      });
      const planners = isAdmin
        ? await getAllPlanners(env.DB)
        : await getPlannersForDepts(env.DB, plannerDepts);
      return jsonResponse(request, env, { ok: true, planners });
    }

    if (method === 'DELETE' && (path === '/api/planners' || path === '/api/planners/self')) {
      const body = await readJson(request);
      const dept = validateDept(body.dept);
      const targetTgId =
        path === '/api/planners/self' || body.tgId == null
          ? String(tgUser.id)
          : String(body.tgId).trim();
      const existing = await getDeptPlanners(env.DB, dept);
      canRemovePlanner({
        isAdmin,
        actorTgId: tgUser.id,
        targetTgId,
        dept,
        existingPlannersInDept: existing.map((p) => p.tg_id),
      });
      const targetRow = existing.find((p) => String(p.tg_id) === targetTgId);
      const targetName = (targetRow && targetRow.name) || targetTgId;

      if (isAdmin) {
        await removePlannerAdminDb(env.DB, { tgId: targetTgId, dept });
      } else {
        await removeSelfPlannerAtomicDb(env.DB, { tgId: tgUser.id, dept });
      }

      const actor = actorFor(dept);
      const isSelf = String(targetTgId) === String(tgUser.id);
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'remove_planner',
        detail: isSelf
          ? `${actor} stepped down as ${dept} planner`
          : `${targetName} (TG ${targetTgId}) removed from ${dept} planners`,
      });

      if (!isSelf) {
        notifyInBackground({
          ctx,
          db: env.DB,
          botToken: env.BOT_TOKEN,
          recipients: [{ tgId: targetTgId, label: targetName }],
          text: `You're no longer a planner for ${dept}.`,
          nowIso,
          fetchImpl,
        });
      }

      const nextOwnDepts = await getPlannerDepts(env.DB, tgUser.id);
      const nextEffectiveDepts = effectivePlannerDepts({ isAdmin, plannerDepts: nextOwnDepts });
      const planners = isAdmin
        ? await getAllPlanners(env.DB)
        : await getPlannersForDepts(env.DB, nextEffectiveDepts);
      return jsonResponse(request, env, { ok: true, plannerDepts: nextEffectiveDepts, planners });
    }

    // ---- Highest Admin rename & handover ----

    if (method === 'PATCH' && path === '/api/admin/me') {
      if (!isAdmin) {
        throw new RuleError('FORBIDDEN', 'Only the Highest Admin can update this name.', 403);
      }
      const body = await readJson(request);
      const nextName = validateName(body.name);
      const oldName = (adminRow && adminRow.name) || '';
      const updatedAdmin = await renameAdminDb(env.DB, {
        currentTgId: tgUser.id,
        newName: nextName,
        nowIso,
      });
      await writeLog(env.DB, {
        at: nowIso,
        actor: nextName,
        action: 'rename_highest_admin',
        detail: `${oldName} -> ${nextName}`,
      });
      const data = await loadInitData(env.DB, tgUser.id, updatedAdmin);
      return jsonResponse(request, env, {
        ok: true,
        today,
        workYear: workYearOf(today),
        maxDate: maxMarkingDate(today),
        cap: CAP,
        departments: DEPARTMENTS,
        tgUser: { id: tgUser.id, username: tgUser.username },
        ...data,
      });
    }

    if (method === 'POST' && path === '/api/admin/pass') {
      const body = await readJson(request);
      const nextAdmin = passHighestAdmin({
        currentAdminTgId: adminRow && adminRow.tg_id,
        actorTgId: tgUser.id,
        newAdminTgId: body.tgId,
        newAdminName: body.name,
      });
      const updatedAdmin = await passAdminDb(env.DB, {
        currentTgId: tgUser.id,
        newTgId: nextAdmin.tg_id,
        newName: nextAdmin.name,
        nowIso,
      });
      const actor = actorFor();
      await writeLog(env.DB, {
        at: nowIso,
        actor,
        action: 'pass_highest_admin',
        detail: `Passed Highest Admin to ${nextAdmin.name} (TG ${nextAdmin.tg_id})`,
      });
      notifyInBackground({
        ctx,
        db: env.DB,
        botToken: env.BOT_TOKEN,
        recipients: [{ tgId: nextAdmin.tg_id, label: nextAdmin.name }],
        text: "You're now the Highest Admin of Enforcer NSMEN.",
        openUrl: appUrlFor(env),
        nowIso,
        fetchImpl,
      });
      const data = await loadInitData(env.DB, tgUser.id, updatedAdmin);
      return jsonResponse(request, env, {
        ok: true,
        today,
        workYear: workYearOf(today),
        maxDate: maxMarkingDate(today),
        cap: CAP,
        departments: DEPARTMENTS,
        tgUser: { id: tgUser.id, username: tgUser.username },
        ...data,
      });
    }

    // ---- CSV Export ----

    if (method === 'POST' && path === '/api/export-link') {
      if (plannerDepts.length === 0) {
        throw new RuleError('FORBIDDEN', 'Only planners can export CSV.', 403);
      }
      const body = await readJson(request);
      const wy = body.workYear != null ? Number(body.workYear) : workYearOf(today);
      workYearBounds(wy);
      const deptParam = body.dept || 'all';
      let dept = 'all';
      let depts = plannerDepts;
      if (deptParam && deptParam !== 'all') {
        assertPlannerForDept(plannerDepts, deptParam, { isAdmin });
        dept = deptParam;
        depts = [deptParam];
      }
      const exp = nowSec + EXPORT_TOKEN_TTL_SEC;
      const token = await createExportToken(
        { tgId: tgUser.id, dept, workYear: wy, exp },
        env.BOT_TOKEN,
      );
      const filename = exportFilename(wy, depts);
      return jsonResponse(request, env, {
        ok: true,
        url: `/api/export.csv?token=${encodeURIComponent(token)}`,
        filename,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    }

    if (method === 'GET' && path === '/api/export') {
      if (plannerDepts.length === 0) {
        throw new RuleError('FORBIDDEN', 'Only planners can export CSV.', 403);
      }
      const wyParam = url.searchParams.get('workYear');
      const wy = wyParam ? Number(wyParam) : workYearOf(today);
      const { start, end } = workYearBounds(wy);
      const deptParam = url.searchParams.get('dept');
      let depts = plannerDepts;
      if (deptParam && deptParam !== 'all') {
        assertPlannerForDept(plannerDepts, deptParam, { isAdmin });
        depts = [deptParam];
      }
      const { duties, logs } = await getExportData(env.DB, { depts, wyStart: start, wyEnd: end });
      const csv = buildExportCsv({ duties, logs });
      const filename = exportFilename(wy, depts);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          ...corsHeaders(request, env),
        },
      });
    }

    return jsonResponse(request, env, { ok: false, code: 'NOT_FOUND', error: 'Not found.' }, 404);
  } catch (err) {
    if (err instanceof RuleError) {
      return jsonResponse(request, env, { ok: false, code: err.code, error: err.message }, err.status || 400);
    }
    return jsonResponse(request, env, { ok: false, code: 'INTERNAL', error: 'Something went wrong. Try again.' }, 500);
  }
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
