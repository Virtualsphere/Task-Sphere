import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider } from './AuthContext';
import { config } from './config';
import App from './App';
import './styles.css';

// The Google Client ID comes from VITE_GOOGLE_CLIENT_ID, or from the server's .env via /api/config
function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => Object.assign(config, c))
      .catch(() => {})
      .finally(() => {
        if (import.meta.env.VITE_GOOGLE_CLIENT_ID) config.googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        setReady(true);
      });
  }, []);
  if (!ready) return null;
  return (
    <GoogleOAuthProvider clientId={config.googleClientId}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
