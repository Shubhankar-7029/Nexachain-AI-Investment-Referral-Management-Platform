import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setCsrfToken } from '../services/api';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false); // false until we know whether a valid session cookie exists

  const clearLocal = useCallback(() => { setCsrfToken(null); setUser(null); }, []);
  const accept = useCallback((data) => { setCsrfToken(data.csrfToken); setUser(data.user); }, []);

  // Restore the session from the cookie on page load: nothing sensitive is kept in localStorage.
  useEffect(() => {
    let alive = true;
    api.get('/auth/me').then(({ data }) => { if (alive) accept(data); }).catch(() => {}).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [accept]);

  useEffect(() => { window.addEventListener('nexa:unauthorized', clearLocal); return () => window.removeEventListener('nexa:unauthorized', clearLocal); }, [clearLocal]);

  const login = useCallback(async (values) => accept((await api.post('/auth/login', values)).data), [accept]);
  const register = useCallback(async (values) => accept((await api.post('/auth/register', values)).data), [accept]);
  const logout = useCallback(async () => { try { await api.post('/auth/logout'); } catch { /* cookie may already be gone */ } clearLocal(); }, [clearLocal]);

  const value = useMemo(() => ({ user, ready, isAdmin: user?.role === 'admin', login, register, logout }), [user, ready, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
