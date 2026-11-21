// Files on a task: in the task description, a subtask description, or a comment.
// Images show as thumbnails (click to open full size); other files (PDF, Excel, …) show as cards with Download.
import { useEffect, useRef, useState } from 'react';
import { apiBlob, apiUpload } from '../api';
import { config } from '../config';
import { IMAGE_TYPES, fileIcon, fmtSize, download } from './FileMessage';

const fileUrl = (f) => `/ticket-attachments/${f.id}`;

function Thumb({ f }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = null;
    let cancelled = false;
    apiBlob(`${fileUrl(f)}?inline=1`)
      .then((b) => { if (!cancelled) { url = URL.createObjectURL(b); setSrc(url); } })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [f.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <span className="file-icon">🖼️</span>;
  if (!src) return <span className="task-thumb-loading" />;
  return (
    <button type="button" className="task-thumb-btn" onClick={() => window.open(src, '_blank', 'noopener')} title="Open full size">
      <img src={src} alt={f.name} />
    </button>
  );
}

// The attached files, with Download and (when allowed) Remove
export function AttachmentList({ files, canRemove, onRemove }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (!files?.length) return null;
  const images = files.filter((f) => IMAGE_TYPES.includes(f.mime));
  const others = files.filter((f) => !IMAGE_TYPES.includes(f.mime));

  const get = async (f) => {
    setBusy(f.id); setError('');
    try { await download(f, fileUrl(f)); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const remove = async (f) => {
    if (!confirm(`Remove "${f.name}"?`)) return;
    setBusy(f.id); setError('');
    try { await onRemove(f); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const removeBtn = (f) => canRemove?.(f) && (
    <button type="button" className="icon-btn danger" onClick={() => remove(f)} disabled={busy === f.id} aria-label={`Remove ${f.name}`} title="Remove">✕</button>
  );

  return (
    <div className="task-files">
      {images.length > 0 && (
        <div className="task-thumbs">
          {images.map((f) => (
            <div className="task-thumb" key={f.id} title={`${f.name} · ${fmtSize(f.size)}`}>
              <Thumb f={f} />
              <div className="task-thumb-actions">
                <button type="button" className="icon-btn" onClick={() => get(f)} disabled={busy === f.id} aria-label={`Download ${f.name}`} title="Download">⬇</button>
                {removeBtn(f)}
              </div>
            </div>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div className="file-card" key={f.id}>
          <span className="file-icon">{fileIcon(f.name, f.mime)}</span>
          <div className="grow file-info">
            <div className="file-name clamp1" title={f.name}>{f.name}</div>
            <div className="muted small">{fmtSize(f.size)}</div>
          </div>
          <button type="button" className="btn small" onClick={() => get(f)} disabled={busy === f.id}>{busy === f.id ? '…' : 'Download'}</button>
          {removeBtn(f)}
        </div>
      ))}
      {error && <div className="error small">{error}</div>}
    </div>
  );
}

// Attach files straight to the task (or a subtask): 📎 button, drag & drop, or paste a screenshot.
// Each file uploads on its own; onTicket gets the updated ticket after each one.
export function useTaskUpload(ticketId, subtaskId, onTicket) {
  const [progress, setProgress] = useState(null); // { index, total, pct }
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const maxMb = config.maxUploadMb || 20;

  const uploadFiles = async (list) => {
    const files = [...(list || [])];
    if (!files.length || progress) return;
    const tooBig = files.filter((f) => f.size > maxMb * 1024 * 1024);
    const ok = files.filter((f) => !tooBig.includes(f));
    const errors = tooBig.map((f) => `${f.name}: files can be up to ${maxMb} MB`);
    for (let i = 0; i < ok.length; i++) {
      setProgress({ index: i, total: ok.length, pct: 0 });
      const fd = new FormData();
      fd.append('file', ok[i]);
      if (subtaskId) fd.append('subtask_id', subtaskId);
      try {
        onTicket(await apiUpload(`/tickets/${ticketId}/attachments`, fd, (p) => setProgress({ index: i, total: ok.length, pct: p })));
      } catch (e) {
        errors.push(`${ok[i].name}: ${e.message}`);
      }
    }
    setProgress(null);
    setError(errors.join(' · '));
  };

  const dropProps = {
    onDragOver: (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); uploadFiles(e.dataTransfer.files); } setDragging(false); },
  };
  const onPaste = (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); uploadFiles(e.clipboardData.files); } };

  return { progress, error, dragging, inputRef, maxMb, uploadFiles, dropProps, onPaste };
}

export function TaskAttachButton({ up, label = 'Attach files' }) {
  return (
    <>
      <input ref={up.inputRef} type="file" multiple hidden onChange={(e) => { up.uploadFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="btn small" disabled={!!up.progress} onClick={() => up.inputRef.current?.click()}
        title={`Photos, PDFs or any file up to ${up.maxMb} MB. You can also drag files here or paste a screenshot.`}>
        {up.progress ? `Uploading ${up.progress.index + 1}/${up.progress.total} · ${Math.round(up.progress.pct * 100)}%` : `📎 ${label}`}
      </button>
    </>
  );
}
