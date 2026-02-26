const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  driverName: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  vehicleName: {
    type: String,
    required: [true, 'Vehicle name is required'],
    trim: true
  },
  modelName: {
    type: String,
    required: [true, 'Model name is required'],
    trim: true
  },
  vehicleBrand: {
    type: String,
    required: [true, 'Vehicle brand is required'],
    trim: true
  },
  vehicleCategory: {
    type: String,
    required: [true, 'Vehicle category is required'],
    // enum: ['sedan', 'suv', 'hatchback', 'luxury', 'mini', 'van', 'truck', 'bike'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
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
  vehicleImage: {
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
  location: {
    lat: Number,
    long: Number,
    lastUpdated: Date
  },
  documents: {
    licenseNumber: String,
    licenseImage: {
      key: String,
      url: String
    },
    aadharNumber: String,
    aadharImage: {
      key: String,
      url: String
    }
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