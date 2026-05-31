const Firmware      = require('../models/Firmware.model');
const Node          = require('../models/Node.model');
const Gateway       = require('../models/Gateway.model');
const { publish }   = require('../mqtt/mqttClient');
const topics        = require('../utils/mqttTopics');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const crypto        = require('crypto');
const fs            = require('fs');
const path          = require('path');

exports.listFirmware = asyncHandler(async (req, res) => {
  const list = await Firmware.find().sort('-createdAt').populate('uploaded_by', 'name');
  success(res, { firmware: list });
});

exports.uploadFirmware = asyncHandler(async (req, res) => {
  const { version, notes } = req.body;
  const checksum = crypto.createHash('md5').update(fs.readFileSync(req.file.path)).digest('hex');
  const fw = await Firmware.create({
    version, notes, filename: req.file.originalname,
    filepath: req.file.path, size_bytes: req.file.size,
    checksum, uploaded_by: req.user._id,
  });
  created(res, { firmware: fw }, 'Firmware uploaded');
});

exports.deployToNode = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const fw   = await Firmware.findById(req.body.firmware_id);
  if (!fw)   return res.status(404).json({ success: false, message: 'Firmware not found' });
  publish(topics.ota(node.farm, node.device_id), {
    version: fw.version, url: `/api/ota/download/${fw._id}`, checksum: fw.checksum,
  });
  success(res, { node_id: node._id, firmware: fw.version, status: 'deploying' }, 'OTA command sent');
});

exports.deployToGateway = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findById(req.params.gatewayId);
  if (!gateway) return res.status(404).json({ success: false, message: 'Gateway not found' });
  const fw = await Firmware.findById(req.body.firmware_id);
  if (!fw)      return res.status(404).json({ success: false, message: 'Firmware not found' });
  publish(topics.ota(gateway.farm, gateway.device_id), {
    version: fw.version, url: `/api/ota/download/${fw._id}`, checksum: fw.checksum,
  });
  success(res, { gateway_id: gateway._id, firmware: fw.version, status: 'deploying' }, 'OTA command sent');
});

exports.deployToFarm = asyncHandler(async (req, res) => {
  const nodes = await Node.find({ farm: req.params.farmId });
  const fw    = await Firmware.findById(req.body.firmware_id);
  nodes.forEach(n => publish(topics.ota(n.farm, n.device_id), {
    version: fw.version, url: `/api/ota/download/${fw._id}`, checksum: fw.checksum,
  }));
  success(res, { nodes_targeted: nodes.length, firmware: fw.version }, 'Batch OTA sent');
});

exports.getStatus = asyncHandler(async (req, res) => {
  const node = await Node.findById(req.params.nodeId);
  success(res, { node_id: node._id, firmware_version: node.firmware_version, status: node.status });
});

exports.rollback = asyncHandler(async (req, res) => {
  success(res, { message: 'Rollback command queued' });
});

// Public — no auth required so ESP32 can fetch the binary over HTTP
exports.downloadFirmware = asyncHandler(async (req, res) => {
  const fw = await Firmware.findById(req.params.firmwareId);
  if (!fw) return res.status(404).json({ success: false, message: 'Firmware not found' });
  const abs = path.resolve(fw.filepath);
  if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'File missing on disk' });

  const stat = fs.statSync(abs);
  res.setHeader('Content-Type',        'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fw.filename}"`);
  res.setHeader('Content-Length',      stat.size);   // required by HTTPUpdate
  res.setHeader('X-MD5',               fw.checksum || '');

  const stream = fs.createReadStream(abs);
  stream.on('error', err => {
    console.error('[OTA download] stream error:', err.message);
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
});

exports.deleteFirmware = asyncHandler(async (req, res) => {
  const fw = await Firmware.findByIdAndDelete(req.params.firmwareId);
  if (!fw) return res.status(404).json({ success: false, message: 'Firmware not found' });
  try { fs.unlinkSync(path.resolve(fw.filepath)); } catch {}
  success(res, {}, 'Firmware deleted');
});

exports.markStable = asyncHandler(async (req, res) => {
  const fw = await Firmware.findByIdAndUpdate(
    req.params.firmwareId, { is_stable: true }, { new: true }
  );
  if (!fw) return res.status(404).json({ success: false, message: 'Firmware not found' });
  success(res, { firmware: fw }, 'Marked as stable');
});
