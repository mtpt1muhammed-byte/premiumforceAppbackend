const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  image: {
    type: {
      key: String,
      url: String,
      originalName: String,
      mimeType: String,
      size: Number
    },
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  categoryName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  link: {
    type: String,
    trim: true
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  },
  clickCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for better query performance
bannerSchema.index({ isActive: 1, categoryName: 1, priority: -1 });
bannerSchema.index({ startDate: 1, endDate: 1 });

// Method to get public banner data
bannerSchema.methods.getPublicBanner = function() {
  const banner = this.toObject();
  delete banner.__v;
  delete banner.createdBy;
  delete banner.updatedBy;
  
  // Ensure image is explicitly null if not present
  if (!banner.image) {
    banner.image = null;
  }
  
  return banner;
};

module.exports = mongoose.model('Banner', bannerSchema);