// Google Workspace calendar: upcoming events + meetings scheduled from TaskSphere
import { useEffect, useState } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';
import ScheduleMeetingModal, { ConnectCalendarButton, GoogleG, meetingToEdit, eventToEdit } from '../components/ScheduleMeetingModal';
import { fmtRange } from '../components/ChatCards';

const dayKey = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function CalendarPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [people, setPeople] = useState([]);
  const [days, setDays] = useState(7);
  const [error, setError] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [editing, setEditing] = useState(null);   // what the edit form is open for

  const loadEvents = (d = days) => api(`/calendar/events?days=${d}`).then(setEvents).catch((e) => { setError(e.message); setEvents([]); });
  const loadMeetings = () => api('/meetings').then(setMeetings).catch(() => {});

  useEffect(() => {
    api('/calendar/status').then((s) => { setStatus(s); if (s.connected) loadEvents(); }).catch(() => setStatus({ connected: false }));
    loadMeetings();
    api('/people').then(setPeople).catch(() => {});
    const s = getSocket();
    const refresh = () => { loadMeetings(); };
    s.on('meeting:new', refresh);
    s.on('meeting:cancelled', refresh);
    s.on('meeting:updated', refresh);
    return () => { s.off('meeting:new', refresh); s.off('meeting:cancelled', refresh); s.off('meeting:updated', refresh); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = async () => {
    if (!confirm('Disconnect your Google Calendar?')) return;
    setStatus(await api('/calendar', { method: 'DELETE' }));
    setEvents(null);
  };
  const cancelMeeting = async (m) => {
    if (!confirm(`Cancel "${m.title}"? Attendees will get a cancellation email.`)) return;
    try { await api(`/meetings/${m.id}`, { method: 'DELETE' }); loadMeetings(); if (status?.connected) loadEvents(); }
    catch (e) { setError(e.message); }
  };

  const editMeeting = (m) => { setError(''); setEditing(meetingToEdit(m)); };
  const editEvent = (e) => {
    setError('');
    if (e.meeting_id) {
      const m = meetings.find((x) => x.id === e.meeting_id);
      return m ? setEditing(meetingToEdit(m)) : setError('This meeting is not in your TaskSphere list any more – refresh the page.');
    }
    return setEditing(eventToEdit(e, people));
  };

  const grouped = {};
  for (const e of events || []) (grouped[dayKey(e.start)] ||= []).push(e);
  const now = Date.now();

  return (
    <div className="app-shell">
      <TopBar />
      <main className="dashboard calendar-page">
        <div className="page-head">
          <div>
            <h2>Calendar & meetings</h2>
            <p className="muted">Your Google Workspace calendar. Schedule meetings with Google Meet links and invite teammates.</p>
          </div>
          <div className="row gap">
            {status?.connected && <button className="btn primary" onClick={() => setShowSchedule(true)}>+ Schedule meeting</button>}
          </div>
        </div>
        {error && <p className="error">{error}</p>}

        {status === null ? <p className="muted">Loading…</p> : !status.connected ? (
          <div className="empty">
            <h3><GoogleG /> Connect Google Calendar</h3>
            <p className="muted">See your upcoming events here, check teammates' availability and schedule meetings with Google Meet links. Invites go out from your own calendar.</p>
            <ConnectCalendarButton onConnected={(s) => { setStatus(s); loadEvents(); }} />
          </div>
        ) : (
          <div className="cal-grid">
            <section className="cal-events">
              <div className="row spread-row">
                <h3>Upcoming events</h3>
                <select value={days} onChange={(e) => { setDays(Number(e.target.value)); loadEvents(Number(e.target.value)); }}>
                  <option value={1}>Today</option><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option><option value={30}>Next 30 days</option>
                </select>
              </div>
              {events === null && <p className="muted">Loading events…</p>}
              {events?.length === 0 && <p className="muted">Nothing scheduled. Enjoy the focus time ✨</p>}
              {Object.entries(grouped).map(([d, list]) => (
                <div key={d} className="cal-day">
                  <div className="cal-day-head">{d}</div>
                  {list.map((e) => {
                    const live = !e.all_day && new Date(e.start) <= now && new Date(e.end) > now;
                    return (
                      <div key={e.id} className={`cal-event ${live ? 'live' : ''}`}>
                        <div className="cal-time">{e.all_day ? 'All day' : <>{time(e.start)}<br /><span className="muted small">{time(e.end)}</span></>}</div>
                        <div className="grow">
                          <strong>{e.title}</strong> {e.meeting_id && <span className="tag">TaskSphere</span>} {live && <span className="tag live">Now</span>}
                          <div className="muted small">
                            {e.attendee_count > 0 && `${e.attendee_count} guests`}
                            {e.my_response && e.my_response !== 'accepted' && !e.organizer_self && ` · ${e.my_response === 'needsAction' ? 'Not responded' : e.my_response}`}
                            {e.location && ` · ${e.location}`}
                          </div>
                        </div>
                        {e.meet_link && <a className="btn primary small" href={e.meet_link} target="_blank" rel="noreferrer">Join Meet</a>}
                        {e.editable && <button className="btn small" onClick={() => editEvent(e)}>✎ Edit</button>}
                        {e.html_link && <a className="icon-btn" href={e.html_link} target="_blank" rel="noreferrer" title="Open in Google Calendar">↗</a>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
            <aside className="cal-side">
              <div className="card-box">
                <div className="row gap"><GoogleG /> <strong className="grow clamp1">{status.email}</strong></div>
                <button className="btn small ghost" onClick={disconnect}>Disconnect</button>
              </div>
              <MeetingList meetings={meetings} meId={user.id} onCancel={cancelMeeting} onEdit={editMeeting} />
            </aside>
          </div>
        )}
        {!status?.connected && meetings.length > 0 && <div className="cal-side standalone"><MeetingList meetings={meetings} meId={user.id} onCancel={cancelMeeting} onEdit={editMeeting} /></div>}
      </main>
      {showSchedule && (
        <ScheduleMeetingModal people={people} onClose={() => setShowSchedule(false)}
          onCreated={() => { setShowSchedule(false); loadMeetings(); loadEvents(); }} />
      )}
      {editing && (
        <ScheduleMeetingModal key={editing.path} people={people} editing={editing} onClose={() => setEditing(null)}
          onCreated={() => { setEditing(null); loadMeetings(); if (status?.connected) loadEvents(); }} />
      )}
    </div>
  );
}

export function MeetingList({ meetings, meId, onCancel, onEdit, compact }) {
  return (
    <div className={compact ? '' : 'card-box'}>
      {!compact && <h4>Meetings from TaskSphere</h4>}
      {meetings.length === 0 && <p className="muted small">No upcoming meetings.</p>}
      {meetings.map((m) => (
        <div key={m.id} className="meeting-row">
          <div className="grow">
            <strong className="clamp1">{m.title}</strong>
            <div className="muted small">{fmtRange(m.start_at, m.end_at)}</div>
            {!compact && (
              <div className="avatars small-gap">{m.attendees.slice(0, 6).map((a) => <Avatar key={a.email} user={{ name: a.name, avatar_url: a.avatar_url }} size={20} />)}
                {m.attendees.length > 6 && <span className="muted small"> +{m.attendees.length - 6}</span>}</div>
            )}
          </div>
          <div className="meeting-actions">
            {m.meet_link && <a className="btn primary small" href={m.meet_link} target="_blank" rel="noreferrer">Join</a>}
            {onEdit && m.organizer_id === meId && <button className="icon-btn" title="Edit meeting" onClick={() => onEdit(m)}>✎</button>}
            {onCancel && m.organizer_id === meId && <button className="icon-btn danger" title="Cancel meeting" onClick={() => onCancel(m)}>✕</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
