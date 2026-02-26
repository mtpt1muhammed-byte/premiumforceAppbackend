const { verifyAccessToken } = require('../utils/authUtils');
const Driver = require('../models/driver_model');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Get driver from database
    const driver = await Driver.findById(decoded.id).select('-otp');
    
    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    if (!driver.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    req.driver = driver;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: error.message
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      
      if (decoded) {
        const driver = await Driver.findById(decoded.id).select('-otp');
        if (driver && driver.isActive) {
          req.driver = driver;
        }
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

// Rate limiting for OTP requests
const otpRateLimiter = async (req, res, next) => {
  const { phoneNumber } = req.body;
  const driver = await Driver.findOne({ phoneNumber });

  if (driver) {
    const now = new Date();
    
    // Check if account is locked
    if (driver.lockedUntil && driver.lockedUntil > now) {
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Try after ${Math.ceil((driver.lockedUntil - now) / 60000)} minutes`
      });
    }

    // Check OTP request frequency
    if (driver.otp?.expiresAt) {
      const timeSinceLastOTP = now - new Date(driver.updatedAt);
      if (timeSinceLastOTP < 60000) { // 1 minute
        return res.status(429).json({
          success: false,
          message: 'Please wait 1 minute before requesting another OTP'
        });
      }
    }
  }

  next();
};

module.exports = { authenticate, optionalAuth, otpRateLimiter };


