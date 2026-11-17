import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { getSocket } from '../socket';
import Avatar from './Avatar';

// Total unread personal messages, kept live
function useUnread() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => api('/conversations').then((cs) => setN(cs.reduce((a, c) => a + (c.unread || 0), 0))).catch(() => {});
    load();
    const s = getSocket();
    s.on('dm:message', load);
    window.addEventListener('pm:read', load);
    return () => { s.off('dm:message', load); window.removeEventListener('pm:read', load); };
  }, []);
  return n;
}

export default function TopBar({ children }) {
  const { user, logout } = useAuth();
  const unread = useUnread();
  return (
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-mark small">◆</span> <span className="hide-sm">TaskSphere</span></Link>
      <nav className="topnav">
        <NavLink to="/" end>Spaces</NavLink>
        <NavLink to="/messages">Messages {unread > 0 && <span className="badge">{unread}</span>}</NavLink>
        <NavLink to="/calendar">Calendar</NavLink>
      </nav>
      <div className="topbar-mid">{children}</div>
      <div className="topbar-user">
        <Avatar user={user} size={28} />
        <span className="hide-sm">{user?.name}</span>
        <button className="btn ghost small" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
