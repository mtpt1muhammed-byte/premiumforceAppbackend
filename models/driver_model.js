const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  driverName: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    default: '+966'
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
    licenseNumber: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    trim: true
  },
    profileImage: {
    key: {
      type: String,
      required: false
    },
    url: {
      type: String,
      required: false
    },
    originalName: String,
    mimeType: String,
    size: Number
  },
  licenseImage: {
    key: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    originalName: String,
    mimeType: String,
    size: Number
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  refreshToken: {
    type: String,
    select: false
  },
  lastLogin: {
    type: Date
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  totalTrips: {
    type: Number,
    default: 0
  },
  earnings: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for faster queries
// driverSchema.index({ phoneNumber: 1 });
driverSchema.index({ isActive: 1, isVerified: 1 });
driverSchema.index({ location: '2dsphere' });

// Virtual for phone number with country code
driverSchema.virtual('fullPhoneNumber').get(function() {
  return `${this.countryCode}${this.phoneNumber}`;
});

// Method to return public profile
driverSchema.methods.getPublicProfile = function() {
  const driver = this.toObject();
  delete driver.refreshToken;
  delete driver.__v;
  return driver;
};

module.exports = mongoose.model('Driver', driverSchema);