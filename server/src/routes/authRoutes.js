const router = require('express').Router();
const { register, login, me, logout } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), skip: () => process.env.NODE_ENV === 'test', standardHeaders: true, legacyHeaders: false, message: { message: 'Too many authentication attempts; try again later' } });
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', protect, me);
router.post('/logout', logout); // always allowed: clearing a cookie is harmless and must work even with an expired session
module.exports = router;
