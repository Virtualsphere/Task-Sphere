import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import { fmtTime } from '../util';
import Avatar from './Avatar';
import { MeetingCard, HuddleEvent, applyMeetingUpdate } from './ChatCards';
import FileMessage from './FileMessage';
import { useChatFiles, AttachButton, PendingFiles, DropHint } from './ChatFiles';
import { MentionText, MentionPicker, mentionQuery, filterMembers, encodeMentions, mentionsUser, plainMentions } from './ChatText';
import { HuddleButton } from '../huddle/HuddleWindow';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// One-line preview of a message, for the "Replying to" bar
function previewOf(m) {
  if (m.kind === 'file') { const f = parse(m.body) || {}; return `📎 ${f.caption ? plainMentions(f.caption) : f.name || 'File'}`; }
  if (m.kind === 'meeting') return `📅 ${parse(m.body)?.title || 'Meeting'}`;
  return plainMentions(m.body);
}

// The quoted message shown at the top of a reply; click to jump to the original
function ReplyQuote({ reply, meId, onJump }) {
  if (reply.deleted) return <div className="reply-quote deleted">Original message was deleted</div>;
  return (
    <button type="button" className="reply-quote" onClick={() => onJump(reply.id)} title="Go to message">
      <span className="reply-quote-name">{reply.user_id === meId ? 'You' : reply.name}</span>
      <span className="reply-quote-text">{reply.preview}</span>
    </button>
  );
}

// Space chat — only members of the space can load history, join the room or send
export default function ChatPanel({ spaceId, spaceName, members = [], canSchedule, onSchedule, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState(null);      // message being replied to
  const [mention, setMention] = useState(null);      // { query, start } while typing "@..."
  const [mentionIdx, setMentionIdx] = useState(0);
  const picked = useRef(new Map());                  // people chosen from the @ list: id -> member
  const chat = useChatFiles(`/spaces/${spaceId}/attachments`);
  const bottomRef = useRef(null);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setReplyTo(null);
    api(`/spaces/${spaceId}/messages`).then((m) => {
      setMessages(m);
      setHasMore(m.length === 50);
      setTimeout(() => bottomRef.current?.scrollIntoView(), 0);
    }).catch((e) => setError(e.message));

    const socket = getSocket();
    const onMsg = (m) => {
      if (m.spaceId !== Number(spaceId)) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    };
    const onTyping = ({ userId, name }) => {
      if (userId === user.id) return;
      setTyping(`${name} is typing…`);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(''), 2500);
    };
    const onMeetingUpdated = (u) => setMessages((prev) => applyMeetingUpdate(prev, u));
    socket.on('chat:message', onMsg);
    socket.on('chat:typing', onTyping);
    socket.on('meeting:updated', onMeetingUpdated);
    return () => {
      socket.off('chat:message', onMsg);
      socket.off('chat:typing', onTyping);
      socket.off('meeting:updated', onMeetingUpdated);
    };
  }, [spaceId, user.id]);

  const loadOlder = async () => {
    const cur = messagesRef.current;
    if (!cur.length) return [];
    const older = await api(`/spaces/${spaceId}/messages?before=${cur[0].id}`);
    setHasMore(older.length === 50);
    setMessages((prev) => [...older, ...prev]);
    return older;
  };

  // Scroll to a message and flash it; loads older history if it isn't on screen yet
  const jumpTo = async (id) => {
    const find = () => bodyRef.current?.querySelector(`[data-msg-id="${id}"]`);
    let el = find();
    for (let i = 0; !el && i < 10; i++) {
      const older = await loadOlder().catch(() => []);
      if (!older.length) break;
      await new Promise((r) => setTimeout(r, 0));
      el = find();
    }
    if (!el) { setError('That message is too far back to show.'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  };

  const startReply = (m) => {
    setReplyTo(m);
    inputRef.current?.focus();
  };

  const send = async (e) => {
    e.preventDefault();
    if (chat.upload) return;
    const body = encodeMentions(text.trim(), picked.current);
    const reply = replyTo?.id || null;
    if (chat.files.length) {
      // Files go one by one; the typed text is sent as the caption of the first file
      if (await chat.sendFiles(body, { replyTo: reply })) { setText(''); setReplyTo(null); picked.current.clear(); }
      return;
    }
    if (!body) return;
    getSocket().emit('chat:send', { spaceId: Number(spaceId), body, replyTo: reply }, (res) => {
      if (res?.error) setError(res.error);
    });
    setText('');
    setReplyTo(null);
    setMention(null);
    picked.current.clear();
  };

  const updateMention = (value, caret) => {
    const q = mentionQuery(value, caret ?? value.length);
    if (q && filterMembers(members, q.query, user.id).length) {
      setMention(q);
      setMentionIdx(0);
    } else setMention(null);
  };

  const onType = (e) => {
    const v = e.target.value;
    setText(v);
    setError('');
    updateMention(v, e.target.selectionStart);
    if (Date.now() - lastTypingSent.current > 1500) {
      lastTypingSent.current = Date.now();
      getSocket().emit('chat:typing', { spaceId: Number(spaceId) });
    }
  };

  const options = mention ? filterMembers(members, mention.query, user.id) : [];

  const pickMention = (u) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? text.length;
    const insert = `@${u.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    picked.current.set(u.id, u);
    setText(next);
    setMention(null);
    const pos = mention.start + insert.length;
    setTimeout(() => { input?.focus(); input?.setSelectionRange(pos, pos); }, 0);
  };

  const onKeyDown = (e) => {
    if (mention && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(options[Math.min(mentionIdx, options.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); setReplyTo(null); }
  };

  return (
    <aside className={`chat-panel ${chat.dragging ? 'drag-over' : ''}`} {...chat.dragProps}>
      <DropHint chat={chat} label={spaceName || 'the space'} />
      <div className="chat-head">
        <strong className="grow">💬 Space chat</strong>
        <HuddleButton scope="space" id={spaceId} title={spaceName} compact />
        {canSchedule && <button className="btn small" onClick={onSchedule} title="Schedule a Google Meet">📅</button>}
        <button className="icon-btn" onClick={onClose} aria-label="Close chat">✕</button>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {hasMore && messages.length > 0 && <button className="btn small ghost load-older" onClick={loadOlder}>Load older</button>}
        {messages.length === 0 && <p className="muted small center-text">No messages yet. Say hi to the team 👋</p>}
        {messages.map((m, i) => {
          if (m.kind === 'huddle') return <HuddleEvent key={m.id} body={m.body} name={m.name} scope="space" scopeId={spaceId} />;
          const mine = m.user_id === user.id;
          const grouped = !m.reply_to && i > 0 && messages[i - 1].user_id === m.user_id && (messages[i - 1].kind || 'text') === 'text' && m.kind !== 'meeting';
          const toMe = !mine && (mentionsUser(m.body, user.id) || (m.kind === 'file' && mentionsUser(parse(m.body)?.caption, user.id)));
          return (
            <div key={m.id} data-msg-id={m.id} className={`msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${toMe ? 'mentions-me' : ''}`}
              onDoubleClick={() => startReply(m)}>
              {!mine && !grouped && <Avatar user={{ name: m.name, avatar_url: m.avatar_url }} size={24} />}
              <div className={`msg-bubble ${m.kind === 'meeting' ? 'plain' : ''}`}>
                {!grouped && <div className="msg-meta">{mine ? 'You' : m.name} · {fmtTime(m.created_at)}</div>}
                {m.reply_to && <ReplyQuote reply={m.reply_to} meId={user.id} onJump={jumpTo} />}
                {m.kind === 'meeting' ? <MeetingCard body={m.body} />
                  : m.kind === 'file' ? <FileMessage body={m.body} meId={user.id} />
                  : <MentionText text={m.body} meId={user.id} />}
              </div>
              <button type="button" className="msg-reply-btn" onClick={() => startReply(m)} title="Reply" aria-label="Reply">↩</button>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="typing muted small">{typing}</div>
      {(error || chat.error) && <p className="error small">{error || chat.error}</p>}
      <PendingFiles chat={chat} />
      {replyTo && (
        <div className="reply-bar">
          <div className="grow reply-bar-text">
            <span className="reply-quote-name">Replying to {replyTo.user_id === user.id ? 'yourself' : replyTo.name}</span>
            <span className="reply-quote-text">{previewOf(replyTo)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
        </div>
      )}
      <form className="chat-input" onSubmit={send}>
        <AttachButton chat={chat} />
        <div className="chat-input-wrap">
          {mention && <MentionPicker items={options} active={mentionIdx} onPick={pickMention} onHover={setMentionIdx} />}
          <input ref={inputRef} value={text} onChange={onType} onKeyDown={onKeyDown} onPaste={chat.onPaste}
            onBlur={() => setMention(null)} onClick={(e) => updateMention(text, e.target.selectionStart)}
            placeholder={chat.files.length ? 'Add a message (optional)' : 'Message the space… (@ to mention)'} maxLength={4000} />
        </div>
        <button className="btn primary" disabled={!!chat.upload || (!text.trim() && !chat.files.length)}>{chat.upload ? 'Sending…' : 'Send'}</button>
      </form>
    </aside>
  );
}
