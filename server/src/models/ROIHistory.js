const mongoose = require('mongoose');
const { intPaise, jsonMoney } = require('../utils/money');
const roiHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  investment: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment', required: true, index: true },
  amountPaise: intPaise({ required: true }),
  date: { type: Date, required: true },
  status: { type: String, enum: ['Processed', 'Reversed'], default: 'Processed' }
}, { timestamps: true });
// One ROI record per investment per UTC calendar day prevents duplicate credits.
roiHistorySchema.index({ investment: 1, date: 1 }, { unique: true });
roiHistorySchema.index({ user: 1, date: -1 });
roiHistorySchema.set('toJSON', jsonMoney({ amountPaise: 'amount' }));
module.exports = mongoose.model('ROIHistory', roiHistorySchema);
