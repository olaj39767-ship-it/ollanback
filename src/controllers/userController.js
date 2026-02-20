const User = require('../models/User');
const logger = require('../config/logger');

exports.updateUserRole = async (req, res) => {
  const { userId, role } = req.body;

  if (!userId || !['customer', 'admin', 'seller', 'rider'].includes(role)) {
    return res.status(400).json({ message: 'Invalid user ID or role' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = role;
    await user.save();
    logger.info(`User role updated: ${userId} to ${role}`);
    res.json({ message: 'User role updated', user });
  } catch (error) {
    logger.error('Update user role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Existing function (unchanged)
exports.updateProfile = async (req, res) => {
  const userId = req.user._id;
  const { email, name } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.email = email || user.email;
    user.name = name || user.name;
    await user.save();
    logger.info(`Profile updated for user: ${userId}`);
    res.json({ message: 'Profile updated', user });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};