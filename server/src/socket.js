// Real-time: space chat, personal chats, presence, huddles, "something changed" notifications
const { verifyToken, getRole } = require('./access');
const svc = require('./chatService');
const presence = require('./presence');
const huddles = require('./huddles');

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
    if (presence.connect(uid)) {
      const mates = await svc.teammateIds(uid).catch(() => []);
      io.to(mates.map(svc.userRoom)).emit('presence', { userId: uid, online: true });
    }
    socket.on('disconnect', async () => {
      if (presence.disconnect(uid)) {
        const mates = await svc.teammateIds(uid).catch(() => []);
        io.to(mates.map(svc.userRoom)).emit('presence', { userId: uid, online: false });
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

    socket.on('chat:send', async ({ spaceId, body } = {}, ack) => {
      try {
        // Re-check membership on every message so removed members can't keep posting
        if (!(await getRole(Number(spaceId), uid))) return ack?.({ error: 'Not a member of this space' });
        await svc.postSpaceMessage(Number(spaceId), uid, body);
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
    socket.on('dm:send', async ({ conversationId, body } = {}, ack) => {
      try {
        await svc.assertConvMember(Number(conversationId), uid);
        await svc.postDirectMessage(Number(conversationId), uid, body);
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
  });

  // When someone is removed from a space, kick their sockets out of the room and its huddle
  io.kickFromSpace = (spaceId, userId) => {
    io.in(svc.userRoom(userId)).socketsLeave(`space:${spaceId}`);
    huddles.kickUser(io, 'space', spaceId, userId);
  };
};
