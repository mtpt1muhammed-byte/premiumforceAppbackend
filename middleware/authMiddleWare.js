// middleware/authMiddleware.js
const jwtService = require('../services/jwtService');
const BlacklistedToken = require('../models/blacklistedToken');
const User = require('../models/users_model');

class AuthMiddleware {
  async authenticate(req, res, next) {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'No token provided'
        });
      }

      // Check if token is blacklisted
      const isBlacklisted = await BlacklistedToken.findOne({ token });
      if (isBlacklisted) {
        return res.status(401).json({
          success: false,
          message: 'Token has been invalidated'
        });
      }

      // Verify token
      const decoded = jwtService.verifyAccessToken(token);
      
      // Get user from database
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Attach user to request
      req.user = user;
      req.token = token;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        error: error.message
      });
    }
  }

  extractToken(req) {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      return req.headers.authorization.substring(7);
    }
    return null;
  }

  authorize(...roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions'
        });
      }

      next();
    };
  }

  // Optional: Check if user is the owner or admin
  checkOwnershipOrAdmin(paramIdField = 'id') {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const resourceId = req.params[paramIdField];
      
      if (req.user.role === 'admin' || req.user.role === 'moderator' || req.user._id.toString() === resourceId) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource'
      });
    };
  }
}

module.exports = new AuthMiddleware();
