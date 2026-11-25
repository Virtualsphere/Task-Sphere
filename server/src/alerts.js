// Notifications:
//  - a huddle started that they can join  -> email (the live ring is sent by huddles.js)
//  - they were @mentioned or someone replied to them -> `notify:mention` socket event + email
//  - a personal message stayed unread for a minute -> email
// Emails only go to people who are OFFLINE (TaskSphere not open in any tab). People who are online get the
// in-app / desktop notification instead, so they aren't emailed about something they can already see.
// Everything here is fire-and-forget: callers don't await it, and nothing here throws.
const db = require('./db');
const mailer = require('./mailer');
const presence = require('./presence');

// Email only people who don't have the app open right now
const offline = (userId) => !presence.isOnline(userId);

const MENTION_RE = /@\[([^\]\n]{1,100})\]\((\d+)\)/g;
const plain = (text) => String(text || '').replace(MENTION_RE, '@$1');

// Ids of everyone @mentioned in a text (text must already be cleaned by the server)
const mentionedIds = (text) => [...new Set([...String(text || '').matchAll(MENTION_RE)].map((m) => Number(m[2])))];

async function usersByIds(ids) {
  if (!ids.length) return [];
  const [rows] = await db.query('SELECT id, name, email FROM users WHERE id IN (?)', [ids]);
  return rows;
}

let getIo = () => null;
let userRoom = (id) => `user:${id}`;
// chatService requires this module, so it hands over its socket helpers instead of a circular require
function init(svc) { getIo = svc.getIo; userRoom = svc.userRoom; }

// One huddle email per person per chat/space within this window, so restarting a call doesn't spam
const HUDDLE_EMAIL_GAP_MS = 10 * 60 * 1000;
const lastHuddleEmail = new Map(); // `${userId}|${key}` -> time

/**
 * A huddle just started, or (invited) people were added to a running one. Emails those who are offline.
 * scope 'space' | 'conv'; type 'space' | 'group' | 'direct'; title = space / group name.
 */
async function huddleStarted({ scope, scopeId, starterId, title, type, recipientIds, path: joinPath, invited = false }) {
  try {
    if (!mailer.mailEnabled) return;
    const [[starter]] = await db.query('SELECT id, name, email FROM users WHERE id = ?', [starterId]);
    if (!starter) return;
    const key = `${scope}:${scopeId}`;
    const now = Date.now();
    const path = joinPath || (scope === 'space' ? `/spaces/${scopeId}?huddle=1` : `/messages/${scopeId}?huddle=1`);
    const where = scope === 'space' ? `the space “${title}”` : type === 'group' ? `the group chat “${title}”` : 'a 1:1 chat';
    const people = await usersByIds(recipientIds.filter((id) => id !== starterId));
    for (const u of people) {
      if (!offline(u.id)) continue; // online: the call rings in the app instead
      const k = `${u.id}|${key}`;
      if (now - (lastHuddleEmail.get(k) || 0) < HUDDLE_EMAIL_GAP_MS) continue;
      lastHuddleEmail.set(k, now);
      mailer.sendHuddleStarted({
        to: u.email, starterName: starter.name, starterEmail: starter.email, where, direct: invited || type === 'direct', path,
      });
    }
  } catch (e) {
    console.error('Huddle notification failed:', e.message);
  }
}

/**
 * People were @mentioned. Emails them and pushes a live `notify:mention` (desktop notification in the app).
 * `where` is shown in the email and notification, `path` is where clicking takes them,
 * `tag` lets the browser merge duplicate notifications for the same message.
 */
// Returns the ids of the people notified
async function mentioned({ text, fromId, where, path, tag }) {
  try {
    const ids = mentionedIds(text).filter((id) => id !== fromId);
    if (!ids.length) return [];
    const [[from]] = await db.query('SELECT id, name, email, avatar_url FROM users WHERE id = ?', [fromId]);
    if (!from) return [];
    const snippet = plain(text).slice(0, 400);
    const io = getIo();
    const people = await usersByIds(ids);
    for (const u of people) {
      io?.to(userRoom(u.id)).emit('notify:mention', {
        title: `${from.name} mentioned you`, body: snippet, where, path, tag,
        from: { id: from.id, name: from.name, avatar_url: from.avatar_url },
      });
      if (offline(u.id)) mailer.sendMention({ to: u.email, fromName: from.name, fromEmail: from.email, where, snippet, path });
    }
    return people.map((u) => u.id);
  } catch (e) {
    console.error('Mention notification failed:', e.message);
    return [];
  }
}

/** Someone replied to `toUserId`'s message: email + desktop notification. */
async function replied({ toUserId, fromId, text, original, where, path, tag }) {
  try {
    if (!toUserId || toUserId === fromId) return;
    const [to] = await usersByIds([toUserId]);
    const [[from]] = await db.query('SELECT id, name, email, avatar_url FROM users WHERE id = ?', [fromId]);
    if (!to || !from) return;
    const snippet = plain(text).slice(0, 400);
    getIo()?.to(userRoom(to.id)).emit('notify:mention', {
      title: `${from.name} replied to you`, body: snippet, where, path, tag,
      from: { id: from.id, name: from.name, avatar_url: from.avatar_url },
    });
    if (offline(to.id)) mailer.sendReply({ to: to.email, fromName: from.name, fromEmail: from.email, where, snippet, original: plain(original), path });
  } catch (e) {
    console.error('Reply notification failed:', e.message);
  }
}

/**
 * A chat message was posted (space chat or personal chat): notify the people it's aimed at.
 * @mentioned people get a mention alert; the author of the message being replied to gets a reply alert
 * (unless they were also mentioned, so nobody gets two). Returns everyone notified.
 */
async function chatMessage({ text, fromId, where, path, tag, replyTo }) {
  const notified = text && text.includes('@[') ? await mentioned({ text, fromId, where, path, tag }) : [];
  if (replyTo && replyTo.user_id !== fromId && !notified.includes(replyTo.user_id)) {
    await replied({ toUserId: replyTo.user_id, fromId, text: text || '📎 File', original: replyTo.preview, where, path, tag });
    notified.push(replyTo.user_id);
  }
  return notified;
}

// ---- Email for personal messages that stay unread ----
// The desktop notification is instant. If the message is still unread after UNREAD_DELAY_MS and the person is
// offline by then, they get one email listing what they missed. At most one per person per chat every UNREAD_GAP_MS.
const UNREAD_DELAY_MS = 60 * 1000;
const UNREAD_GAP_MS = 10 * 60 * 1000;
const unreadPending = new Map(); // `${userId}|${convId}` -> timer
const unreadLastEmail = new Map(); // `${userId}|${convId}` -> time

function dmUnread({ convId, fromId, recipientIds, where }) {
  if (!mailer.mailEnabled) return;
  for (const uid of recipientIds) {
    if (uid === fromId) continue;
    const key = `${uid}|${convId}`;
    if (unreadPending.has(key)) continue; // a check is already scheduled; it will include this message
    unreadPending.set(key, setTimeout(() => {
      unreadPending.delete(key);
      sendUnreadEmail(uid, convId, where, key).catch((e) => console.error('Unread email failed:', e.message));
    }, UNREAD_DELAY_MS));
  }
}

async function sendUnreadEmail(uid, convId, where, key) {
  if (!offline(uid)) return; // they have the app open: the message shows there (and as a desktop notification)
  if (Date.now() - (unreadLastEmail.get(key) || 0) < UNREAD_GAP_MS) return;
  const [[m]] = await db.query('SELECT last_read_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [convId, uid]);
  if (!m) return; // left the chat
  const [rows] = await db.query(
    `SELECT d.kind, d.body, u.name FROM direct_messages d JOIN users u ON u.id = d.user_id
      WHERE d.conversation_id = ? AND d.id > ? AND d.user_id <> ? AND d.kind IN ('text','file','meeting')
      ORDER BY d.id DESC LIMIT 5`, [convId, m.last_read_id, uid]);
  if (!rows.length) return; // they read it in the meantime
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM direct_messages WHERE conversation_id = ? AND id > ? AND user_id <> ? AND kind IN ('text','file','meeting')`,
    [convId, m.last_read_id, uid]);
  const [[to]] = await db.query('SELECT email FROM users WHERE id = ?', [uid]);
  if (!to) return;
  const describe = (r) => {
    if (r.kind === 'meeting') { try { return `📅 Meeting: ${JSON.parse(r.body).title}`; } catch { return '📅 Meeting'; } }
    if (r.kind === 'file') { try { const f = JSON.parse(r.body); return `📎 ${f.name}${f.caption ? ` – ${plain(f.caption)}` : ''}`; } catch { return '📎 File'; } }
    return plain(r.body);
  };
  const messages = rows.reverse().map((r) => ({ name: r.name, text: describe(r).slice(0, 300) }));
  const senders = [...new Set(messages.map((x) => x.name))];
  unreadLastEmail.set(key, Date.now());
  await mailer.sendUnreadMessages({
    to: to.email, fromName: senders.length === 1 ? senders[0] : `${senders[0]} and others`, where, messages, total: Number(total), path: `/messages/${convId}`,
  });
}

module.exports = { init, huddleStarted, mentioned, replied, chatMessage, dmUnread, mentionedIds };
