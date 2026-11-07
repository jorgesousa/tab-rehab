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
  const color = n < 30 ? '#2e9e5b' : n < 100 ? '#d98a00' : '#d93025';
  await chrome.action.setBadgeBackgroundColor({ color });
  // daily health snapshot (keeps 60 days)
  const day = new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
  const { stats = {} } = await chrome.storage.local.get('stats');
  if (stats[day] !== n) {
    stats[day] = n;
    const keys = Object.keys(stats).sort();
    while (keys.length > 60) delete stats[keys.shift()];
    await chrome.storage.local.set({ stats });
  }
}
chrome.tabs.onCreated.addListener(scheduleBadge);
chrome.tabs.onRemoved.addListener(scheduleBadge);

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
chrome.runtime.onInstalled.addListener(setup);
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
  if (alarm.name.startsWith('snooze:')) return wakeSnoozed(alarm.name.slice(7));
  if (alarm.name.startsWith('todo:')) {
    const id = alarm.name.slice(5);
    const { todos = [] } = await chrome.storage.local.get('todos');
    const t = todos.find(x => x.id === id);
    if (t && !t.done) remind(t);
  }
});

chrome.notifications.onClicked.addListener(async id => {
  chrome.notifications.clear(id);
  if (id === 'nudge') return openDashboard('#stale');
  if (id.startsWith('todo:')) {
    const { todos = [] } = await chrome.storage.local.get('todos');
    const t = todos.find(x => x.id === id.slice(5));
    if (t && t.url) chrome.tabs.create({ url: t.url });
    else openDashboard('#todos');
  }
});
