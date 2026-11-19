// File attaching for chat composers (personal/group chats and space chats):
// pick with 📎, drag & drop onto the chat, or paste a screenshot. Files are sent one by one.
import { useRef, useState } from 'react';
import { apiUpload } from '../api';
import { config } from '../config';
import { fmtSize } from './FileMessage';

const MAX_FILES = 10;

export function useChatFiles(uploadPath) {
  const [files, setFiles] = useState([]);       // chosen, not yet sent
  const [upload, setUpload] = useState(null);   // { index, total, progress } while sending
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const maxMb = config.maxUploadMb || 20;

  const addFiles = (list) => {
    const picked = [...(list || [])];
    if (!picked.length) return;
    const ok = picked.filter((f) => f.size <= maxMb * 1024 * 1024);
    const tooBig = picked.filter((f) => !ok.includes(f));
    setError(tooBig.length ? `${tooBig.map((f) => f.name).join(', ')}: files can be up to ${maxMb} MB` : '');
    setFiles((cur) => [...cur, ...ok].slice(0, MAX_FILES));
  };

  // Sends every chosen file; `caption` goes with the first one.
  // Returns true when the caption was delivered (so the caller can clear the text box).
  const sendFiles = async (caption) => {
    setError('');
    const queue = files;
    const failed = [];
    for (let i = 0; i < queue.length; i++) {
      setUpload({ index: i, total: queue.length, progress: 0 });
      const fd = new FormData();
      fd.append('file', queue[i]);
      if (i === 0 && caption) fd.append('caption', caption);
      try {
        await apiUpload(uploadPath, fd, (p) => setUpload({ index: i, total: queue.length, progress: p }));
      } catch (err) {
        failed.push(queue[i]);
        setError(`${queue[i].name}: ${err.message}`);
      }
    }
    setUpload(null);
    setFiles(failed); // failed ones stay selected so they can be retried
    return !failed.includes(queue[0]);
  };

  const dragProps = {
    onDragOver: (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
    onDrop: (e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } setDragging(false); },
  };
  const onPaste = (e) => {
    if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); }
  };
  const removeFile = (i) => setFiles((cur) => cur.filter((_, j) => j !== i));
  const openPicker = () => inputRef.current?.click();

  return { files, upload, dragging, error, setError, maxMb, inputRef, addFiles, removeFile, sendFiles, dragProps, onPaste, openPicker };
}

// The hidden <input type=file> plus the 📎 button
export function AttachButton({ chat }) {
  return (
    <>
      <input ref={chat.inputRef} type="file" multiple hidden onChange={(e) => { chat.addFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="btn attach-btn" title={`Attach files (up to ${chat.maxMb} MB each)`}
        disabled={!!chat.upload} onClick={chat.openPicker}>📎</button>
    </>
  );
}

// Chips for chosen files + sending progress
export function PendingFiles({ chat }) {
  if (!chat.files.length) return null;
  return (
    <div className="pending-files">
      {chat.files.map((f, i) => (
        <span key={`${f.name}-${f.size}-${i}`} className="pending-file">
          📎 <span className="clamp1">{f.name}</span> <span className="muted">{fmtSize(f.size)}</span>
          {!chat.upload && <button type="button" className="link-btn" title="Remove" onClick={() => chat.removeFile(i)}>✕</button>}
        </span>
      ))}
      {chat.upload && <span className="muted small">Sending {chat.upload.index + 1} of {chat.upload.total} · {Math.round(chat.upload.progress * 100)}%</span>}
    </div>
  );
}

export function DropHint({ chat, label }) {
  return chat.dragging ? <div className="drop-hint">Drop files to send to {label}</div> : null;
}
