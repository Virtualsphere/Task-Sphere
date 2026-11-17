// Sandboxed hosts block confirm(); demo data resets anyway, so auto-confirm
window.confirm = () => true;

// DEMO entry: same App, but in-memory routing + mocked backend/Google login (aliased in vite.demo.config.js)
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import App from '../App';
import '../styles.css';
import { config } from '../config';

// The demo keeps its account picker instead of a real Google Workspace sign-in
config.loginWithCalendar = false;
config.allowedDomain = 'virtualsphere.demo';
import './demo.css';

function DemoBanner() {
  return (
    <div className="demo-banner">
      <strong>Demo</strong> · sample data, resets on reload · <em>Sign out</em> to try another role
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <MemoryRouter>
    <AuthProvider>
      <App />
      <DemoBanner />
    </AuthProvider>
  </MemoryRouter>
);
