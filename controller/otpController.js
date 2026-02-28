const OTP = require('../models/otp_model');
const User = require('../models/users_model');
const twilio = require('twilio');
const jwt = require('jsonwebtoken');


const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Generate tokens
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { 
      userId: user._id,
      phoneNumber: user.phoneNumber,
      role: user.role 
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '1d' }
  );

  
  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Send OTP
const sendOTP = async (req, res) => {
  try {
    const { phoneNumber, countryCode, purpose = 'login' } = req.body;
    const otpCode = generateOTP();
    
    await OTP.deleteMany({ phoneNumber, countryCode, purpose, isUsed: false });
    
    await OTP.create({
      phoneNumber,
      countryCode,
      otp: otpCode,
      purpose
    });
    
    await client.messages.create({
      body: `Your OTP is: ${otpCode}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `${countryCode}${phoneNumber}`
    });
    
    res.json({ success: true, message: 'OTP sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Resend OTP
const resendOTP = async (req, res) => {
  try {
    const { phoneNumber, countryCode, purpose } = req.body;
    const newOTP = generateOTP();
    
    const otpDoc = await OTP.findOneAndUpdate(
      { phoneNumber, countryCode, purpose, isUsed: false },
      { 
        otp: newOTP,
        attempts: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      },
      { new: true }
    );
    
    if (!otpDoc) {
      return res.status(404).json({ success: false, message: 'No active OTP found' });
    }
    
    await client.messages.create({
      body: `Your new OTP is: ${newOTP}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: `${countryCode}${phoneNumber}`
    });
    
    res.json({ success: true, message: 'OTP resent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Verify OTP and return JWT tokens

const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, countryCode, otp, purpose } = req.body;
    
    console.log('Verifying OTP for:', { phoneNumber, countryCode, otp, purpose });

    // Find valid OTP
    const otpDoc = await OTP.findOne({
      phoneNumber,
      countryCode,
      purpose,
      otp,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }
    
    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();
    
    // DEBUG: Check the CORRECT environment variables
    console.log('=== ENVIRONMENT VARIABLES CHECK ===');
    console.log('JWT_ACCESS_SECRET exists:', !!process.env.JWT_ACCESS_SECRET);
    console.log('JWT_REFRESH_SECRET exists:', !!process.env.JWT_REFRESH_SECRET);
    console.log('JWT_ACCESS_SECRET length:', process.env.JWT_ACCESS_SECRET ? process.env.JWT_ACCESS_SECRET.length : 0);
    console.log('JWT_REFRESH_SECRET length:', process.env.JWT_REFRESH_SECRET ? process.env.JWT_REFRESH_SECRET.length : 0);
    console.log('NODE_ENV:', process.env.NODE_ENV);

    // Find user
    let user = await User.findOne({ phoneNumber, countryCode });
    
    // Handle based on purpose
    if (purpose === 'login') {
      // LOGIN: User must exist
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found. Please register first.' 
        });
      }
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
    } else if (purpose === 'registration') {
      // REGISTRATION: Create user if not exists
      if (!user) {
        const tempUsername = `user_${phoneNumber.slice(-4)}_${Date.now().toString().slice(-4)}`;
        
        user = await User.create({
          username: tempUsername,
          phoneNumber,
          countryCode,
          role: 'customer',
          isActive: true,
          lastLogin: new Date()
        });
        console.log('New user created:', user._id);
      } else {
        // User already exists
        user.lastLogin = new Date();
        await user.save();
      }
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid purpose' 
      });
    }
    
    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);
    
    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();
    
    // Return user data
    const userData = {
      _id: user._id,
      username: user.username,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLogin: user.lastLogin
    };
    
    res.json({
      success: true,
      message: 'OTP verified successfully',
      accessToken,
      refreshToken,
      user: userData
    });
    
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Refresh token endpoint
// Refresh token endpoint
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Refresh token required' });
    }
    
    console.log('=== REFRESH TOKEN DEBUG ===');
    console.log('Token received (first 20 chars):', token.substring(0, 20) + '...');
    console.log('JWT_REFRESH_SECRET exists:', !!process.env.JWT_REFRESH_SECRET);
    
    // Verify refresh token
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    console.log('Token verified. User ID:', decoded.userId);
    
    // Find user with this refresh token
    const user = await User.findOne({ 
      _id: decoded.userId,
      refreshToken: token 
    });
    
    if (!user) {
      console.log('User not found or token mismatch');
      console.log('Searched for userId:', decoded.userId);
      
      // Check if user exists at all
      const userExists = await User.findById(decoded.userId);
      console.log('User exists in DB:', !!userExists);
      
      if (userExists) {
        console.log('User found but refresh token mismatch');
        console.log('DB refresh token:', userExists.refreshToken ? userExists.refreshToken.substring(0, 20) + '...' : 'null');
      }
      
      return res.status(403).json({ success: false, message: 'Invalid refresh token' });
    }
    
    console.log('User found, generating new tokens');
    
    // Generate new tokens
    const newAccessToken = jwt.sign(
      { 
        userId: user._id,
        phoneNumber: user.phoneNumber,
        role: user.role 
      },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1d' }
    );
    
    const newRefreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    // Update refresh token in database
    user.refreshToken = newRefreshToken;
    await user.save();
    
    console.log('Tokens refreshed successfully');
    
    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
    
  } catch (error) {
    console.error('Refresh Token Error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ success: false, message: 'Invalid refresh token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ success: false, message: 'Refresh token expired' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Logout
const logout = async (req, res) => {
  try {
    const { userId } = req.user;
    
    await User.findByIdAndUpdate(userId, {
      $unset: { refreshToken: 1 }
    });
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { 
  sendOTP, 
  resendOTP, 
  verifyOTP,
  refreshToken,
  logout 
};