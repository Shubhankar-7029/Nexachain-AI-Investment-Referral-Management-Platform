const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { pageParams, pageMeta } = require('../utils/pagination');
const Investment = require('../models/Investment');
const ROIHistory = require('../models/ROIHistory');
const ReferralIncome = require('../models/ReferralIncome');
const { processDailyRoi, utcDayBounds } = require('../services/roiService');
const { fromPaise, presentMoney } = require('../utils/money');

function objectId(value) {
  if (!mongoose.isValidObjectId(value) || String(new mongoose.Types.ObjectId(value)) !== String(value)) throw new AppError('Invalid id');
  return value;
}

exports.listDeposits = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const status = req.query.status === undefined ? 'Pending' : req.query.status;
  if (status !== 'All' && !Deposit.schema.path('status').enumValues.includes(status)) throw new AppError('Unknown status filter');
  const filter = status === 'All' ? {} : { status };
  const [rows, total] = await Promise.all([
    Deposit.find(filter).sort({ createdAt: 1, _id: 1 }).skip(skip).limit(limit).populate('user', 'fullName email'),
    Deposit.countDocuments(filter)
  ]);
  res.json({ deposits: rows, ...pageMeta(page, limit, total) });
});

async function review(req, res, decision) {
  const id = objectId(req.params.id);
  const existing = await Deposit.findById(id);
  if (!existing) throw new AppError('Deposit not found', 404);
  // Separation of duties: nobody approves their own money.
  if (String(existing.user) === String(req.user._id)) throw new AppError('You cannot review your own deposit', 403);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';

  const session = await mongoose.startSession();
  let deposit;
  try {
    await session.withTransaction(async () => {
      deposit = null;
      // Conditional update: only a still-Pending deposit can be decided, exactly once, even with two admins clicking at once.
      deposit = await Deposit.findOneAndUpdate({ _id: id, status: 'Pending' }, { status: decision, reviewedBy: req.user._id, reviewedAt: new Date(), note }, { new: true, session });
      if (!deposit) throw new AppError('Deposit was already reviewed', 409);
      if (decision === 'Approved') {
        const credited = await User.updateOne({ _id: deposit.user, status: 'Active' }, { $inc: { walletPaise: deposit.amountPaise } }, { session });
        if (credited.modifiedCount !== 1) throw new AppError('Depositor account is not active', 409);
      }
    });
  } finally { await session.endSession(); }
  res.json({ deposit });
}
exports.approveDeposit = asyncHandler((req, res) => review(req, res, 'Approved'));
exports.rejectDeposit = asyncHandler((req, res) => review(req, res, 'Rejected'));

// Manual trigger of the daily ROI job. Safe to expose to admins in any environment: it is idempotent per day.
exports.runRoi = asyncHandler(async (_req, res) => res.json(await processDailyRoi(new Date())));

// ---------------------------------------------------------------------------------------------
// Admin dashboard data
// ---------------------------------------------------------------------------------------------
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const total = async (Model, match, field = '$amountPaise') => (await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: field } } }]))[0]?.total || 0;
const searchFilter = (query, fields) => {
  if (query.q === undefined) return null;
  if (typeof query.q !== 'string' || query.q.length > 50) throw new AppError('q must be text of at most 50 characters');
  const q = query.q.trim();
  return q ? { $or: fields.map((f) => ({ [f]: { $regex: escapeRegex(q), $options: 'i' } })) } : null;
};
const enumFilter = (Model, query, key = 'status') => {
  if (query[key] === undefined || query[key] === '' || query[key] === 'All') return null;
  if (!Model.schema.path(key).enumValues.includes(query[key])) throw new AppError(`Unknown ${key} filter`);
  return query[key];
};

// Headline numbers for the Overview page. Everything is computed in the database.
exports.getStats = asyncHandler(async (_req, res) => {
  const { start: today } = utcDayBounds();
  const [users, admins, suspended, newToday, depStatus, invStatus, invested, activeInvested, roiPaid, roiToday, referralPaid, wallets, roiLastDay] = await Promise.all([
    User.countDocuments({ role: 'user' }), User.countDocuments({ role: 'admin' }), User.countDocuments({ status: { $ne: 'Active' } }),
    User.countDocuments({ role: 'user', createdAt: { $gte: today } }),
    Deposit.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    Investment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    total(Investment, {}), total(Investment, { status: 'Active' }),
    total(ROIHistory, { status: 'Processed' }), total(ROIHistory, { status: 'Processed', date: { $gte: today } }),
    total(ReferralIncome, {}), total(User, {}, '$walletPaise'),
    ROIHistory.findOne({ status: 'Processed' }).sort({ date: -1 }).select('date').lean()
  ]);
  const by = (rows, key) => rows.find((r) => r._id === key) || { count: 0, total: 0 };
  res.json({ stats: {
    members: users, admins, inactiveAccounts: suspended, newMembersToday: newToday,
    deposits: {
      pendingCount: by(depStatus, 'Pending').count, pendingAmount: fromPaise(by(depStatus, 'Pending').total),
      approvedCount: by(depStatus, 'Approved').count, approvedAmount: fromPaise(by(depStatus, 'Approved').total),
      rejectedCount: by(depStatus, 'Rejected').count
    },
    investments: {
      activeCount: by(invStatus, 'Active').count, activeAmount: fromPaise(activeInvested),
      completedCount: by(invStatus, 'Completed').count, totalCount: invStatus.reduce((n, r) => n + r.count, 0), totalAmount: fromPaise(invested)
    },
    roiPaidTotal: fromPaise(roiPaid), roiPaidToday: fromPaise(roiToday), referralPaidTotal: fromPaise(referralPaid),
    walletLiability: fromPaise(wallets), // what the platform owes members right now
    lastRoiDate: roiLastDay?.date || null
  } });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  const search = searchFilter(req.query, ['fullName', 'email']); if (search) Object.assign(filter, search);
  const status = enumFilter(User, req.query); if (status) filter.status = status;
  const role = enumFilter(User, req.query, 'role'); if (role) filter.role = role;
  const [rows, count] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('referredBy', 'fullName email'),
    User.countDocuments(filter)
  ]);
  const ids = rows.map((u) => u._id);
  const [inv, refs] = await Promise.all([
    Investment.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } }]),
    User.aggregate([{ $match: { referredBy: { $in: ids } } }, { $group: { _id: '$referredBy', count: { $sum: 1 } } }])
  ]);
  const invBy = new Map(inv.map((r) => [String(r._id), r])); const refBy = new Map(refs.map((r) => [String(r._id), r.count]));
  res.json({ users: rows.map((u) => ({ ...u.toJSON(), investmentCount: invBy.get(String(u._id))?.count || 0, investedAmount: fromPaise(invBy.get(String(u._id))?.total || 0), directReferrals: refBy.get(String(u._id)) || 0 })), ...pageMeta(page, limit, count) });
});

exports.setUserStatus = asyncHandler(async (req, res) => {
  const id = objectId(req.params.id);
  const status = req.body?.status;
  if (!['Active', 'Suspended'].includes(status)) throw new AppError('status must be Active or Suspended');
  if (String(id) === String(req.user._id)) throw new AppError('You cannot change your own account status', 403);
  const target = await User.findById(id);
  if (!target) throw new AppError('User not found', 404);
  if (target.role === 'admin') throw new AppError('Admin accounts cannot be suspended here; demote them first with npm run make-admin -- <email> --revoke', 403);
  if (target.status === 'Closed') throw new AppError('Closed accounts cannot be changed', 409);
  target.status = status; await target.save();
  res.json({ user: target.toJSON() });
});

exports.listInvestments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  const status = enumFilter(Investment, req.query); if (status) filter.status = status;
  const search = searchFilter(req.query, ['planName']); if (search) Object.assign(filter, search);
  const [rows, count] = await Promise.all([
    Investment.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('user', 'fullName email').lean(),
    Investment.countDocuments(filter)
  ]);
  res.json({ investments: rows.map((r) => presentMoney(r, { amountPaise: 'amount' })), ...pageMeta(page, limit, count) });
});

exports.listRoi = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const [rows, count] = await Promise.all([
    ROIHistory.find().sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('user', 'fullName email').populate('investment', 'planName').lean(),
    ROIHistory.countDocuments()
  ]);
  res.json({ roiHistory: rows.map((r) => presentMoney(r, { amountPaise: 'amount' })), ...pageMeta(page, limit, count) });
});
