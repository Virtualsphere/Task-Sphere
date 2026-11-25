// Huddles: live audio/video calls for a space, a group chat or a 1:1 chat.
// The server only does signaling (who is in the call + relaying WebRTC offers/answers/ICE).
// Media flows peer-to-peer (mesh). State is in memory; one server instance is assumed.
// Anyone in a call can add more people to it (huddle:invite). Invited guests may join that one live call;
// they don't become members of the chat or space and can't read its messages.
const db = require('./db');
const { getRole } = require('./access');
const svc = require('./chatService');
const alerts = require('./alerts');

const MAX = Number(process.env.HUDDLE_MAX || 8);
// An incoming huddle keeps ringing for RING_TICK_MS x RING_TICKS (about 48 s) for people who haven't joined
const RING_TICK_MS = 4000;
const RING_TICKS = 12;
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

// Everyone who may see and join this call: members of the chat/space plus invited guests
async function callIds(h) {
  return [...new Set([...(await audienceIds(h.scope, h.scopeId)), ...h.invited])];
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

async function broadcastState(io, h) {
  const ids = await callIds(h);
  const live = huddles.get(h.key) === h;
  const payload = live ? summary(h) : { key: h.key, scope: h.scope, scopeId: h.scopeId, active: false, participants: [] };
  io.to(ids.map(svc.userRoom)).emit('huddle:state', payload);
}

// Where clicking the call takes someone. Guests can't open the chat itself, so they land on Messages.
const memberPath = (h) => (h.scope === 'space' ? `/spaces/${h.scopeId}?huddle=1` : `/messages/${h.scopeId}?huddle=1`);
const guestPath = (h) => `/messages?huddle=${h.scope}-${h.scopeId}`;

// Ring people, and keep ringing every few seconds until they join (or about 48 s have passed). Socket messages
// are not slowed down in background tabs (timers are), so the desktop notification sounds again each time.
function ring(io, h, ids, from, { title, path, invited = false }) {
  if (huddles.get(h.key) !== h) return; // ended in the meantime
  for (const uid of ids) {
    h.ringing.add(uid);
    // In the app: ringtone + desktop notification (see client HuddleContext / notifications)
    io.to(svc.userRoom(uid)).emit('huddle:ring', { huddle: summary(h), title, path: path(uid), from, invited });
  }
  let ticks = 0;
  const stop = () => { clearInterval(timer); h.ringTimers.delete(timer); ids.forEach((uid) => h.ringing.delete(uid)); };
  const timer = setInterval(() => {
    ticks += 1;
    if (huddles.get(h.key) !== h || ticks > RING_TICKS) return stop();
    const inCall = new Set([...h.participants.values()].map((p) => p.userId));
    const waiting = ids.filter((uid) => !inCall.has(uid));
    if (!waiting.length) return stop();
    io.to(waiting.map(svc.userRoom)).emit('huddle:ring-tick', { key: h.key, n: ticks });
  }, RING_TICK_MS);
  h.ringTimers.add(timer);
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
    h.ringTimers.forEach((t) => clearInterval(t));
    const minutes = Math.max(1, Math.round((Date.now() - h.startedAt) / 60000));
    await postEvent(h.scope, h.scopeId, h.startedBy.id, { event: 'ended', minutes, peak: h.peak }).catch(() => {});
  }
  await broadcastState(io, h);
}

function register(io, socket) {
  // Current huddle (if any) for a space or conversation
  socket.on('huddle:status', async ({ scope, id } = {}, ack) => {
    const member = await authorize(scope, id, socket.user.id).catch(() => false);
    const h = huddles.get(keyOf(scope, id));
    if (!member && !h?.invited.has(socket.user.id)) return ack?.({ error: 'Not allowed' });
    ack?.({ huddle: h ? summary(h) : null });
  });

  socket.on('huddle:join', async ({ scope, id } = {}, ack) => {
    try {
      const key = keyOf(scope, id);
      const member = ['space', 'conv'].includes(scope) && await authorize(scope, id, socket.user.id);
      if (!member && !huddles.get(key)?.invited.has(socket.user.id)) {
        return ack?.({ error: 'You are not a member here, or the huddle has ended' });
      }
      if (socket.data.huddleKey === key) return ack?.({ error: 'Already in this huddle' });
      if (socket.data.huddleKey) await leave(io, socket, 'switched');

      const [[u]] = await db.query('SELECT id, name, avatar_url FROM users WHERE id = ?', [socket.user.id]);
      let h = huddles.get(key);
      // A guest can only join the call they were invited to, never start a new one
      if (!member && !h?.invited.has(u.id)) return ack?.({ error: 'That huddle has already ended' });
      const isNew = !h;
      if (!h) {
        const t = await titleFor(scope, id, u.name);
        h = { id: nextId++, key, scope, scopeId: Number(id), startedBy: { id: u.id, name: u.name }, startedAt: Date.now(),
          participants: new Map(), title: t.title, type: t.type, peak: 0,
          invited: new Set(), ringing: new Set(), ringTimers: new Set() };
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
      h.ringing.delete(u.id); // answered; can be called again if they leave
      socket.data.huddleKey = key;
      socket.join(`huddle:${key}`);
      socket.to(`huddle:${key}`).emit('huddle:peer-joined', publicParticipant(me));

      ack?.({ ok: true, huddle: summary(h), peers, iceServers: iceServers() });

      await broadcastState(io, h);
      if (isNew) {
        // Ring everyone else who can join
        const ids = (await audienceIds(scope, id)).filter((x) => x !== u.id);
        ring(io, h, ids, { id: u.id, name: u.name, avatar_url: u.avatar_url },
          { title: h.type === 'direct' ? u.name : h.title, path: () => memberPath(h) });
        // By email, for people who don't have the app open (once per 10 min per chat/space)
        alerts.huddleStarted({ scope, scopeId: Number(id), starterId: u.id, title: h.title, type: h.type, recipientIds: ids });
        await postEvent(scope, Number(id), u.id, { event: 'started' }).catch(() => {});
      }
    } catch (e) {
      console.error(e);
      ack?.({ error: 'Could not join huddle' });
    }
  });

  // Add people to the call I'm in. They are rung like any other call.
  socket.on('huddle:invite', async ({ userIds } = {}, ack) => {
    try {
      const h = huddles.get(socket.data.huddleKey);
      const me = h?.participants.get(socket.id);
      if (!me) return ack?.({ error: 'You are not in a huddle' });
      // Same rule as chats: people from my organization or my spaces
      const asked = await svc.assertTeammates(me.userId, Array.isArray(userIds) ? userIds.slice(0, 50) : []);
      const members = new Set(await audienceIds(h.scope, h.scopeId));
      if (huddles.get(h.key) !== h) return ack?.({ error: 'The huddle has ended' });
      const inCall = new Set([...h.participants.values()].map((p) => p.userId));
      const ids = asked.filter((uid) => !inCall.has(uid) && !h.ringing.has(uid)); // already here / already ringing
      if (!ids.length) return ack?.({ error: asked.length ? 'They are already in the call or being called' : 'Choose someone to add' });
      const free = MAX - h.participants.size;
      if (ids.length > free) {
        return ack?.({ error: free > 0 ? `Only ${free} more can join (max ${MAX} people)` : `Huddle is full (max ${MAX} people)` });
      }
      for (const uid of ids) if (!members.has(uid)) h.invited.add(uid);
      const path = (uid) => (members.has(uid) ? memberPath(h) : guestPath(h));
      ring(io, h, ids, { id: me.userId, name: me.name, avatar_url: me.avatar_url },
        { title: h.type === 'direct' ? me.name : h.title, path, invited: true });
      ack?.({ ok: true, invited: ids });
      await broadcastState(io, h);
      for (const uid of ids) {
        alerts.huddleStarted({ scope: h.scope, scopeId: h.scopeId, starterId: me.userId, title: h.title, type: h.type,
          recipientIds: [uid], path: path(uid), invited: true });
      }
    } catch (e) {
      if (!e.status) console.error(e);
      ack?.({ error: e.status ? e.message : 'Could not add people' });
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
    await broadcastState(io, h);
  });

  socket.on('huddle:leave', async (_, ack) => { await leave(io, socket); ack?.({ ok: true }); });
  socket.on('disconnect', () => { leave(io, socket, 'disconnected'); });
}

// Remove a user from a space's huddle (used when they are removed from the space)
async function kickUser(io, scope, scopeId, userId) {
  const h = huddles.get(keyOf(scope, scopeId));
  if (!h) return;
  h.invited.delete(userId);
  for (const p of [...h.participants.values()]) {
    if (p.userId === userId) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.emit('huddle:ended-here', { reason: 'You were removed from this space' }); await leave(io, s, 'removed'); }
    }
  }
}

module.exports = { register, kickUser, iceServers, _huddles: huddles };
