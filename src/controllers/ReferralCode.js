const mongoose = require('mongoose');

const referralCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    minlength: 5,
    maxlength: 12,
  },

  // Who created it (free text – not linked to any User)
  creatorName: {
    type: String,
    trim: true,
    default: '',
  },
  creatorEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  creatorPhone: {
    type: String,
    trim: true,
    default: '',
  },

  // Stats
  totalUses: {
    type: Number,
    default: 0,
    min: 0,
  },
  verifiedPurchases: {
    type: Number,
    default: 0,
    min: 0,
  },

  // Optional controls
  active: {
    type: Boolean,
    default: true,
  },
  maxUses: {
    type: Number,
    default: null,          // null = unlimited
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 50,
  },
  expiresAt: {
    type: Date,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

referralCodeSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('ReferralCode', referralCodeSchema);