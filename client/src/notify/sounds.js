// Alert sounds.
//  - startRingtone(): incoming-huddle call tone that loops until stopRingtone() (max 60 s)
//  - playPing(): short chime for a mention or a new message
//
// Ringtone: if the file /sounds/ringtone.mp3 exists (client/public/sounds/ringtone.mp3), that file is
// played on a loop. Otherwise a built-in marimba-style call tone is generated with the Web Audio API.
// Either way the loop runs on the audio clock, not on JavaScript timers, so it keeps ringing even when
// the tab is in the background (Chrome slows background timers down to once a minute).
//
// Browsers only allow sound after the person has clicked or typed on the page once since it loaded;
// unlockAudio() runs on the first click/key press. Until then, the desktop notification's own sound
// (re-sent every few seconds by the server while the call rings) is what the person hears.

const RINGTONE_FILE = '/sounds/ringtone.mp3';
const MAX_RING_S = 60;

let ctx = null;
let master = null;

function audio() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    // Compressor + make-up gain: as loud as the system volume allows, without distortion
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const makeUp = ctx.createGain();
    makeUp.gain.value = 1.8;
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(comp).connect(makeUp).connect(ctx.destination);
  }
  return ctx;
}

export const audioUnlocked = () => !!ctx && ctx.state === 'running';

export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
  prepareRingtone();
}
if (typeof window !== 'undefined') {
  const once = () => { unlockAudio(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

// ---------- built-in call tone ----------

// One marimba-like strike: a sine fundamental plus the bright 4th and 10th partials that make a
// wooden bar sound, each decaying quickly, with a soft attack click.
function strike(a, out, freq, t, vol, length = 1.1) {
  for (const [mult, v, decay] of [[1, 1, length], [3.98, 0.35, 0.22], [9.9, 0.12, 0.08]]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.02);
  }
}

// An original two-phrase call melody (a rising "call" and a falling "answer"), ~3.2 s per cycle.
// Notes: [frequency Hz, start s, volume]
const N = { A4: 440, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.51 };
const CALL_TONE = [
  [N.E5, 0.00, 0.9], [N.A5, 0.16, 0.9], [N.C6, 0.32, 0.95], [N.E6, 0.48, 1.0],
  [N.C6, 0.72, 0.85], [N.A5, 0.88, 0.85],
  [N.E5, 1.30, 0.9], [N.A5, 1.46, 0.9], [N.C6, 1.62, 0.95], [N.E6, 1.78, 1.0],
  [N.G5, 2.02, 0.85], [N.A5, 2.18, 0.9],
];
const CYCLE_S = 3.2;

let ringBuffer = null;
let ringBufferPromise = null;

// Renders one cycle of the call tone into an audio buffer once; it is then looped seamlessly.
// (Exported so the tone can be rendered to a file for listening tests.)
export function buildRingBuffer() {
  if (ringBuffer || ringBufferPromise) return ringBufferPromise;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const rate = 44100;
  const off = new OAC(2, Math.ceil(CYCLE_S * rate), rate);
  const out = off.createGain();
  out.gain.value = 0.55;
  out.connect(off.destination);
  for (const [f, t, v] of CALL_TONE) strike(off, out, f, t + 0.01, v);
  ringBufferPromise = off.startRendering().then((buf) => { ringBuffer = buf; return buf; }).catch(() => null);
  return ringBufferPromise;
}

// ---------- optional ringtone file ----------

let fileChecked = false;
let fileAudio = null;
function prepareRingtone() {
  buildRingBuffer();
  if (fileChecked || typeof fetch === 'undefined') return;
  fileChecked = true;
  fetch(RINGTONE_FILE, { method: 'HEAD' })
    .then((r) => {
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('audio')) return;
      fileAudio = new Audio(RINGTONE_FILE);
      fileAudio.loop = true;
      fileAudio.preload = 'auto';
      fileAudio.volume = 1;
    })
    .catch(() => {});
}

// ---------- ringing ----------

let ringSource = null;
let ringStopTimer = null;
let ringing = false;

/** Start the incoming-huddle ringtone (no-op if already ringing). Returns true if sound is playing. */
export function startRingtone() {
  prepareRingtone();
  if (ringing) return audioUnlocked() || (fileAudio && !fileAudio.paused);
  ringing = true;
  clearTimeout(ringStopTimer);
  ringStopTimer = setTimeout(stopRingtone, MAX_RING_S * 1000);

  if (fileAudio) {
    fileAudio.currentTime = 0;
    fileAudio.play().catch(() => playBuiltIn()); // not allowed yet / bad file: fall back
    return true;
  }
  return playBuiltIn();
}

function playBuiltIn() {
  const a = audio();
  if (!a) return false;
  if (a.state === 'suspended') a.resume().catch(() => {});
  const go = (buf) => {
    if (!ringing || !buf || ringSource) return;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.loop = true; // seamless loop on the audio clock
    src.connect(master);
    const t = a.currentTime + 0.03;
    src.start(t);
    src.stop(t + MAX_RING_S); // stops by itself even if the page's timers are throttled
    src.onended = () => { if (ringSource === src) ringSource = null; };
    ringSource = src;
  };
  if (ringBuffer) go(ringBuffer);
  else buildRingBuffer()?.then(go);
  return a.state === 'running';
}

export function stopRingtone() {
  ringing = false;
  clearTimeout(ringStopTimer);
  ringStopTimer = null;
  try { ringSource?.stop(); } catch { /* already stopped */ }
  ringSource = null;
  if (fileAudio) { fileAudio.pause(); fileAudio.currentTime = 0; }
}

// If the page becomes allowed to play sound while a call is still ringing, start the tone then
export function retryRingtone() {
  if (ringing && !ringSource && !(fileAudio && !fileAudio.paused)) playBuiltIn();
}

let lastPing = 0;
/** Short chime for a mention or a message (at most one per second). */
export function playPing() {
  const a = audio();
  if (!a || a.state !== 'running' || Date.now() - lastPing < 1000) return;
  lastPing = Date.now();
  const t = a.currentTime + 0.02;
  strike(a, master, N.A5, t, 0.5, 0.5);
  strike(a, master, N.E6, t + 0.12, 0.5, 0.7);
}

// For the "Test sound" button
export function previewRingtone(seconds = 4) {
  unlockAudio();
  stopRingtone();
  startRingtone();
  setTimeout(stopRingtone, seconds * 1000);
}
