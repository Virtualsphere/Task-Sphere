// Special chat messages: meeting invitations and huddle start/end events
import { useHuddle } from '../huddle/HuddleContext';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// A meeting was edited: update its card(s) in a loaded message list
export function applyMeetingUpdate(messages, { meeting, card }) {
  return messages.map((m) => (m.kind === 'meeting' && parse(m.body)?.meeting_id === meeting.id ? { ...m, body: card } : m));
}

export function fmtRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const t = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t(s)} – ${t(e)}`;
}

export function MeetingCard({ body }) {
  const m = parse(body);
  if (!m) return null;
  return (
    <div className="meeting-card">
      <div className="meeting-card-title">📅 {m.title}</div>
      <div className="small">{fmtRange(m.start, m.end)}</div>
      <div className="small muted">Organised by {m.organizer} · invites sent via Google Calendar</div>
      <div className="row gap wrap">
        {m.meet_link && <a className="btn primary small" href={m.meet_link} target="_blank" rel="noreferrer">Join Google Meet</a>}
        {m.html_link && <a className="btn small" href={m.html_link} target="_blank" rel="noreferrer">Open in Calendar</a>}
      </div>
    </div>
  );
}

export function HuddleEvent({ body, name, scope, scopeId, title }) {
  const h = useHuddle();
  const ev = parse(body);
  if (!ev) return null;
  const key = `${scope}:${Number(scopeId)}`;
  const live = h?.states[key] && h.active?.key !== key;
  if (ev.event === 'started') {
    return (
      <div className="system-line">
        🎧 <strong>{name}</strong> started a huddle
        {live && <button className="link-btn" onClick={() => h.join(scope, scopeId, title)}>Join</button>}
      </div>
    );
  }
  return <div className="system-line">🎧 Huddle ended · {ev.minutes} min{ev.peak > 1 ? ` · ${ev.peak} people` : ''}</div>;
}
