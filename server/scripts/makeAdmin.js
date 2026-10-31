// Usage: npm run make-admin -- someone@example.com        (promote)
//        npm run make-admin -- someone@example.com --revoke
// There is intentionally NO public API to become admin.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

(async () => {
  const email = (process.argv[2] || '').toLowerCase().trim();
  const revoke = process.argv.includes('--revoke');
  if (!email) { console.error('Usage: npm run make-admin -- <email> [--revoke]'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is missing (server/.env)'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const res = await User.updateOne({ email }, { role: revoke ? 'user' : 'admin' });
  console.log(res.matchedCount ? `${email} is now ${revoke ? 'a regular user' : 'an admin'}` : `No user found with email ${email}`);
  await mongoose.disconnect();
  process.exit(res.matchedCount ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
