const Deposit = require('../models/Deposit');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validators');
const { toPaise } = require('../utils/money');
const { pageParams, pageMeta } = require('../utils/pagination');

const MAX_PENDING_PER_USER = 5;

exports.createDeposit = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const amount = v.num(body.amount);
  const maxAmount = Number(process.env.MAX_INVESTMENT_AMOUNT || 1000000);
  if (!Number.isFinite(amount) || amount < 1 || amount > maxAmount) throw new AppError(`Amount must be between 1 and ${maxAmount}`);
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new AppError('Amount can have at most 2 decimal places');
  const reference = v.str(body.reference, 'Payment reference', { max: 100 });
  if (await Deposit.countDocuments({ user: req.user._id, status: 'Pending' }) >= MAX_PENDING_PER_USER) {
    throw new AppError(`You already have ${MAX_PENDING_PER_USER} pending deposit requests; wait for review`, 429);
  }
  const deposit = await Deposit.create({ user: req.user._id, amountPaise: toPaise(amount), reference });
  res.status(201).json({ deposit, message: 'Deposit request submitted. Your wallet is credited after an admin approves it.' });
});

exports.listDeposits = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { user: req.user._id };
  const [rows, total] = await Promise.all([
    Deposit.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Deposit.countDocuments(filter)
  ]);
  res.json({ deposits: rows, ...pageMeta(page, limit, total) });
});
