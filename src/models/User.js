const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Generate 8-character referral code
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { 
    type: String, 
    default: 'customer', 
    enum: ['customer', 'admin', 'seller', 'rider'] 
  },

  // Referral System
  referralCode: {
    type: String,
    unique: true,
    default: generateReferralCode,
    immutable: true   // Prevent changing referral code later
  },

  // Store Credit
  storeCredit: {
    type: Number,
    default: 0,
    min: 0
  },

  // Existing fields
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  verificationTokenExpires: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
}, {
  timestamps: true
});

// Password hashing
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Store Credit Methods
userSchema.methods.addStoreCredit = function (amount) {
  this.storeCredit += Math.round(amount * 100) / 100; // 2 decimal precision
  return this.storeCredit;
};

userSchema.methods.deductStoreCredit = function (amount) {
  if (this.storeCredit < amount) {
    throw new Error('Insufficient store credit');
  }
  this.storeCredit -= Math.round(amount * 100) / 100;
  return this.storeCredit;
};

module.exports = mongoose.model('User', userSchema);