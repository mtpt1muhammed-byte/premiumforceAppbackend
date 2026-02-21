// routes/otpRoutes.js
const express = require('express');
const router = express.Router();
const OTP = require('../models/otp_model');
const User = require('../models/users_model');
const fast2smsService = require('../services/fast2smsService');

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ============= SEND OTP =============
// POST /api/otp/send - Send OTP to phone number
router.post('/send', async (req, res) => {
  try {
    const { countryCode, phoneNumber, purpose } = req.body;

    // Validation
    if (!countryCode || !phoneNumber || !purpose) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and purpose are required'
      });
    }

    // Validate purpose
    if (!['registration', 'login', 'profile_update'].includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid purpose. Must be registration, login, or profile_update'
      });
    }

    // Check if user exists based on purpose
    const existingUser = await User.findOne({ countryCode, phoneNumber });

    if (purpose === 'registration' && existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    if (purpose === 'login' && !existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number not registered'
      });
    }

    // Mark old OTPs as used
    await OTP.updateMany(
      { countryCode, phoneNumber, purpose, isUsed: false },
      { isUsed: true }
    );

    // Generate and save new OTP
    const otp = generateOTP();
    const otpRecord = await OTP.create({
      countryCode,
      phoneNumber,
      otp,
      purpose
    });

    // Send OTP via Fast2SMS
    const smsResult = await fast2smsService.sendOTP(phoneNumber, countryCode, otp, purpose);

    if (smsResult.success) {
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        // Include OTP in development only (remove in production)
        ...(process.env.NODE_ENV === 'development' && { otp, otpId: otpRecord._id })
      });
    } else {
      // Delete OTP record if SMS failed
      await OTP.findByIdAndDelete(otpRecord._id);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP',
        error: smsResult.error
      });
    }
  } catch (error) {
    console.error('Send OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============= VERIFY OTP =============
// POST /api/otp/verify - Verify OTP
router.post('/verify', async (req, res) => {
  try {
    const { countryCode, phoneNumber, otp, purpose } = req.body;

    // Validation
    if (!countryCode || !phoneNumber || !otp || !purpose) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, OTP, and purpose are required'
      });
    }

    // Find OTP record
    const otpRecord = await OTP.findOne({
      countryCode,
      phoneNumber,
      otp,
      purpose,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Check attempts
    if (otpRecord.attempts >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Maximum attempts exceeded. Please request new OTP'
      });
    }

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Find user if exists
    const user = await User.findOne({ countryCode, phoneNumber });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        purpose,
        isExistingUser: !!user,
        ...(user && { userId: user._id, username: user.username })
      }
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============= RESEND OTP =============
// POST /api/otp/resend - Resend OTP
router.post('/resend', async (req, res) => {
  try {
    const { countryCode, phoneNumber, purpose } = req.body;

    // Validation
    if (!countryCode || !phoneNumber || !purpose) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and purpose are required'
      });
    }

    // Mark old OTPs as used
    await OTP.updateMany(
      { countryCode, phoneNumber, purpose, isUsed: false },
      { isUsed: true }
    );

    // Generate and save new OTP
    const otp = generateOTP();
    const otpRecord = await OTP.create({
      countryCode,
      phoneNumber,
      otp,
      purpose
    });

    // Send OTP via Fast2SMS
    const smsResult = await fast2smsService.sendOTP(phoneNumber, countryCode, otp, purpose);

    if (smsResult.success) {
      return res.status(200).json({
        success: true,
        message: 'OTP resent successfully',
        ...(process.env.NODE_ENV === 'development' && { otp, otpId: otpRecord._id })
      });
    } else {
      await OTP.findByIdAndDelete(otpRecord._id);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP',
        error: smsResult.error
      });
    }
  } catch (error) {
    console.error('Resend OTP Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;