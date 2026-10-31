const ReferralIncome = require('../models/ReferralIncome');
const User = require('../models/User');
const { percentOf } = require('../utils/money');

// Parsed strictly: silently dropping a bad entry (e.g. "5,abc,1") would shift every later level's rate.
function getLevelRates() {
  const raw = process.env.REFERRAL_LEVEL_RATES || '5,2,1';
  const rates = raw.split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  if (!rates.length || rates.some((n) => !Number.isFinite(n) || n < 0 || n > 100)) {
    throw new Error(`REFERRAL_LEVEL_RATES must be comma-separated percentages between 0 and 100 (got "${raw}")`);
  }
  return rates;
}

// Assessment assumption: referral income is calculated once from the new investment principal.
// The PDF does not specify rates or the qualifying event; confirm these rules before production.
async function distributeReferralIncome({ investor, investment, session }) {
  const rates = getLevelRates();
  let parentId = investor.referredBy;
  for (let i = 0; i < rates.length && parentId; i += 1) {
    const parent = await User.findById(parentId).session(session);
    if (!parent || parent.status !== 'Active') break;
    const amountPaise = percentOf(investment.amountPaise, rates[i]);
    if (amountPaise > 0) {
      await ReferralIncome.create([{ recipient: parent._id, generatedBy: investor._id, investment: investment._id, level: i + 1, amountPaise, date: new Date() }], { session });
      // $inc on integer paise is atomic and exact: no read-modify-write race, no float drift.
      await User.updateOne({ _id: parent._id }, { $inc: { walletPaise: amountPaise, totalLevelIncomePaise: amountPaise } }, { session });
    }
    parentId = parent.referredBy;
  }
}
module.exports = { distributeReferralIncome, getLevelRates };
