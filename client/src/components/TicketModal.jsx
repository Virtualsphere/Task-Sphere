import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { PRIORITIES, can, fmtTime, priorityOf } from '../util';
import Modal from './Modal';
import Avatar from './Avatar';

export default function TicketModal({ ticketId, statuses, members, version, onClose, onDeleted }) {
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [comment, setComment] = useState('');
  const [sub, setSub] = useState({ title: '', assignee_id: '', priority: 'normal', due_date: '' });
  const [error, setError] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const load = () =>
    api(`/tickets/${ticketId}`)
      .then((d) => { setT(d); setDraft((prev) => (prev._loaded ? prev : { title: d.title, description: d.description || '', _loaded: true })); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, [ticketId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t) return <Modal title="Ticket" onClose={onClose}>{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</Modal>;

  const editable = can(t.my_role, 'member');
  const canDelete = can(t.my_role, 'admin') || t.created_by === user.id;

  const save = async (patch) => {
    setError('');
    try { setT({ ...(await api(`/tickets/${ticketId}`, { method: 'PATCH', body: patch })), my_role: t.my_role }); }
    catch (e) { setError(e.message); }
  };
  const call = async (path, method, body) => {
    setError('');
    try { setT({ ...(await api(path, { method, body })), my_role: t.my_role }); return true; }
    catch (e) { setError(e.message); return false; }
  };

  const assigneeIds = t.assignees.map((a) => a.id);
  const toggleAssignee = (id) =>
    save({ assignee_ids: assigneeIds.includes(id) ? assigneeIds.filter((x) => x !== id) : [...assigneeIds, id] });

  const del = async () => {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    try { await api(`/tickets/${ticketId}`, { method: 'DELETE' }); onDeleted(); }
    catch (e) { setError(e.message); }
  };

  const doneCount = t.subtasks.filter((s) => s.is_done).length;

  return (
    <Modal title={`Ticket #${t.id}`} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      <div className="ticket-layout">
        <div className="ticket-main">
          <input
            className="title-input"
            value={draft.title}
            disabled={!editable}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onBlur={() => draft.title.trim() && draft.title !== t.title && save({ title: draft.title })}
          />
          <div className="field-label">Description</div>
          <textarea
            rows={6}
            value={draft.description}
            disabled={!editable}
            placeholder="Add details, acceptance criteria, links…"
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          {editable && draft.description !== (t.description || '') && (
            <div className="row gap">
              <button className="btn primary small" onClick={() => save({ description: draft.description })}>Save description</button>
              <button className="btn small" onClick={() => setDraft({ ...draft, description: t.description || '' })}>Cancel</button>
            </div>
          )}

          <div className="section-head">
            <div className="field-label">Subtasks {t.subtasks.length > 0 && <span className="muted">({doneCount}/{t.subtasks.length})</span>}</div>
          </div>
          {t.subtasks.length > 0 && (
            <div className="progress"><div style={{ width: `${(doneCount / t.subtasks.length) * 100}%` }} /></div>
          )}
          <div className="subtasks">
            {t.subtasks.map((s) => (
              <div className={`subtask ${s.is_done ? 'done' : ''}`} key={s.id}>
                <input type="checkbox" checked={!!s.is_done} disabled={!editable} onChange={(e) => call(`/subtasks/${s.id}`, 'PATCH', { is_done: e.target.checked })} />
                <span className="flag" style={{ color: priorityOf(s.priority).color }} title={priorityOf(s.priority).label}>⚑</span>
                <span className="grow">{s.title}</span>
                <select value={s.assignee_id || ''} disabled={!editable} onChange={(e) => call(`/subtasks/${s.id}`, 'PATCH', { assignee_id: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="date" value={s.due_date || ''} disabled={!editable} onChange={(e) => call(`/subtasks/${s.id}`, 'PATCH', { due_date: e.target.value || null })} />
                {editable && <button className="icon-btn danger" onClick={() => call(`/subtasks/${s.id}`, 'DELETE')} aria-label="Delete subtask">✕</button>}
              </div>
            ))}
          </div>
          {editable && (
            <form className="add-subtask" onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`/tickets/${ticketId}/subtasks`, 'POST', { ...sub, assignee_id: sub.assignee_id || null, due_date: sub.due_date || null })) {
                setSub({ title: '', assignee_id: '', priority: 'normal', due_date: '' });
              }
            }}>
              <input className="grow" placeholder="Add a subtask…" value={sub.title} onChange={(e) => setSub({ ...sub, title: e.target.value })} />
              <select value={sub.priority} onChange={(e) => setSub({ ...sub, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <select value={sub.assignee_id} onChange={(e) => setSub({ ...sub, assignee_id: e.target.value })}>
                <option value="">Assignee</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button className="btn small" disabled={!sub.title.trim()}>Add</button>
            </form>
          )}

          <div className="field-label">Comments</div>
          {editable && (
            <form className="comment-form" onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`/tickets/${ticketId}/comments`, 'POST', { body: comment })) setComment('');
            }}>
              <textarea rows={2} placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="btn primary small" disabled={!comment.trim()}>Comment</button>
            </form>
          )}
          <div className="comments">
            {t.comments.length === 0 && <p className="muted small">No comments yet.</p>}
            {t.comments.map((c, i) => (
              <div className={`comment ${i === 0 ? 'latest' : ''}`} key={c.id}>
                <Avatar user={{ name: c.name, avatar_url: c.avatar_url }} size={28} />
                <div className="grow">
                  <div className="comment-meta">
                    <strong>{c.name}</strong> <span className="muted small">{fmtTime(c.created_at)}</span>
                    {i === 0 && <span className="tag">Latest</span>}
                  </div>
                  <div className="comment-body">{c.body}</div>
                </div>
                {(c.user_id === user.id || can(t.my_role, 'admin')) && (
                  <button className="icon-btn danger" onClick={() => call(`/comments/${c.id}`, 'DELETE')} aria-label="Delete comment">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="ticket-side">
          <div className="field-label">Status</div>
          <select value={t.status_id || ''} disabled={!editable} onChange={(e) => save({ status_id: Number(e.target.value) })}>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="field-label">Priority</div>
          <div className="priority-pick">
            {PRIORITIES.map((p) => (
              <button key={p.key} type="button" disabled={!editable}
                className={`prio-btn ${t.priority === p.key ? 'active' : ''}`} style={{ '--c': p.color }}
                onClick={() => save({ priority: p.key })}>⚑ {p.label}</button>
            ))}
          </div>

          <div className="field-label">Start date</div>
          <input type="date" value={t.start_date || ''} disabled={!editable} onChange={(e) => save({ start_date: e.target.value || null })} />
          <div className="field-label">Due date</div>
          <input type="date" value={t.due_date || ''} disabled={!editable} onChange={(e) => save({ due_date: e.target.value || null })} />

          <div className="field-label">Assignees</div>
          <div className="assignee-list">
            {t.assignees.length === 0 && <span className="muted small">Nobody yet</span>}
            {t.assignees.map((a) => (
              <div key={a.id} className="assignee-chip"><Avatar user={a} size={20} /> {a.name}</div>
            ))}
          </div>
          {editable && (
            <>
              <button className="btn small" onClick={() => setShowAssign((v) => !v)}>{showAssign ? 'Done' : 'Change assignees'}</button>
              {showAssign && (
                <div className="assign-picker">
                  {members.filter((m) => m.role !== 'viewer').map((m) => (
                    <label key={m.id} className="check">
                      <input type="checkbox" checked={assigneeIds.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                      <Avatar user={m} size={20} /> {m.name}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="ticket-meta muted small">
            Created by {t.created_by_name}<br />{fmtTime(t.created_at)}<br />Updated {fmtTime(t.updated_at)}
          </div>
          {canDelete && <button className="btn danger-outline small" onClick={del}>Delete ticket</button>}
        </aside>
      </div>
    </Modal>
  );
}
