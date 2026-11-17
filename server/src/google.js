// Google Calendar connection: OAuth code exchange, encrypted refresh tokens, authorised API calls
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');
const { HttpError } = require('./access');

const CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',     // create / list / cancel events (+ Meet links)
  'https://www.googleapis.com/auth/calendar.freebusy',   // check teammates' availability
];
const API = 'https://www.googleapis.com/calendar/v3';

const encKey = () => crypto.createHash('sha256').update(process.env.TOKEN_ENC_KEY || process.env.JWT_SECRET).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// 'postmessage' is the redirect URI used by Google Identity Services' popup code flow
const newClient = () => new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, 'postmessage');

async function status(userId) {
  const [[row]] = await db.query('SELECT google_email, scope, connected_at FROM user_google_tokens WHERE user_id = ?', [userId]);
  return row ? { connected: true, email: row.google_email, connected_at: row.connected_at } : { connected: false };
}

// Exchange an authorization code from the browser popup for tokens + the verified Google identity
async function exchangeCode(code) {
  if (!process.env.GOOGLE_CLIENT_SECRET) throw new HttpError(500, 'GOOGLE_CLIENT_SECRET is not configured on the server');
  const client = newClient();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch {
    throw new HttpError(400, 'Google did not accept the authorization. Please try again.');
  }
  let profile = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    profile = ticket.getPayload();
  }
  return { tokens, profile };
}

const hasCalendarScope = (tokens) => String(tokens?.scope || '').includes('calendar.events');

// Store (or refresh) a user's calendar connection. Google only sends a refresh token on first consent,
// so if it is missing we keep the one we already have.
async function saveTokens(userId, email, tokens, { required = true } = {}) {
  if (!hasCalendarScope(tokens)) {
    if (required) throw new HttpError(400, 'Calendar permission was not granted. Please allow calendar access.');
    return status(userId);
  }
  const [[existing]] = await db.query('SELECT user_id FROM user_google_tokens WHERE user_id = ?', [userId]);
  if (!tokens.refresh_token) {
    if (existing) {
      await db.query('UPDATE user_google_tokens SET scope = ? WHERE user_id = ?', [tokens.scope, userId]);
      return status(userId);
    }
    if (required) throw new HttpError(400, 'Google did not give offline access. Remove this app at myaccount.google.com/permissions and connect again.');
    return status(userId);
  }
  await db.query(
    `INSERT INTO user_google_tokens (user_id, google_email, refresh_token_enc, scope) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), refresh_token_enc = VALUES(refresh_token_enc), scope = VALUES(scope), connected_at = CURRENT_TIMESTAMP`,
    [userId, email, encrypt(tokens.refresh_token), tokens.scope]);
  return status(userId);
}

// "Connect Google Calendar" for an already signed-in user
async function connect(user, code) {
  const { tokens, profile } = await module.exports.exchangeCode(code);
  const email = profile?.email?.toLowerCase();
  // Make sure the calendar being connected belongs to the signed-in user
  if (email && email !== user.email.toLowerCase()) {
    throw new HttpError(400, `Please choose your own Google account (${user.email}), not ${email}`);
  }
  return saveTokens(user.id, email || user.email, tokens);
}

async function disconnect(userId) {
  const [[row]] = await db.query('SELECT refresh_token_enc FROM user_google_tokens WHERE user_id = ?', [userId]);
  if (row) {
    await newClient().revokeToken(decrypt(row.refresh_token_enc)).catch(() => {});
    await db.query('DELETE FROM user_google_tokens WHERE user_id = ?', [userId]);
  }
}

// Make an authorised Calendar API call on behalf of a user
async function request(userId, { method = 'GET', path, params, data }) {
  const [[row]] = await db.query('SELECT refresh_token_enc FROM user_google_tokens WHERE user_id = ?', [userId]);
  if (!row) throw new HttpError(409, 'Connect your Google Calendar first');
  const client = newClient();
  client.setCredentials({ refresh_token: decrypt(row.refresh_token_enc) });
  try {
    const res = await client.request({ url: `${API}${path}`, method, params, data });
    return res.data;
  } catch (e) {
    const status = e.response?.status;
    const reason = e.response?.data?.error;
    if (reason === 'invalid_grant' || e.message?.includes('invalid_grant')) {
      await db.query('DELETE FROM user_google_tokens WHERE user_id = ?', [userId]);
      throw new HttpError(409, 'Google Calendar access expired. Please connect again.');
    }
    if (status === 404 || status === 410) { const err = new HttpError(404, 'Event not found in Google Calendar'); err.google = status; throw err; }
    const msg = e.response?.data?.error?.message || e.message;
    throw new HttpError(502, `Google Calendar error: ${msg}`);
  }
}

module.exports = { CALENDAR_SCOPES, status, connect, exchangeCode, saveTokens, hasCalendarScope, disconnect, request, encrypt, decrypt };

// Local test mode: swap Google Calendar for a simulated calendar (see googleFake.js)
if (process.env.CALENDAR_MODE === 'fake') {
  Object.assign(module.exports, require('./googleFake'));
  console.warn('⚠  CALENDAR_MODE=fake – Google Calendar is simulated (local testing only)');
}
