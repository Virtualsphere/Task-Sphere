// Shared chat logic used by REST routes, sockets, huddles and meetings
const db = require('./db');
const { HttpError } = require('./access');

let io = null;
const setIo = (instance) => { io = instance; };
const getIo = () => io;

const userRoom = (id) => `user:${id}`;

// People who share at least one space with this user
async function teammateIds(userId) {
  const [rows] = await db.query(
    `SELECT DISTINCT m2.user_id FROM space_members m1
       JOIN space_members m2 ON m2.space_id = m1.space_id
      WHERE m1.user_id = ? AND m2.user_id <> ?`, [userId, userId]);
  return rows.map((r) => r.user_id);
}

async function assertTeammates(userId, ids) {
  const clean = [...new Set((ids || []).map(Number).filter((x) => x && x !== userId))];
  if (!clean.length) return [];
  const mates = new Set(await teammateIds(userId));
  if (clean.some((id) => !mates.has(id))) throw new HttpError(400, 'You can only chat with people who share a space with you');
  return clean;
}

async function convMemberIds(convId) {
  const [rows] = await db.query('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [convId]);
  return rows.map((r) => r.user_id);
}

async function spaceMemberIds(spaceId) {
  const [rows] = await db.query('SELECT user_id FROM space_members WHERE space_id = ?', [spaceId]);
  return rows.map((r) => r.user_id);
}

async function assertConvMember(convId, userId) {
  const [[conv]] = await db.query(
    `SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = ?
      WHERE c.id = ?`, [userId, convId]);
  if (!conv) throw new HttpError(404, 'Conversation not found');
  return conv;
}

const dmOut = (m) => ({
  id: m.id, conversationId: m.conversation_id, kind: m.kind, body: m.body, created_at: m.created_at,
  user_id: m.user_id, name: m.name, avatar_url: m.avatar_url,
});

// Insert a message into a 1:1/group conversation and push it live to every member
async function postDirectMessage(convId, userId, body, kind = 'text') {
  const text = String(body || '').trim();
  if (!text) throw new HttpError(400, 'Message cannot be empty');
  const [r] = await db.query('INSERT INTO direct_messages (conversation_id, user_id, kind, body) VALUES (?, ?, ?, ?)',
    [convId, userId, kind, text.slice(0, 8000)]);
  await db.query('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [convId]);
  // The sender has obviously read their own message
  await db.query('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', [r.insertId, convId, userId]);
  const [[row]] = await db.query(
    `SELECT d.*, u.name, u.avatar_url FROM direct_messages d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, [r.insertId]);
  const msg = dmOut(row);
  if (io) io.to((await convMemberIds(convId)).map(userRoom)).emit('dm:message', msg);
  return msg;
}

const spaceMsgOut = (m) => ({
  id: m.id, spaceId: m.space_id, kind: m.kind || 'text', body: m.body, created_at: m.created_at,
  user_id: m.user_id, name: m.name, avatar_url: m.avatar_url,
});

// Insert a message into a space chat and push it to everyone viewing the space
async function postSpaceMessage(spaceId, userId, body, kind = 'text') {
  const text = String(body || '').trim();
  if (!text) throw new HttpError(400, 'Message cannot be empty');
  const [r] = await db.query('INSERT INTO messages (space_id, user_id, kind, body) VALUES (?, ?, ?, ?)', [spaceId, userId, kind, text.slice(0, 8000)]);
  const [[row]] = await db.query(
    `SELECT m.*, u.name, u.avatar_url FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`, [r.insertId]);
  const msg = spaceMsgOut(row);
  if (io) io.to(`space:${spaceId}`).emit('chat:message', msg);
  return msg;
}

module.exports = {
  setIo, getIo, userRoom, teammateIds, assertTeammates, convMemberIds, spaceMemberIds,
  assertConvMember, postDirectMessage, postSpaceMessage, dmOut, spaceMsgOut,
};
