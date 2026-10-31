const AppError = require('./AppError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOBILE_RE = /^\+?[0-9]{7,15}$/;

// Body fields must be plain strings; objects/arrays (e.g. {"$gt": ""}) are rejected outright.
function str(value, label, { max = 200 } = {}) {
  if (typeof value !== 'string') throw new AppError(`${label} is required`);
  const v = value.trim();
  if (!v) throw new AppError(`${label} is required`);
  if (v.length > max) throw new AppError(`${label} must be at most ${max} characters`);
  return v;
}
function email(value) {
  const v = str(value, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new AppError('Enter a valid email address');
  return v;
}
function mobile(value) {
  const v = str(value, 'Mobile number', { max: 20 }).replace(/[\s-]/g, '');
  if (!MOBILE_RE.test(v)) throw new AppError('Enter a valid mobile number (7-15 digits, optional leading +)');
  return v;
}
// Strict numeric parser: accepts numbers or numeric strings, never "", null, booleans or arrays.
function num(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}
module.exports = { str, email, mobile, num };
