const router = require('express').Router();
const { createInvestment, listInvestments } = require('../controllers/investmentController');
router.get('/', listInvestments);
router.post('/', createInvestment);
module.exports = router;
