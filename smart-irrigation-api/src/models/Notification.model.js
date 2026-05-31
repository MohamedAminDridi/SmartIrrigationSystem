const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  alert:   { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
  channel: { type: String, enum: ['push','sms','email','whatsapp'], required: true },
  title:   { type: String },
  body:    { type: String, required: true },
  status:  { type: String, enum: ['pending','sent','failed'], default: 'pending' },
  sent_at: { type: Date, default: null },
  error:   { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
