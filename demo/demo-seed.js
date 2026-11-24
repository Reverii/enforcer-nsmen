// Demo data, runs after the fake backend (tests/fake_api.js) and before the app.
// Replaces the test data with a fuller sample set dated from "today", keeps one shared world across the
// roles in this browser (saved in localStorage), and sets who you are for the chosen role.
(function () {
  var S = window.FAKE.state;
  var role = window.DEMO_ROLE;
  var TODAY = window.APP_TODAY;
  var ME = window.FAKE_OPTS.tgId;

  function iso(y, m, d) { var t = new Date(Date.UTC(y, m, d)); return t.toISOString().slice(0, 10); }
  var t = new Date(TODAY + 'T00:00:00Z');
  var Y = t.getUTCFullYear(), M = t.getUTCMonth();
  function next(d) { return iso(Y, M + 1, d); } // a day in next month
  var wyStart = M >= 3 ? Y : Y - 1;

  function cell(id, nsman, date, state, extra) {
    var c = { id: id, nsman_id: nsman, date: date, state: state, dept: extra && extra.dept || 'Loadmaster',
      planned_by: '', sent_at: '', received_at: '', ended_at: '', ended_by: '', reason: '' };
    for (var k in extra) c[k] = extra[k];
    if (state === 'planned' || state === 'sent' || state === 'received') c.planned_by = c.planned_by || 'ME4 ONG S.H.';
    if (state === 'sent' || state === 'received') c.sent_at = c.sent_at || TODAY + 'T09:00:00Z';
    if (state === 'received') c.received_at = c.received_at || TODAY + 'T10:00:00Z';
    return c;
  }

  function seed() {
    var nsmen = [
      [1, 'ME2 TAN K.L.', 'Loadmaster', '6982215470', '2025-04-07'],
      [2, 'ME3 LIM J.W.', 'Loadmaster', '6120458832', '2024-06-12'],
      [3, 'ME3 KOH B.H.', 'Loadmaster', '6120458833', '2023-09-01'],
      [4, 'ME2 NG W.M.', 'Loadmaster', '6120458835', '2025-11-03'],
      [5, 'ME2 LEE Z.H.', 'Loadmaster', '6120458836', '2024-01-15'],
      [6, 'ME1 GOH C.Y.', 'Loadmaster', '6120458837', TODAY],
      [7, 'CPT LOW J.M.', 'Pilot', '6120458838', '2024-03-02'],
      [8, 'CPT HO K.W.', 'Pilot', '6120458839', '2023-05-20'],
      [9, 'ME3 TEO H.L.', 'Tacco', '6120458840', '2024-10-01'],
    ].map(function (r) {
      return { id: r[0], name: r[1], dept: r[2], tg_id: r[3], tg_username: '', active: 1, joined_at: r[4] + 'T00:00:00Z' };
    });
    var fl = function (dept, d, type, time) { return { id: 0, dept: dept, date: next(d), type: type, time: time }; };
    var flightDays = [
      fl('Loadmaster', 2, 'C-130', '0800-1500'), fl('Loadmaster', 9, 'C-130', '0800-1500'),
      fl('Loadmaster', 15, 'C-130 night', '1800-0100'), fl('Loadmaster', 17, '', ''),
      fl('Loadmaster', 22, 'C-130', '0900-1600'),
      fl('Pilot', 3, 'C-130', '0730-1400'), fl('Pilot', 10, 'KC-130', '1300-2000'),
      fl('Tacco', 9, 'C-130', '0800-1500'),
    ];
    flightDays.forEach(function (f, i) { f.id = 500 + i; });
    var id = 1000;
    var cells = [
      cell(id++, 1, next(2), 'received'), cell(id++, 1, next(9), 'sent'), cell(id++, 1, next(15), 'available'),
      cell(id++, 1, next(17), 'available'), cell(id++, 1, next(22), 'planned'), cell(id++, 1, next(5), 'available'),
      cell(id++, 2, next(2), 'received'), cell(id++, 2, next(9), 'received'), cell(id++, 2, next(15), 'planned'),
      cell(id++, 2, next(22), 'available'),
      cell(id++, 3, next(9), 'available'), cell(id++, 3, next(15), 'planned'),
      cell(id++, 4, next(2), 'cancelled', { reason: 'Work trip moved forward', ended_by: 'ME2 NG W.M.', ended_at: TODAY + 'T08:00:00Z' }),
      cell(id++, 4, next(15), 'available'), cell(id++, 4, next(17), 'available'), cell(id++, 4, next(22), 'planned'),
      cell(id++, 5, next(2), 'sent'), cell(id++, 5, next(17), 'planned'), cell(id++, 5, next(22), 'available'),
      cell(id++, 6, next(15), 'available'), cell(id++, 6, next(17), 'available'), cell(id++, 6, next(22), 'available'),
      cell(id++, 7, next(3), 'sent', { dept: 'Pilot' }), cell(id++, 7, next(10), 'available', { dept: 'Pilot' }),
      cell(id++, 8, next(3), 'planned', { dept: 'Pilot' }),
    ];
    // Earlier this work year: SAF100 days already used, so the n/40 counts look real. KOH is at 40.
    var used = { 1: 12, 2: 37, 3: 40, 4: 8, 5: 21, 7: 18, 8: 25, 9: 14 };
    Object.keys(used).forEach(function (k) {
      var n = Number(k);
      var dept = n >= 9 ? 'Tacco' : n >= 7 ? 'Pilot' : 'Loadmaster';
      for (var i = 0; i < used[k]; i++) {
        var d = iso(wyStart, 3, 1 + i * 3 + n); // spread through April onwards
        if (d >= TODAY) break;
        cells.push(cell(id++, n, d, 'received', { dept: dept }));
      }
    });
    return {
      nextId: id,
      nsmen: nsmen,
      flightDays: flightDays,
      cells: cells,
      planners: [
        { tg_id: '5829104473', dept: 'Pilot', name: 'MAJ RAHMAN A.' },
        { tg_id: '6120458831', dept: 'Loadmaster', name: 'ME4 ONG S.H.' },
        { tg_id: '7034412290', dept: 'Tacco', name: 'ME4 SOH L.K.' },
        { tg_id: '6650193347', dept: 'Sup1', name: 'ME3 PEH J.N.' },
        { tg_id: '6650193347', dept: 'Sup2', name: 'ME3 PEH J.N.' },
      ],
      admin: { tg_id: '5520881904', name: 'LTC TAY W.K.' },
    };
  }

  var world = null;
  try { world = JSON.parse(localStorage.getItem('demoState') || 'null'); } catch (e) { world = null; }
  if (!world) world = seed();
  ['nextId', 'nsmen', 'flightDays', 'cells', 'planners'].forEach(function (k) { S[k] = world[k]; });

  // Who you are in this role
  S.admin = world.admin;
  S.isAdmin = role === 'ad' && world.admin && world.admin.tg_id === ME;
  S.plannerDepts = S.planners.filter(function (p) { return p.tg_id === ME; }).map(function (p) { return p.dept; });
  var mePl = S.planners.find(function (p) { return p.tg_id === ME; });
  S.plannerName = S.isAdmin ? world.admin.name : (mePl ? mePl.name : '');

  function save() {
    world.nextId = S.nextId; world.nsmen = S.nsmen; world.flightDays = S.flightDays;
    world.cells = S.cells; world.planners = S.planners;
    if (S.isAdmin || role === 'ad') world.admin = S.admin || world.admin;
    try { localStorage.setItem('demoState', JSON.stringify(world)); } catch (e) { /* private mode */ }
  }
  var real = window.APP_FAKE_API;
  window.APP_FAKE_API = function (method, path, body) {
    return real(method, path, body).then(function (res) { save(); return res; });
  };
  save();
})();
