// Huddle engine: WebRTC mesh calls (audio, camera, screen share) signaled over Socket.IO.
// One huddle at a time per browser tab. The newcomer sends offers to everyone already in the call.
// Each peer connection always carries one audio + one video transceiver, so turning the camera or
// screen share on/off is just replaceTrack() — no renegotiation needed.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';

const HuddleCtx = createContext(null);
export const useHuddle = () => useContext(HuddleCtx);
export const huddleKey = (scope, id) => `${scope}:${Number(id)}`;

const emitAck = (event, data) => new Promise((resolve) => getSocket().emit(event, data, resolve));

export function HuddleProvider({ children }) {
  const { user } = useAuth();
  const [active, setActive] = useState(null);        // { key, scope, scopeId, title, startedAt }
  const [peers, setPeers] = useState({});            // socketId -> { userId, name, avatar_url, audio, video, screen, stream, state }
  const [local, setLocal] = useState({ audio: false, video: false, screen: false, stream: null, micError: '' });
  const [states, setStates] = useState({});          // key -> huddle summary (active huddles I can see)
  const [rings, setRings] = useState([]);            // incoming huddle invitations
  const [notice, setNotice] = useState('');

  const pcs = useRef(new Map());                     // socketId -> { pc, stream, pending: [] }
  const tracks = useRef({ audio: null, camera: null, screen: null });
  const ice = useRef([{ urls: 'stun:stun.l.google.com:19302' }]);
  const activeRef = useRef(null);
  activeRef.current = active;

  const outgoingVideo = () => tracks.current.screen || tracks.current.camera || null;

  const refreshLocalPreview = useCallback(() => {
    const v = outgoingVideo();
    setLocal((l) => ({ ...l, stream: v ? new MediaStream([v]) : null }));
  }, []);

  const replaceAll = (kind, track) => {
    for (const { pc } of pcs.current.values()) {
      const t = pc.getTransceivers().find((x) => x.receiver.track?.kind === kind);
      t?.sender.replaceTrack(track).catch(() => {});
    }
  };

  const updatePeer = (id, patch) => setPeers((p) => (p[id] || patch.userId ? { ...p, [id]: { ...p[id], ...patch } } : p));

  const sendMedia = (patch) => getSocket().emit('huddle:media', patch);

  // ---------- peer connections ----------
  const createPeer = useCallback((remoteId, initiator) => {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    const entry = { pc, stream: new MediaStream(), pending: [] };
    pcs.current.set(remoteId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) getSocket().emit('huddle:signal', { to: remoteId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      if (!entry.stream.getTracks().includes(e.track)) entry.stream.addTrack(e.track);
      updatePeer(remoteId, { stream: entry.stream, tick: Date.now() });
    };
    pc.onconnectionstatechange = () => {
      updatePeer(remoteId, { state: pc.connectionState });
      if (pc.connectionState === 'failed' && initiator) pc.restartIce?.();
    };
    if (initiator) {
      const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const v = pc.addTransceiver('video', { direction: 'sendrecv' });
      a.sender.replaceTrack(tracks.current.audio).catch(() => {});
      v.sender.replaceTrack(outgoingVideo()).catch(() => {});
    }
    return entry;
  }, []);

  const closePeer = (id) => {
    const e = pcs.current.get(id);
    if (e) { e.pc.close(); pcs.current.delete(id); }
    setPeers((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const onSignal = useCallback(async ({ from, data }) => {
    let entry = pcs.current.get(from);
    try {
      if (data.description) {
        if (!entry) entry = createPeer(from, false);
        const { pc } = entry;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          for (const t of pc.getTransceivers()) {
            t.direction = 'sendrecv';
            const kind = t.receiver.track?.kind;
            await t.sender.replaceTrack(kind === 'audio' ? tracks.current.audio : outgoingVideo()).catch(() => {});
          }
          await pc.setLocalDescription(await pc.createAnswer());
          getSocket().emit('huddle:signal', { to: from, data: { description: pc.localDescription } });
        }
        for (const c of entry.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (!entry) entry = createPeer(from, false);
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
        else entry.pending.push(data.candidate);
      }
    } catch (e) {
      console.warn('Huddle signaling error', e);
    }
  }, [createPeer]);

  // ---------- teardown ----------
  const cleanup = useCallback(() => {
    for (const id of [...pcs.current.keys()]) closePeer(id);
    for (const k of ['audio', 'camera', 'screen']) { tracks.current[k]?.stop(); tracks.current[k] = null; }
    setPeers({});
    setLocal({ audio: false, video: false, screen: false, stream: null, micError: '' });
    setActive(null);
  }, []);

  const leave = useCallback(async () => {
    if (!activeRef.current) return;
    await emitAck('huddle:leave', {});
    cleanup();
  }, [cleanup]);

  // ---------- join ----------
  const join = useCallback(async (scope, id, fallbackTitle = 'Huddle') => {
    const key = huddleKey(scope, id);
    if (activeRef.current?.key === key) return { ok: true };
    if (activeRef.current) await leave();
    setRings((r) => r.filter((x) => x.huddle.key !== key));

    // Mic first, so it is attached to every connection from the start
    let micError = '';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      tracks.current.audio = s.getAudioTracks()[0];
    } catch {
      micError = 'Microphone not available – you joined listen-only';
    }

    const res = await emitAck('huddle:join', { scope, id: Number(id) });
    if (res?.error) {
      tracks.current.audio?.stop(); tracks.current.audio = null;
      setNotice(res.error);
      return res;
    }
    if (res.iceServers?.length) ice.current = res.iceServers;
    // In a 1:1 huddle each side sees the other person's name
    const title = res.huddle.type === 'direct' ? fallbackTitle : (res.huddle.title || fallbackTitle);
    setActive({ key, scope, scopeId: Number(id), title, startedAt: res.huddle.startedAt });
    setLocal({ audio: !!tracks.current.audio, video: false, screen: false, stream: null, micError });
    if (!tracks.current.audio) sendMedia({ audio: false });

    const initial = {};
    for (const p of res.peers) initial[p.socketId] = { state: 'connecting', ...p };
    setPeers(initial);
    // Newcomer calls everyone already in the huddle
    for (const p of res.peers) {
      if (p.simulated) continue; // demo build only
      try {
        const { pc } = createPeer(p.socketId, true);
        await pc.setLocalDescription(await pc.createOffer());
        getSocket().emit('huddle:signal', { to: p.socketId, data: { description: pc.localDescription } });
      } catch (e) {
        console.warn('Could not connect to', p.name, e);
        updatePeer(p.socketId, { state: 'failed' });
      }
    }
    return { ok: true };
  }, [createPeer, leave]);

  // ---------- controls ----------
  const toggleMic = useCallback(async () => {
    const t = tracks.current.audio;
    if (!t) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        tracks.current.audio = s.getAudioTracks()[0];
        replaceAll('audio', tracks.current.audio);
        setLocal((l) => ({ ...l, audio: true, micError: '' }));
        sendMedia({ audio: true });
      } catch { setNotice('Microphone permission was denied'); }
      return;
    }
    t.enabled = !t.enabled;
    setLocal((l) => ({ ...l, audio: t.enabled }));
    sendMedia({ audio: t.enabled });
  }, []);

  const toggleCamera = useCallback(async () => {
    if (tracks.current.camera) {
      tracks.current.camera.stop();
      tracks.current.camera = null;
      if (!tracks.current.screen) replaceAll('video', null);
      setLocal((l) => ({ ...l, video: false }));
      refreshLocalPreview();
      sendMedia({ video: false });
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
      tracks.current.camera = s.getVideoTracks()[0];
      if (!tracks.current.screen) replaceAll('video', tracks.current.camera);
      setLocal((l) => ({ ...l, video: true }));
      refreshLocalPreview();
      sendMedia({ video: true });
    } catch { setNotice('Camera not available'); }
  }, [refreshLocalPreview]);

  const stopScreen = useCallback(() => {
    tracks.current.screen?.stop();
    tracks.current.screen = null;
    replaceAll('video', tracks.current.camera);
    setLocal((l) => ({ ...l, screen: false }));
    refreshLocalPreview();
    sendMedia({ screen: false });
  }, [refreshLocalPreview]);

  const toggleScreen = useCallback(async () => {
    if (tracks.current.screen) return stopScreen();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      const t = s.getVideoTracks()[0];
      t.contentHint = 'detail';
      t.onended = stopScreen; // user pressed the browser's "Stop sharing"
      tracks.current.screen = t;
      replaceAll('video', t);
      setLocal((l) => ({ ...l, screen: true }));
      refreshLocalPreview();
      sendMedia({ screen: true });
    } catch { /* user cancelled */ }
  }, [stopScreen, refreshLocalPreview]);

  const fetchStatus = useCallback(async (scope, id) => {
    const res = await emitAck('huddle:status', { scope, id: Number(id) });
    const key = huddleKey(scope, id);
    setStates((s) => { const n = { ...s }; if (res?.huddle) n[key] = res.huddle; else delete n[key]; return n; });
    return res?.huddle || null;
  }, []);

  // Add people to the huddle I'm in: the server rings them. Resolves to { ok, invited } or { error }.
  const invite = useCallback((userIds) => emitAck('huddle:invite', { userIds }), []);

  const dismissRing = (key) => setRings((r) => r.filter((x) => x.huddle.key !== key));

  // ---------- socket events ----------
  useEffect(() => {
    if (!user) return undefined;
    const socket = getSocket();
    const onJoined = (p) => updatePeer(p.socketId, { state: 'connecting', ...p });
    const onLeft = ({ socketId }) => closePeer(socketId);
    const onMedia = (p) => updatePeer(p.socketId, { audio: p.audio, video: p.video, screen: p.screen });
    const onState = (s) => {
      setStates((prev) => { const n = { ...prev }; if (s.active) n[s.key] = s; else delete n[s.key]; return n; });
      if (!s.active) setRings((r) => r.filter((x) => x.huddle.key !== s.key));
    };
    const onRing = (r) => {
      if (activeRef.current?.key === r.huddle.key) return;
      setRings((list) => [...list.filter((x) => x.huddle.key !== r.huddle.key), { ...r, at: Date.now() }]);
      // Stop showing the call after ~50 s (the server re-rings for about 48 s)
      setTimeout(() => setRings((list) => list.filter((x) => x.huddle.key !== r.huddle.key || Date.now() - x.at < 50000)), 50500);
    };
    const onEndedHere = ({ reason }) => { cleanup(); setNotice(reason); };
    const onReconnect = () => { if (activeRef.current) { cleanup(); setNotice('Connection lost – please rejoin the huddle'); } };

    socket.on('huddle:peer-joined', onJoined);
    socket.on('huddle:peer-left', onLeft);
    socket.on('huddle:signal', onSignal);
    socket.on('huddle:media', onMedia);
    socket.on('huddle:state', onState);
    socket.on('huddle:ring', onRing);
    socket.on('huddle:ended-here', onEndedHere);
    socket.io?.on('reconnect', onReconnect);
    return () => {
      socket.off('huddle:peer-joined', onJoined);
      socket.off('huddle:peer-left', onLeft);
      socket.off('huddle:signal', onSignal);
      socket.off('huddle:media', onMedia);
      socket.off('huddle:state', onState);
      socket.off('huddle:ring', onRing);
      socket.off('huddle:ended-here', onEndedHere);
      socket.io?.off?.('reconnect', onReconnect);
    };
  }, [user, onSignal, cleanup]);

  // Desktop app: it warns before hiding the window during a huddle (the microphone stays on)
  useEffect(() => { window.tasksphereDesktop?.setInCall(!!active); }, [active]);

  // Leave cleanly when the tab closes
  useEffect(() => {
    const bye = () => { if (activeRef.current) getSocket().emit('huddle:leave', {}); };
    window.addEventListener('beforeunload', bye);
    return () => window.removeEventListener('beforeunload', bye);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const value = {
    active, peers, local, states, rings, notice, me: user,
    join, leave, toggleMic, toggleCamera, toggleScreen, fetchStatus, invite, dismissRing, setNotice,
  };
  return <HuddleCtx.Provider value={value}>{children}</HuddleCtx.Provider>;
}
