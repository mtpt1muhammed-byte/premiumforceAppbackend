const DriverOTP = require('../models/driver_otp_model');

const verifyDriverOTP = async (req, res, next) => {
  try {
    const { phoneNumber, countryCode = '+91', otp, purpose } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    const otpDoc = await DriverOTP.findOne({
      phoneNumber,
      countryCode,
      otp,
      purpose: purpose || 'update-phone',
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Attach OTP document to request for potential use
    req.otpDoc = otpDoc;
    next();
  } catch (error) {
    console.error('OTP verification middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: error.message
    });
  }
};

module.exports = { verifyDriverOTP };