// routes/driverRoutes.js
const express = require('express');
const Driver = require('../models/driver_model');
const DriverOTP = require('../models/driver_otp_model');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const jwt = require('jsonwebtoken');
const {   authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAny,
  // New refresh token functions
 
 } = require('../middleware/adminmiddleware');
const twilio = require('twilio');

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

// ============= OTP ROUTES =============

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
      // Don't fail the request if SMS fails in development
      if (process.env.NODE_ENV === 'production') {
        throw smsError;
      }
    }

    // For development, return OTP in response
    const response = {
      success: true,
      message: 'OTP sent successfully'
    };

    if (process.env.NODE_ENV !== 'production') {
      response.otp = otpCode; // Only for testing
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
 * @route   POST /api/drivers/resend-otp
 * @desc    Resend OTP
 * @access  Public
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+966', purpose = 'login' } = req.body;

    // Find existing OTP
    const existingOTP = await DriverOTP.findOne({
      phoneNumber,
      countryCode,
      purpose,
      isUsed: false
    });

    if (!existingOTP) {
      return res.status(404).json({
        success: false,
        message: 'No active OTP found. Please request new OTP.'
      });
    }

    // Generate new OTP
    const newOTP = generateOTP();

    // Update OTP
    existingOTP.otp = newOTP;
    existingOTP.attempts = 0;
    existingOTP.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await existingOTP.save();

    // Send new OTP via SMS
    try {
      await twilioClient.messages.create({
        body: `Your new driver OTP is: ${newOTP}. Valid for 10 minutes.`,
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
      message: 'OTP resent successfully'
    };

    if (process.env.NODE_ENV !== 'production') {
      response.otp = newOTP;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resending OTP',
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
        // Create temporary driver record
        driver = new Driver({
          phoneNumber,
          countryCode,
          driverName: `Driver_${phoneNumber.slice(-4)}`
          // isVerified will be false until admin approval
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

    // Prepare response with both tokens (client will store them)
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

/**
 * @route   POST /api/drivers/refresh-token
 * @desc    Get new access token using refresh token from request body
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

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Find driver with this refresh token
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

    // Check if driver is still active
    if (!driver.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Driver account is deactivated'
      });
    }

    // Generate new tokens (token rotation)
    const newAccessToken = generateAccessToken(driver);
    const newRefreshToken = generateRefreshToken(driver);

    // Update refresh token in database (invalidate old one)
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
 * @access  Private
 */
router.post('/logout', verifyToken, async (req, res) => {
  try {
    // Get refresh token from request body
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Clear the specific refresh token from database
      const driver = await Driver.findOne({ refreshToken: refreshToken });
      if (driver) {
        driver.refreshToken = null;
        await driver.save();
      }
    } else {
      // If no refresh token provided, clear current driver's refresh token
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

// ============= DRIVER CRUD ROUTES =============

/**
 * @route   POST /api/drivers/register
 * @desc    Register a new driver with profile and license images
 * @access  Public (requires OTP verification)
 */
// POST /api/drivers/register - Register a new driver with profile and license images
// POST /api/drivers/register - Register a new driver (profile image optional, license image required)
// POST /api/drivers/register - Register a new driver (profile image optional)
router.post('/register', 
  authenticateToken, // Ensure the driver is authenticated via OTP
  authorizeAdmin,
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

      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      // Validate required fields
      if (!driverName || !phoneNumber || !licenseNumber) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.profileImage) {
            await deleteFromS3(req.files.profileImage[0].key);
          }
          if (req.files.licenseImage) {
            await deleteFromS3(req.files.licenseImage[0].key);
          }
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
        // Delete uploaded files
        if (req.files) {
          if (req.files.profileImage) {
            await deleteFromS3(req.files.profileImage[0].key);
          }
          if (req.files.licenseImage) {
            await deleteFromS3(req.files.licenseImage[0].key);
          }
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
        // Delete profile image if it was uploaded
        if (req.files && req.files.profileImage) {
          await deleteFromS3(req.files.profileImage[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'License image is required'
        });
      }

      // Prepare driver data with explicit null for profileImage
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
        // Explicitly set profileImage to null by default
        profileImage: null,
        isVerified: isVerified === 'true' || isVerified === true
      };

      // Add profile image if uploaded (optional) - this will override the null
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

      // Get public profile which will show profileImage as null if not provided
      const driverProfile = savedDriver.getPublicProfile();

      // Prepare response message
      const responseMessage = req.files.profileImage 
        ? 'Driver registered successfully with profile image'
        : 'Driver registered successfully (profile image not provided)';

      res.status(201).json({
        success: true,
        message: responseMessage,
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
          await deleteFromS3(req.files.profileImage[0].key).catch(err => 
            console.error('Error deleting profile image:', err)
          );
        }
        if (req.files.licenseImage) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(err => 
            console.error('Error deleting license image:', err)
          );
        }
      }

      console.error('Register driver error:', error);
      
      if (error.code === 11000) {
        // Check which field caused the duplicate key error
        const field = Object.keys(error.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: `Driver with this ${field} already exists`,
          field: field
        });
      }

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

      res.status(500).json({
        success: false,
        message: 'Error registering driver',
        error: error.message
      });
    }
  }
);




// ✅ SPECIFIC ROUTES FIRST - WITH DEBUG LOGS
router.get('/all', verifyToken, authorizeAdmin, async (req, res) => {
  console.log('🔥🔥🔥 /all ROUTE IS EXECUTING! 🔥🔥🔥');
  console.log('Full URL:', req.originalUrl);
  console.log('Params:', req.params);
  console.log('Query:', req.query);
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const drivers = await Driver.find()
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .select('-refreshToken -__v -password');

    const total = await Driver.countDocuments();

    res.status(200).json({
      success: true,
      data: drivers,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ PARAMETERIZED ROUTES LAST - WITH DEBUG LOGS
router.get('/:id', verifyToken, authorizeAdmin, async (req, res) => {
  console.log('🔍🔍🔍 /:id ROUTE IS EXECUTING! 🔍🔍🔍');
  console.log('ID received:', req.params.id);
  console.log('Full URL:', req.originalUrl);
  
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }
    res.json({ success: true, data: driver });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ OTHER SPECIFIC ROUTES
router.get('/stats', verifyToken, authorizeAdmin, async (req, res) => {
  // Your stats route
});

// ✅ PARAMETERIZED ROUTES LAST

/**
 * @route   GET /api/drivers/profile
 * @desc    Get current driver profile
 * @access  Private
 */
router.get('/profile', verifyToken,authorizeAdmin, async (req, res) => {
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

/**
 * @route   GET /api/drivers/:id
 * @desc    Get driver by ID
 * @access  Private
 */
// router.get('/:id', verifyToken,authorizeAdmin, async (req, res) => {
//   try {
//     const driver = await Driver.findById(req.params.id)
//       .select('-refreshToken -__v');
    
//     if (!driver) {
//       return res.status(404).json({
//         success: false,
//         message: 'Driver not found'
//       });
//     }
    
//     res.status(200).json({
//       success: true,
//       data: driver
//     });
//   } catch (error) {
//     console.error('Fetch driver error:', error);
//     if (error.name === 'CastError') {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid driver ID format'
//       });
//     }
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching driver',
//       error: error.message
//     });
//   }
// });

/**
 * @route   GET /api/drivers/phone/:phoneNumber
 * @desc    Get driver by phone number
 * @access  Private
 */
router.get('/phone/:phoneNumber', verifyToken,authorizeAdmin, async (req, res) => {
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

/**
 * @route   PUT /api/drivers/:id
 * @desc    Update driver details
 * @access  Private
 */
router.put('/:id', verifyToken, upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'licenseImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      driverName, 
      phoneNumber,
      countryCode,
      licenseNumber,
      isActive,
      isVerified,
      rating
    } = req.body;

    // Find existing driver
    const driver = await Driver.findById(id);
    
    if (!driver) {
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

    // Check permissions - only the driver themselves or admin can update
    if (req.driver.role !== 'admin' && req.driver._id.toString() !== id) {
      // Delete uploaded files if not authorized
      if (req.files) {
        if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
        if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
      }
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this driver'
      });
    }

    // Check phone number uniqueness if being updated
    if (phoneNumber && (phoneNumber !== driver.phoneNumber || countryCode !== driver.countryCode)) {
      const existingDriver = await Driver.findOne({
        phoneNumber,
        countryCode,
        _id: { $ne: id }
      });
      
      if (existingDriver) {
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
    if (licenseNumber && licenseNumber !== driver.licenseNumber) {
      const existingDriver = await Driver.findOne({
        licenseNumber,
        _id: { $ne: id }
      });
      
      if (existingDriver) {
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

    // Handle profile image update
    if (req.files && req.files.profileImage) {
      try {
        // Delete old profile image from S3
        if (driver.profileImage?.key) {
          await deleteFromS3(driver.profileImage.key).catch(err => 
            console.error('Error deleting old profile image:', err)
          );
        }
        
        // Set new profile image
        driver.profileImage = {
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
    if (req.files && req.files.licenseImage) {
      try {
        // Delete old license image from S3
        if (driver.licenseImage?.key) {
          await deleteFromS3(driver.licenseImage.key).catch(err => 
            console.error('Error deleting old license image:', err)
          );
        }
        
        // Set new license image
        driver.licenseImage = {
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

    // Update fields
    const updatableFields = [
      'driverName', 'phoneNumber', 'countryCode', 'licenseNumber',
      'isActive', 'isVerified', 'rating'
    ];
    
    updatableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        // Only admin can change verification status
        if ((field === 'isVerified' || field === 'isActive') && req.driver.role !== 'admin') {
          return;
        }
        driver[field] = req.body[field];
      }
    });

    // Save updated driver
    const updatedDriver = await driver.save();

    res.status(200).json({
      success: true,
      message: 'Driver updated successfully',
      data: updatedDriver.getPublicProfile()
    });

  } catch (error) {
    // Clean up uploaded files if error occurs
    if (req.files) {
      if (req.files.profileImage) {
        await deleteFromS3(req.files.profileImage[0].key).catch(err => 
          console.error('Error deleting profile image:', err)
        );
      }
      if (req.files.licenseImage) {
        await deleteFromS3(req.files.licenseImage[0].key).catch(err => 
          console.error('Error deleting license image:', err)
        );
      }
    }

    console.error('Update driver error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number or license number already exists'
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
 * @route   PATCH /api/drivers/:id/verify
 * @desc    Verify driver (admin only)
 * @access  Private (Admin only)
 */
router.patch('/:id/verify', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.driver.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can verify drivers'
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { isVerified: true },
      { new: true }
    ).select('-refreshToken -__v');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Driver verified successfully',
      data: driver
    });
  } catch (error) {
    console.error('Verify driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying driver',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/drivers/:id
 * @desc    Delete driver
 * @access  Private (Admin only)
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.driver.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete driver accounts'
      });
    }

    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    // Delete profile image from S3
    if (driver.profileImage?.key) {
      await deleteFromS3(driver.profileImage.key).catch(() => {});
    }
    
    // Delete license image from S3
    if (driver.licenseImage?.key) {
      await deleteFromS3(driver.licenseImage.key).catch(() => {});
    }
    
    // Delete driver
    await Driver.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Driver deleted successfully'
    });
  } catch (error) {
    console.error('Delete driver error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting driver',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/drivers/:id/toggle-status
 * @desc    Activate/deactivate driver (admin only)
 * @access  Private (Admin only)
 */
router.patch('/:id/toggle-status', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.driver.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can change driver status'
      });
    }

    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Toggle isActive status
    driver.isActive = !driver.isActive;
    await driver.save();

    res.status(200).json({
      success: true,
      message: `Driver ${driver.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        _id: driver._id,
        driverName: driver.driverName,
        isActive: driver.isActive
      }
    });
  } catch (error) {
    console.error('Toggle driver status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling driver status',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/drivers/:id/rating
 * @desc    Update driver rating
 * @access  Private
 */
router.patch('/:id/rating', verifyToken, async (req, res) => {
  try {
    const { rating } = req.body;

    if (rating === undefined || rating < 0 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 0 and 5'
      });
    }

    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Simple average rating calculation
    driver.rating = parseFloat(rating);
    await driver.save();

    res.status(200).json({
      success: true,
      message: 'Rating updated successfully',
      data: {
        rating: driver.rating
      }
    });
  } catch (error) {
    console.error('Update rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating rating',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/drivers/:id/trips
 * @desc    Increment total trips count
 * @access  Private
 */
router.patch('/:id/trips', verifyToken, async (req, res) => {
  try {
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { $inc: { totalTrips: 1 } },
      { new: true }
    ).select('driverName totalTrips');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Trips count updated',
      data: driver
    });
  } catch (error) {
    console.error('Update trips error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating trips count',
      error: error.message
    });
  }
});

/**
 * @route   PATCH /api/drivers/:id/earnings
 * @desc    Update driver earnings
 * @access  Private
 */
router.patch('/:id/earnings', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;

    if (amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required'
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { $inc: { earnings: parseFloat(amount) } },
      { new: true }
    ).select('driverName earnings');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Earnings updated',
      data: driver
    });
  } catch (error) {
    console.error('Update earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating earnings',
      error: error.message
    });
  }
});

module.exports = router;