// Shared file-upload plumbing for chat attachments and task attachments.
// Files are stored on disk (UPLOAD_DIR) under random names; the database keeps the real name and type.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('./access');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 20;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Only these are ever shown inline (as images). Everything else is always a download.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const MAX_FILES = 10;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(20).toString('hex')),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: MAX_FILES, fields: 10 },
  defParamCharset: 'utf8', // keep non-English file names intact
});

// Keep just the file name: no folders, no control characters, sane length
function cleanName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'file').slice(0, 255);
}

const cleanMime = (m) => String(m || 'application/octet-stream').slice(0, 150);

// Delete stored files (by full path or stored name); missing files are ignored
function removeFiles(list) {
  for (const p of list || []) if (p) fs.unlink(path.isAbsolute(p) ? p : path.join(UPLOAD_DIR, p), () => {});
}

const multerError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') return new HttpError(413, `Files can be up to ${MAX_MB} MB`);
  if (err.code === 'LIMIT_FILE_COUNT') return new HttpError(400, `You can attach up to ${MAX_FILES} files at once`);
  if (err instanceof multer.MulterError) return new HttpError(400, 'Upload failed: ' + err.message);
  return err;
};

// Express middleware: one file in field "file" / up to MAX_FILES in field "files".
// Requests that aren't multipart pass straight through (so JSON clients keep working).
const receiveOne = (req, res, next) => upload.single('file')(req, res, (err) => next(err && multerError(err)));
const receiveMany = (req, res, next) => upload.array('files', MAX_FILES)(req, res, (err) => next(err && multerError(err)));

// Send a stored file. Images may be shown inline with ?inline=1; everything else downloads.
function sendStored(req, res, att) {
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
  return res.download(filePath, att.original_name); // Content-Disposition: attachment
}

module.exports = { UPLOAD_DIR, MAX_MB, MAX_FILES, INLINE_TYPES, cleanName, cleanMime, removeFiles, receiveOne, receiveMany, sendStored };
