import { useEffect, useState } from 'react';
import { api } from '../api';
import { initials } from '../util';
import { GoogleLogin, useGoogleLogin } from '@react-oauth/google';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { config } from '../config';
import { GoogleG } from '../components/ScheduleMeetingModal';

// One sign-in with the company Google Workspace account. It also grants calendar access,
// so meetings can be booked (with Google Meet) without a separate "connect calendar" step.
function WorkspaceSignIn({ onError }) {
  const { loginWithCode } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const login = useGoogleLogin({
    flow: 'auth-code',
    scope: `${config.calendarScopes} profile`,
    hd: config.allowedDomain || undefined,   // Google shows only accounts from this Workspace domain
    select_account: true,
    onSuccess: async ({ code }) => {
      setBusy(true);
      try { await loginWithCode(code); navigate('/'); }
      catch (e) { onError(e.message); setBusy(false); }
    },
    onError: () => onError('Google sign-in was cancelled'),
  });
  return (
    <button className="btn workspace-btn" onClick={() => { onError(''); login(); }} disabled={busy}>
      <GoogleG /> {busy ? 'Signing in…' : 'Sign in with Google Workspace'}
    </button>
  );
}

// Local test mode: sign in as any seeded test user (open several browser windows to test as different people)
function TestUserPicker({ onError }) {
  const { loginAsTestUser } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState(null);
  useEffect(() => { api('/auth/dev-users').then(setUsers).catch((e) => onError(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!users) return <p className="muted small">Loading test users…</p>;
  return (
    <div className="demo-accounts">
      <div className="demo-accounts-head">🧪 Local test mode – sign in as</div>
      {users.map((u) => (
        <button key={u.id} className="demo-account" onClick={async () => {
          try { await loginAsTestUser(u.email); navigate('/'); } catch (e) { onError(e.message); }
        }}>
          <span className="avatar avatar-fallback" style={{ width: 34, height: 34, fontSize: 13 }}>{initials(u.name)}</span>
          <span className="grow">
            <strong>{u.name}</strong>
            <span className="muted small block">{u.email}</span>
          </span>
          <span className="roles-col">
            {u.roles.slice(0, 2).map((r) => <span key={r.space} className={`role-badge role-${r.role}`} title={r.space}>{r.role}</span>)}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function Login() {
  const { user, loginWithGoogle } = useAuth();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand-mark">◆</div>
        <h1>TaskSphere</h1>
        <p className="muted">Spaces, lists, tickets, chat, huddles and meetings – in one place.</p>
        <div className="login-btn">
          {config.devLogin ? (
            <TestUserPicker onError={setError} />
          ) : config.loginWithCalendar ? (
            <WorkspaceSignIn onError={setError} />
          ) : (
            <GoogleLogin
              onSuccess={async (res) => {
                try { await loginWithGoogle(res.credential); navigate('/'); }
                catch (e) { setError(e.message); }
              }}
              onError={() => setError('Google sign-in failed')}
              hosted_domain={config.allowedDomain || undefined}
              text="signin_with"
              shape="pill"
            />
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {config.devLogin ? (
          <p className="muted small">Tip: open a second browser (or an incognito window) and sign in as another person to test chat, huddles and roles together.</p>
        ) : <p className="muted small">
          {config.allowedDomain ? <>Use your official <strong>@{config.allowedDomain}</strong> Google Workspace account.</> : 'Sign in with your office Google account.'}
          {config.loginWithCalendar && <><br />You'll be asked to allow calendar access so meetings can be booked for you.</>}
        </p>}
      </div>
    </div>
  );
}
