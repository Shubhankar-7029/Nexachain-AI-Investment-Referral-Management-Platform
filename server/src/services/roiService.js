const mongoose = require('mongoose');
const Investment = require('../models/Investment');
const User = require('../models/User');
const ROIHistory = require('../models/ROIHistory');
const { percentOf } = require('../utils/money');

const DAY = 86400000;

function utcDayStart(date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
function utcDayBounds(date = new Date()) {
  const start = utcDayStart(date);
  return { start, end: new Date(start.getTime() + DAY) };
}

/**
 * ROI window of an investment, counted in UTC calendar days.
 * A plan of N days pays exactly N daily credits: from the start day (inclusive) to
 * start day + N - 1 (inclusive). `endExclusive` is the first day that is NOT paid.
 * (The old rule "endDate >= today" paid N+1 days because endDate lands on day N+1.)
 */
function roiWindow(investment) {
  const days = Math.max(1, Math.round((investment.endDate - investment.startDate) / DAY));
  const firstDay = utcDayStart(investment.startDate);
  return { days, firstDay, endExclusive: new Date(firstDay.getTime() + days * DAY) };
}

/**
 * Credits every unpaid ROI day up to `runDate` (normally just today; more if the scheduler was down),
 * then closes the investment once its last day is reached. Safe to run repeatedly and concurrently:
 * the unique (investment, date) index plus the transaction guarantee at most one credit per day.
 */
async function processInvestmentRoi(investmentId, runDate = new Date()) {
  const { start: today } = utcDayBounds(runDate);
  const session = await mongoose.startSession();
  try {
    let creditedPaise = 0; let days = 0; let principalReturnedPaise = 0;
    await session.withTransaction(async () => {
      creditedPaise = 0; days = 0; principalReturnedPaise = 0; // the callback can be retried by the driver; always start from zero
      const investment = await Investment.findById(investmentId).session(session);
      if (!investment || investment.status !== 'Active') return;
      const { firstDay, endExclusive } = roiWindow(investment);
      const lastDay = new Date(Math.min(today.getTime(), endExclusive.getTime() - DAY));
      const perDayPaise = percentOf(investment.amountPaise, investment.dailyRoiPercent);
      const completing = today.getTime() >= endExclusive.getTime() - DAY;

      const missing = [];
      if (lastDay >= firstDay && perDayPaise > 0) {
        const paid = new Set((await ROIHistory.find({ investment: investment._id, date: { $gte: firstDay, $lte: lastDay } }).select('date').session(session).lean()).map((r) => r.date.getTime()));
        for (let t = firstDay.getTime(); t <= lastDay.getTime(); t += DAY) if (!paid.has(t)) missing.push(new Date(t));
      }
      if (!missing.length && !completing) return;

      const user = await User.findById(investment.user).session(session);
      if (!user || user.status !== 'Active') throw new Error('Investment owner is not active');
      if (missing.length) {
        await ROIHistory.insertMany(missing.map((date) => ({ user: investment.user, investment: investment._id, amountPaise: perDayPaise, date, status: 'Processed' })), { session });
        creditedPaise = perDayPaise * missing.length; days = missing.length;
      }
      // Plan finished: close it and give the locked principal back to the wallet (it was debited when the investment was made).
      if (completing) { investment.status = 'Completed'; await investment.save({ session }); principalReturnedPaise = investment.amountPaise; }
      await User.updateOne({ _id: user._id }, { $inc: { walletPaise: creditedPaise + principalReturnedPaise, totalRoiPaise: creditedPaise } }, { session });
    });
    return { investmentId: String(investmentId), credited: creditedPaise / 100, days, principalReturned: principalReturnedPaise / 100 };
  } finally { await session.endSession(); }
}

async function processDailyRoi(runDate = new Date()) {
  const { start, end } = utcDayBounds(runDate);
  // No endDate filter on purpose: plans whose end passed while the scheduler was down must still be settled/closed.
  const ids = await Investment.find({ status: 'Active', startDate: { $lt: end } }).distinct('_id');
  const results = [];
  for (const id of ids) {
    try { results.push(await processInvestmentRoi(id, runDate)); }
    catch (error) {
      // Duplicate-key races can happen if multiple scheduler instances overlap; the unique index prevents double credit.
      if (error.code === 11000) results.push({ investmentId: String(id), credited: 0, duplicate: true });
      else { console.error(`ROI processing failed for ${id}:`, error.message); results.push({ investmentId: String(id), error: error.message }); }
    }
  }
  return { date: start.toISOString(), processed: results.length, results };
}
module.exports = { processInvestmentRoi, processDailyRoi, utcDayBounds, roiWindow };
