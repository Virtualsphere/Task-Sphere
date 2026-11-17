// Personal (1:1) and group chats between teammates
const router = require('express').Router();
const db = require('../db');
const { ah, HttpError } = require('../access');
const presence = require('../presence');
const svc = require('../chatService');

// GET /api/people — everyone who shares a space with me (who I can chat with)
router.get('/people', ah(async (req, res) => {
  const ids = await svc.teammateIds(req.user.id);
  if (!ids.length) return res.json([]);
  const [rows] = await db.query('SELECT id, name, email, avatar_url FROM users WHERE id IN (?) ORDER BY name', [ids]);
  res.json(rows.map((u) => ({ ...u, online: presence.isOnline(u.id) })));
}));

async function loadConversations(userId, onlyId = null) {
  const [convs] = await db.query(
    `SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.last_message_at, cm.last_read_id,
            (SELECT COUNT(*) FROM direct_messages d
              WHERE d.conversation_id = c.id AND d.id > cm.last_read_id AND d.user_id <> ?) AS unread
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
      ${onlyId ? 'WHERE c.id = ?' : ''}
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    onlyId ? [userId, userId, onlyId] : [userId, userId]);
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);
  const [members] = await db.query(
    `SELECT cm.conversation_id, u.id, u.name, u.email, u.avatar_url FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id IN (?) ORDER BY u.name`, [ids]);
  const [lasts] = await db.query(
    `SELECT d.conversation_id, d.kind, d.body, d.created_at, d.user_id, u.name FROM direct_messages d
       JOIN users u ON u.id = d.user_id
      WHERE d.id IN (SELECT MAX(id) FROM direct_messages WHERE conversation_id IN (?) GROUP BY conversation_id)`, [ids]);
  const byConv = {};
  for (const m of members) (byConv[m.conversation_id] ||= []).push({ id: m.id, name: m.name, email: m.email, avatar_url: m.avatar_url, online: presence.isOnline(m.id) });
  const lastBy = Object.fromEntries(lasts.map((l) => [l.conversation_id, l]));
  return convs.map((c) => ({ ...c, unread: Number(c.unread), members: byConv[c.id] || [], last_message: lastBy[c.id] || null }));
}

// GET /api/conversations — my DMs and groups, newest first, with unread counts
router.get('/conversations', ah(async (req, res) => {
  res.json(await loadConversations(req.user.id));
}));

// POST /api/conversations/direct { user_id } — open (or create) a 1:1 chat
router.post('/conversations/direct', ah(async (req, res) => {
  const [other] = await svc.assertTeammates(req.user.id, [req.body.user_id]);
  if (!other) throw new HttpError(400, 'Choose a teammate');
  const key = [req.user.id, other].sort((a, b) => a - b).join(':');
  const [[existing]] = await db.query('SELECT id FROM conversations WHERE direct_key = ?', [key]);
  let id = existing?.id;
  if (!id) {
    const [r] = await db.query('INSERT INTO conversations (type, direct_key, created_by) VALUES (?, ?, ?)', ['direct', key, req.user.id]);
    id = r.insertId;
    await db.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [id, req.user.id, id, other]);
  }
  res.status(existing ? 200 : 201).json((await loadConversations(req.user.id, id))[0]);
}));

// POST /api/conversations/group { name, user_ids }
router.post('/conversations/group', ah(async (req, res) => {
  const ids = await svc.assertTeammates(req.user.id, req.body.user_ids);
  if (ids.length < 2) throw new HttpError(400, 'Pick at least two people for a group (use a direct chat for one person)');
  const name = String(req.body.name || '').trim().slice(0, 150) || null;
  const [r] = await db.query('INSERT INTO conversations (type, name, created_by) VALUES (?, ?, ?)', ['group', name, req.user.id]);
  for (const uid of [req.user.id, ...ids]) {
    await db.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [r.insertId, uid]);
  }
  const conv = (await loadConversations(req.user.id, r.insertId))[0];
  svc.getIo()?.to(ids.map(svc.userRoom)).emit('conversation:new', { id: r.insertId });
  res.status(201).json(conv);
}));

// GET /api/conversations/:id
router.get('/conversations/:id', ah(async (req, res) => {
  await svc.assertConvMember(req.params.id, req.user.id);
  res.json((await loadConversations(req.user.id, Number(req.params.id)))[0]);
}));

// PATCH /api/conversations/:id { name } — rename a group
router.patch('/conversations/:id', ah(async (req, res) => {
  const conv = await svc.assertConvMember(req.params.id, req.user.id);
  if (conv.type !== 'group') throw new HttpError(400, 'Only group chats can be renamed');
  await db.query('UPDATE conversations SET name = ? WHERE id = ?', [String(req.body.name || '').trim().slice(0, 150) || null, conv.id]);
  svc.getIo()?.to((await svc.convMemberIds(conv.id)).map(svc.userRoom)).emit('conversation:updated', { id: conv.id });
  res.json({ ok: true });
}));

// POST /api/conversations/:id/members { user_ids } — add people to a group
router.post('/conversations/:id/members', ah(async (req, res) => {
  const conv = await svc.assertConvMember(req.params.id, req.user.id);
  if (conv.type !== 'group') throw new HttpError(400, 'Start a group chat to add more people');
  const ids = await svc.assertTeammates(req.user.id, req.body.user_ids);
  for (const uid of ids) await db.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conv.id, uid]);
  svc.getIo()?.to((await svc.convMemberIds(conv.id)).map(svc.userRoom)).emit('conversation:updated', { id: conv.id });
  res.json((await loadConversations(req.user.id, conv.id))[0]);
}));

// DELETE /api/conversations/:id/members/me — leave a group
router.delete('/conversations/:id/members/me', ah(async (req, res) => {
  const conv = await svc.assertConvMember(req.params.id, req.user.id);
  if (conv.type !== 'group') throw new HttpError(400, 'You cannot leave a direct chat');
  await db.query('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conv.id, req.user.id]);
  svc.getIo()?.to((await svc.convMemberIds(conv.id)).map(svc.userRoom)).emit('conversation:updated', { id: conv.id });
  res.json({ ok: true });
}));

// GET /api/conversations/:id/messages?before=<id>
router.get('/conversations/:id/messages', ah(async (req, res) => {
  await svc.assertConvMember(req.params.id, req.user.id);
  const before = Number(req.query.before) || 2147483647;
  const [rows] = await db.query(
    `SELECT d.*, u.name, u.avatar_url FROM direct_messages d JOIN users u ON u.id = d.user_id
      WHERE d.conversation_id = ? AND d.id < ? ORDER BY d.id DESC LIMIT 50`, [req.params.id, before]);
  res.json(rows.reverse().map(svc.dmOut));
}));

// POST /api/conversations/:id/messages { body } — (sockets are used normally; this is the REST fallback)
router.post('/conversations/:id/messages', ah(async (req, res) => {
  await svc.assertConvMember(req.params.id, req.user.id);
  res.status(201).json(await svc.postDirectMessage(Number(req.params.id), req.user.id, req.body.body));
}));

// POST /api/conversations/:id/read { last_id }
router.post('/conversations/:id/read', ah(async (req, res) => {
  await svc.assertConvMember(req.params.id, req.user.id);
  await db.query('UPDATE conversation_members SET last_read_id = GREATEST(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?',
    [Number(req.body.last_id) || 0, req.params.id, req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
