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
    attendees: (e.attendees || []).filter((a) => a.email && !a.resource).map((a) => a.email.toLowerCase()),
    description: e.description || '',
    recurring: !!e.recurringEventId,
    editable: !!e.organizer?.self && !!e.start?.dateTime,
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

// Validate the meeting form (shared by create and edit).
// `keepUserIds`: people already invited to the meeting being edited – they stay allowed
// even if they no longer share a space with the organizer.
async function readMeetingInput(req, { keepUserIds = [] } = {}) {
  const b = req.body;
  const title = String(b.title || '').trim();
  const start = new Date(b.start);
  const end = new Date(b.end);
  if (!title) throw new HttpError(400, 'Meeting title is required');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new HttpError(400, 'Choose a valid start and end time');
  if (end - start > 12 * 3600000) throw new HttpError(400, 'Meetings can be at most 12 hours long');

  const requested = [...new Set((b.user_ids || []).map(Number).filter((x) => x && x !== req.user.id))];
  const kept = requested.filter((id) => keepUserIds.includes(id));
  const userIds = [...kept, ...(await svc.assertTeammates(req.user.id, requested.filter((id) => !kept.includes(id))))];
  const [people] = await db.query('SELECT id, name, email FROM users WHERE id IN (?)', [[req.user.id, ...userIds]]);
  const organizer = people.find((p) => p.id === req.user.id);
  const extraEmails = [...new Set((b.emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const bad = extraEmails.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new HttpError(400, `Invalid email: ${bad}`);
  // Guests typed as emails who are TaskSphere users are linked to their account
  const extraUsers = extraEmails.length
    ? (await db.query('SELECT id, name, email FROM users WHERE LOWER(email) IN (?)', [extraEmails]))[0] : [];
  const all = [...people, ...extraUsers.filter((u) => !people.some((p) => p.id === u.id))];
  const attendees = [
    ...all.map((p) => ({ email: p.email.toLowerCase(), user_id: p.id })),
    ...extraEmails.filter((e) => !all.some((p) => p.email.toLowerCase() === e)).map((e) => ({ email: e, user_id: null })),
  ];
  return {
    title, start, end, people: all, organizer, attendees,
    description: b.description ? String(b.description).slice(0, 8000) : '',
    timeZone: b.time_zone || 'Asia/Kolkata',
    addMeet: b.add_meet !== false,
  };
}

// Remove [s, e) from busy blocks: a meeting being moved must not clash with itself
function withoutRange(busy, s, e) {
  const out = [];
  for (const b of busy) {
    const bs = new Date(b.start); const be = new Date(b.end);
    if (be <= s || bs >= e) { out.push(b); continue; }
    if (bs < s) out.push({ start: b.start, end: s.toISOString() });
    if (be > e) out.push({ start: e.toISOString(), end: b.end });
  }
  return out;
}

// Is everyone's calendar clear? Throws 409 with the busy people unless it is.
// `ignore` = { start, end } of the meeting being edited (its current slot).
async function assertCalendarClear(userId, input, ignore = null) {
  const { start, end, attendees, people } = input;
  const fb = await google.request(userId, {
    method: 'POST', path: '/freeBusy',
    data: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: attendees.map((a) => ({ id: a.email })) },
  });
  const cals = Object.fromEntries(Object.entries(fb.calendars || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const conflicts = attendees
    .filter((a) => {
      let busy = cals[a.email]?.busy || [];
      if (ignore) busy = withoutRange(busy, new Date(ignore.start), new Date(ignore.end));
      return busy.some((x) => new Date(x.start) < end && new Date(x.end) > start);
    })
    .map((a) => ({ email: a.email, user_id: a.user_id, self: a.user_id === userId, name: people.find((p) => p.email.toLowerCase() === a.email)?.name || a.email }));
  if (conflicts.length) {
    const names = conflicts.map((c) => (c.self ? 'you' : c.name.split(' ')[0])).join(', ');
    const err = new HttpError(409, `Calendar not clear at this time – busy: ${names}`);
    err.details = { conflicts };
    throw err;
  }
}

// Google sometimes creates the Meet room asynchronously ("pending"); wait briefly for the link
async function waitForMeetLink(userId, event) {
  let link = meetLinkOf(event);
  for (let i = 0; !link && i < 3; i++) {
    await sleep(1000);
    const fresh = await google.request(userId, { path: `/calendars/primary/events/${encodeURIComponent(event.id)}`, params: { conferenceDataVersion: 1 } }).catch(() => null);
    link = meetLinkOf(fresh);
    if (fresh?.htmlLink) event.htmlLink = fresh.htmlLink;
  }
  return link;
}

// Update an event on the organizer's Google Calendar; Google emails the change to every guest.
// Guests who stay keep their yes/no/maybe answer.
async function patchGoogleEvent(userId, eventId, input, { description, current }) {
  const keep = Object.fromEntries((current.attendees || []).filter((a) => a.email).map((a) => [a.email.toLowerCase(), a]));
  const hadMeet = !!meetLinkOf(current);
  const data = {
    summary: input.title,
    description,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    attendees: input.attendees
      .filter((a) => a.email !== input.organizer.email.toLowerCase())
      .map((a) => keep[a.email] ? { email: keep[a.email].email, responseStatus: keep[a.email].responseStatus, optional: keep[a.email].optional } : { email: a.email }),
  };
  if (input.addMeet && !hadMeet) data.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  if (!input.addMeet && hadMeet) data.conferenceData = null;
  const event = await google.request(userId, {
    method: 'PATCH',
    path: `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    params: { sendUpdates: 'all', conferenceDataVersion: 1 },
    data,
  });
  const meetLink = !input.addMeet ? null : (data.conferenceData ? await waitForMeetLink(userId, event) : meetLinkOf(event) || meetLinkOf(current));
  return { event, meetLink };
}

async function getOwnGoogleEvent(userId, eventId) {
  return google.request(userId, { path: `/calendars/primary/events/${encodeURIComponent(eventId)}`, params: { conferenceDataVersion: 1 } })
    .catch((e) => { if (e.google) throw new HttpError(404, 'This event no longer exists in Google Calendar'); throw e; });
}

// POST /api/meetings — creates the Google Calendar event (with a Meet link), invites attendees,
// and posts a meeting card in the space chat or conversation it was scheduled from.
router.post('/meetings', ah(async (req, res) => {
  const b = req.body;
  const spaceId = b.space_id ? Number(b.space_id) : null;
  const convId = b.conversation_id ? Number(b.conversation_id) : null;
  if (spaceId) {
    const role = await getRole(spaceId, req.user.id);
    if (!role) throw new HttpError(404, 'Space not found');
    if (ROLE_RANK[role] < ROLE_RANK.member) throw new HttpError(403, 'Viewers cannot schedule meetings');
  }
  if (convId) await svc.assertConvMember(convId, req.user.id);

  const input = await readMeetingInput(req);
  const { title, start, end, organizer, attendees, timeZone, addMeet } = input;

  // 1) Is everyone's calendar clear? Unless the organizer chose "Book anyway", refuse double-booking.
  if (!b.force) await assertCalendarClear(req.user.id, input);

  // 2) Book it: calendar event on the organizer's calendar, invites to everyone, Google Meet attached
  const event = await google.request(req.user.id, {
    method: 'POST',
    path: '/calendars/primary/events',
    params: { conferenceDataVersion: addMeet ? 1 : 0, sendUpdates: 'all' },
    data: {
      summary: title,
      description: [input.description, 'Scheduled from TaskSphere'].filter(Boolean).join('\n\n'),
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: attendees.filter((a) => a.email !== organizer.email.toLowerCase()).map((a) => ({ email: a.email })),
      ...(addMeet ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
      reminders: { useDefault: true },
    },
  });
  const meetLink = addMeet ? await waitForMeetLink(req.user.id, event) : null;

  const [r] = await db.query(
    `INSERT INTO meetings (google_event_id, space_id, conversation_id, title, description, start_at, end_at, time_zone, meet_link, html_link, organizer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, spaceId, convId, title.slice(0, 255), input.description || null, toSql(start), toSql(end), timeZone, meetLink, event.htmlLink || null, req.user.id]);
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

// PATCH /api/meetings/:id — organizer edits a meeting booked from TaskSphere (same body as POST).
// Updates the Google Calendar event (Google emails the change), our copy, and the meeting cards in chat.
router.patch('/meetings/:id', ah(async (req, res) => {
  const [[m]] = await db.query('SELECT * FROM meetings WHERE id = ?', [req.params.id]);
  if (!m) throw new HttpError(404, 'Meeting not found');
  if (m.organizer_id !== req.user.id) throw new HttpError(403, 'Only the organizer can edit this meeting');
  const [oldAtt] = await db.query('SELECT email, user_id FROM meeting_attendees WHERE meeting_id = ?', [m.id]);

  const input = await readMeetingInput(req, { keepUserIds: oldAtt.map((a) => a.user_id).filter(Boolean) });
  if (!req.body.force) await assertCalendarClear(req.user.id, input, { start: fromSql(m.start_at), end: fromSql(m.end_at) });

  let meetLink = input.addMeet ? m.meet_link : null;
  let htmlLink = m.html_link;
  if (m.google_event_id) {
    const current = await getOwnGoogleEvent(req.user.id, m.google_event_id);
    const description = [input.description, 'Scheduled from TaskSphere'].filter(Boolean).join('\n\n');
    const r = await patchGoogleEvent(req.user.id, m.google_event_id, input, { description, current: { ...current, hangoutLink: meetLinkOf(current) || m.meet_link } });
    meetLink = r.meetLink;
    htmlLink = r.event.htmlLink || htmlLink;
  }

  await db.query(
    'UPDATE meetings SET title = ?, description = ?, start_at = ?, end_at = ?, time_zone = ?, meet_link = ?, html_link = ? WHERE id = ?',
    [input.title.slice(0, 255), input.description || null, toSql(input.start), toSql(input.end), input.timeZone, meetLink, htmlLink, m.id]);
  await db.query('DELETE FROM meeting_attendees WHERE meeting_id = ?', [m.id]);
  for (const a of input.attendees) {
    await db.query('INSERT IGNORE INTO meeting_attendees (meeting_id, email, user_id) VALUES (?, ?, ?)', [m.id, a.email, a.user_id]);
  }

  // Refresh the meeting cards already posted in chats
  const card = JSON.stringify({ meeting_id: m.id, title: input.title, start: input.start.toISOString(), end: input.end.toISOString(), meet_link: meetLink, html_link: htmlLink, organizer: input.organizer.name });
  for (const table of ['messages', 'direct_messages']) {
    await db.query(`UPDATE ${table} SET body = ? WHERE kind = 'meeting' AND (CASE WHEN JSON_VALID(body) THEN JSON_EXTRACT(body, '$.meeting_id') END) = ?`, [card, m.id]);
  }

  const [[row]] = await db.query(`${MEETING_SELECT} WHERE m.id = ?`, [m.id]);
  const [meeting] = await meetingsOut([row]);
  const notifyIds = [...new Set([...oldAtt, ...input.attendees].map((a) => a.user_id).filter(Boolean))];
  svc.getIo()?.to(notifyIds.map(svc.userRoom)).emit('meeting:updated', { meeting, card });
  if (m.space_id) svc.getIo()?.to(`space:${m.space_id}`).emit('meeting:updated', { meeting, card });
  res.json(meeting);
}));

// PATCH /api/calendar/events/:eventId — edit an event you organise that was made directly in
// Google Calendar (not from TaskSphere). Same body as POST /meetings.
router.patch('/calendar/events/:eventId', ah(async (req, res) => {
  const eventId = req.params.eventId;
  const [[ours]] = await db.query('SELECT id FROM meetings WHERE google_event_id = ?', [eventId]);
  if (ours) throw new HttpError(400, 'This meeting was booked from TaskSphere – edit it from "Meetings from TaskSphere"');
  const current = await getOwnGoogleEvent(req.user.id, eventId);
  if (!current.organizer?.self) throw new HttpError(403, 'Only the organizer can edit this event');
  if (!current.start?.dateTime) throw new HttpError(400, 'All-day events cannot be edited here');

  const input = await readMeetingInput(req);
  if (!req.body.force) await assertCalendarClear(req.user.id, input, { start: current.start.dateTime, end: current.end.dateTime });
  const { event, meetLink } = await patchGoogleEvent(req.user.id, eventId, input, { description: input.description, current });
  res.json({ id: event.id || eventId, title: input.title, start: input.start.toISOString(), end: input.end.toISOString(), meet_link: meetLink, html_link: event.htmlLink || current.htmlLink || null });
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
