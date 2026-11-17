import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import { can, store } from '../util';
import TopBar from '../components/TopBar';
import ListView from '../components/ListView';
import ChatPanel from '../components/ChatPanel';
import CreateListModal from '../components/CreateListModal';
import MembersModal from '../components/MembersModal';
import Avatar from '../components/Avatar';
import ScheduleMeetingModal from '../components/ScheduleMeetingModal';
import { MeetingList } from './CalendarPage';
import { useHuddle } from '../huddle/HuddleContext';

export default function SpacePage() {
  const { spaceId, listId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [space, setSpace] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0); // bumped when someone else changes something
  const [chatOpen, setChatOpen] = useState(() => store.get('pm_chat') !== '0');
  const [showCreateList, setShowCreateList] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const huddle = useHuddle();
  const loadMeetings = useCallback(() => api(`/meetings?space_id=${spaceId}`).then(setMeetings).catch(() => {}), [spaceId]);
  useEffect(() => { loadMeetings(); }, [loadMeetings]);
  useEffect(() => {
    const s = getSocket();
    s.on('meeting:new', loadMeetings);
    s.on('meeting:cancelled', loadMeetings);
    return () => { s.off('meeting:new', loadMeetings); s.off('meeting:cancelled', loadMeetings); };
  }, [loadMeetings]);

  const loadSpace = useCallback(
    () => api(`/spaces/${spaceId}`).then(setSpace).catch((e) => setError(e.message)),
    [spaceId]
  );

  useEffect(() => { setSpace(null); loadSpace(); }, [loadSpace]);

  // Open the first list automatically
  useEffect(() => {
    if (space && !listId && space.lists.length) navigate(`/spaces/${spaceId}/lists/${space.lists[0].id}`, { replace: true });
  }, [space, listId, spaceId, navigate]);

  // Live updates
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit('space:join', { spaceId: Number(spaceId) });
    join();
    socket.on('connect', join);
    const onChanged = (e) => {
      if (e.type === 'space-deleted' || e.removedUserId === user.id) { navigate('/'); return; }
      if (['space', 'members', 'lists', 'tickets'].includes(e.type)) loadSpace();
      if (e.by !== user.id) setVersion((v) => v + 1);
    };
    socket.on('space:changed', onChanged);
    return () => { socket.off('connect', join); socket.off('space:changed', onChanged); };
  }, [spaceId, user.id, loadSpace, navigate]);

  // Unread badge when chat is closed
  useEffect(() => {
    if (chatOpen) { setUnread(0); return; }
    const socket = getSocket();
    const onMsg = (m) => { if (m.spaceId === Number(spaceId) && m.user_id !== user.id) setUnread((n) => n + 1); };
    socket.on('chat:message', onMsg);
    return () => socket.off('chat:message', onMsg);
  }, [chatOpen, spaceId, user.id]);

  const toggleChat = (open) => { setChatOpen(open); store.set('pm_chat', open ? '1' : '0'); };

  if (error) return <div className="app-shell"><TopBar /><div className="center"><p className="error">{error}</p><Link to="/">Back to spaces</Link></div></div>;
  if (!space) return <div className="app-shell"><TopBar /><div className="center muted">Loading space…</div></div>;

  const isAdmin = can(space.my_role, 'admin');

  return (
    <div className="app-shell">
      <TopBar>
        <span className="crumb"><Link to="/">Spaces</Link> / <strong>{space.name}</strong></span>
      </TopBar>
      <div className={`space-layout ${chatOpen ? 'with-chat' : ''}`}>
        <nav className="sidebar">
          <div className="sidebar-space">
            <div className="space-icon" style={{ background: space.color }}>{space.name[0]?.toUpperCase()}</div>
            <div>
              <strong>{space.name}</strong>
              <div><span className={`role-badge role-${space.my_role}`}>{space.my_role}</span></div>
            </div>
          </div>

          <div className="sidebar-section">
            <span>Lists</span>
            {isAdmin && <button className="icon-btn" title="New list" onClick={() => setShowCreateList(true)}>＋</button>}
          </div>
          {space.lists.length === 0 && (
            <p className="muted small pad">{isAdmin ? 'Create your first list to start adding tickets.' : 'No lists yet.'}</p>
          )}
          {space.lists.map((l) => (
            <Link key={l.id} to={`/spaces/${space.id}/lists/${l.id}`} className={`nav-item ${String(l.id) === listId ? 'active' : ''}`}>
              <span className="grow clamp1">{l.name}</span>
              <span className="muted small">{l.done_count}/{l.ticket_count}</span>
            </Link>
          ))}

          <div className="sidebar-section"><span>Team</span></div>
          <button className="nav-item" onClick={() => setShowMembers(true)}>
            <div className="avatars">{space.members.slice(0, 4).map((m) => <Avatar key={m.id} user={m} size={22} />)}</div>
            <span className="grow">{space.members.length} members</span>
          </button>
          <button className="nav-item" onClick={() => toggleChat(!chatOpen)}>
            💬 <span className="grow">Space chat</span>
            {unread > 0 && <span className="badge">{unread}</span>}
          </button>
          {huddle?.states[`space:${space.id}`] && huddle.active?.key !== `space:${space.id}` && (
            <button className="nav-item huddle-live-item" onClick={() => huddle.join('space', space.id, space.name)}>
              <span className="live-dot" /> <span className="grow">Huddle live · {huddle.states[`space:${space.id}`].participants.length}</span>
              <span className="small">Join</span>
            </button>
          )}

          <div className="sidebar-section">
            <span>Meetings</span>
            {can(space.my_role, 'member') && <button className="icon-btn" title="Schedule meeting" onClick={() => setShowSchedule(true)}>＋</button>}
          </div>
          <div className="pad"><MeetingList meetings={meetings.slice(0, 4)} compact /></div>
        </nav>

        <main className="space-main">
          {listId ? (
            <ListView key={listId} listId={listId} space={space} version={version} />
          ) : (
            <div className="empty">
              <h3>Welcome to {space.name}</h3>
              <p className="muted">Lists hold your tickets. Each list follows a methodology – SDLC, Agile, Scrum or Kanban.</p>
              {isAdmin && <button className="btn primary" onClick={() => setShowCreateList(true)}>+ Create a list</button>}
            </div>
          )}
        </main>

        {chatOpen && <ChatPanel spaceId={space.id} spaceName={space.name} canSchedule={can(space.my_role, 'member')} onSchedule={() => setShowSchedule(true)} onClose={() => toggleChat(false)} />}
      </div>

      {showCreateList && (
        <CreateListModal spaceId={space.id} onClose={() => setShowCreateList(false)}
          onCreated={(id) => { setShowCreateList(false); loadSpace(); navigate(`/spaces/${space.id}/lists/${id}`); }} />
      )}
      {showSchedule && (
        <ScheduleMeetingModal people={space.members} spaceId={space.id} contextLabel={space.name}
          onClose={() => setShowSchedule(false)} onCreated={() => { setShowSchedule(false); loadMeetings(); }} />
      )}
      {showMembers && <MembersModal space={space} onClose={() => setShowMembers(false)} onChanged={loadSpace} />}
    </div>
  );
}
