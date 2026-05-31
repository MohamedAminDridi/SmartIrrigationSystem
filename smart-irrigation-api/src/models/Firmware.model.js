const mongoose = require('mongoose');

const firmwareSchema = new mongoose.Schema({
  version:     { type: String, required: true, unique: true },
  filename:    { type: String, required: true },
  filepath:    { type: String, required: true },
  size_bytes:  { type: Number },
  checksum:    { type: String },
  notes:       { type: String, default: '' },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  is_stable:   { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Firmware', firmwareSchema);
