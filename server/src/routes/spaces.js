const router = require('express').Router();
const db = require('../db');
const { ah, assertRole, HttpError, notify, ROLE_RANK } = require('../access');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/spaces — spaces I belong to
router.get('/', ah(async (req, res) => {
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.description, s.color, s.owner_id, s.created_at, m.role,
            (SELECT COUNT(*) FROM space_members x WHERE x.space_id = s.id) AS member_count,
            (SELECT COUNT(*) FROM lists l WHERE l.space_id = s.id) AS list_count
       FROM spaces s JOIN space_members m ON m.space_id = s.id AND m.user_id = ?
      ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

// POST /api/spaces — any signed-in user can create a space and becomes its owner
router.post('/', ah(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'Space name is required');
  const [r] = await db.query('INSERT INTO spaces (name, description, color, owner_id) VALUES (?, ?, ?, ?)', [
    name.slice(0, 150), req.body.description || null, req.body.color || '#6366f1', req.user.id,
  ]);
  await db.query('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)', [r.insertId, req.user.id, 'owner']);
  res.status(201).json({ id: r.insertId });
}));

// GET /api/spaces/:spaceId — space details, members, invites, lists
router.get('/:spaceId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const myRole = await assertRole(spaceId, req.user.id, 'viewer');
  const [[space]] = await db.query('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  const [members] = await db.query(
    `SELECT u.id, u.name, u.email, u.avatar_url, m.role, m.joined_at
       FROM space_members m JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ? ORDER BY FIELD(m.role,'owner','admin','member','viewer'), u.name`,
    [spaceId]
  );
  const [invites] = ROLE_RANK[myRole] >= ROLE_RANK.admin
    ? await db.query('SELECT id, email, role, created_at FROM space_invites WHERE space_id = ?', [spaceId])
    : [[]];
  const [lists] = await db.query(
    `SELECT l.id, l.name, l.description, l.methodology, l.created_at,
            (SELECT COUNT(*) FROM tickets t WHERE t.list_id = l.id) AS ticket_count,
            (SELECT COUNT(*) FROM tickets t JOIN list_statuses s ON s.id = t.status_id
              WHERE t.list_id = l.id AND s.is_done = 1) AS done_count
       FROM lists l WHERE l.space_id = ? ORDER BY l.created_at`,
    [spaceId]
  );
  res.json({ ...space, my_role: myRole, members, invites, lists });
}));

// PATCH /api/spaces/:spaceId — admin+
router.patch('/:spaceId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  await assertRole(spaceId, req.user.id, 'admin');
  const fields = [];
  const vals = [];
  for (const k of ['name', 'description', 'color']) {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(req.body[k]); }
  }
  if (fields.length) await db.query(`UPDATE spaces SET ${fields.join(', ')} WHERE id = ?`, [...vals, spaceId]);
  notify(req, spaceId, { type: 'space' });
  res.json({ ok: true });
}));

// DELETE /api/spaces/:spaceId — owner only
router.delete('/:spaceId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  await assertRole(spaceId, req.user.id, 'owner');
  notify(req, spaceId, { type: 'space-deleted' });
  await db.query('DELETE FROM spaces WHERE id = ?', [spaceId]);
  res.json({ ok: true });
}));

// POST /api/spaces/:spaceId/members { email, role } — admin+. Adds existing users, invites others.
router.post('/:spaceId/members', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const myRole = await assertRole(spaceId, req.user.id, 'admin');
  const email = (req.body.email || '').trim().toLowerCase();
  const role = req.body.role || 'member';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role');
  if (role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Only the owner can add admins');

  const [[user]] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (user) {
    const existing = await db.query('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, user.id]);
    if (existing[0].length) throw new HttpError(409, 'This person is already a member');
    await db.query('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)', [spaceId, user.id, role]);
    notify(req, spaceId, { type: 'members' });
    return res.status(201).json({ added: true });
  }
  await db.query(
    'INSERT INTO space_invites (space_id, email, role, invited_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)',
    [spaceId, email, role, req.user.id]
  );
  notify(req, spaceId, { type: 'members' });
  res.status(201).json({ invited: true });
}));

// PATCH /api/spaces/:spaceId/members/:userId { role } — admin+
router.patch('/:spaceId/members/:userId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const targetId = Number(req.params.userId);
  const myRole = await assertRole(spaceId, req.user.id, 'admin');
  const role = req.body.role;
  if (!['admin', 'member', 'viewer'].includes(role)) throw new HttpError(400, 'Invalid role');
  const [[target]] = await db.query('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, targetId]);
  if (!target) throw new HttpError(404, 'Member not found');
  if (target.role === 'owner') throw new HttpError(403, "The owner's role cannot be changed");
  if ((target.role === 'admin' || role === 'admin') && myRole !== 'owner') {
    throw new HttpError(403, 'Only the owner can change admin roles');
  }
  await db.query('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?', [role, spaceId, targetId]);
  notify(req, spaceId, { type: 'members' });
  res.json({ ok: true });
}));

// DELETE /api/spaces/:spaceId/members/:userId — admin+ removes someone, or a member leaves
router.delete('/:spaceId/members/:userId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const targetId = Number(req.params.userId);
  const self = targetId === req.user.id;
  const myRole = await assertRole(spaceId, req.user.id, self ? 'viewer' : 'admin');
  const [[target]] = await db.query('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, targetId]);
  if (!target) throw new HttpError(404, 'Member not found');
  if (target.role === 'owner') throw new HttpError(403, 'The owner cannot be removed');
  if (!self && target.role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Only the owner can remove admins');
  await db.query('DELETE FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, targetId]);
  // Removed members are also unassigned from tickets in this space
  await db.query(
    `DELETE ta FROM ticket_assignees ta JOIN tickets t ON t.id = ta.ticket_id JOIN lists l ON l.id = t.list_id
      WHERE l.space_id = ? AND ta.user_id = ?`,
    [spaceId, targetId]
  );
  notify(req, spaceId, { type: 'members', removedUserId: targetId });
  res.json({ ok: true });
}));

// DELETE /api/spaces/:spaceId/invites/:inviteId — admin+
router.delete('/:spaceId/invites/:inviteId', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  await assertRole(spaceId, req.user.id, 'admin');
  await db.query('DELETE FROM space_invites WHERE id = ? AND space_id = ?', [req.params.inviteId, spaceId]);
  notify(req, spaceId, { type: 'members' });
  res.json({ ok: true });
}));

// GET /api/spaces/:spaceId/messages?before=<id> — chat history (members only)
router.get('/:spaceId/messages', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  await assertRole(spaceId, req.user.id, 'viewer');
  const before = Number(req.query.before) || 2147483647;
  const [rows] = await db.query(
    `SELECT m.id, m.kind, m.body, m.created_at, u.id AS user_id, u.name, u.avatar_url
       FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 50`,
    [spaceId, before]
  );
  res.json(rows.reverse());
}));

module.exports = router;
