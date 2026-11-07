// Tab Rehab — background service worker
const DASH_URL = chrome.runtime.getURL('dashboard.html');
const DAY = 24 * 60 * 60 * 1000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Dashboard ----------
async function openDashboard(hash = '') {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url && t.url.startsWith(DASH_URL));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: DASH_URL + hash } : {}) });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASH_URL + hash });
  }
}
chrome.action.onClicked.addListener(() => openDashboard());

// ---------- Badge: your tab count, colour-coded ----------
let badgeTimer;
function scheduleBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadge, 250);
}
async function updateBadge() {
  const n = (await chrome.tabs.query({})).length;
  await chrome.action.setBadgeText({ text: n > 999 ? '999+' : String(n) });
  const day = new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
  const st = await chrome.storage.local.get(['settings', 'stats', 'lows', 'best']);
  const settings = st.settings || {}, stats = st.stats || {}, lows = st.lows || {};
  // daily snapshots (60 days): last count of the day, and the lowest count of the day
  const trim = o => { const k = Object.keys(o).sort(); while (k.length > 60) delete o[k.shift()]; };
  const patch = {};
  if (stats[day] !== n) { stats[day] = n; trim(stats); patch.stats = stats; }
  if (lows[day] == null || n < lows[day]) { lows[day] = n; trim(lows); patch.lows = lows; }
  // "Your best": the lowest 14-day median of daily lows you've ever reached. It only goes down,
  // so progress is locked in and a slow slide back up still counts as a relapse.
  const cand = bestCandidate(lows);
  const best = st.best == null ? cand : Math.min(st.best, cand);
  if (best !== st.best) patch.best = best;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  // Badge colour depends only on your budget: green under it, amber over, red at twice.
  const budget = settings.budget || 30;
  await chrome.action.setBadgeBackgroundColor({ color: n <= budget ? '#2e9e5b' : n < budget * 2 ? '#d98a00' : '#d93025' });
  const r = relapseState(n, settings, best);
  if (r.nudge) maybeNudge(n, r, settings);
}
chrome.tabs.onCreated.addListener(scheduleBadge);
chrome.tabs.onRemoved.addListener(scheduleBadge);

// ---------- Relapse alerts ----------
// Gentle by design: measured against your own 2-week median, at most one nudge a day
// (plus one "Later today" retry), never in quiet hours, and easy to pause.
const ALERT_DEFAULTS = { enabled: true, quietFrom: '22:00', quietTo: '08:00', weekendQuiet: false, pausedUntil: 0 };
const alertSettings = settings => ({ ...ALERT_DEFAULTS, ...(settings.alerts || {}) });
function bestCandidate(lows) {
  const vals = Object.keys(lows).sort().slice(-14).map(d => lows[d]).sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = vals.length >> 1;
  return vals.length % 2 ? vals[m] : Math.round((vals[m - 1] + vals[m]) / 2);
}
// Only nudge when you're climbing back up: 15+ above your best, and over budget.
// Over budget but coming down? No nudge: the red badge already says it, and progress deserves quiet.
function relapseState(n, settings, best) {
  const budget = settings.budget || 30;
  const threshold = best == null ? budget + 15 : Math.max(best + 15, budget + 1);
  return { nudge: n >= threshold, budget, best, threshold };
}
function isQuiet(a, d = new Date()) {
  if (a.weekendQuiet && (d.getDay() === 0 || d.getDay() === 6)) return true;
  const mins = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = a.quietFrom.split(':').map(Number), [th, tm] = a.quietTo.split(':').map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  return from === to ? false : from < to ? mins >= from && mins < to : mins >= from || mins < to;
}
function nudgeText(n, r) {
  return { title: "You're collecting again.", message: `${n} tabs, ${n - r.best} above your best (${r.best}). A 5-minute Rehab session gets you back there.` };
}
function showNudge(n, r, preview = false) {
  const t = nudgeText(n, r);
  if (preview) t.title = 'Preview · ' + t.title;
  // Same id = Chrome silently updates the old one; clear first so it pops up again.
  chrome.notifications.clear('relapse', () => chrome.notifications.create('relapse', {
    type: 'basic', iconUrl: 'icons/icon128.png', title: t.title, message: t.message, priority: 1,
    buttons: [{ title: 'Start session' }, { title: 'Later today' }]
  }));
}
async function maybeNudge(n, r, settings) {
  const a = alertSettings(settings);
  if (!a.enabled || Date.now() < a.pausedUntil || isQuiet(a)) return;
  const today = new Date().toLocaleDateString('sv');
  const { relapse = {} } = await chrome.storage.local.get('relapse');
  const fresh = relapse.day !== today;
  const retry = !fresh && relapse.laterAt && Date.now() >= relapse.laterAt;
  if (!fresh && !retry) return;
  await chrome.storage.local.set({ relapse: { day: today, laterAt: null, retried: !fresh } });
  showNudge(n, r);
}
async function laterToday() {
  const { relapse = {} } = await chrome.storage.local.get('relapse');
  if (relapse.retried) return; // "Later today" moves it once, then it waits until tomorrow
  const laterAt = Date.now() + 3 * 3600e3;
  await chrome.storage.local.set({ relapse: { ...relapse, laterAt } });
  chrome.alarms.create('relapse-later', { when: laterAt });
}
async function recheckRelapse() {
  const n = (await chrome.tabs.query({})).length;
  const { settings = {}, best = null } = await chrome.storage.local.get(['settings', 'best']);
  const r = relapseState(n, settings, best);
  if (r.nudge) maybeNudge(n, r, settings);
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'relapse-preview') {
    (async () => {
      const n = (await chrome.tabs.query({})).length;
      const { settings = {}, best = null } = await chrome.storage.local.get(['settings', 'best']);
      const r = relapseState(n, settings, best ?? n);
      if (r.best == null) r.best = n;
      // The real thing if you'd get it now; otherwise an example, labelled as a preview.
      if (r.nudge) showNudge(n, r, true); else showNudge(r.best + 17, r, true);
      reply(true);
    })();
    return true;
  }
});

// ---------- Install / startup ----------
async function setup() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'tr-todo', title: 'Save this tab as a to-do', contexts: ['page', 'action'] });
    chrome.contextMenus.create({ id: 'tr-park', title: 'Park this tab (save & close)', contexts: ['page', 'action'] });
  });
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.nudge !== false && !(await chrome.alarms.get('nudge'))) {
    chrome.alarms.create('nudge', { delayInMinutes: 60, periodInMinutes: 24 * 60 });
  }
  updateBadge();
  syncTodoAlarms();
  syncSnoozeAlarms();
  notifyOverdue();
  wakeSnoozed();
}
chrome.runtime.onInstalled.addListener(async details => {
  // After an update, the dashboard shows one quiet "What's new" banner until it's dismissed.
  if (details.reason === 'update' && details.previousVersion !== chrome.runtime.getManifest().version) {
    await chrome.storage.local.set({ whatsNew: { version: chrome.runtime.getManifest().version, from: details.previousVersion } });
  }
  setup();
});
chrome.runtime.onStartup.addListener(setup);

// ---------- Context menu: quick to-do / quick park ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.url) return;
  if (info.menuItemId === 'tr-todo') {
    const { todos = [] } = await chrome.storage.local.get('todos');
    todos.unshift({ id: uid(), title: tab.title || tab.url, url: tab.url, note: '', createdAt: Date.now(), remindAt: null, done: false });
    await chrome.storage.local.set({ todos });
    await track('todo');
    flashBadge('✓');
  }
  if (info.menuItemId === 'tr-park') {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const today = new Date().toISOString().slice(0, 10);
    const id = 'quick-' + today;
    let s = sessions.find(x => x.id === id);
    if (!s) {
      s = { id, name: 'Quick-parked ' + new Date().toLocaleDateString(), createdAt: Date.now(), tabs: [] };
      sessions.unshift(s);
    }
    let { bootId } = await chrome.storage.session.get('bootId');
    if (!bootId) { bootId = uid(); await chrome.storage.session.set({ bootId }); }
    s.tabs.push({ title: tab.title || tab.url, url: tab.url, parkedAt: Date.now(), windowId: tab.windowId, index: tab.index, boot: bootId });
    await chrome.storage.local.set({ sessions });
    await chrome.tabs.remove(tab.id);
    await track('parked');
  }
});
// Recovery counters (same shape as dashboard.js track): daily aggregates only, no URLs.
async function track(kind, n = 1) {
  const day = new Date().toLocaleDateString('sv');
  const { recovery = {} } = await chrome.storage.local.get('recovery');
  recovery.daily ||= {}; recovery.totals ||= {};
  (recovery.daily[day] ||= {})[kind] = (recovery.daily[day][kind] || 0) + n;
  recovery.totals[kind] = (recovery.totals[kind] || 0) + n;
  const keys = Object.keys(recovery.daily).sort();
  while (keys.length > 90) delete recovery.daily[keys.shift()];
  await chrome.storage.local.set({ recovery });
}
async function flashBadge(text) {
  await chrome.action.setBadgeText({ text });
  setTimeout(updateBadge, 1200);
}

// ---------- To-do reminders ----------
async function syncTodoAlarms() {
  const { todos = [] } = await chrome.storage.local.get('todos');
  const want = new Map(
    todos.filter(t => !t.done && t.remindAt && !t.notified && t.remindAt > Date.now())
      .map(t => ['todo:' + t.id, t.remindAt])
  );
  const alarms = await chrome.alarms.getAll();
  for (const a of alarms) {
    if (a.name.startsWith('todo:') && want.get(a.name) !== a.scheduledTime) await chrome.alarms.clear(a.name);
  }
  const current = new Set((await chrome.alarms.getAll()).map(a => a.name));
  for (const [name, when] of want) if (!current.has(name)) chrome.alarms.create(name, { when });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.todos) syncTodoAlarms();
  if (changes.snoozed) syncSnoozeAlarms();
  if (changes.settings) {
    scheduleBadge();
    const s = changes.settings.newValue || {};
    if (s.nudge === false) chrome.alarms.clear('nudge');
    else chrome.alarms.get('nudge').then(a => { if (!a) chrome.alarms.create('nudge', { delayInMinutes: 60, periodInMinutes: 24 * 60 }); });
  }
});

async function remind(todo) {
  chrome.notifications.create('todo:' + todo.id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'To-do: ' + (todo.title || '').slice(0, 80),
    message: todo.note || 'You asked Tab Rehab to remind you about this.',
    priority: 2
  });
  const { todos = [] } = await chrome.storage.local.get('todos');
  const t = todos.find(x => x.id === todo.id);
  if (t) { t.notified = true; await chrome.storage.local.set({ todos }); }
}

// Reminders that came due while the browser was closed
async function notifyOverdue() {
  const { todos = [] } = await chrome.storage.local.get('todos');
  for (const t of todos) if (!t.done && t.remindAt && !t.notified && t.remindAt <= Date.now()) await remind(t);
}

// ---------- Daily stale-tab nudge ----------
async function nudge() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const days = settings.staleDays || 7;
  const tabs = await chrome.tabs.query({});
  const stale = tabs.filter(t => t.lastAccessed && !t.pinned && !t.active && Date.now() - t.lastAccessed > days * DAY);
  if (stale.length >= 5) {
    chrome.notifications.create('nudge', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${stale.length} tabs untouched for ${days}+ days`,
      message: 'Park them in one click. They stay saved, your browser gets lighter.'
    });
  }
}

// ---------- Snooze: tabs that come back by themselves ----------
async function syncSnoozeAlarms() {
  const { snoozed = [] } = await chrome.storage.local.get('snoozed');
  const want = new Set(snoozed.map(s => 'snooze:' + s.id));
  const alarms = await chrome.alarms.getAll();
  for (const a of alarms) if (a.name.startsWith('snooze:') && !want.has(a.name)) await chrome.alarms.clear(a.name);
  const have = new Set(alarms.map(a => a.name));
  for (const s of snoozed) if (!have.has('snooze:' + s.id)) chrome.alarms.create('snooze:' + s.id, { when: Math.max(s.wakeAt, Date.now() + 1000) });
}
async function wakeSnoozed(id) {
  const { snoozed = [] } = await chrome.storage.local.get('snoozed');
  const due = snoozed.filter(s => (id ? s.id === id : s.wakeAt <= Date.now()));
  if (!due.length) return;
  const { bootId } = await chrome.storage.session.get('bootId');
  const open = new Set((await chrome.windows.getAll({ windowTypes: ['normal'] })).map(w => w.id));
  for (const s of due) {
    const home = s.boot && s.boot === bootId && open.has(s.windowId) ? { windowId: s.windowId } : {};
    await chrome.tabs.create({ url: s.url, active: false, ...home });
  }
  await chrome.storage.local.set({ snoozed: snoozed.filter(s => !due.includes(s)) });
  chrome.notifications.create('snooze-' + Date.now(), {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: due.length > 1 ? `${due.length} snoozed tabs are back` : 'A snoozed tab is back',
    message: due.map(s => s.title).join('\n').slice(0, 200)
  });
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'nudge') return nudge();
  if (alarm.name === 'relapse-later') return recheckRelapse();
  if (alarm.name.startsWith('snooze:')) return wakeSnoozed(alarm.name.slice(7));
  if (alarm.name.startsWith('todo:')) {
    const id = alarm.name.slice(5);
    const { todos = [] } = await chrome.storage.local.get('todos');
    const t = todos.find(x => x.id === id);
    if (t && !t.done) remind(t);
  }
});

chrome.notifications.onButtonClicked.addListener((id, i) => {
  if (id !== 'relapse') return;
  chrome.notifications.clear(id);
  return i === 0 ? openDashboard('#rehab') : laterToday();
});
chrome.notifications.onClicked.addListener(async id => {
  chrome.notifications.clear(id);
  if (id === 'nudge') return openDashboard('#stale');
  if (id === 'relapse') return openDashboard('#rehab');
  if (id.startsWith('todo:')) {
    const { todos = [] } = await chrome.storage.local.get('todos');
    const t = todos.find(x => x.id === id.slice(5));
    if (t && t.url) chrome.tabs.create({ url: t.url });
    else openDashboard('#todos');
  }
});
