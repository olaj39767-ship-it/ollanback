const User = require('../models/User');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Joi = require('joi');
const crypto = require('crypto');
const EmailService = require('../config/emailService'); // Import your EmailService


const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().required(),
});

const signinSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// In exports.signup
// exports.signup = async (req, res) => {
//   const { error } = signupSchema.validate(req.body);
//   if (error) return res.status(400).json({ message: error.details[0].message });

//   const { email, password, name } = req.body;

//   try {
//     const existingUser = await User.findOne({ email });
//     if (existingUser) return res.status(400).json({ message: 'User already exists' });

//     const user = new User({ email, password, name });
//     await user.save();

//     const token = jwt.sign(
//       { id: user._id, email: user.email, name: user.name, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: '1d' }
//     );
//     res.status(201).json({ token, user: { id: user._id, email, name, role: user.role } });
//   } catch (error) {
//     res.status(500).json({ message: 'Server error' });
//   }
// };

exports.signup = async (req, res) => {
  const { error } = signupSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });

  const { email, password, name } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists' });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // OTP expires in 10 minutes

    const user = new User({
      email,
      password,
      name,
      isVerified: false,
      verificationToken: otp, // Store OTP as verificationToken
      verificationTokenExpires: otpExpires,
    });
    await user.save();

    // Send OTP via email
    const message = `
      Hi ${name}!
      Thank you for signing up with Ollan Pharmacy.
      Your verification code is: <strong>${otp}</strong>
      Please enter this code in the verification page to confirm your email.
      This code will expire in 10 minutes.
    `;
    console.log(`Attempting to send email to ${email} with OTP: ${otp}`);
    const emailResult = await EmailService.sendTextEmail(email, 'Verify Your Email Address', message);
    console.log(`Email sent to ${email}:`, emailResult);

    res.status(201).json({ message: 'Signup successful! Please check your email for the verification code.' });
  } catch (error) {
    console.error('Signup error:', {
      message: error.message,
      code: error.code,
      response: error.response,
      stack: error.stack,
    });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


exports.verifyEmail = async (req, res) => {
  const { email, otp } = req.body; // Changed from req.query to req.body

  try {
    const user = await User.findOne({
      email,
      verificationToken: otp, // OTP is stored in verificationToken
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    // Generate JWT after verification
    const jwtToken = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Email verified successfully',
      token: jwtToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

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

    // Generate new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    user.verificationToken = otp;
    user.verificationTokenExpires = otpExpires;
    await user.save();

    // Send new OTP via email
    const message = `
      Hi ${user.name}!
      Your new verification code is: <strong>${otp}</strong>
      Please enter this code in the verification page to confirm your email.
      This code will expire in 10 minutes.
    `;
    await EmailService.sendTextEmail(email, 'Verify Your Email Address', message);

    res.status(200).json({ message: 'Verification code resent successfully' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// In exports.signin
// exports.signin = async (req, res) => {
//   const { error } = signinSchema.validate(req.body);
//   if (error) return res.status(400).json({ message: error.details[0].message });

//   const { email, password } = req.body;

//   try {
//     const user = await User.findOne({ email });
//     if (!user || !(await user.comparePassword(password))) {
//       return res.status(401).json({ message: 'Invalid credentials' });
//     }

//     const token = jwt.sign(
//       { id: user._id, email: user.email, name: user.name, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: '1d' }
//     );
//     res.json({ token, user: { id: user._id, email, name: user.name, role: user.role } });
//   } catch (error) {
//     res.status(500).json({ message: 'Server error' });
//   }
// };

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
    res.json({ token, user: { id: user._id, email, name: user.name, role: user.role } });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Other endpoints (forgotPassword, resetPassword, updateProfile) remain unchanged
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetLink = `http://localhost:3000/pages/reset-password/${token}`;
    await transporter.sendMail({
      to: email,
      subject: 'Password Reset',
      html: `Click <a href="${resetLink}">here</a> to reset your password.`,
    });

    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, email } = req.body;

  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.name = name || user.name;
    user.email = email || user.email;
    await user.save();

    res.json({ message: 'Profile updated', user: { id: user._id, email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};