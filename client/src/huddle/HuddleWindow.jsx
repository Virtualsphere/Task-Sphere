// Floating huddle window (stays open while you move around the app) + incoming huddle toasts
import { useEffect, useRef, useState } from 'react';
import { useHuddle } from './HuddleContext';
import Avatar from '../components/Avatar';

function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!since) return '';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Detects who is talking (for the green ring)
function useSpeaking(stream, enabled) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const track = stream?.getAudioTracks?.()[0];
    if (!track || !enabled || typeof AudioContext === 'undefined') { setSpeaking(false); return undefined; }
    let ctx; let raf;
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let last = 0;
      const loop = () => {
        an.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        const now = Date.now();
        if (avg > 18) { last = now; setSpeaking(true); } else if (now - last > 400) setSpeaking(false);
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* ignore */ }
    return () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); };
  }, [stream, enabled]);
  return speaking;
}

function Tile({ person, stream, audioStream, showVideo, mutedAudio, isSelf, screen, state, big }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const speaking = useSpeaking(audioStream, !mutedAudio);
  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = showVideo ? stream : null; }, [stream, showVideo]);
  useEffect(() => {
    if (audioRef.current && !isSelf) {
      audioRef.current.srcObject = audioStream || null;
      audioRef.current.play?.().catch(() => {});
    }
  }, [audioStream, isSelf]);
  return (
    <div className={`tile ${speaking ? 'speaking' : ''} ${big ? 'big' : ''}`}>
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className={isSelf && !screen ? 'mirror' : ''} />
      ) : (
        <div className="tile-avatar"><Avatar user={person} size={big ? 72 : 44} /></div>
      )}
      {!isSelf && <audio ref={audioRef} autoPlay />}
      <div className="tile-label">
        {mutedAudio && <span title="Muted">🔇</span>}
        {screen && <span title="Sharing screen">🖥</span>}
        <span className="clamp1">{isSelf ? 'You' : person.name}</span>
        {state && state !== 'connected' && !isSelf && <span className="muted-light">· {state}</span>}
      </div>
    </div>
  );
}

export default function HuddleWindow() {
  const h = useHuddle();
  const [expanded, setExpanded] = useState(false);
  const elapsed = useElapsed(h?.active?.startedAt);
  if (!h) return null;

  const { active, peers, local, notice, me } = h;
  const list = Object.entries(peers);

  return (
    <>
      {active && (
        <div className={`huddle-window ${expanded ? 'expanded' : ''}`}>
          <div className="huddle-head">
            <span className="live-dot" />
            <strong className="clamp1">🎧 {active.title}</strong>
            <span className="muted-light small">{list.length + 1} · {elapsed}</span>
            <button className="icon-btn light" onClick={() => setExpanded((e) => !e)} title={expanded ? 'Minimise' : 'Expand'}>{expanded ? '▾' : '⤢'}</button>
          </div>
          {local.micError && <div className="huddle-warn">{local.micError}</div>}
          <div className={`tiles n${Math.min(list.length + 1, 6)}`}>
            <Tile isSelf person={me} stream={local.stream} audioStream={null} showVideo={local.video || local.screen}
              mutedAudio={!local.audio} screen={local.screen} big={expanded} />
            {list.map(([id, p]) => (
              <Tile key={id} person={p} stream={p.stream} audioStream={p.stream} showVideo={(p.video || p.screen) && !!p.stream}
                mutedAudio={!p.audio} screen={p.screen} state={p.state} big={expanded} />
            ))}
          </div>
          {list.length === 0 && <div className="huddle-waiting">Waiting for others to join…</div>}
          <div className="huddle-controls">
            <button className={`hbtn ${local.audio ? '' : 'off'}`} onClick={h.toggleMic} title={local.audio ? 'Mute' : 'Unmute'}>{local.audio ? '🎙' : '🔇'}</button>
            <button className={`hbtn ${local.video ? 'on' : ''}`} onClick={h.toggleCamera} title="Camera">📷</button>
            <button className={`hbtn ${local.screen ? 'on' : ''}`} onClick={h.toggleScreen} title="Share screen">🖥</button>
            <button className="hbtn leave" onClick={h.leave} title="Leave huddle">Leave</button>
          </div>
        </div>
      )}

      <div className="toasts">
        {h.rings.map((r) => (
          <div className="toast ring" key={r.huddle.key}>
            <Avatar user={r.from} size={36} />
            <div className="grow">
              <strong>{r.from.name}</strong>
              <div className="small muted">
                {r.huddle.type === 'direct' ? 'is calling you 🎧' : `started a huddle in ${r.title}`}
              </div>
            </div>
            <button className="btn primary small" onClick={() => h.join(r.huddle.scope, r.huddle.scopeId, r.title)}>Join</button>
            <button className="btn small" onClick={() => h.dismissRing(r.huddle.key)}>Dismiss</button>
          </div>
        ))}
        {notice && <div className="toast info">{notice}</div>}
      </div>
    </>
  );
}

// Button used in chat headers: Start / Join huddle (shows live count)
export function HuddleButton({ scope, id, title, compact }) {
  const h = useHuddle();
  const key = `${scope}:${Number(id)}`;
  useEffect(() => { h?.fetchStatus(scope, id); }, [scope, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!h) return null;
  const live = h.states[key];
  const inIt = h.active?.key === key;
  if (inIt) return <button className="btn small huddle-on" onClick={h.leave}>🎧 Leave huddle</button>;
  return (
    <button className={`btn small ${live ? 'huddle-live' : ''}`} onClick={() => h.join(scope, id, title)} title="Audio/video huddle">
      🎧 {live ? `Join huddle (${live.participants.length})` : compact ? 'Huddle' : 'Start huddle'}
    </button>
  );
}
