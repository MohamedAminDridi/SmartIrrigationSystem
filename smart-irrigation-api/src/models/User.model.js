const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const refreshTokenSchema = new mongoose.Schema({
  token:     { type: String, required: true },
  expiresAt: { type: Date,   required: true },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },  // removed minlength — Joi handles this
  role:     { type: String, enum: ['farmer','admin','viewer','technician'], default: 'farmer' },
  phone:    { type: String, default: null },
  isActive: { type: Boolean, default: true },
  lastLogin:{ type: Date,    default: null },
  refreshTokens: { type: [refreshTokenSchema], default: [] },
  notifications: {
    push:        { type: Boolean, default: true  },
    sms:         { type: Boolean, default: false },
    email:       { type: Boolean, default: true  },
    whatsapp:    { type: Boolean, default: false },
    quietFrom:   { type: String,  default: '22:00' },
    quietTo:     { type: String,  default: '07:00' },
    minSeverity: { type: String,  enum: ['info','warning','critical'], default: 'warning' },
  },
  fcmTokens: [{ type: String }],
}, { timestamps: true });

// Hash password only when it is modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
