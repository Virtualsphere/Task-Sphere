import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { PRIORITIES, can, fmtDate, isOverdue, priorityOf, store } from '../util';
import Avatar from './Avatar';
import Modal from './Modal';
import StatusEditor from './StatusEditor';
import TicketModal from './TicketModal';
import { plainMentions } from './ChatText';

// Latest-comment preview: @[Name](id) tags as "@Name"; a comment with only files says so
const commentText = (c) => plainMentions(c.body) || '📎 Attachment';

const METHOD_LABEL = { SDLC: 'SDLC', AGILE: 'Agile', SCRUM: 'Scrum', KANBAN: 'Kanban', CUSTOM: 'Custom' };

export default function ListView({ listId, space, version }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => store.get('pm_view') || 'board');
  const [openTicket, setOpenTicket] = useState(null);
  // Opened from a mention notification or email (…?ticket=12): open that task
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get('ticket'));
    if (!id) return;
    setOpenTicket(id);
    params.delete('ticket');
    setParams(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState('');
  const [prioFilter, setPrioFilter] = useState('');
  const [mine, setMine] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null); // status id where quick-add is open
  const [quickTitle, setQuickTitle] = useState('');
  const [dragId, setDragId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = () => api(`/lists/${listId}`).then(setList).catch((e) => setError(e.message));
  useEffect(() => { setList(null); load(); }, [listId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (version) load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const setViewSaved = (v) => { setView(v); store.set('pm_view', v); };

  const tickets = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    return list.tickets.filter((t) =>
      (!q || t.title.toLowerCase().includes(q) || String(t.id) === q.replace('#', '')) &&
      (!prioFilter || t.priority === prioFilter) &&
      (!mine || t.assignees.some((a) => a.id === user.id)));
  }, [list, search, prioFilter, mine, user.id]);

  if (error) return <div className="list-view"><p className="error">{error}</p></div>;
  if (!list) return <div className="list-view"><p className="muted">Loading list…</p></div>;

  const editable = can(list.my_role, 'member');
  const isAdmin = can(list.my_role, 'admin');
  const statusById = Object.fromEntries(list.statuses.map((s) => [s.id, s]));
  const doneIds = new Set(list.statuses.filter((s) => s.is_done).map((s) => s.id));
  const doneCount = list.tickets.filter((t) => doneIds.has(t.status_id)).length;

  const moveTicket = async (ticketId, statusId) => {
    const tk = list.tickets.find((t) => t.id === ticketId);
    if (!tk || tk.status_id === statusId) return;
    setList({ ...list, tickets: list.tickets.map((t) => (t.id === ticketId ? { ...t, status_id: statusId } : t)) });
    try { await api(`/tickets/${ticketId}`, { method: 'PATCH', body: { status_id: statusId } }); }
    catch (e) { setError(e.message); }
    load();
  };

  const createTicket = async (statusId) => {
    const title = quickTitle.trim();
    if (!title) return;
    try {
      await api(`/lists/${listId}/tickets`, { method: 'POST', body: { title, status_id: statusId } });
      setQuickTitle('');
      setQuickAdd(null);
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="list-view">
      <div className="list-head">
        <div>
          <h2>{list.name} <span className="method-tag">{METHOD_LABEL[list.methodology]}</span></h2>
          {list.description && <p className="muted small">{list.description}</p>}
          <div className="muted small">{list.tickets.length} tickets · {doneCount} completed</div>
        </div>
        <div className="list-actions">
          <div className="seg">
            <button className={view === 'board' ? 'active' : ''} onClick={() => setViewSaved('board')}>Board</button>
            <button className={view === 'table' ? 'active' : ''} onClick={() => setViewSaved('table')}>Table</button>
          </div>
          {editable && <button className="btn primary" onClick={() => { setQuickAdd(list.statuses[0]?.id); setViewSaved('board'); }}>+ Ticket</button>}
          {isAdmin && <button className="btn" onClick={() => setShowSettings(true)}>⚙ List settings</button>}
        </div>
      </div>

      <div className="filters">
        <input className="search" placeholder="Search tickets or #id…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
      </div>

      {view === 'board' ? (
        <div className="board">
          {list.statuses.map((s) => {
            const col = tickets.filter((t) => t.status_id === s.id);
            return (
              <div key={s.id} className="column"
                onDragOver={(e) => editable && e.preventDefault()}
                onDrop={() => { if (dragId) moveTicket(dragId, s.id); setDragId(null); }}>
                <div className="column-head" style={{ '--c': s.color }}>
                  <span className="dot" /> <strong>{s.name}</strong> <span className="count">{col.length}</span>
                  {s.is_done ? <span className="done-mark" title="Done status">✓</span> : null}
                </div>
                <div className="column-body">
                  {col.map((t) => (
                    <TicketCard key={t.id} t={t} done={doneIds.has(t.status_id)} draggable={editable}
                      onDragStart={() => setDragId(t.id)} onClick={() => setOpenTicket(t.id)} />
                  ))}
                  {editable && (quickAdd === s.id ? (
                    <form className="quick-add" onSubmit={(e) => { e.preventDefault(); createTicket(s.id); }}>
                      <input autoFocus placeholder="Ticket title…" value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setQuickAdd(null)} />
                      <div className="row gap">
                        <button className="btn primary small" disabled={!quickTitle.trim()}>Add</button>
                        <button type="button" className="btn small" onClick={() => setQuickAdd(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button className="add-card" onClick={() => { setQuickAdd(s.id); setQuickTitle(''); }}>+ Add ticket</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ticket-table">
            <thead>
              <tr><th>Ticket</th><th>Status</th><th>Priority</th><th>Assignees</th><th>Start</th><th>Due</th><th>Subtasks</th><th>Latest comment</th></tr>
            </thead>
            <tbody>
              {tickets.length === 0 && <tr><td colSpan={8} className="muted center-text">No tickets match.</td></tr>}
              {tickets.map((t) => {
                const p = priorityOf(t.priority);
                const st = statusById[t.status_id];
                return (
                  <tr key={t.id} onClick={() => setOpenTicket(t.id)}>
                    <td className="title-cell"><span className="muted">#{t.id}</span> {t.title}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className="status-select" style={{ '--c': st?.color }} value={t.status_id || ''} disabled={!editable}
                        onChange={(e) => moveTicket(t.id, Number(e.target.value))}>
                        {list.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td><span className="flag" style={{ color: p.color }}>⚑</span> {p.label}</td>
                    <td><div className="avatars">{t.assignees.map((a) => <Avatar key={a.id} user={a} size={22} />)}</div></td>
                    <td>{fmtDate(t.start_date)}</td>
                    <td className={isOverdue(t.due_date, doneIds.has(t.status_id)) ? 'overdue' : ''}>{fmtDate(t.due_date)}</td>
                    <td>{t.subtask_total ? `${t.subtask_done}/${t.subtask_total}` : '–'}</td>
                    <td className="latest-cell">{t.latest_comment ? <><strong>{t.latest_comment.name}:</strong> {commentText(t.latest_comment)}</> : <span className="muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openTicket && (
        <TicketModal ticketId={openTicket} statuses={list.statuses} members={space.members} version={version}
          onClose={() => { setOpenTicket(null); load(); }}
          onDeleted={() => { setOpenTicket(null); load(); }} />
      )}
      {showSettings && (
        <ListSettings list={list} onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load(); }}
          onDeleted={() => navigate(`/spaces/${space.id}`)} />
      )}
    </div>
  );
}

function TicketCard({ t, done, draggable, onDragStart, onClick }) {
  const p = priorityOf(t.priority);
  const overdue = isOverdue(t.due_date, done);
  return (
    <div className="card" draggable={draggable} onDragStart={onDragStart} onClick={onClick}>
      <div className="card-top">
        <span className="flag" style={{ color: p.color }} title={`${p.label} priority`}>⚑</span>
        <span className="muted small">#{t.id}</span>
      </div>
      <div className={`card-title ${done ? 'strike' : ''}`}>{t.title}</div>
      {t.latest_comment && (
        <div className="card-comment"><strong>{t.latest_comment.name.split(' ')[0]}:</strong> {commentText(t.latest_comment)}</div>
      )}
      <div className="card-foot">
        <div className="avatars">{t.assignees.slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={22} />)}</div>
        <div className="card-badges">
          {t.subtask_total > 0 && <span title="Subtasks">☑ {t.subtask_done}/{t.subtask_total}</span>}
          {t.comment_count > 0 && <span title="Comments">💬 {t.comment_count}</span>}
          {t.due_date && <span className={overdue ? 'overdue' : ''} title="Due date">📅 {fmtDate(t.due_date)}</span>}
        </div>
      </div>
    </div>
  );
}

function ListSettings({ list, onClose, onSaved, onDeleted }) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description || '');
  const [statuses, setStatuses] = useState(list.statuses.map((s) => ({ ...s })));
  const [error, setError] = useState('');

  const save = async () => {
    try {
      await api(`/lists/${list.id}`, { method: 'PATCH', body: { name, description } });
      await api(`/lists/${list.id}/statuses`, { method: 'PUT', body: { statuses } });
      onSaved();
    } catch (e) { setError(e.message); }
  };
  const del = async () => {
    if (!confirm(`Delete list "${list.name}" and all its tickets? This cannot be undone.`)) return;
    try { await api(`/lists/${list.id}`, { method: 'DELETE' }); onDeleted(); }
    catch (e) { setError(e.message); }
  };

  return (
    <Modal title="List settings" onClose={onClose} wide>
      <div className="form">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="field-label">Workflow statuses</div>
        <p className="muted small">Tickets on a removed status are moved to the first status.</p>
        <StatusEditor statuses={statuses} onChange={setStatuses} />
        {error && <p className="error">{error}</p>}
        <div className="form-actions spread">
          <button className="btn danger-outline" onClick={del}>Delete list</button>
          <div className="row gap">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!name.trim() || !statuses.length}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
