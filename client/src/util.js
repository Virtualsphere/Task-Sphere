export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444' },
  { key: 'high', label: 'High', color: '#f59e0b' },
  { key: 'normal', label: 'Normal', color: '#3b82f6' },
  { key: 'low', label: 'Low', color: '#94a3b8' },
];
export const priorityOf = (k) => PRIORITIES.find((p) => p.key === k) || PRIORITIES[2];

export const ROLE_RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };
export const can = (role, min) => (ROLE_RANK[role] || 0) >= ROLE_RANK[min];

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function fmtTime(d) {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));
  return dt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isOverdue(due, done) {
  if (!due || done) return false;
  return new Date(`${due}T23:59:59`) < new Date();
}

export const initials = (name = '?') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// Browser storage can be unavailable (private mode, embedded frames) — never let it crash the UI
export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
