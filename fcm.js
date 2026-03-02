const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const User = require('./models/users_model');

// ─────────────────────────────────────────────────────────────────────────────
// Firebase project ID (must match your google-services.json / Firebase Console)
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_ID = 'premium-force';
const FCM_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

// Parse service-account credentials from the environment variable.
// Set FIREBASE_CREDENTIALS on your AWS server to the full JSON content of
// the service account key (Firebase Console → Settings → Service Accounts →
// Generate new private key).


const FIREBASE_CREDENTIALS = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};


if (!FIREBASE_CREDENTIALS) {
  throw new Error(
    'Missing FIREBASE_CREDENTIALS environment variable. ' +
      'Set it to the contents of your Firebase service account JSON.'
  );
}
const credentials = FIREBASE_CREDENTIALS;

const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
});

// Cache the OAuth2 token so we don't fetch it on every call
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const client = await auth.getClient();
  const response = await client.getAccessToken();
  _cachedToken = response.token;
  // Refresh 5 minutes before expiry (tokens last 1 hour)
  _tokenExpiry = Date.now() + 55 * 60 * 1000;
  return _cachedToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core send function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a push notification to a single device.
 *
 * @param {string} fcmToken  The device FCM registration token
 * @param {string} title     Notification title shown on device
 * @param {string} body      Notification body text shown on device
 * @param {object} data      Optional key-value data payload (all values strings)
 *
 * @returns {boolean} true if delivered, false if token was stale/invalid
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) {
    console.warn('⚠️  sendPushNotification: fcmToken is null – skipping.');
    return false;
  }

  // FCM data payload values must all be strings
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  try {
    const accessToken = await getAccessToken();

    await axios.post(
      FCM_URL,
      {
        message: {
          token: fcmToken,
          notification: { title, body },
          data: stringData,
          android: {
            priority: 'high',
            notification: {
              // Must match the channel registered in the Flutter app
              channel_id: 'premium_force_high_importance',
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: { sound: 'default', badge: 1 },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ FCM sent → ${fcmToken.slice(0, 20)}…`);
    return true;
  } catch (err) {
    const errorCode =
      err.response?.data?.error?.details?.[0]?.errorCode ?? '';

    if (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT') {
      // Token is stale (app uninstalled / reinstalled) — clear it from DB
      console.warn(`⚠️  Stale FCM token detected – clearing from DB.`);
      await User.findOneAndUpdate({ fcmToken }, { fcmToken: null });
    } else {
      console.error(
        '❌ FCM send error:',
        err.response?.data?.error ?? err.message
      );
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a user by MongoDB _id and send them a notification.
 *
 * @param {string|ObjectId} userId  MongoDB user _id
 * @param {string}          title
 * @param {string}          body
 * @param {object}          data
 */
async function notifyUser(userId, title, body, data = {}) {
  const user = await User.findById(userId).select('fcmToken').lean();
  if (!user?.fcmToken) return;
  await sendPushNotification(
    user.fcmToken,
    title, body, data);
}


/**
 * Send a notification to multiple users in parallel.
 *
 * @param {Array<string|ObjectId>} userIds  Array of MongoDB user _ids
 * @param {string}                 title
 * @param {string}                 body
 * @param {object}                 data
 */
async function notifyUsers(userIds, title, body, data = {}) {
  const users = await User.find(
    { _id: { $in: userIds }, fcmToken: { $ne: null } },
    { fcmToken: 1 }
  ).lean();

  await Promise.allSettled(
    users.map((u) => sendPushNotification(u.fcmToken, title, body, data))
  );
}

module.exports = { sendPushNotification, notifyUser, notifyUsers };
