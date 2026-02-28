const express = require('express');
const Driver = require('../models/driver_model');
const DriverOTP = require('../models/driver_otp_model');
const { verifyDriverOTP } = require('../middleware/driver_otp_middleware');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const jwt = require('jsonwebtoken');
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
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d' }
  );
};

const generateRefreshToken = (driver) => {
  return jwt.sign(
    { driverId: driver._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};


// ============= OTP ROUTES =============

// Send OTP for driver login/registration
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+91', purpose = 'login' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // For login, check if driver exists
    if (purpose === 'login') {

        
      const existingDriver = await Driver.findOne({  countryCode, phoneNumber});
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

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+91', purpose = 'login' } = req.body;

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

// Verify OTP and login/register
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+91', otp, purpose = 'login' } = req.body;

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
          driverName: `Driver_${phoneNumber.slice(-4)}`,
          isVerified: true
        });
        await driver.save();
      }
    }

    // Update last login
    driver.lastLogin = new Date();
    
    // Generate tokens
    const accessToken = generateAccessToken(driver);
    const refreshToken = generateRefreshToken(driver);

    // Save refresh token
    driver.refreshToken = refreshToken;
    await driver.save();

    // Prepare response
    const response = {
      success: true,
      message: isNewDriver ? 'Registration successful' : 'Login successful',
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d',
      driver: driver.getPublicProfile(),
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

// Refresh token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find driver with this token
    const driver = await Driver.findOne({ 
      _id: decoded.driverId,
      refreshToken: refreshToken 
    });

    if (!driver) {
      return res.status(403).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(driver);
    const newRefreshToken = generateRefreshToken(driver);

    // Update refresh token
    driver.refreshToken = newRefreshToken;
    await driver.save();

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer'
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(403).json({
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

// Logout
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const accessToken = authHeader.split(' ')[1];
    
    // Verify token to get driver ID
    const decoded = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);
    
    // Remove refresh token
    await Driver.findByIdAndUpdate(decoded.driverId, {
      $unset: { refreshToken: 1 }
    });

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

// CREATE driver with complete details
router.post('/', upload.single('vehicleImage'), async (req, res) => {
  try {
    const { 
      driverName, 
      vehicleName, 
      modelName, 
      vehicleBrand, 
      vehicleCategory,
      email,
      phoneNumber,
      countryCode = '+91'
    } = req.body;

    // Validate required fields
    if (!driverName || !vehicleName || !modelName || !vehicleBrand || !vehicleCategory || !phoneNumber) {
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: driverName, vehicleName, modelName, vehicleBrand, vehicleCategory, phoneNumber'
      });
    }

    // Check if driver already exists
    const existingDriver = await Driver.findOne({ phoneNumber, countryCode });
    
    if (existingDriver) {
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(400).json({
        success: false,
        message: 'Driver with this phone number already exists'
      });
    }

    // Check vehicle image
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle image is required'
      });
    }

    // Create new driver
    const newDriver = new Driver({
      driverName,
      vehicleName,
      modelName,
      vehicleBrand,
      vehicleCategory,
      email: email || undefined,
      countryCode,
      phoneNumber,
      vehicleImage: {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      },
      isVerified: true
    });

    const savedDriver = await newDriver.save();

    // Generate tokens
    const accessToken = generateAccessToken(savedDriver);
    const refreshToken = generateRefreshToken(savedDriver);

    savedDriver.refreshToken = refreshToken;
    await savedDriver.save();

    res.status(201).json({
      success: true,
      message: 'Driver created successfully',
      data: {
        driver: savedDriver.getPublicProfile(),
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer'
        }
      }
    });
  } catch (error) {
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file:', err)
      );
    }

    console.error('Create driver error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating driver',
      error: error.message
    });
  }
});

// GET all drivers with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      vehicleCategory, 
      isActive, 
      isVerified,
      minRating,
      search,
      sort = '-createdAt',
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query
    let query = {};
    
    if (vehicleCategory) query.vehicleCategory = vehicleCategory;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (isVerified !== undefined) query.isVerified = isVerified === 'true';
    if (minRating) query.rating = { $gte: parseFloat(minRating) };
    
    // Search by name or phone
    if (search) {
      query.$or = [
        { driverName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { vehicleName: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const drivers = await Driver.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-refreshToken -__v');
    
    const total = await Driver.countDocuments(query);

    res.status(200).json({
      success: true,
      count: drivers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: drivers
    });
  } catch (error) {
    console.error('Fetch drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching drivers',
      error: error.message
    });
  }
});

// GET driver by ID
router.get('/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id)
      .select('-refreshToken -__v');
    
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
    console.error('Fetch driver error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching driver',
      error: error.message
    });
  }
});

// GET driver by phone number
router.get('/phone/:phoneNumber', async (req, res) => {
  try {
    const { countryCode = '+91' } = req.query;
    
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

// UPDATE driver
// UPDATE driver with complete details
router.put('/:id', upload.single('vehicleImage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      driverName, 
      vehicleName, 
      modelName, 
      vehicleBrand, 
      vehicleCategory,
      email,
      phoneNumber,
      countryCode = '+91',
      isActive,
    //   location,
    //   documents,
      rating
    } = req.body;

    // Find existing driver
    const driver = await Driver.findById(id);
    
    if (!driver) {
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
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
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use by another driver'
        });
      }
    }

    // Handle vehicle image update
    if (req.file) {
      try {
        // Delete old image from S3
        if (driver.vehicleImage?.key) {
          await deleteFromS3(driver.vehicleImage.key).catch(err => 
            console.error('Error deleting old image:', err)
          );
        }
        
        // Sanitize the original filename for S3 metadata
        // Remove any non-ASCII or special characters that cause header errors
        const sanitizedOriginalName = req.file.originalname
          .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
          .replace(/[<>"']/g, '')        // Remove XML/HTML special chars
          .replace(/[^\w\s.-]/g, '')      // Remove special characters
          .replace(/\s+/g, ' ')           // Normalize spaces
          .trim()
          .substring(0, 255);              // Limit length

        // If sanitized name is empty, use a default
        const metadataOriginalName = sanitizedOriginalName || 'vehicle_image.jpg';
        
        // Set new image with sanitized metadata
        driver.vehicleImage = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname, // Keep original for display
          mimeType: req.file.mimetype,
          size: req.file.size
        };

        // Update S3 metadata if you have access to the S3 client
        // This is optional - you can skip if you don't need metadata
        try {
          const { S3Client, CopyObjectCommand } = require('@aws-sdk/client-s3');
          const s3Client = new S3Client({
            region: process.env.AWS_REGION,
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
          });

          // Copy object to itself with new metadata
          const copyCommand = new CopyObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            CopySource: `${process.env.AWS_BUCKET_NAME}/${req.file.key}`,
            Key: req.file.key,
            Metadata: {
              originalname: metadataOriginalName,
              uploadedat: new Date().toISOString()
            },
            MetadataDirective: 'REPLACE'
          });
          
          await s3Client.send(copyCommand).catch(err => {
            console.log('Metadata update skipped - continuing without metadata');
          });
        } catch (metadataError) {
          // Ignore metadata errors - continue with upload
          console.log('Could not update metadata, but file uploaded successfully');
        }
        
      } catch (imageError) {
        console.error('Error processing image:', imageError);
        return res.status(500).json({
          success: false,
          message: 'Error processing vehicle image',
          error: imageError.message
        });
      }
    }

    // Update fields
    const updatableFields = [
      'driverName', 'vehicleName', 'modelName', 'vehicleBrand', 
      'vehicleCategory', 'email', 'phoneNumber', 'countryCode',
      'isActive', 'rating'
    ];
    
    updatableFields.forEach(field => {
      if (req.body[field] !== undefined) {
        driver[field] = req.body[field];
      }
    });

    // Handle location (if provided as JSON string)
    // if (location) {
    //   try {
    //     driver.location = typeof location === 'string' ? JSON.parse(location) : location;
    //   } catch (error) {
    //     console.error('Error parsing location:', error);
    //   }
    // }

    // // Handle documents (if provided as JSON string)
    // if (documents) {
    //   try {
    //     driver.documents = typeof documents === 'string' ? JSON.parse(documents) : documents;
    //   } catch (error) {
    //     console.error('Error parsing documents:', error);
    //   }
    // }

    // Save updated driver
    const updatedDriver = await driver.save();

    res.status(200).json({
      success: true,
      message: 'Driver updated successfully',
      data: updatedDriver.getPublicProfile()
    });

  } catch (error) {
    // Clean up uploaded file if error occurs
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file:', err)
      );
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
        message: 'Phone number already exists'
      });
    }

    // Handle header character error specifically
    if (error.message && error.message.includes('Invalid character in header content')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename. Please use only alphanumeric characters, dots, and hyphens in the filename.',
        error: 'Filename contains invalid characters'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating driver',
      error: error.message
    });
  }
});

// PATCH update phone number with OTP verification
router.patch('/:id/phone', async (req, res) => {
  try {
    const { newPhoneNumber, newCountryCode = '+91', otp } = req.body;
    
    if (!newPhoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'New phone number and OTP are required'
      });
    }
    
    // Verify OTP
    const otpDoc = await DriverOTP.findOne({
      phoneNumber: newPhoneNumber,
      countryCode: newCountryCode,
      otp,
      purpose: 'update-phone',
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });
    
    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }
    
    // Check if new phone number already exists
    const existingDriver = await Driver.findOne({
      phoneNumber: newPhoneNumber,
      countryCode: newCountryCode,
      _id: { $ne: req.params.id }
    });
    
    if (existingDriver) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already in use'
      });
    }
    
    // Update driver's phone number
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        phoneNumber: newPhoneNumber,
        countryCode: newCountryCode
      },
      { new: true, runValidators: true }
    ).select('-refreshToken -__v');
    
    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();
    
    res.status(200).json({
      success: true,
      message: 'Phone number updated successfully',
      data: driver
    });
  } catch (error) {
    console.error('Update phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating phone number',
      error: error.message
    });
  }
});

// DELETE driver
router.delete('/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    // Delete vehicle image from S3
    if (driver.vehicleImage?.key) {
      await deleteFromS3(driver.vehicleImage.key);
    }
    
    // Delete license image if exists
    if (driver.documents?.licenseImage?.key) {
      await deleteFromS3(driver.documents.licenseImage.key).catch(() => {});
    }
    
    // Delete aadhar image if exists
    if (driver.documents?.aadharImage?.key) {
      await deleteFromS3(driver.documents.aadharImage.key).catch(() => {});
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

// Update vehicle image only
router.patch('/:id/vehicle-image', upload.single('vehicleImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle image is required'
      });
    }
    
    const driver = await Driver.findById(req.params.id);
    
    if (!driver) {
      await deleteFromS3(req.file.key);
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    // Delete old image
    if (driver.vehicleImage?.key) {
      await deleteFromS3(driver.vehicleImage.key).catch(err => 
        console.error('Error deleting old image:', err)
      );
    }
    
    // Update with new image
    driver.vehicleImage = {
      key: req.file.key,
      url: getS3Url(req.file.key),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    };
    
    await driver.save();
    
    res.status(200).json({
      success: true,
      message: 'Vehicle image updated successfully',
      data: {
        vehicleImage: driver.vehicleImage
      }
    });
  } catch (error) {
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file:', err)
      );
    }
    
    console.error('Update vehicle image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating vehicle image',
      error: error.message
    });
  }
});

// Update driver location
router.patch('/:id/location', async (req, res) => {
  try {
    const { lat, long } = req.body;
    
    if (lat === undefined || long === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }
    
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      {
        location: {
          lat: parseFloat(lat),
          long: parseFloat(long),
          lastUpdated: new Date()
        }
      },
      { new: true }
    ).select('location driverName phoneNumber');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: driver.location
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message
    });
  }
});

// Get nearby drivers
router.get('/nearby/location', async (req, res) => {
  try {
    const { lat, long, maxDistance = 5000, limit = 10 } = req.query;
    
    if (!lat || !long) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }
    
    const drivers = await Driver.find({
      isActive: true,
      isVerified: true,
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(long), parseFloat(lat)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      }
    })
    .limit(parseInt(limit))
    .select('driverName vehicleName vehicleCategory vehicleImage.url location rating');
    
    res.status(200).json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Find nearby drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error finding nearby drivers',
      error: error.message
    });
  }
});

module.exports = router;