// All money is stored as INTEGER PAISE (1 INR = 100 paise). Integers add/subtract exactly, so wallets can
// never drift (0.1 + 0.2 !== 0.3 in floating point). The HTTP API still speaks rupees; conversion happens
// only at the edges (request in -> toPaise, response out -> fromPaise).
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const fromPaise = (paise) => Number(paise) / 100;
// percentage of an integer paise amount, rounded to the nearest paise
const percentOf = (paise, percent) => Math.round((paise * percent) / 100);

const intPaise = (extra = {}) => ({
  type: Number, min: 0, default: 0,
  validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paise' },
  ...extra
});

// Renames *Paise fields to their rupee names on a plain object (used by toJSON and by lean() results).
function presentMoney(obj, map) {
  if (!obj) return obj;
  const out = typeof obj.toObject === 'function' ? obj.toObject() : { ...obj };
  for (const [paiseKey, rupeeKey] of Object.entries(map)) {
    if (paiseKey in out) { out[rupeeKey] = fromPaise(out[paiseKey]); delete out[paiseKey]; }
  }
  delete out.__v;
  return out;
}
const jsonMoney = (map, drop = []) => ({ transform: (_doc, ret) => { for (const d of drop) delete ret[d]; return presentMoney(ret, map); } });

module.exports = { toPaise, fromPaise, percentOf, intPaise, presentMoney, jsonMoney };
