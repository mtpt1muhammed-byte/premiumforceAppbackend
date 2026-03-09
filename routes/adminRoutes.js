// routes/adminRoutes.js
const express = require('express');
const Admin = require('../models/adminModel');
const User = require('../models/adminModel');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const {   authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAny,
  // New refresh token functions
 
 } = require('../middleware/adminmiddleware');

const router = express.Router();

// Generate Access Token
const generateAccessToken = (admin) => {
  return jwt.sign(
    { 
      adminId: admin._id, 
      email: admin.email,
      role: admin.role 
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d' }
  );
};

// Generate Refresh Token
const generateRefreshToken = (admin) => {
  return jwt.sign(
    { adminId: admin._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    const admin = await Admin.findById(decoded.adminId).select('-password -__v');
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Admin not found'
      });
    }

    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin account is deactivated'
      });
    }

    req.admin = admin;
    next();
  } catch (error) {
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
    return res.status(500).json({
      success: false,
      message: 'Error verifying token',
      error: error.message
    });
  }
};

/**
 * @route   POST /api/admin/fcm-token
 * @desc    Save FCM token for admin
 * @access  Private
 */
router.post('/fcm-token', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'fcmToken is required and must be a string.',
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { fcmToken },
      { new: true, select: '_id email role' }
    );

    console.log(`🔔 FCM token saved for admin ${admin.email} (${admin._id})`);
    res.json({ success: true, message: 'FCM token registered.' });
  } catch (err) {
    console.error('FCM token route error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * @route   DELETE /api/admin/fcm-token
 * @desc    Clear FCM token on logout
 * @access  Private
 */
router.delete('/fcm-token', verifyToken, async (req, res) => {
  try {
    await Admin.findByIdAndUpdate(req.admin._id, { fcmToken: null });
    res.json({ success: true, message: 'FCM token cleared.' });
  } catch (err) {
    console.error('FCM token delete error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * @route   POST /api/admin/register
 * @desc    Register a new admin
 * @access  Public (or maybe Private with superadmin role)
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, role = 'admin' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }

    // Create with plain password - middleware will hash it
    const newAdmin = new Admin({
      email: email.toLowerCase(),
      password,  // Plain text - auto-hashed by pre-save
      role
    });

    const savedAdmin = await newAdmin.save();  // Triggers pre-save hashing

    // Rest of your token logic stays the same...
    const accessToken = generateAccessToken(savedAdmin);
    const refreshToken = generateRefreshToken(savedAdmin);

    savedAdmin.refreshToken = refreshToken;
    await savedAdmin.save();  // Triggers pre-save again (but !isModified('password') skips hashing)

    const adminResponse = savedAdmin.toObject();
    delete adminResponse.refreshToken;
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      data: {
        admin: adminResponse,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
        }
      }
    });
  } catch (error) {
    console.error('Register admin error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error registering admin',
      error: error.message
    });
  }
});


/**
 * @route   POST /api/admin/login
 * @desc    Login admin
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find admin by email
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact super admin.'
      });
    }

    // Check password
    const isPasswordMatch = await admin.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate tokens
    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);

    // Save refresh token
    admin.refreshToken = refreshToken;
    await admin.save();

    // Prepare response
    const adminResponse = admin.toObject();
    delete adminResponse.refreshToken;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        admin: adminResponse,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
        }
      }
    });
  } catch (error) {
    console.error('Login admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
});








// GET /api/analytics/dashboard-summary
router.get('/dashboard-summary', authenticateToken, authorizeAdmin,
     async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get all counts in parallel
    const [
      totalUsers,
      totalDrivers,
      totalBookings,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      totalEarnings
    ] = await Promise.all([
      User.countDocuments(dateFilter),
      Driver.countDocuments(dateFilter),
      Booking.countDocuments(dateFilter),
      Booking.countDocuments({ ...dateFilter, bookingStatus: 'completed' }),
      Booking.countDocuments({ ...dateFilter, bookingStatus: 'pending' }),
      Booking.countDocuments({ ...dateFilter, bookingStatus: 'cancelled' }),
      Booking.aggregate([
        { $match: { ...dateFilter, paymentStatus: true } },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers
        },
        drivers: {
          total: totalDrivers
        },
        bookings: {
          total: totalBookings,
          completed: completedBookings,
          pending: pendingBookings,
          cancelled: cancelledBookings,
          completionRate: totalBookings > 0 ? (completedBookings / totalBookings * 100).toFixed(2) : 0
        },
        earnings: {
          total: totalEarnings[0]?.total || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});








/**
 * @route   POST /api/admin/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find admin with this refresh token
    const admin = await Admin.findOne({ 
      _id: decoded.adminId,
      refreshToken: refreshToken 
    });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new access token
    const accessToken = generateAccessToken(admin);

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
      }
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/logout
 * @desc    Logout admin (clear refresh token)
 * @access  Private
 */
router.post('/logout', verifyToken, async (req, res) => {
  try {
    // Clear refresh token
    req.admin.refreshToken = null;
    await req.admin.save();

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging out',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/check-email
 * @desc    Check if email exists
 * @access  Public
 */
router.get('/check-email', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || email.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    
    const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    const existingAdmin = await Admin.findOne({ email: cleanEmail })
      .select('-refreshToken -__v -password');

    if (existingAdmin) {
      return res.status(200).json({
        success: true,
        exists: true,
        message: 'Email found in database',
        data: {
          admin: existingAdmin
        }
      });
    }

    return res.status(404).json({
      success: false,
      exists: false,
      message: `Admin with email ${email} does not exist in our database`
    });

  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking email',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/profile
 * @desc    Get admin profile
 * @access  Private
 */
router.get('/profile', verifyToken, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: req.admin
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin
 * @desc    Get all admins with filtering
 * @access  Private (superadmin only ideally)
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role, isActive, sort, page = 1, limit = 10 } = req.query;
    let query = {};
    
    // Filtering
    if (role) query.role = role;
    if (isActive) query.isActive = isActive === 'true';
    
    // Sorting
    let sortOption = {};
    if (sort === 'newest') sortOption.createdAt = -1;
    else if (sort === 'oldest') sortOption.createdAt = 1;
    else if (sort === 'email') sortOption.email = 1;
    else sortOption.createdAt = -1;
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const admins = await Admin.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-refreshToken -__v -password');
    
    const total = await Admin.countDocuments(query);


    res.status(200).json({
      success: true,
      count: admins.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: admins
    });
  } catch (error) {
    console.error('Fetch all admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admins',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/:id
 * @desc    Get admin by ID
 * @access  Private
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id)
      .select('-refreshToken -__v -password');
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    console.error('Fetch admin error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching admin',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/:id
 * @desc    Update admin
 * @access  Private
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { email, password, role, isActive } = req.body;
    
    // Find the admin we want to update
    const adminToUpdate = await Admin.findById(req.params.id);
    
    if (!adminToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Check permissions - only superadmin can update other admins, or admin can update themselves
    if (req.admin.role !== 'superadmin' && req.admin._id.toString() !== req.params.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this admin'
      });
    }

    // Check for duplicate email (if email is being changed)
    if (email && email.toLowerCase() !== adminToUpdate.email) {
      const existingAdmin = await Admin.findOne({ 
        email: email.toLowerCase(), 
        _id: { $ne: req.params.id } 
      });
      
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another admin'
        });
      }
    }

    // Prepare update fields
    const updateFields = {};
    
    if (email) updateFields.email = email.toLowerCase();
    if (role && req.admin.role === 'superadmin') updateFields.role = role; // Only superadmin can change role
    if (typeof isActive === 'boolean' && req.admin.role === 'superadmin') updateFields.isActive = isActive; // Only superadmin can change active status
    
    // Handle password update separately
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    }

    // Check if there's anything to update
    if (Object.keys(updateFields).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected',
        data: adminToUpdate
      });
    }

    // Update admin
    const updatedAdmin = await Admin.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-refreshToken -__v -password');

    res.status(200).json({
      success: true,
      message: 'Admin updated successfully',
      data: updatedAdmin,
      updated: Object.keys(updateFields)
    });
    
  } catch (error) {
    console.error('Update admin error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating admin',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/admin/:id
 * @desc    Delete admin
 * @access  Private (superadmin only)
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only superadmin can delete admin accounts'
      });
    }

    // Prevent deleting yourself
    if (req.admin._id.toString() === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const admin = await Admin.findById(req.params.id);
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    // Delete admin from database
    await Admin.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting admin',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/admin/:id/deactivate
 * @desc    Deactivate admin (soft delete)
 * @access  Private (superadmin only)
 */
router.patch('/:id/deactivate', verifyToken, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only superadmin can deactivate admin accounts'
      });
    }

    if (req.admin._id.toString() === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate your own account'
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).select('-refreshToken -__v -password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin deactivated successfully',
      data: admin
    });
  } catch (error) {
    console.error('Deactivate admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating admin',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/admin/:id/activate
 * @desc    Activate admin
 * @access  Private (superadmin only)
 */
router.patch('/:id/activate', verifyToken, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only superadmin can activate admin accounts'
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    ).select('-refreshToken -__v -password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin activated successfully',
      data: admin
    });
  } catch (error) {
    console.error('Activate admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error activating admin',
      error: error.message
    });
  }
});

module.exports = router;