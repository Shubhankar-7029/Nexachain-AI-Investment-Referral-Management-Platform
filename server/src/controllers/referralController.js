const User = require('../models/User');
const ReferralIncome = require('../models/ReferralIncome');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

exports.getDirectReferrals = asyncHandler(async (req, res) => {
  const referrals = await User.find({ referredBy: req.user._id }).select('fullName email referralCode status createdAt').sort({ createdAt: -1 }).lean();
  res.json({ referrals });
});
exports.getReferralTree = asyncHandler(async (req, res) => {
  // Breadth-first traversal; one query per depth, with a hard cap to avoid unbounded response sizes.
  const requested = req.query.depth === undefined ? 5 : Number(req.query.depth);
  if (!Number.isInteger(requested) || requested < 1) throw new AppError('depth must be a whole number between 1 and 10');
  const maxDepth = Math.min(requested, 10);
  const root = { _id: req.user._id, fullName: req.user.fullName, email: req.user.email, referralCode: req.user.referralCode, children: [] };
  let frontier = [{ node: root, id: req.user._id, depth: 0 }];
  let visited = new Set([String(req.user._id)]);
  while (frontier.length) {
    const current = frontier.filter((item) => item.depth < maxDepth);
    if (!current.length) break;
    const parentIds = current.map((item) => item.id);
    const children = await User.find({ referredBy: { $in: parentIds } }).select('fullName email referralCode status referredBy createdAt').lean();
    const next = [];
    const parentById = new Map(current.map((item) => [String(item.id), item.node]));
    for (const child of children) {
      const key = String(child._id);
      if (visited.has(key)) continue;
      visited.add(key);
      const node = { _id: child._id, fullName: child.fullName, email: child.email, referralCode: child.referralCode, status: child.status, children: [] };
      parentById.get(String(child.referredBy))?.children.push(node);
      next.push({ node, id: child._id, depth: current[0].depth + 1 });
    }
    frontier = next;
  }
  const income = await ReferralIncome.aggregate([{ $match: { recipient: req.user._id } }, { $group: { _id: '$level', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  res.json({ tree: root, incomeByLevel: income });
});
