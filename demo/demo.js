// Demo setup, runs before the fake backend and the app.
// Picks who you're viewing as, sets "today", and stands in for Telegram outside the Telegram app.
(function () {
  var IDS = { ns: '6982215470', new: '6100000001', pl: '6120458831', ad: '5520881904' };
  var role = 'ns';
  try { role = localStorage.getItem('demoRole') || 'ns'; } catch (e) { /* private mode */ }
  var asParam = new URLSearchParams(location.search).get('as'); // e.g. demo/?as=pl to share a role
  if (asParam && IDS[asParam]) {
    role = asParam;
    try { localStorage.setItem('demoRole', role); } catch (e) { /* ignore */ }
  }
  if (!IDS[role]) role = 'ns';
  window.DEMO_ROLE = role;

  // Today in Singapore time, as the real Worker uses.
  window.APP_TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  window.FAKE_OPTS = {
    tgId: IDS[role],
    joined: role === 'ns',
    isAdmin: role === 'ad',
    adminName: 'LTC TAY W.K.',
    plannerDepts: role === 'pl' ? ['Loadmaster'] : [],
    plannerName: role === 'pl' ? 'ME4 ONG S.H.' : '',
    delay: 150,
  };

  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  window.Telegram = {
    WebApp: {
      initData: 'demo',
      colorScheme: dark ? 'dark' : 'light',
      themeParams: {},
      ready: function () {},
      expand: function () {},
      onEvent: function () {},
      requestWriteAccess: function (cb) { if (cb) cb(true); },
      setHeaderColor: function () {},
      setBackgroundColor: function () {},
      setBottomBarColor: function () {},
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    var sel = document.getElementById('demoRole');
    sel.value = role;
    sel.onchange = function () {
      try { localStorage.setItem('demoRole', sel.value); } catch (e) { /* ignore */ }
      location.reload();
    };
    document.getElementById('demoReset').onclick = function () {
      try { localStorage.removeItem('demoState'); } catch (e) { /* ignore */ }
      location.reload();
    };
  });
})();
