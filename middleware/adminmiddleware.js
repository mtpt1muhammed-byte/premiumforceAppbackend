// middleware/adminmiddleware.js - FIXED VERSION
const jwt = require('jsonwebtoken');
const Admin = require('../models/users_model');

const authenticate = async (req, res, next) => {
  try {
    console.log('🔐 AUTHENTICATE MIDDLEWARE STARTED');
    
    // Get token from header
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader);
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'No authorization header'
      });
    }

    // Extract token
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log('✅ Token decoded:', decoded);

    // Get the user ID from token (try different possible field names)
    const userId = decoded.userId || decoded.id || decoded._id;
    console.log('Looking for user with ID:', userId);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format - no user ID'
      });
    }

    // Find the user - IMPORTANT: Check which field name your schema uses
    const admin = await Admin.findOne({ 
      $or: [
        { _id: userId },
        { id: userId },
        { userId: userId }
      ]
    }).select('-password');
    
    console.log('Admin found:', admin ? `Yes - ${admin.email || admin.phoneNumber}` : 'No');

    if (!admin) {
      // Let's check what users exist in the database
      const allUsers = await Admin.find({}).limit(5).select('_id email phoneNumber');
      console.log('Existing users in DB:', allUsers.map(u => ({
        id: u._id.toString(),
        email: u.email,
        phone: u.phoneNumber
      })));
      
      return res.status(401).json({
        success: false,
        message: 'User not found in database',
        debug: {
          searchedId: userId,
          existingUserIds: allUsers.map(u => u._id.toString())
        }
      });
    }

    // Set user in request
    req.admin = admin;
    req.userType = 'admin';
    console.log('✅ Admin authenticated successfully');
    next();

  } catch (error) {
    console.error('❌ Auth error:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
};

module.exports = { authenticate, requireAdmin };
