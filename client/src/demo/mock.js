// DEMO ONLY: in-browser mock of the Express API + Socket.IO, so the real UI can run without a server.
// Used by `npm run build:demo` (see vite.demo.config.js). Data resets on page reload.
import { METHODOLOGIES } from './methodologies';

const RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

// ---------- token storage (wrapped: storage can be unavailable) ----------
let memToken = null;
export const getToken = () => { try { return localStorage.getItem('pm_demo_token') ?? memToken; } catch { return memToken; } };
export const setToken = (t) => {
  memToken = t || null;
  try { t ? localStorage.setItem('pm_demo_token', t) : localStorage.removeItem('pm_demo_token'); } catch { /* ignore */ }
};

// ---------- seed data ----------
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

export const DEMO_USERS = [
  { id: 1, name: 'Vikalp Paliwal', email: 'vikalp@virtualsphere.demo', avatar_url: null, hint: 'Owner – full control' },
  { id: 2, name: 'Aarav Mehta', email: 'aarav@virtualsphere.demo', avatar_url: null, hint: 'Admin – manages members & lists' },
  { id: 3, name: 'Riya Jain', email: 'riya@virtualsphere.demo', avatar_url: null, hint: 'Member – works on tickets' },
  { id: 4, name: 'Karan Verma', email: 'karan@virtualsphere.demo', avatar_url: null, hint: 'Viewer – read-only + chat' },
];

let seq = 100;
const nid = () => ++seq;
let ticketSeq = 0;
const tid = () => ++ticketSeq; // tickets get their own #1, #2, … numbers
const S = { spaces: [], members: [], invites: [], lists: [], statuses: [], tickets: [], assignees: [], subtasks: [], comments: [], messages: [] };

function addSpace(name, description, color, ownerId, members) {
  const s = { id: nid(), name, description, color, owner_id: ownerId, created_at: ago(40000) };
  S.spaces.push(s);
  for (const [uid, role] of members) S.members.push({ space_id: s.id, user_id: uid, role, joined_at: ago(30000) });
  return s;
}
function addList(spaceId, name, description, methodology) {
  const l = { id: nid(), space_id: spaceId, name, description, methodology, created_by: 1, created_at: ago(20000) };
  S.lists.push(l);
  METHODOLOGIES[methodology].statuses.forEach((st, i) =>
    S.statuses.push({ id: nid(), list_id: l.id, name: st.name, color: st.color, position: i, is_done: st.is_done ? 1 : 0 }));
  return l;
}
const st = (listId, idx) => S.statuses.filter((s) => s.list_id === listId).sort((a, b) => a.position - b.position)[idx].id;
function addTicket(listId, title, statusIdx, priority, assignees, start, due, description = '', extra = {}) {
  const t = {
    id: tid(), list_id: listId, title, description, status_id: st(listId, statusIdx), priority,
    start_date: start, due_date: due, position: seq, created_by: extra.by || 1, created_at: ago(5000), updated_at: ago(300),
  };
  S.tickets.push(t);
  assignees.forEach((u) => S.assignees.push({ ticket_id: t.id, user_id: u }));
  (extra.subtasks || []).forEach(([title, done, uid, prio]) =>
    S.subtasks.push({ id: nid(), ticket_id: t.id, title, is_done: done ? 1 : 0, priority: prio || 'normal', assignee_id: uid || null, due_date: null, position: seq, created_at: ago(4000) }));
  (extra.comments || []).forEach(([uid, body, mins]) =>
    S.comments.push({ id: nid(), ticket_id: t.id, user_id: uid, body, created_at: ago(mins) }));
  return t;
}

(function seed() {
  const p = addSpace('Virtualsphere Products', 'RFID software products – warehouse, school attendance and jewellery ERP', '#6366f1', 1,
    [[1, 'owner'], [2, 'admin'], [3, 'member'], [4, 'viewer']]);
  S.invites.push({ id: nid(), space_id: p.id, email: 'neha@virtualsphere.demo', role: 'member', invited_by: 1, created_at: ago(600) });

  const w = addList(p.id, 'RFID Warehouse App v2', 'Multi-warehouse gate In/Out and handheld stock counts', 'AGILE');
  addTicket(w.id, 'Gate reader In/Out API', 2, 'urgent', [1, 3], day(-5), day(-1), 'Expose REST + socket endpoints for UHF gate readers. Handle antenna direction to detect In vs Out.', {
    subtasks: [['Socket listener for reader events', true, 3, 'high'], ['Debounce duplicate tag reads', false, 1, 'high'], ['Write API docs', false, null, 'low']],
    comments: [[2, 'Reader firmware updated on gate 2, please retest.', 180], [1, 'Retested – In events working. Out events still pending.', 45]],
  });
  addTicket(w.id, 'Handheld stock count sync', 2, 'high', [3], day(-3), day(6), 'Sync handheld scans to server when back online. Show variance report.', {
    subtasks: [['Offline queue on handheld', true, 3], ['Variance report screen', false, 3]],
    comments: [[3, 'Offline queue done, testing with 5k tags.', 90]],
  });
  addTicket(w.id, 'Warehouse transfer report', 0, 'normal', [2], null, day(14), 'Report of stock moved between warehouses with date filters.');
  addTicket(w.id, 'Low-stock alerts via SMS', 1, 'low', [], null, null, 'Send SMS to store manager when stock below threshold.');
  addTicket(w.id, 'Google login for web panel', 3, 'normal', [1], day(-8), day(2), '', { comments: [[2, 'Working on staging. Please check with office accounts.', 30]] });
  addTicket(w.id, 'Tag encoding screen fixes', 4, 'high', [3], day(-6), day(1), 'QA found EPC length issue for 128-bit tags.', {
    comments: [[2, 'QA: 128-bit EPC write fails on second attempt.', 120]],
  });
  addTicket(w.id, 'Client UAT sign-off', 5, 'normal', [2], day(-4), day(3));
  addTicket(w.id, 'Multi-warehouse setup', 6, 'normal', [1, 2], day(-25), day(-12), '', { subtasks: [['Warehouse master', true, 1], ['User–warehouse mapping', true, 2]] });

  const sa = addList(p.id, 'School Attendance', 'Gate readers + parent SMS on entry/exit', 'SCRUM');
  addTicket(sa.id, 'Parent SMS on entry/exit', 2, 'high', [3], day(-2), day(4), 'Use SMS template with student name, time and gate.', { comments: [[1, 'DLT template approved.', 300]] });
  addTicket(sa.id, 'Student registration via desktop reader', 3, 'normal', [1], day(-6), day(0));
  addTicket(sa.id, 'Attendance dashboard for principal', 1, 'normal', [2], null, day(10));
  addTicket(sa.id, 'Late-arrival report', 0, 'low', [], null, null);
  addTicket(sa.id, 'Gate reader installation guide', 6, 'normal', [2], day(-20), day(-10));

  const j = addList(p.id, 'Jewellery ERP', 'Billing, RFID inventory, gold loan', 'SDLC');
  addTicket(j.id, 'Gold loan (girvi) module', 1, 'high', [1, 2], day(-1), day(20), 'Interest calculation, pledge items, release receipts.');
  addTicket(j.id, 'GST billing with HUID', 2, 'urgent', [3], day(-7), day(2));
  addTicket(j.id, 'Requirement sign-off with client', 0, 'normal', [2], null, day(5));

  const t = addSpace('Tax-Jiffy', 'GST & tax filing platform', '#22c55e', 1, [[1, 'owner'], [3, 'member']]);
  const tl = addList(t.id, 'Sprint board', '', 'KANBAN');
  addTicket(tl.id, 'IMS vs GSTR-2B reconciliation', 2, 'high', [1], day(-3), day(5), '', { comments: [[3, 'Matching logic ready for review.', 60]] });
  addTicket(tl.id, 'Deploy to production VM', 1, 'normal', [1], null, day(7));

  const s = addSpace('Sales & Marketing', 'Lead follow-ups and campaigns', '#f59e0b', 2, [[2, 'owner'], [1, 'member'], [4, 'member']]);
  const sl = addList(s.id, 'Lead follow-ups', '', 'KANBAN');
  addTicket(sl.id, 'UDM9R reader demo for distributor', 2, 'high', [4], day(-1), day(2), '', { by: 2 });
  addTicket(sl.id, 'Google Ads campaign review', 0, 'normal', [1], null, day(8), '', { by: 2 });

  const gateMsg = { id: nid(), space_id: p.id, user_id: 1, body: 'Noted. Gate API will be ready by Thursday.', created_at: ago(190) };
  S.messages.push(
    { id: nid(), space_id: p.id, user_id: 2, kind: 'text', body: 'Morning team, client demo moved to Friday.', created_at: ago(200) },
    gateMsg,
    { id: nid(), space_id: p.id, user_id: 3, body: 'I will finish the stock count sync today 👍', created_at: ago(150) },
    { id: nid(), space_id: p.id, user_id: 2, body: '@[Vikalp Paliwal](1) great, can you share the endpoint list with @[Riya Jain](3)?', reply_to_id: gateMsg.id, created_at: ago(120) },
    { id: nid(), space_id: t.id, user_id: 3, body: 'Recon PR is up.', created_at: ago(70) },
  );
})();

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const userById = (id) => DEMO_USERS.find((u) => u.id === id);
const pub = (u) => u && { id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url };
const now = () => new Date().toISOString();
let me = null;

function currentUser() {
  const tok = getToken();
  const u = DEMO_USERS.find((x) => x.email === tok);
  if (!u) throw new HttpError(401, 'Not signed in');
  me = u;
  return u;
}
const roleOf = (spaceId, uid) => S.members.find((m) => m.space_id === spaceId && m.user_id === uid)?.role || null;
function assertRole(spaceId, min) {
  const role = roleOf(spaceId, me.id);
  if (!role) throw new HttpError(404, 'Space not found or you are not a member');
  if (RANK[role] < RANK[min]) throw new HttpError(403, `This action needs ${min} access (you are ${role})`);
  return role;
}
const listOf = (id) => S.lists.find((l) => l.id === id) || (() => { throw new HttpError(404, 'List not found'); })();
const ticketOf = (id) => S.tickets.find((t) => t.id === id) || (() => { throw new HttpError(404, 'Ticket not found'); })();
const spaceOfTicket = (t) => listOf(t.list_id).space_id;
const statusesOf = (listId) => S.statuses.filter((s) => s.list_id === listId).sort((a, b) => a.position - b.position);
const doneIds = () => new Set(S.statuses.filter((s) => s.is_done).map((s) => s.id));

function validateMembers(spaceId, ids) {
  const clean = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (clean.some((uid) => !roleOf(spaceId, uid))) throw new HttpError(400, 'Assignees must be members of this space');
  return clean;
}
function changed(spaceId, payload) { emitLocal('space:changed', { ...payload, by: me.id, spaceId }); }

function ticketFull(id) {
  const t = ticketOf(id);
  return {
    ...t,
    created_by_name: userById(t.created_by)?.name,
    assignees: S.assignees.filter((a) => a.ticket_id === id).map((a) => pub(userById(a.user_id))),
    subtasks: S.subtasks.filter((s) => s.ticket_id === id).sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, assignee_name: userById(s.assignee_id)?.name || null })),
    comments: S.comments.filter((c) => c.ticket_id === id).sort((a, b) => b.id - a.id)
      .map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, user_id: c.user_id, name: userById(c.user_id)?.name, avatar_url: null })),
  };
}
const touch = (t) => { t.updated_at = now(); };

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:\w+/g, '(\\d+)')}$`), fn });

route('POST', '/auth/google', (_, b) => {
  const u = DEMO_USERS.find((x) => x.email === b.credential);
  if (!u) throw new HttpError(401, 'Unknown demo user');
  return { token: u.email, user: pub(u) };
});
route('GET', '/auth/me', () => pub(currentUser()));

route('GET', '/spaces', () => S.members.filter((m) => m.user_id === me.id).map((m) => {
  const s = S.spaces.find((x) => x.id === m.space_id);
  return { ...s, role: m.role, member_count: S.members.filter((x) => x.space_id === s.id).length, list_count: S.lists.filter((l) => l.space_id === s.id).length };
}).sort((a, b) => a.id - b.id));
route('POST', '/spaces', (_, b) => {
  if (!b.name?.trim()) throw new HttpError(400, 'Space name is required');
  const s = { id: nid(), name: b.name.trim(), description: b.description || null, color: b.color || '#6366f1', owner_id: me.id, created_at: now() };
  S.spaces.push(s);
  S.members.push({ space_id: s.id, user_id: me.id, role: 'owner', joined_at: now() });
  return { id: s.id };
});
route('GET', '/spaces/:id', ([id]) => {
  const myRole = assertRole(id, 'viewer');
  const s = S.spaces.find((x) => x.id === id);
  const order = ['owner', 'admin', 'member', 'viewer'];
  const done = doneIds();
  return {
    ...s, my_role: myRole,
    members: S.members.filter((m) => m.space_id === id).map((m) => ({ ...pub(userById(m.user_id)), role: m.role, joined_at: m.joined_at }))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)),
    invites: RANK[myRole] >= RANK.admin ? S.invites.filter((i) => i.space_id === id) : [],
    lists: S.lists.filter((l) => l.space_id === id).map((l) => {
      const ts = S.tickets.filter((t) => t.list_id === l.id);
      return { ...l, ticket_count: ts.length, done_count: ts.filter((t) => done.has(t.status_id)).length };
    }),
  };
});
route('DELETE', '/spaces/:id', ([id]) => {
  assertRole(id, 'owner');
  changed(id, { type: 'space-deleted' });
  S.spaces = S.spaces.filter((s) => s.id !== id);
  S.members = S.members.filter((m) => m.space_id !== id);
  return { ok: true };
});
route('POST', '/spaces/:id/members', ([id], b) => {
  const myRole = assertRole(id, 'admin');
  const email = (b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (b.role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Only the owner can add admins');
  const u = DEMO_USERS.find((x) => x.email === email);
  if (u) {
    if (roleOf(id, u.id)) throw new HttpError(409, 'This person is already a member');
    S.members.push({ space_id: id, user_id: u.id, role: b.role || 'member', joined_at: now() });
  } else {
    S.invites = S.invites.filter((i) => !(i.space_id === id && i.email === email));
    S.invites.push({ id: nid(), space_id: id, email, role: b.role || 'member', invited_by: me.id, created_at: now() });
  }
  changed(id, { type: 'members' });
  return { ok: true };
});
route('PATCH', '/spaces/:id/members/:uid', ([id, uid], b) => {
  const myRole = assertRole(id, 'admin');
  const m = S.members.find((x) => x.space_id === id && x.user_id === uid);
  if (!m) throw new HttpError(404, 'Member not found');
  if (m.role === 'owner') throw new HttpError(403, "The owner's role cannot be changed");
  if ((m.role === 'admin' || b.role === 'admin') && myRole !== 'owner') throw new HttpError(403, 'Only the owner can change admin roles');
  m.role = b.role;
  changed(id, { type: 'members' });
  return { ok: true };
});
route('DELETE', '/spaces/:id/members/:uid', ([id, uid]) => {
  const self = uid === me.id;
  const myRole = assertRole(id, self ? 'viewer' : 'admin');
  const m = S.members.find((x) => x.space_id === id && x.user_id === uid);
  if (!m) throw new HttpError(404, 'Member not found');
  if (m.role === 'owner') throw new HttpError(403, 'The owner cannot be removed');
  if (!self && m.role === 'admin' && myRole !== 'owner') throw new HttpError(403, 'Only the owner can remove admins');
  S.members = S.members.filter((x) => x !== m);
  changed(id, { type: 'members', removedUserId: uid });
  return { ok: true };
});
route('DELETE', '/spaces/:id/invites/:iid', ([id, iid]) => {
  assertRole(id, 'admin');
  S.invites = S.invites.filter((i) => i.id !== iid);
  changed(id, { type: 'members' });
  return { ok: true };
});
route('GET', '/spaces/:id/messages', ([id]) => {
  assertRole(id, 'viewer');
  return S.messages.filter((m) => m.space_id === id).map(msgOut);
});

route('GET', '/methodologies', () => Object.entries(METHODOLOGIES).map(([key, m]) => ({ key, ...m })));
route('POST', '/spaces/:id/lists', ([id], b) => {
  assertRole(id, 'admin');
  if (!b.name?.trim()) throw new HttpError(400, 'List name is required');
  const l = { id: nid(), space_id: id, name: b.name.trim(), description: b.description || null, methodology: b.methodology, created_by: me.id, created_at: now() };
  S.lists.push(l);
  (b.statuses || []).filter((s) => s.name?.trim()).forEach((s, i) =>
    S.statuses.push({ id: nid(), list_id: l.id, name: s.name.trim(), color: s.color, position: i, is_done: s.is_done ? 1 : 0 }));
  changed(id, { type: 'lists' });
  return { id: l.id };
});
route('GET', '/lists/:id', ([id]) => {
  const l = listOf(id);
  const myRole = assertRole(l.space_id, 'viewer');
  const tickets = S.tickets.filter((t) => t.list_id === id).sort((a, b) => a.position - b.position).map((t) => {
    const subs = S.subtasks.filter((s) => s.ticket_id === t.id);
    const cs = S.comments.filter((c) => c.ticket_id === t.id).sort((a, b) => b.id - a.id);
    return {
      ...t, subtask_total: subs.length, subtask_done: subs.filter((s) => s.is_done).length, comment_count: cs.length,
      assignees: S.assignees.filter((a) => a.ticket_id === t.id).map((a) => pub(userById(a.user_id))),
      latest_comment: cs[0] ? { body: cs[0].body, created_at: cs[0].created_at, name: userById(cs[0].user_id)?.name } : null,
    };
  });
  return { ...l, my_role: myRole, statuses: statusesOf(id), tickets };
});
route('PATCH', '/lists/:id', ([id], b) => {
  const l = listOf(id);
  assertRole(l.space_id, 'admin');
  if (b.name !== undefined) l.name = b.name;
  if (b.description !== undefined) l.description = b.description;
  changed(l.space_id, { type: 'lists' });
  return { ok: true };
});
route('PUT', '/lists/:id/statuses', ([id], b) => {
  const l = listOf(id);
  assertRole(l.space_id, 'admin');
  const keep = [];
  b.statuses.filter((s) => s.name?.trim()).forEach((s, i) => {
    const ex = s.id && S.statuses.find((x) => x.id === s.id && x.list_id === id);
    if (ex) Object.assign(ex, { name: s.name.trim(), color: s.color, position: i, is_done: s.is_done ? 1 : 0 });
    const row = ex || { id: nid(), list_id: id, name: s.name.trim(), color: s.color, position: i, is_done: s.is_done ? 1 : 0 };
    if (!ex) S.statuses.push(row);
    keep.push(row.id);
  });
  S.tickets.forEach((t) => { if (t.list_id === id && !keep.includes(t.status_id)) t.status_id = keep[0]; });
  S.statuses = S.statuses.filter((s) => s.list_id !== id || keep.includes(s.id));
  changed(l.space_id, { type: 'lists' });
  return { ok: true };
});
route('DELETE', '/lists/:id', ([id]) => {
  const l = listOf(id);
  assertRole(l.space_id, 'admin');
  S.lists = S.lists.filter((x) => x.id !== id);
  S.tickets = S.tickets.filter((t) => t.list_id !== id);
  changed(l.space_id, { type: 'lists' });
  return { ok: true };
});

route('POST', '/lists/:id/tickets', ([id], b) => {
  const l = listOf(id);
  assertRole(l.space_id, 'member');
  if (!b.title?.trim()) throw new HttpError(400, 'Ticket title is required');
  const t = {
    id: tid(), list_id: id, title: b.title.trim(), description: b.description || null,
    status_id: b.status_id || statusesOf(id)[0]?.id, priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal',
    start_date: b.start_date || null, due_date: b.due_date || null, position: nid(), created_by: me.id, created_at: now(), updated_at: now(),
  };
  S.tickets.push(t);
  validateMembers(l.space_id, b.assignee_ids).forEach((u) => S.assignees.push({ ticket_id: t.id, user_id: u }));
  changed(l.space_id, { type: 'tickets' });
  return ticketFull(t.id);
});
route('GET', '/tickets/:id', ([id]) => {
  const t = ticketOf(id);
  return { ...ticketFull(id), my_role: assertRole(spaceOfTicket(t), 'viewer') };
});
route('PATCH', '/tickets/:id', ([id], b) => {
  const t = ticketOf(id);
  const sid = spaceOfTicket(t);
  assertRole(sid, 'member');
  for (const k of ['title', 'description', 'priority', 'status_id', 'start_date', 'due_date', 'position']) if (b[k] !== undefined) t[k] = b[k];
  if (b.assignee_ids !== undefined) {
    const ids = validateMembers(sid, b.assignee_ids);
    S.assignees = S.assignees.filter((a) => a.ticket_id !== id);
    ids.forEach((u) => S.assignees.push({ ticket_id: id, user_id: u }));
  }
  touch(t);
  changed(sid, { type: 'tickets' });
  return ticketFull(id);
});
route('DELETE', '/tickets/:id', ([id]) => {
  const t = ticketOf(id);
  const sid = spaceOfTicket(t);
  const role = assertRole(sid, 'member');
  if (RANK[role] < RANK.admin && t.created_by !== me.id) throw new HttpError(403, 'Only admins or the ticket creator can delete it');
  S.tickets = S.tickets.filter((x) => x.id !== id);
  changed(sid, { type: 'tickets' });
  return { ok: true };
});
route('POST', '/tickets/:id/subtasks', ([id], b) => {
  const t = ticketOf(id);
  assertRole(spaceOfTicket(t), 'member');
  if (!b.title?.trim()) throw new HttpError(400, 'Subtask title is required');
  S.subtasks.push({ id: nid(), ticket_id: id, title: b.title.trim(), description: b.description || null, is_done: 0, priority: b.priority || 'normal', assignee_id: Number(b.assignee_id) || null, due_date: b.due_date || null, position: nid(), created_at: now() });
  touch(t); changed(spaceOfTicket(t), { type: 'tickets' });
  return ticketFull(id);
});
const subOf = (id) => S.subtasks.find((s) => s.id === id) || (() => { throw new HttpError(404, 'Subtask not found'); })();
route('PATCH', '/subtasks/:id', ([id], b) => {
  const s = subOf(id); const t = ticketOf(s.ticket_id);
  assertRole(spaceOfTicket(t), 'member');
  if (b.is_done !== undefined) s.is_done = b.is_done ? 1 : 0;
  if (b.assignee_id !== undefined) s.assignee_id = Number(b.assignee_id) || null;
  if (b.due_date !== undefined) s.due_date = b.due_date || null;
  if (b.title !== undefined) s.title = b.title;
  if (b.description !== undefined) s.description = b.description || null;
  if (b.priority !== undefined) s.priority = b.priority;
  touch(t); changed(spaceOfTicket(t), { type: 'tickets' });
  return ticketFull(t.id);
});
route('DELETE', '/subtasks/:id', ([id]) => {
  const s = subOf(id); const t = ticketOf(s.ticket_id);
  assertRole(spaceOfTicket(t), 'member');
  S.subtasks = S.subtasks.filter((x) => x !== s);
  changed(spaceOfTicket(t), { type: 'tickets' });
  return ticketFull(t.id);
});
route('POST', '/tickets/:id/comments', ([id], b) => {
  const t = ticketOf(id);
  assertRole(spaceOfTicket(t), 'member');
  if (!b.body?.trim()) throw new HttpError(400, 'Comment cannot be empty');
  S.comments.push({ id: nid(), ticket_id: id, user_id: me.id, body: b.body.trim(), created_at: now() });
  touch(t); changed(spaceOfTicket(t), { type: 'tickets' });
  return ticketFull(id);
});
route('DELETE', '/comments/:id', ([id]) => {
  const c = S.comments.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Comment not found');
  const t = ticketOf(c.ticket_id);
  const role = assertRole(spaceOfTicket(t), 'viewer');
  if (c.user_id !== me.id && RANK[role] < RANK.admin) throw new HttpError(403, 'You can only delete your own comments');
  S.comments = S.comments.filter((x) => x !== c);
  changed(spaceOfTicket(t), { type: 'tickets' });
  return ticketFull(t.id);
});

// =================== v2: personal chats, calendar, meetings (demo) ===================
const ONLINE = new Set([1, 2, 3]); // Karan shows as offline
const LAST_SEEN = { 4: ago(95) }; // …and was last seen about an hour and a half ago
const presenceOf = (id) => ({ online: ONLINE.has(id), last_seen_at: ONLINE.has(id) ? null : LAST_SEEN[id] || null });
S.convs = []; S.convMembers = []; S.dms = []; S.meetings = []; S.calConnected = new Set();
const mates = (uid) => [...new Set(S.members.filter((m) => S.members.some((x) => x.space_id === m.space_id && x.user_id === uid)).map((m) => m.user_id))].filter((x) => x !== uid);
const convOf = (id) => {
  const c = S.convs.find((x) => x.id === id);
  if (!c || !S.convMembers.some((m) => m.conversation_id === id && m.user_id === me.id)) throw new HttpError(404, 'Conversation not found');
  return c;
};
const dmOut = (d) => ({ id: d.id, conversationId: d.conversation_id, kind: d.kind, body: d.body, created_at: d.created_at, user_id: d.user_id, name: userById(d.user_id)?.name, avatar_url: null });
function addConv(type, memberIds, name = null, msgs = []) {
  const c = { id: nid(), type, name, created_by: memberIds[0], created_at: ago(3000), last_message_at: null };
  S.convs.push(c);
  memberIds.forEach((u) => S.convMembers.push({ conversation_id: c.id, user_id: u, last_read_id: 0, last_delivered_id: 0 }));
  msgs.forEach(([u, body, mins]) => { const d = { id: nid(), conversation_id: c.id, user_id: u, kind: 'text', body, created_at: ago(mins) }; S.dms.push(d); c.last_message_at = d.created_at; });
  return c;
}
addConv('direct', [1, 2], null, [[2, 'Hey, can we quickly discuss the gate reader API?', 45], [1, 'Sure, give me 10 minutes', 40], [2, 'Cool, ping me for a huddle 🎧', 38]]);
addConv('group', [1, 2, 3], 'RFID Dev Team', [[3, 'Build 2.3 is on staging 🚀', 25], [2, 'Nice! Testing gate 2 now', 20]]);
addConv('direct', [1, 3], null, [[3, 'Leave applied on greytHR for Monday, approved by Aarav', 90]]);
addConv('direct', [2, 4], null, [[4, 'Distributor wants a UDM9R demo on Friday', 300]]);
S.convMembers.forEach((m) => { if (m.user_id === 1 && m.conversation_id === S.convs[0].id) m.last_read_id = S.dms[1].id; });

function convList(onlyId) {
  return S.convMembers.filter((m) => m.user_id === me.id && (!onlyId || m.conversation_id === onlyId)).map((cm) => {
    const c = S.convs.find((x) => x.id === cm.conversation_id);
    const msgs = S.dms.filter((d) => d.conversation_id === c.id);
    const last = msgs[msgs.length - 1];
    return {
      ...c, last_read_id: cm.last_read_id,
      unread: msgs.filter((d) => d.id > cm.last_read_id && d.user_id !== me.id).length,
      members: S.convMembers.filter((x) => x.conversation_id === c.id).map((x) => ({
        ...pub(userById(x.user_id)), ...presenceOf(x.user_id), last_read_id: x.last_read_id, last_delivered_id: Math.max(x.last_delivered_id || 0, x.last_read_id),
      })),
      last_message: last ? { kind: last.kind, body: last.body, created_at: last.created_at, user_id: last.user_id, name: userById(last.user_id)?.name } : null,
    };
  }).sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
}
function postDM(convId, userId, body, kind = 'text') {
  const d = { id: nid(), conversation_id: convId, user_id: userId, kind, body, created_at: now() };
  S.dms.push(d);
  S.convs.find((c) => c.id === convId).last_message_at = d.created_at;
  { const cm = S.convMembers.find((m) => m.conversation_id === convId && m.user_id === userId); if (cm) { cm.last_read_id = d.id; cm.last_delivered_id = d.id; } }
  if (S.convMembers.some((m) => m.conversation_id === convId && m.user_id === me?.id)) setTimeout(() => emitLocal('dm:message', dmOut(d)), 40);
  return dmOut(d);
}
function postSpace(spaceId, userId, body, kind = 'text', replyTo = null) {
  if (kind === 'text') {
    // Same rule as the server: only mentions of space members are kept, with their real name
    body = body.replace(MENTION_RE, (all, label, id) => {
      const ok = S.members.some((x) => x.space_id === spaceId && x.user_id === Number(id));
      return ok ? `@[${userById(Number(id)).name}](${id})` : `@${label}`;
    });
  }
  const reply = replyTo && S.messages.some((x) => x.id === Number(replyTo) && x.space_id === spaceId) ? Number(replyTo) : null;
  const m = { id: nid(), space_id: spaceId, user_id: userId, kind, body, reply_to_id: reply, created_at: now() };
  S.messages.push(m);
  setTimeout(() => emitLocal('chat:message', msgOut(m)), 40);
}

route('GET', '/people', () => {
  const team = new Set(mates(me.id));
  return DEMO_USERS.filter((u) => u.id !== me.id)
    .map((u) => ({ ...pub(u), ...presenceOf(u.id), teammate: team.has(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
route('GET', '/conversations', () => convList());
route('POST', '/conversations/direct', (_, b) => {
  const other = Number(b.user_id);
  if (!mates(me.id).includes(other)) throw new HttpError(400, 'You can only chat with people who share a space with you');
  let c = S.convs.find((x) => x.type === 'direct' && S.convMembers.filter((m) => m.conversation_id === x.id).map((m) => m.user_id).sort().join() === [me.id, other].sort().join());
  if (!c) c = addConv('direct', [me.id, other]);
  return convList(c.id)[0];
});
route('POST', '/conversations/group', (_, b) => {
  const ids = [...new Set((b.user_ids || []).map(Number))].filter((x) => x !== me.id);
  if (ids.length < 2) throw new HttpError(400, 'Pick at least two people for a group');
  const c = addConv('group', [me.id, ...ids], (b.name || '').trim() || null);
  return convList(c.id)[0];
});
route('GET', '/conversations/:id', ([id]) => { convOf(id); return convList(id)[0]; });
route('PATCH', '/conversations/:id', ([id], b) => { convOf(id).name = (b.name || '').trim() || null; emitLocal('conversation:updated', { id }); return { ok: true }; });
route('POST', '/conversations/:id/members', ([id], b) => {
  convOf(id);
  (b.user_ids || []).forEach((u) => { if (!S.convMembers.some((m) => m.conversation_id === id && m.user_id === u)) S.convMembers.push({ conversation_id: id, user_id: u, last_read_id: 0, last_delivered_id: 0 }); });
  return convList(id)[0];
});
route('DELETE', '/conversations/:id/members/me', ([id]) => { convOf(id); S.convMembers = S.convMembers.filter((m) => !(m.conversation_id === id && m.user_id === me.id)); return { ok: true }; });
route('GET', '/conversations/:id/messages', ([id]) => { convOf(id); return S.dms.filter((d) => d.conversation_id === id).slice(-50).map(dmOut); });
route('POST', '/conversations/:id/messages', ([id], b) => { convOf(id); return postDM(id, me.id, b.body); });
route('POST', '/conversations/:id/read', ([id], b) => {
  const cm = S.convMembers.find((m) => m.conversation_id === id && m.user_id === me.id);
  if (cm) cm.last_read_id = Math.max(cm.last_read_id, Number(b.last_id) || 0);
  if (cm) { cm.last_delivered_id = Math.max(cm.last_delivered_id || 0, cm.last_read_id); demoReceipt(cm); }
  return { ok: true };
});

// ---- calendar (simulated Google Calendar) ----
const at = (dayOff, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(h, m, 0, 0); return d.toISOString(); };
route('GET', '/calendar/status', () => (S.calConnected.has(me.id) ? { connected: true, email: me.email } : { connected: false }));
route('POST', '/calendar/connect', () => { S.calConnected.add(me.id); return { connected: true, email: me.email }; });
route('DELETE', '/calendar', () => { S.calConnected.delete(me.id); return { connected: false }; });
const needCal = () => { if (!S.calConnected.has(me.id)) throw new HttpError(409, 'Connect your Google Calendar first'); };
route('GET', '/calendar/events', () => {
  needCal();
  const base = [
    { id: 'e1', title: 'Daily stand-up', start: at(0, 10), end: at(0, 10, 15), meet_link: 'https://meet.google.com/', attendee_count: 4, organizer_self: true },
    { id: 'e2', title: 'Client demo – RFID gate', start: at(0, 15), end: at(0, 16), meet_link: 'https://meet.google.com/', attendee_count: 3, my_response: 'needsAction' },
    { id: 'e3', title: 'Sprint planning', start: at(1, 11), end: at(1, 12), meet_link: 'https://meet.google.com/', attendee_count: 5, organizer_self: true },
    { id: 'e4', title: 'Vendor call – Nation RFID', start: at(2, 14, 30), end: at(2, 15), location: 'Phone', attendee_count: 2 },
    { id: 'e5', title: 'Daily stand-up', start: at(1, 10), end: at(1, 10, 15), meet_link: 'https://meet.google.com/', attendee_count: 4, organizer_self: true },
  ];
  const mine = S.meetings.filter((m) => m.organizer_id === me.id || m.attendees.some((a) => a.user_id === me.id))
    .map((m) => ({ id: 'm' + m.id, title: m.title, start: m.start_at, end: m.end_at, meet_link: m.meet_link, attendee_count: m.attendees.length, organizer_self: m.organizer_id === me.id, meeting_id: m.id }));
  return [...base, ...mine].map((e) => ({ all_day: false, html_link: 'https://calendar.google.com/', my_response: null, location: null, meeting_id: null, ...e }))
    .filter((e) => new Date(e.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
});
// Simulated calendars: every working day — stand-up 10:00–10:15 for all; Aarav busy 11:00–12:30 & 16:00–17:00; Riya 14:00–15:00; Karan 12:00–13:30
const BUSY_PATTERN = { 1: [[10, 0, 10, 15]], 2: [[10, 0, 10, 15], [11, 0, 12, 30], [16, 0, 17, 0]], 3: [[10, 0, 10, 15], [14, 0, 15, 0]], 4: [[12, 0, 13, 30]] };
function busyBetween(uid, from, to) {
  const out = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    for (const [h1, m1, h2, m2] of BUSY_PATTERN[uid] || []) {
      const s1 = new Date(d); s1.setHours(h1, m1, 0, 0); const e1 = new Date(d); e1.setHours(h2, m2, 0, 0);
      if (e1 > from && s1 < to) out.push({ start: s1.toISOString(), end: e1.toISOString() });
    }
  }
  // meetings already booked in the demo also make people busy
  for (const m of S.meetings) {
    if (m.attendees.some((a) => a.user_id === uid) && new Date(m.end_at) > from && new Date(m.start_at) < to) out.push({ start: m.start_at, end: m.end_at });
  }
  return out;
}
route('POST', '/calendar/freebusy', (_, b) => {
  needCal();
  const from = new Date(b.timeMin); const to = new Date(b.timeMax);
  return [me.id, ...(b.user_ids || []).map(Number)].map((id) => ({ ...pub(userById(id)), busy: busyBetween(id, from, to), unavailable: false }))
    .concat((b.emails || []).map((e) => ({ id: null, name: e, email: e, busy: [], unavailable: true })));
});
const meetingVisible = (m) => m.organizer_id === me.id || m.attendees.some((a) => a.user_id === me.id)
  || (m.space_id && roleOf(m.space_id, me.id)) || (m.conversation_id && S.convMembers.some((c) => c.conversation_id === m.conversation_id && c.user_id === me.id));
route('GET', '/meetings', () => S.meetings.filter((m) => new Date(m.end_at) > new Date()).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)));
const meetingsRoute = routes[routes.length - 1];
meetingsRoute.fn = () => {
  const q = new URLSearchParams(lastQuery);
  let list = S.meetings.filter((m) => new Date(m.end_at) > new Date() && meetingVisible(m));
  if (q.get('space_id')) list = list.filter((m) => m.space_id === Number(q.get('space_id')));
  else if (q.get('conversation_id')) list = list.filter((m) => m.conversation_id === Number(q.get('conversation_id')));
  else list = list.filter((m) => m.organizer_id === me.id || m.attendees.some((a) => a.user_id === me.id));
  return list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
};
route('POST', '/meetings', (_, b) => {
  needCal();
  if (!b.title?.trim()) throw new HttpError(400, 'Meeting title is required');
  if (new Date(b.end) <= new Date(b.start)) throw new HttpError(400, 'Choose a valid start and end time');
  const ids = [me.id, ...(b.user_ids || []).map(Number)];
  if (!b.force) {
    const st = new Date(b.start); const en = new Date(b.end);
    const conflicts = ids.filter((id) => busyBetween(id, st, en).length)
      .map((id) => ({ email: userById(id).email, user_id: id, self: id === me.id, name: userById(id).name }));
    if (conflicts.length) {
      const err = new HttpError(409, `Calendar not clear at this time – busy: ${conflicts.map((c) => (c.self ? 'you' : c.name.split(' ')[0])).join(', ')}`);
      err.details = { conflicts };
      throw err;
    }
  }
  const attendees = [...ids.map((id) => ({ email: userById(id).email, user_id: id, name: userById(id).name, avatar_url: null })),
    ...(b.emails || []).map((e) => ({ email: e, user_id: null, name: e, avatar_url: null }))];
  const m = { id: nid(), title: b.title.trim(), description: b.description || null, start_at: b.start, end_at: b.end, time_zone: b.time_zone,
    meet_link: b.add_meet !== false ? 'https://meet.google.com/' : null, html_link: 'https://calendar.google.com/', organizer_id: me.id,
    organizer_name: me.name, space_id: Number(b.space_id) || null, conversation_id: Number(b.conversation_id) || null, attendees };
  S.meetings.push(m);
  const card = JSON.stringify({ meeting_id: m.id, title: m.title, start: m.start_at, end: m.end_at, meet_link: m.meet_link, html_link: m.html_link, organizer: me.name });
  if (m.space_id) postSpace(m.space_id, me.id, card, 'meeting');
  if (m.conversation_id) postDM(m.conversation_id, me.id, card, 'meeting');
  return m;
});
route('DELETE', '/meetings/:id', ([id]) => {
  const m = S.meetings.find((x) => x.id === id);
  if (!m) throw new HttpError(404, 'Meeting not found');
  if (m.organizer_id !== me.id) throw new HttpError(403, 'Only the organizer can cancel this meeting');
  S.meetings = S.meetings.filter((x) => x !== m);
  return { ok: true };
});

// ---------- file uploads/downloads: there is no server in the demo ----------
export async function apiUpload() {
  await new Promise((r) => setTimeout(r, 200));
  throw new Error('File uploads are not available in the demo');
}
export async function apiBlob() {
  throw new Error('Files are not available in the demo');
}

// ---------- api() — same signature as src/api.js ----------
let lastQuery = '';
export async function api(path, { method = 'GET', body } = {}) {
  await new Promise((r) => setTimeout(r, 90)); // feel like a network call
  const [clean, query = ''] = path.split('?');
  lastQuery = query;
  const r = routes.find((x) => x.method === method && x.re.test(clean));
  if (!r) throw new Error(`Demo: ${method} ${clean} not implemented`);
  try {
    if (clean !== '/auth/google') currentUser();
    const params = clean.match(r.re).slice(1).map(Number);
    const out = JSON.parse(JSON.stringify(r.fn(params, body || {})));
    if (clean === '/auth/google') scheduleIncomingCall(DEMO_USERS.find((u) => u.email === body.credential));
    return out;
  } catch (e) {
    if (e.status === 401 && clean !== '/auth/google') setToken(null);
    const err = new Error(e.message);
    err.status = e.status;
    err.data = { error: e.message, ...(e.details || {}) };
    throw err;
  }
}

// ---------- socket mock — same surface as src/socket.js ----------
const listeners = {};
function emitLocal(event, payload) { (listeners[event] || []).forEach((f) => f(payload)); }
const MENTION_RE = /@\[([^\]\n]{1,100})\]\((\d+)\)/g;
function replyOut(id) {
  if (!id) return null;
  const r = S.messages.find((x) => x.id === id);
  if (!r) return { id, deleted: true };
  const kind = r.kind || 'text';
  const preview = kind === 'meeting' ? '📅 Meeting' : kind === 'huddle' ? '🎧 Huddle' : kind === 'file' ? '📎 File' : r.body.replace(MENTION_RE, '@$1');
  return { id, user_id: r.user_id, name: userById(r.user_id)?.name, kind, preview: preview.slice(0, 200) };
}
function demoReceipt(cm) {
  emitLocal('dm:receipt', { conversationId: cm.conversation_id, userId: cm.user_id, lastReadId: cm.last_read_id, lastDeliveredId: Math.max(cm.last_delivered_id || 0, cm.last_read_id) });
}
const msgOut = (m) => ({ id: m.id, spaceId: m.space_id, kind: m.kind || 'text', body: m.body, created_at: m.created_at, user_id: m.user_id, name: userById(m.user_id)?.name, avatar_url: null, reply_to: replyOut(m.reply_to_id) });

const REPLIES = ['On it 👍', 'Sure, will update the ticket.', 'Noted!', 'Can we discuss this in the stand-up?', 'Done, please check.', 'Thanks for the update 🙌'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- simulated huddles (no real audio/video in the demo) ----
const HUDDLES = new Map();
const audience = (scope, id) => (scope === 'space' ? S.members.filter((m) => m.space_id === id).map((m) => m.user_id) : S.convMembers.filter((m) => m.conversation_id === id).map((m) => m.user_id));
const part = (uid, fake = true) => ({ socketId: `${fake ? 'sim' : 'me'}-${uid}`, userId: uid, name: userById(uid).name, avatar_url: null, audio: true, video: false, screen: false, joinedAt: Date.now(), simulated: fake, state: 'connected' });
function hSummary(h) { return { key: h.key, scope: h.scope, scopeId: h.scopeId, active: true, title: h.title, type: h.type, startedAt: h.startedAt, participants: h.participants }; }
function hTitle(scope, id, starter) {
  if (scope === 'space') return { title: S.spaces.find((s) => s.id === id)?.name, type: 'space' };
  const c = S.convs.find((x) => x.id === id);
  if (c.type === 'group') return { title: c.name || 'Group', type: 'group' };
  return { title: userById(starter).name, type: 'direct' };
}
function hEvent(h, uid, ev) {
  const body = JSON.stringify(ev);
  if (h.scope === 'space') postSpace(h.scopeId, uid, body, 'huddle'); else postDM(h.scopeId, uid, body, 'huddle');
}
function startSim(scope, id, starterId) {
  const key = `${scope}:${id}`;
  const t = hTitle(scope, id, starterId);
  const h = { key, scope, scopeId: id, startedAt: Date.now(), participants: [], peak: 0, timers: [], ...t };
  HUDDLES.set(key, h);
  hEvent(h, starterId, { event: 'started' });
  return h;
}
function simJoin(h, uid) {
  if (h.participants.some((p) => p.userId === uid)) return;
  const p = part(uid);
  h.participants.push(p);
  h.peak = Math.max(h.peak, h.participants.length);
  emitLocal('huddle:peer-joined', p);
  emitLocal('huddle:state', hSummary(h));
}
function endIfEmpty(h) {
  if (h.participants.some((p) => p.socketId.startsWith('me-'))) return;
  h.timers.forEach(clearTimeout);
  HUDDLES.delete(h.key);
  hEvent(h, h.participants[0]?.userId || me.id, { event: 'ended', minutes: Math.max(1, Math.round((Date.now() - h.startedAt) / 60000)), peak: h.peak });
  emitLocal('huddle:state', { key: h.key, active: false, participants: [] });
}

// An incoming 1:1 huddle a little after signing in, so the "ringing" flow can be tried
let ringTimer = null;
function scheduleIncomingCall(u) {
  clearTimeout(ringTimer);
  if (!u) return;
  ringTimer = setTimeout(() => {
    const caller = u.id === 2 ? 3 : 2;
    const c = S.convs.find((x) => x.type === 'direct' && S.convMembers.filter((m) => m.conversation_id === x.id).map((m) => m.user_id).sort().join() === [u.id, caller].sort().join());
    if (!c || !me || me.id !== u.id || HUDDLES.has(`conv:${c.id}`)) return;
    const h = startSim('conv', c.id, caller);
    simJoin(h, caller);
    emitLocal('huddle:ring', { huddle: hSummary(h), title: userById(caller).name, path: `/messages/${c.id}?huddle=1`, from: pub(userById(caller)) });
    // Caller hangs up if nobody joins
    h.timers.push(setTimeout(() => { if (!h.participants.some((p) => p.socketId.startsWith('me-'))) { h.participants = []; endIfEmpty(h); } }, 45000));
    // Re-ring every 4 s like the real server does, until you join (endIfEmpty clears these timers)
    h.timers.push(setInterval(() => { if (!h.participants.some((p) => p.socketId.startsWith('me-'))) emitLocal('huddle:ring-tick', { key: h.key || `conv:${c.id}` }); }, 4000));
  }, 9000);
}

const socket = {
  io: { on() {}, off() {} },
  on(e, f) { (listeners[e] ||= []).push(f); },
  off(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); },
  emit(e, data = {}, ack) {
    if (e === 'space:join') { ack?.({ ok: true }); return; }

    if (e === 'chat:send') {
      const spaceId = Number(data.spaceId);
      if (!roleOf(spaceId, me?.id)) { ack?.({ error: 'Not a member of this space' }); return; }
      postSpace(spaceId, me.id, String(data.body).slice(0, 4000), 'text', data.replyTo);
      ack?.({ ok: true });
      const others = S.members.filter((x) => x.space_id === spaceId && x.user_id !== me.id);
      if (!others.length) return;
      const who = userById(pick(others).user_id);
      setTimeout(() => emitLocal('chat:typing', { userId: who.id, name: who.name }), 700);
      setTimeout(() => postSpace(spaceId, who.id, pick(REPLIES)), 2200);
      return;
    }

    if (e === 'dm:send') {
      const id = Number(data.conversationId);
      try { convOf(id); } catch { ack?.({ error: 'Conversation not found' }); return; }
      const sent = postDM(id, me.id, String(data.body).slice(0, 4000));
      ack?.({ ok: true });
      const others = S.convMembers.filter((m) => m.conversation_id === id && m.user_id !== me.id);
      if (!others.length) return;
      // ✓✓ delivered to whoever is online, then blue ✓✓ once they "read" it
      setTimeout(() => others.filter((m) => ONLINE.has(m.user_id)).forEach((m) => { m.last_delivered_id = sent.id; demoReceipt(m); }), 400);
      setTimeout(() => others.filter((m) => ONLINE.has(m.user_id)).forEach((m) => { m.last_read_id = sent.id; demoReceipt(m); }), 1600);
      if (!others.some((m) => ONLINE.has(m.user_id))) return; // nobody online to reply
      const who = userById(pick(others).user_id);
      setTimeout(() => emitLocal('dm:typing', { conversationId: id, userId: who.id, name: who.name }), 800);
      setTimeout(() => postDM(id, who.id, pick(REPLIES)), 2400);
      return;
    }

    if (e === 'huddle:status') {
      const h = HUDDLES.get(`${data.scope}:${Number(data.id)}`);
      ack?.({ huddle: h ? hSummary(h) : null });
      return;
    }

    if (e === 'huddle:join') {
      const scope = data.scope; const id = Number(data.id);
      const allowed = scope === 'space' ? !!roleOf(id, me.id) : S.convMembers.some((m) => m.conversation_id === id && m.user_id === me.id);
      if (!allowed) { ack?.({ error: 'You are not a member here' }); return; }
      for (const other of HUDDLES.values()) { if (other.participants.some((p) => p.userId === me.id)) { other.participants = other.participants.filter((p) => p.userId !== me.id); endIfEmpty(other); } }
      let h = HUDDLES.get(`${scope}:${id}`);
      const isNew = !h;
      if (!h) h = startSim(scope, id, me.id);
      const peers = [...h.participants];
      const mine = part(me.id, false);
      h.participants.push(mine);
      h.peak = Math.max(h.peak, h.participants.length);
      ack?.({ ok: true, huddle: hSummary(h), peers, iceServers: [] });
      emitLocal('huddle:state', hSummary(h));
      if (isNew) {
        // Simulated teammates join after a moment
        const others = audience(scope, id).filter((u) => u !== me.id).slice(0, scope === 'space' ? 3 : 2);
        others.forEach((u, i) => h.timers.push(setTimeout(() => simJoin(h, u), 1800 + i * 2200)));
        if (others[0]) h.timers.push(setTimeout(() => emitLocal('huddle:media', { ...part(others[0]), audio: false }), 7000));
      }
      return;
    }

    if (e === 'huddle:leave') {
      for (const h of HUDDLES.values()) {
        if (h.participants.some((p) => p.userId === me.id && p.socketId.startsWith('me-'))) {
          h.participants = h.participants.filter((p) => !p.socketId.startsWith('me-'));
          if (h.type !== 'space' || h.participants.length <= 1) h.participants = [];
          endIfEmpty(h);
        }
      }
      ack?.({ ok: true });
    }
    // huddle:signal / huddle:media / typing: nothing to do in the demo
  },
  close() {},
};
export const getSocket = () => socket;
export const closeSocket = () => {};
