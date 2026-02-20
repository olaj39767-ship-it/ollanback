const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { authMiddleware } = require('../middleware/auth');

router.post('/add', authMiddleware, cartController.addToCart);
router.get('/', authMiddleware, cartController.getCart);
router.delete('/remove/:productId', authMiddleware, cartController.removeFromCart);

module.exports = router;