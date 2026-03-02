// // notificationService.js
// // import { createRequire } from 'module';
// // const require = createRequire(module);

// const serviceAccount = require('../serviceAccount.json');
// const admin = require('firebase-admin');


// // // Initialize Firebase Admin
// // if (!admin.apps || admin.apps.length === 0) {
// //     console.log(serviceAccount); 
    
// //   admin.initializeApp({
// //     credential: admin.credential.cert(serviceAccount),
// //   });
// // }


// /**
//  * Send push notification to multiple devices
//  * @param {string[]} tokens - Array of FCM device tokens
//  * @param {object} payload - Notification payload { title, body, data (optional) }
//  * @returns {Promise<object>}
//  */
// const sendMultipleNotifications = async (tokens, payload) => {

//     if (!Array.isArray(tokens) || tokens.length === 0) {
//         throw new Error('Tokens array is required');
//     }
// console.log(payload);
// console.log(tokens);

//     const message = {
//         notification: {
//             title: payload.title,
//             body: payload.body,
//         },
//         data: payload.data || {},
        
    
//          tokens
//          ,
//     };

//     try {
//         const response = await admin.messaging().sendEachForMulticast(message);
//         return {
//             successCount: response.successCount,
//             failureCount: response.failureCount,
//             responses: response.responses,
//         };
//     } catch (error) {
//         console.log(error);
        
//         return { success: false, error: error.message };
//     }










        
  
// };

// const asyncErrorHandler = async (req) => {
//         // const userId = req?.user?.userId
//         // let { title, description } = req.body;
    
//         // if (isNull(title) || isNull(description)) {
//         //     return new Response("Missing required field", { success: false }, 400);
//         // }
    
//         // const users = await models.Users.find({ fcmToken: { $exists: true } }); // Fetch all users (or you can filter based on some criteria)
//         // const data = users.map(user => user?.fcmToken);
    
//         // if (!data || data.length === 0) {
//         //     return new Response("No FCM tokens found. Skipping notification.", { success: false }, 400);
//         // }
    
//         // Prepare the message payload
//         const message = {
//             notification: {
//                 title: "title",
//                 body: "description",
//             },
//             tokens: "c5ofSa45S5uFFbvIgeiFH_:APA91bHcvzs5aAQjYfcsXdoxSEXPie-iy6c5CSlL_pdyiCKy-mt-1BweWx1ktB68YSeD9vnSVFOhaEaOIP1-lV7CGXEkWrQ5H8lFYG6xCAQR5LaWRA7GSdk", // Send to multiple FCM tokens
//         };
    
//         // console.log(data,'data');
        
    
//         // Use sendEachForMulticast() if sendMulticast() is not working
//         const response = await admin.messaging().sendEachForMulticast(message);
    
//         // console.log(✅ Notifications sent: ${response.successCount});
//         // console.log(❌ Failed notifications: ${response.failureCount});
    
//         await new models.Notification({ title, description, userId: null, addedBy: userId }).save();
    
//         if (response.failureCount > 0) {
//             console.log("Errors:", response.responses);
//         }
    
    
//         return new Response("Notification send to all users", null, 200);
//     };
    
//     module.exports = { sendMultipleNotifications, asyncErrorHandler };