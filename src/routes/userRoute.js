const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.put('/profile', authMiddleware, userController.updateProfile);
router.put('/role', authMiddleware, adminMiddleware, userController.updateUserRole);

module.exports = router;