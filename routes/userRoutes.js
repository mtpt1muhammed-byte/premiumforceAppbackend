// routes/users.js
const express = require('express');
const User = require('../models/users_model');
const { verifyOTP } = require('../middleware/otpMideWare');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');


const jwt = require('jsonwebtoken');

const router = express.Router();






// Add this protected route for updating phone number
// PATCH /api/users/:id/phone - Update phone number (OTP protected)
router.patch('/:id/phone', verifyOTP, upload.none(), async (req, res) => {
  try {
    const { newPhoneNumber, newCountryCode } = req.body;
    
    if (!newPhoneNumber || !newCountryCode) {
      return res.status(400).json({
        success: false,
        message: 'New phone number and country code required'
      });
    }

    // Check if new phone number already exists
    const existingUser = await User.findOne({ 
      countryCode: newCountryCode, 
      phoneNumber: newPhoneNumber,
      _id: { $ne: req.params.id }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already in use'
      });
    }

    // Update user's phone number
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      {
        countryCode: newCountryCode,
        phoneNumber: newPhoneNumber
      },
      { new: true, runValidators: true }
    ).select('-__v');

    res.status(200).json({
      success: true,
      message: 'Phone number updated successfully',
      data: updatedUser
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



// ============= CREATE with Profile Image =============
// POST /api/users - Create a new user with profile image
// router.post('/', upload.single('profileImage'), async (req, res) => {
//   try {
//     const { username, email, countryCode, phoneNumber, lat, long, specialId, role } = req.body;

//     // Validation........
//     if (!username || !countryCode || !phoneNumber) {
//       // If file was uploaded but validation fails, delete it from S3
//       if (req.file) {
//         await deleteFromS3(req.file.key);
//       }
//       return res.status(400).json({ 
//         message: 'Please provide username, countryCode and phoneNumber' 
//       });
//     }

//     // Check if user already exists
//     const existingUser = await User.findOne({ 
//       $or: [
//         { username },
//         { phoneNumber },
//         { email: email || '' }
//       ]
//     });

//     if (existingUser) {
//       if (req.file) {
//         await deleteFromS3(req.file.key);
//       }
//       return res.status(400).json({ 
//         message: 'User with this username, email or phone number already exists' 
//       });
//     }

//     // Check if profile image was uploaded
//     if (!req.file) {
//       return res.status(400).json({ 
//         message: 'Profile image is required' 
//       });
//     }

//     // Create new user with profile image data
//     const newUser = new User({
//       username,
//       email: email || undefined,
//       countryCode,
//       phoneNumber,
//       profileImage: {
//         key: req.file.key,
//         url: getS3Url(req.file.key),
//         originalName: req.file.originalname,
//         mimeType: req.file.mimetype,
//         size: req.file.size
//       },
//       location: {
//         lat: lat ? parseFloat(lat) : undefined,
//         long: long ? parseFloat(long) : undefined
//       },
//       specialId: specialId || undefined,
//       role: role || 'user'
//     });

//     const savedUser = await newUser.save();

//     res.status(201).json({
//       success: true,
//       message: 'User created successfully',
//       data: savedUser
//     });
//   } catch (error) {
//     // If error occurs and file was uploaded, delete it from S3
//     if (req.file) {
//       await deleteFromS3(req.file.key).catch(err => 
//         console.error('Error deleting file after failed user creation:', err)
//       );
//     }

//     console.error('Create user error:', error);
    
//     // Handle duplicate key error
//     if (error.code === 11000) {
//       return res.status(400).json({ 
//         success: false,
//         message: 'Duplicate field value entered' 
//       });
//     }

//     res.status(500).json({ 
//       success: false,
//       message: 'Error creating user', 
//       error: error.message 
//     });
//   }
// });








const generateAccessToken = (user) => {
  return jwt.sign(
    { 
      userId: user._id, 
      username: user.username,
      role: user.role 
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' } // 15 minutes default
  );
};

// Generate refresh token (long-lived)
const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' } // 7 days default
  );
};

router.post('/', upload.single('profileImage'), async (req, res) => {
  try {
    const { username, email, countryCode, phoneNumber, lat, long, specialId, role } = req.body;

    // Validation........
    if (!username || !countryCode || !phoneNumber) {
      // If file was uploaded but validation fails, delete it from S3
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(400).json({ 
        success: false,
        message: 'Please provide username, countryCode and phoneNumber' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [
        { username },
        { phoneNumber },
        { email: email || '' }
      ]
    });

    if (existingUser) {
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(400).json({ 
        success: false,
        message: 'User with this username, email or phone number already exists' 
      });
    }

    // Check if profile image was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'Profile image is required' 
      });
    }

    // Create new user with profile image data
    const newUser = new User({
      username,
      email: email || undefined,
      countryCode,
      phoneNumber,
      profileImage: {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      },
      location: {
        lat: lat ? parseFloat(lat) : undefined,
        long: long ? parseFloat(long) : undefined
      },
      specialId: specialId || undefined,
      role: role || 'user'
    });

    const savedUser = await newUser.save();

    // Generate tokens
    const accessToken = generateAccessToken(savedUser);
    const refreshToken = generateRefreshToken(savedUser);

    // Save refresh token to user (optional - if you want to store in database)
    savedUser.refreshToken = refreshToken;
    await savedUser.save();

    // Remove sensitive data from response
    const userResponse = savedUser.toObject();
    delete userResponse.refreshToken; // if you stored it
    delete userResponse.__v;

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user: userResponse,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
        }
      }
    });
  } catch (error) {
    // If error occurs and file was uploaded, delete it from S3
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file after failed user creation:', err)
      );
    }

    console.error('Create user error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        message: 'Duplicate field value entered' 
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Error creating user', 
      error: error.message 
    });
  }
});



// ============= GET ALL USERS =============
// GET /api/users - Get all users with filtering and sorting
router.get('/', async (req, res) => {
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
    else if (sort === 'username') sortOption.username = 1;
    else sortOption.createdAt = -1; // Default: newest first
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const users = await User.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v');
    
    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: users
    });
  } catch (error) {
    console.error('Fetch all users error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching users', 
      error: error.message 
    });
  }
});

// ============= GET USER BY ID =============
// GET /api/users/:id - Get user profile by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-__v');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Fetch user error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error fetching user', 
      error: error.message 
    });
  }
});

// ============= GET USER PROFILE (by phoneNumber) =============
// GET /api/users/profile/:phoneNumber - Get user profile by phone number
router.get('/profile/:phoneNumber', async (req, res) => {
  try {
    const { countryCode } = req.query;
    let query = { phoneNumber: req.params.phoneNumber };
    
    if (countryCode) {
      query.countryCode = countryCode;
    }
    
    const user = await User.findOne(query).select('-__v');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Fetch user profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching user profile', 
      error: error.message 
    });
  }
});

// ============= UPDATE USER =============
// PUT /api/users/:id - Update user (with optional new profile image)
// ============= UPDATE USER - SIMPLIFIED (NO VALIDATION) =============
// PUT /api/users/:id - Update user with any fields provided
// ============= UPDATE USER - WITH DUPLICATE HANDLING =============
// PUT /api/users/:id - Update user (allows same data for same user, prevents duplicates across different users)
router.put('/:id', upload.single('profileImage'), async (req, res) => {
  try {
    const { username, email, phoneNumber } = req.body;
    
    // Get all fields from request body
    const updateFields = { ...req.body };
    
    // Find the user we want to update
    const userToUpdate = await User.findById(req.params.id);
    
    if (!userToUpdate) {
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    // CHECK FOR DUPLICATES (only if fields are being changed)
    const duplicateChecks = [];
    
    // Check username duplicate (if username is being changed)
    if (username && username !== userToUpdate.username) {
      duplicateChecks.push(
        User.findOne({ username, _id: { $ne: req.params.id } })
          .then(user => user ? 'username' : null)
      );
    }
    
    // Check email duplicate (if email is being changed and not empty)
    if (email && email !== userToUpdate.email) {
      duplicateChecks.push(
        User.findOne({ email, _id: { $ne: req.params.id } })
          .then(user => user ? 'email' : null)
      );
    }
    
    // Check phoneNumber duplicate (if phoneNumber is being changed)
    if (phoneNumber && phoneNumber !== userToUpdate.phoneNumber) {
      duplicateChecks.push(
        User.findOne({ phoneNumber, _id: { $ne: req.params.id } })
          .then(user => user ? 'phoneNumber' : null)
      );
    }
    
    // Wait for all duplicate checks
    const duplicateResults = await Promise.all(duplicateChecks);
    const duplicates = duplicateResults.filter(result => result !== null);
    
    if (duplicates.length > 0) {
      // If duplicates found and new file was uploaded, delete it
      if (req.file) {
        await deleteFromS3(req.file.key);
      }
      
      return res.status(400).json({
        success: false,
        message: `Duplicate field(s) already exist: ${duplicates.join(', ')}`,
        duplicates: duplicates
      });
    }
    
    // Handle profile image if uploaded
    if (req.file) {
      // Delete old profile image if exists
      if (userToUpdate.profileImage?.key) {
        await deleteFromS3(userToUpdate.profileImage.key).catch(err => 
          console.error('Error deleting old profile image:', err)
        );
      }
      
      // Add new profile image data
      updateFields.profileImage = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };
    }
    
    // Handle location object if lat/long provided
    if (req.body.lat || req.body.long) {
      updateFields.location = {
        lat: req.body.lat ? parseFloat(req.body.lat) : userToUpdate.location?.lat,
        long: req.body.long ? parseFloat(req.body.long) : userToUpdate.location?.long
      };
    }
    
    // Parse boolean values
    if (updateFields.isActive === 'true') updateFields.isActive = true;
    if (updateFields.isActive === 'false') updateFields.isActive = false;
    
    // Remove undefined fields
    Object.keys(updateFields).forEach(key => 
      updateFields[key] === undefined && delete updateFields[key]
    );
    
    // Remove protected fields
    delete updateFields._id;
    delete updateFields.__v;
    delete updateFields.createdAt;
    
    console.log('Updating user with fields:', updateFields);
    
    // Check if there's anything to update
    if (Object.keys(updateFields).length === 0 && !req.file) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected - user data is already up to date',
        data: userToUpdate
      });
    }
    
    // Update user with provided fields only
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { 
        new: true,
        runValidators: false
      }
    ).select('-__v');
    
    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
      updated: Object.keys(updateFields)
    });
    
  } catch (error) {
    // If error occurs and new file was uploaded, delete it
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file after failed update:', err)
      );
    }
    
    console.error('Update user error:', error);
    
    // Handle invalid ID format
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Error updating user', 
      error: error.message 
    });
  }
});



// ============= DELETE USER =============
// DELETE /api/users/:id - Delete user and their profile image
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    // Delete profile image from S3
    if (user.profileImage?.key) {
      await deleteFromS3(user.profileImage.key);
    }
    
    // Delete user from database
    await User.findByIdAndDelete(req.params.id);
    
    res.status(200).json({ 
      success: true,
      message: 'User deleted successfully' 
    });
  } catch (error) {
    console.error('Delete user error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error deleting user', 
      error: error.message 
    });
  }
});

// ============= UPDATE PROFILE IMAGE ONLY =============
// PATCH /api/users/:id/profile-image - Update only profile image
router.patch('/:id/profile-image', upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'Profile image is required' 
      });
    }
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      await deleteFromS3(req.file.key);
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    // Delete old profile image
    if (user.profileImage?.key) {
      await deleteFromS3(user.profileImage.key).catch(err => 
        console.error('Error deleting old profile image:', err)
      );
    }
    
    // Update with new profile image
    user.profileImage = {
      key: req.file.key,
      url: getS3Url(req.file.key),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    };
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    if (req.file) {
      await deleteFromS3(req.file.key).catch(err => 
        console.error('Error deleting file after failed update:', err)
      );
    }
    
    console.error('Update profile image error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error updating profile image', 
      error: error.message 
    });
  }
});

// ============= GET USER PROFILE IMAGE =============
// GET /api/users/:id/profile-image - Get user profile image URL
router.get('/:id/profile-image', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('profileImage');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    if (!user.profileImage) {
      return res.status(404).json({ 
        success: false,
        message: 'Profile image not found' 
      });
    }
    
    res.status(200).json({
      success: true,
      data: user.profileImage
    });
  } catch (error) {
    console.error('Fetch profile image error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error fetching profile image', 
      error: error.message 
    });
  }
});


module.exports = router;