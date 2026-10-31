const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { intPaise, jsonMoney } = require('../utils/money');

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  mobileNumber: { type: String, required: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  referralCode: { type: String, unique: true, index: true, default: () => crypto.randomBytes(5).toString('hex').toUpperCase() },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  walletPaise: intPaise(),
  totalRoiPaise: intPaise(),
  totalLevelIncomePaise: intPaise(),
  status: { type: String, enum: ['Active', 'Suspended', 'Closed'], default: 'Active', index: true }
}, { timestamps: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});
userSchema.methods.comparePassword = function (candidate) { return bcrypt.compare(candidate, this.password); };
userSchema.set('toJSON', jsonMoney({ walletPaise: 'walletBalance', totalRoiPaise: 'totalRoiEarned', totalLevelIncomePaise: 'totalLevelIncomeEarned' }, ['password']));
module.exports = mongoose.model('User', userSchema);
