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

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'MongoDB CRUD API is running' });
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

