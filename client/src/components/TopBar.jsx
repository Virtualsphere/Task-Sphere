import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { getSocket } from '../socket';
import Avatar from './Avatar';
import { NotificationBell } from '../notify/NotificationSettings';

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
      <Link to="/" className="brand"><img className="brand-logo small" src="/logo-mark.png" alt="" width="28" height="28" /> <span className="hide-sm">TaskSphere</span></Link>
      {/* On phones this becomes a tab bar fixed to the bottom of the screen */}
      <nav className="topnav" aria-label="Main">
        <NavLink to="/" end><span className="nav-icon" aria-hidden="true">🗂️</span><span className="nav-label">Spaces</span></NavLink>
        <NavLink to="/messages">
          <span className="nav-icon" aria-hidden="true">💬</span><span className="nav-label">Messages</span>
          {unread > 0 && <span className="badge">{unread}</span>}
        </NavLink>
        <NavLink to="/calendar"><span className="nav-icon" aria-hidden="true">📅</span><span className="nav-label">Calendar</span></NavLink>
      </nav>
      <div className="topbar-mid">{children}</div>
      <div className="topbar-user">
        <NotificationBell />
        <Avatar user={user} size={28} />
        <span className="hide-md clamp1 topbar-name">{user?.name}</span>
        <button className="btn ghost small" onClick={logout} title="Sign out" aria-label="Sign out">
          <span className="hide-sm">Sign out</span><span className="show-sm" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  );
}
