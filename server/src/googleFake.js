// LOCAL TEST MODE (CALENDAR_MODE=fake): a stand-in for Google Calendar so scheduling can be tested
// without a Google Cloud project. Busy times come from meetings booked in this app, plus a daily
// 10:00–10:15 stand-up (Mon–Sat) so the "calendar not clear" check has something to find.
// Meet links are placeholders and do not open a real meeting.
const crypto = require('crypto');
const db = require('./db');

const toSql = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const fromSql = (s) => `${String(s).replace(' ', 'T')}Z`;
const meetCode = () => {
  const r = (n) => Array.from({ length: n }, () => 'abcdefghijkmnopqrstuvwxyz'[crypto.randomInt(25)]).join('');
  return `${r(3)}-${r(4)}-${r(3)}`;
};

function standups(from, to) {
  if (process.env.FAKE_STANDUP === 'false') return [];
  const out = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    const s = new Date(d); s.setHours(10, 0, 0, 0);
    const e = new Date(d); e.setHours(10, 15, 0, 0);
    if (e > from && s < to) out.push({ start: s.toISOString(), end: e.toISOString() });
  }
  return out;
}

async function status(userId) {
  const [[u]] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
  return { connected: true, email: u?.email || '', simulated: true };
}

async function request(userId, { method = 'GET', path, params = {}, data = {} }) {
  if (path === '/freeBusy') {
    const from = new Date(data.timeMin);
    const to = new Date(data.timeMax);
    const calendars = {};
    for (const { id } of data.items || []) {
      const [rows] = await db.query(
        `SELECT m.start_at, m.end_at FROM meetings m JOIN meeting_attendees a ON a.meeting_id = m.id
          WHERE a.email = ? AND m.end_at > ? AND m.start_at < ?`, [String(id).toLowerCase(), toSql(from), toSql(to)]);
      calendars[id] = { busy: [...standups(from, to), ...rows.map((r) => ({ start: fromSql(r.start_at), end: fromSql(r.end_at) }))] };
    }
    return { calendars };
  }

  if (path === '/calendars/primary/events' && method === 'POST') {
    const withMeet = Number(params.conferenceDataVersion) === 1 && data.conferenceData;
    return { id: `local-${crypto.randomUUID()}`, htmlLink: null, ...(withMeet ? { hangoutLink: `https://meet.google.com/${meetCode()}` } : {}) };
  }

  if (path === '/calendars/primary/events' && method === 'GET') {
    const [[u]] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
    const from = new Date(params.timeMin || Date.now());
    const to = new Date(params.timeMax || Date.now() + 14 * 86400000);
    const [rows] = await db.query(
      `SELECT DISTINCT m.* FROM meetings m LEFT JOIN meeting_attendees a ON a.meeting_id = m.id
        WHERE (m.organizer_id = ? OR a.email = ?) AND m.end_at > ? AND m.start_at < ? ORDER BY m.start_at`,
      [userId, u.email, toSql(from), toSql(to)]);
    const items = [];
    for (const s of standups(from, to)) {
      items.push({ id: `standup-${s.start}`, summary: 'Daily stand-up (sample)', start: { dateTime: s.start }, end: { dateTime: s.end }, organizer: {}, htmlLink: null });
    }
    for (const m of rows) {
      const [att] = await db.query('SELECT email FROM meeting_attendees WHERE meeting_id = ?', [m.id]);
      items.push({
        id: m.google_event_id, summary: m.title, start: { dateTime: fromSql(m.start_at) }, end: { dateTime: fromSql(m.end_at) },
        hangoutLink: m.meet_link, htmlLink: null, organizer: { self: m.organizer_id === userId },
        attendees: att.map((a) => ({ email: a.email, self: a.email === u.email, responseStatus: m.organizer_id === userId ? 'accepted' : 'needsAction' })),
      });
    }
    items.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
    return { items };
  }

  if (method === 'GET' && path.startsWith('/calendars/primary/events/')) {
    return { id: decodeURIComponent(path.split('/').pop()) };
  }
  if (method === 'DELETE') return {};
  return {};
}

module.exports = {
  status,
  connect: async (user) => status(user.id),
  disconnect: async () => {},
  request,
  // Sign-in in test mode never touches Google
  exchangeCode: async () => { throw Object.assign(new Error('Google sign-in is disabled in local test mode – use the test users'), { status: 400 }); },
  saveTokens: async (userId) => status(userId),
};
