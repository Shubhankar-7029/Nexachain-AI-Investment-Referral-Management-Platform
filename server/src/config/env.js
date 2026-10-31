// Fail fast on bad configuration instead of failing on the first user request.
const { getLevelRates } = require('../services/referralService');

const PLACEHOLDERS = ['replace_with', 'changeme', 'secret', 'your_'];
function validateEnv() {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters (generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))")');
  if (process.env.NODE_ENV === 'production' && PLACEHOLDERS.some((p) => secret.toLowerCase().includes(p))) throw new Error('JWT_SECRET still looks like a placeholder; set a random value');
  const roi = Number(process.env.DEFAULT_DAILY_ROI_PERCENT ?? 0.5);
  if (!Number.isFinite(roi) || roi < 0 || roi > 100) throw new Error('DEFAULT_DAILY_ROI_PERCENT must be between 0 and 100');
  const ss = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(ss)) throw new Error('COOKIE_SAMESITE must be lax, strict or none');
  getLevelRates(); // throws on malformed REFERRAL_LEVEL_RATES
}
module.exports = { validateEnv };
