// server.js - CORRECTED VERSION

const path = require('path');
const dotenv = require('dotenv');

// Load .env file with explicit path
const result = dotenv.config({ path: path.join(__dirname, '.env') });

if (result.error) {
  console.error('Error loading .env file:', result.error);
  process.exit(1);
}

// Log to verify variables are loaded (remove in production)
console.log('✓ Environment variables loaded');
console.log('✓ PORT:', process.env.PORT);
console.log('✓ MONGODB_URI:', process.env.MONGODB_URI);
console.log('✓ AWS_REGION:', process.env.AWS_REGION);
console.log('✓ AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
console.log('✓ AWS_ACCESS_KEY_ID exists:', !!process.env.AWS_ACCESS_KEY_ID);


const jwt = require('jsonwebtoken');

const crypto = require('crypto');


const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// const itemRoutes = require('./routes/itemRoutes');
const userRoutes = require('./routes/userRoutes');
const otpRoutes = require('./routes/otpRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const driverRoutes = require('./routes/driverRoutes');
const assignDriverCar =require('./routes/assign_admin_driver_Routes');
const schedule = require("./schedule");

// const express = require('express');
const router = express.Router();
// Import car routes
const carRoutes = require('./routes/carRoutes');


const { OAuth2Client } = require('google-auth-library');

// const UserToken = require('./models/userToken'); 

// const tokenRoutes = require('./routes/tokenRoutes');
const User = require('./models/users_model');


const CityRoutes = require('./routes/cityRoutes');
const AirportsRoutes = require('./routes/airportsRoutes');

const adminRoutes = require('./routes/adminRoutes');

const cookieParser = require('cookie-parser'); // Add this

const bannerRoutes = require('./routes/bannerRoutes');

const categoryRoutes = require('./routes/categoryRoutes');

const modelRoutes = require('./routes/modelRoutes');
const terminalRoutes = require('./routes/terminalRoutes');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Add cookie parser middleware

// const crypto = require('crypto');
// const refreshSecret = crypto.randomBytes(64).toString('hex');
// console.log(refreshSecret);


// Log to verify environment variables are loaded (remove in production)
console.log('AWS Region:', process.env.AWS_REGION);
console.log('S3 Bucket:', process.env.AWS_S3_BUCKET_NAME);
console.log('AWS Key exists:', !!process.env.AWS_ACCESS_KEY_ID);




const admin = require('firebase-admin');

// --- 1. Initialize Firebase Admin SDK ---
// Load your downloaded service account key
// const serviceAccount = require('./serviceAccount.json'); // Update the path!

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   // Optional: If you use Realtime Database, add its URL here.
//   // databaseURL: "https://<YOUR_PROJECT_ID>.firebaseio.com"
// });
// console.log('Firebase Admin SDK Initialized.');



const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


router.post("/api/notification", async function (req, res) {
    try {
        const payload = {
            time: req.body.time,
            days: req.body.days,
            title: req.body.title,
            body: req.body.body,
        };
        await schedule.createSchedule(payload);
        res.json({
            data: {},
            message: "Success",
            success: true,
        });
    } catch (e) {
        res.status(400).json({ message: e.message, success: false});
    }
});


// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Routes
// app.use('/api/items', itemRoutes);
app.use('/api/users', userRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/bookings', bookingRoutes);

// Routes
app.use('/api/drivers', driverRoutes);

// Routes
app.use('/api/admin', assignDriverCar);



app.use('/api/users/admin', adminRoutes);


// Use car routes
app.use('/api/cars', carRoutes);

// app.use('/api/notifications', tokenRoutes); // Add token routes

app.use('/api/banners', bannerRoutes);


app.use('/api/airports', AirportsRoutes);

app.use('/api/categories', categoryRoutes);


app.use('/api/terminals', terminalRoutes);


app.use('/api/models', modelRoutes);


const brandRoutes = require('./routes/brandRoutes');
app.use('/api/brands', brandRoutes);


app.use('/api/cities', CityRoutes);


//google sign in 

// TODO: Replace with your actual Web Client ID from Google Cloud Console
// const WEB_CLIENT_ID = process.env.GOOGLE_SINGIN_CLIENT_ID; // e.g., 'your-web-client-id.apps.googleusercontent.com'
// const client = new OAuth2Client(WEB_CLIENT_ID);

// app.post('/auth/google', async (req, res) => {
//   const { idToken } = req.body; // The token sent from your Flutter app

//   if (!idToken) {
//     return res.status(400).json({ error: 'ID Token is required' });
//   }

//   try {
//     // Verify the ID token
//     const ticket = await client.verifyIdToken({
//       idToken: idToken,
//       audience: WEB_CLIENT_ID, // Specify the WEB_CLIENT_ID of your backend app
//     });

//     // If verification is successful, get the payload
//     const payload = ticket.getPayload();
    
//     // The payload contains user information
//     const userId = payload['sub']; // Google's unique ID for the user
//     const userEmail = payload['email'];
//     const userName = payload['name'];
//     const userPicture = payload['picture'];

//     console.log(`User verified: ${userId}, ${userEmail}`);

//     // At this point, the user is authenticated.
//     // You can now:
//     // 1. Find or create the user in your database.
//     // 2. Generate your own session token or JWT for future API requests.
//     // 3. Send this token back to the Flutter app.

//     // Example: Send a success response
//     res.status(200).json({
//       message: 'Authentication successful',
//       user: {
//         id: userId,
//         email: userEmail,
//         name: userName,
//         picture: userPicture,
//       },
//       // ... your app's session token
//     });

//   } catch (error) {
//     // If verification fails, an error is thrown.
//     console.error('Error verifying ID token:', error);
    
//     // A common error is "Invalid token signature", which can happen if the token is malformed, 
//     // from the wrong client, or if the wrong audience is used [citation:4].
//     res.status(401).json({ error: 'Invalid ID token' });
//   }
// });

// google sign in

// ============================================
// GOOGLE SIGN-IN WITH JWT IMPLEMENTATION
// ============================================

// Google OAuth client setup
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;
const client = new OAuth2Client(WEB_CLIENT_ID);


// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '15m'; // Access token expiry (short-lived)
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d'; // Refresh token expiry

// Helper function to generate tokens
const generateTokens = (user) => {
  // Access token payload
  const accessPayload = {
    userId: user._id || user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    provider: user.provider || 'google',
    role: user.role || 'customer'
  };

  // Refresh token payload (minimal info)
  const refreshPayload = {
    userId: user._id || user.id,
    tokenVersion: user.tokenVersion || 0
  };

  // Generate access token (short-lived)
  const accessToken = jwt.sign(
    accessPayload,
    JWT_SECRET,
    { 
      expiresIn: JWT_EXPIRY,
      issuer: 'your-app-name',
      audience: 'your-app-client'
    }
  );

  // Generate refresh token (long-lived)
  const refreshToken = jwt.sign(
    refreshPayload,
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRY }
  );

  return { accessToken, refreshToken };
};

// Helper function to find or create user from Google data
const findOrCreateUserFromGoogle = async (googlePayload) => {
  const { sub: googleId, email, name, picture, email_verified } = googlePayload;

  try {
    // Check if user exists by email or googleId
    let user = await User.findOne({ 
      $or: [
        { email: email },
        { googleId: googleId }
      ]
    });

    if (user) {
      // Update existing user with latest Google info
      user.googleId = user.googleId || googleId;
      user.name = user.name || name;
      user.picture = user.picture || picture;
      user.emailVerified = user.emailVerified || email_verified;
      user.lastLogin = new Date();
      user.provider = 'google';
      
      // Increment token version to invalidate old refresh tokens (optional security)
      // user.tokenVersion = (user.tokenVersion || 0) + 1;
      
      await user.save();
      console.log(`✅ Existing user updated: ${email}`);
    } else {
      // Create new user
      user = new User({
        googleId: googleId,
        email: email,
        name: name,
        picture: picture,
        emailVerified: email_verified,
        provider: 'google',
        role: 'user',
        lastLogin: new Date(),
        tokenVersion: 0
      });
      
      await user.save();
      console.log(`✅ New user created: ${email}`);
    }

    return user;
  } catch (error) {
    console.error('Error in findOrCreateUserFromGoogle:', error);
    throw error;
  }
};

// Middleware to verify JWT access token
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header provided' });
  }

  const token = authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'your-app-name',
      audience: 'your-app-client'
    });
    
    // Attach user info to request object
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// ============================================
// GOOGLE SIGN-IN ENDPOINT
// ============================================

/**
 * @route   POST /auth/google
 * @desc    Authenticate user with Google ID token
 * @access  Public
 */
app.post('/auth/google', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ 
      success: false,
      error: 'ID Token is required' 
    });
  }

  try {
    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: WEB_CLIENT_ID,
    });

    // Get Google user info
    const googlePayload = ticket.getPayload();
    
    // Find or create user in database
    const user = await findOrCreateUserFromGoogle(googlePayload);

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Prepare user response (exclude sensitive data)
    const userResponse = {
      id: user._id,
      googleId: user.googleId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      provider: user.provider,
      emailVerified: user.emailVerified
    };

    // Send success response with tokens
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: userResponse,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRY,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('❌ Google sign-in error:', error);
    
    // Handle specific error types
    if (error.message.includes('audience')) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid client ID configuration' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'Google token expired' 
      });
    }
    
    res.status(401).json({ 
      success: false,
      error: 'Invalid ID token',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================
// REFRESH TOKEN ENDPOINT
// ============================================

/**
 * @route   POST /auth/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
app.post('/auth/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ 
      success: false,
      error: 'Refresh token is required' 
    });
  }

  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    // Find user by ID from refresh token
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Optional: Check token version to invalidate old refresh tokens
    if (user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ 
        success: false,
        error: 'Refresh token has been revoked' 
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      tokens: {
        accessToken,
        refreshToken: newRefreshToken, // Rotate refresh token
        expiresIn: JWT_EXPIRY,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('❌ Refresh token error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        error: 'Refresh token expired' 
      });
    }
    
    res.status(401).json({ 
      success: false,
      error: 'Invalid refresh token' 
    });
  }
});

// ============================================
// LOGOUT ENDPOINT
// ============================================

/**
 * @route   POST /auth/logout
 * @desc    Logout user (optional: increment token version)
 * @access  Private
 */
app.post('/auth/logout', authenticateJWT, async (req, res) => {
  try {
    // Optional: Increment token version to invalidate all refresh tokens
    // await User.findByIdAndUpdate(req.user.userId, { 
    //   $inc: { tokenVersion: 1 } 
    // });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error during logout' 
    });
  }
});

// ============================================
// GET CURRENT USER PROFILE
// ============================================

/**
 * @route   GET /auth/me
 * @desc    Get current authenticated user info
 * @access  Private
 */
app.get('/auth/me', authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -__v');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});





app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working',
    timestamp: new Date().toISOString()
  });
});





const COOKIENAME = 'user_email';
const COOKIEEXPIRY = 7 * 24 * 60 * 60 * 1000; // 24 hours
// In-memory store for refresh tokens (use DB in production)


router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find admin by email (include password field for comparison)
    const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact super admin.'
      });
    }

    // Check password
    const isPasswordMatch = await admin.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate tokens
    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);

    // Save refresh token in database
    admin.refreshToken = refreshToken;
    await admin.save();

    // Prepare admin response (without sensitive data)
    const adminResponse = admin.toObject();
    delete adminResponse.refreshToken;
    delete adminResponse.password;

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      // secure: process.env.NODE_ENV === 'production', // Set secure flag in production
           secure: false, // Set secure flag in production
      sameSite: 'Strict',
      maxAge: COOKIEEXPIRY
    });

    // Return only access token in JSON response
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        admin: adminResponse,
        accessToken, // Only access token in response
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
      }
    });
  } catch (error) {
    console.error('Login admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
});


//admin resgistration

router.post('/register', async (req, res) => {
  try {
    const { email, password, role = 'admin' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }

    // Create with plain password - middleware will hash it
    const newAdmin = new Admin({
      email: email.toLowerCase(),
      password,  // Plain text - auto-hashed by pre-save
      role
    });

    const savedAdmin = await newAdmin.save();  // Triggers pre-save hashing

    // Generate tokens
    const accessToken = generateAccessToken(savedAdmin);
    const refreshToken = generateRefreshToken(savedAdmin);

    // Save refresh token in database
    savedAdmin.refreshToken = refreshToken;
    await savedAdmin.save();

    // Prepare admin response (without sensitive data)
    const adminResponse = savedAdmin.toObject();
    delete adminResponse.refreshToken;
    delete adminResponse.password;

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, refreshTokenCookieOptions);

    // Return only access token in JSON response
    res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      data: {
        admin: adminResponse,
        accessToken, // Only access token in response
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
      }
    });
  } catch (error) {
    console.error('Register admin error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error registering admin',
      error: error.message
    });
  }
});


// Root route
app.get('/', (req, res) => {
  res.json({ message: 'MongoDB CRUD API is running' });
});

// POST /api/save-token
app.post('/api/save-token', async (req, res) => {
  const { userId, fcmToken } = req.body;

  if (!userId || !fcmToken) {
    return res.status(400).json({ error: 'Missing userId or fcmToken' });
  }

  try {
    // Use findOneAndUpdate with upsert to either update an existing record or create a new one
    const updatedToken = await UserToken.findOneAndUpdate(
      { userId: userId },        // Filter to find the user
      { fcmToken: fcmToken },    // Update with the new token
      { new: true, upsert: true } // `new`: return the updated doc, `upsert`: create if doesn't exist
    );
    res.status(200).json({ success: true, data: updatedToken });
  } catch (error) {
    console.error('Error saving token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// app.listen(PORT, '0.0.0.0', () => {
//   console.log(`🚀 Server running on port ${PORT} on all interfaces`);
// });

