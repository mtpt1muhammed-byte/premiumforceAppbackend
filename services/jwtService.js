// services/jwtService.js
const jwt = require('jsonwebtoken');

class JWTService {
    
  generateTokens(user) {
    const payload = {
      userId: user._id,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      role: user.role,
      username: user.username
    };

    const accessToken = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid access token');
    }
  }

  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  decodeToken(token) {
    return jwt.decode(token);
  }
}

module.exports = new JWTService();









// Send OTP
// bash
// POST http://localhost:3000/api/otp/send
// Content-Type: application/json

// {
//     "countryCode": "+91",
//     "phoneNumber": "9876543210",
//     "purpose": "registration"  // or "login" or "profile_update"
// }
// Verify OTP
// bash
// POST http://localhost:3000/api/otp/verify
// Content-Type: application/json

// {
//     "countryCode": "+91",
//     "phoneNumber": "9876543210",
//     "otp": "123456",
//     "purpose": "registration"
// }
// Resend OTP
// bash
// POST http://localhost:3000/api/otp/resend
// Content-Type: application/json

// {
//     "countryCode": "+91",
//     "phoneNumber": "9876543210",
//     "purpose": "registration"
// }