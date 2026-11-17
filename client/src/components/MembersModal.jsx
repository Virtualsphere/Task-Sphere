import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { can } from '../util';
import Modal from './Modal';
import Avatar from './Avatar';

const ROLE_HELP = {
  owner: 'Full control, can delete the space',
  admin: 'Manage members, lists and statuses',
  member: 'Create and update tickets, comment, chat',
  viewer: 'Read-only, can use chat',
};

export default function MembersModal({ space, onClose, onChanged }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const isAdmin = can(space.my_role, 'admin');
  const isOwner = space.my_role === 'owner';

  const run = async (fn, okMsg) => {
    setError(''); setInfo('');
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
      onChanged();
    } catch (e) { setError(e.message); }
  };

  const invite = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api(`/spaces/${space.id}/members`, { method: 'POST', body: { email, role } });
      setEmail('');
      return r;
    }, `Added ${email}. If they haven't signed in yet, they'll join when they first log in with Google.`);
  };

  const leave = async () => {
    if (!confirm('Leave this space?')) return;
    try {
      await api(`/spaces/${space.id}/members/${user.id}`, { method: 'DELETE' });
      navigate('/');
    } catch (e) { setError(e.message); }
  };

  const canEdit = (m) => isAdmin && m.role !== 'owner' && m.id !== user.id && (isOwner || m.role !== 'admin');

  return (
    <Modal title={`Members of ${space.name}`} onClose={onClose} wide>
      {isAdmin && (
        <form className="invite-row" onSubmit={invite}>
          <input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {isOwner && <option value="admin">Admin</option>}
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn primary">Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {info && <p className="success">{info}</p>}

      <div className="member-list">
        {space.members.map((m) => (
          <div className="member-row" key={m.id}>
            <Avatar user={m} size={32} />
            <div className="grow">
              <strong>{m.name}{m.id === user.id && ' (you)'}</strong>
              <div className="muted small">{m.email}</div>
            </div>
            {canEdit(m) ? (
              <>
                <select value={m.role} onChange={(e) => run(() => api(`/spaces/${space.id}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                  {isOwner && <option value="admin">Admin</option>}
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="icon-btn danger" title="Remove" onClick={() => confirm(`Remove ${m.name}?`) && run(() => api(`/spaces/${space.id}/members/${m.id}`, { method: 'DELETE' }))}>✕</button>
              </>
            ) : (
              <span className={`role-badge role-${m.role}`} title={ROLE_HELP[m.role]}>{m.role}</span>
            )}
          </div>
        ))}
      </div>

      {isAdmin && space.invites.length > 0 && (
        <>
          <h4>Pending invites</h4>
          <div className="member-list">
            {space.invites.map((i) => (
              <div className="member-row" key={i.id}>
                <span className="avatar avatar-fallback" style={{ width: 32, height: 32 }}>✉</span>
                <div className="grow"><strong>{i.email}</strong><div className="muted small">Waiting for first sign-in</div></div>
                <span className={`role-badge role-${i.role}`}>{i.role}</span>
                <button className="icon-btn danger" title="Cancel invite" onClick={() => run(() => api(`/spaces/${space.id}/invites/${i.id}`, { method: 'DELETE' }))}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="role-legend">
        {Object.entries(ROLE_HELP).map(([r, t]) => (
          <div key={r}><span className={`role-badge role-${r}`}>{r}</span> <span className="muted small">{t}</span></div>
        ))}
      </div>

      {!isOwner && <button className="btn danger-outline" onClick={leave}>Leave space</button>}
    </Modal>
  );
}
