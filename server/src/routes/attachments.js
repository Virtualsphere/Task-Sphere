// File attachments in chats: 1:1 / group conversations and space chats.
// Files are stored on disk (UPLOAD_DIR) under random names; only people who can see the chat can download them.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { ah, assertRole, HttpError } = require('../access');
const svc = require('../chatService');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 20;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only these are ever shown inline (as images). Everything else is always a download.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(20).toString('hex')),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1, fields: 5 },
  defParamCharset: 'utf8', // keep non-English file names intact
});

// Keep just the file name: no folders, no control characters, sane length
function cleanName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'file').slice(0, 255);
}

const removeFile = (p) => p && fs.unlink(p, () => {});

const receiveFile = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Files can be up to ${MAX_MB} MB`));
  if (err instanceof multer.MulterError) return next(new HttpError(400, 'Upload failed: ' + err.message));
  next(err);
});

// Shared upload flow. `target` is { conversationId } or { spaceId }; access is checked
// BEFORE any bytes are accepted, and the file is removed again if anything fails afterwards.
function uploadRoute(getTarget, checkAccess, post) {
  return [
    ah(async (req, res, next) => { await checkAccess(getTarget(req), req.user.id); next(); }),
    receiveFile,
    ah(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to send');
      const t = getTarget(req);
      const name = cleanName(req.file.originalname);
      const mime = String(req.file.mimetype || 'application/octet-stream').slice(0, 150);
      try {
        const [r] = await db.query(
          `INSERT INTO chat_attachments (conversation_id, space_id, user_id, stored_name, original_name, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [t.conversationId || null, t.spaceId || null, req.user.id, req.file.filename, name, mime, req.file.size]);
        const caption = String(req.body.caption || '').trim().slice(0, 2000);
        const body = JSON.stringify({ id: r.insertId, name, size: req.file.size, mime, ...(caption && { caption }) });
        res.status(201).json(await post(t, req.user.id, body));
      } catch (e) {
        removeFile(req.file.path);
        throw e;
      }
    }),
  ];
}

// POST /api/conversations/:id/attachments  (multipart: file, optional caption) — conversation members
router.post('/conversations/:id/attachments', ...uploadRoute(
  (req) => ({ conversationId: Number(req.params.id) }),
  (t, uid) => svc.assertConvMember(t.conversationId, uid),
  (t, uid, body) => svc.postDirectMessage(t.conversationId, uid, body, 'file'),
));

// POST /api/spaces/:spaceId/attachments — any space member (viewers can chat too)
router.post('/spaces/:spaceId/attachments', ...uploadRoute(
  (req) => ({ spaceId: Number(req.params.spaceId) }),
  (t, uid) => assertRole(t.spaceId, uid, 'viewer'),
  (t, uid, body) => svc.postSpaceMessage(t.spaceId, uid, body, 'file'),
));

// GET /api/attachments/:id[?inline=1] — only people who can see that chat
router.get('/attachments/:id', ah(async (req, res) => {
  const [[att]] = await db.query('SELECT * FROM chat_attachments WHERE id = ?', [Number(req.params.id)]);
  if (!att) throw new HttpError(404, 'File not found');
  // Both checks answer 404 for outsiders, so they can't tell whether a file exists
  if (att.conversation_id) await svc.assertConvMember(att.conversation_id, req.user.id);
  else if (att.space_id) await assertRole(att.space_id, req.user.id, 'viewer');
  else throw new HttpError(404, 'File not found');
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'This file is no longer available');

  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
  });
  if (req.query.inline === '1' && INLINE_TYPES.has(att.mime_type)) {
    res.type(att.mime_type);
    return res.sendFile(filePath, { headers: { 'Content-Disposition': 'inline' } });
  }
  res.download(filePath, att.original_name); // Content-Disposition: attachment
}));

module.exports = router;
module.exports.MAX_MB = MAX_MB;
