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

exports.getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('referralCode storeCredit name email');

    res.status(200).json({
      success: true,
      data: {
        referralCode: user.referralCode,
        storeCredit: user.storeCredit
      }
    });
  } catch (error) {
    logger.error('Get referral info error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


exports.applyReferralDuringPayment = async (referralCode, orderAmount, orderId) => {
  if (!referralCode || !orderAmount || orderAmount <= 0) return null;

  try {
    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase().trim() });

    if (!referrer) {
      logger.warn(`Invalid referral code used: ${referralCode}`);
      return null;
    }

    // Calculate referral bonus (e.g., 5% of order amount)
    const referralPercentage = 0.05; // 5% - you can make this configurable
    const bonusAmount = orderAmount * referralPercentage;

    // Add bonus to referrer's store credit
    referrer.addStoreCredit(bonusAmount);
    await referrer.save();

    logger.info(`Referral bonus applied: ${bonusAmount} to ${referrer.email} (Code: ${referralCode}) for order ${orderId}`);

    return {
      referrerId: referrer._id,
      bonusAmount: Math.round(bonusAmount * 100) / 100,
      referralCode
    };
  } catch (error) {
    logger.error('Apply referral during payment error:', error);
    return null;
  }
};

// Admin: Manually credit store credit to a user
exports.creditStoreCredit = async (req, res) => {
  const { userId, amount, reason = 'Manual credit' } = req.body;

  if (!userId || amount <= 0) {
    return res.status(400).json({ message: 'Invalid userId or amount' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.addStoreCredit(amount);
    await user.save();

    logger.info(`Store credit credited: ${amount} to user ${userId} - ${reason}`);

    res.json({
      success: true,
      message: 'Store credit credited successfully',
      data: {
        userId: user._id,
        name: user.name,
        newStoreCredit: user.storeCredit
      }
    });
  } catch (error) {
    logger.error('Credit store credit error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Optional: Get all users with referral & credit info (for admin)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -__v -verificationToken -resetPasswordToken')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    logger.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};