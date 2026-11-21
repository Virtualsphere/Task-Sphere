// Floating huddle window (stays open while you move around the app) + incoming huddle toasts
import { useEffect, useRef, useState } from 'react';
import { AlertCards } from '../notify/NotificationCenter';
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
    <div className={`tile ${speaking ? 'speaking' : ''} ${big ? 'big' : ''} ${screen && showVideo ? 'screen' : ''}`}>
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

// Drag an element by a handle. Position is { x, y } (top-left) inside the bounds element,
// or inside the browser window when no bounds are given. null = default CSS position.
function useDrag(boundsRef) {
  const [pos, setPos] = useState(null);
  const start = (e, el) => {
    if (e.button !== 0 || e.target.closest('button, a, input, select')) return;
    const box = el.getBoundingClientRect();
    const b = boundsRef?.current?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev) => setPos({
      x: Math.min(Math.max(ev.clientX - dx - b.left, 0), Math.max(0, b.width - box.width)),
      y: Math.min(Math.max(ev.clientY - dy - b.top, 0), Math.max(0, b.height - box.height)),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };
  return [pos, setPos, start];
}

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function toggleFullscreen(el) {
  if (fsElement()) return (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  return (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}

export default function HuddleWindow() {
  const h = useHuddle();
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const elapsed = useElapsed(h?.active?.startedAt);
  const winRef = useRef(null);
  const stageRef = useRef(null);
  const pipRef = useRef(null);
  const [winPos, setWinPos, dragWin] = useDrag(null);
  const [pipPos, setPipPos, dragPip] = useDrag(stageRef);

  // Track real browser full screen (also when the user leaves it with Esc)
  useEffect(() => {
    const onFs = () => { const on = fsElement() === winRef.current && !!winRef.current; setFullscreen(on); setPipPos(null); };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, [setPipPos]);
  // Keep the floating window on screen when the browser is resized
  useEffect(() => {
    const onResize = () => { setWinPos(null); setPipPos(null); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setWinPos, setPipPos]);
  // Leaving the huddle while in full screen: exit full screen too
  useEffect(() => { if (!h?.active && fsElement()) toggleFullscreen(); }, [h?.active]);

  if (!h) return null;

  const { active, peers, local, notice, me } = h;
  const list = Object.entries(peers);
  const big = expanded || fullscreen;

  // Everyone in the call as tile props; the self tile first
  const people = [
    { id: 'me', isSelf: true, person: me, stream: local.stream, audioStream: null, showVideo: local.video || local.screen, mutedAudio: !local.audio, screen: local.screen },
    ...list.map(([id, p]) => ({ id, person: p, stream: p.stream, audioStream: p.stream, showVideo: (p.video || p.screen) && !!p.stream, mutedAudio: !p.audio, screen: p.screen, state: p.state })),
  ];
  // Stage layout when someone shares their screen (others' screens take priority over your own)
  const presenter = big ? (people.find((t) => t.screen && !t.isSelf && t.showVideo) || people.find((t) => t.screen && t.showVideo)) : null;
  const others = presenter ? people.filter((t) => t !== presenter) : people;
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  const goFullscreen = () => { if (winRef.current) { setExpanded(true); toggleFullscreen(winRef.current); } };
  const winStyle = !big && winPos ? { left: winPos.x, top: winPos.y, right: 'auto', bottom: 'auto' } : undefined;
  const pipStyle = pipPos ? { left: pipPos.x, top: pipPos.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <>
      {active && (
        <div ref={winRef} className={`huddle-window ${big ? 'expanded' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} style={winStyle}>
          <div className={`huddle-head ${big ? '' : 'draggable'}`} onPointerDown={big ? undefined : (e) => dragWin(e, winRef.current)}
            title={big ? undefined : 'Drag to move'}>
            <span className="live-dot" />
            <strong className="clamp1">🎧 {active.title}</strong>
            <span className="muted-light small">{list.length + 1} · {elapsed}</span>
            {fsSupported && (
              <button className="icon-btn light" onClick={() => (fullscreen ? toggleFullscreen() : goFullscreen())} title={fullscreen ? 'Exit full screen' : 'Full screen'}>{fullscreen ? '🗗' : '⛶'}</button>
            )}
            {!fullscreen && (
              <button className="icon-btn light" onClick={() => { setExpanded((e) => !e); setPipPos(null); }} title={expanded ? 'Minimise' : 'Expand'}>{expanded ? '▾' : '⤢'}</button>
            )}
          </div>
          {local.micError && <div className="huddle-warn">{local.micError}</div>}
          {presenter ? (
            <div className="huddle-stage" ref={stageRef}>
              <div className="stage-main" onDoubleClick={fsSupported ? () => (fullscreen ? toggleFullscreen() : goFullscreen()) : undefined}
                title={fsSupported ? 'Double-click for full screen' : undefined}>
                <Tile {...presenter} big />
              </div>
              {others.length > 0 && (
                <div ref={pipRef} className="stage-pip" style={pipStyle} onPointerDown={(e) => dragPip(e, pipRef.current)} title="Drag to move">
                  {others.map((t) => <Tile key={t.id} {...t} />)}
                </div>
              )}
            </div>
          ) : (
            <div className={`tiles n${Math.min(people.length, 6)}`}>
              {people.map((t) => <Tile key={t.id} {...t} big={big} />)}
            </div>
          )}
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
        <AlertCards />
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
