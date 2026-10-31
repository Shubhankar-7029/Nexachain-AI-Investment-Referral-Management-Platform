import axios from 'axios';

// The session lives in an httpOnly cookie that JavaScript cannot read (so XSS cannot steal it).
// For writes the server also wants a CSRF token, which we keep in memory only (never localStorage).
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api', withCredentials: true });

let csrfToken = null;
export const setCsrfToken = (token) => { csrfToken = token; };

api.interceptors.request.use((config) => {
  if (csrfToken && !['get', 'head', 'options'].includes((config.method || 'get').toLowerCase())) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});

// An expired/invalid session on ANY request signs the user out (the startup /auth/me probe and login/register are expected to 401).
const QUIET_401 = ['/auth/login', '/auth/register', '/auth/me', '/auth/logout'];
api.interceptors.response.use((r) => r, (error) => {
  const url = error.config?.url || '';
  if (error.response?.status === 401 && !QUIET_401.some((p) => url.startsWith(p))) window.dispatchEvent(new Event('nexa:unauthorized'));
  return Promise.reject(error);
});
export default api;
