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

const parseDbTime = (d) => new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'));

export function fmtTime(d) {
  if (!d) return '';
  return parseDbTime(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// "Online", "last seen just now", "last seen today at 4:05 pm", "last seen yesterday at …", "last seen 12 Nov"
export function fmtLastSeen(person) {
  if (!person) return '';
  if (person.online) return 'Online';
  if (!person.last_seen_at) return 'Offline';
  const dt = parseDbTime(person.last_seen_at);
  if (Number.isNaN(dt.getTime())) return 'Offline';
  const now = new Date();
  const mins = Math.round((now - dt) / 60000);
  if (mins < 1) return 'last seen just now';
  if (mins < 60) return `last seen ${mins} min ago`;
  const time = dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round((new Date(now.toDateString()) - new Date(dt.toDateString())) / 86400000);
  if (dayDiff === 0) return `last seen today at ${time}`;
  if (dayDiff === 1) return `last seen yesterday at ${time}`;
  if (dayDiff < 7) return `last seen ${dt.toLocaleDateString('en-IN', { weekday: 'long' })} at ${time}`;
  return `last seen ${dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}`;
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
