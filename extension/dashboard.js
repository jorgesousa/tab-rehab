'use strict';
// Tab Rehab dashboard
const SELF = chrome.runtime.getURL('dashboard.html');
const DAY = 864e5;
const $ = (s, el = document) => el.querySelector(s);

const S = {
  view: 'tabs', groupBy: 'site', q: '', sel: new Set(), collapsed: new Set(), groups: new Map(),
  tabs: [], sessions: [], todos: [], snoozed: [], closedLog: [], stats: {},
  settings: { staleDays: 7, nudge: true, budget: 30 }, recovery: {}, todoFilter: 'open',
  rehabSkip: new Set(), rehabDone: 0, rehabStart: 0
};

// ---------- utils ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function host(url) {
  try { const u = new URL(url); return u.hostname ? u.hostname.replace(/^www\./, '') : u.protocol.replace(':', ''); }
  catch { return 'other'; }
}
function norm(url) { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; } }
function fav(url) { return `${location.origin}/_favicon/?pageUrl=${encodeURIComponent(url || '')}&size=32`; }
function ago(ts) {
  if (!ts) return 'unknown';
  const m = (Date.now() - ts) / 6e4;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + ' min ago';
  if (m < 1440) return Math.round(m / 60) + ' h ago';
  const d = Math.round(m / 1440);
  return d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago';
}
function when(ts) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tmr = new Date(now.getTime() + DAY).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'today ' + time;
  if (tmr) return 'tomorrow ' + time;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
}
function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function preset(key) {
  const d = new Date();
  const at = (h, m = 0) => { d.setHours(h, m, 0, 0); };
  switch (key) {
    case '2h': return Date.now() + 2 * 3600e3;
    case 'tonight': at(20); if (d < new Date()) d.setDate(d.getDate() + 1); return +d;
    case 'tomorrow': d.setDate(d.getDate() + 1); at(9); return +d;
    case 'weekend': d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); at(10); return +d;
    case 'monday': d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7)); at(9); return +d;
    case 'month': d.setMonth(d.getMonth() + 1); at(9); return +d;
    default: return null;
  }
}
const isStale = t => t.lastAccessed && !t.pinned && !t.active && !t.audible && Date.now() - t.lastAccessed > S.settings.staleDays * DAY;
function isJunk(t) {
  const u = t.url || '';
  if (/^(chrome|edge|brave):\/\/newtab/.test(u) || u === 'about:blank' || u === '') return 'empty tab';
  try {
    const x = new URL(u);
    if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|search\.brave)\./.test(x.hostname) && (x.pathname === '/search' || x.pathname === '/' ) && (x.searchParams.get('q') || x.searchParams.get('p'))) return 'old search';
  } catch {}
  if (t.status === 'complete' && /^(Page not found|404|Error|This site can.t be reached)/i.test(t.title || '')) return 'error page';
  return null;
}
function dupInfo(tabs) {
  const by = new Map();
  for (const t of tabs) { const k = norm(t.url); if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
  const groups = [...by.values()].filter(g => g.length > 1)
    .map(g => g.sort((a, b) => (b.active - a.active) || (b.pinned - a.pinned) || ((b.lastAccessed || 0) - (a.lastAccessed || 0))));
  const extras = groups.flatMap(g => g.slice(1));
  return { groups, extras, ids: new Set(extras.map(t => t.id)) };
}
const match = (...fields) => !S.q || fields.join(' ').toLowerCase().includes(S.q);
const save = obj => chrome.storage.local.set(obj);
// Recovery counters: daily aggregates only, never URLs. Kept for 90 days, plus all-time totals.
async function track(kind, n = 1) {
  if (!n) return;
  const day = new Date().toLocaleDateString('sv');
  const { recovery = {} } = await chrome.storage.local.get('recovery');
  recovery.daily ||= {}; recovery.totals ||= {};
  (recovery.daily[day] ||= {})[kind] = (recovery.daily[day][kind] || 0) + n;
  recovery.totals[kind] = (recovery.totals[kind] || 0) + n;
  const keys = Object.keys(recovery.daily).sort();
  while (keys.length > 90) delete recovery.daily[keys.shift()];
  await save({ recovery });
}

let toastTimer;
function toast(msg, btnLabel, fn, link) {
  const el = $('#toast');
  $('#toast-msg').textContent = msg;
  const l = $('#toast-link'); l.hidden = !link;
  if (link) { l.textContent = link.label; l.href = '#' + link.view; l.onclick = () => { el.hidden = true; }; }
  const b = $('#toast-btn');
  b.hidden = !btnLabel; b.textContent = btnLabel || '';
  b.onclick = () => { el.hidden = true; fn && fn(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 15000);
}

// ---------- data ----------
async function load() {
  const [tabs, st] = await Promise.all([
    chrome.tabs.query({}),
    chrome.storage.local.get(['sessions', 'todos', 'snoozed', 'closedLog', 'settings', 'stats', 'recovery', 'whatsNew', 'best'])
  ]);
  S.tabs = tabs.filter(t => !(t.url || t.pendingUrl || '').startsWith(SELF));
  S.sessions = st.sessions || []; S.todos = st.todos || []; S.snoozed = st.snoozed || [];
  S.closedLog = st.closedLog || []; S.stats = st.stats || {}; S.recovery = st.recovery || {}; S.whatsNew = st.whatsNew || null; S.best = st.best ?? null;
  S.settings = { staleDays: 7, nudge: true, budget: 30, ...(st.settings || {}) };
  S.loaded = true;
  const ids = new Set(S.tabs.map(t => t.id));
  for (const id of S.sel) if (!ids.has(id)) S.sel.delete(id);
  render();
}
let loadTimer;
const reload = () => { clearTimeout(loadTimer); loadTimer = setTimeout(load, 200); };
const getTab = id => S.tabs.find(t => t.id === +id);

// ---------- restoring into the original windows ----------
// Window ids only survive until Chrome restarts, so every saved tab also records which "boot" it came from.
let BOOT;
function bootId() {
  return BOOT || (BOOT = (async () => {
    let { bootId: b } = await chrome.storage.session.get('bootId');
    if (!b) { b = uid(); await chrome.storage.session.set({ bootId: b }); }
    return b;
  })());
}
const origin = async t => ({ windowId: t.windowId, index: t.index, boot: await bootId() });
async function restoreItems(items) {
  const boot = await bootId();
  const open = new Set((await chrome.windows.getAll({ windowTypes: ['normal'] })).map(w => w.id));
  const groups = new Map();
  for (const t of items) {
    const alive = t.boot === boot && open.has(t.windowId);
    const key = alive ? t.windowId : 'new:' + (t.boot === boot ? t.windowId : 'old');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const [key, ts] of groups) {
    if (typeof key === 'number') {
      for (const t of ts.sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9))) {
        await chrome.tabs.create({ windowId: key, url: t.url, active: false, ...(t.index != null ? { index: t.index } : {}) });
      }
    } else {
      await chrome.windows.create({ url: ts.map(t => t.url), focused: false });
    }
  }
}

// ---------- actions ----------
async function closeTabs(tabs, verb = 'Closed') {
  if (!tabs.length) return;
  const boot = await bootId();
  const entries = tabs.filter(t => isJunk(t) !== 'empty tab').map(t => ({ title: t.title, url: t.url, closedAt: Date.now(), windowId: t.windowId, index: t.index, boot }));
  const { closedLog = [] } = await chrome.storage.local.get('closedLog');
  await save({ closedLog: [...entries, ...closedLog].slice(0, 1000) });
  await chrome.tabs.remove(tabs.map(t => t.id));
  await track('closed', tabs.length);
  tabs.forEach(t => S.sel.delete(t.id));
  toast(`${verb} ${tabs.length} tab${tabs.length > 1 ? 's' : ''}. Nothing is lost.`, 'Undo', async () => {
    await restoreItems(entries); await track('undone', entries.length);
    const { closedLog: cl = [] } = await chrome.storage.local.get('closedLog');
    await save({ closedLog: cl.filter(x => !entries.some(e => e.url === x.url && e.closedAt === x.closedAt)) });
  }, { label: 'Recently closed', view: 'closed' });
}

async function parkTabs(tabs, name) {
  if (!tabs.length) return;
  if (tabs.length > 10 && !confirm(`Park and close ${tabs.length} tabs?\n\nThey'll be saved in Parked & snoozed, and you can restore them any time.`)) return;
  const session = {
    id: uid(), createdAt: Date.now(),
    name: name || `Parked ${new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    tabs: await Promise.all(tabs.map(async t => ({ title: t.title || t.url, url: t.url, parkedAt: Date.now(), ...(await origin(t)) })))
  };
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  await save({ sessions: [session, ...sessions] });
  await chrome.tabs.remove(tabs.map(t => t.id));
  await track('parked', tabs.length);
  tabs.forEach(t => S.sel.delete(t.id));
  toast(`Parked ${tabs.length} tab${tabs.length > 1 ? 's' : ''} in "${session.name}".`, 'Undo', async () => {
    await restoreItems(session.tabs); await track('undone', session.tabs.length);
    const { sessions: ss = [] } = await chrome.storage.local.get('sessions');
    await save({ sessions: ss.filter(s => s.id !== session.id) });
  });
}

async function addTodosFromTabs(tabs) {
  const { todos = [] } = await chrome.storage.local.get('todos');
  const items = tabs.map(t => ({ id: uid(), kind: 'do', title: t.title || t.url, url: t.url, note: '', createdAt: Date.now(), remindAt: null, done: false }));
  await save({ todos: [...items, ...todos] });
  await chrome.tabs.remove(tabs.map(t => t.id));
  await track('todo', tabs.length);
  tabs.forEach(t => S.sel.delete(t.id));
  toast(`${tabs.length} tab${tabs.length > 1 ? 's are' : ' is'} now to-dos. Add notes and reminders in the To-dos view.`);
}

async function focusTab(t) {
  await chrome.tabs.update(t.id, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
}

// ---------- dialogs ----------
let todoCtx = null; // { tab } | { todo } | {}
function openTodoDlg(ctx = {}) {
  todoCtx = ctx;
  const f = $('#todo-form');
  f.reset();
  const src = ctx.todo || ctx.tab || {};
  f.title.value = ctx.todo ? src.title : (src.title || '');
  f.url.value = src.url || '';
  f.note.value = ctx.todo ? (src.note || '') : '';
  f.remindAt.value = ctx.todo ? toLocalInput(src.remindAt) : '';
  f.querySelector(`input[name=kind][value=${(ctx.todo && ctx.todo.kind) || 'do'}]`).checked = true;
  $('#close-wrap').hidden = !ctx.tab;
  $('#todo-h').textContent = ctx.todo ? 'Edit to-do' : ctx.tab ? 'Turn this tab into a to-do' : 'New to-do';
  $('#todo-dlg').showModal();
  f.note.focus();
}
$('#todo-dlg').addEventListener('close', async () => {
  if ($('#todo-dlg').returnValue !== 'save') return;
  const f = $('#todo-form');
  const data = {
    kind: f.kind.value, title: f.title.value.trim(), url: f.url.value.trim(), note: f.note.value.trim(),
    remindAt: f.remindAt.value ? new Date(f.remindAt.value).getTime() : null
  };
  const { todos = [] } = await chrome.storage.local.get('todos');
  if (todoCtx.todo) {
    const t = todos.find(x => x.id === todoCtx.todo.id);
    if (t) Object.assign(t, data, { notified: false });
    await save({ todos });
  } else {
    await save({ todos: [{ id: uid(), createdAt: Date.now(), done: false, ...data }, ...todos] });
    if (todoCtx.tab && f.closeTab.checked) {
      await chrome.tabs.remove(todoCtx.tab.id).catch(() => {});
      await track('todo');
      S.rehabDone += S.view === 'rehab' ? 1 : 0;
    }
    toast(data.remindAt ? `Saved. I'll remind you ${when(data.remindAt)}.` : 'Saved to your to-dos.');
  }
});

let snoozeCtx = [];
function openSnoozeDlg(tabs) {
  snoozeCtx = tabs;
  const f = $('#snooze-form'); f.reset();
  f.wakeAt.value = toLocalInput(preset('tomorrow'));
  $('#snooze-h').textContent = tabs.length > 1 ? `Snooze ${tabs.length} tabs` : 'Snooze: ' + (tabs[0].title || '').slice(0, 50);
  $('#snooze-dlg').showModal();
}
$('#snooze-dlg').addEventListener('close', async () => {
  if ($('#snooze-dlg').returnValue !== 'save') return;
  const wakeAt = new Date($('#snooze-form').wakeAt.value).getTime();
  if (!wakeAt) return;
  const { snoozed = [] } = await chrome.storage.local.get('snoozed');
  const items = await Promise.all(snoozeCtx.map(async t => ({ id: uid(), title: t.title || t.url, url: t.url, wakeAt, snoozedAt: Date.now(), ...(await origin(t)) })));
  await save({ snoozed: [...snoozed, ...items] });
  await chrome.tabs.remove(snoozeCtx.map(t => t.id)).catch(() => {});
  await track('snoozed', snoozeCtx.length);
  snoozeCtx.forEach(t => S.sel.delete(t.id));
  if (S.view === 'rehab') S.rehabDone += snoozeCtx.length;
  toast(`Snoozed until ${when(wakeAt)}. It will reopen by itself.`);
});

document.querySelectorAll('.quick').forEach(q => q.addEventListener('click', e => {
  const b = e.target.closest('[data-when]'); if (!b) return;
  const input = q.closest('form')[q.dataset.target];
  input.value = toLocalInput(preset(b.dataset.when));
}));

// ---------- bookmarks ----------
let bmCtx = null; // { tabs } | { session }, plus suggested folder name
const bookmarkable = u => u && !/^(about:|chrome:\/\/newtab|edge:\/\/newtab)/.test(u);
async function homeFolder() {
  const found = (await chrome.bookmarks.search({ title: 'Tab Rehab' })).find(n => !n.url);
  return found || chrome.bookmarks.create({ title: 'Tab Rehab' }); // lands in "Other bookmarks"
}
async function openBmDlg(ctx) {
  bmCtx = ctx;
  const items = ctx.session ? ctx.session.tabs : ctx.tabs;
  const home = await homeFolder();
  const [root] = await chrome.bookmarks.getTree();
  const opts = [];
  (function walk(nodes, depth) {
    for (const n of nodes) {
      if (n.url) continue;
      if (n.id !== root.id) opts.push(`<option value="${n.id}" ${n.id === home.id ? 'selected' : ''}>${'\u2003'.repeat(Math.max(depth - 1, 0))}${esc(n.title || 'Bookmarks')}</option>`);
      if (n.children) walk(n.children, depth + 1);
    }
  })([root], 0);
  const f = $('#bm-form'); f.reset();
  f.parent.innerHTML = opts.join('');
  f.folder.value = ctx.folder || '';
  $('#bm-h').textContent = items.length > 1 ? `Bookmark ${items.length} tabs` : 'Bookmark: ' + (items[0].title || '').slice(0, 50);
  $('#bm-sub').textContent = 'Bookmarks are for things worth keeping for good. They sync to your other devices through your Chrome account.';
  $('#bm-close-label').textContent = ctx.session ? 'Remove this list from Parked after saving' : `Close the tab${items.length > 1 ? 's' : ''} after saving`;
  $('#bm-dlg').showModal();
}
$('#bm-dlg').addEventListener('close', async () => {
  if ($('#bm-dlg').returnValue !== 'save' || !bmCtx) return;
  const f = $('#bm-form');
  const items = (bmCtx.session ? bmCtx.session.tabs : bmCtx.tabs).filter(t => bookmarkable(t.url));
  let parentId = f.parent.value;
  const sub = f.folder.value.trim();
  if (sub) {
    const kids = await chrome.bookmarks.getChildren(parentId);
    const existing = kids.find(k => !k.url && k.title === sub);
    parentId = existing ? existing.id : (await chrome.bookmarks.create({ parentId, title: sub })).id;
  }
  const already = new Set((await chrome.bookmarks.getChildren(parentId)).map(k => k.url));
  let n = 0;
  for (const t of items) {
    if (already.has(t.url)) continue;
    await chrome.bookmarks.create({ parentId, title: t.title || t.url, url: t.url });
    already.add(t.url); n++;
  }
  if (f.closeAfter.checked) {
    if (bmCtx.session) await save({ sessions: S.sessions.filter(s => s.id !== bmCtx.session.id) });
    else {
      await chrome.tabs.remove(bmCtx.tabs.map(t => t.id)).catch(() => {});
      await track('bookmarked', bmCtx.tabs.length);
      bmCtx.tabs.forEach(t => S.sel.delete(t.id));
      if (S.view === 'rehab') S.rehabDone += bmCtx.tabs.length;
    }
  }
  const path = [...f.parent.selectedOptions][0].textContent.trim() + (sub ? ' › ' + sub : '');
  toast(`Saved ${n} bookmark${n !== 1 ? 's' : ''} in "${path}"${items.length - n ? ` (${items.length - n} already there)` : ''}.`, 'Show',
    () => chrome.tabs.create({ url: 'chrome://bookmarks/?id=' + parentId }));
});

// ---------- rendering ----------
function tabRow(t, dupIds) {
  const junk = isJunk(t);
  const badges = [
    t.pinned && '<span class="b">pinned</span>',
    t.audible && '<span class="b ok">playing</span>',
    dupIds.has(t.id) && '<span class="b warn">duplicate</span>',
    junk && `<span class="b warn">${junk}</span>`,
    isStale(t) && '<span class="b danger">stale</span>',
    t.discarded && '<span class="b">asleep</span>'
  ].filter(Boolean).join('');
  return `<div class="row ${S.sel.has(t.id) ? 'sel' : ''}" data-tab="${t.id}">
    <input type="checkbox" data-a="sel" ${S.sel.has(t.id) ? 'checked' : ''} aria-label="Select">
    <img class="fav" src="${fav(t.url)}" alt="">
    <div class="main" data-a="go" title="${esc(t.url)}"><div class="title">${esc(t.title || t.url)}</div>
      <div class="meta">${esc(host(t.url))} · ${t.active ? 'active now' : 'last seen ' + ago(t.lastAccessed)}</div></div>
    <div class="badges">${badges}</div>
    <div class="acts">
      <button data-a="todo" title="Turn into a to-do and close">To-do</button>
      <button data-a="snooze" title="Close now, reopen later">Snooze</button>
      <button data-a="park" title="Save to a list and close">Park</button>
      <button data-a="bookmark" title="Save as a bookmark">★</button>
      <button data-a="close" class="x" title="Close (undo available)">✕</button>
    </div></div>`;
}

function groupBlock(key, label, tabs, dupIds, icon) {
  S.groups.set(key, tabs.map(t => t.id));
  const col = S.collapsed.has(key);
  return `<div class="group ${col ? 'collapsed' : ''}" data-key="${esc(key)}">
    <div class="ghead">
      <button class="caret" data-a="toggle">${col ? '▸' : '▾'}</button>
      ${icon ? `<img class="fav" src="${fav(icon)}" alt="">` : ''}
      <b>${esc(label)}</b><span class="n">${tabs.length} tab${tabs.length > 1 ? 's' : ''}</span>
      <button data-a="gsel">Select</button><button data-a="gbm">Bookmark all</button><button data-a="gpark">Park all</button><button data-a="gclose" class="danger">Close all</button>
    </div>
    <div class="rows">${tabs.map(t => tabRow(t, dupIds)).join('')}</div></div>`;
}

const empty = (title, text) => `<div class="empty"><b>${title}</b>${text}</div>`;

function renderTabs(tabs, dup) {
  const shown = tabs.filter(t => match(t.title, t.url));
  const tb = `<h2>Open tabs</h2>
    <div class="seg"><button data-a="groupby" data-v="site" class="${S.groupBy === 'site' ? 'on' : ''}">By site</button><button data-a="groupby" data-v="window" class="${S.groupBy === 'window' ? 'on' : ''}">By window</button></div>
    <button data-a="collapse-all">Collapse all</button><button data-a="expand-all">Expand all</button>
    <button data-a="sel-all">Select all ${shown.length}</button>`;
  if (!shown.length) return [tb, empty(S.q ? 'No matching tabs' : 'Zero tabs open', S.q ? 'Try another search.' : 'You are free.')];
  let html = '';
  if (S.groupBy === 'site') {
    const by = new Map();
    for (const t of shown) { const h = host(t.url); if (!by.has(h)) by.set(h, []); by.get(h).push(t); }
    const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
    const big = sorted.filter(([, ts]) => ts.length > 1), singles = sorted.filter(([, ts]) => ts.length === 1).flatMap(([, ts]) => ts);
    html = big.map(([h, ts]) => groupBlock('site:' + h, h, ts, dup.ids, ts[0].url)).join('');
    if (singles.length) html += groupBlock('site:*singles', 'One-off sites', singles, dup.ids);
  } else {
    const wins = [...new Set(shown.map(t => t.windowId))];
    html = wins.map((w, i) => {
      const ts = shown.filter(t => t.windowId === w).sort((a, b) => a.index - b.index);
      const active = ts.find(t => t.active);
      return groupBlock('win:' + w, `Window ${i + 1}${active ? ' · ' + (active.title || '').slice(0, 40) : ''}`, ts, dup.ids);
    }).join('');
  }
  return [tb, html];
}

function renderStale(tabs, dup) {
  const stale = tabs.filter(isStale).filter(t => match(t.title, t.url)).sort((a, b) => a.lastAccessed - b.lastAccessed);
  const opts = [1, 3, 7, 14, 30].map(d => `<option value="${d}" ${S.settings.staleDays === d ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('');
  const tb = `<h2>Stale tabs</h2>
    <label class="muted">Not opened for <select data-a="staledays">${opts}</select></label>
    ${stale.length ? `<button data-a="rehab">Review one by one</button><button data-a="park-stale" class="primary">Park all ${stale.length}</button>` : ''}
    <div class="sub">If you haven't looked at a tab in ${S.settings.staleDays} days, it isn't helping you. Park them: they stay searchable here and can be restored any time. Pinned and playing tabs are never included.</div>`;
  if (!stale.length) return [tb, empty('No stale tabs', `Everything has been opened in the last ${S.settings.staleDays} days.`)];
  return [tb, groupBlock('stale', `Untouched for ${S.settings.staleDays}+ days, oldest first`, stale, dup.ids)];
}

function renderWins(tabs, dup) {
  const junk = tabs.filter(t => isJunk(t) && !t.active && !t.pinned).filter(t => match(t.title, t.url));
  const extras = dup.extras.filter(t => match(t.title, t.url));
  const n = junk.length + extras.length;
  const tb = `<h2>Quick wins</h2>${n ? `<button data-a="close-wins" class="primary">Close all ${n} safely</button>` : ''}
    <div class="sub">Tabs you can close with zero risk: duplicates of a tab you already have open, empty new-tab pages, old search results and error pages. Every close can be undone.</div>`;
  if (!n) return [tb, empty('Nothing to clean', 'No duplicates or junk tabs right now.')];
  let html = '';
  if (extras.length) html += `<h3 class="sec">Duplicates: ${extras.length} extra copies (the most recent copy is kept)</h3>` + groupBlock('dupes', 'Duplicate copies', extras, dup.ids);
  if (junk.length) html += `<h3 class="sec">Junk tabs</h3>` + groupBlock('junk', 'Empty, search-result and error pages', junk, dup.ids);
  return [tb, html];
}

function savedRow(item, attrs, meta, extraBtns = '') {
  return `<div class="row" ${attrs}>
    <img class="fav" src="${fav(item.url)}" alt="">
    <div class="main" data-a="restore" title="${esc(item.url)}"><div class="title">${esc(item.title || item.url)}</div><div class="meta">${esc(host(item.url))} · ${meta}</div></div>
    <div class="acts">${extraBtns}<button data-a="restore">Open</button><button data-a="del" class="x" title="Delete">✕</button></div></div>`;
}

function renderParked() {
  const tb = `<h2>Parked &amp; snoozed</h2>${S.sessions.length ? '' : ''}
    <div class="sub">Parked tabs are safe here forever (and in your exported backups). Click a tab to reopen it.</div>`;
  let html = '';
  const snz = S.snoozed.filter(s => match(s.title, s.url)).sort((a, b) => a.wakeAt - b.wakeAt);
  if (snz.length) {
    html += `<h3 class="sec">Snoozed: they come back by themselves</h3><div class="group"><div class="rows">` +
      snz.map(s => savedRow(s, `data-snz="${s.id}"`, `back ${when(s.wakeAt)}`, '<button data-a="wake">Wake now</button>')).join('') + '</div></div>';
  }
  const sessions = S.sessions.map(s => ({ ...s, shown: s.tabs.map((t, i) => ({ ...t, i })).filter(t => match(t.title, t.url, s.name)) })).filter(s => s.shown.length);
  if (sessions.length) {
    html += `<h3 class="sec">Parked lists</h3>` + sessions.map(s => `
      <div class="group" data-sid="${s.id}">
        <div class="ghead"><b>${esc(s.name)}</b><span class="n">${s.tabs.length} tab${s.tabs.length > 1 ? 's' : ''} · ${ago(s.createdAt)}</span>
          <button data-a="rename">Rename</button><button data-a="sbm">Save as bookmarks</button><button data-a="srestore" title="Back to the windows they came from (or a new window if that one is gone)">Restore all</button><button data-a="sdel" class="danger">Delete list</button></div>
        <div class="rows">${s.shown.map(t => savedRow(t, `data-i="${t.i}"`, 'parked ' + ago(t.parkedAt || s.createdAt))).join('')}</div>
      </div>`).join('');
  }
  if (!html) html = empty('Nothing parked yet', 'Use "Park" on any tab or group to save it and close it. Nothing gets lost.');
  return [tb, html];
}

// Your safety net: everything Tab Rehab closed for you, newest first, grouped by day.
function renderClosed() {
  const all = S.closedLog, shown = all.filter(c => match(c.title, c.url));
  const t = (S.recovery.totals || {}), back = (t.restored || 0) + (t.undone || 0);
  const tb = `<h2>Recently closed</h2>${all.length ? '<button data-a="clear-closed">Clear the list</button>' : ''}
    <div class="sub">Your safety net. Every tab Tab Rehab closes lands here first, so letting go is never a gamble. Click one to reopen it where it was.${back ? ` So far you've needed ${back} back.` : ''}</div>`;
  if (!shown.length) return [tb, empty(S.q ? 'No matching tabs' : 'Nothing closed yet', S.q ? 'Try another search.' : 'When Tab Rehab closes a tab, it waits here in case you change your mind.')];
  const day = ts => { const d = new Date(ts), now = new Date(); if (d.toDateString() === now.toDateString()) return 'Today'; if (new Date(now - DAY).toDateString() === d.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }); };
  const by = new Map();
  shown.forEach(c => { const k = day(c.closedAt); if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
  const html = [...by].map(([k, cs]) => `<h3 class="sec">${esc(k)} · ${cs.length}</h3><div class="group"><div class="rows">${cs.map(c => savedRow(c, `data-ci="${all.indexOf(c)}"`, 'closed ' + ago(c.closedAt))).join('')}</div></div>`).join('');
  return [tb, html];
}

function renderTodos() {
  const list = S.todos.filter(t => (S.todoFilter === 'done' ? t.done : !t.done)).filter(t => match(t.title, t.url, t.note));
  list.sort((a, b) => (a.remindAt || Infinity) - (b.remindAt || Infinity) || b.createdAt - a.createdAt);
  const open = S.todos.filter(t => !t.done).length, done = S.todos.length - open;
  const tb = `<h2>To-dos</h2>
    <div class="seg"><button data-a="tfilter" data-v="open" class="${S.todoFilter === 'open' ? 'on' : ''}">Open (${open})</button><button data-a="tfilter" data-v="done" class="${S.todoFilter === 'done' ? 'on' : ''}">Done (${done})</button></div>
    <button data-a="new-todo" class="primary">+ New to-do</button>
    <div class="sub">A tab kept open "so I don't forget" belongs here: a note, a link and a reminder, without the open tab.</div>`;
  if (!list.length) return [tb, empty(S.todoFilter === 'open' ? 'No open to-dos' : 'Nothing done yet', 'Use "To-do" on any tab to turn it into a task with a reminder.')];
  const html = '<div class="group"><div class="rows">' + list.map(t => {
    const overdue = !t.done && t.remindAt && t.remindAt < Date.now();
    return `<div class="row todo ${t.done ? 'done' : ''}" data-todo="${t.id}">
      <input type="checkbox" data-a="tdone" ${t.done ? 'checked' : ''} aria-label="Done">
      ${t.url ? `<img class="fav" src="${fav(t.url)}" alt="">` : ''}
      <div class="main" data-a="topen"><div class="title">${esc(t.title)}</div>
        ${t.note ? `<div class="meta note">${esc(t.note)}</div>` : ''}
        <div class="meta">${t.url ? esc(host(t.url)) + ' · ' : ''}added ${ago(t.createdAt)}</div></div>
      <div class="badges">${t.kind === 'read' ? '<span class="b">read later</span>' : ''}${t.remindAt ? `<span class="b ${overdue ? 'danger' : 'ok'}">${overdue ? 'overdue · ' : ''}${when(t.remindAt)}</span>` : ''}</div>
      <div class="acts"><button data-a="tedit">Edit</button><button data-a="tdel" class="x" title="Delete">✕</button></div></div>`;
  }).join('') + '</div></div>';
  return [tb, html];
}

function rehabQueue(tabs) {
  const cand = tabs.filter(t => !t.pinned && !t.active && !t.audible && !S.rehabSkip.has(t.id));
  return cand.sort((a, b) => (isStale(b) - isStale(a)) || ((a.lastAccessed || 0) - (b.lastAccessed || 0)));
}
function renderRehab(tabs, dup) {
  const q = rehabQueue(tabs);
  if (!S.rehabStart) S.rehabStart = tabs.length;
  const total = S.rehabDone + q.length;
  const pct = total ? Math.round((S.rehabDone / total) * 100) : 100;
  const tb = `<h2>Rehab session</h2><div class="sub">One tab at a time, oldest first. Decide what each one is really for. Use the keyboard to go fast.</div>`;
  const t = q[0];
  if (!t) return [tb, `<div class="rehab">${empty('Session complete', `You handled ${S.rehabDone} tabs. Only pinned, playing, the current tab and tabs you chose to keep are left.`)}</div>`];
  const why = [
    isStale(t) && `<span class="b danger">not opened for ${ago(t.lastAccessed).replace(' ago', '')}</span>`,
    dup.ids.has(t.id) && '<span class="b warn">you have another copy open</span>',
    isJunk(t) && `<span class="b warn">${isJunk(t)}</span>`
  ].filter(Boolean).join('') || `<span class="b">last seen ${ago(t.lastAccessed)}</span>`;
  return [tb, `<div class="rehab" data-tab="${t.id}">
    <div class="muted">${S.rehabDone} handled · ${q.length} to go</div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="card"><div class="h"><img src="${fav(t.url)}" alt=""><div><div class="t">${esc(t.title || t.url)}</div><div class="u">${esc(t.url)}</div></div></div>
      <div class="why">${why}</div>
      <div class="choices">
        <button data-a="r-keep">Keep<kbd>K</kbd></button>
        <button data-a="todo">To-do<kbd>T</kbd></button>
        <button data-a="snooze">Snooze<kbd>S</kbd></button>
        <button data-a="bookmark">Bookmark<kbd>B</kbd></button>
        <button data-a="r-park" class="park">Park<kbd>P</kbd></button>
        <button data-a="r-close" class="close">Close<kbd>C</kbd></button>
      </div>
      <div style="margin-top:12px;text-align:center"><button class="link" data-a="go">Peek at the tab (O)</button></div>
    </div>
    <div class="stats">Keep = I'm actively using it · To-do = I kept it to remember something · Snooze = not now, later · Bookmark = worth keeping for good · Park = maybe someday</div>
  </div>`];
}

function renderHealth() {
  const n = S.tabs.length, wins = new Set(S.tabs.map(t => t.windowId)).size;
  const days = Object.keys(S.stats).sort().slice(-14);
  const vals = days.map(d => S.stats[d]);
  const prev = vals.length > 1 ? vals[vals.length - 2] : null;
  let trend = '';
  if (prev != null) {
    const d = n - prev;
    trend = d < 0 ? `<div class="trend down">▼ ${-d} since yesterday. Nice work.</div>` : d > 0 ? `<div class="trend up">▲ ${d} since yesterday</div>` : '<div class="muted">Same as yesterday</div>';
  }
  let spark = '';
  if (vals.length > 1) {
    const max = Math.max(...vals), min = Math.min(...vals), w = 200, h = 36;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 3 - ((v - min) / (max - min || 1)) * (h - 6)}`).join(' ');
    spark = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" opacity=".6"/></svg>`;
  }
  $('#health').innerHTML = `<div class="big">${n}</div><div class="muted">tabs in ${wins} window${wins !== 1 ? 's' : ''}</div>${trend}${spark}<div class="door">Your recovery →</div>`;
  $('#health').classList.toggle('on', S.view === 'recovery');
}

// ---------- Relapse alert settings (logic lives in background.js) ----------
const ALERT_DEFAULTS = { enabled: true, quietFrom: '22:00', quietTo: '08:00', weekendQuiet: false, pausedUntil: 0 };
const alerts = () => ({ ...ALERT_DEFAULTS, ...(S.settings.alerts || {}) });
function settingRow(title, desc, control, dim = false) {
  return `<label class="row srow ${dim ? 'dim' : ''}"><div class="main"><div class="title">${title}</div><div class="meta">${desc}</div></div><div class="sctl">${control}</div></label>`;
}
const toggle = (attr, on) => `<input type="checkbox" class="switch" ${attr} ${on ? 'checked' : ''}>`;
function alertsSection() {
  const a = alerts(), best = S.best, budget = S.settings.budget;
  const paused = Date.now() < a.pausedUntil;
  const threshold = best == null ? budget + 15 : Math.max(best + 15, budget + 1);
  const status = !a.enabled ? 'Off. Your badge still changes colour.' : paused ? `Paused until ${when(a.pausedUntil)}.` : `On. Your best is ${best ?? S.tabs.length} tabs, so the next nudge comes at ${threshold}.`;
  const off = !a.enabled;
  return `<h3 class="sec">Relapse alerts</h3>
    <div class="group"><div class="ghead"><b>${status}</b>
      ${paused ? '<button data-a="al-resume">Resume</button>' : `<button data-a="al-pause" data-days="1" ${off ? 'disabled' : ''}>Pause 1 day</button><button data-a="al-pause" data-days="7" ${off ? 'disabled' : ''}>Pause 1 week</button>`}
      <button data-a="al-preview">Preview the nudge</button></div>
    <div class="rows">
      ${settingRow('Relapse alerts', "One gentle notification when you're collecting again. Never shaming, never twice a day.", toggle('data-al="enabled"', a.enabled))}
      ${settingRow('How it decides', `Only when you're climbing back up: 15+ tabs above your best (the lowest you've held over the last two weeks). Your best only goes down. Coming down from a big number never triggers a nudge.`, '', off)}
      ${settingRow('Quiet hours', 'No nudges in this window.', `<input type="time" data-al="quietFrom" value="${a.quietFrom}"> <span class="muted">to</span> <input type="time" data-al="quietTo" value="${a.quietTo}">`, off)}
      ${settingRow('All weekend', 'Weekends are for recovery too.', toggle('data-al="weekendQuiet"', a.weekendQuiet), off)}
    </div></div>`;
}
async function saveAlerts(patch) {
  S.settings.alerts = { ...alerts(), ...patch };
  await save({ settings: S.settings });
}
$('#view').addEventListener('change', e => {
  const k = e.target.dataset.al; if (!k) return;
  saveAlerts({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
});

function renderSettings() {
  const st = S.settings;
  const tb = `<h2>Settings</h2><div class="sub">Everything here stays on this device. What happens in rehab stays in rehab.</div>`;
  const sel = (a, vals, cur, fmt = v => v) => `<select data-a="${a}">${vals.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select>`;
  const tidy = `<h3 class="sec">Tidying</h3><div class="group"><div class="rows">
    ${settingRow('Tab budget', 'Your badge is green under this, amber above it, red at twice. Recovery counts your days under it.', sel('budget', [10, 20, 30, 40, 50, 75, 100], st.budget, v => v + ' tabs'))}
    ${settingRow('Daily stale reminder', `One notification when 5 or more tabs go untouched for ${st.staleDays}+ days (change it in <a href="#stale">Stale</a>).`, toggle('data-a="nudge"', st.nudge !== false))}
  </div></div>`;
  const data = `<h3 class="sec">Your data</h3><div class="group"><div class="rows">
    ${settingRow('Backup', 'Open tabs, parked lists, snoozes, to-dos and your Recovery history, as one JSON file.', '<button data-a="do-export">Export</button>')}
    ${settingRow('Restore', 'Merges a backup into what you have. It never deletes anything.', '<button data-a="do-import">Import</button>')}
  </div></div>`;
  return [tb, alertsSection() + tidy + data];
}

const LET_GO = ['closed', 'parked', 'snoozed', 'todo', 'bookmarked'];
function renderRecovery() {
  const n = S.tabs.length, budget = S.settings.budget;
  const days = Object.keys(S.stats).sort();
  const today = new Date().toLocaleDateString('sv');
  const start = S.recovery.start || (days.length && days[0] !== today ? { day: days[0], tabs: S.stats[days[0]] } : { day: today, tabs: n });
  if (!S.recovery.start && S.loaded) { S.recovery.start = start; save({ recovery: S.recovery }); } // only once real data is in
  // streak: consecutive days (ending today) at or under budget
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i] === today ? n : S.stats[days[i]];
    if (v > budget) break; streak++;
  }
  let best = 0, run = 0;
  for (const d of days) { run = S.stats[d] <= budget ? run + 1 : 0; best = Math.max(best, run); }
  const vals = days.slice(-30).map(d => S.stats[d]);
  let chart = '';
  if (vals.length > 1) {
    const w = 600, h = 120, max = Math.max(...vals, budget) * 1.1;
    const x = i => (i / (vals.length - 1)) * w, y = v => h - (v / max) * h;
    chart = `<svg class="rchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Tab count, last ${vals.length} days">
      <line x1="0" x2="${w}" y1="${y(budget)}" y2="${y(budget)}" class="budget" vector-effect="non-scaling-stroke"/>
      <polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <div class="muted small">Last ${vals.length} days · dashed line = your budget of ${budget}</div>`;
  }
  const diff = start.tabs - n;
  const q1 = `<div class="rcard"><div class="rq">Am I getting better?</div>
    <div class="rbig">You started at ${start.tabs}. Today: ${n}.</div>
    <div class="muted">${diff > 0 ? `${diff} fewer tabs than day one. That's real progress.` : diff < 0 ? `${-diff} more than day one. Relapse happens. It's part of recovery, not the end of it.` : 'Holding steady. One tab at a time.'}</div>
    <div class="rchips"><span class="b ${streak ? 'ok' : ''}">${streak} day${streak !== 1 ? 's' : ''} under budget</span>${best > streak ? `<span class="b">best: ${best} days</span>` : ''}
      <span class="muted">Budget: ${budget} tabs · <a href="#settings">change</a></span></div>
    ${chart}
    <div class="ract"><button class="primary" data-a="rehab">Start a Rehab session</button></div></div>`;
  const t = S.recovery.totals || {};
  const letGo = LET_GO.reduce((a, k) => a + (t[k] || 0), 0);
  const back = (t.restored || 0) + (t.undone || 0);
  const pct = letGo ? Math.round((back / letGo) * 1000) / 10 : 0;
  const LABEL = { closed: 'closed', parked: 'parked', snoozed: 'snoozed', todo: 'turned into to-dos', bookmarked: 'bookmarked' };
  const parts = LET_GO.filter(k => t[k]).map(k => `${t[k]} ${LABEL[k]}`).join(' · ');
  const q2 = `<div class="rcard"><div class="rq">Was it safe to let go?</div>
    ${letGo ? `<div class="rbig">You've let go of ${letGo} tab${letGo !== 1 ? 's' : ''}. You needed ${back} back.</div>
    <div class="muted">${parts}. That's ${pct}% you ever reopened${back <= letGo * 0.05 ? ': the fear of losing them was louder than the need.' : '.'}</div>
    <div class="ract"><a href="#closed">See what you let go →</a></div>
    ${back <= letGo * 0.05 && letGo >= 20 && S.settings.staleDays > 5 ? `<div class="ract"><button data-a="lower-stale">Lower your stale limit to 5 days?</button></div>` : ''}`
    : `<div class="rbig">Nothing let go yet.</div><div class="muted">Close, park, snooze or bookmark a few tabs. This card will show how many you ever needed back. (Spoiler: almost none.)</div>`}
  </div>`;
  const tb = `<h2>Recovery</h2><div class="sub">Your recovery journal. Counted on this device only, never sent anywhere. What happens in rehab stays in rehab.</div>`;
  return [tb, `<div class="recovery">${q1}${q2}</div>`];
}

// ---------- What's new (shown once after an update, never as a pop-up) ----------
const WHATS_NEW = {
  '0.4.0': { title: 'New: Relapse alerts', text: 'One gentle nudge when you start climbing back up, measured against your own best. Never in quiet hours, easy to pause.', view: 'settings', cta: 'Set them up' },
  '0.3.0': { title: 'New: Recovery', text: 'See how far you\'ve come, and how many of the tabs you let go you ever needed back. (Spoiler: almost none.)', view: 'recovery', cta: 'Open Recovery' }
};
function renderWhatsNew() {
  const el = $('#whatsnew'), w = S.whatsNew, note = w && WHATS_NEW[w.version];
  el.hidden = !note;
  if (!note) return;
  el.innerHTML = `<span class="wn-tag">Updated to ${esc(w.version)}</span><div class="wn-body"><b>${esc(note.title)}</b> ${esc(note.text)}</div>
    ${note.view ? `<a class="wn-cta" href="#${note.view}" data-wn="go">${esc(note.cta)}</a>` : ''}<button class="wn-x" data-wn="x" title="Dismiss" aria-label="Dismiss">✕</button>`;
}
$('#whatsnew').addEventListener('click', e => {
  const b = e.target.closest('[data-wn]'); if (!b) return;
  S.whatsNew = null; chrome.storage.local.remove('whatsNew'); renderWhatsNew();
});

function render() {
  const tabs = S.tabs, dup = dupInfo(tabs);
  S.groups.clear();
  const stale = tabs.filter(isStale).length;
  const wins = dup.extras.length + tabs.filter(t => isJunk(t) && !t.active && !t.pinned).length;
  const parked = S.sessions.reduce((a, s) => a + s.tabs.length, 0) + S.snoozed.length;
  $('#c-tabs').textContent = tabs.length;
  $('#c-stale').textContent = stale || '';
  $('#c-wins').textContent = wins || '';
  $('#c-parked').textContent = parked || '';
  $('#c-todos').textContent = S.todos.filter(t => !t.done).length || '';
  $('#c-closed').textContent = S.closedLog.length || '';
  document.querySelectorAll('#nav a, .nav-foot a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
  renderHealth();
  renderWhatsNew();
  const fn = { tabs: renderTabs, stale: renderStale, wins: renderWins, parked: renderParked, todos: renderTodos, closed: renderClosed, rehab: renderRehab, recovery: renderRecovery, settings: renderSettings }[S.view] || renderTabs;
  const [tb, html] = fn(tabs, dup);
  $('#toolbar').innerHTML = tb;
  const scroll = window.scrollY;
  $('#view').innerHTML = html;
  window.scrollTo(0, scroll);
  $('#bulk').hidden = !S.sel.size;
  $('#bulk-n').textContent = `${S.sel.size} selected`;
  document.title = `Tab Rehab (${tabs.length})`;
}

// ---------- events ----------
async function onAction(e) {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a;
  const tabEl = el.closest('[data-tab]');
  const tab = tabEl && getTab(tabEl.dataset.tab);
  const groupEl = el.closest('[data-key]');
  const gtabs = () => (S.groups.get(groupEl.dataset.key) || []).map(getTab).filter(Boolean);
  const sEl = el.closest('[data-sid]');
  const session = sEl && S.sessions.find(s => s.id === sEl.dataset.sid);
  const todoEl = el.closest('[data-todo]');
  const todo = todoEl && S.todos.find(t => t.id === todoEl.dataset.todo);

  switch (a) {
    case 'sel': S.sel.has(tab.id) ? S.sel.delete(tab.id) : S.sel.add(tab.id); return render();
    case 'go': return tab && focusTab(tab);
    case 'todo': return tab && openTodoDlg({ tab });
    case 'snooze': return tab && openSnoozeDlg([tab]);
    case 'park': return parkTabs([tab]);
    case 'bookmark': return tab && openBmDlg({ tabs: [tab], folder: '' });
    case 'close': return closeTabs([tab]);
    case 'toggle': { const k = groupEl.dataset.key; S.collapsed.has(k) ? S.collapsed.delete(k) : S.collapsed.add(k); return render(); }
    case 'gsel': { const ts = gtabs(); const all = ts.every(t => S.sel.has(t.id)); ts.forEach(t => all ? S.sel.delete(t.id) : S.sel.add(t.id)); return render(); }
    case 'gbm': { const label = groupEl.querySelector('b').textContent; return openBmDlg({ tabs: gtabs(), folder: label }); }
    case 'gpark': { const ts = gtabs(); const label = groupEl.querySelector('b').textContent; return parkTabs(ts, groupEl.dataset.key.startsWith('site:') && !groupEl.dataset.key.includes('*') ? label : undefined); }
    case 'gclose': { const ts = gtabs(); if (ts.length > 5 && !confirm(`Close ${ts.length} tabs? (You can still undo or restore them from "Recently closed".)`)) return; return closeTabs(ts); }
    case 'groupby': S.groupBy = el.dataset.v; return render();
    case 'collapse-all': [...S.groups.keys()].forEach(k => S.collapsed.add(k)); return render();
    case 'expand-all': S.collapsed.clear(); return render();
    case 'sel-all': S.tabs.filter(t => match(t.title, t.url)).forEach(t => S.sel.add(t.id)); return render();
    case 'park-stale': return parkTabs(S.tabs.filter(isStale), `Stale tabs (${S.settings.staleDays}+ days) · ${new Date().toLocaleDateString()}`);
    case 'rehab': location.hash = 'rehab'; return;
    case 'close-wins': { const dup = dupInfo(S.tabs); return closeTabs([...dup.extras, ...S.tabs.filter(t => isJunk(t) && !t.active && !t.pinned && !dup.ids.has(t.id))]); }
    // rehab
    case 'r-keep': S.rehabSkip.add(tab.id); S.rehabDone++; return render();
    case 'r-park': S.rehabDone++; return parkTabs([tab], 'Rehab session · ' + new Date().toLocaleDateString()).then(mergeRehabSessions);
    case 'r-close': S.rehabDone++; return closeTabs([tab]);
    // parked
    case 'restore': case 'del': {
      const row = el.closest('.row');
      if (row.dataset.snz) {
        const s = S.snoozed.find(x => x.id === row.dataset.snz);
        if (a === 'restore') await restoreItems([s]);
        return save({ snoozed: S.snoozed.filter(x => x.id !== s.id) });
      }
      if (row.dataset.ci != null) {
        const c = S.closedLog[+row.dataset.ci];
        if (a === 'restore') { await restoreItems([c]); await track('restored'); }
        return save({ closedLog: S.closedLog.filter(x => x !== c) });
      }
      if (session) {
        const i = +row.dataset.i, t = session.tabs[i];
        if (a === 'restore') { await restoreItems([t]); await track('restored'); }
        session.tabs.splice(i, 1);
        return save({ sessions: S.sessions.filter(s => s.tabs.length) });
      }
      return;
    }
    case 'wake': { const row = el.closest('.row'); const s = S.snoozed.find(x => x.id === row.dataset.snz); await chrome.tabs.create({ url: s.url }); return save({ snoozed: S.snoozed.filter(x => x.id !== s.id) }); }
    case 'srestore': await restoreItems(session.tabs); await track('restored', session.tabs.length); return save({ sessions: S.sessions.filter(s => s.id !== session.id) });
    case 'sdel': if (!confirm(`Delete "${session.name}" and its ${session.tabs.length} tabs? This can't be undone.`)) return; return save({ sessions: S.sessions.filter(s => s.id !== session.id) });
    case 'rename': { const n = prompt('Name this list', session.name); if (n) { session.name = n.trim(); return save({ sessions: S.sessions }); } return; }
    case 'sbm': return openBmDlg({ session, folder: session.name });
    case 'clear-closed': return save({ closedLog: [] });
    case 'staledays': case 'budget': case 'nudge': return;
    case 'do-export': return $('#export').click();
    case 'do-import': return $('#import').click();
    case 'al-pause': { const d = +el.dataset.days; await saveAlerts({ pausedUntil: Date.now() + d * DAY }); return toast(d > 1 ? 'Nudges paused for a week. Rest well.' : 'Nudges paused until tomorrow.'); }
    case 'al-resume': return saveAlerts({ pausedUntil: 0 });
    case 'al-preview': chrome.runtime.sendMessage({ type: 'relapse-preview' }); return toast('Sent. This is the only notification you\'d get that day.');
    case 'lower-stale': S.settings.staleDays = 5; await save({ settings: S.settings }); return toast('Stale limit is now 5 days.');
    // todos
    case 'tfilter': S.todoFilter = el.dataset.v; return render();
    case 'new-todo': return openTodoDlg({});
    case 'tdone': todo.done = !todo.done; todo.doneAt = todo.done ? Date.now() : null; return save({ todos: S.todos });
    case 'topen': return todo.url ? chrome.tabs.create({ url: todo.url }) : openTodoDlg({ todo });
    case 'tedit': return openTodoDlg({ todo });
    case 'tdel': return save({ todos: S.todos.filter(t => t.id !== todo.id) });
  }
}
// Rehab parks go into one list per day instead of many tiny lists
async function mergeRehabSessions() {
  const { sessions = [] } = await chrome.storage.local.get('sessions');
  const name = 'Rehab session · ' + new Date().toLocaleDateString();
  const same = sessions.filter(s => s.name === name);
  if (same.length < 2) return;
  const [keep, ...rest] = same;
  rest.forEach(r => keep.tabs.push(...r.tabs));
  await save({ sessions: sessions.filter(s => !rest.includes(s)) });
}

$('#view').addEventListener('click', onAction);
$('#view').addEventListener('change', async e => {
  const a = e.target.dataset.a;
  if (a === 'budget') { S.settings.budget = +e.target.value; await save({ settings: S.settings }); }
  if (a === 'staledays') { S.settings.staleDays = +e.target.value; await save({ settings: S.settings }); }
  if (a === 'nudge') { S.settings.nudge = e.target.checked; await save({ settings: S.settings }); }
});
$('#toolbar').addEventListener('click', onAction);
$('#toolbar').addEventListener('change', async e => {
  if (e.target.dataset.a === 'budget') { S.settings.budget = +e.target.value; return save({ settings: S.settings }); }
  if (e.target.dataset.a === 'staledays') {
    S.settings.staleDays = +e.target.value;
    await save({ settings: S.settings });
  }
});
$('#bulk').addEventListener('click', e => {
  const b = e.target.closest('[data-bulk]'); if (!b) return;
  const tabs = [...S.sel].map(getTab).filter(Boolean);
  if (b.dataset.bulk === 'clear') { S.sel.clear(); return render(); }
  if (b.dataset.bulk === 'park') return parkTabs(tabs);
  if (b.dataset.bulk === 'todo') return addTodosFromTabs(tabs);
  if (b.dataset.bulk === 'snooze') return openSnoozeDlg(tabs);
  if (b.dataset.bulk === 'bookmark') return openBmDlg({ tabs, folder: '' });
  if (b.dataset.bulk === 'close') return closeTabs(tabs);
});

let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    S.q = e.target.value.trim().toLowerCase();
    // Search is global: from pages that have nothing to filter, jump to the results in Open tabs.
    if (S.q && ['rehab', 'recovery', 'settings'].includes(S.view)) location.hash = 'tabs';
    render();
  }, 120);
});

document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); return; }
  if (e.key === 'Escape') { if (typing) document.activeElement.blur(); S.sel.clear(); render(); return; }
  if (S.view === 'rehab' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const map = { k: 'r-keep', t: 'todo', s: 'snooze', b: 'bookmark', p: 'r-park', c: 'r-close', o: 'go' };
    const a = map[e.key.toLowerCase()];
    const btn = a && document.querySelector(`.rehab [data-a="${a}"]`);
    if (btn) { e.preventDefault(); btn.click(); }
  }
});

function route() {
  const v = location.hash.slice(1);
  S.view = ['tabs', 'stale', 'wins', 'parked', 'todos', 'closed', 'rehab', 'recovery', 'settings'].includes(v) ? v : 'tabs';
  if (S.view === 'rehab') { S.rehabSkip.clear(); S.rehabDone = 0; S.rehabStart = 0; }
  window.scrollTo(0, 0);
  render();
}
window.addEventListener('hashchange', route);

// export / import
// Recovery history from a backup (e.g. moving from a "Load unpacked" install to the store version).
// Per day and per counter we keep the larger number, so importing the same backup twice changes nothing.
function mergeRecovery(a = {}, b = {}) {
  const maxMerge = (x = {}, y = {}) => { const o = { ...x }; for (const k in y) o[k] = Math.max(o[k] || 0, y[k] || 0); return o; };
  const daily = { ...(a.daily || {}) };
  for (const d in (b.daily || {})) daily[d] = maxMerge(daily[d], b.daily[d]);
  const starts = [a.start, b.start].filter(Boolean).sort((x, y) => x.day.localeCompare(y.day));
  return { ...a, daily, totals: maxMerge(a.totals, b.totals), ...(starts[0] ? { start: starts[0] } : {}) };
}
$('#export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  data.openTabs = S.tabs.map(t => ({ title: t.title, url: t.url, windowId: t.windowId }));
  data.exportedAt = new Date().toISOString();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `tab-rehab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$('#import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !(data.sessions || data.todos || data.snoozed || data.recovery)) throw new Error('not a backup');
    const cur = await chrome.storage.local.get(['sessions', 'todos', 'snoozed', 'recovery', 'stats']);
    const mergeById = (a = [], b = []) => [...a, ...b.filter(x => !a.some(y => y.id === x.id))];
    await save({
      sessions: mergeById(cur.sessions, data.sessions),
      todos: mergeById(cur.todos, data.todos),
      snoozed: mergeById(cur.snoozed, data.snoozed),
      recovery: mergeRecovery(cur.recovery, data.recovery),
      stats: { ...(data.stats || {}), ...(cur.stats || {}) } // days we already have win
    });
    toast('Backup imported and merged.');
  } catch (err) { toast('That file is not a Tab Rehab backup.'); }
  e.target.value = '';
});

// sticky header shadow
const onScroll = () => $('.top').classList.toggle('stuck', window.scrollY > 4);
window.addEventListener('scroll', onScroll, { passive: true });

// live updates
for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[ev].addListener(reload);
chrome.storage.onChanged.addListener(reload);
setInterval(render, 60e3); // keep "x min ago" fresh

route();
load();
