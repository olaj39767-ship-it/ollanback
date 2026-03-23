const mongoose = require('mongoose');

const referralCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    // Total times this code was submitted at checkout
    totalUses: {
      type: Number,
      default: 0,
    },
    // Times a payment using this code was actually verified by admin
    verifiedPurchases: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReferralCode', referralCodeSchema);