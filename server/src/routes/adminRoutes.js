const router = require('express').Router();
const c = require('../controllers/adminController');
// mounted behind protect + requireAdmin in app.js
router.get('/deposits', c.listDeposits);
router.post('/deposits/:id/approve', c.approveDeposit);
router.post('/deposits/:id/reject', c.rejectDeposit);
router.post('/run-roi', c.runRoi);
router.get('/stats', c.getStats);
router.get('/users', c.listUsers);
router.patch('/users/:id/status', c.setUserStatus);
router.get('/investments', c.listInvestments);
router.get('/roi', c.listRoi);
module.exports = router;
