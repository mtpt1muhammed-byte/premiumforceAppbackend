const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  driverID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: [true, 'Driver ID is required']
  },
  bookingID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: [true, 'Booking ID is required'],
    unique: true
  },
  reviewText: {
    type: String,
    required: [true, 'Review text is required'],
    trim: true,
    maxlength: [500, 'Review cannot exceed 500 characters']
  },
  rate: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // This will automatically handle createdAt and updatedAt
});

// Remove the pre-save hook and let timestamps handle it
// reviewSchema.pre('save', function(next) {
//   this.updatedAt = Date.now();
//   next();
// });

// Indexes
reviewSchema.index({ driverID: 1, createdAt: -1 });
// reviewSchema.index({ bookingID: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);