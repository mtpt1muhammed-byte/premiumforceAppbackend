// models/assign_admin_driver_model.js
const mongoose = require('mongoose');

const adminAssignDriverSchema = new mongoose.Schema(
  {
    adminID: {
      type: String,
      required: true
    },
    driverID: {
      type: String,
      required: true
    },
    assignedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true // ✅ This is CORRECT - outside the fields object
  }
);

module.exports = mongoose.model('AdminAssignDriver', adminAssignDriverSchema);
