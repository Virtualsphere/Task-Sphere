// @mentions in chat and task comments. A mention is stored in the text as @[Name](userId);
// the server checks it is a member of the space and fixes the name.
import { forwardRef, useState } from 'react';
import Avatar from './Avatar';

const MENTION_RE = /@\[([^\]\n]{1,100})\]\((\d+)\)/g;

export const mentionsUser = (text, userId) =>
  [...String(text || '').matchAll(MENTION_RE)].some((m) => Number(m[2]) === userId);

export const plainMentions = (text) => String(text || '').replace(MENTION_RE, '@$1');

// Message text with mentions shown as highlighted names
export function MentionText({ text, meId, className = 'msg-text' }) {
  const s = String(text || '');
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(MENTION_RE)) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const me = Number(m[2]) === meId;
    parts.push(<span key={m.index} className={`mention ${me ? 'me' : ''}`}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <div className={className}>{parts}</div>;
}

// What the user is typing after "@" right before the caret, or null
export function mentionQuery(value, caret) {
  const m = /(^|\s)@([^@\n]{0,30})$/.exec(value.slice(0, caret));
  return m ? { query: m[2], start: caret - m[2].length - 1 } : null;
}

export function filterMembers(members, query, meId) {
  const q = query.trim().toLowerCase();
  return members
    .filter((u) => u.id !== meId)
    .filter((u) => !q || u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || u.name.toLowerCase().startsWith(q))
    .slice(0, 8);
}

// Turns the "@Name" texts the user picked from the list into @[Name](id) before sending
export function encodeMentions(text, picked) {
  let out = text;
  const list = [...picked.values()].sort((a, b) => b.name.length - a.name.length);
  for (const u of list) {
    const esc = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\w\\]])@${esc}(?![\\w])`, 'g'), (all, pre) => `${pre}@[${u.name}](${u.id})`);
  }
  return out;
}

// Pop-up list of space members shown while typing "@..."
export function MentionPicker({ items, active, onPick, onHover }) {
  if (!items.length) return null;
  return (
    <div className="mention-picker" role="listbox">
      {items.map((u, i) => (
        <button type="button" key={u.id} role="option" aria-selected={i === active}
          className={`mention-option ${i === active ? 'active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onPick(u); }} onMouseEnter={() => onHover(i)}>
          <Avatar user={u} size={22} />
          <span className="grow">{u.name}</span>
          {u.role && <span className="muted small">{u.role}</span>}
        </button>
      ))}
    </div>
  );
}

// A textarea with the @ picker. `picked` is a ref to a Map of chosen people (id -> member);
// pass the text through encodeMentions(text, picked.current) before saving.
export const MentionTextarea = forwardRef(function MentionTextarea({ value, onChange, members, meId, picked, onKeyDown, pickerAbove, ...rest }, ref) {
  const [mention, setMention] = useState(null);
  const [active, setActive] = useState(0);
  const options = mention ? filterMembers(members, mention.query, meId) : [];

  const update = (v, caret) => {
    const q = mentionQuery(v, caret ?? v.length);
    if (q && filterMembers(members, q.query, meId).length) { setMention(q); setActive(0); } else setMention(null);
  };

  const pick = (u, el) => {
    const caret = el?.selectionStart ?? value.length;
    const insert = `@${u.name} `;
    picked.current.set(u.id, u);
    onChange(value.slice(0, mention.start) + insert + value.slice(caret));
    setMention(null);
    const pos = mention.start + insert.length;
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos, pos); }, 0);
  };

  const keyDown = (e) => {
    if (mention && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(active, options.length - 1)], e.target); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
    }
    onKeyDown?.(e);
  };

  return (
    <div className={`mention-wrap ${pickerAbove ? 'above' : ''}`}>
      {mention && (
        <MentionPicker items={options} active={active} onHover={setActive}
          onPick={(u) => pick(u, ref && typeof ref !== 'function' ? ref.current : document.activeElement)} />
      )}
      <textarea ref={ref} value={value} {...rest}
        onChange={(e) => { onChange(e.target.value); update(e.target.value, e.target.selectionStart); }}
        onKeyDown={keyDown} onBlur={() => setMention(null)} onClick={(e) => update(value, e.target.selectionStart)} />
    </div>
  );
});
