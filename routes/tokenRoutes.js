// // routes/tokenRoutes.js
// const express = require('express');
// const router = express.Router();
// const UserToken = require('../models/userToken');
// const NotificationService = require('../services/notificationService');
// const authMiddleware = require('../middleware/authTheMiddle');

// // Save or update FCM token
// router.post('/save-token', authMiddleware, async (req, res) => {
//   try {
//     const { fcmToken, deviceType } = req.body;
//     const userId = req.user._id; // From auth middleware

//     if (!fcmToken) {
//       return res.status(400).json({
//         success: false,
//         message: 'FCM token is required'
//       });
//     }

//     // Save token to database
//     const tokenData = await UserToken.findOneAndUpdate(
//       { userId },
//       { 
//         fcmToken,
//         deviceType: deviceType || 'web',
//         lastActive: new Date()
//       },
//       { new: true, upsert: true }
//     );

//     // Automatically subscribe user to relevant topics
//     try {
//       // Subscribe to user-specific topics
//       await NotificationService.subscribeToTopic(userId, fcmToken, 'all_users');
      
//       // Subscribe based on user role (you'd need to get user role from your User model)
//       const user = await User.findById(userId);
//       if (user && user.role === 'admin') {
//         await NotificationService.subscribeToTopic(userId, fcmToken, 'admin_notifications');
//       } else if (user && user.role === 'staff') {
//         await NotificationService.subscribeToTopic(userId, fcmToken, 'staff_notifications');
//       } else {
//         await NotificationService.subscribeToTopic(userId, fcmToken, 'customer_notifications');
//       }
//     } catch (topicError) {
//       console.error('Error subscribing to topics:', topicError);
//       // Don't fail the token save if subscription fails
//     }

//     res.status(200).json({
//       success: true,
//       message: 'Token saved successfully',
//       data: tokenData
//     });

//   } catch (error) {
//     console.error('Save token error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error saving token',
//       error: error.message
//     });
//   }
// });

// // Remove token (logout)
// router.delete('/remove-token', authMiddleware, async (req, res) => {
//   try {
//     const userId = req.user._id;
    
//     await UserToken.findOneAndDelete({ userId });
    
//     res.status(200).json({
//       success: true,
//       message: 'Token removed successfully'
//     });
//   } catch (error) {
//     console.error('Remove token error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error removing token',
//       error: error.message
//     });
//   }
// });

// // Subscribe to a topic
// router.post('/subscribe-topic', authMiddleware, async (req, res) => {
//   try {
//     const { topic } = req.body;
//     const userId = req.user._id;
    
//     const userToken = await UserToken.findOne({ userId });
//     if (!userToken) {
//       return res.status(404).json({
//         success: false,
//         message: 'User token not found'
//       });
//     }
    
//     const result = await NotificationService.subscribeToTopic(
//       userId, 
//       userToken.fcmToken, 
//       topic
//     );
    
//     if (result.success) {
//       res.status(200).json({
//         success: true,
//         message: `Subscribed to ${topic} successfully`
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to subscribe',
//         error: result.error
//       });
//     }
//   } catch (error) {
//     console.error('Subscribe error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error subscribing to topic',
//       error: error.message
//     });
//   }
// });

// // Unsubscribe from a topic
// router.post('/unsubscribe-topic', authMiddleware, async (req, res) => {
//   try {
//     const { topic } = req.body;
//     const userId = req.user._id;
    
//     const userToken = await UserToken.findOne({ userId });
//     if (!userToken) {
//       return res.status(404).json({
//         success: false,
//         message: 'User token not found'
//       });
//     }
    
//     const result = await NotificationService.unsubscribeFromTopic(
//       userId, 
//       userToken.fcmToken, 
//       topic
//     );
    
//     if (result.success) {
//       res.status(200).json({
//         success: true,
//         message: `Unsubscribed from ${topic} successfully`
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to unsubscribe',
//         error: result.error
//       });
//     }
//   } catch (error) {
//     console.error('Unsubscribe error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error unsubscribing from topic',
//       error: error.message
//     });
//   }
// });

// // Test endpoint for sending notification (admin only)
// router.post('/test-notification', authMiddleware, async (req, res) => {
//   try {
//     // Check if user is admin
//     const user = await User.findById(req.user._id);
//     if (!user || user.role !== 'admin') {
//       return res.status(403).json({
//         success: false,
//         message: 'Admin access required'
//       });
//     }
    
//     const { type, target, title, body } = req.body;
    
//     let result;
//     if (type === 'topic') {
//       result = await NotificationService.sendToTopic(
//         target,
//         { title: title || 'Test Notification', body: body || 'This is a test notification' }
//       );
//     } else if (type === 'user') {
//       result = await NotificationService.sendToUser(
//         target,
//         { title: title || 'Test Notification', body: body || 'This is a test notification' }
//       );
//     }
    
//     if (result && result.success) {
//       res.status(200).json({
//         success: true,
//         message: 'Test notification sent',
//         response: result.response
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to send test notification',
//         error: result?.error
//       });
//     }
//   } catch (error) {
//     console.error('Test notification error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error sending test notification',
//       error: error.message
//     });
//   }
// });

// module.exports = router;