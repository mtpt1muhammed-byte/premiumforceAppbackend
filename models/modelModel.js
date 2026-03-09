const mongoose = require('mongoose');

const modelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  icon: {
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
  }
}, {
  timestamps: true
});

// Remove duplicate index if you have any in your schema
// modelSchema.index({ name: 1 }); // Remove this line if it exists

module.exports = mongoose.model('Model', modelSchema);