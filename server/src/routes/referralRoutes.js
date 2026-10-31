const router = require('express').Router();
const { getDirectReferrals, getReferralTree } = require('../controllers/referralController');
router.get('/direct', getDirectReferrals);
router.get('/tree', getReferralTree);
module.exports = router;
