/**
 * Integration tests. They need a MongoDB REPLICA SET (transactions) and use a
 * dedicated database. They NEVER read MONGODB_URI, so they can't touch your real data.
 *
 *   MONGODB_TEST_URI="mongodb://127.0.0.1:27017/nexachain_test?replicaSet=rs0" npm test
 *
 * The database name must end in "_test" because the suite drops it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const uri = process.env.MONGODB_TEST_URI;
if (!uri) {
  test('integration tests skipped', { skip: 'Set MONGODB_TEST_URI (replica set, db name ending in _test) to run' }, () => {});
  return;
}
if (!/\/[^/?]*_test(\?|$)/.test(uri)) throw new Error('MONGODB_TEST_URI database name must end with _test');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_test_secret_test_secret_123456';
process.env.REFERRAL_LEVEL_RATES = '5,2,1';
process.env.DEFAULT_DAILY_ROI_PERCENT = '0.5';
process.env.MAX_INVESTMENT_AMOUNT = '1000000';
process.env.CLIENT_URL = 'http://localhost:5173';

const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Investment = require('../src/models/Investment');
const ROIHistory = require('../src/models/ROIHistory');
const ReferralIncome = require('../src/models/ReferralIncome');
const Deposit = require('../src/models/Deposit');
const { processDailyRoi } = require('../src/services/roiService');
const { migrate } = require('../scripts/migrateToPaise');

let server, base;
const DAY = 86400000;
let seq = 0;
const funded = new Map(); // userId -> paise credited directly by the test helper (for the wallet invariant)

async function call(method, path, { token, body, raw, cookie, csrf, origin } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(origin ? { origin } : {})
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json, headers: res.headers, setCookie: res.headers.getSetCookie() };
}
const sessionCookie = (r) => (r.setCookie.find((c) => c.startsWith('nexa_session=')) || '').split(';')[0];

async function signup(extra = {}, { funds = 0 } = {}) {
  seq += 1;
  const r = await call('POST', '/api/auth/register', { body: { fullName: `User ${seq}`, email: `user${seq}@example.com`, mobileNumber: '9000000000', password: 'Passw0rd!x', ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (funds) { await User.updateOne({ _id: r.body.user._id }, { $inc: { walletPaise: Math.round(funds * 100) } }); funded.set(r.body.user._id, Math.round(funds * 100)); }
  return { token: r.body.token, csrf: r.body.csrfToken, cookie: sessionCookie(r), user: r.body.user, res: r };
}
async function makeAdmin() {
  const a = await signup();
  await User.updateOne({ _id: a.user._id }, { role: 'admin' });
  return a;
}
const invest = (token, body = {}) => call('POST', '/api/investments', { token, body: { amount: 1000, planName: 'Starter Plan', durationDays: 30, ...body } });
const wallet = async (u) => (await User.findById(u.user._id)).walletPaise;

test.before(async () => {
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all([User, Investment, ROIHistory, ReferralIncome, Deposit].map((m) => m.syncIndexes()));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test.describe('auth', () => {
  test('register returns token and never leaks the password hash', async () => {
    const { token, user, csrf } = await signup();
    assert.ok(token); assert.ok(csrf);
    assert.equal(user.password, undefined);
    assert.equal(user.walletBalance, 0);
    assert.equal(user.role, 'user');
    assert.equal(user.walletPaise, undefined, 'internal paise fields must not leak');
  });
  test('duplicate email (any letter case) -> 409', async () => {
    const { user } = await signup();
    const r = await call('POST', '/api/auth/register', { body: { fullName: 'X', email: user.email.toUpperCase(), mobileNumber: '9000000000', password: 'Passw0rd!x' } });
    assert.equal(r.status, 409);
  });
  test('missing fields / short password -> 400', async () => {
    assert.equal((await call('POST', '/api/auth/register', { body: { email: 'a@b.co' } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { fullName: 'A', email: 'short@example.com', mobileNumber: '9000000000', password: '123' } })).status, 400);
  });
  test('invalid email format is rejected', async () => {
    const r = await call('POST', '/api/auth/register', { body: { fullName: 'A', email: 'not-an-email', mobileNumber: '9000000000', password: 'Passw0rd!x' } });
    assert.equal(r.status, 400);
  });
  test('invalid mobile number is rejected', async () => {
    const r = await call('POST', '/api/auth/register', { body: { fullName: 'A', email: 'm1@example.com', mobileNumber: 'abc', password: 'Passw0rd!x' } });
    assert.equal(r.status, 400);
  });
  test('unknown referral code -> 400', async () => {
    const r = await call('POST', '/api/auth/register', { body: { fullName: 'A', email: 'r1@example.com', mobileNumber: '9000000000', password: 'Passw0rd!x', referralCode: 'NOPE' } });
    assert.equal(r.status, 400);
  });
  test('users cannot register themselves as admin', async () => {
    const a = await signup({ role: 'admin', walletPaise: 99999999 });
    const u = await User.findById(a.user._id);
    assert.equal(u.role, 'user'); assert.equal(u.walletPaise, 0);
  });
  test('NoSQL-injection style payloads do not log anyone in', async () => {
    await signup();
    const r = await call('POST', '/api/auth/login', { body: { email: { $gt: '' }, password: { $gt: '' } } });
    assert.ok([400, 401].includes(r.status));
  });
  test('login ok, wrong password 401, unknown email 401', async () => {
    const { user } = await signup();
    assert.equal((await call('POST', '/api/auth/login', { body: { email: user.email, password: 'Passw0rd!x' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: user.email, password: 'wrong-pass' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: 'Passw0rd!x' } })).status, 401);
  });
  test('malformed JSON -> 400 (not 500)', async () => {
    const r = await call('POST', '/api/auth/login', { raw: '{"email": ' });
    assert.equal(r.status, 400);
  });
  test('protected routes need a valid token', async () => {
    for (const p of ['/api/auth/me', '/api/dashboard', '/api/investments', '/api/referrals/tree', '/api/deposits', '/api/dashboard/chart']) {
      assert.equal((await call('GET', p)).status, 401, p);
      assert.equal((await call('GET', p, { token: 'garbage' })).status, 401, p);
    }
  });
  test('suspended user cannot use an existing token', async () => {
    const { token, user } = await signup();
    await User.updateOne({ _id: user._id }, { status: 'Suspended' });
    assert.equal((await call('GET', '/api/auth/me', { token })).status, 401);
  });
  test('token signed with another algorithm / secret is rejected', async () => {
    const jwt = require('jsonwebtoken');
    const { user } = await signup();
    assert.equal((await call('GET', '/api/auth/me', { token: jwt.sign({ sub: user._id }, 'a-different-secret-a-different-secret-1') })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: jwt.sign({ sub: user._id }, 'x', { algorithm: 'none' }) })).status, 401);
  });
});

test.describe('cookie session + CSRF', () => {
  test('login sets an httpOnly, SameSite cookie and returns a CSRF token', async () => {
    const { user } = await signup();
    const r = await call('POST', '/api/auth/login', { body: { email: user.email, password: 'Passw0rd!x' } });
    const raw = r.setCookie.find((c) => c.startsWith('nexa_session='));
    assert.ok(raw, 'session cookie missing');
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=Lax/i);
    assert.ok(r.body.csrfToken);
  });
  test('cookie alone authenticates reads; /me hands back the CSRF token', async () => {
    const a = await signup();
    const r = await call('GET', '/api/auth/me', { cookie: a.cookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.csrfToken, a.csrf);
  });
  test('cookie-authenticated WRITES without a valid CSRF token are refused', async () => {
    const a = await signup({}, { funds: 5000 });
    const body = { amount: 100, planName: 'X', durationDays: 5 };
    assert.equal((await call('POST', '/api/investments', { cookie: a.cookie, body })).status, 403);
    assert.equal((await call('POST', '/api/investments', { cookie: a.cookie, csrf: 'f'.repeat(64), body })).status, 403);
    assert.equal(await Investment.countDocuments({ user: a.user._id }), 0, 'a refused request must not create anything');
    assert.equal((await call('POST', '/api/investments', { cookie: a.cookie, csrf: a.csrf, body })).status, 201);
  });
  test("another session's CSRF token does not work", async () => {
    const a = await signup({}, { funds: 5000 }); const b = await signup();
    assert.equal((await call('POST', '/api/investments', { cookie: a.cookie, csrf: b.csrf, body: { amount: 100 } })).status, 403);
  });
  test('Bearer-token API clients need no CSRF token', async () => {
    const a = await signup({}, { funds: 5000 });
    assert.equal((await invest(a.token, { amount: 100 })).status, 201);
  });
  test('tampered cookie -> 401', async () => {
    assert.equal((await call('GET', '/api/auth/me', { cookie: 'nexa_session=abc.def.ghi' })).status, 401);
  });
  test('logout clears the cookie', async () => {
    const a = await signup();
    const r = await call('POST', '/api/auth/logout', { cookie: a.cookie });
    assert.equal(r.status, 200);
    const cleared = r.setCookie.find((c) => c.startsWith('nexa_session='));
    assert.ok(cleared && /Expires=Thu, 01 Jan 1970/i.test(cleared), cleared);
  });
  test('CORS: our frontend origin may send credentials, other origins may not', async () => {
    const ok = await call('GET', '/api/health', { origin: 'http://localhost:5173' });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    const evil = await call('GET', '/api/health', { origin: 'https://evil.example' });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});

test.describe('investments', () => {
  test('valid investment -> 201, debits the wallet, listed in rupees', async () => {
    const a = await signup({}, { funds: 5000 });
    const r = await invest(a.token, { amount: 2500 });
    assert.equal(r.status, 201);
    assert.equal(r.body.investment.amount, 2500);
    assert.equal(r.body.investment.amountPaise, undefined);
    assert.equal(r.body.investment.status, 'Active');
    assert.equal(await wallet(a), 250000);
    const list = await call('GET', '/api/investments', { token: a.token });
    assert.equal(list.body.investments.length, 1);
    assert.equal(list.body.investments[0].amount, 2500);
  });
  test('invalid amounts -> 400', async () => {
    const a = await signup({}, { funds: 5000 });
    for (const amount of [0, -5, 'abc', null, 1000001, Infinity, 0.5]) {
      const r = await invest(a.token, { amount });
      assert.equal(r.status, 400, `amount=${amount} gave ${r.status}`);
    }
    assert.equal(await wallet(a), 500000, 'rejected requests must not touch the wallet');
  });
  test('error message for tiny amount is human readable (not a Mongoose dump)', async () => {
    const a = await signup({}, { funds: 5000 });
    const r = await invest(a.token, { amount: 0.5 });
    assert.ok(!/validation failed/i.test(r.body.message), r.body.message);
  });
  test('amount with more than 2 decimals is rejected', async () => {
    const a = await signup({}, { funds: 5000 });
    assert.equal((await invest(a.token, { amount: 100.123 })).status, 400);
  });
  test('invalid duration -> 400', async () => {
    const a = await signup({}, { funds: 5000 });
    for (const durationDays of [0, -1, 1.5, 3651, 'x']) assert.equal((await invest(a.token, { durationDays })).status, 400, String(durationDays));
  });
  test('SECURITY: client cannot choose its own ROI percentage', async () => {
    const a = await signup({}, { funds: 5000 });
    const r = await invest(a.token, { dailyRoiPercent: 100 });
    assert.ok(r.status === 400 || r.body?.investment?.dailyRoiPercent === 0.5, `server accepted dailyRoiPercent=${r.body?.investment?.dailyRoiPercent}`);
  });
  test('users only see their own investments', async () => {
    const a = await signup({}, { funds: 5000 }); const b = await signup();
    await invest(a.token);
    assert.equal((await call('GET', '/api/investments', { token: b.token })).body.investments.length, 0);
  });
  test('FUNDING: cannot invest more than the wallet holds', async () => {
    const a = await signup({}, { funds: 500 });
    const r = await invest(a.token, { amount: 501 });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Insufficient/);
    assert.equal(await Investment.countDocuments({ user: a.user._id }), 0);
    assert.equal((await invest((await signup()).token, { amount: 1 })).status, 400, 'brand-new account has nothing to invest');
  });
  test('FUNDING: parallel requests cannot spend the same money twice', async () => {
    const a = await signup({}, { funds: 1000 });
    const rs = await Promise.all(Array.from({ length: 5 }, () => invest(a.token, { amount: 1000 })));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(await Investment.countDocuments({ user: a.user._id }), 1);
    assert.equal(await wallet(a), 0);
  });
  test('FUNDING: a failure after the debit rolls everything back', async () => {
    const parent = await signup(); const b = await signup({ referralCode: parent.user.referralCode }, { funds: 1000 });
    const original = ReferralIncome.create; const logged = console.error;
    ReferralIncome.create = async () => { throw new Error('simulated crash'); };
    console.error = () => {};
    let r;
    try { r = await invest(b.token, { amount: 1000 }); } finally { ReferralIncome.create = original; console.error = logged; }
    assert.equal(r.status, 500);
    assert.equal(await wallet(b), 100000, 'wallet must be restored');
    assert.equal(await Investment.countDocuments({ user: b.user._id }), 0);
    assert.equal(await wallet(parent), 0);
  });
});

test.describe('deposits & admin', () => {
  const deposit = (a, body = {}) => call('POST', '/api/deposits', { token: a.token, body: { amount: 5000, reference: 'UTR123456', ...body } });

  test('request does not credit; admin approval credits exactly once', async () => {
    const admin = await makeAdmin(); const a = await signup();
    const d = await deposit(a);
    assert.equal(d.status, 201); assert.equal(d.body.deposit.status, 'Pending'); assert.equal(d.body.deposit.amount, 5000);
    assert.equal(await wallet(a), 0);
    const ok = await call('POST', `/api/admin/deposits/${d.body.deposit._id}/approve`, { token: admin.token });
    assert.equal(ok.status, 200); assert.equal(ok.body.deposit.status, 'Approved');
    assert.equal(await wallet(a), 500000);
    assert.equal((await call('POST', `/api/admin/deposits/${d.body.deposit._id}/approve`, { token: admin.token })).status, 409);
    assert.equal(await wallet(a), 500000, 'second approval must not credit again');
  });
  test('two admins approving at the same instant credit once', async () => {
    const a1 = await makeAdmin(); const a2 = await makeAdmin(); const a = await signup();
    const d = (await deposit(a)).body.deposit;
    const rs = await Promise.all([a1, a2, a1, a2].map((ad) => call('POST', `/api/admin/deposits/${d._id}/approve`, { token: ad.token })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1);
    assert.equal(await wallet(a), 500000);
  });
  test('reject does not credit and cannot be reversed by approving', async () => {
    const admin = await makeAdmin(); const a = await signup();
    const d = (await deposit(a)).body.deposit;
    assert.equal((await call('POST', `/api/admin/deposits/${d._id}/reject`, { token: admin.token, body: { note: 'no payment found' } })).body.deposit.status, 'Rejected');
    assert.equal((await call('POST', `/api/admin/deposits/${d._id}/approve`, { token: admin.token })).status, 409);
    assert.equal(await wallet(a), 0);
  });
  test('an admin cannot approve their own deposit', async () => {
    const admin = await makeAdmin();
    const d = (await deposit(admin)).body.deposit;
    assert.equal((await call('POST', `/api/admin/deposits/${d._id}/approve`, { token: admin.token })).status, 403);
    assert.equal(await wallet(admin), 0);
  });
  test('regular users cannot reach admin routes', async () => {
    const a = await signup(); const d = (await deposit(a)).body.deposit;
    for (const [m, p] of [['GET', '/api/admin/deposits'], ['POST', `/api/admin/deposits/${d._id}/approve`], ['POST', `/api/admin/deposits/${d._id}/reject`], ['POST', '/api/admin/run-roi']]) {
      assert.equal((await call(m, p, { token: a.token })).status, 403, `${m} ${p}`);
      assert.equal((await call(m, p)).status, 401, `${m} ${p} anonymous`);
    }
    assert.equal(await wallet(a), 0);
  });
  test('deposit validation, id validation and pending cap', async () => {
    const admin = await makeAdmin(); const a = await signup();
    for (const body of [{ amount: 0 }, { amount: -1 }, { amount: 'x' }, { amount: 1000001 }, { amount: 10.123 }, { reference: '' }, { reference: undefined }, { reference: { $gt: '' } }]) {
      assert.equal((await deposit(a, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call('POST', '/api/admin/deposits/not-an-id/approve', { token: admin.token })).status, 400);
    assert.equal((await call('POST', `/api/admin/deposits/${new mongoose.Types.ObjectId()}/approve`, { token: admin.token })).status, 404);
    for (let i = 0; i < 5; i += 1) assert.equal((await deposit(a)).status, 201);
    assert.equal((await deposit(a)).status, 429);
  });
  test('admin list filters by status and paginates; bad filter -> 400', async () => {
    const admin = await makeAdmin(); const a = await signup();
    for (let i = 0; i < 3; i += 1) await deposit(a, { reference: `R${i}` });
    const pending = await call('GET', '/api/admin/deposits?status=Pending&limit=2', { token: admin.token });
    assert.equal(pending.status, 200); assert.equal(pending.body.deposits.length, 2); assert.ok(pending.body.total >= 3);
    assert.ok(pending.body.deposits[0].user.fullName, 'depositor is populated');
    assert.equal((await call('GET', '/api/admin/deposits?status=Bogus', { token: admin.token })).status, 400);
  });
  test('whole flow: deposit -> approve -> invest -> ROI -> plan ends -> principal returned', async () => {
    const admin = await makeAdmin(); const a = await signup();
    const d = (await deposit(a, { amount: 1000 })).body.deposit;
    await call('POST', `/api/admin/deposits/${d._id}/approve`, { token: admin.token });
    const inv = (await invest(a.token, { amount: 1000, durationDays: 3 })).body.investment;
    assert.equal(await wallet(a), 0);
    const start = new Date(inv.startDate).getTime();
    for (let i = 0; i <= 4; i += 1) await processDailyRoi(new Date(start + i * DAY));
    const u = await User.findById(a.user._id);
    assert.equal(u.walletPaise, 100000 + 3 * 500, 'principal back + 3 days x 5.00');
    assert.equal(u.totalRoiPaise, 1500);
  });
  test('admin can trigger the daily ROI job; it is idempotent', async () => {
    const admin = await makeAdmin(); const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000 })).body.investment;
    assert.equal((await call('POST', '/api/admin/run-roi', { token: admin.token })).status, 200);
    assert.equal((await call('POST', '/api/admin/run-roi', { token: admin.token })).status, 200);
    assert.equal(await ROIHistory.countDocuments({ investment: inv._id }), 1);
  });
  test('the old unauthenticated-style dev route is gone', async () => {
    const a = await signup();
    assert.equal((await call('POST', '/api/dev/run-roi', { token: a.token })).status, 404);
  });
});

test.describe('money precision', () => {
  test('1.10 + 2.20 is exactly 3.30 (floating point would give 3.3000000000000003)', async () => {
    const admin = await makeAdmin(); const a = await signup();
    for (const amount of [1.1, 2.2]) {
      const d = (await call('POST', '/api/deposits', { token: a.token, body: { amount, reference: 'p' } })).body.deposit;
      await call('POST', `/api/admin/deposits/${d._id}/approve`, { token: admin.token });
    }
    assert.equal(await wallet(a), 330);
    assert.equal((await call('GET', '/api/auth/me', { token: a.token })).body.user.walletBalance, 3.3);
  });
  test('stored money fields are always integers', async () => {
    const a = await signup({}, { funds: 1234.56 });
    await invest(a.token, { amount: 333.33 });
    await processDailyRoi(new Date());
    for (const r of await ROIHistory.find().lean()) assert.ok(Number.isInteger(r.amountPaise));
    for (const u of await User.find().lean()) for (const k of ['walletPaise', 'totalRoiPaise', 'totalLevelIncomePaise']) assert.ok(Number.isInteger(u[k]), `${u.email} ${k}=${u[k]}`);
  });
  test('migration converts legacy rupee fields to paise and is idempotent', async () => {
    const db = mongoose.connection.db;
    await db.collection('users').insertOne({ fullName: 'Legacy', email: 'legacy@example.com', mobileNumber: '9000000000', password: 'x', referralCode: 'LEGACY0001', walletBalance: 12.34, totalRoiEarned: 0.1, totalLevelIncomeEarned: 1.005 });
    await db.collection('investments').insertOne({ user: new mongoose.Types.ObjectId(), amount: 250.5, planName: 'Old', startDate: new Date(), endDate: new Date(), dailyRoiPercent: 0.5, status: 'Active' });
    const first = await migrate();
    assert.ok(first.users >= 1 && first.investments >= 1);
    const u = await db.collection('users').findOne({ email: 'legacy@example.com' });
    assert.deepEqual([u.walletPaise, u.totalRoiPaise, u.walletBalance, u.role], [1234, 10, undefined, 'user']);
    assert.equal((await db.collection('investments').findOne({ planName: 'Old' })).amountPaise, 25050);
    const second = await migrate();
    assert.deepEqual([second.users, second.investments, second.roihistories, second.referralincomes], [0, 0, 0, 0]);
    // fixtures have no ledger history, so remove them (the wallet-invariant test checks every user left in the db)
    await db.collection('users').deleteOne({ email: 'legacy@example.com' });
    await db.collection('investments').deleteOne({ planName: 'Old' });
  });
});

test.describe('referral income', () => {
  test('3-level commissions (5/2/1 %) credit the right wallets and match the ledger', async () => {
    const a = await signup();
    const b = await signup({ referralCode: a.user.referralCode });
    const c = await signup({ referralCode: b.user.referralCode });
    const d = await signup({ referralCode: c.user.referralCode });
    const e = await signup({ referralCode: d.user.referralCode }, { funds: 1000 }); // level 4 for A: must earn nothing
    assert.equal((await invest(e.token, { amount: 1000 })).status, 201);
    assert.equal(await wallet(d), 5000);
    assert.equal(await wallet(c), 2000);
    assert.equal(await wallet(b), 1000);
    assert.equal(await wallet(a), 0);
    assert.equal(await ReferralIncome.countDocuments({ generatedBy: e.user._id }), 3);
  });
  test('investor does not earn from own investment', async () => {
    const a = await signup({}, { funds: 1000 });
    await invest(a.token, { amount: 1000 });
    assert.equal(await wallet(a), 0);
  });
  test('rejected investment creates no commissions', async () => {
    const a = await signup(); const b = await signup({ referralCode: a.user.referralCode }, { funds: 1000 });
    const before = await ReferralIncome.countDocuments();
    await invest(b.token, { amount: 0.5 });
    assert.equal(await ReferralIncome.countDocuments(), before);
    assert.equal(await wallet(a), 0);
  });
  test('malformed REFERRAL_LEVEL_RATES entries do not shift commission levels', () => {
    const { getLevelRates } = require('../src/services/referralService');
    const old = process.env.REFERRAL_LEVEL_RATES;
    process.env.REFERRAL_LEVEL_RATES = '5,abc,1';
    try { assert.throws(() => getLevelRates(), /REFERRAL_LEVEL_RATES/); } finally { process.env.REFERRAL_LEVEL_RATES = old; }
  });
  test('commission rounds to whole paise', async () => {
    const a = await signup(); const b = await signup({ referralCode: a.user.referralCode }, { funds: 1000 });
    await invest(b.token, { amount: 33.33 }); // 5% = 1.6665 -> 1.67
    assert.equal(await wallet(a), 167);
  });
});

test.describe('referral tree', () => {
  test('depth is respected and bad depth does not return a silently empty tree', async () => {
    const a = await signup();
    const b = await signup({ referralCode: a.user.referralCode });
    await signup({ referralCode: b.user.referralCode });
    const full = await call('GET', '/api/referrals/tree?depth=5', { token: a.token });
    assert.equal(full.body.tree.children[0].children.length, 1);
    const one = await call('GET', '/api/referrals/tree?depth=1', { token: a.token });
    assert.equal(one.body.tree.children[0].children.length, 0);
    const bad = await call('GET', '/api/referrals/tree?depth=abc', { token: a.token });
    assert.ok(bad.status === 400 || bad.body.tree.children.length === 1, 'depth=abc silently returned an empty tree');
  });
  test('direct referrals only', async () => {
    const a = await signup();
    const b = await signup({ referralCode: a.user.referralCode });
    await signup({ referralCode: b.user.referralCode });
    const r = await call('GET', '/api/referrals/direct', { token: a.token });
    assert.equal(r.body.referrals.length, 1);
  });
});

test.describe('daily ROI', () => {
  test('credits amount x percent and is idempotent for the same day', async () => {
    const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000 })).body.investment;
    const now = new Date();
    await processDailyRoi(now); await processDailyRoi(now);
    assert.equal(await ROIHistory.countDocuments({ investment: inv._id }), 1);
    const u = await User.findById(a.user._id);
    assert.equal(u.walletPaise, 500);
    assert.equal(u.totalRoiPaise, 500);
  });
  test('concurrent runs never double-credit (30-day plan settled 40 days later = exactly 30 credits)', async () => {
    const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000 })).body.investment;
    const later = new Date(Date.now() + 40 * DAY);
    await Promise.all([processDailyRoi(later), processDailyRoi(later), processDailyRoi(later)]);
    assert.equal(await ROIHistory.countDocuments({ investment: inv._id }), 30);
    const u = await User.findById(a.user._id);
    assert.equal(u.walletPaise, 100000 + 15000, 'principal returned exactly once + 30 x 5.00');
    assert.equal((await Investment.findById(inv._id)).status, 'Completed');
  });
  test('a 10-day plan pays exactly 10 days of ROI, then completes and returns principal', async () => {
    const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000, durationDays: 10 })).body.investment;
    const start = new Date(inv.startDate).getTime();
    for (let d = 0; d <= 15; d += 1) await processDailyRoi(new Date(start + d * DAY));
    const credits = await ROIHistory.countDocuments({ investment: inv._id });
    assert.equal(credits, 10, `paid ${credits} days for a 10-day plan`);
    assert.equal((await Investment.findById(inv._id)).status, 'Completed');
    assert.equal(await wallet(a), 100000 + 5000);
  });
  test('missed scheduler runs: expired Active investments are back-paid and closed', async () => {
    const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000, durationDays: 2 })).body.investment;
    await processDailyRoi(new Date(new Date(inv.startDate).getTime() + 30 * DAY));
    assert.equal((await Investment.findById(inv._id)).status, 'Completed');
    assert.equal(await ROIHistory.countDocuments({ investment: inv._id }), 2, 'missed days must be back-paid, not lost');
    assert.equal(await wallet(a), 100000 + 1000);
  });
  test('principal is returned only once even if the job keeps running', async () => {
    const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000, durationDays: 1 })).body.investment;
    const day = new Date(new Date(inv.startDate).getTime() + 5 * DAY);
    for (let i = 0; i < 3; i += 1) await processDailyRoi(day);
    assert.equal(await wallet(a), 100000 + 500);
  });
  test('wallet invariant: funded + approved deposits + ROI + referral income - principal still locked', async () => {
    for (const u of await User.find().lean()) {
      const sumOf = async (Model, match) => (await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]))[0]?.t || 0;
      const roi = await sumOf(ROIHistory, { user: u._id });
      const ref = await sumOf(ReferralIncome, { recipient: u._id });
      const deposits = await sumOf(Deposit, { user: u._id, status: 'Approved' });
      const locked = await sumOf(Investment, { user: u._id, status: 'Active' });
      const fundedByTest = funded.get(String(u._id)) || 0;
      assert.equal(u.walletPaise, fundedByTest + deposits + roi + ref - locked, u.email);
      assert.equal(u.totalRoiPaise, roi, u.email);
      assert.equal(u.totalLevelIncomePaise, ref, u.email);
    }
  });
});

test.describe('dashboard, pagination, chart', () => {
  test('aggregates match the data', async () => {
    const a = await signup({}, { funds: 1000 }); const b = await signup({ referralCode: a.user.referralCode }, { funds: 2000 });
    await invest(b.token, { amount: 2000 });
    await invest(a.token, { amount: 500 });
    await processDailyRoi(new Date());
    const d = (await call('GET', '/api/dashboard', { token: a.token })).body.dashboard;
    assert.equal(d.totalInvestments, 500);
    assert.equal(d.investmentCount, 1);
    assert.equal(d.totalLevelIncomeEarned, 100);
    assert.equal(d.totalRoiEarned, 2.5);
    assert.equal(d.walletBalance, 602.5);
    assert.equal(d.dailyRoi, 2.5);
    const h = (await call('GET', '/api/dashboard/histories', { token: a.token })).body;
    assert.equal(h.investments.length, 1);
    assert.equal(h.referralIncome.length, 1);
    assert.equal(h.referralIncome[0].amount, 100);
    assert.equal(h.roiHistory[0].amount, 2.5);
    assert.equal(h.roiHistory[0].investment.amount, 500);
    assert.deepEqual(h.totals, { investments: 1, roiHistory: 1, referralIncome: 1 });
  });
  test('investments are paginated: no gaps, no duplicates, newest first', async () => {
    const a = await signup({}, { funds: 1000 });
    for (let i = 1; i <= 12; i += 1) assert.equal((await invest(a.token, { amount: 10, planName: `Plan ${i}` })).status, 201);
    const get = (q) => call('GET', `/api/investments?${q}`, { token: a.token });
    const p1 = (await get('page=1&limit=5')).body, p2 = (await get('page=2&limit=5')).body, p3 = (await get('page=3&limit=5')).body, p4 = (await get('page=4&limit=5')).body;
    assert.deepEqual([p1.investments.length, p2.investments.length, p3.investments.length, p4.investments.length], [5, 5, 2, 0]);
    assert.deepEqual([p1.total, p1.pages, p1.page, p1.limit], [12, 3, 1, 5]);
    const names = [...p1.investments, ...p2.investments, ...p3.investments].map((i) => i.planName);
    assert.equal(new Set(names).size, 12);
    assert.equal(names[0], 'Plan 12'); assert.equal(names[11], 'Plan 1');
  });
  test('investment search and status filters work and are injection-safe', async () => {
    const a = await signup({}, { funds: 1000 });
    await invest(a.token, { amount: 10, planName: 'Gold (special) plan' }); await invest(a.token, { amount: 10, planName: 'Silver' });
    const q = async (s) => (await call('GET', `/api/investments?q=${encodeURIComponent(s)}`, { token: a.token })).body;
    assert.equal((await q('gold')).total, 1);
    assert.equal((await q('(special)')).total, 1, 'regex characters are literal');
    assert.equal((await q('.*')).total, 0, '".*" must not match everything');
    assert.equal((await call('GET', '/api/investments?status=Active', { token: a.token })).body.total, 2);
    assert.equal((await call('GET', '/api/investments?status=Completed', { token: a.token })).body.total, 0);
    assert.equal((await call('GET', '/api/investments?status=Bogus', { token: a.token })).status, 400);
    assert.equal((await call('GET', `/api/investments?q=${'x'.repeat(51)}`, { token: a.token })).status, 400);
  });
  test('bad pagination parameters -> 400', async () => {
    const a = await signup();
    for (const q of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=101', 'limit=abc', 'page=1&page=2', 'limit[]=5']) {
      assert.equal((await call('GET', `/api/investments?${q}`, { token: a.token })).status, 400, q);
    }
  });
  test('ROI, referral-income and deposit lists paginate', async () => {
    const admin = await makeAdmin(); const a = await signup({}, { funds: 1000 });
    const inv = (await invest(a.token, { amount: 1000, durationDays: 5 })).body.investment;
    const start = new Date(inv.startDate).getTime();
    for (let i = 0; i < 5; i += 1) await processDailyRoi(new Date(start + i * DAY));
    const roi = (await call('GET', '/api/dashboard/roi?limit=2&page=2', { token: a.token })).body;
    assert.equal(roi.roiHistory.length, 2); assert.equal(roi.total, 5); assert.equal(roi.pages, 3);
    assert.ok(new Date(roi.roiHistory[0].date) > new Date(roi.roiHistory[1].date), 'newest first');
    assert.equal((await call('GET', '/api/dashboard/referral-income?limit=2', { token: a.token })).body.total, 0);
    await call('POST', '/api/deposits', { token: a.token, body: { amount: 10, reference: 'a' } });
    await call('POST', '/api/deposits', { token: a.token, body: { amount: 20, reference: 'b' } });
    const dep = (await call('GET', '/api/deposits?limit=1', { token: a.token })).body;
    assert.equal(dep.deposits.length, 1); assert.equal(dep.total, 2); assert.equal(dep.deposits[0].amount, 20);
    void admin;
  });
  test('chart: whole window, zero-filled, ascending, includes referral income', async () => {
    const a = await signup(); const b = await signup({ referralCode: a.user.referralCode }, { funds: 1000 });
    const aInv = await (async () => { await User.updateOne({ _id: a.user._id }, { $inc: { walletPaise: 100000 } }); return (await invest(a.token, { amount: 1000, durationDays: 30 })).body.investment; })();
    await invest(b.token, { amount: 1000 }); // 50.00 commission to a, today
    const start = new Date(aInv.startDate).getTime();
    for (let i = 0; i < 3; i += 1) await processDailyRoi(new Date(start + i * DAY));
    const today = new Date().toISOString().slice(0, 10);
    const chart = (await call('GET', '/api/dashboard/chart?days=7', { token: a.token })).body.chart;
    assert.equal(chart.length, 7);
    assert.deepEqual(chart.map((r) => r.date), [...chart.map((r) => r.date)].sort());
    assert.equal(chart.at(-1).date, today);
    assert.equal(chart.at(-1).level, 50);
    assert.equal(chart.at(-1).roi, 5);
    assert.equal(chart[0].roi, 0, 'days without activity are zero-filled');
    for (const bad of ['0', '91', 'abc', '1.5']) assert.equal((await call('GET', `/api/dashboard/chart?days=${bad}`, { token: a.token })).status, 400, bad);
  });
});

test.describe('admin dashboard API', () => {
  const adminGet = (admin, path) => call('GET', `/api/admin${path}`, { token: admin.token });

  test('every new admin endpoint is closed to members (403) and anonymous (401)', async () => {
    const member = await signup(); const target = await signup();
    const routes = [['GET', '/api/admin/stats'], ['GET', '/api/admin/users'], ['GET', '/api/admin/investments'], ['GET', '/api/admin/roi'], ['PATCH', `/api/admin/users/${target.user._id}/status`]];
    for (const [m, p] of routes) {
      assert.equal((await call(m, p, { token: member.token, body: m === 'PATCH' ? { status: 'Suspended' } : undefined })).status, 403, `${m} ${p}`);
      assert.equal((await call(m, p)).status, 401, `${m} ${p} anonymous`);
    }
    assert.equal((await User.findById(target.user._id)).status, 'Active', 'a member must not be able to suspend anyone');
  });

  test('stats: numbers move by exactly the right amounts', async () => {
    const admin = await makeAdmin();
    await processDailyRoi(new Date());                       // settle every older plan so today's ROI delta is clean
    const before = (await adminGet(admin, '/stats')).body.stats;
    const a = await signup();
    const d = (await call('POST', '/api/deposits', { token: a.token, body: { amount: 1000, reference: 'stats' } })).body.deposit;
    const mid = (await adminGet(admin, '/stats')).body.stats;
    assert.equal(mid.deposits.pendingCount, before.deposits.pendingCount + 1);
    assert.equal(mid.deposits.pendingAmount, before.deposits.pendingAmount + 1000);
    await call('POST', `/api/admin/deposits/${d._id}/approve`, { token: admin.token });
    await invest(a.token, { amount: 400 });
    await processDailyRoi(new Date());
    const after = (await adminGet(admin, '/stats')).body.stats;
    const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} !== ${y}`);
    assert.equal(after.members, before.members + 1, 'exactly one new member (the admin was created before the snapshot)');
    assert.equal(after.admins, before.admins);
    assert.equal(after.newMembersToday, before.newMembersToday + 1, 'admins do not count as new members');
    near(after.deposits.approvedAmount, before.deposits.approvedAmount + 1000);
    assert.equal(after.deposits.pendingCount, before.deposits.pendingCount);
    assert.equal(after.investments.activeCount, before.investments.activeCount + 1);
    near(after.investments.activeAmount, before.investments.activeAmount + 400);
    near(after.roiPaidTotal, before.roiPaidTotal + 2);
    near(after.roiPaidToday, before.roiPaidToday + 2);
    near(after.walletLiability, before.walletLiability + 1000 - 400 + 2);
    assert.ok(after.lastRoiDate);
  });

  test('users: paginated, searchable, filterable, no secrets, with per-user totals', async () => {
    const admin = await makeAdmin();
    const boss = await signup({ fullName: 'Zed Findable' }, { funds: 1000 });
    const kid = await signup({ referralCode: boss.user.referralCode, fullName: 'Kid Of Zed' });
    await invest(boss.token, { amount: 100 }); await invest(boss.token, { amount: 50 });
    assert.equal((await adminGet(admin, `/users?q=${encodeURIComponent('zed find')}`)).body.total, 1, 'case-insensitive substring match');
    assert.equal((await adminGet(admin, `/users?q=${encodeURIComponent('findable zed')}`)).body.total, 0, 'words out of order do not match');
    const one = (await adminGet(admin, '/users?q=Zed%20Findable')).body;
    assert.equal(one.total, 1);
    const u = one.users[0];
    assert.equal(u.email, boss.user.email);
    assert.deepEqual([u.investmentCount, u.investedAmount, u.directReferrals], [2, 150, 1]);
    assert.equal(u.password, undefined); assert.equal(u.walletPaise, undefined); assert.equal(typeof u.walletBalance, 'number');
    assert.equal((await adminGet(admin, '/users?q=.*')).body.total, 0, 'regex characters are literal');
    const kids = (await adminGet(admin, `/users?q=${encodeURIComponent('Kid Of Zed')}`)).body.users[0];
    assert.equal(kids.referredBy.fullName, 'Zed Findable'); assert.equal(kids._id, kid.user._id);
    const p1 = (await adminGet(admin, '/users?limit=3&page=1')).body, p2 = (await adminGet(admin, '/users?limit=3&page=2')).body;
    assert.equal(p1.users.length, 3);
    assert.ok(!p1.users.some((x) => p2.users.some((y) => y._id === x._id)), 'no duplicates across pages');
    assert.ok((await adminGet(admin, '/users?role=admin')).body.users.every((x) => x.role === 'admin'));
    for (const bad of ['status=Bogus', 'role=root', 'limit=101', 'page=0', `q=${'x'.repeat(51)}`]) assert.equal((await adminGet(admin, `/users?${bad}`)).status, 400, bad);
  });

  test('suspend / reactivate: blocks login and live sessions, protects admins and self', async () => {
    const admin = await makeAdmin(); const other = await makeAdmin(); const m = await signup();
    const set = (id, status, who = admin) => call('PATCH', `/api/admin/users/${id}/status`, { token: who.token, body: { status } });
    assert.equal((await set(m.user._id, 'Suspended')).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: m.token })).status, 401, 'existing session stops working');
    assert.equal((await call('POST', '/api/auth/login', { body: { email: m.user.email, password: 'Passw0rd!x' } })).status, 403, 'cannot log in');
    assert.equal((await set(m.user._id, 'Active')).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: m.token })).status, 200, 'works again after reactivation');
    assert.equal((await set(admin.user._id, 'Suspended')).status, 403, 'cannot suspend yourself');
    assert.equal((await set(other.user._id, 'Suspended')).status, 403, 'cannot suspend another admin');
    assert.equal((await set(m.user._id, 'Closed')).status, 400);
    assert.equal((await set(m.user._id, undefined)).status, 400);
    assert.equal((await set('not-an-id', 'Suspended')).status, 400);
    assert.equal((await set(new mongoose.Types.ObjectId().toString(), 'Suspended')).status, 404);
  });

  test('investments list: all members, status + search filters, user populated, rupees', async () => {
    const admin = await makeAdmin(); const a = await signup({ fullName: 'Inv Owner' }, { funds: 1000 });
    await invest(a.token, { amount: 123.45, planName: 'Adminview Alpha' });
    const r = (await adminGet(admin, '/investments?q=adminview')).body;
    assert.equal(r.total, 1); assert.equal(r.investments[0].amount, 123.45); assert.equal(r.investments[0].amountPaise, undefined);
    assert.equal(r.investments[0].user.fullName, 'Inv Owner');
    assert.equal((await adminGet(admin, '/investments?status=Completed&q=adminview')).body.total, 0);
    assert.ok((await adminGet(admin, '/investments?status=All')).body.total >= 1);
    assert.equal((await adminGet(admin, '/investments?status=Bogus')).status, 400);
  });

  test('ROI ledger: all members, newest first, paginated', async () => {
    const admin = await makeAdmin(); const a = await signup({}, { funds: 1000 });
    await invest(a.token, { amount: 1000, durationDays: 3 });
    await processDailyRoi(new Date(Date.now() + 5 * DAY));
    const r = (await adminGet(admin, '/roi?limit=2')).body;
    assert.equal(r.roiHistory.length, 2); assert.ok(r.total >= 3);
    assert.ok(new Date(r.roiHistory[0].date) >= new Date(r.roiHistory[1].date));
    assert.ok(r.roiHistory[0].user.email && r.roiHistory[0].investment.planName && typeof r.roiHistory[0].amount === 'number');
  });
});

test.describe('startup config', () => {
  const { validateEnv } = require('../src/config/env');
  test('short or placeholder JWT secret is rejected at startup', () => {
    const old = { s: process.env.JWT_SECRET, e: process.env.NODE_ENV };
    try {
      process.env.JWT_SECRET = 'short';
      assert.throws(() => validateEnv(), /JWT_SECRET/);
      process.env.JWT_SECRET = 'replace_with_a_long_random_secret_at_least_32_chars'; process.env.NODE_ENV = 'production';
      assert.throws(() => validateEnv(), /placeholder/);
    } finally { process.env.JWT_SECRET = old.s; process.env.NODE_ENV = old.e; }
  });
  test('invalid COOKIE_SAMESITE is rejected', () => {
    process.env.COOKIE_SAMESITE = 'sometimes';
    try { assert.throws(() => validateEnv(), /COOKIE_SAMESITE/); } finally { delete process.env.COOKIE_SAMESITE; }
  });
});

test.describe('misc', () => {
  test('unknown route -> 404 JSON, health ok', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('GET', '/api/health')).body.status, 'ok');
  });
  test('oversized body -> 413', async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x'.repeat(30000) } });
    assert.equal(r.status, 413);
  });
});
