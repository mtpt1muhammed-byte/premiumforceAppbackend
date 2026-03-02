// models/UserToken.js
const mongoose = require('mongoose');

const userTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  fcmToken: {
    type: String,
    required: true
  },
  deviceType: {
    type: String,
    enum: ['ios', 'android', 'web'],
    default: 'web'
  },
  subscribedTopics: [{
    type: String,
    enum: ['admin_notifications', 'staff_notifications', 'customer_notifications', 'weather_alerts']
  }],
  lastActive: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
userTokenSchema.index({ userId: 1 });
userTokenSchema.index({ fcmToken: 1 });
userTokenSchema.index({ lastActive: -1 });

module.exports = mongoose.model('UserToken', userTokenSchema);