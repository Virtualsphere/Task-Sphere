import { useEffect, useMemo, useRef, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { config } from '../config';
import Modal from './Modal';
import Avatar from './Avatar';
import { findFreeSlots } from '../slots';

// "Connect Google Calendar" — authorization-code popup; the server stores an encrypted refresh token
export function ConnectCalendarButton({ onConnected, label = 'Connect Google Calendar' }) {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: config.calendarScopes,
    hint: user?.email,
    hd: config.allowedDomain || undefined,
    onSuccess: async ({ code }) => {
      setBusy(true);
      try { onConnected(await api('/calendar/connect', { method: 'POST', body: { code } })); }
      catch (e) { setError(e.message); }
      setBusy(false);
    },
    onError: () => setError('Google did not grant calendar access'),
  });
  return (
    <div className="connect-cal">
      <button className="btn primary" onClick={() => { setError(''); login(); }} disabled={busy}>
        <GoogleG /> {busy ? 'Connecting…' : label}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export const GoogleG = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true" style={{ verticalAlign: '-2px', background: '#fff', borderRadius: 3 }}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35.3 44 30 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const DURATIONS = [15, 30, 45, 60, 90, 120];
// "Aarav is" / "Aarav and you are" / "Aarav, Riya and you are"
function busySentence(names) {
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = names.length === 1 && names[0] !== 'you' ? 'is' : 'are';
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${verb}`;
}
const slotLabel = (d) => d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// First half-hour slot inside office hours (today if possible, otherwise next working day)
function firstSlot() {
  const { start, end, days } = config.workHours;
  const d = new Date(Date.now() + 15 * 60000);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60, 0, 0);
  for (let i = 0; i < 8; i++) {
    const m = d.getHours() * 60 + d.getMinutes();
    if (days.includes(d.getDay()) && m >= toMin(start) && m + 30 <= toMin(end)) return d;
    if (!days.includes(d.getDay()) || m + 30 > toMin(end)) { d.setDate(d.getDate() + 1); }
    d.setHours(0, toMin(start), 0, 0);
  }
  return d;
}

// Schedule a meeting: checks everyone's calendar is clear, then books the Google Calendar event + Google Meet
export default function ScheduleMeetingModal({ people, preselected = [], spaceId, conversationId, contextLabel, onClose, onCreated }) {
  const { user } = useAuth();
  const slot = useMemo(firstSlot, []);
  const [status, setStatus] = useState(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(localDate(slot));
  const [time, setTime] = useState(hhmm(slot));
  const [duration, setDuration] = useState(30);
  const [selected, setSelected] = useState(() => new Set(preselected.filter((id) => id !== user.id)));
  const [emails, setEmails] = useState('');
  const [description, setDescription] = useState('');
  const [addMeet, setAddMeet] = useState(true);
  const [busy, setBusy] = useState(null);           // free/busy for the chosen day
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [finding, setFinding] = useState(false);
  const [conflicts, setConflicts] = useState(null);  // returned by the server when the calendar is not clear
  const [booked, setBooked] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const reqId = useRef(0);

  useEffect(() => { api('/calendar/status').then(setStatus).catch(() => setStatus({ connected: false })); }, []);

  const others = people.filter((p) => p.id !== user.id);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const extraEmails = emails.split(/[,\s;]+/).map((e) => e.trim()).filter(Boolean);
  const start = new Date(`${date}T${time}`);
  const end = new Date(start.getTime() + duration * 60000);
  const DAY_START = Math.max(0, Math.floor(toMin(config.workHours.start) / 60) - 1);
  const DAY_END = Math.min(24, Math.ceil(toMin(config.workHours.end) / 60) + 1);
  const attendeeKey = [...selected].sort().join(',') + '|' + extraEmails.join(',');

  // Check everyone's calendar for the chosen day automatically
  useEffect(() => {
    if (!status?.connected || !date) return undefined;
    setConflicts(null);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const from = new Date(`${date}T${pad(DAY_START)}:00`);
        const to = new Date(`${date}T${pad(DAY_END)}:00`);
        const res = await api('/calendar/freebusy', { method: 'POST', body: { user_ids: [...selected], emails: extraEmails, timeMin: from.toISOString(), timeMax: to.toISOString() } });
        if (id === reqId.current) setBusy(res);
      } catch (e) { if (id === reqId.current) setError(e.message); }
      if (id === reqId.current) setChecking(false);
    }, 450);
    return () => clearTimeout(t);
  }, [status?.connected, date, attendeeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSuggestions(null); }, [attendeeKey, duration]);

  const clashing = busy?.filter((p) => p.busy.some((b) => new Date(b.start) < end && new Date(b.end) > start)) || [];
  const outsideHours = (() => {
    const m = start.getHours() * 60 + start.getMinutes();
    return !config.workHours.days.includes(start.getDay()) || m < toMin(config.workHours.start) || m + duration > toMin(config.workHours.end);
  })();

  const findClearTime = async () => {
    setFinding(true); setError('');
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 8 * 86400000);
      const res = await api('/calendar/freebusy', { method: 'POST', body: { user_ids: [...selected], emails: extraEmails, timeMin: from.toISOString(), timeMax: to.toISOString() } });
      const all = res.flatMap((p) => p.busy);
      setSuggestions(findFreeSlots({
        busy: all, from, days: 8, duration,
        workStart: config.workHours.start, workEnd: config.workHours.end, workDays: config.workHours.days,
      }));
    } catch (e) { setError(e.message); }
    setFinding(false);
  };
  const pickSlot = (s) => { setDate(localDate(s.start)); setTime(hhmm(s.start)); setSuggestions(null); };

  const book = async (force = false) => {
    setSaving(true); setError('');
    try {
      const meeting = await api('/meetings', {
        method: 'POST',
        body: {
          title, description, start: start.toISOString(), end: end.toISOString(),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          user_ids: [...selected], emails: extraEmails, add_meet: addMeet, force,
          space_id: spaceId || undefined, conversation_id: conversationId || undefined,
        },
      });
      setBooked(meeting);
      setConflicts(null);
    } catch (err) {
      if (err.data?.conflicts) setConflicts(err.data.conflicts);
      else setError(err.message);
    }
    setSaving(false);
  };

  const pct = (d) => {
    const h = d.getHours() + d.getMinutes() / 60;
    return `${Math.min(100, Math.max(0, ((h - DAY_START) / (DAY_END - DAY_START)) * 100))}%`;
  };

  // ---------- booked ----------
  if (booked) {
    const copy = async () => { try { await navigator.clipboard.writeText(booked.meet_link); setCopied(true); } catch { /* ignore */ } };
    return (
      <Modal title="Meeting booked" onClose={() => onCreated?.(booked)}>
        <div className="booked">
          <div className="booked-tick">✓</div>
          <h3>{booked.title}</h3>
          <p className="muted">{fmtLong(booked.start_at, booked.end_at)}</p>
          {config.calendarSimulated && <p className="small warn-text">Local test mode – calendar booking and Meet link are simulated.</p>}
          <ul className="booked-list">
            <li>📅 Added to your Google Calendar ({status?.email})</li>
            <li>✉️ Invites emailed to {booked.attendees.length - 1} {booked.attendees.length - 1 === 1 ? 'person' : 'people'} – it appears on their calendars</li>
            {booked.meet_link ? <li>🎥 Google Meet booked</li> : <li className="muted">No video link added</li>}
          </ul>
          {booked.meet_link && (
            <div className="meet-box">
              <span className="clamp1">{booked.meet_link}</span>
              <button className="btn small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
              <a className="btn primary small" href={booked.meet_link} target="_blank" rel="noreferrer">Open Meet</a>
            </div>
          )}
          <div className="form-actions">
            {booked.html_link && <a className="btn" href={booked.html_link} target="_blank" rel="noreferrer">View in Google Calendar</a>}
            <button className="btn primary" onClick={() => onCreated?.(booked)}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Schedule a meeting${contextLabel ? ` · ${contextLabel}` : ''}`} onClose={onClose} wide>
      {status === null ? <p className="muted">Loading…</p> : !status.connected ? (
        <div className="empty slim">
          <h3>Connect your Google Calendar</h3>
          <p className="muted">Meetings are booked in your Google Workspace calendar with a Google Meet link, and invitations are emailed to attendees.</p>
          <ConnectCalendarButton onConnected={setStatus} />
        </div>
      ) : (
        <form className="form" onSubmit={(e) => { e.preventDefault(); book(false); }}>
          <label>Title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning" required /></label>

          <div className="field-label">Attendees</div>
          <div className="people-pick">
            {others.length === 0 && <span className="muted small">No teammates yet.</span>}
            {others.map((p) => (
              <label key={p.id} className={`person-chip ${selected.has(p.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <Avatar user={p} size={22} /> {p.name}
              </label>
            ))}
          </div>
          <label>Other guests (emails)<input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="client@company.com, partner@firm.in" /></label>

          <div className="grid3">
            <label>Date<input type="date" value={date} min={localDate(new Date())} onChange={(e) => setDate(e.target.value)} required /></label>
            <label>Start time<input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required /></label>
            <label>Duration
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? 's' : ''}`}</option>)}
              </select>
            </label>
          </div>

          <div className="clear-row">
            <div className="grow">
              {checking ? <span className="small muted">Checking calendars…</span>
                : busy && (clashing.length
                  ? <span className="small warn-text">⚠ Calendar not clear: {busySentence(clashing.map((c) => (c.id === user.id ? 'you' : c.name.split(' ')[0])))} busy at this time</span>
                  : <span className="small ok-text">✓ Everyone's calendar is clear at this time</span>)}
              {outsideHours && <div className="small warn-text">Outside office hours ({config.workHours.start}–{config.workHours.end})</div>}
            </div>
            <button type="button" className="btn small" onClick={findClearTime} disabled={finding}>{finding ? 'Searching…' : '✨ Find a clear time'}</button>
          </div>
          {suggestions && (
            <div className="suggestions">
              {suggestions.length === 0 ? <span className="muted small">No time in the next week where everyone is free. Try a shorter meeting or fewer people.</span>
                : <><span className="small muted">Everyone is free at:</span>{suggestions.map((s) => (
                  <button type="button" key={s.start.toISOString()} className="slot-chip" onClick={() => pickSlot(s)}>{slotLabel(s.start)}</button>
                ))}</>}
            </div>
          )}
          {busy && (
            <div className="fb-grid">
              <div className="fb-hours">{Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => <span key={i}>{(DAY_START + i) % 12 || 12}{DAY_START + i < 12 ? 'a' : 'p'}</span>)}</div>
              {busy.map((p) => (
                <div className="fb-row" key={p.email}>
                  <span className="fb-name clamp1">{p.id === user.id ? 'You' : p.name}</span>
                  <div className="fb-track">
                    <span className="fb-off" style={{ left: 0, width: pct(new Date(`${date}T${config.workHours.start}`)) }} />
                    <span className="fb-off" style={{ left: pct(new Date(`${date}T${config.workHours.end}`)), right: 0 }} />
                    {p.unavailable && <span className="fb-na">calendar not shared</span>}
                    {p.busy.map((b, i) => {
                      const s2 = new Date(b.start); const e2 = new Date(b.end);
                      return <span key={i} className="fb-busy" style={{ left: pct(s2), width: `calc(${pct(e2)} - ${pct(s2)})` }} />;
                    })}
                    <span className={`fb-slot ${clashing.some((c) => c.email === p.email) ? 'clash' : ''}`} style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda, links…" /></label>
          <label className="check"><input type="checkbox" checked={addMeet} onChange={(e) => setAddMeet(e.target.checked)} /> Book a Google Meet video link</label>

          {conflicts && (
            <div className="conflict-box">
              <strong>Calendar not clear</strong>
              <div className="small">{busySentence(conflicts.map((c) => (c.self ? 'you' : c.name)))} busy at {slotLabel(start)}.</div>
              <div className="row gap wrap">
                <button type="button" className="btn small primary" onClick={findClearTime}>✨ Find a clear time</button>
                <button type="button" className="btn small" onClick={() => book(true)} disabled={saving}>Book anyway</button>
              </div>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="form-actions spread">
            <span className="muted small">Booking on: {status.email}</span>
            <div className="row gap">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={saving || !title.trim()}>{saving ? 'Booking…' : addMeet ? 'Book calendar & Meet' : 'Book calendar'}</button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function fmtLong(s, e) {
  const a = new Date(s); const b = new Date(e);
  return `${a.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · ${a.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} – ${b.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}
