// One-time migration for databases created BEFORE money was stored as integer paise.
//   npm run migrate:paise
// Idempotent: documents that already have the paise fields are skipped. Back up your database first.
// NOTE: legacy wallets keep their old balance, and legacy Active investments are NOT debited retroactively.
require('dotenv').config();
const mongoose = require('mongoose');

const rupeesToPaise = (field) => ({ $round: [{ $multiply: [`$${field}`, 100] }, 0] });
const PLAN = [
  ['users', { walletBalance: 'walletPaise', totalRoiEarned: 'totalRoiPaise', totalLevelIncomeEarned: 'totalLevelIncomePaise' }],
  ['investments', { amount: 'amountPaise' }],
  ['roihistories', { amount: 'amountPaise' }],
  ['referralincomes', { amount: 'amountPaise' }]
];

async function migrate(db = mongoose.connection.db) {
  const summary = {};
  for (const [collection, fields] of PLAN) {
    const oldKeys = Object.keys(fields);
    const filter = { $or: oldKeys.map((k) => ({ [k]: { $exists: true } })) };
    const set = Object.fromEntries(Object.entries(fields).map(([oldK, newK]) => [newK, { $cond: [{ $ifNull: [`$${newK}`, false] }, `$${newK}`, rupeesToPaise(oldK)] }]));
    const res = await db.collection(collection).updateMany(filter, [{ $set: set }, { $unset: oldKeys }]);
    summary[collection] = res.modifiedCount;
  }
  if (process.env.MIGRATE_ROLE !== 'skip') {
    summary.usersWithoutRole = (await db.collection('users').updateMany({ role: { $exists: false } }, { $set: { role: 'user' } })).modifiedCount;
  }
  return summary;
}
module.exports = { migrate };

if (require.main === module) {
  (async () => {
    if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is missing (server/.env)'); process.exit(1); }
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Migrated documents:', await migrate());
    await mongoose.disconnect();
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
