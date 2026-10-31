import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const SECTIONS = [
  { id: 'content', label: '30K Months' },
  { id: 'health', label: 'Health' },
  { id: 'personal', label: 'Personal' },
];

// Ids 1–10 match the first version of the app, so old check-offs carry over.
const DEFAULT_TASKS = [
  { id: '2', section: 'content', label: 'Post 1 TikTok' },
  { id: '3', section: 'content', label: 'Send 1 Cold Email/Follow-up' },
  { id: '5', section: 'content', label: '15 Min Playing with Claude Code' },
  { id: '8', section: 'content', label: 'Reply to 5 YouTube Comments' },
  { id: '9', section: 'content', label: 'Reply to 5 TikTok Comments' },
  { id: '10', section: 'content', label: 'One Task Toward Digital Product' },
  { id: '1', section: 'health', label: '45 Minute Workout' },
  { id: '7', section: 'health', label: '10K Steps' },
  { id: '11', section: 'health', label: 'Drink a Gallon of Water' },
  { id: '12', section: 'health', label: 'No Junk Food' },
  { id: '4', section: 'personal', label: 'Journal for 5 Min' },
  { id: '6', section: 'personal', label: 'Read 10 Pages' },
  { id: '13', section: 'personal', label: 'Smile at a Stranger' },
  { id: '14', section: 'personal', label: 'Give a Compliment' },
];
const OLD_TASK_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

// Sections live on the main Accounts tab unless they're set to have their own tab.
const OWN_TAB_DEFAULTS = ['content', 'health', 'personal'];
// Sections made before tab choices existed start where they belong by name.
const LABEL_TAB_DEFAULTS = { breaks: 'health', 'free samples': 'content' };
// A section's tab setting: 'main', 'own', or the id of a section that has its own tab.
const tabSetting = (s) => {
  if (s.tab) return s.tab;
  if (s.ownTab !== undefined) return s.ownTab ? 'own' : 'main';
  if (OWN_TAB_DEFAULTS.includes(s.id)) return 'own';
  return LABEL_TAB_DEFAULTS[(s.label || '').trim().toLowerCase()] || 'main';
};
const hasOwnTab = (s) => tabSetting(s) === 'own';
// The tab a section shows on; falls back to Accounts if the tab it joined is gone.
const tabOf = (s, sections) => {
  const setting = tabSetting(s);
  if (setting === 'own') return s.id;
  if (setting === 'main') return 'main';
  const owner = sections.find((x) => x.id === setting);
  return owner && hasOwnTab(owner) ? setting : 'main';
};
// Brand deals and weekly tasks live on 30K Months when that tab exists.
const CARD_TAB = 'content';

const sectionOf = (task, sections) =>
  sections.some((s) => s.id === task.section) ? task.section : sections[0].id;

// ---- dates (local calendar days as YYYY-MM-DD) ----
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diffDays = (a, b) => {
  const x = parse(a), y = parse(b);
  return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5);
};
const todayStr = () => fmt(new Date());
const pretty = (s) => parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const uid = () => Math.random().toString(36).slice(2, 9);
// Weeks run Monday to Sunday.
const weekStart = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));
// A week holds a list of tasks; weeks saved before lists existed held a single { label, done }.
const weekItems = (w) => {
  if (!w) return [];
  if (w.items) return w.items;
  return w.label ? [{ id: 'single', label: w.label, done: !!w.done }] : [];
};

// ---- challenge logic ----
const endDate = (c) => addDays(c.start, c.length - 1);
const dayOf = (c, date) => diffDays(c.start, date) + 1;
// Tasks remember when they were added or removed, so changing the routine never rewrites past days.
const activeTasks = (c, date) =>
  c.tasks.filter((t) => (!t.added || t.added <= date) && (!t.removed || date < t.removed));
const doneCount = (data, date) => {
  const log = data.logs[date];
  if (!log) return 0;
  return activeTasks(data.challenge, date).filter((t) => log.done.includes(t.id)).length;
};
const isComplete = (data, date) => {
  const n = activeTasks(data.challenge, date).length;
  return n > 0 && doneCount(data, date) === n;
};

function cellState(data, date, t) {
  if (date > t) return 'future';
  if (isComplete(data, date)) return 'done';
  return date === t ? 'open' : 'missed';
}

// Days already over, from Day 1 up to yesterday (or the last day of the challenge).
function pastDays(data, t) {
  const c = data.challenge;
  const last = [addDays(t, -1), endDate(c)].sort()[0];
  const out = [];
  for (let d = c.start; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

// First day that broke the rules.
function findFailure(data, t) {
  const c = data.challenge;
  let misses = 0;
  for (const d of pastDays(data, t)) {
    if (!isComplete(data, d)) {
      misses++;
      if (c.rule === 'strict' || misses > c.grace) return { date: d, day: dayOf(c, d), misses };
    }
  }
  return null;
}
const missesSoFar = (data, t) => pastDays(data, t).filter((d) => !isComplete(data, d)).length;

function streak(data, t) {
  let d = isComplete(data, t) ? t : addDays(t, -1);
  let n = 0;
  while (d >= data.challenge.start && isComplete(data, d)) { n++; d = addDays(d, -1); }
  return n;
}
function daysDone(data, t) {
  const c = data.challenge;
  let n = 0;
  for (let i = 0; i < c.length; i++) {
    const d = addDays(c.start, i);
    if (d <= t && isComplete(data, d)) n++;
  }
  return n;
}

function freshData(start) {
  return {
    version: 2,
    challenge: { name: '75 Creator', length: 75, rule: 'strict', grace: 2, sections: SECTIONS, tasks: DEFAULT_TASKS, start },
    logs: {},
    attempts: [],
    weeks: {},
    horizon: [],
    deals: [],
  };
}

// Converts a row saved by the first version of the app (day-numbered history) into dated logs.
function migrateOldRow(row) {
  const t = todayStr();
  const data = freshData(t);
  // Tasks that didn't exist before start counting today, so past days stay complete.
  data.challenge.tasks = DEFAULT_TASKS.map((x) => (OLD_TASK_IDS.includes(x.id) ? x : { ...x, added: t }));
  const toDay = (s) => { const d = new Date(s); return isNaN(d) ? null : fmt(d); };
  let start = null;

  Object.entries(row.history || {}).forEach(([dayNum, h]) => {
    const date = h && toDay(h.date);
    if (!date) return;
    data.logs[date] = { done: (h.tasks || []).map(String), note: h.notes || '' };
    if (h.photo) data.logs[date].photo = h.photo;
    const s = addDays(date, -(Number(dayNum) - 1));
    if (!start || s < start) start = s;
  });

  const last = row.last_completed_date && toDay(row.last_completed_date);
  if (last && (row.completed_tasks || []).length) {
    data.logs[last] = {
      ...(data.logs[last] || {}),
      done: row.completed_tasks.map(String),
      note: row.today_notes || (data.logs[last] && data.logs[last].note) || '',
    };
    if (row.today_photo) data.logs[last].photo = row.today_photo;
  }

  data.challenge.start = start || addDays(t, -((row.current_day || 1) - 1));
  if (row.weekly_task) data.weeks[weekStart(t)] = { items: [{ id: uid(), label: row.weekly_task, done: !!row.weekly_task_completed }] };
  return data;
}

// ---- backup on this device ----
// A copy of the latest saved data, used if the server copy is ever overwritten by an old version of the app.
const backupKey = (userId) => '75creator-backup-' + userId;
function readBackup(userId) {
  try {
    const b = JSON.parse(localStorage.getItem(backupKey(userId)));
    return b && b.version === 2 && b.challenge ? b : null;
  } catch (e) {
    return null;
  }
}
function writeBackup(userId, data) {
  try {
    localStorage.setItem(backupKey(userId), JSON.stringify(data));
  } catch (e) {
    // Storage full (usually photos): keep everything except the photos.
    try {
      const logs = {};
      Object.entries(data.logs).forEach(([d, l]) => { const { photo, ...rest } = l; logs[d] = rest; });
      localStorage.setItem(backupKey(userId), JSON.stringify({ ...data, logs }));
    } catch (e2) { /* no room at all; the server copy still stands */ }
  }
}

// ---- reminders (web push) ----
// Public half of the push key pair. The private half lives only in Vercel's environment variables.
const VAPID_PUBLIC_KEY = 'BLq2nHewJb5Uoei8X0U4Ap7XGJ18leC5Qi76_OnavSbUkklNQG828fR3BYuPHNLhX9r8ekrhkYMpA8mLL73_ci0';

const base64ToBytes = (s) => {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
};
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function enableReminders(user) {
  if (!pushSupported()) {
    throw new Error(isIOS() && !isStandalone()
      ? 'On iPhone, add 75 Creator to your Home Screen first (Share → Add to Home Screen), open it from there, then turn on reminders.'
      : "This browser doesn't support notifications.");
  }
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them for 75 Creator in your settings, then try again.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(VAPID_PUBLIC_KEY) });
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    user_id: user.id,
    subscription: sub.toJSON(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (error) throw new Error("Reminders couldn't be saved to your account: " + error.message);
  reg.showNotification('Reminders are on', {
    body: "You'll get a morning heads-up on days you have things to task or schedule.",
    icon: '/icon-192.png',
  });
}

const KIND_LABEL = { task: 'Task', schedule: 'Schedule' };

// The day's notes: write, then Save; saved notes show as text until you tap Edit.
function NotesCard({ note, dateLabel, onSave }) {
  const [editing, setEditing] = useState(!note);
  const [draft, setDraft] = useState(note);
  const changed = draft !== note;

  const save = () => {
    onSave(draft.trim() ? draft : '');
    setEditing(!draft.trim());
  };

  return (
    <section className="card notes" aria-label="Ideas">
      <div className="notes-head">
        <div>
          <div className="eyebrow">{dateLabel}</div>
          <h2>Ideas</h2>
        </div>
        {!editing && <button className="btn" type="button" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {editing ? (
        <>
          <textarea className="text" id="note" value={draft} aria-label="Ideas for this day"
            placeholder="Challenges, insights, breakthroughs, or anything you want to remember."
            onChange={(e) => setDraft(e.target.value)} />
          <div className="row notes-actions">
            <button className="btn primary" type="button" onClick={save} disabled={!changed}>Save</button>
            {note && (
              <button className="btn" type="button" onClick={() => { setDraft(note); setEditing(false); }}>Cancel</button>
            )}
            {changed && <span className="hint">Not saved yet</span>}
          </div>
        </>
      ) : (
        <p className="note-text">{note}</p>
      )}
    </section>
  );
}

// ---- brand deals ----
const DEAL_STATUS = [
  { id: 'active', label: 'In progress' },
  { id: 'posted', label: 'Posted' },
  { id: 'paid', label: 'Paid' },
];
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const parseMoney = (s) => { const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; };

function dueText(deal, today) {
  if (!deal.due) return null;
  if (deal.status === 'paid') return { text: 'Paid', tone: '' };
  if (deal.status === 'active' && deal.due < today) return { text: 'Overdue · ' + pretty(deal.due), tone: 'late' };
  if (deal.due === today) return { text: 'Due today', tone: 'soon' };
  if (deal.due === addDays(today, 1)) return { text: 'Due tomorrow', tone: 'soon' };
  return { text: 'Due ' + pretty(deal.due), tone: '' };
}

function DealEditor({ deal, onUpdate, onRemove, onClose }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <div className="deal-edit">
      <div className="deal-fields">
        <label htmlFor={'brand-' + deal.id}>Brand
          <input className="text" id={'brand-' + deal.id} maxLength={50} value={deal.brand}
            onChange={(e) => onUpdate({ brand: e.target.value })} />
        </label>
        <label htmlFor={'what-' + deal.id}>Deliverable
          <input className="text" id={'what-' + deal.id} maxLength={80} value={deal.what || ''} placeholder="e.g. 2 TikToks + 1 story"
            onChange={(e) => onUpdate({ what: e.target.value })} />
        </label>
        <label htmlFor={'amount-' + deal.id}>Payment
          <input className="text" id={'amount-' + deal.id} inputMode="decimal" placeholder="$0" value={deal.amount == null ? '' : deal.amount}
            onChange={(e) => onUpdate({ amount: e.target.value === '' ? null : parseMoney(e.target.value) })} />
        </label>
        <label htmlFor={'due-' + deal.id}>Due
          <input className="text" type="date" id={'due-' + deal.id} value={deal.due || ''}
            onChange={(e) => onUpdate({ due: e.target.value || null })} />
        </label>
      </div>
      <div className="seg" role="radiogroup" aria-label="Status">
        {DEAL_STATUS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={deal.status === s.id}
            className={deal.status === s.id ? 'on' : ''} onClick={() => onUpdate({ status: s.id })}>{s.label}</button>
        ))}
      </div>
      <label className="deal-notes" htmlFor={'notes-' + deal.id}>Notes
        <textarea className="text" id={'notes-' + deal.id} value={deal.notes || ''}
          placeholder="Contact, usage rights, discount code, anything to remember"
          onChange={(e) => onUpdate({ notes: e.target.value })} />
      </label>
      <div className="actions">
        <button className="btn primary" type="button" onClick={onClose}>Done</button>
        <button className={'btn danger' + (armed ? ' armed' : '')} type="button"
          onClick={() => { if (armed) onRemove(); else setArmed(true); }}>
          {armed ? 'Tap again to delete' : 'Delete deal'}
        </button>
      </div>
    </div>
  );
}

function DealsCard({ deals, today, onChange }) {
  const [brand, setBrand] = useState('');
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [openId, setOpenId] = useState(null);
  const [showPaid, setShowPaid] = useState(false);

  const byDue = (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0;
  const open = deals.filter((d) => d.status !== 'paid').sort((a, b) => (a.status === b.status ? byDue(a, b) : a.status === 'active' ? -1 : 1));
  const paid = deals.filter((d) => d.status === 'paid');
  const openTotal = open.reduce((sum, d) => sum + (d.amount || 0), 0);
  const paidTotal = paid.reduce((sum, d) => sum + (d.amount || 0), 0);

  const add = () => {
    const b = brand.trim();
    if (!b) return;
    onChange([...deals, { id: uid(), brand: b, what: what.trim(), amount: parseMoney(amount), due: due || null, status: 'active', notes: '', created: today }]);
    setBrand(''); setWhat(''); setAmount(''); setDue('');
  };
  const update = (id, changes) => onChange(deals.map((d) => (d.id === id ? { ...d, ...changes } : d)));
  const remove = (id) => { onChange(deals.filter((d) => d.id !== id)); setOpenId(null); };

  const row = (deal) => {
    const d = dueText(deal, today);
    const isOpen = openId === deal.id;
    return (
      <li key={deal.id} className={'deal' + (isOpen ? ' open' : '')}>
        <button type="button" className="deal-row" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : deal.id)}>
          <span className="deal-main">
            <span className="deal-brand">{deal.brand || 'Untitled brand'}</span>
            {deal.what && <span className="deal-what">{deal.what}</span>}
          </span>
          <span className="deal-meta">
            {deal.amount != null && <span className="deal-amount">{money(deal.amount)}</span>}
            <span className={'deal-status s-' + deal.status}>{DEAL_STATUS.find((s) => s.id === deal.status).label}</span>
            {d && deal.status !== 'paid' && <span className={'deal-due ' + d.tone}>{d.text}</span>}
          </span>
        </button>
        {isOpen && <DealEditor deal={deal} onUpdate={(c) => update(deal.id, c)} onRemove={() => remove(deal.id)} onClose={() => setOpenId(null)} />}
      </li>
    );
  };

  return (
    <section className="card deals" aria-label="Active brand deals">
      <div className="deals-head">
        <div>
          <div className="eyebrow">Business</div>
          <h2>Active Brand Deals</h2>
        </div>
        {open.length > 0 && (
          <div className="deals-total">
            <b>{money(openTotal)}</b>
            <span className="eyebrow">{open.length === 1 ? '1 open deal' : `${open.length} open deals`}</span>
          </div>
        )}
      </div>

      {open.length ? <ul className="deal-list">{open.map(row)}</ul> : (
        <p className="empty">No active deals. Add one below when a brand says yes.</p>
      )}

      <div className="deal-add">
        <input className="text" id="dealBrand" maxLength={50} placeholder="Brand" aria-label="Brand"
          value={brand} onChange={(e) => setBrand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <input className="text" id="dealWhat" maxLength={80} placeholder="Deliverable, e.g. 2 TikToks" aria-label="Deliverable"
          value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <div className="row">
          <input className="text deal-amt" id="dealAmount" inputMode="decimal" placeholder="$ Payment" aria-label="Payment"
            value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <input className="text date-small" id="dealDue" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn primary" type="button" onClick={add} disabled={!brand.trim()}>Add deal</button>
        </div>
      </div>

      {paid.length > 0 && (
        <div className="deal-paid">
          <button type="button" className="link" aria-expanded={showPaid} onClick={() => setShowPaid(!showPaid)}>
            {showPaid ? 'Hide' : 'Show'} completed ({paid.length}{paidTotal ? ' · ' + money(paidTotal) + ' earned' : ''})
          </button>
          {showPaid && <ul className="deal-list">{paid.map(row)}</ul>}
        </div>
      )}
    </section>
  );
}

// Horizon items whose day has come: highlighted at the top until handled.
function DueCard({ items, today, sections, onUpdate, onAddToToday }) {
  const [target, setTarget] = useState(sections[0] ? sections[0].id : '');
  if (!items.length) return null;
  const hasTasks = items.some((i) => i.kind === 'task');
  return (
    <section className="card due" aria-label="On deck today">
      <div>
        <div className="eyebrow">On deck today</div>
        <h2>{items.length === 1 ? '1 thing to plan' : `${items.length} things to plan`}</h2>
      </div>
      <ul className="due-list">
        {items.map((item) => (
          <li key={item.id} className="due-item">
            <div className="due-text">
              <span className={'kind kind-' + item.kind}>{KIND_LABEL[item.kind]}</span>
              <span>{item.text}</span>
              {item.date < today && <span className="overdue">from {pretty(item.date)}</span>}
            </div>
            <div className="row">
              {item.kind === 'task' && (
                <button className="btn primary" type="button" onClick={() => onAddToToday(item, target)}>Add to today's tasks</button>
              )}
              <button className="btn" type="button" onClick={() => onUpdate(item.id, { done: true })}>
                {item.kind === 'schedule' ? 'Scheduled' : 'Done'}
              </button>
              <button className="btn" type="button" onClick={() => onUpdate(item.id, { date: addDays(today, 1) })}>Tomorrow</button>
            </div>
          </li>
        ))}
      </ul>
      {hasTasks && sections.length > 1 && (
        <label className="due-target" htmlFor="dueTarget">
          Add tasks to
          <select className="text" id="dueTarget" value={target} onChange={(e) => setTarget(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

// Capture things to task or schedule later; they wait here until their day.
function HorizonCard({ items, today, onAdd, onRemove, reminders, onEnableReminders }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState('task');
  const [date, setDate] = useState(addDays(today, 1));
  const upcoming = items.filter((i) => !i.done && i.date > today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const tomorrow = addDays(today, 1);
  // Upcoming items grouped by day: [[date, items], ...]
  const groups = upcoming.reduce((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last[0] === item.date) last[1].push(item); else acc.push([item.date, [item]]);
    return acc;
  }, []);

  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd({ id: uid(), text: v, kind, date: date > today ? date : today, created: today });
    setText('');
  };

  return (
    <section className="card horizon" aria-label="Pending tasks">
      <h2>Pending Tasks</h2>
      <div className="capture">
        <input className="text" id="horizonText" maxLength={100} value={text} placeholder="Something to task or schedule"
          aria-label="Something to task or schedule" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <div className="row">
          <div className="seg" role="radiogroup" aria-label="Type">
            {['task', 'schedule'].map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <input className="text date-small" id="horizonDate" type="date" min={today} value={date}
            aria-label="Day to bring it up" onChange={(e) => setDate(e.target.value)} />
          <button className="btn primary" type="button" onClick={add} disabled={!text.trim()}>Add</button>
        </div>
      </div>

      {upcoming.length ? (
        <div className="upcoming">
          {groups.map(([date, list]) => (
            <div className="up-group" key={date}>
              <div className="up-date">
                {date === tomorrow ? 'Tomorrow' : pretty(date)}
                <span className="up-count">{list.length}</span>
              </div>
              <ul>
                {list.map((item) => (
                  <li key={item.id} className="up-item">
                    <span className={'kind kind-' + item.kind}>{KIND_LABEL[item.kind]}</span>
                    <span className="what">{item.text}</span>
                    <button className="up-remove" type="button" aria-label={`Remove ${item.text}`} onClick={() => onRemove(item.id)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">Nothing on the horizon. Add things you need to task or schedule, and they'll show up at the top of the app on that day.</p>
      )}

      <div className="reminders">
        {reminders.status === 'on' ? (
          <p className="on-note">Morning reminders are on for this device.</p>
        ) : (
          <button className="btn" type="button" disabled={reminders.status === 'working'} onClick={onEnableReminders}>
            {reminders.status === 'working' ? 'Turning on…' : 'Turn on morning reminders'}
          </button>
        )}
        {reminders.error && <p className="err">{reminders.error}</p>}
      </div>
    </section>
  );
}

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 4.5" stroke="var(--check-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---- times ("14:05" strings, local) ----
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const splitHM = (hm) => hm.split(':').map(Number);
const fmtTime = (hm, withMeridiem = true) => {
  const [h, m] = splitHM(hm);
  return (h % 12 || 12) + ':' + pad(m) + (withMeridiem ? (h < 12 ? ' AM' : ' PM') : '');
};
function timeLabel(time) {
  if (!time) return '';
  const { start, end } = time;
  if (start && end) {
    const [sh, sm] = splitHM(start);
    const [eh, em] = splitHM(end);
    const mins = ((eh * 60 + em) - (sh * 60 + sm) + 1440) % 1440;
    const dur = mins >= 60 ? Math.floor(mins / 60) + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '') : mins + 'm';
    const sameHalf = (sh < 12) === (eh < 12);
    return fmtTime(start, !sameHalf) + '–' + fmtTime(end) + ' · ' + dur;
  }
  if (end) return fmtTime(end);
  return 'from ' + fmtTime(start);
}

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" strokeWidth="1.7" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.55-2-3.46-2.36.95a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.44 2.44a7.5 7.5 0 0 0-2.6 1.5L4.6 5.49l-2 3.46 2 1.55a7.6 7.6 0 0 0 0 3l-2 1.55 2 3.46 2.36-.95a7.5 7.5 0 0 0 2.6 1.5L10 21.5h4l.44-2.44a7.5 7.5 0 0 0 2.6-1.5l2.36.95 2-3.46-2-1.55Z"
      stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

const ClockIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// A checklist row with the time it was done (or a start–end range), editable inline.
function TaskLine({ task, checked, time, open, onToggle, onOpen, onClose, onSetTime }) {
  const label = timeLabel(time);
  return (
    <li>
      <div className="task-line">
        <CheckRow label={task.label} checked={checked} onToggle={onToggle} />
        <button type="button" className={'time-chip' + (label ? '' : ' empty')} onClick={open ? onClose : onOpen}
          aria-label={label ? `Edit time for ${task.label}: ${label}` : `Add a time for ${task.label}`} aria-expanded={open}>
          {label || <ClockIcon />}
        </button>
      </div>
      {open && (
        <div className="time-edit">
          <label htmlFor={'start-' + task.id}>Start
            <input className="text" type="time" id={'start-' + task.id} value={(time && time.start) || ''}
              onChange={(e) => onSetTime('start', e.target.value)} />
          </label>
          <label htmlFor={'end-' + task.id}>End
            <input className="text" type="time" id={'end-' + task.id} value={(time && time.end) || ''}
              onChange={(e) => onSetTime('end', e.target.value)} />
          </label>
          <div className="row">
            <button className="btn" type="button" onClick={() => { onSetTime('start', ''); onSetTime('end', ''); }}>Clear</button>
            <button className="btn primary" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </li>
  );
}

function CheckRow({ label, checked, onToggle }) {
  return (
    <button type="button" className="task" aria-pressed={checked} onClick={onToggle}>
      <span className="box"><CheckIcon /></span>
      <span className="label">{label}</span>
    </button>
  );
}

const Logo = () => (
  <div className="logo" aria-label="75 Creator">
    <div className="logo-mark" aria-hidden="true">75<span>♠</span></div>
    <div className="logo-word" aria-hidden="true">CREATOR</div>
  </div>
);

export default function App() {
  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // App state
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [today, setToday] = useState(todayStr());
  const [selected, setSelected] = useState(todayStr());
  const [setupOpen, setSetupOpen] = useState(false);
  const [editingTasks, setEditingTasks] = useState(false);
  const [timeOpen, setTimeOpen] = useState(null);
  const [activeTab, setActiveTab] = useState('main');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeRef = useRef(null);
  const closeSettings = () => { setSettingsOpen(false); setSetupOpen(false); };

  // While settings are open: lock page scroll, focus the close button, close on Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { setSettingsOpen(false); setSetupOpen(false); } };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (closeRef.current) closeRef.current.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [settingsOpen]);
  const [weeklyEditing, setWeeklyEditing] = useState(false);
  const [weeklyDraft, setWeeklyDraft] = useState('');
  const [reminders, setReminders] = useState({ status: 'off', error: '' });
  const loadedRef = useRef(false);
  const checklistRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) loadUserProgress();
    else { setIsLoading(false); loadedRef.current = false; setData(null); }
  }, [user]);

  // Show reminders as on if this device is already subscribed.
  useEffect(() => {
    if (!user || !pushSupported() || window.Notification.permission !== 'granted') return;
    navigator.serviceWorker.getRegistration()
      .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
      .then((sub) => { if (sub) setReminders({ status: 'on', error: '' }); })
      .catch(() => {});
  }, [user]);

  // Roll over to the new day if the app stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const t = todayStr();
      setToday((prev) => {
        if (prev !== t) setSelected((s) => (s === prev ? t : s));
        return t;
      });
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const loadUserProgress = async () => {
    setIsLoading(true);
    try {
      const { data: row, error } = await supabase
        .from('user_progress')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading progress:', error);
        setSaveStatus('error');
        setIsLoading(false);
        return;
      }

      let next;
      if (!row) {
        next = freshData(todayStr());
        await supabase.from('user_progress').insert({
          user_id: user.id,
          current_day: 1,
          completed_tasks: [],
          history: { v2: next },
          today_notes: '',
        });
      } else if (row.history && row.history.v2) {
        next = row.history.v2;
        if (!next.weeks) next.weeks = {};
        if (!next.attempts) next.attempts = [];
        if (!next.horizon) next.horizon = [];
        if (!next.deals) next.deals = [];
        if (!next.challenge.sections) next.challenge.sections = SECTIONS;
      } else {
        // No new-format data on the server. If an old copy of the app overwrote it,
        // restore from this device's backup; otherwise this is the first open after the update.
        const backup = readBackup(user.id);
        next = backup || migrateOldRow(row);
        // Keep a copy of the old history next to the new data.
        await supabase
          .from('user_progress')
          .update({ history: { v2: next, v1: row.history || {} }, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
      setData(next);
      loadedRef.current = true;
    } catch (e) {
      console.error('Failed to load progress:', e);
      setSaveStatus('error');
    }
    setIsLoading(false);
  };

  // Save to Supabase whenever data changes.
  useEffect(() => {
    if (!user || !data || !loadedRef.current) return;
    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const { data: row } = await supabase.from('user_progress').select('history').eq('user_id', user.id).single();
        const keep = row && row.history && row.history.v1 ? { v1: row.history.v1 } : {};
        const { error } = await supabase
          .from('user_progress')
          .update({
            history: { ...keep, v2: data },
            current_day: Math.max(1, Math.min(dayOf(data.challenge, todayStr()), data.challenge.length)),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
        setSaveStatus(error ? 'error' : 'saved');
        writeBackup(user.id, data);
      } catch (e) {
        console.error('Failed to save:', e);
        setSaveStatus('error');
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [data, user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthError('Check your email for a confirmation link.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://75creator.vercel.app' },
    });
    if (error) setAuthError(error.message);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // ---- screens before the app ----
  if (authLoading || (user && isLoading)) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <div className="loading">{authLoading ? 'Loading…' : 'Loading your progress…'}</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <div className="auth card">
          <Logo />
          <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <form onSubmit={handleAuth} className="auth-form">
            <input className="text" id="authEmail" type="email" placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <input className="text" id="authPassword" type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            {authError && <p className="err">{authError}</p>}
            <button type="submit" className="btn primary wide">{authMode === 'login' ? 'Log in' : 'Sign up'}</button>
          </form>
          <div className="or"><span>or</span></div>
          <button type="button" className="btn wide" onClick={handleGoogleSignIn}>Continue with Google</button>
          <button type="button" className="link" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }}>
            {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <style>{CSS}</style>
        <div className="loading">
          <p>Your progress couldn't be loaded. Check your connection and try again.</p>
          <button type="button" className="btn" onClick={loadUserProgress}>Try again</button>
        </div>
      </div>
    );
  }

  // ---- derived values ----
  const c = data.challenge;
  const t = today;
  const end = endDate(c);
  let sel = selected;
  if (sel < c.start || sel > t) sel = t > end ? end : t;
  if (sel < c.start) sel = c.start;

  const fail = findFailure(data, t);
  const finished = !fail && (t > end || (t === end && isComplete(data, end)));
  const day = t < c.start ? 0 : Math.min(Math.max(dayOf(c, t), 1), c.length);
  const done = daysDone(data, t);
  const log = data.logs[sel] || { done: [], note: '' };
  const isToday = sel === t;
  const selTasks = activeTasks(c, sel);
  const sections = c.sections || SECTIONS;
  const tabs = [{ id: 'main', label: 'Accounts' }, ...sections.filter(hasOwnTab).map((s) => ({ id: s.id, label: s.label }))];
  const tab = tabs.some((x) => x.id === activeTab) ? activeTab : 'main';
  const isMain = tab === 'main';
  const tabSections = sections.filter((s) => tabOf(s, sections) === tab);
  const cardTab = tabs.some((x) => x.id === CARD_TAB) ? CARD_TAB : 'main';
  // [done, total] for a tab on the selected day.
  const tabCount = (id) => {
    const ids = sections.filter((s) => tabOf(s, sections) === id).map((s) => s.id);
    const list = selTasks.filter((x) => ids.includes(sectionOf(x, sections)));
    return [list.filter((x) => log.done.includes(x.id)).length, list.length];
  };
  const [tabDone, tabTotal] = tabCount(tab);
  const horizon = data.horizon || [];
  const dueItems = horizon.filter((i) => !i.done && i.date <= t);
  const wk = weekStart(sel);
  const weekly = weekItems(data.weeks[wk]);
  const cols = c.length % 15 === 0 || c.length > 60 ? 15 : 10;

  // ---- updates ----
  const updateLog = (date, fn) => setData((prev) => {
    const cur = prev.logs[date] || { done: [], note: '' };
    return { ...prev, logs: { ...prev.logs, [date]: fn({ ...cur, done: [...cur.done] }) } };
  });

  // Checking a task today stamps the time it was done; unchecking clears that stamp.
  const toggleTask = (id) => updateLog(sel, (l) => {
    const times = { ...(l.times || {}) };
    const i = l.done.indexOf(id);
    if (i >= 0) {
      l.done.splice(i, 1);
      if (times[id]) {
        const { end, ...rest } = times[id];
        if (rest.start) times[id] = rest; else delete times[id];
      }
    } else {
      l.done.push(id);
      if (sel === t && !(times[id] && times[id].end)) times[id] = { ...(times[id] || {}), end: nowHM() };
    }
    return { ...l, times };
  });
  const setTaskTime = (id, field, value) => updateLog(sel, (l) => {
    const times = { ...(l.times || {}) };
    const cur = { ...(times[id] || {}) };
    if (value) cur[field] = value; else delete cur[field];
    if (cur.start || cur.end) times[id] = cur; else delete times[id];
    return { ...l, times };
  });

  const selectDay = (date) => {
    setSelected(date);
    setWeeklyEditing(false);
    if (checklistRef.current) checklistRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const restart = () => {
    if (!fail) return;
    setData((prev) => ({
      ...prev,
      attempts: [...prev.attempts, { start: prev.challenge.start, end: fail.date, reached: Math.max(fail.day - 1, 0), length: prev.challenge.length }],
      challenge: { ...prev.challenge, start: t },
    }));
    setSelected(t);
  };

  const updateWeek = (fn) => setData((prev) => {
    const items = fn(weekItems(prev.weeks[wk]));
    const weeks = { ...prev.weeks };
    if (items.length) weeks[wk] = { items }; else delete weeks[wk];
    return { ...prev, weeks };
  });
  const addWeekly = () => {
    const label = weeklyDraft.trim();
    if (!label) return;
    updateWeek((items) => [...items, { id: uid(), label, done: false }]);
    setWeeklyDraft('');
  };

  const updateHorizon = (id, changes) => setData((prev) => ({
    ...prev,
    horizon: (prev.horizon || []).map((i) => (i.id === id ? { ...i, ...changes } : i)),
  }));
  // A due task becomes a today-only task in the chosen section.
  const addHorizonToToday = (item, sectionId) => setData((prev) => ({
    ...prev,
    challenge: {
      ...prev.challenge,
      tasks: [...prev.challenge.tasks, { id: uid(), section: sectionId || sections[0].id, label: item.text, added: t, removed: addDays(t, 1) }],
    },
    horizon: (prev.horizon || []).map((i) => (i.id === item.id ? { ...i, done: true } : i)),
  }));

  const turnOnReminders = async () => {
    setReminders({ status: 'working', error: '' });
    try {
      await enableReminders(user);
      setReminders({ status: 'on', error: '' });
    } catch (e) {
      setReminders({ status: 'off', error: e.message || "Reminders couldn't be turned on." });
    }
  };

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="top">
          <div className="top-left">
            <Logo />
            {c.name !== '75 Creator' && <h1 className="challenge-name">{c.name}</h1>}
          </div>
          <div className="top-day">
            <div className="top-daynum">{t < c.start ? 'Day 0' : `Day ${day}`}</div>
            <div className="top-date">{parse(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          </div>
          <button className="gear top-right" type="button" aria-label="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </header>

        <nav className="tabs" aria-label="Task tabs">
          {tabs.map((x) => {
            const [n, total] = tabCount(x.id);
            return (
              <button key={x.id} type="button" aria-current={x.id === tab ? 'page' : undefined}
                className={'tab' + (x.id === tab ? ' on' : '') + (total && n === total ? ' complete' : '')}
                onClick={() => { setActiveTab(x.id); setTimeOpen(null); window.scrollTo({ top: 0 }); }}>
                <span>{x.label}</span>
                {total > 0 && <span className="tab-count">{n}/{total}</span>}
              </button>
            );
          })}
        </nav>

        {fail && (
          <div className="banner fail">
            <p>
              <strong>Day {fail.day} ({pretty(fail.date)}) wasn't completed.</strong>{' '}
              {c.rule === 'strict'
                ? 'Under hard rules, that means starting over at Day 1.'
                : `That's ${fail.misses} missed days, more than your ${c.grace} grace days.`}{' '}
              If you did everything and just forgot to check it off, log it now.
            </p>
            <div className="row">
              <button className="btn primary" type="button" onClick={restart}>Restart at Day 1</button>
              <button className="btn" type="button" onClick={() => selectDay(fail.date)}>I did it, let me log it</button>
            </div>
          </div>
        )}

        {isMain && finished && (
          <section className="card finished">
            <div className="eyebrow">Challenge complete</div>
            <h2>All {c.length} days done</h2>
            <p>{c.name} ran from {pretty(c.start)} to {pretty(end)}. Start a new challenge from Edit challenge.</p>
          </section>
        )}

        <section className="card today" aria-label="Checklist" ref={checklistRef}>
          <div className="today-head">
            <div>
              <div className="eyebrow">
                {isToday ? `${tabDone} / ${tabTotal} done` : `Past day · Day ${dayOf(c, sel)} · ${pretty(sel)} · ${tabDone} / ${tabTotal} done`}
              </div>
            </div>
            <div className="head-right">
              {editingTasks ? (
                <button className="btn primary" type="button" onClick={() => setEditingTasks(false)}>Done</button>
              ) : !isToday && (
                <button className="btn" type="button" onClick={() => setSelected(t)}>Back to today</button>
              )}
            </div>
          </div>
          {editingTasks ? (
            <TaskEditor
              tasks={c.tasks}
              sections={sections}
              shown={tabSections}
              tabId={tab}
              today={t}
              onChange={(changes) => setData((prev) => ({ ...prev, challenge: { ...prev.challenge, ...changes } }))}
            />
          ) : tabTotal === 0 ? (
            <p className="empty tab-empty">No tasks on this tab yet. Tap Edit tasks to add some.</p>
          ) : (
            tabSections.map((s) => {
              const list = selTasks.filter((x) => sectionOf(x, sections) === s.id);
              if (!list.length) return null;
              const n = list.filter((x) => log.done.includes(x.id)).length;
              return (
                <div className={'section' + (n === list.length ? ' all-done' : '')} key={s.id}>
                  <div className="section-head">
                    <h3>{s.label}</h3>
                    <span className="count">{n}/{list.length}</span>
                  </div>
                  <ul className="tasks">
                    {list.map((task) => (
                      <TaskLine
                        key={task.id}
                        task={task}
                        checked={log.done.includes(task.id)}
                        time={log.times && log.times[task.id]}
                        open={timeOpen === sel + ':' + task.id}
                        onToggle={() => toggleTask(task.id)}
                        onOpen={() => setTimeOpen(sel + ':' + task.id)}
                        onClose={() => setTimeOpen(null)}
                        onSetTime={(field, value) => setTaskTime(task.id, field, value)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        {isMain && (<>
        <NotesCard
          key={sel}
          note={log.note || ''}
          dateLabel={isToday ? 'Today · ' + pretty(sel) : pretty(sel)}
          onSave={(note) => updateLog(sel, (l) => ({ ...l, note }))}
        />
        </>)}

        {tab === cardTab && (<>
        <DueCard items={dueItems} today={t} sections={sections} onUpdate={updateHorizon} onAddToToday={addHorizonToToday} />

        <HorizonCard
          items={horizon}
          today={t}
          onAdd={(item) => setData((prev) => ({ ...prev, horizon: [...(prev.horizon || []), item] }))}
          onRemove={(id) => setData((prev) => ({ ...prev, horizon: (prev.horizon || []).filter((i) => i.id !== id) }))}
          reminders={reminders}
          onEnableReminders={turnOnReminders}
        />

        <DealsCard deals={data.deals || []} today={t} onChange={(deals) => setData((prev) => ({ ...prev, deals }))} />

        <section className="card weekly" aria-label="Weekly tasks">
          <div className="weekly-head">
            <div>
              <div className="eyebrow">{wk === weekStart(t) ? 'This week · ' : 'Week of '}{pretty(wk)}</div>
              <h2 className="eyebrow weekly-title">Weekly tasks</h2>
            </div>
            <div className="head-right">
              {weekly.length > 0 && <span className="count">{weekly.filter((i) => i.done).length}/{weekly.length}</span>}
              {weekly.length > 0 && (
                <button className="btn" type="button" onClick={() => setWeeklyEditing(!weeklyEditing)}>{weeklyEditing ? 'Done' : 'Edit'}</button>
              )}
            </div>
          </div>

          {weekly.length > 0 ? (
            <ul className="weekly-list">
              {weekly.map((item, i) => (
                <li key={item.id}>
                  {weeklyEditing ? (
                    <div className="row">
                      <input className="text" id={'weekly-' + item.id} maxLength={80} aria-label={`Weekly task ${i + 1}`} value={item.label}
                        onChange={(e) => { const v = e.target.value; updateWeek((items) => items.map((x) => (x.id === item.id ? { ...x, label: v } : x))); }}
                        onBlur={(e) => { if (!e.target.value.trim()) updateWeek((items) => items.filter((x) => x.id !== item.id)); }} />
                      <button className="icon-btn" type="button" aria-label={`Remove ${item.label}`}
                        onClick={() => updateWeek((items) => items.filter((x) => x.id !== item.id))}>×</button>
                    </div>
                  ) : (
                    <div className="task-line weekly-line">
                      <CheckRow label={item.label} checked={!!item.done}
                        onToggle={() => updateWeek((items) => items.map((x) => {
                          if (x.id !== item.id) return x;
                          // Remember when a weekly task was finished.
                          if (x.done) { const { doneOn, doneAt, ...rest } = x; return { ...rest, done: false }; }
                          return { ...x, done: true, doneOn: t, doneAt: nowHM() };
                        }))} />
                      {item.done && item.doneOn && (
                        <span className="time-chip static">{pretty(item.doneOn)} · {fmtTime(item.doneAt)}</span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Nothing for this week yet. Add bigger goals here, like free sample videos or a brand call.</p>
          )}

          <div className="edit-row">
            <input className="text" id="weeklyInput" maxLength={80} value={weeklyDraft}
              placeholder="Add a weekly task, e.g. FREE SAMPLE VID - magnesium gummies" aria-label="New weekly task"
              onChange={(e) => setWeeklyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addWeekly(); }} />
            <button className="btn primary" type="button" onClick={addWeekly} disabled={!weeklyDraft.trim()}>Add</button>
          </div>
        </section>
        </>)}

        {saveStatus === 'error' && (
          <p className="foot err">Couldn't save. Check your connection; your changes will retry on your next tap.</p>
        )}

        {settingsOpen && (
          <div className="sheet-backdrop" onClick={closeSettings}>
            <aside className="sheet" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-head">
                {setupOpen
                  ? <button className="link back" type="button" onClick={() => setSetupOpen(false)}>‹ Settings</button>
                  : <h2>Settings</h2>}
                <button className="icon-btn" type="button" ref={closeRef} aria-label="Close settings" onClick={closeSettings}>×</button>
              </div>

              {setupOpen ? (
                <Setup
                  data={data}
                  today={t}
                  onCancel={() => setSetupOpen(false)}
                  onSave={(changes) => { setData((prev) => ({ ...prev, challenge: { ...prev.challenge, ...changes } })); setSelected(t); closeSettings(); }}
                  onReset={() => { setData((prev) => ({ ...freshData(t), challenge: { ...prev.challenge, start: t } })); setSelected(t); closeSettings(); }}
                />
              ) : (<>
                <section className="sheet-group">
                  <div className="eyebrow">Account</div>
                  <div className="account-row">
                    <div>
                      <b>{user.email}</b>
                      <span className="hint">
                        {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? "Couldn't save. Check your connection." : 'All changes saved'}
                      </span>
                    </div>
                    <button className="btn" type="button" onClick={handleSignOut}>Sign out</button>
                  </div>
                </section>

                <section className="sheet-group">
                  <div className="eyebrow">Challenge</div>
                  <button className="menu-item" type="button"
                    onClick={() => { closeSettings(); setEditingTasks(true); setSelected(t); window.scrollTo({ top: 0 }); }}>
                    <b>Edit tasks</b>
                    <span className="sub">Add, rename or move tasks and sections on the {tabs.find((x) => x.id === tab).label} tab</span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                  <button className="menu-item" type="button" onClick={() => setSetupOpen(true)}>
                    <b>Edit challenge</b>
                    <span className="sub">Name, length, missed-day rules and start date</span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                </section>

                <section className="sheet-group">
                  <div className="eyebrow">History</div>
                  <div className="stats-row">
                    <div><b>{day}<span>/{c.length}</span></b><span>Day</span></div>
                    <div><b>{streak(data, t)}</b><span>Streak</span></div>
                    <div><b>{done}</b><span>Days done</span></div>
                    <div><b>{data.attempts.length}</b><span>Restarts</span></div>
                  </div>
                  <p className="hint">
                    {c.rule === 'strict'
                      ? 'Hard rules: miss a day and you restart at Day 1.'
                      : `Grace days: ${Math.min(missesSoFar(data, t), c.grace)} of ${c.grace} used. Miss more and you restart.`}
                  </p>
            <section className="card grid-card" aria-label="All days">
              <div>
                <div className="eyebrow">Tap a day to view or edit it</div>
                <h2>All {c.length} days</h2>
              </div>
              <div className="days" style={{ gridTemplateColumns: `repeat(${Math.min(cols, c.length)}, minmax(0, 1fr))` }}>
                {Array.from({ length: c.length }, (_, i) => {
                  const d = addDays(c.start, i);
                  const st = cellState(data, d, t);
                  return (
                    <button key={d} type="button" disabled={st === 'future'} onClick={() => { closeSettings(); selectDay(d); }}
                      className={`cell ${st}${d === t ? ' is-today' : ''}${d === sel ? ' selected' : ''}`}
                      aria-label={`Day ${i + 1}, ${pretty(d)}, ${{ done: 'complete', open: 'in progress', missed: 'missed', future: 'upcoming' }[st]}`}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="legend">
                <span><i className="l-done" />Complete</span>
                <span><i className="l-open" />In progress</span>
                <span><i className="l-miss" />Missed</span>
                <span><i />Upcoming</span>
              </div>
            </section>

            {data.attempts.length > 0 && (
              <section className="card history">
                <div className="eyebrow">Past attempts</div>
                <ol>
                  {data.attempts.map((a, i) => (
                    <li key={i}>{pretty(a.start)} to {pretty(a.end)}: reached Day {a.reached} of {a.length}</li>
                  ))}
                </ol>
              </section>
            )}
                </section>
              </>)}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

// The admin for your routine. Changes save as you type.
// New tasks start counting today; removed tasks stop counting today; "today only" tasks count for today alone.
function TaskEditor({ tasks, sections, shown, tabId, today, onChange }) {
  const [drafts, setDrafts] = useState({});
  const [repeat, setRepeat] = useState({});
  const [newSection, setNewSection] = useState('');
  const [armedSection, setArmedSection] = useState(null);
  const tomorrow = addDays(today, 1);
  const visible = tasks.filter((x) => !x.removed || x.removed > today);

  useEffect(() => {
    if (!armedSection) return;
    const id = setTimeout(() => setArmedSection(null), 4000);
    return () => clearTimeout(id);
  }, [armedSection]);

  // Drops a task added today; otherwise ends it as of today so past days keep it.
  const retire = (list, task) => (task.added === today
    ? list.filter((x) => x.id !== task.id)
    : list.map((x) => (x.id === task.id ? { ...x, removed: today } : x)));

  const add = (sectionId) => {
    const label = (drafts[sectionId] || '').trim();
    if (!label) return;
    const once = repeat[sectionId] === 'once';
    onChange({ tasks: [...tasks, { id: uid(), section: sectionId, label, added: today, ...(once ? { removed: tomorrow } : {}) }] });
    setDrafts((d) => ({ ...d, [sectionId]: '' }));
  };
  const remove = (task) => onChange({ tasks: retire(tasks, task) });
  const rename = (task, label) => onChange({ tasks: tasks.map((x) => (x.id === task.id ? { ...x, label } : x)) });
  const move = (list, i, dir) => {
    const a = tasks.indexOf(list[i]);
    const b = tasks.indexOf(list[i + dir]);
    const next = [...tasks];
    [next[a], next[b]] = [next[b], next[a]];
    onChange({ tasks: next });
  };

  const addSection = () => {
    const label = newSection.trim();
    if (!label) return;
    // New sections join the tab you're on.
    onChange({ sections: [...sections, { id: uid(), label, tab: tabId }] });
    setNewSection('');
  };
  const renameSection = (id, label) => onChange({ sections: sections.map((s) => (s.id === id ? { ...s, label } : s)) });
  const setTab = (id, tab) => onChange({ sections: sections.map((s) => (s.id === id ? { ...s, tab } : s)) });
  // Moves a section past its neighbour within this tab.
  const moveSection = (i, dir) => {
    const a = sections.indexOf(shown[i]);
    const b = sections.indexOf(shown[i + dir]);
    const next = [...sections];
    [next[a], next[b]] = [next[b], next[a]];
    onChange({ sections: next });
  };
  const deleteSection = (s) => {
    if (armedSection !== s.id) return setArmedSection(s.id);
    let next = tasks;
    visible.filter((x) => sectionOf(x, sections) === s.id).forEach((task) => { next = retire(next, task); });
    onChange({ tasks: next, sections: sections.filter((x) => x.id !== s.id) });
    setArmedSection(null);
  };

  return (
    <div className="task-editor">
      {shown.map((s, si) => {
        const list = visible.filter((x) => sectionOf(x, sections) === s.id);
        return (
          <div className="editor-section" key={s.id}>
            <div className="row section-row">
              <div className="order">
                <button type="button" className="icon-btn small" aria-label={`Move ${s.label} section up`} disabled={si === 0} onClick={() => moveSection(si, -1)}>↑</button>
                <button type="button" className="icon-btn small" aria-label={`Move ${s.label} section down`} disabled={si === shown.length - 1} onClick={() => moveSection(si, 1)}>↓</button>
              </div>
              <input className="text section-input" id={'sec-' + s.id} maxLength={30} aria-label="Section name" value={s.label}
                onChange={(e) => renameSection(s.id, e.target.value)}
                onBlur={(e) => { if (!e.target.value.trim()) renameSection(s.id, 'Untitled'); }} />
              <label className="tab-pick" htmlFor={'tab-' + s.id}>
                <span>Tab</span>
                <select className="text" id={'tab-' + s.id} value={hasOwnTab(s) ? 'own' : tabOf(s, sections)}
                  onChange={(e) => setTab(s.id, e.target.value)}>
                  <option value="main">Accounts</option>
                  {sections.filter((x) => x.id !== s.id && hasOwnTab(x)).map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                  <option value="own">Own tab</option>
                </select>
              </label>
              <button type="button" className={'btn danger small-btn' + (armedSection === s.id ? ' armed' : '')}
                disabled={sections.length === 1} onClick={() => deleteSection(s)}>
                {armedSection === s.id ? (list.length ? `Delete + ${list.length} tasks?` : 'Delete?') : 'Delete'}
              </button>
            </div>

            {list.map((task, i) => (
              <div className="row" key={task.id}>
                <div className="order">
                  <button type="button" className="icon-btn small" aria-label={`Move ${task.label} up`} disabled={i === 0} onClick={() => move(list, i, -1)}>↑</button>
                  <button type="button" className="icon-btn small" aria-label={`Move ${task.label} down`} disabled={i === list.length - 1} onClick={() => move(list, i, 1)}>↓</button>
                </div>
                <div className="task-input">
                  <input className="text" id={'task-' + task.id} maxLength={60} aria-label={`${s.label} task ${i + 1}`} value={task.label}
                    onChange={(e) => rename(task, e.target.value)}
                    onBlur={(e) => { if (!e.target.value.trim() && visible.length > 1) remove(task); }} />
                  {task.removed === tomorrow && <span className="tag">Today only</span>}
                </div>
                <button className="icon-btn" type="button" aria-label={`Remove ${task.label || 'task'}`}
                  disabled={visible.length === 1} onClick={() => remove(task)}>×</button>
              </div>
            ))}
            {!list.length && <p className="hint">No tasks yet. Empty sections are hidden from your checklist.</p>}

            <div className="row add-row">
              <input className="text" id={'new-' + s.id} maxLength={60} placeholder={`Add to ${s.label}`} aria-label={`New ${s.label} task`}
                value={drafts[s.id] || ''} onChange={(e) => { const v = e.target.value; setDrafts((d) => ({ ...d, [s.id]: v })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') add(s.id); }} />
              <select className="text repeat" id={'repeat-' + s.id} aria-label="How often"
                value={repeat[s.id] || 'daily'} onChange={(e) => { const v = e.target.value; setRepeat((r) => ({ ...r, [s.id]: v })); }}>
                <option value="daily">Every day</option>
                <option value="once">Today only</option>
              </select>
              <button className="btn primary" type="button" onClick={() => add(s.id)} disabled={!(drafts[s.id] || '').trim()}>Add</button>
            </div>
          </div>
        );
      })}

      <div className="editor-section new-section">
        <h3>New section</h3>
        <div className="row add-row">
          <input className="text" id="newSection" maxLength={30} placeholder="e.g. 100 Anxiety Tips" aria-label="New section name"
            value={newSection} onChange={(e) => setNewSection(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSection(); }} />
          <button className="btn primary" type="button" onClick={addSection} disabled={!newSection.trim()}>Add section</button>
        </div>
      </div>

      <p className="hint">Changes start today. Past days keep the tasks they had, so editing your routine never breaks your streak.</p>
    </div>
  );
}

function Setup({ data, today, onCancel, onSave, onReset }) {
  const c = data.challenge;
  const preset = [30, 75, 100].includes(c.length);
  const [name, setName] = useState(c.name);
  const [lenPick, setLenPick] = useState(preset ? String(c.length) : 'custom');
  const [lenCustom, setLenCustom] = useState(preset ? '' : String(c.length));
  const [rule, setRule] = useState(c.rule);
  const [grace, setGrace] = useState(String(c.grace));
  const [start, setStart] = useState(c.start);
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);
  const ref = useRef(null);

  useEffect(() => { if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const save = () => {
    const length = parseInt(lenPick === 'custom' ? lenCustom : lenPick, 10);
    if (!(length >= 7 && length <= 365)) return setError('Pick a length between 7 and 365 days.');
    const g = parseInt(grace, 10);
    if (rule === 'grace' && !(g >= 1 && g <= 10)) return setError('Grace days need to be between 1 and 10.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return setError('Choose the date of Day 1.');
    onSave({ name: name.trim() || '75 Creator', length, rule, grace: g || 2, start });
  };

  return (
    <section className="card setup" ref={ref} aria-label="Edit challenge">
      <div>
        <div className="eyebrow">Your rules</div>
        <h2>Edit challenge</h2>
      </div>

      <div className="field">
        <label className="eyebrow" htmlFor="fName">Challenge name</label>
        <input className="text" id="fName" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <span className="eyebrow">Length</span>
        <div className="chips" role="radiogroup" aria-label="Length in days">
          {['30', '75', '100', 'custom'].map((v) => (
            <label className="chip" key={v}>
              <input type="radio" name="len" id={'len' + v} value={v} checked={lenPick === v} onChange={() => setLenPick(v)} />
              <span>{v === 'custom' ? 'Custom' : v + ' days'}</span>
            </label>
          ))}
          <input className="text num" id="lenCustom" type="number" min="7" max="365" placeholder="Days" aria-label="Custom length in days"
            value={lenCustom} onFocus={() => setLenPick('custom')} onChange={(e) => setLenCustom(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <span className="eyebrow">If you miss a day</span>
        <div className="rules">
          <label className={rule === 'strict' ? 'on' : ''}>
            <input type="radio" name="rule" id="ruleStrict" checked={rule === 'strict'} onChange={() => setRule('strict')} />
            <span><b>Hard rules</b><small>Miss one day and you restart at Day 1. The real 75 Hard way.</small></span>
          </label>
          <label className={rule === 'grace' ? 'on' : ''}>
            <input type="radio" name="rule" id="ruleGrace" checked={rule === 'grace'} onChange={() => setRule('grace')} />
            <span><b>Grace days</b><small>You can miss up to{' '}
              <input className="text num inline" id="graceN" type="number" min="1" max="10" aria-label="Number of grace days"
                value={grace} onFocus={() => setRule('grace')} onChange={(e) => setGrace(e.target.value)} />
              {' '}days before you restart.</small></span>
          </label>
        </div>
      </div>

      <div className="field">
        <label className="eyebrow" htmlFor="fStart">Day 1 was</label>
        <input className="text date" id="fStart" type="date" max={today} value={start} onChange={(e) => setStart(e.target.value)} />
      </div>

      {error && <p className="err">{error}</p>}

      <div className="actions">
        <div className="row">
          <button className="btn primary" type="button" onClick={save}>Save</button>
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        </div>
        <button className={'btn danger' + (armed ? ' armed' : '')} type="button"
          onClick={() => { if (armed) { setArmed(false); onReset(); } else setArmed(true); }}>
          {armed ? 'Tap again to reset everything' : 'Reset challenge'}
        </button>
      </div>
    </section>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');

:root {
  --ground: #EDF0F4;
  --surface: #FFFFFF;
  --ink: #10151C;
  --muted: #5A6472;
  --line: #D3DAE3;
  --accent: #2448F2;
  --accent-ink: #FFFFFF;
  --accent-soft: #E3E9FF;
  --miss: #D12F36;
  --miss-soft: #FBE4E5;
  --partial: #C98A0C;
  --check: #E5484D;
  --check-ink: #FFFFFF;
  --display: "Big Shoulders Display", "Arial Narrow", Impact, sans-serif;
  --body: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ground: #0C1016; --surface: #151B24; --ink: #E7EBF1; --muted: #8B95A4; --line: #263040;
    --accent: #6F8CFF; --accent-ink: #0C1016; --accent-soft: #1C2647;
    --miss: #FF6B70; --miss-soft: #3A1A1D; --partial: #F0B547;
    --check: #EF4A50; --check-ink: #FFFFFF;
  }
}

html, body, #root { background: var(--ground); }
body { color: var(--ink); font: 16px/1.5 var(--body); }
.app {
  min-height: 100%;
  padding: 20px max(16px, env(safe-area-inset-right, 0px)) 64px max(16px, env(safe-area-inset-left, 0px));
}
.wrap { max-width: 640px; margin: 0 auto; display: grid; gap: 18px; }
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.loading { min-height: 60vh; display: grid; place-content: center; gap: 12px; text-align: center; color: var(--muted); }

.eyebrow { font: 500 11px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
h2 { margin: 0; }

header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.logo { display: flex; align-items: center; gap: 10px; }
.logo-mark { font: 900 48px/.8 var(--display); letter-spacing: -.02em; display: flex; align-items: flex-start; }
.logo-mark span { font-size: 18px; margin-left: 2px; }
.logo-word { font: 500 12px/1 var(--mono); letter-spacing: .3em; color: var(--muted); }
.challenge-name { font: 900 22px/1 var(--display); text-transform: uppercase; margin: 10px 0 0; color: var(--muted); }

.btn { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 8px 16px; font-weight: 600; font-size: 14px; }
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btn.wide { width: 100%; padding: 12px 16px; }
.btn.danger { color: var(--miss); }
.btn.danger.armed { background: var(--miss); color: var(--surface); border-color: var(--miss); }
.link { background: none; border: 0; padding: 0; color: var(--muted); text-decoration: underline; font-size: inherit; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }

.banner { border-radius: 12px; padding: 14px 16px; display: grid; gap: 10px; }
.banner p { margin: 0; }
.banner.fail { background: var(--miss-soft); }
.banner.fail strong { color: var(--miss); }

.finished { padding: 22px 20px; display: grid; gap: 6px; background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.finished .eyebrow { color: inherit; opacity: .8; }
.finished h2 { font: 900 36px/1 var(--display); text-transform: uppercase; }
.finished p { margin: 0; }

header.top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.top-left { justify-self: start; min-width: 0; }
.top-right { justify-self: end; }
.top-day { text-align: center; }
.top-daynum { font: 900 44px/.95 var(--display); text-transform: uppercase; letter-spacing: .01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.top-date { margin-top: 4px; font-size: 15px; color: var(--muted); white-space: nowrap; }
@media (max-width: 480px) { .logo-word { display: none; } .top-daynum { font-size: 38px; } }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.stats-row > div { display: grid; gap: 4px; }
.stats-row b { font: 800 26px/1 var(--display); font-variant-numeric: tabular-nums; }
.stats-row b span { font-size: .6em; color: var(--muted); }
.stats-row > div > span { font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.gear { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.gear:hover { border-color: var(--muted); }
.gear svg { width: 21px; height: 21px; }

.sheet-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; justify-content: flex-end; background: rgba(4, 7, 12, .6); }
.sheet {
  width: min(440px, 100%); height: 100%; overflow-y: auto; overscroll-behavior: contain;
  display: grid; align-content: start; gap: 24px;
  background: var(--ground); border-left: 1px solid var(--line);
  padding: calc(18px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) calc(32px + env(safe-area-inset-bottom, 0px)) 16px;
}
.sheet-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.sheet-head h2 { font: 800 28px/1 var(--display); text-transform: uppercase; }
.sheet-head .icon-btn { height: 40px; width: 40px; font-size: 22px; }
.back { font-weight: 600; text-decoration: none; color: var(--ink); font-size: 16px; }
.sheet-group { display: grid; gap: 10px; }
.account-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.account-row b { display: block; overflow-wrap: anywhere; font-weight: 600; }
.account-row .hint { display: block; margin-top: 2px; }
.menu-item { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; text-align: left; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.menu-item:hover { border-color: var(--muted); }
.menu-item b { font-weight: 600; }
.menu-item .sub { grid-column: 1; color: var(--muted); font-size: 14px; }
.menu-item .chev { grid-column: 2; grid-row: 1 / span 2; align-self: center; color: var(--muted); font-size: 22px; }
.sheet .grid-card { padding: 16px; }
.foot.err { color: var(--miss); }

.daybar { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.daybar-day { font: 800 20px/1 var(--display); text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.daybar-day b { font-weight: 900; }
.daybar-day span { color: var(--muted); font-weight: 700; }
.daybar .rail { flex: 1 1 120px; height: 6px; }
.daybar-stats { display: flex; gap: 14px; font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); white-space: nowrap; }
.daybar-stats b { color: var(--ink); font-size: 13px; margin-left: 3px; font-variant-numeric: tabular-nums; }
.rail { height: 8px; border-radius: 99px; background: var(--line); overflow: hidden; }
.rail i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .4s ease; }

.today { overflow: hidden; scroll-margin-top: 16px; }
.today-head { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.today-head h2 { font: 800 26px/1 var(--display); text-transform: uppercase; margin-top: 4px; }
.count { font: 500 13px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.tasks { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.task { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 20px; background: none; border: 0; border-bottom: 1px solid var(--line); text-align: left; font-size: 17px; }
.task:hover { background: var(--ground); }
.box { flex: none; width: 26px; height: 26px; border-radius: 7px; border: 2px solid var(--line); display: grid; place-items: center; transition: background .15s, border-color .15s; }
.box svg { width: 16px; height: 16px; opacity: 0; }
.task[aria-pressed="true"] .box { background: var(--check); border-color: var(--check); }
.task[aria-pressed="true"] .box svg { opacity: 1; }
.task[aria-pressed="true"] .label { color: var(--muted); }
.task-line { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
.task-line .task { flex: 1; min-width: 0; border-bottom: 0; padding-right: 8px; }
.time-chip { flex: none; margin-right: 16px; font: 500 12px/1 var(--mono); color: var(--ink); background: var(--ground); border: 1px solid var(--line); border-radius: 99px; padding: 7px 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.time-chip:hover { border-color: var(--muted); }
.time-chip.empty { color: var(--muted); background: none; border-color: transparent; padding: 7px; opacity: .55; }
.time-chip.empty:hover, .time-chip.empty[aria-expanded="true"] { opacity: 1; border-color: var(--line); }
.time-chip svg { width: 15px; height: 15px; display: block; }
.time-chip.static { margin-right: 0; color: var(--muted); }
.time-chip.static:hover { border-color: var(--line); }
.time-edit { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 12px 20px 14px 60px; background: var(--ground); border-bottom: 1px solid var(--line); }
.time-edit label { display: grid; gap: 6px; font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.time-edit .text { width: auto; padding: 7px 10px; font: 400 15px/1.2 var(--body); background: var(--surface); text-transform: none; letter-spacing: 0; color: var(--ink); }
.weekly-line { border-bottom: 0; }
.notes { padding: 18px 20px 20px; display: grid; gap: 12px; }
.notes-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.notes h2 { font: 600 15px/1.2 var(--body); letter-spacing: 0; margin-top: 4px; }
.notes textarea { min-height: 120px; resize: vertical; line-height: 1.5; }
.notes-actions { align-items: center; }
.note-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; padding: 12px 14px; background: var(--ground); border: 1px solid var(--line); border-radius: 10px; }

.weekly { padding: 16px 20px; display: grid; gap: 10px; }
.weekly-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.weekly-title { color: var(--ink); margin-top: 4px; font-size: 13px; }
.weekly-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.weekly-list .row { flex-wrap: nowrap; }
.weekly-list .text { flex: 1; min-width: 0; }
.weekly .task { padding: 6px 0; border: 0; }
.weekly .task:hover { background: none; }
.empty { color: var(--muted); margin: 0; font-size: 15px; }
.edit-row { display: flex; gap: 8px; flex-wrap: wrap; }
.edit-row .text { flex: 1 1 200px; }

.grid-card { padding: 18px 20px 20px; display: grid; gap: 14px; }
.grid-card h2 { font: 800 22px/1 var(--display); text-transform: uppercase; margin-top: 4px; }
.days { display: grid; gap: 4px; }
.cell { aspect-ratio: 1; max-width: 100%; border-radius: 5px; border: 1px solid var(--line); background: transparent; font: 500 9px/1 var(--mono); color: var(--muted); display: grid; place-items: center; padding: 0; font-variant-numeric: tabular-nums; }
.cell.done { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.cell.missed { background: var(--miss-soft); border-color: var(--miss); color: var(--miss); }
.cell.open { border: 2px solid var(--partial); color: var(--ink); }
.cell.future { border-style: dashed; cursor: default; }
.cell.is-today { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.cell.selected:not(.is-today) { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--line); display: inline-block; }
.legend .l-done { background: var(--accent); border-color: var(--accent); }
.legend .l-open { border: 2px solid var(--partial); }
.legend .l-miss { background: var(--miss-soft); border-color: var(--miss); }

.history { padding: 16px 20px; display: grid; gap: 8px; }
.history ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 15px; }

.setup { padding: 20px; display: grid; gap: 20px; }
.setup h2 { font: 800 26px/1 var(--display); text-transform: uppercase; margin-top: 4px; }
.field { display: grid; gap: 8px; }
.text { width: 100%; border: 1px solid var(--line); border-radius: 10px; background: var(--ground); padding: 10px 12px; font-size: 16px; }
.text.num { width: 84px; }
.text.inline { width: 64px; padding: 4px 8px; display: inline-block; }
.text.date { max-width: 220px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip input { position: absolute; opacity: 0; pointer-events: none; }
.chip span { display: inline-block; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: 14px; cursor: pointer; }
.chip input:checked + span { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.rules { display: grid; gap: 8px; }
.rules label { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; cursor: pointer; }
.rules label.on { border-color: var(--accent); background: var(--accent-soft); }
.rules input[type="radio"] { margin-top: 4px; accent-color: var(--accent); }
.rules b { display: block; }
.rules small { color: var(--muted); font-size: 14px; }
.head-right { display: flex; align-items: center; gap: 12px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 14px 20px 8px; border-top: 1px solid var(--line); background: var(--ground); }
.section h3, .editor-section h3 { margin: 0; font: 600 15px/1.2 var(--body); letter-spacing: 0; }
.section.all-done .section-head .count { color: var(--accent); }
.section .tasks { border-top: 1px solid var(--line); }
.task-editor .section-row { align-items: center; flex-wrap: wrap; }
.section-row .section-input { flex: 1 1 160px; }
.tab-pick { display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.tab-pick .text { width: auto; padding: 6px 8px; font: 500 13px/1.2 var(--body); text-transform: none; letter-spacing: 0; color: var(--ink); background: var(--surface); }

.tabs { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; display: flex; gap: 6px; overflow-x: auto; padding-block: 8px; margin-block: -6px; background: var(--ground); scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab { flex: none; display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 14px; color: var(--muted); }
.tab:hover { color: var(--ink); }
.tab.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.tab-count { font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; opacity: .75; }
.tab.complete:not(.on) .tab-count { color: var(--accent); opacity: 1; }
.tab-empty { padding: 16px 20px 20px; border-top: 1px solid var(--line); }
.section-input { font: 800 18px/1.1 var(--display) !important; text-transform: uppercase; letter-spacing: .02em; background: transparent !important; }
.small-btn { flex: none; padding: 6px 12px; font-size: 13px; }
.task-input { flex: 1; min-width: 0; position: relative; display: flex; }
.task-input .text { flex: 1; }
.tag { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--accent); background: var(--accent-soft); padding: 4px 6px; border-radius: 4px; pointer-events: none; }
.repeat { flex: none !important; width: auto !important; padding-right: 8px; }
.new-section { padding-top: 16px; border-top: 1px dashed var(--line); }
.add-row { flex-wrap: wrap !important; }
.add-row .text:first-child { flex: 1 1 180px; }
.task-editor { display: grid; gap: 20px; padding: 14px 20px 18px; border-top: 1px solid var(--line); }
.editor-section { display: grid; gap: 8px; }
.task-editor .row { flex-wrap: nowrap; align-items: stretch; }
.task-editor .text { flex: 1; min-width: 0; width: auto; }
.task-editor .add-row { margin-top: 6px; }
.order { display: grid; gap: 2px; }
.hint { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
.icon-btn { flex: none; width: 42px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 20px; line-height: 1; }
.icon-btn.small { width: 30px; height: 21px; font-size: 13px; border-radius: 6px; }
.icon-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--muted); }
.icon-btn:disabled, .btn:disabled { opacity: .35; cursor: default; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }
.err { color: var(--miss); font-size: 14px; margin: 0; }
.foot { text-align: center; color: var(--muted); font-size: 13px; margin: 6px 0 0; }

.auth { max-width: 360px; margin: 8vh auto 0; padding: 28px 24px; display: grid; gap: 16px; justify-items: center; }
.auth h2 { font: 800 26px/1 var(--display); text-transform: uppercase; }
.auth-form { width: 100%; display: grid; gap: 10px; }
.or { width: 100%; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; }
.or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }

.kind { flex: none; display: inline-block; white-space: nowrap; font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; padding: 5px 7px; border-radius: 5px; border: 1px solid transparent; }
.kind-task { color: var(--accent); background: var(--accent-soft); }
.kind-schedule { color: var(--partial); border-color: var(--partial); }

.due { padding: 18px 20px; display: grid; gap: 14px; border: 2px solid var(--accent); background: var(--accent-soft); }
.due h2 { font: 800 26px/1 var(--display); text-transform: uppercase; margin-top: 4px; }
.due-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.due-item { background: var(--surface); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; }
.due-text { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 17px; }
.overdue { font: 500 12px var(--mono); color: var(--miss); }
.due-target { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); }
.due-target .text { width: auto; padding: 6px 10px; }

.horizon { padding: 18px 20px 20px; display: grid; gap: 14px; }
.horizon h2 { font: 800 22px/1 var(--display); text-transform: uppercase; }
.capture { display: grid; gap: 8px; }
.capture .row { align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; }
.seg button { border: 0; background: none; padding: 6px 12px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--muted); }
.seg button.on { background: var(--ink); color: var(--surface); }
.date-small { width: auto; padding: 7px 10px; font-size: 14px; }
.upcoming { display: grid; gap: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.up-group { display: grid; gap: 8px; }
.up-date { display: flex; align-items: center; gap: 8px; font: 500 11px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.up-count { font-size: 10px; color: var(--ink); border: 1px solid var(--line); border-radius: 99px; padding: 3px 7px; letter-spacing: 0; }
.up-group ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.up-item { display: flex; align-items: center; gap: 12px; padding: 10px 8px 10px 12px; background: var(--ground); border: 1px solid var(--line); border-radius: 10px; }
.up-item .what { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 15px; line-height: 1.35; }
.up-remove { flex: none; width: 30px; height: 30px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 18px; line-height: 1; }
.up-remove:hover { color: var(--miss); background: var(--miss-soft); }
.reminders { display: grid; gap: 6px; justify-items: start; }
.on-note { margin: 0; color: var(--accent); font-size: 14px; font-weight: 600; }

.deals { padding: 18px 20px 20px; display: grid; gap: 14px; }
.deals-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.deals-head h2 { font: 800 22px/1 var(--display); text-transform: uppercase; margin-top: 4px; }
.deals-total { display: grid; justify-items: end; gap: 4px; }
.deals-total b { font: 800 28px/1 var(--display); font-variant-numeric: tabular-nums; }
.deal-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.deal { border: 1px solid var(--line); border-radius: 12px; background: var(--ground); overflow: hidden; }
.deal.open { border-color: var(--accent); }
.deal-row { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px; background: none; border: 0; text-align: left; }
.deal-main { display: grid; gap: 2px; min-width: 0; flex: 1 1 180px; }
.deal-brand { font-weight: 600; font-size: 16px; overflow-wrap: anywhere; }
.deal-what { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.deal-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.deal-amount { font: 500 14px/1 var(--mono); font-variant-numeric: tabular-nums; }
.deal-status, .deal-due { font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; padding: 5px 7px; border-radius: 5px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.deal-status.s-active { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.deal-status.s-posted { color: var(--partial); border-color: var(--partial); }
.deal-status.s-paid { color: var(--muted); }
.deal-due.soon { color: var(--partial); border-color: var(--partial); }
.deal-due.late { color: var(--miss); background: var(--miss-soft); border-color: transparent; }
.deal-edit { display: grid; gap: 12px; padding: 4px 14px 14px; border-top: 1px solid var(--line); padding-top: 14px; }
.deal-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.deal-fields label, .deal-notes { display: grid; gap: 6px; font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.deal-edit .text { background: var(--surface); font: 400 15px/1.3 var(--body); text-transform: none; letter-spacing: 0; color: var(--ink); padding: 8px 10px; }
.deal-notes textarea { min-height: 60px; resize: vertical; }
.deal-edit .seg { justify-self: start; }
.deal-add { display: grid; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
.deal-add .row { flex-wrap: wrap; }
.deal-amt { flex: 1 1 110px; width: auto; }
.deal-paid { display: grid; gap: 10px; justify-items: start; }
.deal-paid .deal-list { width: 100%; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
