const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { COOKIE_NAME, csrfFor, safeEqual } = require('../utils/session');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  let token; let via;
  if (header.startsWith('Bearer ')) { token = header.slice(7); via = 'bearer'; }
  else if (req.cookies?.[COOKIE_NAME]) { token = req.cookies[COOKIE_NAME]; via = 'cookie'; }
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ message: 'Invalid or expired token' }); }

  // CSRF: browsers attach cookies automatically, so cookie-authenticated writes must also prove they came from
  // our own app by echoing the CSRF token. Bearer-header requests are not CSRF-able (a browser never adds that header by itself).
  const csrfToken = csrfFor(token);
  if (via === 'cookie' && !SAFE_METHODS.has(req.method) && !safeEqual(req.headers['x-csrf-token'] || '', csrfToken)) {
    return res.status(403).json({ message: 'Invalid or missing CSRF token' });
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'Active') return res.status(401).json({ message: 'User account is unavailable' });
  req.user = user; req.authVia = via; req.csrfToken = csrfToken;
  next();
});

const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ message: 'Admin access required' }));

module.exports = { protect, requireAdmin };
