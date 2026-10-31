const mongoose = require('mongoose');
const { intPaise, jsonMoney } = require('../utils/money');
const investmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountPaise: intPaise({ required: true, min: 100 }),
  planName: { type: String, required: true, trim: true, maxlength: 80 },
  startDate: { type: Date, required: true, default: Date.now },
  endDate: { type: Date, required: true },
  dailyRoiPercent: { type: Number, required: true, min: 0, max: 100 },
  status: { type: String, enum: ['Active', 'Completed', 'Cancelled'], default: 'Active', index: true }
}, { timestamps: true });
investmentSchema.index({ user: 1, status: 1, createdAt: -1 });
investmentSchema.set('toJSON', jsonMoney({ amountPaise: 'amount' }));
module.exports = mongoose.model('Investment', investmentSchema);
