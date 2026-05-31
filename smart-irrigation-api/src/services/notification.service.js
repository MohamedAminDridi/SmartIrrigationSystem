const Notification = require('../models/Notification.model');
const logger       = require('../utils/logger');

const sendPush = async (tokens, title, body) => {
  if (!tokens?.length) return;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length)
      admin.initializeApp({ credential: admin.credential.cert(
        require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) });
    const res = await admin.messaging().sendEachForMulticast({ tokens, notification:{ title, body } });
    logger.info(`FCM: ${res.successCount} sent, ${res.failureCount} failed`);
  } catch(e) { logger.error('FCM error:', e.message); }
};

const sendSMS = async (to, body) => {
  try {
    const tw = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await tw.messages.create({ to, from:process.env.TWILIO_FROM_NUMBER, body });
  } catch(e) { logger.error('Twilio error:', e.message); }
};

exports.notifyUser = async (user, alert, channel) => {
  const title = `[${alert.severity.toUpperCase()}] Irrigation Alert`;
  const body  = alert.message;
  const n = await Notification.create({ user:user._id, alert:alert._id, channel, title, body });
  try {
    if (channel==='push' && user.fcmTokens?.length) await sendPush(user.fcmTokens, title, body);
    if (channel==='sms'  && user.phone)             await sendSMS(user.phone, `${title}: ${body}`);
    n.status = 'sent'; n.sent_at = new Date();
  } catch(e) { n.status='failed'; n.error=e.message; }
  await n.save();
  return n;
};
