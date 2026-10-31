const mongoose = require('mongoose');
const { intPaise, jsonMoney } = require('../utils/money');
// A deposit REQUEST. Money only reaches the wallet when an admin (not the requester) approves it.
const depositSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amountPaise: intPaise({ required: true, min: 100 }),
  reference: { type: String, required: true, trim: true, maxlength: 100 }, // e.g. bank/UTR reference the admin checks
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  note: { type: String, trim: true, maxlength: 200, default: '' }
}, { timestamps: true });
depositSchema.index({ user: 1, createdAt: -1 });
depositSchema.index({ status: 1, createdAt: 1 });
depositSchema.set('toJSON', jsonMoney({ amountPaise: 'amount' }));
module.exports = mongoose.model('Deposit', depositSchema);
