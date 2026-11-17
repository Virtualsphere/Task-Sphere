import { useEffect, useState } from 'react';
import { api } from '../api';
import Modal from './Modal';
import StatusEditor from './StatusEditor';

export default function CreateListModal({ spaceId, onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [methodology, setMethodology] = useState('AGILE');
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/methodologies').then((t) => {
      setTemplates(t);
      setStatuses(t.find((x) => x.key === 'AGILE').statuses.map((s) => ({ ...s, is_done: s.is_done ? 1 : 0 })));
    });
  }, []);

  const pick = (key) => {
    setMethodology(key);
    setStatuses(templates.find((x) => x.key === key).statuses.map((s) => ({ ...s, is_done: s.is_done ? 1 : 0 })));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id } = await api(`/spaces/${spaceId}/lists`, { method: 'POST', body: { name, description, methodology, statuses } });
      onCreated(id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a list" onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        <label>List name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouse App v2" required /></label>
        <label>Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>

        <div className="field-label">Project methodology</div>
        <div className="method-grid">
          {templates.map((t) => (
            <button type="button" key={t.key} className={`method-card ${methodology === t.key ? 'active' : ''}`} onClick={() => pick(t.key)}>
              <strong>{t.label}</strong>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>

        <div className="field-label">Workflow statuses <span className="muted small">(you can edit these)</span></div>
        <div className="status-preview">
          {statuses.map((s, i) => (
            <span key={i} className="status-pill" style={{ '--c': s.color }}>{s.name}</span>
          ))}
        </div>
        <StatusEditor statuses={statuses} onChange={setStatuses} />

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim() || !statuses.length}>Create list</button>
        </div>
      </form>
    </Modal>
  );
}
