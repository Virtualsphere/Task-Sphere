// Huddles: live audio/video calls for a space, a group chat or a 1:1 chat.
// The server only does signaling (who is in the call + relaying WebRTC offers/answers/ICE).
// Media flows peer-to-peer (mesh). State is in memory; one server instance is assumed.
const db = require('./db');
const { getRole } = require('./access');
const svc = require('./chatService');

const MAX = Number(process.env.HUDDLE_MAX || 8);
const huddles = new Map(); // key -> huddle
let nextId = 1;

const keyOf = (scope, id) => `${scope}:${Number(id)}`;

function iceServers() {
  const list = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return list;
}

async function authorize(scope, id, userId) {
  if (scope === 'space') return !!(await getRole(Number(id), userId));
  if (scope === 'conv') {
    const [[r]] = await db.query('SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [id, userId]);
    return !!r;
  }
  return false;
}

async function audienceIds(scope, id) {
  return scope === 'space' ? svc.spaceMemberIds(id) : svc.convMemberIds(id);
}

// Name shown on the call for a given viewer
async function titleFor(scope, id, startedByName) {
  if (scope === 'space') {
    const [[s]] = await db.query('SELECT name FROM spaces WHERE id = ?', [id]);
    return { title: s?.name || 'Space', type: 'space' };
  }
  const [[c]] = await db.query('SELECT type, name FROM conversations WHERE id = ?', [id]);
  if (c?.type === 'group') {
    if (c.name) return { title: c.name, type: 'group' };
    const [m] = await db.query(
      'SELECT u.name FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ? ORDER BY u.name LIMIT 4', [id]);
    return { title: m.map((x) => x.name.split(' ')[0]).join(', '), type: 'group' };
  }
  return { title: startedByName, type: 'direct' };
}

const publicParticipant = (p) => ({
  socketId: p.socketId, userId: p.userId, name: p.name, avatar_url: p.avatar_url,
  audio: p.audio, video: p.video, screen: p.screen, joinedAt: p.joinedAt,
});

function summary(h) {
  return {
    key: h.key, scope: h.scope, scopeId: h.scopeId, id: h.id, active: true, title: h.title, type: h.type,
    startedBy: h.startedBy, startedAt: h.startedAt, participants: [...h.participants.values()].map(publicParticipant),
  };
}

async function broadcastState(io, h, scope, scopeId, key) {
  const ids = await audienceIds(scope, scopeId);
  const payload = h ? summary(h) : { key, scope, scopeId, active: false, participants: [] };
  io.to(ids.map(svc.userRoom)).emit('huddle:state', payload);
}

async function postEvent(scope, scopeId, userId, body) {
  const text = JSON.stringify(body);
  if (scope === 'space') await svc.postSpaceMessage(scopeId, userId, text, 'huddle');
  else await svc.postDirectMessage(scopeId, userId, text, 'huddle');
}

async function leave(io, socket, reason = 'left') {
  const key = socket.data.huddleKey;
  if (!key) return;
  socket.data.huddleKey = null;
  const h = huddles.get(key);
  socket.leave(`huddle:${key}`);
  if (!h) return;
  h.participants.delete(socket.id);
  io.to(`huddle:${key}`).emit('huddle:peer-left', { socketId: socket.id, reason });
  if (h.participants.size === 0) {
    huddles.delete(key);
    const minutes = Math.max(1, Math.round((Date.now() - h.startedAt) / 60000));
    await postEvent(h.scope, h.scopeId, h.startedBy.id, { event: 'ended', minutes, peak: h.peak }).catch(() => {});
    await broadcastState(io, null, h.scope, h.scopeId, key);
  } else {
    await broadcastState(io, h, h.scope, h.scopeId, key);
  }
}

function register(io, socket) {
  // Current huddle (if any) for a space or conversation
  socket.on('huddle:status', async ({ scope, id } = {}, ack) => {
    if (!(await authorize(scope, id, socket.user.id).catch(() => false))) return ack?.({ error: 'Not allowed' });
    const h = huddles.get(keyOf(scope, id));
    ack?.({ huddle: h ? summary(h) : null });
  });

  socket.on('huddle:join', async ({ scope, id } = {}, ack) => {
    try {
      if (!['space', 'conv'].includes(scope) || !(await authorize(scope, id, socket.user.id))) {
        return ack?.({ error: 'You are not a member here' });
      }
      const key = keyOf(scope, id);
      if (socket.data.huddleKey === key) return ack?.({ error: 'Already in this huddle' });
      if (socket.data.huddleKey) await leave(io, socket, 'switched');

      const [[u]] = await db.query('SELECT id, name, avatar_url FROM users WHERE id = ?', [socket.user.id]);
      let h = huddles.get(key);
      const isNew = !h;
      if (!h) {
        const t = await titleFor(scope, id, u.name);
        h = { id: nextId++, key, scope, scopeId: Number(id), startedBy: { id: u.id, name: u.name }, startedAt: Date.now(),
          participants: new Map(), title: t.title, type: t.type, peak: 0 };
        huddles.set(key, h);
      }
      // Same person joining from another tab/device replaces the old connection
      for (const p of h.participants.values()) {
        if (p.userId === u.id) {
          const old = io.sockets.sockets.get(p.socketId);
          if (old) { old.emit('huddle:ended-here', { reason: 'Joined from another window' }); await leave(io, old, 'replaced'); }
        }
      }
      if (h.participants.size >= MAX) return ack?.({ error: `Huddle is full (max ${MAX} people)` });

      const peers = [...h.participants.values()].map(publicParticipant);
      const me = { socketId: socket.id, userId: u.id, name: u.name, avatar_url: u.avatar_url, audio: true, video: false, screen: false, joinedAt: Date.now() };
      h.participants.set(socket.id, me);
      h.peak = Math.max(h.peak, h.participants.size);
      socket.data.huddleKey = key;
      socket.join(`huddle:${key}`);
      socket.to(`huddle:${key}`).emit('huddle:peer-joined', publicParticipant(me));

      ack?.({ ok: true, huddle: summary(h), peers, iceServers: iceServers() });

      await broadcastState(io, h, scope, id, key);
      if (isNew) {
        // Ring everyone else who can join
        const ids = (await audienceIds(scope, id)).filter((x) => x !== u.id);
        for (const uid of ids) {
          const t = h.type === 'direct' ? u.name : h.title;
          io.to(svc.userRoom(uid)).emit('huddle:ring', { huddle: summary(h), title: t, from: { id: u.id, name: u.name, avatar_url: u.avatar_url } });
        }
        await postEvent(scope, Number(id), u.id, { event: 'started' }).catch(() => {});
      }
    } catch (e) {
      console.error(e);
      ack?.({ error: 'Could not join huddle' });
    }
  });

  // Relay WebRTC signaling between two people in the same huddle
  socket.on('huddle:signal', ({ to, data } = {}) => {
    const h = huddles.get(socket.data.huddleKey);
    if (!h || !h.participants.has(to) || !h.participants.has(socket.id)) return;
    io.to(to).emit('huddle:signal', { from: socket.id, data });
  });

  // Mic / camera / screen-share state
  socket.on('huddle:media', async (state = {}) => {
    const h = huddles.get(socket.data.huddleKey);
    const p = h?.participants.get(socket.id);
    if (!p) return;
    for (const k of ['audio', 'video', 'screen']) if (typeof state[k] === 'boolean') p[k] = state[k];
    io.to(`huddle:${h.key}`).emit('huddle:media', publicParticipant(p));
    await broadcastState(io, h, h.scope, h.scopeId, h.key);
  });

  socket.on('huddle:leave', async (_, ack) => { await leave(io, socket); ack?.({ ok: true }); });
  socket.on('disconnect', () => { leave(io, socket, 'disconnected'); });
}

// Remove a user from a space's huddle (used when they are removed from the space)
async function kickUser(io, scope, scopeId, userId) {
  const h = huddles.get(keyOf(scope, scopeId));
  if (!h) return;
  for (const p of [...h.participants.values()]) {
    if (p.userId === userId) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.emit('huddle:ended-here', { reason: 'You were removed from this space' }); await leave(io, s, 'removed'); }
    }
  }
}

module.exports = { register, kickUser, iceServers, _huddles: huddles };
