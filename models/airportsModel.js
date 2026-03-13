const mongoose = require('mongoose');

const airportSchema = new mongoose.Schema({
  cityID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'City ID is required']
  },
  airportName: {
    type: String,
    required: [true, 'Airport name is required'],
    trim: true
  },
  lat: {
    type: Number,
    required: false
  },
  long: {
    type: Number,
    required: false
  },
 
  image: {
    type: {
      key: String,
      url: String,
      originalName: String,
      mimeType: String,
      size: Number
    },
    required: false // Image is optional
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Indexes for better query performance
airportSchema.index({ airportName: 1 });
airportSchema.index({ cityID: 1 });
airportSchema.index({ isActive: 1 });
airportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Airport', airportSchema);