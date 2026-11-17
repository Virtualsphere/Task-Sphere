// Edit a list's workflow statuses: rename, recolor, reorder, mark as "done", add/remove
export default function StatusEditor({ statuses, onChange }) {
  const update = (i, patch) => onChange(statuses.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= statuses.length) return;
    const next = [...statuses];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(statuses.filter((_, j) => j !== i));
  const add = () => onChange([...statuses, { name: 'New status', color: '#94a3b8', is_done: 0 }]);

  return (
    <div className="status-editor">
      {statuses.map((s, i) => (
        <div className="status-row" key={s.id || `new-${i}`}>
          <span className="muted small order">{i + 1}</span>
          <input type="color" value={s.color} onChange={(e) => update(i, { color: e.target.value })} title="Color" />
          <input className="grow" value={s.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={60} />
          <label className="check small" title="Tickets in this status count as completed">
            <input type="checkbox" checked={!!s.is_done} onChange={(e) => update(i, { is_done: e.target.checked ? 1 : 0 })} /> Done
          </label>
          <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
          <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === statuses.length - 1} aria-label="Move down">↓</button>
          <button type="button" className="icon-btn danger" onClick={() => remove(i)} disabled={statuses.length === 1} aria-label="Remove">✕</button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={add}>+ Add status</button>
    </div>
  );
}
