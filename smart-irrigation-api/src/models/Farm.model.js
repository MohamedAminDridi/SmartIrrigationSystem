const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner','farmer','viewer','technician'], default: 'farmer' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const farmSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  owner:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:         { type: [memberSchema], default: [] },
  location: {
    lat:     { type: Number },
    lng:     { type: Number },
    address: { type: String },
    country: { type: String },
  },
  size_ha:         { type: Number, min: 0, default: 0 },
  crop_type:       { type: String, default: 'general' },
  irrigation_mode: { type: String, enum: ['manual','auto','scheduled'], default: 'manual' },
  timezone:        { type: String, default: 'UTC' },
  isActive:        { type: Boolean, default: true },
}, { timestamps: true });

farmSchema.methods.hasMember = function (userId) {
  return this.owner.equals(userId) || this.members.some(m => m.user.equals(userId));
};

module.exports = mongoose.model('Farm', farmSchema);
