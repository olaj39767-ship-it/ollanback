const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { updateProfile, updateUserRole, getAllUsers } = require("../controllers/userController");
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.put('/profile', authMiddleware, updateProfile);
router.put('/role', authMiddleware, adminMiddleware, updateUserRole);
router.get('/', getAllUsers);
router.get('/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  res.json(user);
});

module.exports = router;