import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { closeSocket } from './socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const loginWithGoogle = async (credential) => {
    const { token, user } = await api('/auth/google', { method: 'POST', body: { credential } });
    setToken(token);
    setUser(user);
  };

  // Google Workspace sign-in that also connects Google Calendar (authorization-code flow)
  const loginWithCode = async (code) => {
    const { token, user, calendar } = await api('/auth/google-code', { method: 'POST', body: { code } });
    setToken(token);
    setUser(user);
    return calendar;
  };

  // Local test mode only (DEV_LOGIN=true on the server)
  const loginAsTestUser = async (email) => {
    const { token, user } = await api('/auth/dev', { method: 'POST', body: { email } });
    closeSocket(); // a fresh socket for the new user
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    setToken(null);
    closeSocket();
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, loginWithGoogle, loginWithCode, loginAsTestUser, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
