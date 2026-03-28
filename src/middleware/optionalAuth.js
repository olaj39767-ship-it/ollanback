const jwt = require('jsonwebtoken');
const User = require('../models/User');

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null; // invalid/expired token → treat as guest, don't block
  }
  next();
};

module.exports = optionalAuth;