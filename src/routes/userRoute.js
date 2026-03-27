const express = require('express');
const router = express.Router();
const { updateProfile, updateUserRole, getAllUsers } = require("../controllers/userController");

const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.put('/profile', authMiddleware, updateProfile);
router.put('/role', authMiddleware, adminMiddleware, updateUserRole);
router.get('/', getAllUsers);

module.exports = router;