// A file shared in a chat: image preview, or a file card with a download button
import { useEffect, useState } from 'react';
import { apiBlob } from '../api';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(name, mime) {
  const ext = name.split('.').pop().toLowerCase();
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📊';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return '📝';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📽️';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  return '📄';
}

async function download(f) {
  const blob = await apiBlob(`/attachments/${f.id}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function filePreviewText(body) {
  const f = parse(body);
  return f ? `📎 ${f.name}` : '📎 File';
}

export default function FileMessage({ body }) {
  const f = parse(body);
  const [img, setImg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isImage = f && IMAGE_TYPES.includes(f.mime);

  useEffect(() => {
    if (!isImage) return undefined;
    let url = null;
    let cancelled = false;
    apiBlob(`/attachments/${f.id}?inline=1`)
      .then((b) => { if (!cancelled) { url = URL.createObjectURL(b); setImg(url); } })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [f?.id, isImage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;

  const onDownload = async () => {
    setBusy(true); setError('');
    try { await download(f); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="file-msg">
      {isImage && img && (
        <button type="button" className="file-img-btn" onClick={() => window.open(img, '_blank', 'noopener')} title="Open full size">
          <img src={img} alt={f.name} className="file-img" />
        </button>
      )}
      {isImage && !img && !error && <div className="file-img-loading muted small">Loading image…</div>}
      <div className="file-card">
        <span className="file-icon">{fileIcon(f.name, f.mime)}</span>
        <div className="grow file-info">
          <div className="file-name clamp1" title={f.name}>{f.name}</div>
          <div className="muted small">{fmtSize(f.size)}</div>
        </div>
        <button type="button" className="btn small" onClick={onDownload} disabled={busy}>{busy ? '…' : 'Download'}</button>
      </div>
      {f.caption && <div className="msg-text file-caption">{f.caption}</div>}
      {error && <div className="error small">{error}</div>}
    </div>
  );
}
