// Shared chat logic used by REST routes, sockets, huddles and meetings
const db = require('./db');
const { HttpError } = require('./access');
const presence = require('./presence');

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

// Free email providers are not an organization: two strangers on gmail.com must not see each other
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.com', 'yandex.com',
  'mail.com', 'gmx.com', 'rediffmail.com',
]);
const orgDomain = (email) => {
  const d = String(email || '').split('@')[1]?.trim().toLowerCase();
  return d && !PUBLIC_DOMAINS.has(d) ? d : null;
};

// Everyone this user may chat with: people from the same organization (same company email domain)
// plus anyone they share a space with (which also covers guests from other companies).
async function contactIds(userId) {
  const [[me]] = await db.query('SELECT email FROM users WHERE id = ?', [userId]);
  const ids = new Set(await teammateIds(userId));
  const domain = orgDomain(me?.email);
  if (domain) {
    const [rows] = await db.query('SELECT id FROM users WHERE id <> ? AND LOWER(email) LIKE ?', [userId, `%@${domain.replace(/[\\%_]/g, '\\$&')}`]);
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

// Checks every id is someone this user may chat with / invite; returns the cleaned list
async function assertTeammates(userId, ids) {
  const clean = [...new Set((ids || []).map(Number).filter((x) => x && x !== userId))];
  if (!clean.length) return [];
  const allowed = new Set(await contactIds(userId));
  if (clean.some((id) => !allowed.has(id))) throw new HttpError(400, 'You can only chat with people from your organization or your spaces');
  return clean;
}

// ---- Delivery and read receipts (✓ sent, ✓✓ delivered, blue ✓✓ read) ----
// conversation_members keeps, per person, the newest message id delivered to them and read by them.
// Every change is pushed to all members as `dm:receipt`.
async function emitReceipt(convId, userId) {
  if (!io) return;
  const [[row]] = await db.query(
    'SELECT last_read_id, last_delivered_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, userId]);
  if (!row) return;
  io.to((await convMemberIds(convId)).map(userRoom)).emit('dm:receipt', {
    conversationId: Number(convId), userId, lastReadId: row.last_read_id, lastDeliveredId: row.last_delivered_id,
  });
}

// The user's app is open: everything sent to them so far counts as delivered
async function markAllDelivered(userId) {
  const [rows] = await db.query(
    `SELECT cm.conversation_id AS id, MAX(d.id) AS max_id FROM conversation_members cm
       JOIN direct_messages d ON d.conversation_id = cm.conversation_id
      WHERE cm.user_id = ? GROUP BY cm.conversation_id, cm.last_delivered_id
     HAVING MAX(d.id) > cm.last_delivered_id`, [userId]);
  for (const r of rows) {
    await db.query('UPDATE conversation_members SET last_delivered_id = GREATEST(last_delivered_id, ?) WHERE conversation_id = ? AND user_id = ?',
      [r.max_id, r.id, userId]);
    await emitReceipt(r.id, userId);
  }
}

async function markRead(convId, userId, lastId) {
  const id = Number(lastId) || 0;
  const [r] = await db.query(
    `UPDATE conversation_members SET last_read_id = GREATEST(last_read_id, ?), last_delivered_id = GREATEST(last_delivered_id, ?)
      WHERE conversation_id = ? AND user_id = ? AND (last_read_id < ? OR last_delivered_id < ?)`,
    [id, id, convId, userId, id, id]);
  if (r.affectedRows) await emitReceipt(convId, userId);
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
  await db.query('UPDATE conversation_members SET last_read_id = ?, last_delivered_id = ? WHERE conversation_id = ? AND user_id = ?',
    [r.insertId, r.insertId, convId, userId]);
  const [[row]] = await db.query(
    `SELECT d.*, u.name, u.avatar_url FROM direct_messages d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, [r.insertId]);
  const msg = dmOut(row);
  const memberIds = await convMemberIds(convId);
  if (io) io.to(memberIds.map(userRoom)).emit('dm:message', msg);
  // Members with the app open receive it right away: ✓✓ delivered
  for (const uid of memberIds) {
    if (uid === userId || !presence.isOnline(uid)) continue;
    await db.query('UPDATE conversation_members SET last_delivered_id = GREATEST(last_delivered_id, ?) WHERE conversation_id = ? AND user_id = ?',
      [r.insertId, convId, uid]);
    await emitReceipt(convId, uid);
  }
  return msg;
}

// ---- Space chat: @mentions and replies ----
// A mention is stored in the message text as @[Name](userId). The server only keeps mentions of
// people in the space and always rewrites the label to their real name, so nobody can fake one.
const MENTION_RE = /@\[([^\]\n]{1,100})\]\((\d+)\)/g;
const plainMentions = (text) => String(text || '').replace(MENTION_RE, '@$1');

async function cleanMentions(spaceId, text) {
  if (!text.includes('@[')) return text;
  const ids = [...new Set([...text.matchAll(MENTION_RE)].map((m) => Number(m[2])))];
  if (!ids.length) return text;
  const [rows] = await db.query(
    `SELECT u.id, u.name FROM space_members m JOIN users u ON u.id = m.user_id WHERE m.space_id = ? AND u.id IN (?)`,
    [spaceId, ids]);
  const names = new Map(rows.map((r) => [r.id, String(r.name).replace(/[[\]\n]/g, '')]));
  return text.replace(MENTION_RE, (all, label, id) => (names.has(Number(id)) ? `@[${names.get(Number(id))}](${id})` : `@${label}`));
}

// Short one-line text shown in the quoted block of a reply
function replyPreview(kind, body) {
  const parse = () => { try { return JSON.parse(body) || {}; } catch { return {}; } };
  if (kind === 'file') { const f = parse(); return `📎 ${f.caption ? plainMentions(f.caption) : f.name || 'File'}`; }
  if (kind === 'meeting') return `📅 ${parse().title || 'Meeting'}`;
  if (kind === 'huddle') return '🎧 Huddle';
  return plainMentions(body);
}

// Columns + joins shared by history and newly posted messages
const SPACE_MSG_SELECT = `SELECT m.id, m.space_id, m.kind, m.body, m.created_at, m.reply_to_id, u.id AS user_id, u.name, u.avatar_url,
       r.kind AS r_kind, r.body AS r_body, r.user_id AS r_user_id, ru.name AS r_name
  FROM messages m JOIN users u ON u.id = m.user_id
  LEFT JOIN messages r ON r.id = m.reply_to_id AND r.space_id = m.space_id
  LEFT JOIN users ru ON ru.id = r.user_id`;

const spaceMsgOut = (m) => ({
  id: m.id, spaceId: m.space_id, kind: m.kind || 'text', body: m.body, created_at: m.created_at,
  user_id: m.user_id, name: m.name, avatar_url: m.avatar_url,
  reply_to: m.reply_to_id && m.r_kind
    ? { id: m.reply_to_id, user_id: m.r_user_id, name: m.r_name, kind: m.r_kind, preview: replyPreview(m.r_kind, m.r_body).slice(0, 200) }
    : m.reply_to_id ? { id: m.reply_to_id, deleted: true } : null,
});

// Insert a message into a space chat and push it to everyone viewing the space.
// opts.replyToId: the message being replied to (must be in the same space).
async function postSpaceMessage(spaceId, userId, body, kind = 'text', opts = {}) {
  let text = String(body || '').trim();
  if (!text) throw new HttpError(400, 'Message cannot be empty');
  if (kind === 'text') text = await cleanMentions(spaceId, text.slice(0, 8000));
  let replyTo = null;
  if (opts.replyToId) {
    const [[r]] = await db.query('SELECT id FROM messages WHERE id = ? AND space_id = ?', [Number(opts.replyToId), spaceId]);
    if (!r) throw new HttpError(400, 'The message you replied to no longer exists');
    replyTo = r.id;
  }
  const [r] = await db.query('INSERT INTO messages (space_id, user_id, kind, body, reply_to_id) VALUES (?, ?, ?, ?, ?)',
    [spaceId, userId, kind, text.slice(0, 8000), replyTo]);
  const [[row]] = await db.query(`${SPACE_MSG_SELECT} WHERE m.id = ?`, [r.insertId]);
  const msg = spaceMsgOut(row);
  if (io) io.to(`space:${spaceId}`).emit('chat:message', msg);
  return msg;
}

module.exports = {
  setIo, getIo, userRoom, teammateIds, contactIds, assertTeammates, convMemberIds, spaceMemberIds,
  emitReceipt, markAllDelivered, markRead,
  assertConvMember, postDirectMessage, postSpaceMessage, dmOut, spaceMsgOut, SPACE_MSG_SELECT, cleanMentions,
};
