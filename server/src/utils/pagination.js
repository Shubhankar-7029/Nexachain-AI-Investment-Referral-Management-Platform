const AppError = require('./AppError');
function pageParams(query, { defLimit = 10, maxLimit = 100 } = {}) {
  const read = (v, def) => (v === undefined ? def : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));
  const page = read(query.page, 1);
  const limit = read(query.limit, defLimit);
  if (!Number.isInteger(page) || page < 1) throw new AppError('page must be a positive whole number');
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) throw new AppError(`limit must be a whole number between 1 and ${maxLimit}`);
  return { page, limit, skip: (page - 1) * limit };
}
const pageMeta = (page, limit, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
module.exports = { pageParams, pageMeta };
