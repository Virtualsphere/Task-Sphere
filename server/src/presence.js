// Who is online right now (in-memory; for several server instances use a Redis adapter)
const counts = new Map();

module.exports = {
  connect(userId) {
    const n = (counts.get(userId) || 0) + 1;
    counts.set(userId, n);
    return n === 1; // became online
  },
  disconnect(userId) {
    const n = (counts.get(userId) || 1) - 1;
    if (n <= 0) { counts.delete(userId); return true; } // went offline
    counts.set(userId, n);
    return false;
  },
  isOnline: (userId) => counts.has(userId),
};
