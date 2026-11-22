// File attachments in chats: 1:1 / group conversations and space chats.
// Files are stored on disk (UPLOAD_DIR) under random names; only people who can see the chat can download them.
const router = require('express').Router();
const db = require('../db');
const { ah, assertRole, HttpError } = require('../access');
const svc = require('../chatService');
const { MAX_MB, cleanName, cleanMime, removeFiles, receiveOne, sendStored } = require('../files');

// Shared upload flow. `target` is { conversationId } or { spaceId }; access is checked
// BEFORE any bytes are accepted, and the file is removed again if anything fails afterwards.
function uploadRoute(getTarget, checkAccess, post) {
  return [
    ah(async (req, res, next) => { await checkAccess(getTarget(req), req.user.id); next(); }),
    receiveOne,
    ah(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to send');
      const t = getTarget(req);
      const name = cleanName(req.file.originalname);
      const mime = cleanMime(req.file.mimetype);
      try {
        const [r] = await db.query(
          `INSERT INTO chat_attachments (conversation_id, space_id, user_id, stored_name, original_name, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [t.conversationId || null, t.spaceId || null, req.user.id, req.file.filename, name, mime, req.file.size]);
        let caption = String(req.body.caption || '').trim().slice(0, 2000);
        if (t.spaceId && caption) caption = await svc.cleanMentions(t.spaceId, caption);
        if (t.conversationId && caption) caption = await svc.cleanConvMentions(t.conversationId, caption);
        const body = JSON.stringify({ id: r.insertId, name, size: req.file.size, mime, ...(caption && { caption }) });
        res.status(201).json(await post(t, req.user.id, body, req));
      } catch (e) {
        removeFiles([req.file.path]);
        throw e;
      }
    }),
  ];
}

// POST /api/conversations/:id/attachments  (multipart: file, optional caption, optional replyTo) — conversation members
router.post('/conversations/:id/attachments', ...uploadRoute(
  (req) => ({ conversationId: Number(req.params.id) }),
  (t, uid) => svc.assertConvMember(t.conversationId, uid),
  (t, uid, body, req) => svc.postDirectMessage(t.conversationId, uid, body, 'file', { replyToId: Number(req.body.replyTo) || null }),
));

// POST /api/spaces/:spaceId/attachments (file, optional caption, optional replyTo) — any space member (viewers can chat too)
router.post('/spaces/:spaceId/attachments', ...uploadRoute(
  (req) => ({ spaceId: Number(req.params.spaceId) }),
  (t, uid) => assertRole(t.spaceId, uid, 'viewer'),
  (t, uid, body, req) => svc.postSpaceMessage(t.spaceId, uid, body, 'file', { replyToId: Number(req.body.replyTo) || null }),
));

// GET /api/attachments/:id[?inline=1] — only people who can see that chat
router.get('/attachments/:id', ah(async (req, res) => {
  const [[att]] = await db.query('SELECT * FROM chat_attachments WHERE id = ?', [Number(req.params.id)]);
  if (!att) throw new HttpError(404, 'File not found');
  // Both checks answer 404 for outsiders, so they can't tell whether a file exists
  if (att.conversation_id) await svc.assertConvMember(att.conversation_id, req.user.id);
  else if (att.space_id) await assertRole(att.space_id, req.user.id, 'viewer');
  else throw new HttpError(404, 'File not found');
  sendStored(req, res, att);
}));

module.exports = router;
module.exports.MAX_MB = MAX_MB;
