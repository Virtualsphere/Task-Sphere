// 🔔 in the top bar: shows whether desktop notifications and call sounds work, and fixes them.
// Always available, so "Not now" or the browser's "Block" can be undone later.
import { useEffect, useRef } from 'react';
import { useAlerts } from './NotificationCenter';

// Where to find the site's notification setting, per browser
function unblockSteps() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return ['Click the lock icon (🔒) at the left of the address bar.', 'Open “Permissions for this site”.', 'Set Notifications to “Allow”, then reload TaskSphere.'];
  if (/Firefox\//.test(ua)) return ['Click the lock or bell icon at the left of the address bar.', 'Next to “Send notifications”, click ✕ to remove “Blocked”.', 'Reload TaskSphere and click “Turn on” again.'];
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return ['Open Safari ▸ Settings ▸ Websites ▸ Notifications.', 'Find this site and choose “Allow”.', 'Reload TaskSphere.'];
  return ['Click the icon at the left of the address bar (🔒 or the “tune” icon).', 'Turn on Notifications, or open “Site settings” and set Notifications to “Allow”.', 'Reload TaskSphere.'];
}

const STATUS = {
  granted: { label: 'On', cls: 'ok' },
  default: { label: 'Off', cls: 'off' },
  denied: { label: 'Blocked', cls: 'bad' },
  unsupported: { label: 'Not supported', cls: 'off' },
};

export function NotificationBell() {
  const a = useAlerts();
  if (!a) return null;
  const needsAttention = a.permission !== 'granted';
  return (
    <div className="notify-bell-wrap">
      <button type="button" className={`icon-btn notify-bell ${a.settingsOpen ? 'on' : ''}`} onClick={() => a.setSettingsOpen(!a.settingsOpen)}
        aria-label="Notification settings" aria-expanded={a.settingsOpen} title="Notification settings">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {needsAttention && <span className="notify-bell-dot" aria-hidden="true" />}
      </button>
      {a.settingsOpen && <NotificationSettings onClose={() => a.setSettingsOpen(false)} />}
    </div>
  );
}

function NotificationSettings({ onClose }) {
  const a = useAlerts();
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.notify-bell')) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);

  const st = STATUS[a.permission] || STATUS.default;
  return (
    <div className="notify-panel" ref={ref} role="dialog" aria-label="Notification settings">
      <div className="notify-panel-head">
        <strong>Notifications</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <section className="notify-row">
        <div className="notify-row-top">
          <div className="grow">
            <div className="notify-row-title">Desktop notifications</div>
            <div className="small muted">Huddle calls, @mentions and new messages, even when you're in another window.</div>
          </div>
          <span className={`notify-status ${st.cls}`}>{st.label}</span>
        </div>
        {a.permission === 'default' && (
          <button type="button" className="btn primary small block-btn" onClick={a.enable}>Turn on</button>
        )}
        {a.permission === 'denied' && (
          <div className="notify-help">
            <div className="small"><strong>Your browser is blocking notifications for TaskSphere.</strong> Only you can change this, in the browser:</div>
            <ol className="small">{unblockSteps().map((s) => <li key={s}>{s}</li>)}</ol>
            <button type="button" className="btn small" onClick={a.refreshPermission}>I've changed it, check again</button>
          </div>
        )}
        {a.permission === 'unsupported' && (
          <div className="small muted">This browser can't show desktop notifications. You'll still get emails and alerts inside TaskSphere.</div>
        )}
      </section>

      <section className="notify-row">
        <div className="notify-row-top">
          <div className="grow">
            <div className="notify-row-title">Call sound</div>
            <div className="small muted">
              {a.soundReady
                ? 'Huddle calls will ring on this computer.'
                : 'Browsers stay silent until you click the page once after opening it. Click “Test call sound” to allow it.'}
            </div>
          </div>
          <span className={`notify-status ${a.soundReady ? 'ok' : 'off'}`}>{a.soundReady ? 'Ready' : 'Waiting'}</span>
        </div>
        <button type="button" className="btn small block-btn" onClick={a.testSound}>🔊 Test call sound</button>
      </section>

      <p className="small muted notify-foot">Emails for huddles and @mentions are always sent. Keep TaskSphere open in a tab to hear calls.</p>
    </div>
  );
}
