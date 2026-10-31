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
// Today, Tomorrow and Brand Deals live on 30K Months when that tab exists.
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
  const [due, setDue] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);

  const byDue = (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0;
  const open = deals.filter((d) => d.status !== 'paid').sort((a, b) => (a.status === b.status ? byDue(a, b) : a.status === 'active' ? -1 : 1));

  const add = () => {
    const b = brand.trim();
    if (!b) return;
    onChange([...deals, { id: uid(), brand: b, what: what.trim(), due: due || null, status: 'active', notes: '', created: today }]);
    setBrand(''); setWhat(''); setDue('');
    setAdding(false);
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
          <h2>Brand Deals</h2>
        </div>
        <div className="deals-total">
          {open.length > 0 && <span className="eyebrow">{open.length === 1 ? '1 open deal' : `${open.length} open deals`}</span>}
          <button type="button" className="plus-btn" aria-label={adding ? 'Close' : 'Add a deal'} aria-expanded={adding}
            onClick={() => setAdding(!adding)}>{adding ? '×' : '+'}</button>
        </div>
      </div>

      {adding && (
        <div className="deal-add">
          <div className="row">
            <input className="text" id="dealBrand" maxLength={50} autoFocus placeholder="Brand" aria-label="Brand"
              value={brand} onChange={(e) => setBrand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <input className="text" id="dealWhat" maxLength={80} placeholder="Deliverable" aria-label="Deliverable"
              value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          </div>
          <div className="row">
            <input className="text date-small deal-due-input" id="dealDue" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
            <button className="btn primary" type="button" onClick={add} disabled={!brand.trim()}>Add deal</button>
          </div>
        </div>
      )}

      {open.length ? <ul className="deal-list">{open.map(row)}</ul> : (
        <p className="empty">No active deals. Tap + when a brand says yes.</p>
      )}

    </section>
  );
}

// Today's to-dos: pending tasks whose day has come, plus anything added with +.
// Checked items stay (checked) until everything is done, then the card hides; Tomorrow pushes one to the next day.
function TodayCard({ items, today, onUpdate, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  };
  const toggle = (item) => {
    if (item.done) onUpdate(item.id, { done: false, doneOn: null });
    else onUpdate(item.id, { done: true, doneOn: today });
  };
  // Only shows while something is left to do.
  if (!items.some((i) => !i.done)) return null;

  return (
    <section className="card due" aria-label="Today">
      <div className="due-head">
        <h2>Today</h2>
        <button type="button" className="plus-btn" aria-label={adding ? 'Close' : 'Add a task for today'} aria-expanded={adding}
          onClick={() => setAdding(!adding)}>{adding ? '×' : '+'}</button>
      </div>
      {adding && (
        <div className="row due-add">
          <input className="text" id="todayText" maxLength={100} autoFocus value={text} placeholder="Add something for today"
            aria-label="New task for today" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} />
          <button className="btn primary" type="button" onClick={add} disabled={!text.trim()}>Add</button>
        </div>
      )}
      <ul className="due-list">
          {items.map((item) => (
            <li key={item.id} className="due-item">
              <CheckRow label={item.text} checked={!!item.done} onToggle={() => toggle(item)} />
              {!item.done && item.date < today && <span className="overdue">from {pretty(item.date)}</span>}
              {!item.done && (
                <button className="btn small-btn" type="button" onClick={() => onUpdate(item.id, { date: addDays(today, 1) })}>Tomorrow</button>
              )}
            </li>
          ))}
        </ul>
    </section>
  );
}

// Things to do on a later day (tomorrow by default); on that day they show in the Today card.
function HorizonCard({ items, today, onAdd, onRemove }) {
  const [text, setText] = useState('');
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
    onAdd({ id: uid(), text: v, kind: 'task', date: date > today ? date : today, created: today });
    setText('');
  };

  return (
    <section className="card horizon" aria-label="Tomorrow">
      <h2>Tomorrow</h2>
      <div className="capture">
        <input className="text" id="horizonText" maxLength={100} value={text} placeholder="Something to do tomorrow"
          aria-label="Pending task" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <div className="row">
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
                    <span className="what">{item.text}</span>
                    <button className="up-remove" type="button" aria-label={`Remove ${item.text}`} onClick={() => onRemove(item.id)}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">Nothing pending. Anything you add here shows up in Today on the day it's due.</p>
      )}
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

// The 75 Creator logo (white on transparent), embedded so the app is still one file.
const LOGO_SRC = 'data:image/png;base64,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';

const Logo = () => <img className="logo-img" src={LOGO_SRC} alt="75 Creator" />;

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
  const [page, setPage] = useState('tasks');
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
  const tabSections = sections.filter((s) => tabOf(s, sections) === tab)
    .sort((a, b) => (b.id === tab) - (a.id === tab));
  const cardTab = tabs.some((x) => x.id === CARD_TAB) ? CARD_TAB : 'main';
  // [done, total] for a tab on the selected day.
  const tabCount = (id) => {
    const ids = sections.filter((s) => tabOf(s, sections) === id).map((s) => s.id);
    const list = selTasks.filter((x) => ids.includes(sectionOf(x, sections)));
    return [list.filter((x) => log.done.includes(x.id)).length, list.length];
  };
  const [, tabTotal] = tabCount(tab);
  const horizon = data.horizon || [];
  // Due today or earlier and not done, plus anything checked off today.
  const dueItems = horizon.filter((i) => i.date <= t && (!i.done || i.doneOn === t));
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


  const updateHorizon = (id, changes) => setData((prev) => ({
    ...prev,
    horizon: (prev.horizon || []).map((i) => (i.id === id ? { ...i, ...changes } : i)),
  }));
  const addTodayItem = (text) => setData((prev) => ({
    ...prev,
    horizon: [...(prev.horizon || []), { id: uid(), text, kind: 'task', date: t, created: t }],
  }));

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="top">
          <div className="top-left">
            <button type="button" className="logo-btn" aria-label={page === 'calendar' ? 'Back to tasks' : 'Open calendar'}
              aria-pressed={page === 'calendar'} onClick={() => { setPage(page === 'calendar' ? 'tasks' : 'calendar'); window.scrollTo({ top: 0 }); }}>
              <Logo />
            </button>
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

        {page === 'tasks' && (<>
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

        {tab === cardTab && <TodayCard items={dueItems} today={t} onUpdate={updateHorizon} onAdd={addTodayItem} />}

        <section className="card today" aria-label="Checklist" ref={checklistRef}>
          {(editingTasks || !isToday) && (
            <div className="today-head">
              <div className="head-status">{isToday ? 'Editing tasks' : `Past day · ${pretty(sel)}`}</div>
              <div className="head-right">
                {editingTasks ? (
                  <button className="btn primary" type="button" onClick={() => setEditingTasks(false)}>Done</button>
                ) : (
                  <button className="btn" type="button" onClick={() => setSelected(t)}>Back to today</button>
                )}
              </div>
            </div>
          )}
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
        <HorizonCard
          items={horizon}
          today={t}
          onAdd={(item) => setData((prev) => ({ ...prev, horizon: [...(prev.horizon || []), item] }))}
          onRemove={(id) => setData((prev) => ({ ...prev, horizon: (prev.horizon || []).filter((i) => i.id !== id) }))}
        />

        <DealsCard deals={data.deals || []} today={t} onChange={(deals) => setData((prev) => ({ ...prev, deals }))} />
        </>)}
        </>)}

        {page === 'calendar' && (
          <div className="calendar-page">
            <div className="calendar-head">
              <h2>Calendar</h2>
              <button className="btn" type="button" onClick={() => setPage('tasks')}>Back to tasks</button>
            </div>
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
                <div className="eyebrow">Tap a day to see its tasks</div>
                <h2>All {c.length} days</h2>
              </div>
              <div className="days" style={{ gridTemplateColumns: `repeat(${Math.min(cols, c.length)}, minmax(0, 1fr))` }}>
                {Array.from({ length: c.length }, (_, i) => {
                  const d = addDays(c.start, i);
                  const st = cellState(data, d, t);
                  return (
                    <button key={d} type="button" disabled={st === 'future'} onClick={() => { setPage('tasks'); selectDay(d); }}
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
          </div>
        )}

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
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Instrument+Sans:wght@400;500;600&display=swap');

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
  --check: #F2163A;
  --check-ink: #FFFFFF;
  --check-glow: none;
  --display: "Big Shoulders Display", "Arial Narrow", Impact, sans-serif;
  --body: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  /* Small labels, counts and times use the same face as everything else. */
  --mono: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --ground: #1B1B1E; --surface: #252528; --ink: #F2F2F2; --muted: #97979C; --line: #35353A;
    --accent: #6F8CFF; --accent-ink: #000000; --accent-soft: #232A3E;
    --miss: #FF6B70; --miss-soft: #2A1112; --partial: #F0B547;
    --check: #FF1F45; --check-ink: #FFFFFF; --check-glow: 0 0 10px rgba(255, 31, 69, .55);
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

.eyebrow { font: 500 13px/1.3 var(--body); color: var(--muted); }
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
.finished h2 { font: 600 18px/1.2 var(--body); text-transform: none; letter-spacing: 0; }
.finished p { margin: 0; }

.logo-img { display: block; height: 64px; width: auto; filter: invert(1); }
@media (prefers-color-scheme: dark) { .logo-img { filter: none; } }
@media (max-width: 480px) { .logo-img { height: 54px; } }
.logo-btn { display: block; padding: 4px; margin: -4px; border: 0; border-radius: 10px; background: none; cursor: pointer; }
.logo-btn:hover .logo-img { opacity: .85; }
.calendar-page { display: grid; gap: 14px; }
.calendar-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.calendar-head h2 { font: 600 15px/1.2 var(--body); }
.calendar-page .grid-card { padding: 20px; }
.calendar-page .days { gap: 6px; }
.calendar-page .cell { font-size: 12px; border-radius: 8px; }
header.top { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
.top-left { justify-self: start; min-width: 0; }
.top-right { justify-self: end; }
.top-day { text-align: center; }
.top-daynum { font: 900 44px/.95 var(--display); text-transform: uppercase; letter-spacing: .01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.top-date { margin-top: 4px; font-size: 15px; color: var(--muted); white-space: nowrap; }
@media (max-width: 480px) { .logo-word { display: none; } .top-daynum { font-size: 38px; } }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.stats-row > div { display: grid; gap: 4px; }
.stats-row b { font: 600 22px/1 var(--body); font-variant-numeric: tabular-nums; }
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
.sheet-head h2 { font: 600 18px/1.2 var(--body); text-transform: none; letter-spacing: 0; }
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
.box { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; transition: background .15s, border-color .15s; }
.box svg { width: 16px; height: 16px; opacity: 0; }
.task[aria-pressed="true"] .box { background: var(--check); border-color: var(--check); box-shadow: var(--check-glow); }
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
.notes { padding: 18px 20px 20px; display: grid; gap: 12px; }
.notes-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.notes h2 { font: 600 15px/1.2 var(--body); letter-spacing: 0; margin-top: 4px; }
.notes textarea { min-height: 120px; resize: vertical; line-height: 1.5; }
.notes-actions { align-items: center; }
.note-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; padding: 12px 14px; background: var(--ground); border: 1px solid var(--line); border-radius: 10px; }

.empty { color: var(--muted); margin: 0; font-size: 15px; }
.edit-row { display: flex; gap: 8px; flex-wrap: wrap; }
.edit-row .text { flex: 1 1 200px; }

.grid-card { padding: 18px 20px 20px; display: grid; gap: 14px; }
.grid-card h2 { font: 600 15px/1.2 var(--body); text-transform: none; letter-spacing: 0; margin-top: 4px; }
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
.setup h2 { font: 600 15px/1.2 var(--body); text-transform: none; letter-spacing: 0; margin-top: 4px; }
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
.head-status { font: 400 15px/1.2 var(--body); color: var(--muted); font-variant-numeric: tabular-nums; }
.tab-empty { padding: 16px 20px 20px; border-top: 1px solid var(--line); }
.section-input { font: 600 15px/1.2 var(--body) !important; background: transparent !important; }
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
.auth h2 { font: 600 18px/1.2 var(--body); text-transform: none; letter-spacing: 0; }
.auth-form { width: 100%; display: grid; gap: 10px; }
.or { width: 100%; display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; }
.or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }

.kind { flex: none; display: inline-block; white-space: nowrap; font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; padding: 5px 7px; border-radius: 5px; border: 1px solid transparent; }
.kind-task { color: var(--accent); background: var(--accent-soft); }
.kind-schedule { color: var(--partial); border-color: var(--partial); }

.due { padding: 16px 20px 18px; display: grid; gap: 10px; border: 2px solid var(--accent); background: var(--accent-soft); }
.due-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.due h2 { font: 600 15px/1.2 var(--body); text-transform: none; letter-spacing: 0; }
.plus-btn { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 20px; line-height: 1; }
.plus-btn:hover { border-color: var(--muted); }
.due-add .text { flex: 1 1 200px; }
.due-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.due-item { display: flex; align-items: center; gap: 8px; background: var(--surface); border-radius: 10px; padding-right: 10px; }
.due-item .task { flex: 1; min-width: 0; padding: 10px 12px; border: 0; }
.due-item .task:hover { background: none; }
.overdue { flex: none; font: 500 12px var(--mono); color: var(--miss); white-space: nowrap; }

.horizon { padding: 18px 20px 20px; display: grid; gap: 14px; }
.horizon h2 { font: 600 15px/1.2 var(--body); text-transform: none; letter-spacing: 0; }
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
.deals-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.deals-head h2 { font: 600 15px/1.2 var(--body); text-transform: none; letter-spacing: 0; margin-top: 4px; }
.deals-total { display: flex; align-items: center; gap: 12px; }
.deals-total b { font: 600 22px/1 var(--body); font-variant-numeric: tabular-nums; }
.deal-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.deal { border: 1px solid var(--line); border-radius: 12px; background: var(--ground); overflow: hidden; }
.deal.open { border-color: var(--accent); }
.deal-row { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px; background: none; border: 0; text-align: left; }
.deal-main { display: grid; gap: 2px; min-width: 0; flex: 1 1 180px; }
.deal-brand { font-weight: 600; font-size: 16px; overflow-wrap: anywhere; }
.deal-what { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.deal-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
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
.deal-add { display: grid; gap: 8px; }
.deal-add .row .text:not(.deal-due-input) { flex: 1 1 160px; width: auto; }
.deal-add .row { flex-wrap: wrap; }
.deal-due-input { flex: 1 1 160px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
