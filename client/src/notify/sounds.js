// Alert sounds.
//  - startRingtone(): incoming-huddle call tone that loops until stopRingtone() (max 60 s)
//  - playPing(): short sound for a mention or a new message
//
// The sounds are the files client/public/sounds/ringtone.mp3 (huddle, looped) and notification.mp3 (messages).
// If a file is missing or can't play, a built-in tone is generated with the Web Audio API instead.
// Either way the loop runs on the audio clock, not on JavaScript timers, so it keeps ringing even when
// the tab is in the background (Chrome slows background timers down to once a minute).
//
// Browsers only allow sound after the person has clicked or typed on the page once since it loaded;
// unlockAudio() runs on the first click/key press. Until then, the desktop notification's own sound
// (re-sent every few seconds by the server while the call rings) is what the person hears.

const RINGTONE_FILE = '/sounds/ringtone.mp3';
const PING_FILE = '/sounds/notification.mp3';
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
  buildRingBuffer();
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

// ---------- sound files ----------

// Loaded as soon as the page opens, so the first call or message already uses them.
// Gives up on the file (-> built-in tone) if it is missing or not playable.
function soundFile(url, loop) {
  if (typeof Audio === 'undefined') return { el: null };
  const f = { el: new Audio() };
  f.el.addEventListener('error', () => { f.el = null; });
  f.el.loop = loop;
  f.el.preload = 'auto';
  f.el.src = url;
  return f;
}
const ringFile = soundFile(RINGTONE_FILE, true);
const pingFile = soundFile(PING_FILE, false);

// ---------- ringing ----------

let ringSource = null;
let ringStopTimer = null;
let ringing = false;

/** Is the ringtone actually being heard right now? */
export const ringtoneAudible = () => !!ringFile.el && !ringFile.el.paused || (!!ringSource && audioUnlocked());

/** Start the incoming-huddle ringtone (no-op if already ringing). */
export function startRingtone() {
  if (ringing) return;
  ringing = true;
  clearTimeout(ringStopTimer);
  ringStopTimer = setTimeout(stopRingtone, MAX_RING_S * 1000);
  playRing();
}

function playRing() {
  if (!ringFile.el) { playBuiltIn(); return; }
  ringFile.el.currentTime = 0;
  ringFile.el.play().catch((e) => {
    // Not allowed before the first click: try the built-in tone, retryRingtone() tries the file again.
    // (AbortError = we stopped it ourselves before it started)
    if (ringing && e.name !== 'AbortError') playBuiltIn();
  });
}

function playBuiltIn() {
  const a = audio();
  if (!a) return false;
  if (a.state === 'suspended') a.resume().catch(() => {});
  const go = (buf) => {
    if (!ringing || !buf || ringSource || a.state !== 'running') return;
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
  if (ringFile.el) { ringFile.el.pause(); ringFile.el.currentTime = 0; }
}

// If the page becomes allowed to play sound while a call is still ringing, start the tone then
export function retryRingtone() {
  if (ringing && !ringtoneAudible()) playRing();
}

let lastPing = 0;
/** Short sound for a mention or a message (at most one per second). Resolves to true if it was heard. */
export async function playPing() {
  if (Date.now() - lastPing < 1000) return true; // one just played
  if (pingFile.el) {
    try {
      pingFile.el.currentTime = 0;
      await pingFile.el.play();
      lastPing = Date.now();
      return true;
    } catch { /* not allowed yet, or the file can't play: try the built-in chime */ }
  }
  const a = audio();
  if (!a || a.state !== 'running') return false;
  lastPing = Date.now();
  const t = a.currentTime + 0.02;
  strike(a, master, N.A5, t, 0.5, 0.5);
  strike(a, master, N.E6, t + 0.12, 0.5, 0.7);
  return true;
}

// For the "Test sound" button
export function previewRingtone(seconds = 4) {
  unlockAudio();
  stopRingtone();
  startRingtone();
  setTimeout(stopRingtone, seconds * 1000);
}
