const ReferralCode = require('../models/ReferralCode');
const logger = require('../config/logger');

exports.createReferralCode = async (req, res) => {
  try {
    const { code, creatorName, creatorEmail, creatorPhone, discountPercent = 0 } = req.body;

    let finalCode = (code || '').trim().toUpperCase();

    // Auto-generate if no code provided
    if (!finalCode) {
      finalCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    // Check for collision
    let existing = await ReferralCode.findOne({ code: finalCode });
    let attempts = 0;
    while (existing && attempts < 10) {
      finalCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      existing = await ReferralCode.findOne({ code: finalCode });
      attempts++;
    }

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Could not generate a unique code. Please try again or provide your own.',
      });
    }

    const referral = new ReferralCode({
      code: finalCode,
      creatorName: (creatorName || '').trim(),
      creatorEmail: (creatorEmail || '').trim().toLowerCase(),
      creatorPhone: (creatorPhone || '').trim(),
      discountPercent: Number(discountPercent) || 0,
    });

    await referral.save();

    return res.status(201).json({
      success: true,
      message: 'Referral code created successfully',
      data: {
        code: referral.code,
        discountPercent: referral.discountPercent,
        shareUrl: `${process.env.FRONTEND_URL}/?ref=${referral.code}`,
        creatorName: referral.creatorName || 'Anonymous',
      },
    });
  } catch (err) {
    logger.error('Referral code creation failed', { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      message: 'Server error while creating referral code',
    });
  }
};

exports.getReferralStats = async (req, res) => {
  try {
    // You can add admin-only middleware here if desired
    const codes = await ReferralCode.find()
      .sort({ verifiedPurchases: -1, totalUses: -1 })
      .limit(100);

    const stats = codes.map((c) => ({
      code: c.code,
      creator: c.creatorName || c.creatorEmail || 'Anonymous',
      verifiedPurchases: c.verifiedPurchases,
      totalUses: c.totalUses,
      discountPercent: c.discountPercent,
      active: c.active,
      createdAt: c.createdAt,
    }));

    return res.json({
      success: true,
      count: stats.length,
      data: stats,
    });
  } catch (err) {
    logger.error('Referral stats failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};