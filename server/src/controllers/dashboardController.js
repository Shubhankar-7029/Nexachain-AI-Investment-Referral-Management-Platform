const Investment = require('../models/Investment');
const ROIHistory = require('../models/ROIHistory');
const ReferralIncome = require('../models/ReferralIncome');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { fromPaise, presentMoney } = require('../utils/money');
const { pageParams, pageMeta } = require('../utils/pagination');
const { utcDayBounds } = require('../services/roiService');

const sum = (match, field = '$amountPaise') => [{ $match: match }, { $group: { _id: null, total: { $sum: field }, count: { $sum: 1 } } }];

exports.getDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { start: today } = utcDayBounds();
  const [investments, roi, levelIncome, roiToday] = await Promise.all([
    Investment.aggregate(sum({ user: userId, status: { $ne: 'Cancelled' } })),
    ROIHistory.aggregate(sum({ user: userId, status: 'Processed' })),
    ReferralIncome.aggregate(sum({ recipient: userId })),
    ROIHistory.aggregate(sum({ user: userId, status: 'Processed', date: { $gte: today } }))
  ]);
  res.json({ dashboard: {
    totalInvestments: fromPaise(investments[0]?.total || 0),
    investmentCount: investments[0]?.count || 0,
    totalRoiEarned: fromPaise(roi[0]?.total || 0),
    totalLevelIncomeEarned: fromPaise(levelIncome[0]?.total || 0),
    walletBalance: fromPaise(req.user.walletPaise),
    dailyRoi: fromPaise(roiToday[0]?.total || 0)
  } });
});

// Latest rows of each ledger (for the overview tables). Use the paginated endpoints below to browse everything.
exports.getHistories = asyncHandler(async (req, res) => {
  const { limit } = pageParams(req.query, { defLimit: 10 });
  const [investments, roiHistory, referralIncome, counts] = await Promise.all([
    Investment.find({ user: req.user._id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
    ROIHistory.find({ user: req.user._id }).sort({ date: -1, _id: -1 }).limit(limit).populate('investment', 'planName amountPaise').lean(),
    ReferralIncome.find({ recipient: req.user._id }).sort({ date: -1, _id: -1 }).limit(limit).populate('generatedBy', 'fullName email').lean(),
    Promise.all([Investment.countDocuments({ user: req.user._id }), ROIHistory.countDocuments({ user: req.user._id }), ReferralIncome.countDocuments({ recipient: req.user._id })])
  ]);
  res.json({
    investments: investments.map((r) => presentMoney(r, { amountPaise: 'amount' })),
    roiHistory: roiHistory.map((r) => ({ ...presentMoney(r, { amountPaise: 'amount' }), investment: r.investment && presentMoney(r.investment, { amountPaise: 'amount' }) })),
    referralIncome: referralIncome.map((r) => presentMoney(r, { amountPaise: 'amount' })),
    totals: { investments: counts[0], roiHistory: counts[1], referralIncome: counts[2] }
  });
});

exports.listRoi = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { user: req.user._id };
  const [rows, total] = await Promise.all([
    ROIHistory.find(filter).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('investment', 'planName amountPaise').lean(),
    ROIHistory.countDocuments(filter)
  ]);
  res.json({ roiHistory: rows.map((r) => ({ ...presentMoney(r, { amountPaise: 'amount' }), investment: r.investment && presentMoney(r.investment, { amountPaise: 'amount' }) })), ...pageMeta(page, limit, total) });
});

exports.listReferralIncome = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { recipient: req.user._id };
  const [rows, total] = await Promise.all([
    ReferralIncome.find(filter).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).populate('generatedBy', 'fullName email').lean(),
    ReferralIncome.countDocuments(filter)
  ]);
  res.json({ referralIncome: rows.map((r) => presentMoney(r, { amountPaise: 'amount' })), ...pageMeta(page, limit, total) });
});

// Chart data aggregated IN THE DATABASE over the whole window (not just the latest 100 rows), zero-filled per UTC day,
// oldest -> newest.
exports.getChart = asyncHandler(async (req, res) => {
  const days = req.query.days === undefined ? 14 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new AppError('days must be a whole number between 1 and 90');
  const { start: today } = utcDayBounds();
  const from = new Date(today.getTime() - (days - 1) * 86400000);
  const group = (dateField) => [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: dateField, timezone: 'UTC' } }, total: { $sum: '$amountPaise' } } }];
  const [roi, level] = await Promise.all([
    ROIHistory.aggregate([{ $match: { user: req.user._id, status: 'Processed', date: { $gte: from } } }, ...group('$date')]),
    ReferralIncome.aggregate([{ $match: { recipient: req.user._id, date: { $gte: from } } }, ...group('$date')])
  ]);
  const roiBy = new Map(roi.map((r) => [r._id, r.total])); const levelBy = new Map(level.map((r) => [r._id, r.total]));
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const key = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    rows.push({ date: key, roi: fromPaise(roiBy.get(key) || 0), level: fromPaise(levelBy.get(key) || 0) });
  }
  res.json({ chart: rows });
});
