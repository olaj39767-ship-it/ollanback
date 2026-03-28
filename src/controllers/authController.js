const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const EmailService = require('../config/emailService');
const logger = require('../config/logger');

// ====================== VALIDATION SCHEMAS ======================
const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().required(),
});

const signinSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// ====================== HELPER FUNCTION ======================
// Generate 8-character referral code
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// ====================== SIGNUP ======================
exports.signup = async (req, res) => {
  const { error } = signupSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { email, password, name } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP for email verification
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    const user = new User({
      email,
      password,
      name,
      isVerified: false,
      verificationToken: otp,
      verificationTokenExpires: otpExpires,
      // referralCode will be generated later via updateProfile if needed
      // storeCredit defaults to 0
    });

    await user.save();

    // Send verification email with referral code info
    const message = `
      Hi ${name}!

      Thank you for signing up with Ollan Pharmacy.

      Your verification code is: <strong>${otp}</strong>

      Please enter this code to verify your email.
      This code will expire in 10 minutes.

      You can generate your referral code after verifying your email by updating your profile.
      Share your referral code with friends and earn store credit when they use it during checkout!
    `;

    await EmailService.sendTextEmail(email, 'Verify Your Email Address', message);

    logger.info(`New user signed up: ${email}`);

    res.status(201).json({
      message: 'Signup successful! Please check your email for the verification code.',
    });

  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ====================== UPDATE PROFILE (with Referral Code Generation) ======================
exports.updateProfile = async (req, res) => {
  const { name, email, generateReferralCode: shouldGenerateReferral } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update name and email if provided
    if (name) user.name = name;
    if (email) user.email = email;

    // Generate referral code only if requested and user doesn't have one
    let referralCodeGenerated = false;

    if (shouldGenerateReferral === true && !user.referralCode) {
      user.referralCode = generateReferralCode();
      referralCodeGenerated = true;
      logger.info(`Referral code generated for user ${user._id}: ${user.referralCode}`);
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        referralCode: user.referralCode,
        storeCredit: user.storeCredit || 0,
      },
      referralCodeGenerated,
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== VERIFY EMAIL ======================
exports.verifyEmail = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await User.findOne({
      email,
      verificationToken: otp,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    const jwtToken = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Email verified successfully',
      token: jwtToken,
      user: { 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        role: user.role,
        referralCode: user.referralCode,
        storeCredit: user.storeCredit || 0
      },
    });
  } catch (error) {
    logger.error('Verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== SIGNIN ======================
exports.signin = async (req, res) => {
  const { error } = signinSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email before signing in.' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ 
      token, 
      user: { 
        id: user._id, 
        email: user.email, 
        name: user.name, 
        role: user.role,
        referralCode: user.referralCode,
        storeCredit: user.storeCredit || 0
      } 
    });
  } catch (error) {
    logger.error('Signin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== RESEND VERIFICATION EMAIL ======================
exports.resendVerificationEmail = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.isVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000;

    user.verificationToken = otp;
    user.verificationTokenExpires = otpExpires;
    await user.save();

    const message = `
      Hi ${user.name}!
      Your new verification code is: <strong>${otp}</strong>
      Please enter this code in the verification page.
      This code will expire in 10 minutes.
    `;

    await EmailService.sendTextEmail(email, 'Verify Your Email Address', message);

    res.status(200).json({ message: 'Verification code resent successfully' });
  } catch (error) {
    logger.error('Resend verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== FORGOT PASSWORD ======================
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordToken = otp;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    const message = `
      Hi ${user.name}!
      You requested a password reset for your Ollan Pharmacy account.
      Your password reset code is: <strong>${otp}</strong>
      Enter this code to reset your password.
      This code will expire in 10 minutes.
      If you did not request this, please ignore this email.
    `;

    await EmailService.sendTextEmail(email, 'Password Reset Code', message);

    res.json({ message: 'Password reset code sent to your email' });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ====================== RESET PASSWORD ======================
exports.resetPassword = async (req, res) => {
  const { email, otp, password } = req.body;

  try {
    const user = await User.findOne({
      email,
      resetPasswordToken: otp,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired code' });

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};