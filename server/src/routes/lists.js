const router = require('express').Router();
const db = require('../db');
const { METHODOLOGIES } = require('../methodologies');
const { ah, assertRole, spaceIdForList, HttpError, notify } = require('../access');

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function cleanStatuses(input, methodology) {
  const src = Array.isArray(input) && input.length ? input : METHODOLOGIES[methodology].statuses;
  const out = src
    .map((s) => ({
      id: s.id ? Number(s.id) : null,
      name: String(s.name || '').trim().slice(0, 60),
      color: HEX_RE.test(s.color || '') ? s.color : '#94a3b8',
      is_done: s.is_done ? 1 : 0,
    }))
    .filter((s) => s.name);
  if (!out.length) throw new HttpError(400, 'A list needs at least one status');
  return out;
}

// GET /api/methodologies — templates for the "create list" screen
router.get('/methodologies', (req, res) => {
  res.json(Object.entries(METHODOLOGIES).map(([key, m]) => ({ key, ...m })));
});

// POST /api/spaces/:spaceId/lists — admin+
router.post('/spaces/:spaceId/lists', ah(async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  await assertRole(spaceId, req.user.id, 'admin');
  const name = (req.body.name || '').trim();
  const methodology = (req.body.methodology || 'KANBAN').toUpperCase();
  if (!name) throw new HttpError(400, 'List name is required');
  if (!METHODOLOGIES[methodology]) throw new HttpError(400, 'Unknown methodology');
  const statuses = cleanStatuses(req.body.statuses, methodology);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO lists (space_id, name, description, methodology, created_by) VALUES (?, ?, ?, ?, ?)',
      [spaceId, name.slice(0, 150), req.body.description || null, methodology, req.user.id]
    );
    for (const [i, s] of statuses.entries()) {
      await conn.query('INSERT INTO list_statuses (list_id, name, color, position, is_done) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, s.name, s.color, i, s.is_done]);
    }
    await conn.commit();
    notify(req, spaceId, { type: 'lists' });
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// GET /api/lists/:listId — list, statuses and tickets (with assignees, subtask progress, latest comment)
router.get('/lists/:listId', ah(async (req, res) => {
  const listId = Number(req.params.listId);
  const spaceId = await spaceIdForList(listId);
  const myRole = await assertRole(spaceId, req.user.id, 'viewer');

  const [[list]] = await db.query('SELECT * FROM lists WHERE id = ?', [listId]);
  const [statuses] = await db.query('SELECT * FROM list_statuses WHERE list_id = ? ORDER BY position', [listId]);
  const [tickets] = await db.query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM subtasks s WHERE s.ticket_id = t.id) AS subtask_total,
            (SELECT COUNT(*) FROM subtasks s WHERE s.ticket_id = t.id AND s.is_done = 1) AS subtask_done,
            (SELECT COUNT(*) FROM comments c WHERE c.ticket_id = t.id) AS comment_count
       FROM tickets t WHERE t.list_id = ? ORDER BY t.position, t.id`,
    [listId]
  );
  const ids = tickets.map((t) => t.id);
  if (ids.length) {
    const [assignees] = await db.query(
      `SELECT ta.ticket_id, u.id, u.name, u.avatar_url FROM ticket_assignees ta JOIN users u ON u.id = ta.user_id
        WHERE ta.ticket_id IN (?)`, [ids]);
    const [latest] = await db.query(
      `SELECT c.ticket_id, c.body, c.created_at, u.name FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.id IN (SELECT MAX(id) FROM comments WHERE ticket_id IN (?) GROUP BY ticket_id)`, [ids]);
    const byTicket = {};
    for (const a of assignees) (byTicket[a.ticket_id] ||= []).push({ id: a.id, name: a.name, avatar_url: a.avatar_url });
    const latestBy = Object.fromEntries(latest.map((c) => [c.ticket_id, c]));
    for (const t of tickets) {
      t.assignees = byTicket[t.id] || [];
      t.latest_comment = latestBy[t.id] || null;
    }
  }
  res.json({ ...list, my_role: myRole, statuses, tickets });
}));

// PATCH /api/lists/:listId — admin+
router.patch('/lists/:listId', ah(async (req, res) => {
  const listId = Number(req.params.listId);
  const spaceId = await spaceIdForList(listId);
  await assertRole(spaceId, req.user.id, 'admin');
  const fields = [];
  const vals = [];
  for (const k of ['name', 'description']) {
    if (req.body[k] !== undefined) { fields.push(`${k} = ?`); vals.push(req.body[k]); }
  }
  if (fields.length) await db.query(`UPDATE lists SET ${fields.join(', ')} WHERE id = ?`, [...vals, listId]);
  notify(req, spaceId, { type: 'lists', listId });
  res.json({ ok: true });
}));

// PUT /api/lists/:listId/statuses — replace the workflow (admin+).
// Existing statuses keep their id; tickets on a removed status move to the first status.
router.put('/lists/:listId/statuses', ah(async (req, res) => {
  const listId = Number(req.params.listId);
  const spaceId = await spaceIdForList(listId);
  await assertRole(spaceId, req.user.id, 'admin');
  if (!Array.isArray(req.body.statuses) || !req.body.statuses.length) throw new HttpError(400, 'Provide statuses');
  const [[list]] = await db.query('SELECT methodology FROM lists WHERE id = ?', [listId]);
  const statuses = cleanStatuses(req.body.statuses, list.methodology);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [current] = await conn.query('SELECT id FROM list_statuses WHERE list_id = ?', [listId]);
    const currentIds = new Set(current.map((s) => s.id));
    const keptIds = [];
    for (const [i, s] of statuses.entries()) {
      if (s.id && currentIds.has(s.id)) {
        await conn.query('UPDATE list_statuses SET name = ?, color = ?, position = ?, is_done = ? WHERE id = ?',
          [s.name, s.color, i, s.is_done, s.id]);
        keptIds.push(s.id);
      } else {
        const [r] = await conn.query('INSERT INTO list_statuses (list_id, name, color, position, is_done) VALUES (?, ?, ?, ?, ?)',
          [listId, s.name, s.color, i, s.is_done]);
        keptIds.push(r.insertId);
      }
    }
    const removed = [...currentIds].filter((id) => !keptIds.includes(id));
    if (removed.length) {
      await conn.query('UPDATE tickets SET status_id = ? WHERE list_id = ? AND status_id IN (?)', [keptIds[0], listId, removed]);
      await conn.query('DELETE FROM list_statuses WHERE id IN (?)', [removed]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  notify(req, spaceId, { type: 'lists', listId });
  res.json({ ok: true });
}));

// DELETE /api/lists/:listId — admin+
router.delete('/lists/:listId', ah(async (req, res) => {
  const listId = Number(req.params.listId);
  const spaceId = await spaceIdForList(listId);
  await assertRole(spaceId, req.user.id, 'admin');
  await db.query('DELETE FROM lists WHERE id = ?', [listId]);
  notify(req, spaceId, { type: 'lists', listId, deleted: true });
  res.json({ ok: true });
}));

module.exports = router;
