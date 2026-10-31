const router = require('express').Router();
const c = require('../controllers/dashboardController');
router.get('/', c.getDashboard);
router.get('/histories', c.getHistories);
router.get('/roi', c.listRoi);
router.get('/referral-income', c.listReferralIncome);
router.get('/chart', c.getChart);
module.exports = router;
