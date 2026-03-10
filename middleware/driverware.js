// middleware/auth.js
const jwt = require('jsonwebtoken');
const Driver = require('../models/driver_model');

const authenticateDriver = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find the driver
    const driver = await Driver.findById(decoded.driverId).select('-refreshToken');
    
    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    if (!driver.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Driver account is inactive'
      });
    }

    // Attach driver to request
    req.driver = {
      driverId: driver._id,
      phoneNumber: driver.phoneNumber,
      isVerified: driver.isVerified
    };
    
    req.token = token;
    next();
    
  } catch (error) {
    console.error('Driver authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

// Make sure to export it
module.exports = {
  authenticateDriver,
  // ... other middleware exports
};