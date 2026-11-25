// Real-time: space chat, personal chats, presence, huddles, "something changed" notifications
const { verifyToken, getRole } = require('./access');
const svc = require('./chatService');
const presence = require('./presence');
const huddles = require('./huddles');
const db = require('./db');

module.exports = function setupSocket(io) {
  svc.setIo(io);

  io.use((socket, next) => {
    try {
      socket.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.user.id;
    socket.join(svc.userRoom(uid)); // personal room: DMs, rings, presence, meeting invites
    // Register the disconnect handler first, so a quick disconnect during the awaits below isn't missed
    socket.on('disconnect', async () => {
      if (presence.disconnect(uid)) {
        // Went offline: remember when, and tell everyone who can chat with them
        await db.query('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [uid]).catch(() => {});
        const [[row]] = await db.query('SELECT last_seen_at FROM users WHERE id = ?', [uid]).catch(() => [[]]);
        const contacts = await svc.contactIds(uid).catch(() => []);
        io.to(contacts.map(svc.userRoom)).emit('presence', { userId: uid, online: false, last_seen_at: row?.last_seen_at || null });
      }
    });
    // ---- Space chat ----
    socket.on('space:join', async ({ spaceId } = {}, ack) => {
      const role = await getRole(Number(spaceId), uid).catch(() => null);
      if (!role) return ack?.({ error: 'Not a member of this space' });
      for (const room of socket.rooms) if (room.startsWith('space:')) socket.leave(room);
      socket.join(`space:${spaceId}`);
      ack?.({ ok: true, role });
    });

    socket.on('chat:send', async ({ spaceId, body, replyTo } = {}, ack) => {
      try {
        // Re-check membership on every message so removed members can't keep posting
        if (!(await getRole(Number(spaceId), uid))) return ack?.({ error: 'Not a member of this space' });
        await svc.postSpaceMessage(Number(spaceId), uid, body, 'text', { replyToId: replyTo });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ error: e.status ? e.message : 'Could not send message' });
      }
    });

    socket.on('chat:typing', ({ spaceId } = {}) => {
      if (socket.rooms.has(`space:${spaceId}`)) {
        socket.to(`space:${spaceId}`).emit('chat:typing', { userId: uid, name: socket.user.name });
      }
    });

    // ---- Personal / group chats ----
    socket.on('dm:send', async ({ conversationId, body, replyTo } = {}, ack) => {
      try {
        await svc.assertConvMember(Number(conversationId), uid);
        await svc.postDirectMessage(Number(conversationId), uid, body, 'text', { replyToId: replyTo });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ error: e.status ? e.message : 'Could not send message' });
      }
    });

    socket.on('dm:typing', async ({ conversationId } = {}) => {
      try {
        await svc.assertConvMember(Number(conversationId), uid);
        const ids = (await svc.convMemberIds(conversationId)).filter((x) => x !== uid);
        io.to(ids.map(svc.userRoom)).emit('dm:typing', { conversationId: Number(conversationId), userId: uid, name: socket.user.name });
      } catch { /* ignore */ }
    });

    // ---- Huddles ----
    huddles.register(io, socket);

    // Last, because it waits for the database: handlers must already be attached by then, or anything the
    // page sends right after connecting (e.g. opening a "Join the huddle" link) would be lost
    if (presence.connect(uid)) {
      await db.query('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [uid]).catch(() => {});
      const contacts = await svc.contactIds(uid).catch(() => []);
      io.to(contacts.map(svc.userRoom)).emit('presence', { userId: uid, online: true });
    }
    // Messages that arrived while they were away are now delivered (✓✓)
    svc.markAllDelivered(uid).catch(() => {});
  });

  // When someone is removed from a space, kick their sockets out of the room and its huddle
  io.kickFromSpace = (spaceId, userId) => {
    io.in(svc.userRoom(userId)).socketsLeave(`space:${spaceId}`);
    huddles.kickUser(io, 'space', spaceId, userId);
  };
};
