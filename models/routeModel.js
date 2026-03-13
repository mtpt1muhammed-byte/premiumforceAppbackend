const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({


  vehicleID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car',
    required: [true, 'Vehicle is required']
  },
  fromCity: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'From city is required']
  },
  toCity: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'To city is required']
  },
  charge: {
    type: Number,
    required: [true, 'Charge is required'],
    min: [0, 'Charge cannot be negative']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Remove the pre-save hook and just keep the unique index
routeSchema.index({ vehicleID: 1, fromCity: 1, toCity: 1 }, { unique: true });


module.exports = mongoose.model('Route', routeSchema);