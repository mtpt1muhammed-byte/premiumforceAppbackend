const mongoose = require('mongoose');

const terminalSchema = new mongoose.Schema({
  airportID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Airport',
    required: [true, 'Airport ID is required']
  },
  terminalName: {
    type: String,
    required: [true, 'Terminal name is required'],
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
    required: false // Image is optional
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
terminalSchema.index({ terminalName: 1 });
terminalSchema.index({ airportID: 1 });
terminalSchema.index({ isActive: 1 });

module.exports = mongoose.model('Terminal', terminalSchema);