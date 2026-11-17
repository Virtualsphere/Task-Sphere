const router = require('express').Router();
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { ah, signToken, requireAuth, HttpError } = require('../access');

const google = require('../google'); // used as google.exchangeCode(...) so tests can stub it

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Only accounts from the company Google Workspace domain may sign in (when ALLOWED_DOMAIN is set)
function assertDomain(payload) {
  const allowed = (process.env.ALLOWED_DOMAIN || '').trim().toLowerCase();
  if (allowed && (payload.hd || '').toLowerCase() !== allowed) {
    throw new HttpError(403, `Please sign in with your @${allowed} Google Workspace account`);
  }
}

// POST /api/auth/google  { credential }  — credential is the Google ID token from the browser
router.post('/google', ah(async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) throw new HttpError(400, 'Missing Google credential');

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified');
  }
  if (!payload.email_verified) throw new HttpError(401, 'Google email is not verified');

  assertDomain(payload);

  const user = await upsertUser({
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email,
    avatar: payload.picture || null,
  });
  res.json({ token: signToken(user), user });
}));

// POST /api/auth/google-code  { code }
// Google Workspace sign-in that also connects the user's Google Calendar in the same consent screen.
router.post('/google-code', ah(async (req, res) => {
  if (!req.body?.code) throw new HttpError(400, 'Missing Google authorization code');
  const { tokens, profile } = await google.exchangeCode(req.body.code);
  if (!profile?.email) throw new HttpError(401, 'Google sign-in could not be verified');
  if (!profile.email_verified) throw new HttpError(401, 'Google email is not verified');
  assertDomain(profile);
  const user = await upsertUser({
    googleId: profile.sub,
    email: profile.email.toLowerCase(),
    name: profile.name || profile.email,
    avatar: profile.picture || null,
  });
  // Calendar is optional at sign-in: if the person unticked calendar access they can still use the app
  const calendar = await google.saveTokens(user.id, user.email, tokens, { required: false });
  res.json({ token: signToken(user), user, calendar });
}));

// ---------- LOCAL TEST MODE: sign in as a test user without Google (DEV_LOGIN=true) ----------
const devLoginEnabled = () => process.env.DEV_LOGIN === 'true';

router.get('/dev-users', ah(async (req, res) => {
  if (!devLoginEnabled()) throw new HttpError(404, 'Not found');
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.avatar_url,
            (SELECT GROUP_CONCAT(CONCAT(s.name, ':', m.role) SEPARATOR '|') FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = u.id) AS roles
       FROM users u ORDER BY u.id`);
  res.json(rows.map((u) => ({ ...u, roles: (u.roles || '').split('|').filter(Boolean).map((r) => { const i = r.lastIndexOf(':'); return { space: r.slice(0, i), role: r.slice(i + 1) }; }) })));
}));

router.post('/dev', ah(async (req, res) => {
  if (!devLoginEnabled()) throw new HttpError(404, 'Not found');
  const [[user]] = await db.query('SELECT id, email, name, avatar_url FROM users WHERE email = ?', [String(req.body?.email || '').toLowerCase()]);
  if (!user) throw new HttpError(404, 'Unknown test user');
  res.json({ token: signToken(user), user });
}));

// GET /api/auth/me
router.get('/me', requireAuth, ah(async (req, res) => {
  const [rows] = await db.query('SELECT id, email, name, avatar_url FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) throw new HttpError(401, 'User no longer exists');
  res.json(rows[0]);
}));

async function upsertUser({ googleId, email, name, avatar }) {
  await db.query(
    `INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE google_id = VALUES(google_id), name = VALUES(name), avatar_url = VALUES(avatar_url)`,
    [googleId, email, name, avatar]
  );
  const [rows] = await db.query('SELECT id, email, name, avatar_url FROM users WHERE email = ?', [email]);
  const user = rows[0];

  // Turn any pending space invites for this email into memberships
  const [invites] = await db.query('SELECT id, space_id, role FROM space_invites WHERE email = ?', [email]);
  for (const inv of invites) {
    await db.query('INSERT IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)', [inv.space_id, user.id, inv.role]);
    await db.query('DELETE FROM space_invites WHERE id = ?', [inv.id]);
  }
  return user;
}

module.exports = router;
module.exports.upsertUser = upsertUser;
