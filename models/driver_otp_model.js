const mongoose = require('mongoose');

const driverOtpSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true
  },
  countryCode: {
    type: String,
    required: true,
    default: '+91'
  },
  otp: {
    type: String,
    required: true
  },
  purpose: {
    type: String,
    enum: ['login', 'registration', 'update-phone'],
    default: 'login'
  },
  attempts: {
    type: Number,
    default: 0
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  }
}, {
  timestamps: true
});

// Index for automatic expiration
driverOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DriverOTP', driverOtpSchema);