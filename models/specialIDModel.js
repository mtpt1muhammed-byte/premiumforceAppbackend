const mongoose = require('mongoose');

const specialContentSchema = new mongoose.Schema({
  specialID: {
    type: Number,
    unique: true
  },
  text: {
    type: String,
    required: [true, 'Text is required'],
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Auto-increment specialID before save
// specialContentSchema.pre('save', async function(next) {
//   if (this.isNew) {
//     try {
//       const lastDoc = await this.constructor.findOne({}, {}, { sort: { 'specialID': -1 } });
//       this.specialID = lastDoc ? lastDoc.specialID + 1 : 1;
//       next();
//     } catch (error) {
//       next(error);
//     }
//   } else {
//     next();
//   }
// });

module.exports = mongoose.model('SpecialIDModel', specialContentSchema);