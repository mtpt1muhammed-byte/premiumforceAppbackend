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




const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const itemRoutes = require('./routes/itemRoutes');
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

// const UserToken = require('./models/userToken'); 

// const tokenRoutes = require('./routes/tokenRoutes');



dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const crypto = require('crypto');
const refreshSecret = crypto.randomBytes(64).toString('hex');
console.log(refreshSecret);


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
app.use('/api/items', itemRoutes);
app.use('/api/users', userRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/bookings', bookingRoutes);

// Routes
app.use('/api/drivers', driverRoutes);

// Routes
app.use('/api/admin', assignDriverCar);



// Use car routes
app.use('/api/cars', carRoutes);

// app.use('/api/notifications', tokenRoutes); // Add token routes




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

