// Pure domain rules for Enforcer NSMEN.
// No I/O or Cloudflare-specific APIs so Node tests can import and run this directly.

export const DEPARTMENTS = ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2'];
export const CAP = 40;
export const STATES = ['none', 'available', 'planned', 'sent', 'received', 'withdrawn', 'cancelled'];
export const COUNTING_STATES = ['sent', 'received'];
export const ON_PLAN_STATES = ['planned', 'sent', 'received'];
export const MAX_REASON_LEN = 200;
export const MAX_NAME_LEN = 60;
export const MAX_FLIGHT_TEXT_LEN = 100;
export const MAX_BATCH_DATES = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class RuleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
    this.status = status;
  }
}

// Asia/Singapore is fixed UTC+8 with no daylight saving time.
export function todaySGT(now = new Date()) {
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}

export function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function assertValidDate(dateStr) {
  if (!isValidDate(dateStr)) {
    throw new RuleError('BAD_DATE', 'That date is not valid.', 400);
  }
}

// Work year runs 1 April to 31 March, named by its starting April year.
// Example: 2026-04-01 -> 2026, 2027-03-31 -> 2026, 2027-04-01 -> 2027.
export function workYearOf(dateStr) {
  assertValidDate(dateStr);
  const [y, m] = dateStr.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function workYearBounds(wy) {
  const y = Number(wy);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new RuleError('BAD_WORK_YEAR', 'Invalid work year.', 400);
  }
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export function workYearLabel(wy) {
  return `Apr ${wy} – Mar ${wy + 1}`;
}

// NSmen can mark from today up to the end of the next work year.
export function maxMarkingDate(today) {
  const wy = workYearOf(today);
  return `${wy + 2}-03-31`;
}

export function isPastDate(dateStr, today) {
  assertValidDate(dateStr);
  return dateStr < today;
}

export function canCancelOrWithdrawDate(dateStr, today) {
  assertValidDate(dateStr);
  return dateStr > today;
}

export function isWithinMarkingWindow(dateStr, today) {
  assertValidDate(dateStr);
  return dateStr >= today && dateStr <= maxMarkingDate(today);
}

export function fmtDate(dateStr) {
  assertValidDate(dateStr);
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7;
  return `${DOW[dow]} ${d} ${MON[m - 1]}`;
}

export function fmtFlightInfo(flight) {
  if (!flight) return '';
  return [flight.type, flight.time].filter(Boolean).join(' · ');
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function validateMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RuleError('BAD_MONTH', 'Choose a valid month.', 400);
  }
  return month;
}

export function monthLabel(month) {
  validateMonth(month);
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// The bot message a planner sends to their department once a month's flights are posted.
// Lists only flight days from today on, one line each, in date order.
export function buildFlightBroadcast({ dept, month, flights, today }) {
  const label = monthLabel(month);
  const upcoming = (flights || [])
    .filter((f) => f.dept === dept && f.date.startsWith(month + '-') && f.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) {
    throw new RuleError('NO_FLIGHTS', `No upcoming ${dept} flights in ${label} to broadcast.`, 400);
  }
  const lines = upcoming.map((f) => {
    const info = [f.type, f.time].filter(Boolean).join(', ');
    return `• ${fmtDate(f.date)}${info ? ' – ' + info : ''}`;
  });
  const text = `${dept} flights for ${label} are out:\n${lines.join('\n')}\n\nOpen the app and select the days you can fly.`;
  return { text, count: upcoming.length };
}

export function validateDept(dept) {
  if (typeof dept !== 'string' || !DEPARTMENTS.includes(dept)) {
    throw new RuleError('BAD_DEPT', 'Choose a valid department.', 400);
  }
  return dept;
}

export function validateName(name) {
  const clean = String(name == null ? '' : name).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!clean || clean.length > MAX_NAME_LEN) {
    throw new RuleError('BAD_NAME', `Enter a name (1 to ${MAX_NAME_LEN} characters).`, 400);
  }
  return clean;
}

export function validateTgId(tgId) {
  const clean = String(tgId == null ? '' : tgId).trim();
  if (!/^\d{5,15}$/.test(clean)) {
    throw new RuleError(
      'BAD_TG_ID',
      'A Telegram ID is a number of 5 to 15 digits. Ask the person to copy it from the app.',
      400,
    );
  }
  return clean;
}

export function isHighestAdmin(adminRecord, tgId) {
  return Boolean(adminRecord && adminRecord.tg_id && String(adminRecord.tg_id) === String(tgId));
}

export function effectivePlannerDepts({ isAdmin = false, plannerDepts = [] } = {}) {
  if (isAdmin) return DEPARTMENTS.slice();
  return Array.isArray(plannerDepts) ? plannerDepts.slice() : [];
}

export function validateReason(reason) {
  const clean = String(reason == null ? '' : reason).trim();
  if (clean.length > MAX_REASON_LEN) {
    throw new RuleError('REASON_TOO_LONG', `Reason must be ${MAX_REASON_LEN} characters or fewer.`, 400);
  }
  return clean;
}

export function validateFlightText(text, label = 'Flight info') {
  const clean = String(text == null ? '' : text).trim();
  if (clean.length > MAX_FLIGHT_TEXT_LEN) {
    throw new RuleError('BAD_FLIGHT_INFO', `${label} must be ${MAX_FLIGHT_TEXT_LEN} characters or fewer.`, 400);
  }
  return clean;
}

export function countsTowardCap(state) {
  return state === 'sent' || state === 'received';
}

export function countSaf100InWorkYear(cells, nsmanId, wy) {
  const { start, end } = workYearBounds(wy);
  let count = 0;
  for (const c of cells) {
    if (String(c.nsman_id) === String(nsmanId) && countsTowardCap(c.state) && c.date >= start && c.date <= end) {
      count++;
    }
  }
  return count;
}

export function assertPlannerForDept(plannerDepts, dept, { isAdmin = false } = {}) {
  validateDept(dept);
  if (isAdmin) return true;
  if (!Array.isArray(plannerDepts) || !plannerDepts.includes(dept)) {
    throw new RuleError('FORBIDDEN', `You are not a planner for ${dept}.`, 403);
  }
  return true;
}

/**
 * Validates and computes a cell state transition.
 *
 * actions:
 * - NSman: 'mark_available', 'unmark_available', 'mark_received', 'cancel'
 * - Planner / Highest Admin: 'plan', 'unplan', 'send', 'withdraw'
 */
export function checkTransition({
  action,
  currentState = 'none',
  date,
  today,
  actorRole,
  actorDepts = [],
  isAdmin = false,
  targetDept,
  usedInWorkYear = 0,
  reason = '',
}) {
  assertValidDate(date);
  assertValidDate(today);
  if (!STATES.includes(currentState)) {
    throw new RuleError('BAD_STATE', 'Unknown cell state.', 400);
  }

  const actingAsAdmin = Boolean(isAdmin) || actorRole === 'admin';
  const isPlannerRole = actorRole === 'planner' || actorRole === 'admin';

  switch (action) {
    case 'mark_available': {
      if (actorRole !== 'nsman') throw new RuleError('FORBIDDEN', 'Only the NSman can mark availability.', 403);
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (date > maxMarkingDate(today)) {
        throw new RuleError('OUT_OF_WINDOW', 'You can mark dates up to the end of the next work year.', 400);
      }
      if (!['none', 'cancelled', 'withdrawn'].includes(currentState)) {
        throw new RuleError('INVALID_TRANSITION', 'This date is already marked.', 409);
      }
      return { nextState: 'available' };
    }

    case 'unmark_available': {
      if (actorRole !== 'nsman') throw new RuleError('FORBIDDEN', 'Only the NSman can remove availability.', 403);
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (currentState === 'sent' || currentState === 'received') {
        throw new RuleError('MUST_CANCEL', 'Use Cancel SAF100 for a sent or received SAF100.', 409);
      }
      if (currentState !== 'available' && currentState !== 'planned') {
        throw new RuleError('INVALID_TRANSITION', 'This date is not marked available.', 409);
      }
      return { nextState: 'none', wasPlanned: currentState === 'planned' };
    }

    case 'mark_received': {
      if (actorRole !== 'nsman') throw new RuleError('FORBIDDEN', 'Only the NSman can confirm SAF100 receipt.', 403);
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (currentState !== 'sent') {
        throw new RuleError('INVALID_TRANSITION', 'Only a sent SAF100 can be marked received.', 409);
      }
      return { nextState: 'received' };
    }

    case 'cancel': {
      if (actorRole !== 'nsman') throw new RuleError('FORBIDDEN', 'Only the NSman can cancel their SAF100.', 403);
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (date === today) throw new RuleError('TOO_LATE', 'SAF100 can be cancelled up to the day before.', 400);
      if (currentState !== 'sent' && currentState !== 'received') {
        throw new RuleError('INVALID_TRANSITION', 'Only a sent or received SAF100 can be cancelled.', 409);
      }
      const cleanReason = validateReason(reason);
      return { nextState: 'cancelled', reason: cleanReason };
    }

    case 'plan': {
      if (!isPlannerRole) throw new RuleError('FORBIDDEN', 'Only a planner can plan duty days.', 403);
      assertPlannerForDept(actorDepts, targetDept, { isAdmin: actingAsAdmin });
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (currentState !== 'available') {
        const msg = currentState === 'none'
          ? 'This NSman has not marked this day available.'
          : 'Only an available day can be planned.';
        throw new RuleError('INVALID_TRANSITION', msg, 409);
      }
      return { nextState: 'planned' };
    }

    case 'unplan': {
      if (!isPlannerRole) throw new RuleError('FORBIDDEN', 'Only a planner can un-plan duty days.', 403);
      assertPlannerForDept(actorDepts, targetDept, { isAdmin: actingAsAdmin });
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (currentState !== 'planned') {
        throw new RuleError('INVALID_TRANSITION', 'Only a planned day can be un-planned.', 409);
      }
      return { nextState: 'available' };
    }

    case 'send': {
      if (!isPlannerRole) throw new RuleError('FORBIDDEN', 'Only a planner can send SAF100.', 403);
      assertPlannerForDept(actorDepts, targetDept, { isAdmin: actingAsAdmin });
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (currentState !== 'planned') {
        throw new RuleError('INVALID_TRANSITION', 'Only a planned day can be marked SAF100 sent.', 409);
      }
      if (usedInWorkYear >= CAP) {
        const wy = workYearOf(date);
        throw new RuleError(
          'CAP_REACHED',
          `Already at ${CAP} of ${CAP} SAF100 days in ${workYearLabel(wy)}. SAF100 cannot be sent.`,
          409,
        );
      }
      return { nextState: 'sent' };
    }

    case 'withdraw': {
      if (!isPlannerRole) throw new RuleError('FORBIDDEN', 'Only a planner can withdraw SAF100.', 403);
      assertPlannerForDept(actorDepts, targetDept, { isAdmin: actingAsAdmin });
      if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
      if (date === today) throw new RuleError('TOO_LATE', 'SAF100 can be withdrawn up to the day before.', 400);
      if (currentState !== 'sent' && currentState !== 'received') {
        throw new RuleError('INVALID_TRANSITION', 'Only a sent or received SAF100 can be withdrawn.', 409);
      }
      const cleanReason = validateReason(reason);
      return { nextState: 'withdrawn', reason: cleanReason };
    }

    default:
      throw new RuleError('BAD_ACTION', 'Unknown action.', 400);
  }
}

export function validateBatchDatesInput(dates) {
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new RuleError('BAD_INPUT', 'Select at least one date.', 400);
  }
  if (dates.length > MAX_BATCH_DATES) {
    throw new RuleError(
      'TOO_MANY_DATES',
      `You can update at most ${MAX_BATCH_DATES} dates at a time.`,
      400,
    );
  }
  return dates;
}

export function batchSkipReason(err, currentState) {
  switch (err && err.code) {
    case 'BAD_DATE':
      return 'invalid date';
    case 'PAST':
      return 'past date';
    case 'OUT_OF_WINDOW':
      return 'outside marking window';
    case 'MUST_CANCEL':
      return 'SAF100 already sent';
    case 'INVALID_TRANSITION':
      if (currentState === 'available') return 'already available';
      if (currentState === 'planned') return 'already planned';
      if (currentState === 'sent' || currentState === 'received') return 'SAF100 already sent';
      return 'not marked';
    default:
      return (err && err.message) || 'not allowed';
  }
}

export function validateAvailabilityBatch({ action, dates, existingStates = new Map(), today }) {
  if (action !== 'mark_available' && action !== 'unmark_available') {
    throw new RuleError('BAD_ACTION', 'Unknown batch action.', 400);
  }
  validateBatchDatesInput(dates);
  assertValidDate(today);

  const seen = new Set();
  const valid = [];
  const skipped = [];

  for (const rawDate of dates) {
    if (seen.has(rawDate)) continue;
    seen.add(rawDate);
    const lookup =
      existingStates instanceof Map
        ? existingStates.get(rawDate)
        : existingStates && typeof existingStates === 'object'
          ? existingStates[rawDate]
          : undefined;
    const currentState = lookup || 'none';
    try {
      const res = checkTransition({
        action,
        currentState,
        date: rawDate,
        today,
        actorRole: 'nsman',
      });
      valid.push({
        date: rawDate,
        currentState,
        nextState: res.nextState,
        wasPlanned: Boolean(res.wasPlanned),
      });
    } catch (err) {
      if (err instanceof RuleError) {
        skipped.push({ date: rawDate, reason: batchSkipReason(err, currentState) });
      } else {
        throw err;
      }
    }
  }

  return { valid, skipped };
}

export function canEditFlightDay({ actorDepts = [], isAdmin = false, dept, date, today, removing = false }) {
  assertPlannerForDept(actorDepts, dept, { isAdmin });
  assertValidDate(date);
  assertValidDate(today);
  if (date < today) throw new RuleError('PAST', 'Past dates are locked.', 400);
  if (!removing && date > maxMarkingDate(today)) {
    throw new RuleError('OUT_OF_WINDOW', 'Flight days can be posted up to the end of the next work year.', 400);
  }
  return true;
}

export function canAddPlanner({
  actorDepts = [],
  isAdmin = false,
  dept,
  existingPlannersInDept = [],
  targetTgId,
  targetName,
}) {
  assertPlannerForDept(actorDepts, dept, { isAdmin });
  const cleanTgId = validateTgId(targetTgId);
  const cleanName = validateName(targetName);
  if (existingPlannersInDept.map(String).includes(cleanTgId)) {
    throw new RuleError('ALREADY_PLANNER', `Already a planner for ${dept}.`, 409);
  }
  return { tgId: cleanTgId, name: cleanName, dept };
}

export function canRemovePlanner({
  isAdmin = false,
  actorTgId,
  targetTgId,
  dept,
  existingPlannersInDept = [],
}) {
  validateDept(dept);
  const list = existingPlannersInDept.map(String);
  const actor = String(actorTgId);
  const target = String(targetTgId);

  if (isAdmin) {
    if (!list.includes(target)) {
      throw new RuleError('NOT_FOUND', `That person is not a planner for ${dept}.`, 404);
    }
    return true;
  }

  if (target !== actor) {
    throw new RuleError('FORBIDDEN', 'Planners can only remove themselves.', 403);
  }
  if (!list.includes(actor)) {
    throw new RuleError('FORBIDDEN', `You are not a planner for ${dept}.`, 403);
  }
  if (list.length < 2) {
    throw new RuleError(
      'LAST_PLANNER',
      `You're the only planner for ${dept}. Add someone else before removing yourself.`,
      409,
    );
  }
  return true;
}

export function canRemoveSelfAsPlanner({ actorTgId, dept, existingPlannersInDept, isAdmin = false }) {
  return canRemovePlanner({
    isAdmin,
    actorTgId,
    targetTgId: actorTgId,
    dept,
    existingPlannersInDept,
  });
}

export function passHighestAdmin({ currentAdminTgId, actorTgId, newAdminTgId, newAdminName }) {
  if (!currentAdminTgId || String(actorTgId) !== String(currentAdminTgId)) {
    throw new RuleError('FORBIDDEN', 'Only the Highest Admin can pass on this role.', 403);
  }
  const cleanTgId = validateTgId(newAdminTgId);
  const cleanName = validateName(newAdminName);
  if (cleanTgId === String(currentAdminTgId)) {
    throw new RuleError('SAME_ADMIN', 'That Telegram ID is already the Highest Admin.', 400);
  }
  return {
    tg_id: cleanTgId,
    name: cleanName,
    previousAdminTgId: String(currentAdminTgId),
  };
}

export function csvEscape(value) {
  let s = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildExportCsv({ duties = [], logs = [] }) {
  const dutyHeader = [
    'name',
    'department',
    'date',
    'state',
    'flight_type',
    'flight_time',
    'sent_at',
    'received_at',
    'ended_at',
    'ended_by',
    'reason',
  ];
  const lines = [dutyHeader.join(',')];
  for (const r of duties) {
    lines.push([
      r.name,
      r.department,
      r.date,
      r.state,
      r.flight_type || '',
      r.flight_time || '',
      r.sent_at || '',
      r.received_at || '',
      r.ended_at || '',
      r.ended_by || '',
      r.reason || '',
    ].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push('at,actor,action,detail');
  for (const l of logs) {
    lines.push([l.at, l.actor, l.action, l.detail].map(csvEscape).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
