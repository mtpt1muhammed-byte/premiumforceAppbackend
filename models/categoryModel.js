const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
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
  description: {
    type: String,
    trim: true
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
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
categorySchema.index({ isActive: 1, priority: -1 });
// categorySchema.index({ name: 1 });

// Method to get public category data
categorySchema.methods.getPublicCategory = function() {
  const category = this.toObject();
  delete category.__v;
  delete category.createdBy;
  delete category.updatedBy;
  
  // Ensure image is explicitly null if not present
  if (!category.image) {
    category.image = null;
  }
  
  return category;
};

module.exports = mongoose.model('Category', categorySchema);