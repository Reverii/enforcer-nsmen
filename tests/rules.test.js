import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAP,
  DEPARTMENTS,
  STATES,
  buildExportCsv,
  canAddPlanner,
  canEditFlightDay,
  canRemovePlanner,
  canRemoveSelfAsPlanner,
  checkTransition,
  countSaf100InWorkYear,
  csvEscape,
  effectivePlannerDepts,
  isHighestAdmin,
  maxMarkingDate,
  passHighestAdmin,
  todaySGT,
  validateTgId,
  workYearBounds,
  workYearOf,
} from '../worker/src/rules.js';

const TODAY = '2026-11-24';
const YESTERDAY = '2026-11-23';
const TOMORROW = '2026-11-25';

function errCode(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return 'NO_ERROR';
}

test('departments list matches design', () => {
  assert.deepEqual(DEPARTMENTS, ['Pilot', 'Loadmaster', 'Tacco', 'Sup1', 'Sup2']);
  assert.equal(CAP, 40);
});

test('Singapore time date rollover (UTC+8)', () => {
  assert.equal(todaySGT(new Date('2026-11-24T15:59:59Z')), '2026-11-24');
  assert.equal(todaySGT(new Date('2026-11-24T16:00:00Z')), '2026-11-25');
});

test('work-year boundary: 31 Mar vs 1 Apr', () => {
  assert.equal(workYearOf('2026-04-01'), 2026);
  assert.equal(workYearOf('2026-11-24'), 2026);
  assert.equal(workYearOf('2027-03-31'), 2026);
  assert.equal(workYearOf('2027-04-01'), 2027);
  assert.deepEqual(workYearBounds(2026), { start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual(workYearBounds(2027), { start: '2027-04-01', end: '2028-03-31' });
});

test('marking window: today up to end of next work year', () => {
  assert.equal(maxMarkingDate('2026-11-24'), '2028-03-31');
  assert.equal(maxMarkingDate('2027-03-31'), '2028-03-31');
  assert.equal(maxMarkingDate('2027-04-01'), '2029-03-31');

  assert.equal(
    checkTransition({
      action: 'mark_available',
      currentState: 'none',
      date: '2028-03-31',
      today: TODAY,
      actorRole: 'nsman',
    }).nextState,
    'available',
  );
  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'mark_available',
        currentState: 'none',
        date: '2028-04-01',
        today: TODAY,
        actorRole: 'nsman',
      }),
    ),
    'OUT_OF_WINDOW',
  );
});

test('every state transition matrix: allowed vs refused', () => {
  const cases = [
    { action: 'mark_available', actorRole: 'nsman', allowed: ['none', 'cancelled', 'withdrawn'], nextState: 'available' },
    { action: 'unmark_available', actorRole: 'nsman', allowed: ['available', 'planned'], nextState: 'none' },
    { action: 'mark_received', actorRole: 'nsman', allowed: ['sent'], nextState: 'received' },
    { action: 'cancel', actorRole: 'nsman', allowed: ['sent', 'received'], nextState: 'cancelled' },
    { action: 'plan', actorRole: 'planner', allowed: ['available'], nextState: 'planned' },
    { action: 'unplan', actorRole: 'planner', allowed: ['planned'], nextState: 'available' },
    { action: 'send', actorRole: 'planner', allowed: ['planned'], nextState: 'sent' },
    { action: 'withdraw', actorRole: 'planner', allowed: ['sent', 'received'], nextState: 'withdrawn' },
  ];

  for (const tc of cases) {
    for (const st of STATES) {
      const params = {
        action: tc.action,
        currentState: st,
        date: TOMORROW,
        today: TODAY,
        actorRole: tc.actorRole,
        actorDepts: ['Loadmaster'],
        targetDept: 'Loadmaster',
        usedInWorkYear: 10,
      };
      if (tc.allowed.includes(st)) {
        const res = checkTransition(params);
        assert.equal(res.nextState, tc.nextState, `${tc.action} from ${st} should -> ${tc.nextState}`);
      } else {
        const code = errCode(() => checkTransition(params));
        assert.notEqual(code, 'NO_ERROR', `${tc.action} from ${st} must be refused`);
      }
    }
  }
});

test('un-marking a planned day un-plans it; un-marking sent/received requires cancel', () => {
  const r = checkTransition({
    action: 'unmark_available',
    currentState: 'planned',
    date: TOMORROW,
    today: TODAY,
    actorRole: 'nsman',
  });
  assert.equal(r.nextState, 'none');
  assert.equal(r.wasPlanned, true);

  const rAvail = checkTransition({
    action: 'unmark_available',
    currentState: 'available',
    date: TOMORROW,
    today: TODAY,
    actorRole: 'nsman',
  });
  assert.equal(rAvail.wasPlanned, false);

  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'unmark_available',
        currentState: 'sent',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'nsman',
      }),
    ),
    'MUST_CANCEL',
  );
  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'unmark_available',
        currentState: 'received',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'nsman',
      }),
    ),
    'MUST_CANCEL',
  );
});

test('40-day cap: 39->40 ok, at 40 refused, withdrawn/cancelled return day, planning past 40 allowed', () => {
  const ok = checkTransition({
    action: 'send',
    currentState: 'planned',
    date: TOMORROW,
    today: TODAY,
    actorRole: 'planner',
    actorDepts: ['Pilot'],
    targetDept: 'Pilot',
    usedInWorkYear: 39,
  });
  assert.equal(ok.nextState, 'sent');

  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'send',
        currentState: 'planned',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'planner',
        actorDepts: ['Pilot'],
        targetDept: 'Pilot',
        usedInWorkYear: 40,
      }),
    ),
    'CAP_REACHED',
  );

  const planAtCap = checkTransition({
    action: 'plan',
    currentState: 'available',
    date: TOMORROW,
    today: TODAY,
    actorRole: 'planner',
    actorDepts: ['Pilot'],
    targetDept: 'Pilot',
    usedInWorkYear: 40,
  });
  assert.equal(planAtCap.nextState, 'planned');

  const cells = [
    { nsman_id: 1, date: '2026-04-01', state: 'received' },
    { nsman_id: 1, date: '2026-10-01', state: 'sent' },
    { nsman_id: 1, date: '2026-10-02', state: 'planned' },
    { nsman_id: 1, date: '2026-10-03', state: 'available' },
    { nsman_id: 1, date: '2026-10-04', state: 'cancelled' },
    { nsman_id: 1, date: '2026-10-05', state: 'withdrawn' },
    { nsman_id: 1, date: '2027-03-31', state: 'sent' },
    { nsman_id: 1, date: '2027-04-01', state: 'sent' },
    { nsman_id: 2, date: '2026-10-06', state: 'received' },
  ];
  assert.equal(countSaf100InWorkYear(cells, 1, 2026), 3);
  assert.equal(countSaf100InWorkYear(cells, 1, 2027), 1);
});

test('past-date lock refuses all actions on past dates', () => {
  const actions = [
    ['mark_available', 'none', 'nsman'],
    ['unmark_available', 'available', 'nsman'],
    ['mark_received', 'sent', 'nsman'],
    ['cancel', 'sent', 'nsman'],
    ['plan', 'available', 'planner'],
    ['unplan', 'planned', 'planner'],
    ['send', 'planned', 'planner'],
    ['withdraw', 'sent', 'planner'],
  ];
  for (const [action, currentState, actorRole] of actions) {
    assert.equal(
      errCode(() =>
        checkTransition({
          action,
          currentState,
          date: YESTERDAY,
          today: TODAY,
          actorRole,
          actorDepts: ['Tacco'],
          targetDept: 'Tacco',
          usedInWorkYear: 0,
        }),
      ),
      'PAST',
      `${action} must be locked on past date`,
    );
  }
  assert.equal(
    errCode(() => canEditFlightDay({ actorDepts: ['Tacco'], dept: 'Tacco', date: YESTERDAY, today: TODAY })),
    'PAST',
  );
});

test('cancel and withdraw refused on duty day itself, allowed the day before', () => {
  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'cancel',
        currentState: 'sent',
        date: TODAY,
        today: TODAY,
        actorRole: 'nsman',
      }),
    ),
    'TOO_LATE',
  );
  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'withdraw',
        currentState: 'received',
        date: TODAY,
        today: TODAY,
        actorRole: 'planner',
        actorDepts: ['Sup1'],
        targetDept: 'Sup1',
      }),
    ),
    'TOO_LATE',
  );

  assert.equal(
    checkTransition({
      action: 'cancel',
      currentState: 'sent',
      date: TOMORROW,
      today: TODAY,
      actorRole: 'nsman',
      reason: 'Work travel',
    }).reason,
    'Work travel',
  );
  assert.equal(
    checkTransition({
      action: 'withdraw',
      currentState: 'received',
      date: TOMORROW,
      today: TODAY,
      actorRole: 'planner',
      actorDepts: ['Sup1'],
      targetDept: 'Sup1',
      reason: 'Sortie cancelled',
    }).reason,
    'Sortie cancelled',
  );

  assert.equal(
    errCode(() =>
      checkTransition({
        action: 'cancel',
        currentState: 'sent',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'nsman',
        reason: 'x'.repeat(201),
      }),
    ),
    'REASON_TOO_LONG',
  );
});

test('Highest Admin acts for every department even without explicit planner rows', () => {
  assert.deepEqual(effectivePlannerDepts({ isAdmin: true, plannerDepts: [] }), DEPARTMENTS);
  assert.deepEqual(effectivePlannerDepts({ isAdmin: false, plannerDepts: ['Pilot'] }), ['Pilot']);

  for (const dept of DEPARTMENTS) {
    assert.equal(
      checkTransition({
        action: 'plan',
        currentState: 'available',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'planner',
        actorDepts: [],
        isAdmin: true,
        targetDept: dept,
      }).nextState,
      'planned',
    );
    assert.equal(
      checkTransition({
        action: 'send',
        currentState: 'planned',
        date: TOMORROW,
        today: TODAY,
        actorRole: 'admin',
        actorDepts: [],
        targetDept: dept,
        usedInWorkYear: 0,
      }).nextState,
      'sent',
    );
    assert.equal(canEditFlightDay({ actorDepts: [], isAdmin: true, dept, date: TOMORROW, today: TODAY }), true);
    const added = canAddPlanner({
      actorDepts: [],
      isAdmin: true,
      dept,
      existingPlannersInDept: [],
      targetTgId: '6120458831',
      targetName: 'me4 ong s.h.',
    });
    assert.deepEqual(added, { tgId: '6120458831', name: 'ME4 ONG S.H.', dept });
  }
});

test('planner of one department cannot act on or add planners for another department', () => {
  for (const [action, currentState] of [
    ['plan', 'available'],
    ['unplan', 'planned'],
    ['send', 'planned'],
    ['withdraw', 'sent'],
  ]) {
    assert.equal(
      errCode(() =>
        checkTransition({
          action,
          currentState,
          date: TOMORROW,
          today: TODAY,
          actorRole: 'planner',
          actorDepts: ['Pilot'],
          targetDept: 'Loadmaster',
          usedInWorkYear: 0,
        }),
      ),
      'FORBIDDEN',
      `Pilot planner must not ${action} Loadmaster NSman`,
    );
  }
  assert.equal(
    errCode(() => canEditFlightDay({ actorDepts: ['Pilot'], dept: 'Loadmaster', date: TOMORROW, today: TODAY })),
    'FORBIDDEN',
  );
  assert.equal(
    errCode(() =>
      canAddPlanner({
        actorDepts: ['Pilot'],
        dept: 'Loadmaster',
        existingPlannersInDept: ['10001'],
        targetTgId: '20002',
        targetName: 'ME4 TEST',
      }),
    ),
    'FORBIDDEN',
  );
  // Adding planner for own department succeeds even for a non-NSman (no linked NSman needed)
  const ownDeptRes = canAddPlanner({
    actorDepts: ['Pilot'],
    dept: 'Pilot',
    existingPlannersInDept: ['10001'],
    targetTgId: '6120458831',
    targetName: 'maj non-nsman',
  });
  assert.deepEqual(ownDeptRes, { tgId: '6120458831', name: 'MAJ NON-NSMAN', dept: 'Pilot' });
});

test('tgId validation accepts 5 to 15 digits and rejects malformed IDs', () => {
  assert.equal(validateTgId('12345'), '12345');
  assert.equal(validateTgId(' 123456789012345 '), '123456789012345');
  for (const bad of ['', '1234', '1234567890123456', 'abc12345', '@username', '123-456', '-12345']) {
    assert.equal(errCode(() => validateTgId(bad)), 'BAD_TG_ID', `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(
    errCode(() =>
      canAddPlanner({
        actorDepts: ['Pilot'],
        dept: 'Pilot',
        existingPlannersInDept: [],
        targetTgId: '1234',
        targetName: 'CPT SHORT',
      }),
    ),
    'BAD_TG_ID',
  );
});

test('last-planner step-down refused, non-admin cannot remove others, but admin removal allowed', () => {
  assert.equal(
    errCode(() =>
      canRemoveSelfAsPlanner({
        actorTgId: '10001',
        dept: 'Loadmaster',
        existingPlannersInDept: ['10001'],
      }),
    ),
    'LAST_PLANNER',
  );
  assert.equal(
    canRemoveSelfAsPlanner({
      actorTgId: '10001',
      dept: 'Loadmaster',
      existingPlannersInDept: ['10001', '20002'],
    }),
    true,
  );
  // Regular planner cannot remove another planner
  assert.equal(
    errCode(() =>
      canRemovePlanner({
        isAdmin: false,
        actorTgId: '10001',
        targetTgId: '20002',
        dept: 'Loadmaster',
        existingPlannersInDept: ['10001', '20002'],
      }),
    ),
    'FORBIDDEN',
  );
  // Highest Admin can remove any planner, including the last planner of a department
  assert.equal(
    canRemovePlanner({
      isAdmin: true,
      actorTgId: '99999',
      targetTgId: '10001',
      dept: 'Loadmaster',
      existingPlannersInDept: ['10001'],
    }),
    true,
  );
});

test('pass-on Highest Admin makes old admin a non-admin and validates inputs', () => {
  const initialAdmin = { tg_id: '5520881904', name: 'LTC OLD' };
  assert.equal(isHighestAdmin(initialAdmin, '5520881904'), true);
  assert.equal(isHighestAdmin(initialAdmin, '6120458831'), false);

  // Non-admin cannot pass on
  assert.equal(
    errCode(() =>
      passHighestAdmin({
        currentAdminTgId: initialAdmin.tg_id,
        actorTgId: '6120458831',
        newAdminTgId: '7741902256',
        newAdminName: 'LTC NEW',
      }),
    ),
    'FORBIDDEN',
  );

  // Invalid target tgId rejected
  assert.equal(
    errCode(() =>
      passHighestAdmin({
        currentAdminTgId: initialAdmin.tg_id,
        actorTgId: initialAdmin.tg_id,
        newAdminTgId: '123',
        newAdminName: 'LTC NEW',
      }),
    ),
    'BAD_TG_ID',
  );

  // Passing to self rejected
  assert.equal(
    errCode(() =>
      passHighestAdmin({
        currentAdminTgId: initialAdmin.tg_id,
        actorTgId: initialAdmin.tg_id,
        newAdminTgId: initialAdmin.tg_id,
        newAdminName: 'LTC OLD',
      }),
    ),
    'SAME_ADMIN',
  );

  // Valid pass-on transfers admin and old admin is no longer Highest Admin
  const nextAdmin = passHighestAdmin({
    currentAdminTgId: initialAdmin.tg_id,
    actorTgId: initialAdmin.tg_id,
    newAdminTgId: '6120458831',
    newAdminName: 'ltc new',
  });
  assert.equal(nextAdmin.tg_id, '6120458831');
  assert.equal(nextAdmin.name, 'LTC NEW');
  assert.equal(isHighestAdmin(nextAdmin, '5520881904'), false);
  assert.equal(isHighestAdmin(nextAdmin, '6120458831'), true);
});

test('CSV export escapes quotes/commas, appends log, and guards against spreadsheet formulas', () => {
  // Formula guard unit checks for =, +, -, @, tab, CR
  assert.equal(csvEscape('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvEscape('+1+1'), "'+1+1");
  assert.equal(csvEscape('-2+3'), "'-2+3");
  assert.equal(csvEscape('@user'), "'@user");
  assert.equal(csvEscape('\tleading'), "'\tleading");
  assert.equal(csvEscape('\r=1'), '"\'\r=1"');
  assert.equal(csvEscape('=1,2'), '"\'=1,2"');

  const csv = buildExportCsv({
    duties: [
      {
        name: '3SG TEST A.',
        department: 'Loadmaster',
        date: '2026-12-09',
        state: 'cancelled',
        flight_type: 'C-130, night',
        flight_time: '1800-0100',
        sent_at: '2026-11-24T01:00:00Z',
        received_at: '',
        ended_at: '2026-11-25T02:00:00Z',
        ended_by: '3SG TEST A.',
        reason: '=HYPERLINK("http://evil","click"), "delayed"',
      },
    ],
    logs: [{ at: '2026-11-24T01:00:00Z', actor: '@planner', action: 'send_saf100', detail: '+cmd' }],
  });
  const lines = csv.trim().split('\r\n');
  assert.equal(
    lines[0],
    'name,department,date,state,flight_type,flight_time,sent_at,received_at,ended_at,ended_by,reason',
  );
  assert.match(lines[1], /"C-130, night"/);
  assert.match(lines[1], /"'=HYPERLINK\(""http:\/\/evil"",""click""\), ""delayed"""/);
  assert.equal(lines[2], '');
  assert.equal(lines[3], 'at,actor,action,detail');
  assert.match(lines[4], /'@planner,send_saf100,\'\+cmd/);
});
