// Google Calendar: connect, upcoming events, free/busy, and meetings scheduled from the app
const crypto = require('crypto');
const router = require('express').Router();
const db = require('../db');
const google = require('../google'); // used as google.request(...) so tests can stub it
const { ah, HttpError, getRole, ROLE_RANK } = require('../access');
const svc = require('../chatService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meetLinkOf = (ev) => ev?.hangoutLink || ev?.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
const toSql = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const fromSql = (s) => (s ? `${String(s).replace(' ', 'T')}Z` : null);

// ---------- connection ----------
router.get('/calendar/status', ah(async (req, res) => res.json(await google.status(req.user.id))));

router.post('/calendar/connect', ah(async (req, res) => {
  if (!req.body.code) throw new HttpError(400, 'Missing authorization code');
  const [[u]] = await db.query('SELECT id, email FROM users WHERE id = ?', [req.user.id]);
  res.json(await google.connect(u, req.body.code));
}));

router.delete('/calendar', ah(async (req, res) => {
  await google.disconnect(req.user.id);
  res.json({ connected: false });
}));

// ---------- my upcoming Google Calendar events ----------
router.get('/calendar/events', ah(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
  const from = req.query.from ? new Date(req.query.from) : new Date();
  const to = new Date(from.getTime() + days * 86400000);
  const data = await google.request(req.user.id, {
    path: '/calendars/primary/events',
    params: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 250 },
  });
  const [ours] = await db.query('SELECT id, google_event_id FROM meetings WHERE google_event_id IS NOT NULL AND organizer_id = ?', [req.user.id]);
  const ourIds = Object.fromEntries(ours.map((m) => [m.google_event_id, m.id]));
  res.json((data.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
    id: e.id,
    title: e.summary || '(No title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    all_day: !e.start?.dateTime,
    meet_link: e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null,
    html_link: e.htmlLink,
    location: e.location || null,
    attendee_count: (e.attendees || []).length,
    my_response: (e.attendees || []).find((a) => a.self)?.responseStatus || null,
    organizer_self: !!e.organizer?.self,
    meeting_id: ourIds[e.id] || null,
  })));
}));

// ---------- free/busy for teammates ----------
router.post('/calendar/freebusy', ah(async (req, res) => {
  const { timeMin, timeMax } = req.body;
  if (!timeMin || !timeMax || new Date(timeMax) <= new Date(timeMin)) throw new HttpError(400, 'Invalid time range');
  const ids = await svc.assertTeammates(req.user.id, req.body.user_ids);
  const [people] = await db.query('SELECT id, name, email FROM users WHERE id IN (?)', [[req.user.id, ...ids]]);
  const extra = (req.body.emails || []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));
  const targets = [...people.map((p) => ({ id: p.id, name: p.name, email: p.email })), ...extra.map((e) => ({ id: null, name: e, email: e }))];
  const data = await google.request(req.user.id, {
    method: 'POST', path: '/freeBusy',
    data: { timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(), items: targets.map((t) => ({ id: t.email })) },
  });
  const cals = Object.fromEntries(Object.entries(data.calendars || {}).map(([k, v]) => [k.toLowerCase(), v]));
  res.json(targets.map((t) => {
    const cal = cals[t.email.toLowerCase()] || {};
    return { ...t, busy: cal.busy || [], unavailable: !!(cal.errors && cal.errors.length) };
  }));
}));

// ---------- meetings scheduled from the app ----------
async function meetingsOut(rows) {
  if (!rows.length) return [];
  const [att] = await db.query(
    `SELECT a.meeting_id, a.email, a.user_id, u.name, u.avatar_url FROM meeting_attendees a
       LEFT JOIN users u ON u.id = a.user_id WHERE a.meeting_id IN (?)`, [rows.map((r) => r.id)]);
  const by = {};
  for (const a of att) (by[a.meeting_id] ||= []).push({ email: a.email, user_id: a.user_id, name: a.name || a.email, avatar_url: a.avatar_url });
  return rows.map((m) => ({ ...m, start_at: fromSql(m.start_at), end_at: fromSql(m.end_at), attendees: by[m.id] || [] }));
}

const MEETING_SELECT = `SELECT m.*, u.name AS organizer_name FROM meetings m JOIN users u ON u.id = m.organizer_id`;

// GET /api/meetings?space_id=|conversation_id=  (default: meetings I'm invited to / organising)
router.get('/meetings', ah(async (req, res) => {
  const upcoming = req.query.all ? '' : 'AND m.end_at > UTC_TIMESTAMP()';
  let rows;
  if (req.query.space_id) {
    if (!(await getRole(Number(req.query.space_id), req.user.id))) throw new HttpError(404, 'Space not found');
    [rows] = await db.query(`${MEETING_SELECT} WHERE m.space_id = ? ${upcoming} ORDER BY m.start_at LIMIT 50`, [req.query.space_id]);
  } else if (req.query.conversation_id) {
    await svc.assertConvMember(req.query.conversation_id, req.user.id);
    [rows] = await db.query(`${MEETING_SELECT} WHERE m.conversation_id = ? ${upcoming} ORDER BY m.start_at LIMIT 50`, [req.query.conversation_id]);
  } else {
    [rows] = await db.query(
      `${MEETING_SELECT} WHERE (m.organizer_id = ? OR m.id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = ?)) ${upcoming}
        ORDER BY m.start_at LIMIT 100`, [req.user.id, req.user.id]);
  }
  res.json(await meetingsOut(rows));
}));

// POST /api/meetings — creates the Google Calendar event (with a Meet link), invites attendees,
// and posts a meeting card in the space chat or conversation it was scheduled from.
router.post('/meetings', ah(async (req, res) => {
  const b = req.body;
  const title = String(b.title || '').trim();
  const start = new Date(b.start);
  const end = new Date(b.end);
  if (!title) throw new HttpError(400, 'Meeting title is required');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new HttpError(400, 'Choose a valid start and end time');
  if (end - start > 12 * 3600000) throw new HttpError(400, 'Meetings can be at most 12 hours long');

  const spaceId = b.space_id ? Number(b.space_id) : null;
  const convId = b.conversation_id ? Number(b.conversation_id) : null;
  if (spaceId) {
    const role = await getRole(spaceId, req.user.id);
    if (!role) throw new HttpError(404, 'Space not found');
    if (ROLE_RANK[role] < ROLE_RANK.member) throw new HttpError(403, 'Viewers cannot schedule meetings');
  }
  if (convId) await svc.assertConvMember(convId, req.user.id);

  const userIds = await svc.assertTeammates(req.user.id, b.user_ids);
  const [people] = await db.query('SELECT id, name, email FROM users WHERE id IN (?)', [[req.user.id, ...userIds]]);
  const organizer = people.find((p) => p.id === req.user.id);
  const extraEmails = [...new Set((b.emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = extraEmails.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new HttpError(400, `Invalid email: ${bad}`);
  const attendees = [
    ...people.map((p) => ({ email: p.email.toLowerCase(), user_id: p.id })),
    ...extraEmails.filter((e) => !people.some((p) => p.email.toLowerCase() === e)).map((e) => ({ email: e, user_id: null })),
  ];
  const timeZone = b.time_zone || 'Asia/Kolkata';
  const addMeet = b.add_meet !== false;

  // 1) Is everyone's calendar clear? Unless the organizer chose "Book anyway", refuse double-booking.
  if (!b.force) {
    const fb = await google.request(req.user.id, {
      method: 'POST', path: '/freeBusy',
      data: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: attendees.map((a) => ({ id: a.email })) },
    });
    const cals = Object.fromEntries(Object.entries(fb.calendars || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const conflicts = attendees
      .filter((a) => (cals[a.email]?.busy || []).some((x) => new Date(x.start) < end && new Date(x.end) > start))
      .map((a) => ({ email: a.email, user_id: a.user_id, self: a.user_id === req.user.id, name: people.find((p) => p.email.toLowerCase() === a.email)?.name || a.email }));
    if (conflicts.length) {
      const names = conflicts.map((c) => (c.self ? 'you' : c.name.split(' ')[0])).join(', ');
      const err = new HttpError(409, `Calendar not clear at this time – busy: ${names}`);
      err.details = { conflicts };
      throw err;
    }
  }

  // 2) Book it: calendar event on the organizer's calendar, invites to everyone, Google Meet attached
  const event = await google.request(req.user.id, {
    method: 'POST',
    path: '/calendars/primary/events',
    params: { conferenceDataVersion: addMeet ? 1 : 0, sendUpdates: 'all' },
    data: {
      summary: title,
      description: [b.description, 'Scheduled from TaskSphere'].filter(Boolean).join('\n\n'),
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: attendees.filter((a) => a.email !== organizer.email.toLowerCase()).map((a) => ({ email: a.email })),
      ...(addMeet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      reminders: { useDefault: true },
    },
  });
  // Google sometimes creates the Meet room asynchronously ("pending"); wait briefly for the link
  let meetLink = meetLinkOf(event);
  for (let i = 0; addMeet && !meetLink && i < 3; i++) {
    await sleep(1000);
    const fresh = await google.request(req.user.id, { path: `/calendars/primary/events/${encodeURIComponent(event.id)}`, params: { conferenceDataVersion: 1 } }).catch(() => null);
    meetLink = meetLinkOf(fresh);
    if (fresh?.htmlLink) event.htmlLink = fresh.htmlLink;
  }

  const [r] = await db.query(
    `INSERT INTO meetings (google_event_id, space_id, conversation_id, title, description, start_at, end_at, time_zone, meet_link, html_link, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, spaceId, convId, title.slice(0, 255), b.description || null, toSql(start), toSql(end), timeZone, meetLink, event.htmlLink || null, req.user.id]);
  for (const a of attendees) {
    await db.query('INSERT IGNORE INTO meeting_attendees (meeting_id, email, user_id) VALUES (?, ?, ?)', [r.insertId, a.email, a.user_id]);
  }

  const card = JSON.stringify({ meeting_id: r.insertId, title, start: start.toISOString(), end: end.toISOString(), meet_link: meetLink, html_link: event.htmlLink, organizer: organizer.name });
  if (spaceId) await svc.postSpaceMessage(spaceId, req.user.id, card, 'meeting');
  if (convId) await svc.postDirectMessage(convId, req.user.id, card, 'meeting');

  const [[row]] = await db.query(`${MEETING_SELECT} WHERE m.id = ?`, [r.insertId]);
  const [meeting] = await meetingsOut([row]);
  svc.getIo()?.to(attendees.filter((a) => a.user_id).map((a) => svc.userRoom(a.user_id))).emit('meeting:new', meeting);
  res.status(201).json(meeting);
}));

// DELETE /api/meetings/:id — organizer cancels; Google emails the cancellation to attendees
router.delete('/meetings/:id', ah(async (req, res) => {
  const [[m]] = await db.query('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) throw new HttpError(404, 'Meeting not found');
  if (m.organizer_id !== req.user.id) throw new HttpError(403, 'Only the organizer can cancel this meeting');
  if (m.google_event_id) {
    await google.request(req.user.id, { method: 'DELETE', path: `/calendars/primary/events/${encodeURIComponent(m.google_event_id)}`, params: { sendUpdates: 'all' } })
      .catch((e) => { if (!e.google) throw e; }); // already deleted in Google is fine
  }
  const [att] = await db.query('SELECT user_id FROM meeting_attendees WHERE meeting_id = ? AND user_id IS NOT NULL', [m.id]);
  await db.query('DELETE FROM meetings WHERE id = ?', [m.id]);
  svc.getIo()?.to(att.map((a) => svc.userRoom(a.user_id))).emit('meeting:cancelled', { id: m.id, title: m.title });
  res.json({ ok: true });
}));

module.exports = router;
