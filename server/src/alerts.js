// Notifications for people who aren't looking at the app right now:
//  - a huddle started that they can join  -> email (the live ring is sent by huddles.js)
//  - they were @mentioned (space chat, task comment, personal chat) -> email + `notify:mention` socket event
// Everything here is fire-and-forget: callers don't await it, and nothing here throws.
const db = require('./db');
const mailer = require('./mailer');

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
 * A huddle just started. Emails everyone who can join (except the starter).
 * scope 'space' | 'conv'; type 'space' | 'group' | 'direct'; title = space / group name.
 */
async function huddleStarted({ scope, scopeId, starterId, title, type, recipientIds }) {
  try {
    if (!mailer.mailEnabled) return;
    const [[starter]] = await db.query('SELECT id, name, email FROM users WHERE id = ?', [starterId]);
    if (!starter) return;
    const key = `${scope}:${scopeId}`;
    const now = Date.now();
    const path = scope === 'space' ? `/spaces/${scopeId}?huddle=1` : `/messages/${scopeId}?huddle=1`;
    const where = scope === 'space' ? `the space “${title}”` : type === 'group' ? `the group chat “${title}”` : 'a 1:1 chat';
    const people = await usersByIds(recipientIds.filter((id) => id !== starterId));
    for (const u of people) {
      const k = `${u.id}|${key}`;
      if (now - (lastHuddleEmail.get(k) || 0) < HUDDLE_EMAIL_GAP_MS) continue;
      lastHuddleEmail.set(k, now);
      mailer.sendHuddleStarted({
        to: u.email, starterName: starter.name, starterEmail: starter.email, where, direct: type === 'direct', path,
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
async function mentioned({ text, fromId, where, path, tag }) {
  try {
    const ids = mentionedIds(text).filter((id) => id !== fromId);
    if (!ids.length) return;
    const [[from]] = await db.query('SELECT id, name, email, avatar_url FROM users WHERE id = ?', [fromId]);
    if (!from) return;
    const snippet = plain(text).slice(0, 400);
    const io = getIo();
    for (const u of await usersByIds(ids)) {
      io?.to(userRoom(u.id)).emit('notify:mention', {
        title: `${from.name} mentioned you`, body: snippet, where, path, tag,
        from: { id: from.id, name: from.name, avatar_url: from.avatar_url },
      });
      mailer.sendMention({ to: u.email, fromName: from.name, fromEmail: from.email, where, snippet, path });
    }
  } catch (e) {
    console.error('Mention notification failed:', e.message);
  }
}

module.exports = { init, huddleStarted, mentioned, mentionedIds };
