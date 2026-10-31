const mongoose = require('mongoose');
const { intPaise, jsonMoney } = require('../utils/money');
const referralIncomeSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  investment: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment', required: true },
  level: { type: Number, required: true, min: 1 },
  amountPaise: intPaise({ required: true }),
  date: { type: Date, required: true, default: Date.now }
}, { timestamps: true });
referralIncomeSchema.index({ recipient: 1, date: -1 });
referralIncomeSchema.index({ generatedBy: 1, investment: 1, recipient: 1, level: 1 }, { unique: true });
referralIncomeSchema.set('toJSON', jsonMoney({ amountPaise: 'amount' }));
module.exports = mongoose.model('ReferralIncome', referralIncomeSchema);
