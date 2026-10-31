const mongoose = require('mongoose');
const Investment = require('../models/Investment');
const User = require('../models/User');
const { distributeReferralIncome } = require('../services/referralService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validators');
const { toPaise, presentMoney } = require('../utils/money');
const { pageParams, pageMeta } = require('../utils/pagination');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.createInvestment = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const amount = v.num(body.amount);
  const maxAmount = Number(process.env.MAX_INVESTMENT_AMOUNT || 1000000);
  if (!Number.isFinite(amount) || amount < 1 || amount > maxAmount) throw new AppError(`Amount must be between 1 and ${maxAmount}`);
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new AppError('Amount can have at most 2 decimal places');
  const amountPaise = toPaise(amount);
  const planName = body.planName === undefined ? 'Starter Plan' : v.str(body.planName, 'Plan name', { max: 80 });
  const durationDays = body.durationDays === undefined ? 30 : v.num(body.durationDays);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) throw new AppError('Duration must be a whole number of days between 1 and 3650');
  // SECURITY: the ROI rate is a server-side business rule. Never trust a rate sent by the client.
  const dailyRoiPercent = Number(process.env.DEFAULT_DAILY_ROI_PERCENT ?? 0.5);

  const session = await mongoose.startSession();
  let investment;
  try {
    await session.withTransaction(async () => {
      investment = undefined;
      const investor = await User.findById(req.user._id).session(session);
      if (!investor || investor.status !== 'Active') throw new AppError('User account is unavailable', 403);
      // Atomic funds check + debit in ONE statement: two parallel requests can never spend the same money twice.
      const debited = await User.updateOne({ _id: investor._id, walletPaise: { $gte: amountPaise } }, { $inc: { walletPaise: -amountPaise } }, { session });
      if (debited.modifiedCount !== 1) throw new AppError('Insufficient wallet balance. Request a deposit first.', 400);
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + durationDays * 86400000);
      [investment] = await Investment.create([{ user: investor._id, amountPaise, planName, startDate, endDate, dailyRoiPercent, status: 'Active' }], { session });
      await distributeReferralIncome({ investor, investment, session });
    });
  } finally { await session.endSession(); }
  res.status(201).json({ investment, message: 'Investment created. Demo ROI and referral assumptions apply.' });
});

exports.listInvestments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { user: req.user._id };
  if (req.query.status !== undefined) {
    if (!Investment.schema.path('status').enumValues.includes(req.query.status)) throw new AppError('Unknown status filter');
    filter.status = req.query.status;
  }
  if (req.query.q !== undefined) {
    if (typeof req.query.q !== 'string' || req.query.q.length > 50) throw new AppError('q must be text of at most 50 characters');
    if (req.query.q.trim()) filter.planName = { $regex: escapeRegex(req.query.q.trim()), $options: 'i' };
  }
  const [rows, total] = await Promise.all([
    Investment.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Investment.countDocuments(filter)
  ]);
  res.json({ investments: rows.map((r) => presentMoney(r, { amountPaise: 'amount' })), ...pageMeta(page, limit, total) });
});
