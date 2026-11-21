// Personal chats: 1:1 and group conversations with anyone in your organization, huddles and meeting scheduling.
// Shows who is online (green glow), when they were last seen, and ✓ sent / ✓✓ delivered / blue ✓✓ read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import { fmtTime, fmtLastSeen } from '../util';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import ScheduleMeetingModal from '../components/ScheduleMeetingModal';
import { MeetingCard, HuddleEvent, applyMeetingUpdate } from '../components/ChatCards';
import FileMessage, { filePreviewText } from '../components/FileMessage';
import { useChatFiles, AttachButton, PendingFiles, DropHint } from '../components/ChatFiles';
import { HuddleButton } from '../huddle/HuddleWindow';
import { useHuddle } from '../huddle/HuddleContext';

export function convTitle(c, meId) {
  if (!c) return '';
  if (c.type === 'group') return c.name || c.members.filter((m) => m.id !== meId).map((m) => m.name.split(' ')[0]).join(', ');
  return c.members.find((m) => m.id !== meId)?.name || 'Just you';
}
const otherOf = (c, meId) => c.members.find((m) => m.id !== meId);

// Tick state of one of my messages: read when every other member has read it, delivered when it reached all of them
export function receiptOf(msgId, conv, meId) {
  const others = (conv?.members || []).filter((x) => x.id !== meId);
  if (!others.length) return 'sent';
  if (others.every((x) => (x.last_read_id || 0) >= msgId)) return 'read';
  if (others.every((x) => (x.last_delivered_id || 0) >= msgId)) return 'delivered';
  return 'sent';
}

function receiptTitle(msgId, conv, meId) {
  const others = (conv?.members || []).filter((x) => x.id !== meId);
  const first = (x) => x.name.split(' ')[0];
  if (conv.type !== 'group') return { read: 'Read', delivered: 'Delivered', sent: 'Sent' }[receiptOf(msgId, conv, meId)];
  const read = others.filter((x) => (x.last_read_id || 0) >= msgId);
  const delivered = others.filter((x) => !read.includes(x) && (x.last_delivered_id || 0) >= msgId);
  const parts = [];
  if (read.length) parts.push(`Read by ${read.map(first).join(', ')}`);
  if (delivered.length) parts.push(`Delivered to ${delivered.map(first).join(', ')}`);
  return parts.join(' · ') || 'Sent';
}

export function Ticks({ msgId, conv, meId }) {
  const state = receiptOf(msgId, conv, meId);
  return (
    <span className={`ticks ${state}`} title={receiptTitle(msgId, conv, meId)} aria-label={state}>
      {state === 'sent' ? '✓' : '✓✓'}
    </span>
  );
}

function preview(c, meId) {
  const m = c.last_message;
  if (!m) return 'No messages yet';
  const who = m.user_id === meId ? 'You: ' : c.type === 'group' ? `${m.name.split(' ')[0]}: ` : '';
  if (m.kind === 'meeting') return `${who}📅 Meeting scheduled`;
  if (m.kind === 'huddle') return '🎧 Huddle';
  if (m.kind === 'file') return who + filePreviewText(m.body);
  return who + m.body;
}

export default function Messages() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const huddle = useHuddle();
  const [convs, setConvs] = useState(null);
  const [people, setPeople] = useState([]);
  const [filter, setFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const loadConvs = useCallback(() => api('/conversations').then(setConvs).catch(() => setConvs([])), []);
  const loadPeople = useCallback(() => api('/people').then(setPeople).catch(() => {}), []);
  useEffect(() => { loadConvs(); loadPeople(); }, [loadConvs, loadPeople]);

  useEffect(() => {
    const s = getSocket();
    const refresh = () => loadConvs();
    const onPresence = ({ userId, online, last_seen_at }) => {
      const upd = (x) => (x.id === userId ? { ...x, online, ...(last_seen_at ? { last_seen_at } : {}) } : x);
      setPeople((p) => p.map(upd));
      setConvs((cs) => cs && cs.map((c) => ({ ...c, members: c.members.map(upd) })));
    };
    // Someone's delivered/read position moved: update ticks
    const onReceipt = ({ conversationId, userId, lastReadId, lastDeliveredId }) => {
      setConvs((cs) => cs && cs.map((c) => (c.id !== conversationId ? c : {
        ...c,
        members: c.members.map((m) => (m.id === userId ? { ...m, last_read_id: lastReadId, last_delivered_id: lastDeliveredId } : m)),
      })));
    };
    s.on('dm:message', refresh);
    s.on('conversation:new', refresh);
    s.on('conversation:updated', refresh);
    s.on('presence', onPresence);
    s.on('dm:receipt', onReceipt);
    return () => {
      s.off('dm:message', refresh); s.off('conversation:new', refresh); s.off('conversation:updated', refresh);
      s.off('presence', onPresence); s.off('dm:receipt', onReceipt);
    };
  }, [loadConvs]);

  const openDirect = async (personId) => {
    const c = await api('/conversations/direct', { method: 'POST', body: { user_id: personId } });
    await loadConvs();
    navigate(`/messages/${c.id}`);
  };

  const current = convs?.find((c) => String(c.id) === conversationId);
  const shown = (convs || []).filter((c) => convTitle(c, user.id).toLowerCase().includes(filter.toLowerCase()));
  const q = filter.trim().toLowerCase();
  const noChatWith = people
    .filter((p) => !(convs || []).some((c) => c.type === 'direct' && c.members.some((m) => m.id === p.id)))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));

  return (
    <div className="app-shell">
      <TopBar />
      <div className={`messages-layout ${conversationId ? 'has-thread' : ''}`}>
        <aside className="conv-list">
          <div className="conv-list-head">
            <h3>Messages</h3>
            <button className="btn primary small" onClick={() => setShowNew(true)}>+ New</button>
          </div>
          <input className="conv-search" placeholder="Search chats and people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {convs === null && <p className="muted small pad">Loading…</p>}
          {shown.map((c) => {
            const other = c.type === 'direct' ? otherOf(c, user.id) : null;
            const live = huddle?.states[`conv:${c.id}`];
            return (
              <Link key={c.id} to={`/messages/${c.id}`} className={`conv-item ${String(c.id) === conversationId ? 'active' : ''}`}>
                <div className="conv-avatar">
                  {other ? <Avatar user={other} size={36} online={other.online} /> : <span className="group-avatar">👥</span>}
                </div>
                <div className="grow">
                  <div className="row spread-row">
                    <strong className="clamp1">{convTitle(c, user.id)}</strong>
                    <span className="muted small nowrap">{c.last_message ? fmtTime(c.last_message.created_at).split(',').pop() : ''}</span>
                  </div>
                  <div className="row spread-row">
                    <span className={`small clamp1 ${c.unread ? '' : 'muted'}`}>
                      {live ? <span className="live-text">🎧 Huddle live · {live.participants.length}</span> : (
                        <>{c.last_message?.user_id === user.id && c.last_message.id && <Ticks msgId={c.last_message.id} conv={c} meId={user.id} />} {preview(c, user.id)}</>
                      )}
                    </span>
                    {c.unread > 0 && <span className="badge">{c.unread}</span>}
                  </div>
                </div>
              </Link>
            );
          })}
          {noChatWith.length > 0 && (
            <>
              <div className="sidebar-section"><span>People in your organization</span><span>{noChatWith.length}</span></div>
              {noChatWith.map((p) => (
                <button key={p.id} className="conv-item" onClick={() => openDirect(p.id)}>
                  <div className="conv-avatar"><Avatar user={p} size={30} online={p.online} /></div>
                  <div className="grow">
                    <div className="clamp1">{p.name}</div>
                    <div className={`small clamp1 ${p.online ? 'online-text' : 'muted'}`}>{fmtLastSeen(p)}</div>
                  </div>
                  <span className="muted small">Chat</span>
                </button>
              ))}
            </>
          )}
          {convs && !convs.length && !people.length && (
            <p className="muted small pad">Nobody else from your organization has signed in yet.</p>
          )}
        </aside>

        <main className="thread-area">
          {current ? (
            <Thread key={current.id} conv={current} people={people} onChanged={loadConvs} />
          ) : (
            <div className="empty thread-empty">
              <h3>💬 Personal chats & huddles</h3>
              <p className="muted">Message anyone in your organization, start a group, jump into a huddle, or schedule a Google Meet.</p>
              <button className="btn primary" onClick={() => setShowNew(true)}>Start a conversation</button>
            </div>
          )}
        </main>
      </div>
      {showNew && (
        <NewChatModal people={people} onClose={() => setShowNew(false)}
          onDirect={(id) => { setShowNew(false); openDirect(id); }}
          onGroup={async (c) => { setShowNew(false); await loadConvs(); navigate(`/messages/${c.id}`); }} />
      )}
    </div>
  );
}

function Thread({ conv, people, onChanged }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState('');
  const [error, setError] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const chat = useChatFiles(`/conversations/${conv.id}/attachments`);
  const bottom = useRef(null);
  const typingTimer = useRef(null);
  const lastTyping = useRef(0);
  const title = convTitle(conv, user.id);
  const other = conv.type === 'direct' ? otherOf(conv, user.id) : null;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastMarked = useRef(0);

  // Only counts as read while this window is actually being looked at (blue ✓✓ for the sender)
  const markRead = (list) => {
    const last = list[list.length - 1];
    if (!last || last.id <= lastMarked.current || document.visibilityState !== 'visible') return;
    lastMarked.current = last.id;
    api(`/conversations/${conv.id}/read`, { method: 'POST', body: { last_id: last.id } }).then(() => window.dispatchEvent(new Event('pm:read'))).catch(() => {});
  };
  useEffect(() => {
    const onVisible = () => markRead(messagesRef.current);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMeetings = () => api(`/meetings?conversation_id=${conv.id}`).then(setMeetings).catch(() => {});

  useEffect(() => {
    api(`/conversations/${conv.id}/messages`).then((m) => {
      setMessages(m); setHasMore(m.length === 50); markRead(m);
      setTimeout(() => bottom.current?.scrollIntoView(), 0);
    });
    loadMeetings();
    const s = getSocket();
    const onMsg = (m) => {
      if (m.conversationId !== conv.id) return;
      setMessages((prev) => { const next = prev.some((x) => x.id === m.id) ? prev : [...prev, m]; markRead(next); return next; });
      if (m.kind === 'meeting') loadMeetings();
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    };
    const onTyping = (t) => {
      if (t.conversationId !== conv.id) return;
      setTyping(`${t.name.split(' ')[0]} is typing…`);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(''), 2500);
    };
    const onMeetingUpdated = (u) => { setMessages((prev) => applyMeetingUpdate(prev, u)); loadMeetings(); };
    s.on('dm:message', onMsg);
    s.on('dm:typing', onTyping);
    s.on('meeting:updated', onMeetingUpdated);
    return () => { s.off('dm:message', onMsg); s.off('dm:typing', onTyping); s.off('meeting:updated', onMeetingUpdated); };
  }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    const older = await api(`/conversations/${conv.id}/messages?before=${messages[0].id}`);
    setHasMore(older.length === 50);
    setMessages((m) => [...older, ...m]);
  };

  const send = async (e) => {
    e.preventDefault();
    if (chat.upload) return;
    const body = text.trim();
    if (chat.files.length) {
      // Files go one by one; the typed text is sent as the caption of the first file
      if (await chat.sendFiles(body)) setText('');
      return;
    }
    if (!body) return;
    getSocket().emit('dm:send', { conversationId: conv.id, body }, (r) => r?.error && setError(r.error));
    setText('');
  };
  const onType = (v) => {
    setText(v);
    if (Date.now() - lastTyping.current > 1500) { lastTyping.current = Date.now(); getSocket().emit('dm:typing', { conversationId: conv.id }); }
  };

  const leaveGroup = async () => {
    if (!confirm('Leave this group?')) return;
    await api(`/conversations/${conv.id}/members/me`, { method: 'DELETE' });
    onChanged(); navigate('/messages');
  };
  const rename = async () => {
    const name = prompt('Group name', conv.name || '');
    if (name === null) return;
    await api(`/conversations/${conv.id}`, { method: 'PATCH', body: { name } });
    onChanged();
  };

  return (
    <div className={`thread ${chat.dragging ? 'drag-over' : ''}`} {...chat.dragProps}>
      <DropHint chat={chat} label={title} />
      <div className="thread-head">
        <button className="icon-btn back-btn show-md" onClick={() => navigate('/messages')} aria-label="Back to chats">←</button>
        <div className="conv-avatar">
          {other ? <Avatar user={other} size={38} online={other.online} /> : <span className="group-avatar big">👥</span>}
        </div>
        <div className="grow">
          <strong>{title}</strong>
          <div className={`small ${other?.online && !typing ? 'online-text' : 'muted'}`}>
            {typing ? <span className="typing-text">{typing}</span>
              : other ? <span title={other.email}>{fmtLastSeen(other)}</span>
              : <GroupStatus conv={conv} meId={user.id} />}
          </div>
        </div>
        <div className="thread-actions">
          <HuddleButton scope="conv" id={conv.id} title={title} />
          <button className="btn small" onClick={() => setShowSchedule(true)} title="Schedule a Google Meet">📅 <span className="hide-sm">Schedule</span></button>
          {conv.type === 'group' && (
            <>
              <button className="btn small" onClick={() => setShowAdd(true)} title="Add people" aria-label="Add people">＋👤</button>
              <button className="btn small" onClick={rename} title="Rename" aria-label="Rename group">✎</button>
              <button className="btn small" onClick={leaveGroup} title="Leave group" aria-label="Leave group">⎋</button>
            </>
          )}
        </div>
      </div>

      {meetings.length > 0 && (
        <div className="upcoming-strip">
          {meetings.slice(0, 3).map((m) => (
            <span key={m.id} className="upcoming-pill">
              📅 <strong>{m.title}</strong> · {new Date(m.start_at).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              {m.meet_link && <a href={m.meet_link} target="_blank" rel="noreferrer">Join</a>}
            </span>
          ))}
        </div>
      )}

      <div className="thread-body">
        {hasMore && <button className="btn small ghost load-older" onClick={loadOlder}>Load older</button>}
        {messages.length === 0 && <p className="muted small center-text">Say hi to {title.split(' ')[0]} 👋</p>}
        {messages.map((m, i) => {
          if (m.kind === 'huddle') return <HuddleEvent key={m.id} body={m.body} name={m.name} scope="conv" scopeId={conv.id} title={title} />;
          const mine = m.user_id === user.id;
          const grouped = i > 0 && messages[i - 1].user_id === m.user_id && messages[i - 1].kind === 'text';
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
              {!mine && !grouped && <Avatar user={{ name: m.name, avatar_url: m.avatar_url }} size={26} />}
              <div className={`msg-bubble ${m.kind === 'meeting' ? 'plain' : ''}`}>
                {!grouped && <div className="msg-meta">{mine ? 'You' : m.name} · {fmtTime(m.created_at)}</div>}
                {m.kind === 'meeting' ? <MeetingCard body={m.body} />
                  : m.kind === 'file' ? <FileMessage body={m.body} />
                  : <div className="msg-text">{m.body}</div>}
                {mine && <div className="msg-status"><Ticks msgId={m.id} conv={conv} meId={user.id} /></div>}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {(error || chat.error) && <p className="error small pad">{error || chat.error}</p>}
      <PendingFiles chat={chat} />
      <form className="chat-input" onSubmit={send}>
        <AttachButton chat={chat} />
        <input value={text} onChange={(e) => onType(e.target.value)} onPaste={chat.onPaste}
          placeholder={chat.files.length ? 'Add a message (optional)' : `Message ${title}`} maxLength={4000} autoFocus />
        <button className="btn primary" disabled={!!chat.upload || (!text.trim() && !chat.files.length)}>{chat.upload ? 'Sending…' : 'Send'}</button>
      </form>

      {showSchedule && (
        <ScheduleMeetingModal people={conv.members} preselected={conv.members.map((m) => m.id)} conversationId={conv.id}
          contextLabel={title} onClose={() => setShowSchedule(false)} onCreated={() => { setShowSchedule(false); loadMeetings(); }} />
      )}
      {showAdd && (
        <PeoplePicker title="Add people" people={people.filter((p) => !conv.members.some((m) => m.id === p.id))} min={1}
          action="Add" onClose={() => setShowAdd(false)}
          onPick={async (ids) => { await api(`/conversations/${conv.id}/members`, { method: 'POST', body: { user_ids: ids } }); setShowAdd(false); onChanged(); }} />
      )}
    </div>
  );
}

// "3 of 5 online · Aarav, Riya, …" under a group's name
function GroupStatus({ conv, meId }) {
  const others = conv.members.filter((m) => m.id !== meId);
  const online = others.filter((m) => m.online).length;
  return (
    <span>
      {conv.members.length} members{online ? <> · <span className="online-text">{online} online</span></> : ''} · {conv.members.map((m) => m.name.split(' ')[0]).join(', ')}
    </span>
  );
}

function NewChatModal({ people: everyone, onClose, onDirect, onGroup }) {
  const [mode, setMode] = useState('direct');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const people = everyone.filter((p) => !term || p.name.toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term));
  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="seg full">
        <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>Direct message</button>
        <button className={mode === 'group' ? 'active' : ''} onClick={() => setMode('group')}>Group chat</button>
      </div>
      <input className="conv-search" placeholder="Search people by name or email…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {mode === 'direct' ? (
        <div className="member-list">
          {people.length === 0 && <p className="muted small">{term ? 'Nobody matches that search.' : 'People from your organization appear here once they have signed in.'}</p>}
          {people.map((p) => (
            <button key={p.id} className="member-row as-btn" onClick={() => onDirect(p.id)}>
              <div className="conv-avatar"><Avatar user={p} size={32} online={p.online} /></div>
              <div className="grow"><strong>{p.name}</strong><div className="muted small">{p.email}</div></div>
              <span className={`small nowrap ${p.online ? 'online-text' : 'muted'}`}>{fmtLastSeen(p)}</span>
            </button>
          ))}
        </div>
      ) : (
        <PeoplePicker inline people={people} min={2} action="Create group" withName
          onPick={async (ids, name) => {
            try { onGroup(await api('/conversations/group', { method: 'POST', body: { user_ids: ids, name } })); }
            catch (e) { setError(e.message); }
          }} />
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function PeoplePicker({ people, min, action, withName, inline, title, onPick, onClose }) {
  const [sel, setSel] = useState(new Set());
  const [name, setName] = useState('');
  const body = (
    <div className="form">
      {withName && <label>Group name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RFID Dev Team" /></label>}
      <div className="people-pick column-pick">
        {people.length === 0 && <span className="muted small">No one else to add.</span>}
        {people.map((p) => (
          <label key={p.id} className={`person-chip ${sel.has(p.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
            <Avatar user={p} size={22} online={p.online} /> {p.name}
          </label>
        ))}
      </div>
      <div className="form-actions">
        <span className="muted small grow">{min > 1 ? `Pick at least ${min} people` : ''}</span>
        <button className="btn primary" disabled={sel.size < min} onClick={() => onPick([...sel], name)}>{action}</button>
      </div>
    </div>
  );
  return inline ? body : <Modal title={title} onClose={onClose}>{body}</Modal>;
}
