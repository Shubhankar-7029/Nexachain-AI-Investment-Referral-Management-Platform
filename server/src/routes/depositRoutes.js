const router = require('express').Router();
const { createDeposit, listDeposits } = require('../controllers/depositController');
router.get('/', listDeposits);
router.post('/', createDeposit);
module.exports = router;
