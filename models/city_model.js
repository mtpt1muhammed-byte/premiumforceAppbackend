const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  cityName: {
    type: String,
    required: [true, 'City name is required'],
    trim: true,
    unique: true
  },

  image: {
    type: {
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
    required: [true, 'City image is required']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Index for better query performance
// citySchema.index({ cityName: 1 });
citySchema.index({ isActive: 1 });


module.exports = mongoose.model('City', citySchema);