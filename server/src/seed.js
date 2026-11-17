// Loads sample data for local testing: test users, spaces, lists, tickets and chats.
// Runs only when the database has no users yet (use --force to add anyway). Run: npm run seed
require('dotenv').config();
const db = require('./db');
const { METHODOLOGIES } = require('./methodologies');

const DOMAIN = process.env.SEED_DOMAIN || 'virtualsphere.test';
const USERS = [
  ['vikalp', 'Vikalp Paliwal'],
  ['aarav', 'Aarav Mehta'],
  ['riya', 'Riya Jain'],
  ['karan', 'Karan Verma'],
  ['neha', 'Neha Sharma'],
];

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function q(sql, params) { const [r] = await db.query(sql, params); return r; }

async function main() {
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0 && !process.argv.includes('--force')) {
    console.log(`Seed skipped: database already has ${n} users.`);
    return;
  }
  const ids = {};
  for (const [key, name] of USERS) {
    const email = `${key}@${DOMAIN}`;
    await q('INSERT IGNORE INTO users (google_id, email, name) VALUES (?, ?, ?)', [`test-${key}`, email, name]);
    ids[key] = (await q('SELECT id FROM users WHERE email = ?', [email]))[0].id;
  }

  async function space(name, description, color, owner, members) {
    const r = await q('INSERT INTO spaces (name, description, color, owner_id) VALUES (?, ?, ?, ?)', [name, description, color, ids[owner]]);
    for (const [k, role] of members) await q('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)', [r.insertId, ids[k], role]);
    return r.insertId;
  }
  async function list(spaceId, name, description, methodology) {
    const r = await q('INSERT INTO lists (space_id, name, description, methodology, created_by) VALUES (?, ?, ?, ?, ?)', [spaceId, name, description, methodology, ids.vikalp]);
    const st = [];
    for (const [i, s] of METHODOLOGIES[methodology].statuses.entries()) {
      st.push((await q('INSERT INTO list_statuses (list_id, name, color, position, is_done) VALUES (?, ?, ?, ?, ?)', [r.insertId, s.name, s.color, i, s.is_done ? 1 : 0])).insertId);
    }
    return { id: r.insertId, st };
  }
  let pos = 0;
  async function ticket(l, title, statusIdx, priority, assignees, start, due, description, subtasks = [], comments = []) {
    const r = await q(
      'INSERT INTO tickets (list_id, title, description, status_id, priority, start_date, due_date, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [l.id, title, description || null, l.st[statusIdx], priority, start, due, ++pos, ids.vikalp]);
    for (const a of assignees) await q('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [r.insertId, ids[a]]);
    for (const [t, done, who] of subtasks) await q('INSERT INTO subtasks (ticket_id, title, is_done, assignee_id, position) VALUES (?, ?, ?, ?, ?)', [r.insertId, t, done ? 1 : 0, who ? ids[who] : null, ++pos]);
    for (const [who, body] of comments) await q('INSERT INTO comments (ticket_id, user_id, body) VALUES (?, ?, ?)', [r.insertId, ids[who], body]);
  }

  const p = await space('Virtualsphere Products', 'RFID software products – warehouse, school attendance, jewellery ERP', '#6366f1', 'vikalp',
    [['vikalp', 'owner'], ['aarav', 'admin'], ['riya', 'member'], ['karan', 'viewer']]);
  const w = await list(p, 'RFID Warehouse App v2', 'Multi-warehouse gate In/Out and handheld stock counts', 'AGILE');
  await ticket(w, 'Gate reader In/Out API', 2, 'urgent', ['vikalp', 'riya'], day(-5), day(-1), 'REST + socket endpoints for UHF gate readers; detect In vs Out by antenna.',
    [['Socket listener for reader events', true, 'riya'], ['Debounce duplicate tag reads', false, 'vikalp'], ['Write API docs', false, null]],
    [['aarav', 'Reader firmware updated on gate 2, please retest.'], ['vikalp', 'Retested – In events working, Out pending.']]);
  await ticket(w, 'Handheld stock count sync', 2, 'high', ['riya'], day(-3), day(6), 'Sync offline scans and show variance report.', [['Offline queue', true, 'riya'], ['Variance report', false, 'riya']]);
  await ticket(w, 'Warehouse transfer report', 0, 'normal', ['aarav'], null, day(14));
  await ticket(w, 'Low-stock SMS alerts', 1, 'low', [], null, null);
  await ticket(w, 'Tag encoding screen fixes', 4, 'high', ['riya'], day(-6), day(1), '128-bit EPC write fails on second attempt.', [], [['aarav', 'QA: reproducible on handheld H2.']]);
  await ticket(w, 'Client UAT sign-off', 5, 'normal', ['aarav'], day(-4), day(3));
  await ticket(w, 'Multi-warehouse setup', 6, 'normal', ['vikalp', 'aarav'], day(-25), day(-12));
  const sa = await list(p, 'School Attendance', 'Gate readers + parent SMS on entry/exit', 'SCRUM');
  await ticket(sa, 'Parent SMS on entry/exit', 2, 'high', ['riya'], day(-2), day(4));
  await ticket(sa, 'Student registration via desktop reader', 3, 'normal', ['vikalp'], day(-6), day(0));
  await ticket(sa, 'Attendance dashboard for principal', 1, 'normal', ['aarav'], null, day(10));
  const j = await list(p, 'Jewellery ERP', 'Billing, RFID inventory, gold loan', 'SDLC');
  await ticket(j, 'Gold loan (girvi) module', 1, 'high', ['vikalp', 'aarav'], day(-1), day(20));
  await ticket(j, 'GST billing with HUID', 2, 'urgent', ['riya'], day(-7), day(2));

  const s2 = await space('Sales & Marketing', 'Leads, demos and campaigns', '#f59e0b', 'aarav', [['aarav', 'owner'], ['vikalp', 'member'], ['neha', 'member'], ['karan', 'member']]);
  const ls = await list(s2, 'Lead follow-ups', '', 'KANBAN');
  await ticket(ls, 'UDM9R reader demo for distributor', 2, 'high', ['neha'], day(-1), day(2));
  await ticket(ls, 'Google Ads campaign review', 0, 'normal', ['vikalp'], null, day(8));

  for (const [s, who, body] of [[p, 'aarav', 'Morning team, client demo moved to Friday.'], [p, 'vikalp', 'Noted. Gate API will be ready by Thursday.'], [p, 'riya', 'Stock count sync done today 👍']]) {
    await q('INSERT INTO messages (space_id, user_id, body) VALUES (?, ?, ?)', [s, ids[who], body]);
  }

  async function conv(type, members, name, msgs) {
    const key = type === 'direct' ? members.map((m) => ids[m]).sort((a, b) => a - b).join(':') : null;
    const r = await q('INSERT INTO conversations (type, name, direct_key, created_by, last_message_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)', [type, name, key, ids[members[0]]]);
    for (const m of members) await q('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [r.insertId, ids[m]]);
    for (const [who, body] of msgs) await q('INSERT INTO direct_messages (conversation_id, user_id, body) VALUES (?, ?, ?)', [r.insertId, ids[who], body]);
  }
  await conv('direct', ['vikalp', 'aarav'], null, [['aarav', 'Hey, can we quickly discuss the gate API?'], ['vikalp', 'Sure, start a huddle in 5 min']]);
  await conv('group', ['vikalp', 'aarav', 'riya'], 'RFID Dev Team', [['riya', 'Build 2.3 is on staging 🚀']]);
  await conv('direct', ['riya', 'vikalp'], null, [['riya', 'Leave applied on greytHR for Monday']]);

  console.log(`Sample data loaded. Test users: ${USERS.map(([k]) => `${k}@${DOMAIN}`).join(', ')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
