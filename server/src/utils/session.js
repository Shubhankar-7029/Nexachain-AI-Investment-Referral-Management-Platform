const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'nexa_session';

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
}
// CSRF token = HMAC(secret, session token). Stateless: no extra cookie or DB row, tied to this exact session,
// and unreadable to an attacker's site (it is only handed to our own JS in a JSON response).
function csrfFor(sessionToken) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`csrf:${sessionToken}`).digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookieOptions(token) {
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(); // 'none' only if API and site are on different domains
  const exp = jwt.decode(token)?.exp;
  return {
    httpOnly: true,                                   // JavaScript (and therefore XSS) cannot read the session
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: '/',
    maxAge: exp ? Math.max(0, exp * 1000 - Date.now()) : undefined
  };
}
// Starts a browser session: sets the httpOnly cookie and returns what the response body should carry.
function startSession(res, user) {
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions(token));
  // `token` stays in the body only for API tools (Postman, curl) using "Authorization: Bearer"; the web app ignores it.
  return { token, csrfToken: csrfFor(token) };
}
function endSession(res) {
  const { maxAge, ...opts } = cookieOptions(signToken({ _id: 'x' }));
  res.clearCookie(COOKIE_NAME, opts);
}
module.exports = { COOKIE_NAME, signToken, csrfFor, safeEqual, startSession, endSession };
