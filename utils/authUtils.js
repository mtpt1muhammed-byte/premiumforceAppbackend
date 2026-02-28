const jwt = require('jsonwebtoken');
const crypto = require('crypto');


// Generate tokens
const generateTokens = (driver) => {
  const accessToken = jwt.sign(
    { 
      id: driver._id,
      phoneNumber: driver.phoneNumber,
      driverName: driver.driverName,
      type: 'driver'
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d' }
  );

  const refreshToken = jwt.sign(
    { id: driver._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );

  return { accessToken, refreshToken };
};

// Verify access token
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

// Generate random OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Check if OTP is expired
const isOTPExpired = (expiresAt) => {
  return new Date() > new Date(expiresAt);
};

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  generateOTP,
  isOTPExpired
};