const router = require('express').Router();
const db = require('../db');
const { ah, assertRole, spaceIdForList, spaceForTicket, HttpError, notify, ROLE_RANK } = require('../access');
const { cleanMentions } = require('../chatService');
const alerts = require('../alerts');
const { cleanName, cleanMime, removeFiles, receiveOne, receiveMany, sendStored } = require('../files');

const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cleanDate = (v) => (v && DATE_RE.test(v) ? v : null);

async function validateStatus(listId, statusId) {
  if (statusId == null) return null;
  const [[s]] = await db.query('SELECT id FROM list_statuses WHERE id = ? AND list_id = ?', [statusId, listId]);
  if (!s) throw new HttpError(400, 'Status does not belong to this list');
  return s.id;
}

async function validateMembers(spaceId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  const [rows] = await db.query('SELECT user_id FROM space_members WHERE space_id = ? AND user_id IN (?)', [spaceId, ids]);
  if (rows.length !== ids.length) throw new HttpError(400, 'Assignees must be members of this space');
  return ids;
}

async function setAssignees(ticketId, ids) {
  await db.query('DELETE FROM ticket_assignees WHERE ticket_id = ?', [ticketId]);
  for (const uid of ids) await db.query('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [ticketId, uid]);
}

async function loadTicket(ticketId) {
  const [[ticket]] = await db.query(
    `SELECT t.*, u.name AS created_by_name FROM tickets t JOIN users u ON u.id = t.created_by WHERE t.id = ?`, [ticketId]);
  if (!ticket) return null;
  const [assignees] = await db.query(
    'SELECT u.id, u.name, u.email, u.avatar_url FROM ticket_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.ticket_id = ?', [ticketId]);
  const [subtasks] = await db.query(
    `SELECT s.*, u.name AS assignee_name FROM subtasks s LEFT JOIN users u ON u.id = s.assignee_id
      WHERE s.ticket_id = ? ORDER BY s.position, s.id`, [ticketId]);
  const [comments] = await db.query(
    `SELECT c.id, c.body, c.created_at, u.id AS user_id, u.name, u.avatar_url
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.ticket_id = ? ORDER BY c.id DESC`, [ticketId]);
  const [files] = await db.query(
    `SELECT a.id, a.subtask_id, a.comment_id, a.user_id, a.original_name AS name, a.mime_type AS mime, a.size_bytes AS size, a.created_at
       FROM ticket_attachments a WHERE a.ticket_id = ? ORDER BY a.id`, [ticketId]);
  return {
    ...ticket,
    assignees,
    attachments: files.filter((f) => !f.subtask_id && !f.comment_id),
    subtasks: subtasks.map((s) => ({ ...s, attachments: files.filter((f) => f.subtask_id === s.id) })),
    comments: comments.map((c) => ({ ...c, attachments: files.filter((f) => f.comment_id === c.id) })),
  };
}

// Stored file names for attachments matching a WHERE clause (to delete them from disk after the rows go)
async function storedNames(where, params) {
  const [rows] = await db.query(`SELECT stored_name FROM ticket_attachments WHERE ${where}`, params);
  return rows.map((r) => r.stored_name);
}

// Saves uploaded files as attachments of a ticket / subtask / comment
async function saveAttachments(files, { ticketId, subtaskId = null, commentId = null, userId }) {
  for (const f of files) {
    await db.query(
      `INSERT INTO ticket_attachments (ticket_id, subtask_id, comment_id, user_id, stored_name, original_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, subtaskId, commentId, userId, f.filename, cleanName(f.originalname), cleanMime(f.mimetype), f.size]);
  }
}

// Checks the user's role on the ticket BEFORE any upload bytes are accepted
const ticketAccess = (minRole) => ah(async (req, res, next) => {
  const info = await spaceForTicket(Number(req.params.ticketId));
  if (!info) throw new HttpError(404, 'Ticket not found');
  req.ticketInfo = info;
  req.ticketRole = await assertRole(info.space_id, req.user.id, minRole);
  next();
});

// POST /api/lists/:listId/tickets — member+
router.post('/lists/:listId/tickets', ah(async (req, res) => {
  const listId = Number(req.params.listId);
  const spaceId = await spaceIdForList(listId);
  await assertRole(spaceId, req.user.id, 'member');
  const b = req.body;
  const title = (b.title || '').trim();
  if (!title) throw new HttpError(400, 'Ticket title is required');
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';

  let statusId = await validateStatus(listId, b.status_id ?? null);
  if (!statusId) {
    const [[first]] = await db.query('SELECT id FROM list_statuses WHERE list_id = ? ORDER BY position LIMIT 1', [listId]);
    statusId = first?.id || null;
  }
  const assignees = await validateMembers(spaceId, b.assignee_ids);
  const [[{ maxPos }]] = await db.query('SELECT COALESCE(MAX(position), 0) AS maxPos FROM tickets WHERE list_id = ?', [listId]);

  const [r] = await db.query(
    `INSERT INTO tickets (list_id, title, description, status_id, priority, start_date, due_date, position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [listId, title.slice(0, 255), b.description || null, statusId, priority, cleanDate(b.start_date), cleanDate(b.due_date), maxPos + 1, req.user.id]
  );
  await setAssignees(r.insertId, assignees);
  notify(req, spaceId, { type: 'tickets', listId, ticketId: r.insertId });
  res.status(201).json(await loadTicket(r.insertId));
}));

// GET /api/tickets/:ticketId — full ticket with subtasks and comments
router.get('/tickets/:ticketId', ah(async (req, res) => {
  const info = await spaceForTicket(req.params.ticketId);
  if (!info) throw new HttpError(404, 'Ticket not found');
  const myRole = await assertRole(info.space_id, req.user.id, 'viewer');
  res.json({ ...(await loadTicket(req.params.ticketId)), my_role: myRole });
}));

// PATCH /api/tickets/:ticketId — member+
router.patch('/tickets/:ticketId', ah(async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const info = await spaceForTicket(ticketId);
  if (!info) throw new HttpError(404, 'Ticket not found');
  await assertRole(info.space_id, req.user.id, 'member');
  const b = req.body;
  const fields = [];
  const vals = [];
  if (b.title !== undefined) {
    if (!String(b.title).trim()) throw new HttpError(400, 'Title cannot be empty');
    fields.push('title = ?'); vals.push(String(b.title).trim().slice(0, 255));
  }
  if (b.description !== undefined) { fields.push('description = ?'); vals.push(b.description); }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, 'Invalid priority');
    fields.push('priority = ?'); vals.push(b.priority);
  }
  if (b.status_id !== undefined) { fields.push('status_id = ?'); vals.push(await validateStatus(info.list_id, b.status_id)); }
  if (b.start_date !== undefined) { fields.push('start_date = ?'); vals.push(cleanDate(b.start_date)); }
  if (b.due_date !== undefined) { fields.push('due_date = ?'); vals.push(cleanDate(b.due_date)); }
  if (b.position !== undefined) { fields.push('position = ?'); vals.push(Number(b.position) || 0); }
  if (fields.length) await db.query(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`, [...vals, ticketId]);
  if (b.assignee_ids !== undefined) await setAssignees(ticketId, await validateMembers(info.space_id, b.assignee_ids));
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId });
  res.json(await loadTicket(ticketId));
}));

// DELETE /api/tickets/:ticketId — admin+, or the ticket creator
router.delete('/tickets/:ticketId', ah(async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const info = await spaceForTicket(ticketId);
  if (!info) throw new HttpError(404, 'Ticket not found');
  const role = await assertRole(info.space_id, req.user.id, 'member');
  if (ROLE_RANK[role] < ROLE_RANK.admin && info.created_by !== req.user.id) {
    throw new HttpError(403, 'Only admins or the ticket creator can delete it');
  }
  const names = await storedNames('ticket_id = ?', [ticketId]);
  await db.query('DELETE FROM tickets WHERE id = ?', [ticketId]);
  removeFiles(names);
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId, deleted: true });
  res.json({ ok: true });
}));

// ---------- Subtasks ----------

router.post('/tickets/:ticketId/subtasks', ah(async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const info = await spaceForTicket(ticketId);
  if (!info) throw new HttpError(404, 'Ticket not found');
  await assertRole(info.space_id, req.user.id, 'member');
  const title = (req.body.title || '').trim();
  if (!title) throw new HttpError(400, 'Subtask title is required');
  const [assignee] = await validateMembers(info.space_id, req.body.assignee_id ? [req.body.assignee_id] : []);
  const priority = PRIORITIES.includes(req.body.priority) ? req.body.priority : 'normal';
  const [[{ maxPos }]] = await db.query('SELECT COALESCE(MAX(position), 0) AS maxPos FROM subtasks WHERE ticket_id = ?', [ticketId]);
  const description = String(req.body.description || '').trim().slice(0, 20000) || null;
  await db.query(
    'INSERT INTO subtasks (ticket_id, title, description, priority, assignee_id, due_date, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ticketId, title.slice(0, 255), description, priority, assignee || null, cleanDate(req.body.due_date), maxPos + 1]
  );
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId });
  res.status(201).json(await loadTicket(ticketId));
}));

async function subtaskContext(subtaskId) {
  const [[s]] = await db.query('SELECT ticket_id FROM subtasks WHERE id = ?', [subtaskId]);
  if (!s) throw new HttpError(404, 'Subtask not found');
  return { ticketId: s.ticket_id, ...(await spaceForTicket(s.ticket_id)) };
}

router.patch('/subtasks/:id', ah(async (req, res) => {
  const ctx = await subtaskContext(req.params.id);
  await assertRole(ctx.space_id, req.user.id, 'member');
  const b = req.body;
  const fields = [];
  const vals = [];
  if (b.title !== undefined) {
    if (!String(b.title).trim()) throw new HttpError(400, 'Subtask title cannot be empty');
    fields.push('title = ?'); vals.push(String(b.title).trim().slice(0, 255));
  }
  if (b.description !== undefined) { fields.push('description = ?'); vals.push(String(b.description || '').slice(0, 20000) || null); }
  if (b.is_done !== undefined) { fields.push('is_done = ?'); vals.push(b.is_done ? 1 : 0); }
  if (b.priority !== undefined && PRIORITIES.includes(b.priority)) { fields.push('priority = ?'); vals.push(b.priority); }
  if (b.due_date !== undefined) { fields.push('due_date = ?'); vals.push(cleanDate(b.due_date)); }
  if (b.assignee_id !== undefined) {
    const [a] = await validateMembers(ctx.space_id, b.assignee_id ? [b.assignee_id] : []);
    fields.push('assignee_id = ?'); vals.push(a || null);
  }
  if (fields.length) await db.query(`UPDATE subtasks SET ${fields.join(', ')} WHERE id = ?`, [...vals, req.params.id]);
  notify(req, ctx.space_id, { type: 'tickets', listId: ctx.list_id, ticketId: ctx.ticketId });
  res.json(await loadTicket(ctx.ticketId));
}));

router.delete('/subtasks/:id', ah(async (req, res) => {
  const ctx = await subtaskContext(req.params.id);
  await assertRole(ctx.space_id, req.user.id, 'member');
  const names = await storedNames('subtask_id = ?', [req.params.id]);
  await db.query('DELETE FROM subtasks WHERE id = ?', [req.params.id]);
  removeFiles(names);
  notify(req, ctx.space_id, { type: 'tickets', listId: ctx.list_id, ticketId: ctx.ticketId });
  res.json(await loadTicket(ctx.ticketId));
}));

// ---------- Comments ----------

// POST /api/tickets/:ticketId/comments — member+. JSON { body } or multipart (body, files[] up to 10).
// @mentions are written as @[Name](userId); only members of the space are kept.
router.post('/tickets/:ticketId/comments', ticketAccess('member'), receiveMany, ah(async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const info = req.ticketInfo;
  const files = req.files || [];
  let body;
  let commentId;
  try {
    body = String(req.body.body || '').trim().slice(0, 5000);
    if (!body && !files.length) throw new HttpError(400, 'Write a comment or attach a file');
    if (body) body = await cleanMentions(info.space_id, body);
    const [r] = await db.query('INSERT INTO comments (ticket_id, user_id, body) VALUES (?, ?, ?)', [ticketId, req.user.id, body]);
    commentId = r.insertId;
    try {
      await saveAttachments(files, { ticketId, commentId, userId: req.user.id });
    } catch (e) {
      await db.query('DELETE FROM comments WHERE id = ?', [commentId]);
      throw e;
    }
  } catch (e) {
    removeFiles(files.map((f) => f.path));
    throw e;
  }
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId });
  // @mentions: email + desktop notification; the link opens this task
  if (body.includes('@[')) {
    db.query('SELECT title FROM tickets WHERE id = ?', [ticketId]).then(([[t]]) => alerts.mentioned({
      text: body, fromId: req.user.id, where: `a comment on task #${ticketId} “${t?.title || ''}”`,
      path: `/spaces/${info.space_id}/lists/${info.list_id}?ticket=${ticketId}`, tag: `comment-${commentId}`,
    })).catch(() => {});
  }
  res.status(201).json(await loadTicket(ticketId));
}));

router.delete('/comments/:id', ah(async (req, res) => {
  const [[c]] = await db.query('SELECT ticket_id, user_id FROM comments WHERE id = ?', [req.params.id]);
  if (!c) throw new HttpError(404, 'Comment not found');
  const info = await spaceForTicket(c.ticket_id);
  const role = await assertRole(info.space_id, req.user.id, 'viewer');
  if (c.user_id !== req.user.id && ROLE_RANK[role] < ROLE_RANK.admin) throw new HttpError(403, 'You can only delete your own comments');
  const names = await storedNames('comment_id = ?', [req.params.id]);
  await db.query('DELETE FROM comments WHERE id = ?', [req.params.id]);
  removeFiles(names);
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId: c.ticket_id });
  res.json(await loadTicket(c.ticket_id));
}));

// ---------- Attachments (task description, subtask description) ----------

// POST /api/tickets/:ticketId/attachments — member+. Multipart: file, optional subtask_id.
router.post('/tickets/:ticketId/attachments', ticketAccess('member'), receiveOne, ah(async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  const info = req.ticketInfo;
  try {
    if (!req.file) throw new HttpError(400, 'Choose a file to attach');
    let subtaskId = null;
    if (req.body.subtask_id) {
      const [[st]] = await db.query('SELECT id FROM subtasks WHERE id = ? AND ticket_id = ?', [Number(req.body.subtask_id), ticketId]);
      if (!st) throw new HttpError(404, 'Subtask not found');
      subtaskId = st.id;
    }
    await saveAttachments([req.file], { ticketId, subtaskId, userId: req.user.id });
  } catch (e) {
    removeFiles([req.file?.path]);
    throw e;
  }
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId });
  res.status(201).json(await loadTicket(ticketId));
}));

async function attachmentContext(id, userId, minRole) {
  const [[att]] = await db.query('SELECT * FROM ticket_attachments WHERE id = ?', [Number(id)]);
  if (!att) throw new HttpError(404, 'File not found');
  const info = await spaceForTicket(att.ticket_id);
  const role = await assertRole(info.space_id, userId, minRole);
  return { att, info, role };
}

// GET /api/ticket-attachments/:id[?inline=1] — anyone who can see the ticket
router.get('/ticket-attachments/:id', ah(async (req, res) => {
  const { att } = await attachmentContext(req.params.id, req.user.id, 'viewer');
  sendStored(req, res, att);
}));

// DELETE /api/ticket-attachments/:id — whoever added it, or an admin+
router.delete('/ticket-attachments/:id', ah(async (req, res) => {
  const { att, info, role } = await attachmentContext(req.params.id, req.user.id, 'member');
  if (att.user_id !== req.user.id && ROLE_RANK[role] < ROLE_RANK.admin) throw new HttpError(403, 'You can only remove files you added');
  await db.query('DELETE FROM ticket_attachments WHERE id = ?', [att.id]);
  removeFiles([att.stored_name]);
  notify(req, info.space_id, { type: 'tickets', listId: info.list_id, ticketId: att.ticket_id });
  res.json(await loadTicket(att.ticket_id));
}));

module.exports = router;
