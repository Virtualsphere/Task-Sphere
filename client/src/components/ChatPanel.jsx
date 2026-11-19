import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import { fmtTime } from '../util';
import Avatar from './Avatar';
import { MeetingCard, HuddleEvent, applyMeetingUpdate } from './ChatCards';
import FileMessage from './FileMessage';
import { useChatFiles, AttachButton, PendingFiles, DropHint } from './ChatFiles';
import { HuddleButton } from '../huddle/HuddleWindow';

// Space chat — only members of the space can load history, join the room or send
export default function ChatPanel({ spaceId, spaceName, canSchedule, onSchedule, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const chat = useChatFiles(`/spaces/${spaceId}/attachments`);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    setMessages([]);
    setHasMore(true);
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
    if (!messages.length) return;
    const older = await api(`/spaces/${spaceId}/messages?before=${messages[0].id}`);
    setHasMore(older.length === 50);
    setMessages((prev) => [...older, ...prev]);
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
    getSocket().emit('chat:send', { spaceId: Number(spaceId), body }, (res) => {
      if (res?.error) setError(res.error);
    });
    setText('');
  };

  const onType = (v) => {
    setText(v);
    if (Date.now() - lastTypingSent.current > 1500) {
      lastTypingSent.current = Date.now();
      getSocket().emit('chat:typing', { spaceId: Number(spaceId) });
    }
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
      <div className="chat-body">
        {hasMore && messages.length > 0 && <button className="btn small ghost load-older" onClick={loadOlder}>Load older</button>}
        {messages.length === 0 && <p className="muted small center-text">No messages yet. Say hi to the team 👋</p>}
        {messages.map((m, i) => {
          if (m.kind === 'huddle') return <HuddleEvent key={m.id} body={m.body} name={m.name} scope="space" scopeId={spaceId} />;
          const mine = m.user_id === user.id;
          const grouped = i > 0 && messages[i - 1].user_id === m.user_id && (messages[i - 1].kind || 'text') === 'text' && m.kind !== 'meeting';
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
              {!mine && !grouped && <Avatar user={{ name: m.name, avatar_url: m.avatar_url }} size={24} />}
              <div className={`msg-bubble ${m.kind === 'meeting' ? 'plain' : ''}`}>
                {!grouped && <div className="msg-meta">{mine ? 'You' : m.name} · {fmtTime(m.created_at)}</div>}
                {m.kind === 'meeting' ? <MeetingCard body={m.body} />
                  : m.kind === 'file' ? <FileMessage body={m.body} />
                  : <div className="msg-text">{m.body}</div>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="typing muted small">{typing}</div>
      {(error || chat.error) && <p className="error small">{error || chat.error}</p>}
      <PendingFiles chat={chat} />
      <form className="chat-input" onSubmit={send}>
        <AttachButton chat={chat} />
        <input value={text} onChange={(e) => onType(e.target.value)} onPaste={chat.onPaste}
          placeholder={chat.files.length ? 'Add a message (optional)' : 'Message the space…'} maxLength={4000} />
        <button className="btn primary" disabled={!!chat.upload || (!text.trim() && !chat.files.length)}>{chat.upload ? 'Sending…' : 'Send'}</button>
      </form>
    </aside>
  );
}
