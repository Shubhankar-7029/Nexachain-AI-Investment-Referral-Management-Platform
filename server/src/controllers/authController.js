const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validators');

const { startSession, endSession } = require('../utils/session');

exports.register = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const fullName = v.str(body.fullName, 'Full name', { max: 100 });
  const email = v.email(body.email);
  const mobileNumber = v.mobile(body.mobileNumber);
  const password = body.password;
  if (typeof password !== 'string' || password.length < 8) throw new AppError('Password must be at least 8 characters');
  if (password.length > 72) throw new AppError('Password must be at most 72 characters'); // bcrypt ignores bytes after 72
  if (await User.exists({ email })) throw new AppError('Email is already registered', 409);
  let parent = null;
  if (typeof body.referralCode === 'string' && body.referralCode.trim()) {
    parent = await User.findOne({ referralCode: body.referralCode.trim().toUpperCase(), status: 'Active' });
    if (!parent) throw new AppError('Referral code is invalid');
  }
  const user = await User.create({ fullName, email, mobileNumber, password, referredBy: parent?._id || null });
  res.status(201).json({ ...startSession(res, user), user });
});
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw new AppError('Email and password are required');
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw new AppError('Invalid email or password', 401);
  if (user.status !== 'Active') throw new AppError('Account is not active', 403);
  res.json({ ...startSession(res, user), user: user.toJSON() });
});
exports.me = asyncHandler(async (req, res) => res.json({ user: req.user, csrfToken: req.csrfToken }));
exports.logout = (_req, res) => { endSession(res); res.json({ message: 'Signed out' }); };
