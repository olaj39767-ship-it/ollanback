const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/signup', authController.signup);
router.post('/signin', authController.signin);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-verification', authController.resendVerificationEmail);
router.post('/verify-email', authController.verifyEmail);
router.put('/profile', authController.updateProfile);

module.exports = router;