// const { sendNotificationToUser } = require('../services/notificationService'); // Adjust path


// app.post('/api/send-notification', async (req, res) => {
//   const { userId, title, body, data } = req.body;

//   if (!userId || !title || !body) {
//     return res.status(400).json({ error: 'Missing required fields: userId, title, body' });
//   }

//   const messagePayload = { title, body, data };
//   const result = await sendNotificationToUser(userId, messagePayload);

//   if (result.success) {
//     res.status(200).json({ success: true, messageId: result.response });
//   } else {
//     // Handle the error appropriately
//     if (result.error === 'Token not found') {
//       res.status(404).json({ error: 'User token not registered' });
//     } else {
//       res.status(500).json({ error: 'Failed to send notification', details: result.error });
//     }
//   }
// });