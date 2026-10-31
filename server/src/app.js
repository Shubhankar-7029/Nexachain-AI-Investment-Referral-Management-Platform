const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { protect, requireAdmin } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/authRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const referralRoutes = require('./routes/referralRoutes');
const adminRoutes = require('./routes/adminRoutes');
const depositRoutes = require('./routes/depositRoutes');
const app = express();
// Behind a reverse proxy (Render, Heroku, nginx) set TRUST_PROXY=1 so rate limiting sees the real client IP.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(s => s.trim()), credentials: true })); // credentials: the browser app authenticates with an httpOnly cookie
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'nexachain-assessment-api' }));
app.use('/api/auth', authRoutes);
app.use('/api/investments', protect, investmentRoutes);
app.use('/api/dashboard', protect, dashboardRoutes);
app.use('/api/referrals', protect, referralRoutes);
app.use('/api/deposits', protect, depositRoutes);
// Admin-only (role checked on every request, so it is safe in production too).
app.use('/api/admin', protect, requireAdmin, adminRoutes);
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
app.use(errorHandler);
module.exports = app;
