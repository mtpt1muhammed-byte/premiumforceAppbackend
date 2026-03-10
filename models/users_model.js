// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  refreshToken: {
    type: String,
    default: null
  },
  
  username: {
    type: String,
    required: [true, 'Username is required'],
    trim: true,
    // NO unique:true here
    minlength: [3, 'Username must be at least 3 characters long'],
    maxlength: [50, 'Username cannot exceed 50 characters']
  },
  
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    // NO unique:true here - we'll define in schema.index
    validate: {
      validator: function(v) {
        return !v || /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: 'Please enter a valid email'
    }
  },
  
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    trim: true,
    maxlength: [5, 'Country code cannot exceed 5 characters']
  },
  
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    // NO unique:true here - we'll define in schema.index
    validate: {
      validator: function(v) {
        return /^[0-9]{5,15}$/.test(v);
      },
      message: 'Phone number must contain 5-15 digits'
    }
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
    size: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  
  location: {
    lat: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    long: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  },
  
  specialId: {
    type: String,
    trim: true,
    sparse: true
  },
  
  role: {
    type: String,
    enum: ['customer', 'admin', 'driver'],
    default: 'customer'
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  lastLogin: {
    type: Date
  },
  
  fcmToken: { 
    type: String, 
    default: null 
  },
  
}, {
  timestamps: true
});

// Virtual for full phone number with country code
userSchema.virtual('fullPhoneNumber').get(function() {
  return `${this.countryCode}${this.phoneNumber}`;
});

// Ensure virtuals are included in JSON output
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// Define indexes here - ONLY ONCE
// Only email and phoneNumber should be unique
userSchema.index({ phoneNumber: 1 }, { unique: true });
// userSchema.index({ email: 1 }, { unique: true, sparse: true });
// NO index on username - it can have duplicates

const User = mongoose.model('User', userSchema);
module.exports = User;