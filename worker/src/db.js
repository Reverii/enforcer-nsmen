// D1 database access and race-safe conditional writes for Enforcer NSMEN.

import {
  CAP,
  RuleError,
  effectivePlannerDepts,
  isHighestAdmin,
  workYearBounds,
  workYearLabel,
  workYearOf,
} from './rules.js';

export async function writeLog(db, { at, actor, action, detail = '' }) {
  await db
    .prepare('INSERT INTO log (at, actor, action, detail) VALUES (?, ?, ?, ?)')
    .bind(at, String(actor), String(action), String(detail))
    .run();
}

export async function getAdmin(db) {
  return db.prepare('SELECT id, tg_id, name, updated_at FROM admin WHERE id = 1').first();
}

export async function ensureHighestAdmin(db, tgUser, highestAdminTgId, nowIso) {
  const existing = await getAdmin(db);
  if (existing) return existing;
  if (!highestAdminTgId || !tgUser || String(tgUser.id) !== String(highestAdminTgId)) {
    return null;
  }

  const me = await getNsmanByTgId(db, tgUser.id);
  const seedName =
    (me && me.name) ||
    (tgUser.firstName ? tgUser.firstName.trim().toUpperCase() : '') ||
    (tgUser.username ? '@' + tgUser.username : 'HIGHEST ADMIN');

  const res = await db
    .prepare('INSERT OR IGNORE INTO admin (id, tg_id, name, updated_at) VALUES (1, ?, ?, ?)')
    .bind(String(tgUser.id), seedName, nowIso)
    .run();

  if (res.meta && res.meta.changes === 1) {
    await writeLog(db, {
      at: nowIso,
      actor: seedName,
      action: 'highest_admin_seed',
      detail: `Seeded Highest Admin ${seedName} (TG ${tgUser.id})`,
    });
  }
  return getAdmin(db);
}

export async function passAdminDb(db, { currentTgId, newTgId, newName, nowIso }) {
  const res = await db
    .prepare('UPDATE admin SET tg_id = ?, name = ?, updated_at = ? WHERE id = 1 AND tg_id = ?')
    .bind(String(newTgId), newName, nowIso, String(currentTgId))
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('FORBIDDEN', 'Only the Highest Admin can pass on this role.', 403);
  }
  return getAdmin(db);
}

export async function renameAdminDb(db, { currentTgId, newName, nowIso }) {
  const res = await db
    .prepare('UPDATE admin SET name = ?, updated_at = ? WHERE id = 1 AND tg_id = ?')
    .bind(newName, nowIso, String(currentTgId))
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('FORBIDDEN', 'Only the Highest Admin can update this name.', 403);
  }
  return getAdmin(db);
}

export async function getNsmanByTgId(db, tgId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT id, name, dept, tg_id, tg_username, active, joined_at FROM nsmen WHERE tg_id = ?'
    : 'SELECT id, name, dept, tg_id, tg_username, active, joined_at FROM nsmen WHERE tg_id = ? AND active = 1';
  return db.prepare(sql).bind(String(tgId)).first();
}

export async function getNsmanById(db, id, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT id, name, dept, tg_id, tg_username, active, joined_at FROM nsmen WHERE id = ?'
    : 'SELECT id, name, dept, tg_id, tg_username, active, joined_at FROM nsmen WHERE id = ? AND active = 1';
  return db.prepare(sql).bind(Number(id)).first();
}

export async function getUserPlannerRows(db, tgId) {
  const res = await db
    .prepare(
      `SELECT p.dept, p.name FROM planners p
       JOIN departments d ON d.name = p.dept
       WHERE p.tg_id = ?
       ORDER BY d.sort_order`,
    )
    .bind(String(tgId))
    .all();
  return res.results || [];
}

export async function getPlannerDepts(db, tgId) {
  const rows = await getUserPlannerRows(db, tgId);
  return rows.map((r) => r.dept);
}

export async function getActiveNsmenInDept(db, dept) {
  const res = await db
    .prepare('SELECT id, name, dept, tg_id FROM nsmen WHERE active = 1 AND dept = ? ORDER BY name')
    .bind(dept)
    .all();
  return res.results || [];
}

export async function getFlightDaysInMonth(db, dept, month) {
  const res = await db
    .prepare('SELECT id, dept, date, type, time FROM flight_days WHERE dept = ? AND date LIKE ? ORDER BY date')
    .bind(dept, `${month}-%`)
    .all();
  return res.results || [];
}

// Latest flight broadcast per department and month, read from the log
// (detail is written as "<Dept> <YYYY-MM> to <n> NSmen").
export async function getLatestBroadcasts(db, depts) {
  if (!depts || !depts.length) return [];
  const res = await db
    .prepare("SELECT at, actor, detail FROM log WHERE action = 'broadcast_flights' ORDER BY id DESC LIMIT 500")
    .all();
  const seen = new Set();
  const out = [];
  for (const row of res.results || []) {
    const m = /^(\S+) (\d{4}-\d{2})\b/.exec(row.detail || '');
    if (!m || !depts.includes(m[1])) continue;
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dept: m[1], month: m[2], at: row.at, actor: row.actor });
  }
  return out;
}

export async function getDeptPlanners(db, dept) {
  const res = await db
    .prepare(
      `SELECT p.tg_id, p.dept,
         CASE WHEN p.name <> '' THEN p.name ELSE COALESCE(n.name, p.tg_id) END AS name,
         COALESCE(n.tg_username, '') AS tg_username
       FROM planners p
       LEFT JOIN nsmen n ON n.tg_id = p.tg_id AND n.active = 1
       WHERE p.dept = ?
       ORDER BY name`,
    )
    .bind(dept)
    .all();
  return res.results || [];
}

export async function getPlannersForDepts(db, depts) {
  if (!depts.length) return [];
  const ph = depts.map(() => '?').join(', ');
  const res = await db
    .prepare(
      `SELECT p.tg_id, p.dept,
         CASE WHEN p.name <> '' THEN p.name ELSE COALESCE(n.name, p.tg_id) END AS name,
         COALESCE(n.tg_username, '') AS tg_username
       FROM planners p
       JOIN departments d ON d.name = p.dept
       LEFT JOIN nsmen n ON n.tg_id = p.tg_id AND n.active = 1
       WHERE p.dept IN (${ph})
       ORDER BY d.sort_order, name`,
    )
    .bind(...depts)
    .all();
  return res.results || [];
}

export async function getAllPlanners(db) {
  const res = await db
    .prepare(
      `SELECT p.tg_id, p.dept,
         CASE WHEN p.name <> '' THEN p.name ELSE COALESCE(n.name, p.tg_id) END AS name,
         COALESCE(n.tg_username, '') AS tg_username
       FROM planners p
       JOIN departments d ON d.name = p.dept
       LEFT JOIN nsmen n ON n.tg_id = p.tg_id AND n.active = 1
       ORDER BY d.sort_order, name`,
    )
    .all();
  return res.results || [];
}

export async function getCell(db, nsmanId, date) {
  return db
    .prepare(
      `SELECT id, nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason
       FROM cells WHERE nsman_id = ? AND date = ?`,
    )
    .bind(Number(nsmanId), date)
    .first();
}

export async function getCellsInRange(db, nsmanId, minDate, maxDate) {
  const res = await db
    .prepare(
      `SELECT date, state FROM cells
       WHERE nsman_id = ? AND date >= ? AND date <= ?`,
    )
    .bind(Number(nsmanId), minDate, maxDate)
    .all();
  return res.results || [];
}

export async function getFlightDay(db, dept, date) {
  return db
    .prepare('SELECT id, dept, date, type, time FROM flight_days WHERE dept = ? AND date = ?')
    .bind(dept, date)
    .first();
}

export async function countSaf100Used(db, nsmanId, wy) {
  const { start, end } = workYearBounds(wy);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM cells
       WHERE nsman_id = ? AND state IN ('sent', 'received') AND date >= ? AND date <= ?`,
    )
    .bind(Number(nsmanId), start, end)
    .first();
  return Number((row && row.n) || 0);
}

export async function loadInitData(db, tgId, adminRow = undefined) {
  const [me, myPlannerRows, resolvedAdmin] = await Promise.all([
    getNsmanByTgId(db, tgId),
    getUserPlannerRows(db, tgId),
    adminRow === undefined ? getAdmin(db) : Promise.resolve(adminRow),
  ]);

  const isAdmin = isHighestAdmin(resolvedAdmin, tgId);
  const ownPlannerDepts = myPlannerRows.map((r) => r.dept);
  const plannerDepts = effectivePlannerDepts({ isAdmin, plannerDepts: ownPlannerDepts });

  const namedRow = myPlannerRows.find((r) => r.name);
  const plannerName =
    (isAdmin && resolvedAdmin && resolvedAdmin.name) ||
    (namedRow && namedRow.name) ||
    (me && me.name) ||
    '';

  const deptSet = new Set(plannerDepts);
  if (me) deptSet.add(me.dept);
  const relevantDepts = [...deptSet];

  let nsmen = [];
  let flightDays = [];
  let cells = [];
  let planners = [];
  let broadcasts = [];

  if (plannerDepts.length > 0) {
    const phPlan = plannerDepts.map(() => '?').join(', ');
    const phAll = relevantDepts.map(() => '?').join(', ');

    const [nsmenRes, flightsRes, plannersList] = await Promise.all([
      db
        .prepare(
          `SELECT id, name, dept, tg_id, tg_username, active, joined_at
           FROM nsmen WHERE active = 1 AND dept IN (${phPlan})
           ORDER BY name`,
        )
        .bind(...plannerDepts)
        .all(),
      db
        .prepare(
          `SELECT id, dept, date, type, time
           FROM flight_days WHERE dept IN (${phAll})
           ORDER BY date`,
        )
        .bind(...relevantDepts)
        .all(),
      isAdmin ? getAllPlanners(db) : getPlannersForDepts(db, plannerDepts),
    ]);

    nsmen = nsmenRes.results || [];
    flightDays = flightsRes.results || [];
    planners = plannersList;
    broadcasts = await getLatestBroadcasts(db, plannerDepts);

    const nsmanIds = new Set(nsmen.map((n) => n.id));
    if (me) nsmanIds.add(me.id);
    const idList = [...nsmanIds];
    if (idList.length > 0) {
      const phIds = idList.map(() => '?').join(', ');
      const cellsRes = await db
        .prepare(
          `SELECT id, nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason
           FROM cells WHERE nsman_id IN (${phIds})
           ORDER BY date`,
        )
        .bind(...idList)
        .all();
      cells = cellsRes.results || [];
    }
  } else if (me) {
    const [flightsRes, cellsRes] = await Promise.all([
      db
        .prepare('SELECT id, dept, date, type, time FROM flight_days WHERE dept = ? ORDER BY date')
        .bind(me.dept)
        .all(),
      db
        .prepare(
          `SELECT id, nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason
           FROM cells WHERE nsman_id = ? ORDER BY date`,
        )
        .bind(me.id)
        .all(),
    ]);
    flightDays = flightsRes.results || [];
    cells = cellsRes.results || [];
  }

  return {
    me: me || null,
    isAdmin,
    admin: isAdmin && resolvedAdmin ? { tg_id: resolvedAdmin.tg_id, name: resolvedAdmin.name } : null,
    plannerName,
    plannerDepts,
    nsmen,
    flightDays,
    cells,
    planners,
    broadcasts,
  };
}

export async function joinNsman(db, { tgId, username, name, dept, nowIso }) {
  const existing = await getNsmanByTgId(db, tgId, { includeInactive: true });
  if (existing && Number(existing.active) === 1) {
    throw new RuleError('ALREADY_JOINED', 'Your Telegram account has already joined.', 409);
  }
  if (existing && Number(existing.active) === 0) {
    await db
      .prepare('UPDATE nsmen SET name = ?, dept = ?, tg_username = ?, active = 1, joined_at = ? WHERE id = ?')
      .bind(name, dept, username || '', nowIso, existing.id)
      .run();
    return getNsmanById(db, existing.id);
  }
  const res = await db
    .prepare(
      'INSERT INTO nsmen (name, dept, tg_id, tg_username, active, joined_at) VALUES (?, ?, ?, ?, 1, ?)',
    )
    .bind(name, dept, String(tgId), username || '', nowIso)
    .run();
  return getNsmanById(db, res.meta.last_row_id);
}

export async function markAvailableDb(db, { nsmanId, dept, date, currentState }) {
  if (currentState === 'none') {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO cells
         (nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason)
         VALUES (?, ?, 'available', ?, '', '', '', '', '', '')`,
      )
      .bind(Number(nsmanId), date, dept)
      .run();
    if (!res.meta || res.meta.changes !== 1) {
      throw new RuleError('CONFLICT', 'That day changed while you tapped. Refresh and try again.', 409);
    }
  } else {
    const res = await db
      .prepare(
        `UPDATE cells
         SET state = 'available', dept = ?, planned_by = '', sent_at = '', received_at = '', ended_at = '', ended_by = '', reason = ''
         WHERE nsman_id = ? AND date = ? AND state IN ('cancelled', 'withdrawn')`,
      )
      .bind(dept, Number(nsmanId), date)
      .run();
    if (!res.meta || res.meta.changes !== 1) {
      throw new RuleError('CONFLICT', 'That day changed while you tapped. Refresh and try again.', 409);
    }
  }
  return getCell(db, nsmanId, date);
}

export async function unmarkAvailableDb(db, { nsmanId, date, expectedState }) {
  const res = await db
    .prepare('DELETE FROM cells WHERE nsman_id = ? AND date = ? AND state = ?')
    .bind(Number(nsmanId), date, expectedState)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'That day changed while you tapped. Refresh and try again.', 409);
  }
}

export async function markAvailableBatchDb(db, { nsmanId, dept, items }) {
  if (!items || !items.length) return { done: [], conflicted: [] };
  const id = Number(nsmanId);
  const stmts = items.map((item) => {
    if (item.currentState === 'none') {
      return db
        .prepare(
          `INSERT OR IGNORE INTO cells
           (nsman_id, date, state, dept, planned_by, sent_at, received_at, ended_at, ended_by, reason)
           VALUES (?, ?, 'available', ?, '', '', '', '', '', '')`,
        )
        .bind(id, item.date, dept);
    }
    return db
      .prepare(
        `UPDATE cells
         SET state = 'available', dept = ?, planned_by = '', sent_at = '', received_at = '', ended_at = '', ended_by = '', reason = ''
         WHERE nsman_id = ? AND date = ? AND state IN ('cancelled', 'withdrawn')`,
      )
      .bind(dept, id, item.date);
  });

  const results = await db.batch(stmts);
  const done = [];
  const conflicted = [];
  for (let i = 0; i < items.length; i++) {
    const r = results[i];
    if (r && r.meta && r.meta.changes === 1) {
      done.push(items[i].date);
    } else {
      conflicted.push(items[i].date);
    }
  }
  return { done, conflicted };
}

export async function unmarkAvailableBatchDb(db, { nsmanId, items }) {
  if (!items || !items.length) return { done: [], unplannedDates: [], conflicted: [] };
  const id = Number(nsmanId);
  const stmts = items.map((item) =>
    db
      .prepare('DELETE FROM cells WHERE nsman_id = ? AND date = ? AND state = ?')
      .bind(id, item.date, item.currentState),
  );

  const results = await db.batch(stmts);
  const done = [];
  const unplannedDates = [];
  const conflicted = [];
  for (let i = 0; i < items.length; i++) {
    const r = results[i];
    if (r && r.meta && r.meta.changes === 1) {
      done.push(items[i].date);
      if (items[i].wasPlanned) unplannedDates.push(items[i].date);
    } else {
      conflicted.push(items[i].date);
    }
  }
  return { done, unplannedDates, conflicted };
}

export async function markReceivedDb(db, { nsmanId, date, nowIso }) {
  const res = await db
    .prepare("UPDATE cells SET state = 'received', received_at = ? WHERE nsman_id = ? AND date = ? AND state = 'sent'")
    .bind(nowIso, Number(nsmanId), date)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'Only a sent SAF100 can be marked received.', 409);
  }
  return getCell(db, nsmanId, date);
}

export async function cancelSaf100Db(db, { nsmanId, date, actorName, reason, nowIso }) {
  const res = await db
    .prepare(
      `UPDATE cells
       SET state = 'cancelled', ended_at = ?, ended_by = ?, reason = ?
       WHERE nsman_id = ? AND date = ? AND state IN ('sent', 'received')`,
    )
    .bind(nowIso, actorName, reason, Number(nsmanId), date)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'That SAF100 changed while you tapped.', 409);
  }
  return getCell(db, nsmanId, date);
}

export async function planCellDb(db, { nsmanId, dept, date, actorName }) {
  const res = await db
    .prepare(
      `UPDATE cells
       SET state = 'planned', dept = ?, planned_by = ?
       WHERE nsman_id = ? AND date = ? AND state = 'available'`,
    )
    .bind(dept, actorName, Number(nsmanId), date)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'That day is no longer available to plan.', 409);
  }
  return getCell(db, nsmanId, date);
}

export async function unplanCellDb(db, { nsmanId, date }) {
  const res = await db
    .prepare("UPDATE cells SET state = 'available', planned_by = '' WHERE nsman_id = ? AND date = ? AND state = 'planned'")
    .bind(Number(nsmanId), date)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'That day is no longer planned.', 409);
  }
  return getCell(db, nsmanId, date);
}

// Race-safe atomic 40-day cap check and 'sent' write in ONE conditional SQL statement.
export async function sendSaf100AtomicDb(db, { nsmanId, date, nowIso }) {
  const wy = workYearOf(date);
  const { start, end } = workYearBounds(wy);
  const res = await db
    .prepare(
      `UPDATE cells
       SET state = 'sent', sent_at = ?
       WHERE nsman_id = ? AND date = ? AND state = 'planned'
         AND (
           SELECT COUNT(*) FROM cells
           WHERE nsman_id = ?
             AND state IN ('sent', 'received')
             AND date >= ? AND date <= ?
         ) < ?`,
    )
    .bind(nowIso, Number(nsmanId), date, Number(nsmanId), start, end, CAP)
    .run();

  if (!res.meta || res.meta.changes !== 1) {
    const current = await getCell(db, nsmanId, date);
    if (!current || current.state !== 'planned') {
      throw new RuleError('CONFLICT', 'Only a planned day can be marked SAF100 sent.', 409);
    }
    const used = await countSaf100Used(db, nsmanId, wy);
    if (used >= CAP) {
      throw new RuleError(
        'CAP_REACHED',
        `Already at ${CAP} of ${CAP} SAF100 days in ${workYearLabel(wy)}. SAF100 cannot be sent.`,
        409,
      );
    }
    throw new RuleError('CONFLICT', 'Could not send SAF100. Refresh and try again.', 409);
  }

  return getCell(db, nsmanId, date);
}

export async function withdrawSaf100Db(db, { nsmanId, date, actorName, reason, nowIso }) {
  const res = await db
    .prepare(
      `UPDATE cells
       SET state = 'withdrawn', ended_at = ?, ended_by = ?, reason = ?
       WHERE nsman_id = ? AND date = ? AND state IN ('sent', 'received')`,
    )
    .bind(nowIso, actorName, reason, Number(nsmanId), date)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('CONFLICT', 'That SAF100 changed while you tapped.', 409);
  }
  return getCell(db, nsmanId, date);
}

export async function upsertFlightDayDb(db, { dept, date, type, time }) {
  await db
    .prepare(
      `INSERT INTO flight_days (dept, date, type, time)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (dept, date) DO UPDATE SET type = excluded.type, time = excluded.time`,
    )
    .bind(dept, date, type, time)
    .run();
  return getFlightDay(db, dept, date);
}

export async function deleteFlightDayDb(db, { dept, date }) {
  await db.prepare('DELETE FROM flight_days WHERE dept = ? AND date = ?').bind(dept, date).run();
}

export async function updateNsmanDb(db, { id, name, dept, today }) {
  const stmts = [
    db.prepare('UPDATE nsmen SET name = ?, dept = ? WHERE id = ? AND active = 1').bind(name, dept, Number(id)),
    db
      .prepare("UPDATE cells SET dept = ? WHERE nsman_id = ? AND state = 'available' AND date >= ?")
      .bind(dept, Number(id), today),
  ];
  await db.batch(stmts);
  return getNsmanById(db, id);
}

export async function removeNsmanDb(db, { id }) {
  const res = await db
    .prepare('UPDATE nsmen SET active = 0 WHERE id = ? AND active = 1')
    .bind(Number(id))
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('NOT_FOUND', 'NSman not found.', 404);
  }
}

export async function addPlannerDb(db, { tgId, name, dept }) {
  const res = await db
    .prepare('INSERT OR IGNORE INTO planners (tg_id, dept, name) VALUES (?, ?, ?)')
    .bind(String(tgId), dept, name)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('ALREADY_PLANNER', `Already a planner for ${dept}.`, 409);
  }
}

// Highest Admin can remove any planner, including the last planner of a department.
export async function removePlannerAdminDb(db, { tgId, dept }) {
  const res = await db
    .prepare('DELETE FROM planners WHERE tg_id = ? AND dept = ?')
    .bind(String(tgId), dept)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    throw new RuleError('NOT_FOUND', `That person is not a planner for ${dept}.`, 404);
  }
}

// Race-safe atomic check that at least one other planner remains in this department.
export async function removeSelfPlannerAtomicDb(db, { tgId, dept }) {
  const res = await db
    .prepare(
      `DELETE FROM planners
       WHERE tg_id = ? AND dept = ?
         AND (SELECT COUNT(*) FROM planners WHERE dept = ?) > 1`,
    )
    .bind(String(tgId), dept, dept)
    .run();
  if (!res.meta || res.meta.changes !== 1) {
    const list = await getDeptPlanners(db, dept);
    if (!list.some((p) => String(p.tg_id) === String(tgId))) {
      throw new RuleError('FORBIDDEN', `You are not a planner for ${dept}.`, 403);
    }
    throw new RuleError(
      'LAST_PLANNER',
      `You're the only planner for ${dept}. Add someone else before removing yourself.`,
      409,
    );
  }
}

export async function getExportData(db, { depts, wyStart, wyEnd }) {
  if (!depts.length) return { duties: [], logs: [] };
  const ph = depts.map(() => '?').join(', ');
  const [dutiesRes, logsRes] = await Promise.all([
    db
      .prepare(
        `SELECT
           n.name AS name,
           c.dept AS department,
           c.date AS date,
           c.state AS state,
           COALESCE(f.type, '') AS flight_type,
           COALESCE(f.time, '') AS flight_time,
           c.sent_at AS sent_at,
           c.received_at AS received_at,
           c.ended_at AS ended_at,
           c.ended_by AS ended_by,
           c.reason AS reason
         FROM cells c
         JOIN nsmen n ON n.id = c.nsman_id
         LEFT JOIN flight_days f ON f.dept = c.dept AND f.date = c.date
         WHERE c.dept IN (${ph}) AND c.date >= ? AND c.date <= ?
         ORDER BY c.date, c.dept, n.name`,
      )
      .bind(...depts, wyStart, wyEnd)
      .all(),
    db
      .prepare(
        `SELECT at, actor, action, detail
         FROM log
         WHERE at >= ? AND at <= ?
         ORDER BY at, id`,
      )
      .bind(`${wyStart}T00:00:00`, `${wyEnd}T23:59:59.999Z`)
      .all(),
  ]);

  return {
    duties: dutiesRes.results || [],
    logs: logsRes.results || [],
  };
}
