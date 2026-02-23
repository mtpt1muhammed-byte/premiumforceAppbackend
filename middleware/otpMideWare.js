// middleware/otpMiddleware.js
const OTP = require('../models/otp_model');

const verifyOTP = async (req, res, next) => {
  try {
    const { otp, phoneNumber, countryCode, purpose } = req.body;

    if (!otp || !phoneNumber || !countryCode || !purpose) {
      return res.status(400).json({
        success: false,
        message: 'OTP verification required: Please provide OTP, phone number, country code, and purpose'
      });
    }

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

    // Mark OTP as used
    otpRecord.isUsed = true;
    await otpRecord.save();

    // Attach verification info to request
    req.otpVerified = true;
    req.verifiedPhone = { countryCode, phoneNumber };
    
    next();
  } catch (error) {
    console.error('OTP Middleware Error:', error);
    return res.status(500).json({
      success: false,
      message: 'OTP verification failed'
    });
  }
};

module.exports = { verifyOTP };