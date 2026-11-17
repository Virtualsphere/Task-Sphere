// Authentication + role-based access helpers
const jwt = require('jsonwebtoken');
const db = require('./db');

const ROLE_RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wrap async route handlers so thrown errors reach the error middleware
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

async function getRole(spaceId, userId) {
  const [rows] = await db.query('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);
  return rows[0]?.role || null;
}

// Throws 403/404 unless user has at least `minRole` in the space. Returns the user's role.
async function assertRole(spaceId, userId, minRole = 'viewer') {
  if (!spaceId) throw new HttpError(404, 'Not found');
  const role = await getRole(spaceId, userId);
  if (!role) throw new HttpError(404, 'Space not found or you are not a member');
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw new HttpError(403, `This action needs ${minRole} access`);
  return role;
}

async function spaceIdForList(listId) {
  const [r] = await db.query('SELECT space_id FROM lists WHERE id = ?', [listId]);
  return r[0]?.space_id;
}

async function spaceForTicket(ticketId) {
  const [r] = await db.query(
    'SELECT l.space_id, t.list_id, t.created_by FROM tickets t JOIN lists l ON l.id = t.list_id WHERE t.id = ?',
    [ticketId]
  );
  return r[0] || null;
}

// Broadcast a change to everyone currently viewing the space (they refetch)
function notify(req, spaceId, payload) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`space:${spaceId}`).emit('space:changed', { ...payload, by: req.user.id });
  // A removed member is kicked out of the live room (chat + updates)
  if (payload.removedUserId && io.kickFromSpace) io.kickFromSpace(spaceId, payload.removedUserId);
}

module.exports = {
  ROLE_RANK, HttpError, ah, signToken, verifyToken, requireAuth,
  getRole, assertRole, spaceIdForList, spaceForTicket, notify,
};
