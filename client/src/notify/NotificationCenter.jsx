// Alerts for things that need your attention, wherever you are in the app:
//  - incoming huddle  -> loud ringtone + desktop notification (the Join/Dismiss card is in HuddleWindow)
//  - @mention (space chat, task comment, personal chat) -> chime + desktop notification
//  - new personal message (unless that chat is open in front of you) -> chime + desktop notification
// When TaskSphere is the window you're looking at, a card shows inside the app instead of a desktop popup.
// Clicking either opens the related page.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSocket } from '../socket';
import { useAuth } from '../AuthContext';
import { useHuddle } from '../huddle/HuddleContext';
import Avatar from '../components/Avatar';
import { plainMentions } from '../components/ChatText';
import { filePreviewText } from '../components/FileMessage';
import { startRingtone, stopRingtone, retryRingtone, previewRingtone, playPing, unlockAudio } from './sounds';
import { showDesktop, closeDesktop, desktopPermission, askDesktopPermission, setNotificationNavigator } from './desktop';

const AlertCtx = createContext(null);
export const useAlerts = () => useContext(AlertCtx);

const PROMPT_KEY = 'pm_notify_prompt_dismissed';
const looking = () => document.visibilityState === 'visible' && document.hasFocus();

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const huddle = useHuddle();
  const [cards, setCards] = useState([]); // in-app alert cards
  const [permission, setPermission] = useState(desktopPermission());
  const [promptHidden, setPromptHidden] = useState(() => { try { return localStorage.getItem(PROMPT_KEY) === '1'; } catch { return false; } });
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const ringsRef = useRef([]);
  ringsRef.current = (huddle?.rings || []).filter((r) => r.huddle.key !== huddle?.active?.key);

  useEffect(() => { setNotificationNavigator(navigate); }, [navigate]);

  // Opened from a "Join the huddle" email or notification (…?huddle=1): offer to join if it's still live
  const [linkHuddle, setLinkHuddle] = useState(null); // { scope, id, key }
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('huddle') !== '1' || !huddle) return;
    const m = location.pathname.match(/^\/(spaces|messages)\/(\d+)/);
    q.delete('huddle');
    navigate({ pathname: location.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
    if (!m) return;
    const scope = m[1] === 'spaces' ? 'space' : 'conv';
    const id = Number(m[2]);
    huddle.fetchStatus(scope, id)
      .then((h) => (h ? setLinkHuddle({ scope, id, key: h.key }) : huddle.setNotice('That huddle has already ended')))
      .catch(() => {});
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = useCallback((tag) => setCards((c) => c.filter((x) => x.tag !== tag)), []);

  // One alert: chime, then a desktop popup if you're elsewhere, else an in-app card
  const alert = useCallback(({ title, body, tag, path, from }) => {
    playPing();
    if (!looking() && showDesktop({ title, body, tag, path })) return;
    setCards((c) => [...c.filter((x) => x.tag !== tag), { title, body, tag, path, from }].slice(-4));
    setTimeout(() => dismiss(tag), 9000);
  }, [dismiss]);

  useEffect(() => {
    if (!user) return undefined;
    const s = getSocket();

    const onMention = (n) => alert({ title: n.title, body: `${n.where}: ${n.body}`, tag: n.tag, path: n.path, from: n.from });

    const onDm = (m) => {
      if (m.user_id === user.id || m.kind === 'huddle') return;
      const path = `/messages/${m.conversationId}`;
      if (looking() && pathRef.current === path) return; // reading this chat right now
      const body = m.kind === 'file' ? filePreviewText(m.body) : m.kind === 'meeting' ? '📅 Scheduled a meeting' : plainMentions(m.body);
      alert({ title: m.name, body, tag: `dm-${m.id}`, path, from: { name: m.name, avatar_url: m.avatar_url } });
    };

    // Huddle calls: desktop popup that stays until answered (the ringtone is handled below)
    const callPopup = (r) => {
      const direct = r.huddle.type === 'direct';
      showDesktop({
        title: direct ? `📞 ${r.from.name} is calling you` : `📞 ${r.from.name} started a huddle`,
        body: direct ? 'Huddle · click to open and join' : `In ${r.title} · click to open and join`,
        tag: `huddle-${r.huddle.key}`, path: r.path, sticky: true, silent: false,
      });
    };
    const onRing = (r) => { if (!looking()) callPopup(r); };
    // The server re-rings every few seconds until you join: sound the popup again and make sure the
    // ringtone is going (e.g. if sound only just became allowed)
    const onRingTick = ({ key }) => {
      const r = ringsRef.current.find((x) => x.huddle.key === key);
      if (!r) return; // dismissed, joined or already over
      retryRingtone();
      if (!looking()) callPopup(r);
    };
    const onHuddleState = (st) => { if (!st.active) closeDesktop(`huddle-${st.key}`); };

    s.on('notify:mention', onMention);
    s.on('dm:message', onDm);
    s.on('huddle:ring', onRing);
    s.on('huddle:ring-tick', onRingTick);
    s.on('huddle:state', onHuddleState);
    return () => {
      s.off('huddle:ring-tick', onRingTick);
      s.off('notify:mention', onMention);
      s.off('dm:message', onDm);
      s.off('huddle:ring', onRing);
      s.off('huddle:state', onHuddleState);
    };
  }, [user, alert]);

  // Ring while there is an incoming huddle you haven't joined or dismissed
  const ringing = (huddle?.rings || []).filter((r) => r.huddle.key !== huddle?.active?.key);
  const ringKeys = ringing.map((r) => r.huddle.key).join(',');
  const prevRingKeys = useRef([]);
  useEffect(() => {
    const now = ringKeys ? ringKeys.split(',') : [];
    if (now.length) startRingtone(); else stopRingtone();
    // Answered, dismissed or ended: take its desktop popup away too
    for (const k of prevRingKeys.current) if (!now.includes(k)) closeDesktop(`huddle-${k}`);
    prevRingKeys.current = now;
  }, [ringKeys]);
  useEffect(() => () => stopRingtone(), []);

  const enable = async () => {
    unlockAudio();
    previewRingtone(3); // let them hear what a huddle call sounds like
    setPermission(await askDesktopPermission());
  };
  const hidePrompt = () => {
    setPromptHidden(true);
    try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
  };
  const showPrompt = user && permission === 'default' && !promptHidden;

  const open = (card) => { dismiss(card.tag); if (card.path) navigate(card.path); };

  return (
    <AlertCtx.Provider value={{ cards, dismiss, open, showPrompt, enable, hidePrompt, linkHuddle, clearLinkHuddle: () => setLinkHuddle(null) }}>
      {children}
    </AlertCtx.Provider>
  );
}

// The in-app cards; rendered inside the huddle toast stack so everything lines up in one place
export function AlertCards() {
  const a = useAlerts();
  const h = useHuddle();
  if (!a) return null;
  const live = a.linkHuddle && h?.states[a.linkHuddle.key];
  const showLive = live && h.active?.key !== a.linkHuddle.key;
  const caller = live && (live.participants.find((p) => p.userId === live.startedBy?.id) || live.participants[0]
    || { name: live.startedBy?.name || live.title || 'Huddle' });
  return (
    <>
      {showLive && (
        <div className="toast ring">
          <Avatar user={caller} size={36} />
          <div className="grow">
            <strong>{caller.name}</strong>
            <div className="small muted">
              {live.type === 'direct' ? 'is in a huddle with you' : `huddle in ${live.title}`} · {live.participants.length} in the call
            </div>
          </div>
          <button className="btn primary small" onClick={() => { h.join(a.linkHuddle.scope, a.linkHuddle.id, live.title); a.clearLinkHuddle(); }}>Join</button>
          <button className="btn small" onClick={a.clearLinkHuddle}>Not now</button>
        </div>
      )}
      {a.showPrompt && (
        <div className="toast notify-prompt" role="dialog" aria-label="Turn on notifications">
          <span className="notify-prompt-icon" aria-hidden="true">🔔</span>
          <div className="grow small">
            <strong>Turn on desktop notifications</strong>
            <div className="muted">Hear huddle calls and get alerts for mentions and messages, even in another window. Keep TaskSphere open in a tab.</div>
          </div>
          <button className="btn primary small" onClick={a.enable}>Turn on</button>
          <button className="btn small" onClick={() => previewRingtone(4)} title="Play the huddle call sound">🔊 Test sound</button>
          <button className="btn small" onClick={a.hidePrompt}>Not now</button>
        </div>
      )}
      {a.cards.map((c) => (
        <div className="toast alert-card" key={c.tag} role="status">
          {c.from && <Avatar user={c.from} size={32} />}
          <button type="button" className="grow alert-card-body" onClick={() => a.open(c)}>
            <strong className="clamp1">{c.title}</strong>
            <span className="small muted alert-card-text">{c.body}</span>
          </button>
          <button className="icon-btn" onClick={() => a.dismiss(c.tag)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </>
  );
}
