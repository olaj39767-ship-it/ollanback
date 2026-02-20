// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const logger = require("../config/logger");

exports.authMiddleware = async (req, res, next) => {
  let token;
  
  // Check for token in Authorization header first
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } 
  // If not in header, check query parameters (for SSE)
  else if (req.query.token) {
    token = req.query.token;
  }
  
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error("Auth middleware error:", error);
    res.status(401).json({ message: "Invalid token" });
  }
};

exports.adminMiddleware = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};