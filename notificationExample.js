const { notifyUser, notifyUsers, sendPushNotification } = require('../services/fcm');

// ─────────────────────────────────────────────────────────────────────────────
// Copy-paste these calls wherever you need to send a notification.
// Import { notifyUser } from '../services/fcm' (adjust path as needed).
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Booking confirmed ──────────────────────────────────────────────────
async function onBookingConfirmed(booking) {
  await notifyUser(
    booking.userId,
    '🚗 Booking Confirmed',
    'Your ride has been confirmed.',
    { type: 'booking_confirmed', bookingId: booking._id.toString() }
  );
}

// ── 2. Booking cancelled ──────────────────────────────────────────────────
async function onBookingCancelled(booking) {
  await notifyUser(
    booking.userId,
    '❌ Booking Cancelled',
    'Your booking has been cancelled.',
    { type: 'booking_cancelled', bookingId: booking._id.toString() }
  );
}

// ── 3. Driver assigned ────────────────────────────────────────────────────
async function onDriverAssigned(booking, driver) {
  await notifyUser(
    booking.userId,
    '🧑‍✈️ Driver Assigned',
    `${driver.username} is on the way.`,
    { type: 'driver_assigned', bookingId: booking._id.toString(), driverId: driver._id.toString() }
  );
}

// ── 4. Driver arriving ────────────────────────────────────────────────────
async function onDriverArriving(booking) {
  await notifyUser(
    booking.userId,
    '📍 Driver Arriving',
    'Your driver is almost there.',
    { type: 'driver_arriving', bookingId: booking._id.toString() }
  );
}

// ── 5. Broadcast to all drivers ───────────────────────────────────────────
async function broadcastToDrivers(driverIds, title, body) {
  await notifyUsers(driverIds, title, body, { type: 'broadcast' });
}

// ── 6. Send to a raw FCM token (e.g. for testing) ────────────────────────
async function testNotification(fcmToken) {
  await sendPushNotification(
    fcmToken,
    '🔔 Test Notification',
    'If you see this, FCM is working correctly.',
    { type: 'test' }
  );
}

module.exports = {
  onBookingConfirmed,
  onBookingCancelled,
  onDriverAssigned,
  onDriverArriving,
  broadcastToDrivers,
  testNotification,
};
