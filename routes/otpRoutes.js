const express = require('express');
const router = express.Router();
const { 
  sendOTP, 
  resendOTP, 
  verifyOTP,
  refreshToken,
  logout 
} = require('../controller/otpController');
const authMiddleware = require('../middleware/auth');

// Public routes
router.post('/send-otp', sendOTP);
router.post('/resend-otp', resendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/refresh-token', refreshToken);

// Protected routes
router.post('/logout', authMiddleware, logout);

// Test protected route
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-refreshToken');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
