// routes/driverRoutes.js
const express = require('express');
const Driver = require('../models/driver_model');

const AdminAssignDriver = require('../models/assign_admin_driver_model');
const Booking = require('../models/booking_model');
const Customer = require('../models/users_model');
const DriverOTP = require('../models/driver_otp_model');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const jwt = require('jsonwebtoken');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

const {authenticateDriver} = require('../middleware/driverware');
const twilio = require('twilio');
const mongoose = require('mongoose'); // <-- ADD THIS LINE

const { notifyUser, notifyUsers } = require('../fcm');


const router = express.Router();

// Initialize Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============= HELPER FUNCTIONS =============
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const generateAccessToken = (driver) => {
  return jwt.sign(
    { 
      driverId: driver._id, 
      phoneNumber: driver.phoneNumber,
      role: 'driver'
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
};

const generateRefreshToken = (driver) => {
  return jwt.sign(
    { driverId: driver._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};

// Middleware to verify driver token
const verifyDriverToken = async (req, res, next) => {
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
    
    const driver = await Driver.findById(decoded.driverId).select('-refreshToken -__v');
    
    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    if (!driver.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Driver account is deactivated'
      });
    }

    req.driver = driver;
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

// ============= PUBLIC ROUTES (No Auth Required) =============

/**
 * @route   POST /api/drivers/send-otp
 * @desc    Send OTP for driver login/registration
 * @access  Public
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+966', purpose = 'login' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // For login, check if driver exists
    if (purpose === 'login') {
      const existingDriver = await Driver.findOne({ countryCode, phoneNumber });
      console.log(`Checking driver existence for ${countryCode}${phoneNumber}:`, existingDriver);
      if (!existingDriver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found. Please register first.'
        });
      }
    }

    // Generate OTP
    const otpCode = generateOTP();

    // Delete any existing unused OTPs for this number
    await DriverOTP.deleteMany({ 
      phoneNumber, 
      countryCode, 
      purpose, 
      isUsed: false 
    });

    // Save new OTP
    await DriverOTP.create({
      phoneNumber,
      countryCode,
      otp: otpCode,
      purpose
    });

    // Send OTP via SMS (Twilio)
    try {
      await twilioClient.messages.create({
        body: `Your driver OTP is: ${otpCode}. Valid for 10 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `${countryCode}${phoneNumber}`
      });
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      if (process.env.NODE_ENV === 'production') {
        throw smsError;
      }
    }

    const response = {
      success: true,
      message: 'OTP sent successfully'
    };

    if (process.env.NODE_ENV !== 'production') {
      response.otp = otpCode;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending OTP',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/drivers/verify-otp
 * @desc    Verify OTP and login/register
 * @access  Public
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+966', otp, purpose = 'login' } = req.body;

    // Find valid OTP
    const otpDoc = await DriverOTP.findOne({
      phoneNumber,
      countryCode,
      otp,
      purpose,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();

    let driver;
    let isNewDriver = false;

    if (purpose === 'login') {
      // Login - driver must exist
      driver = await Driver.findOne({ phoneNumber, countryCode });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found. Please complete registration first.'
        });
      }
    } else if (purpose === 'registration') {
      // Registration - create if not exists
      driver = await Driver.findOne({ phoneNumber, countryCode });
      if (!driver) {
        isNewDriver = true;
        driver = new Driver({
          phoneNumber,
          countryCode,
          driverName: `Driver_${phoneNumber.slice(-4)}`
        });
        await driver.save();
      }
    }

    // Update last login
    driver.lastLogin = new Date();
    
    // Generate tokens
    const accessToken = generateAccessToken(driver);
    const refreshToken = generateRefreshToken(driver);

    // Save refresh token in database
    driver.refreshToken = refreshToken;
    await driver.save();

    const response = {
      success: true,
      message: isNewDriver ? 'Registration successful' : 'Login successful',
      data: {
        driver: driver.getPublicProfile(),
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
        }
      },
      isNewDriver
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: error.message
    });
  }
});




// Mark booking as completed by driver
router.post('/complete-booking/tracking', authenticateDriver, async (req, res) => {
  try {
    const { bookingID } = req.body;
    const driverId = req.driver.driverId;

    // Validate required fields
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Find and update booking in one operation
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingID,
        driverID: driverId,
        bookingStatus: 'assigned'
      },
      {
        $set: {
          bookingStatus: 'starttracking',
          completedAt: new Date()
        }
      },
      { new: true }
    ).select('bookingStatus completedAt pickupLocation dropLocation customerName customerID carName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you are not authorized to complete it'
      });
    }

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalTrips: 1 },
      $set: { lastTripCompletedAt: new Date() }
    });

    console.log(`Booking ${bookingID} marked as completed by driver ${driverId}`); 
    console.log('Booking details:', booking);

    // Get driver details for notification
    const driver = await Driver.findById(driverId).select('driverName phoneNumber');
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Trip started and tracking has begun',
        `Your Trip has tracking started`,
        {
          type: 'start tracking',
          bookingId: bookingID.toString(),
          status: 'start tracking',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupLocation,
            dropLocation: booking.dropLocation,
            carName: booking.carName,
            customerName: customer?.name,
            driverName: driver?.driverName,
            driverPhone: driver?.phoneNumber
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Tracking started successfully',
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        completedAt: booking.completedAt,
        bookingDetails: {
          pickupLocation: booking.pickupLocation,
          dropLocation: booking.dropLocation,
          carName: booking.carName,
          customerName: customer?.name || booking.customerName
        },
        driver: {
          id: driverId,
          name: driver?.driverName,
          phone: driver?.phoneNumber,
          totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
        }
      }
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking',
      error: error.message
    });
  }
});




// Mark booking as completed by driver
router.post('/complete-booking', authenticateDriver, async (req, res) => {
  try {
    const { bookingID } = req.body;
    const driverId = req.driver.driverId;

    // Validate required fields
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Find and update booking in one operation
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingID,
        driverID: driverId,
        bookingStatus: 'assigned'
      },
      {
        $set: {
          bookingStatus: 'completed',
          completedAt: new Date()
        }
      },
      { new: true }
    ).select('bookingStatus completedAt pickupLocation dropLocation customerName customerID carName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you are not authorized to complete it'
      });
    }

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalTrips: 1 },
      $set: { lastTripCompletedAt: new Date() }
    });

    console.log(`Booking ${bookingID} marked as completed by driver ${driverId}`); 
    console.log('Booking details:', booking);

    // Get driver details for notification
    const driver = await Driver.findById(driverId).select('driverName phoneNumber');
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Trip Completed',
        `Your Trip has been completed successfully. Thank you for choosing our service!.Please review your experience`,
        {
          type: 'booking_completed',
          bookingId: bookingID.toString(),
          status: 'completed',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupLocation,
            dropLocation: booking.dropLocation,
            carName: booking.carName,
            customerName: customer?.name,
            driverName: driver?.driverName,
            driverPhone: driver?.phoneNumber
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Trip completed successfully',
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        completedAt: booking.completedAt,
        bookingDetails: {
          pickupLocation: booking.pickupLocation,
          dropLocation: booking.dropLocation,
          carName: booking.carName,
          customerName: customer?.name || booking.customerName
        },
        driver: {
          id: driverId,
          name: driver?.driverName,
          phone: driver?.phoneNumber,
          totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
        }
      }
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking',
      error: error.message
    });
  }
});


// ============= ADMIN ROUTES (Admin Auth Required) =============

/**
 * @route   GET /api/drivers/all
 * @desc    Get all drivers with pagination (Admin only)
 * @access  Private (Admin)
 */
router.get('/all', async (req, res) => {
  console.log('🔥🔥🔥 /all ROUTE IS EXECUTING! 🔥🔥🔥');
  
  try {
    const { 
      isActive, 
      isVerified,
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query
    const query = {};
    
    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true';
    }
    
    if (isVerified !== undefined && isVerified !== '') {
      query.isVerified = isVerified === 'true';
    }
    
    if (search && search.trim() !== '') {
      query.$or = [
        { driverName: { $regex: search.trim(), $options: 'i' } },
        { phoneNumber: { $regex: search.trim(), $options: 'i' } },
        { licenseNumber: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Get total count
    const total = await Driver.countDocuments(query);
    console.log('Total drivers matching query:', total);
    
    // Get drivers with pagination
    const drivers = await Driver.find(query)
      .sort('-createdAt')
      .skip(skip)
      .limit(limitNum)
      .select('-refreshToken -__v');

    console.log('Drivers returned:', drivers.length);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: drivers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Fetch drivers error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * @route   GET /api/drivers/stats
 * @desc    Get driver statistics (Admin only)
 * @access  Private (Admin)
 */
router.get('/stats', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const stats = await Driver.aggregate([
      {
        $group: {
          _id: null,
          totalDrivers: { $sum: 1 },
          activeDrivers: { $sum: { $cond: ['$isActive', 1, 0] } },
          verifiedDrivers: { $sum: { $cond: ['$isVerified', 1, 0] } },
          averageRating: { $avg: '$rating' },
          totalEarnings: { $sum: '$earnings' },
          totalTrips: { $sum: '$totalTrips' }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalDrivers: 0,
        activeDrivers: 0,
        verifiedDrivers: 0,
        averageRating: 0,
        totalEarnings: 0,
        totalTrips: 0
      }
    });
  } catch (error) {
    console.error('Driver stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/drivers/:id
 * @desc    Get driver by ID (Admin only)
 * @access  Private (Admin)
 */
router.get('/:id', async (req, res) => {
  console.log('🔍 Getting driver by ID:', req.params.id);
  
  try {
    // Check if ID is valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid driver ID format' 
      });
    }

    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: driver 
    });
  } catch (error) {
    console.error('Fetch driver error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * @route   GET /api/drivers/phone/:phoneNumber
 * @desc    Get driver by phone number (Admin only)
 * @access  Private (Admin)
 */
router.get('/phone/:phoneNumber', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { countryCode = '+966' } = req.query;
    
    const driver = await Driver.findOne({ 
      phoneNumber: req.params.phoneNumber,
      countryCode 
    }).select('-refreshToken -__v');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Fetch driver by phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver',
      error: error.message
    });
  }
});

// ============= DRIVER ROUTES (Driver Auth Required) =============

/**
 * @route   GET /api/drivers/profile/me
 * @desc    Get current driver profile
 * @access  Private (Driver)
 */
router.get('/profile/me', verifyDriverToken, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: req.driver
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




router.put('/:id', authenticateToken, authorizeAdmin, upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'licenseImage', maxCount: 1 }
]), async (req, res) => {
  console.log('🔍 Updating driver with ID:', req.params.id);
  console.log('Request body:', req.body);
  console.log('Request files:', req.files);
  
  try {
    const { id } = req.params;
    
    // Check if ID is valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      // Delete uploaded files if ID is invalid
      if (req.files) {
        if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
        if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
      }
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid driver ID format' 
      });
    }

    // Find existing driver
    const existingDriver = await Driver.findById(id);
    
    if (!existingDriver) {
      // Delete uploaded files if driver not found
      if (req.files) {
        if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
        if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
      }
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Extract fields from request body
    const { 
      driverName, 
      phoneNumber,
      countryCode,
      licenseNumber,
      isActive,
      isVerified,
      rating
    } = req.body;

    // Check phone number uniqueness if being updated
    if (phoneNumber && (phoneNumber !== existingDriver.phoneNumber || 
        (countryCode && countryCode !== existingDriver.countryCode))) {
      
      const phoneQuery = countryCode 
        ? { phoneNumber, countryCode }
        : { phoneNumber, countryCode: existingDriver.countryCode };
      
      const existingPhoneDriver = await Driver.findOne({
        ...phoneQuery,
        _id: { $ne: id }
      });
      
      if (existingPhoneDriver) {
        // Delete uploaded files
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use by another driver'
        });
      }
    }

    // Check license number uniqueness if being updated
    if (licenseNumber && licenseNumber !== existingDriver.licenseNumber) {
      const existingLicenseDriver = await Driver.findOne({
        licenseNumber,
        _id: { $ne: id }
      });
      
      if (existingLicenseDriver) {
        // Delete uploaded files
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'License number already in use by another driver'
        });
      }
    }

    // Update basic fields
    const updateData = {};
    
    if (driverName) updateData.driverName = driverName;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (countryCode) updateData.countryCode = countryCode;
    if (licenseNumber) updateData.licenseNumber = licenseNumber;
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;
    if (isVerified !== undefined) updateData.isVerified = isVerified === 'true' || isVerified === true;
    if (rating !== undefined && !isNaN(parseFloat(rating))) {
      updateData.rating = parseFloat(rating);
    }

    // Handle profile image update
    if (req.files && req.files.profileImage && req.files.profileImage[0]) {
      try {
        // Delete old profile image from S3 if it exists
        if (existingDriver.profileImage?.key) {
          await deleteFromS3(existingDriver.profileImage.key).catch(err => 
            console.error('Error deleting old profile image:', err)
          );
        }
        
        // Set new profile image
        updateData.profileImage = {
          key: req.files.profileImage[0].key,
          url: getS3Url(req.files.profileImage[0].key),
          originalName: req.files.profileImage[0].originalname,
          mimeType: req.files.profileImage[0].mimetype,
          size: req.files.profileImage[0].size
        };
      } catch (imageError) {
        console.error('Error processing profile image:', imageError);
      }
    }

    // Handle license image update
    if (req.files && req.files.licenseImage && req.files.licenseImage[0]) {
      try {
        // Delete old license image from S3 if it exists
        if (existingDriver.licenseImage?.key) {
          await deleteFromS3(existingDriver.licenseImage.key).catch(err => 
            console.error('Error deleting old license image:', err)
          );
        }
        
        // Set new license image
        updateData.licenseImage = {
          key: req.files.licenseImage[0].key,
          url: getS3Url(req.files.licenseImage[0].key),
          originalName: req.files.licenseImage[0].originalname,
          mimeType: req.files.licenseImage[0].mimetype,
          size: req.files.licenseImage[0].size
        };
      } catch (imageError) {
        console.error('Error processing license image:', imageError);
      }
    }

    // Update the driver
    const updatedDriver = await Driver.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-refreshToken -__v');

    console.log('Driver updated successfully:', updatedDriver._id);

    res.status(200).json({
      success: true,
      message: 'Driver updated successfully',
      data: updatedDriver
    });

  } catch (error) {
    console.error('Update driver error:', error);
    
    // Clean up uploaded files if error occurs
    if (req.files) {
      if (req.files.profileImage) {
        await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
      }
      if (req.files.licenseImage) {
        await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
      }
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }

    // Handle duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `Driver with this ${field} already exists`,
        field: field
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating driver',
      error: error.message
    });
  }
});




/**
 * @route   POST /api/drivers/register
 * @desc    Register a new driver with profile and license images
 * @access  Public (requires OTP verification via phone)
 */
router.post('/register', authenticateToken,authorizeAdmin,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'licenseImage', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      const { 
        driverName, 
        phoneNumber,
        countryCode = '+966',
        licenseNumber,
        isVerified = false
      } = req.body;

      // Validate required fields
      if (!driverName || !phoneNumber || !licenseNumber) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Please provide driverName, phoneNumber, and licenseNumber'
        });
      }

      // Check if driver already exists
      const existingDriver = await Driver.findOne({ 
        $or: [
          { phoneNumber, countryCode },
          { licenseNumber }
        ]
      });
      
      if (existingDriver) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
        }
        
        let duplicateField = 'phone number';
        if (existingDriver.licenseNumber === licenseNumber) {
          duplicateField = 'license number';
        }
        
        return res.status(400).json({
          success: false,
          message: `Driver with this ${duplicateField} already exists`
        });
      }

      // Check if license image is uploaded (required)
      if (!req.files || !req.files.licenseImage) {
        if (req.files && req.files.profileImage) {
          await deleteFromS3(req.files.profileImage[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'License image is required'
        });
      }

      // Prepare driver data
      const driverData = {
        driverName,
        countryCode,
        phoneNumber,
        licenseNumber,
        licenseImage: {
          key: req.files.licenseImage[0].key,
          url: getS3Url(req.files.licenseImage[0].key),
          originalName: req.files.licenseImage[0].originalname,
          mimeType: req.files.licenseImage[0].mimetype,
          size: req.files.licenseImage[0].size
        },
        profileImage: null,
        isVerified: isVerified === 'true' || isVerified === true
      };

      // Add profile image if uploaded
      if (req.files.profileImage && req.files.profileImage[0]) {
        driverData.profileImage = {
          key: req.files.profileImage[0].key,
          url: getS3Url(req.files.profileImage[0].key),
          originalName: req.files.profileImage[0].originalname,
          mimeType: req.files.profileImage[0].mimetype,
          size: req.files.profileImage[0].size
        };
      }

      // Create new driver
      const newDriver = new Driver(driverData);
      const savedDriver = await newDriver.save();

      // Generate tokens
      const accessToken = generateAccessToken(savedDriver);
      const refreshToken = generateRefreshToken(savedDriver);

      savedDriver.refreshToken = refreshToken;
      await savedDriver.save();

      const driverProfile = savedDriver.getPublicProfile();

      res.status(201).json({
        success: true,
        message: 'Driver registered successfully',
        data: {
          driver: driverProfile,
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
          }
        }
      });
    } catch (error) {
      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.profileImage) {
          await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
        }
        if (req.files.licenseImage) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
        }
      }

      console.error('Register driver error:', error);
      
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: `Driver with this ${field} already exists`,
          field: field
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error registering driver',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /api/drivers/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    const driver = await Driver.findOne({ 
      _id: decoded.driverId,
      refreshToken: refreshToken 
    });

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    if (!driver.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Driver account is deactivated'
      });
    }

    const newAccessToken = generateAccessToken(driver);
    const newRefreshToken = generateRefreshToken(driver);

    driver.refreshToken = newRefreshToken;
    await driver.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/drivers/logout
 * @desc    Logout driver
 * @access  Private (Driver)
 */
router.post('/logout', verifyDriverToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const driver = await Driver.findOne({ refreshToken: refreshToken });
      if (driver) {
        driver.refreshToken = null;
        await driver.save();
      }
    } else {
      req.driver.refreshToken = null;
      await req.driver.save();
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
});

module.exports = router;