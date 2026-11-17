import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import TopBar from '../components/TopBar';
import Modal from '../components/Modal';

const COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#64748b'];

export default function Dashboard() {
  const [spaces, setSpaces] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('/spaces').then(setSpaces).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="app-shell">
      <TopBar />
      <main className="dashboard">
        <div className="page-head">
          <div>
            <h2>Your spaces</h2>
            <p className="muted">A space holds a team's lists, tickets and chat.</p>
          </div>
          <button className="btn primary" onClick={() => setShowCreate(true)}>+ New space</button>
        </div>
        {error && <p className="error">{error}</p>}
        {spaces === null ? (
          <p className="muted">Loading…</p>
        ) : spaces.length === 0 ? (
          <div className="empty">
            <p>You're not in any space yet.</p>
            <p className="muted">Create one, or ask a space owner to add your email.</p>
          </div>
        ) : (
          <div className="space-grid">
            {spaces.map((s) => (
              <Link key={s.id} to={`/spaces/${s.id}`} className="space-card">
                <div className="space-icon" style={{ background: s.color }}>{s.name[0]?.toUpperCase()}</div>
                <div className="space-info">
                  <strong>{s.name}</strong>
                  {s.description && <p className="muted small clamp">{s.description}</p>}
                  <div className="space-meta">
                    <span className={`role-badge role-${s.role}`}>{s.role}</span>
                    <span className="muted small">{s.list_count} lists · {s.member_count} members</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      {showCreate && <CreateSpaceModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function CreateSpaceModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/spaces', { method: 'POST', body: { name, description, color } });
      onCreated();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a space" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>Space name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RFID Products" required /></label>
        <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this space for?" /></label>
        <div className="field-label">Color</div>
        <div className="swatches">
          {COLORS.map((c) => (
            <button type="button" key={c} className={`swatch ${c === color ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>Create space</button>
        </div>
      </form>
    </Modal>
  );
}
