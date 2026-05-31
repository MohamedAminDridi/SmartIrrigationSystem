const Gateway      = require('../models/Gateway.model');
const AppError     = require('../utils/AppError');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

exports.listGateways = asyncHandler(async (req, res) => {
  const gateways = await Gateway.find({ farm: req.params.farmId }).sort('-createdAt');

  // Attach latest uptime_s from heartbeat_log so frontend shows correct uptime on load
  const enriched = gateways.map(gw => {
    const obj = gw.toObject();
    const latest = gw.heartbeat_log?.[gw.heartbeat_log.length - 1];
    obj.uptime_s = latest?.uptime_s ?? null;
    obj.rssi     = latest?.rssi     ?? null;
    return obj;
  });

  success(res, { gateways: enriched });
});

exports.createGateway = asyncHandler(async (req, res) => {
  const existing = await Gateway.findOne({ device_id: req.body.device_id });
  if (existing) throw new AppError('Device ID already registered.', 409);
  const gateway = await Gateway.create({ ...req.body, farm: req.params.farmId });
  created(res, { gateway }, 'Gateway registered');
});

exports.getGateway = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findOne({ _id: req.params.gwId, farm: req.params.farmId });
  if (!gateway) throw new AppError('Gateway not found.', 404);
  const obj    = gateway.toObject();
  const latest = gateway.heartbeat_log?.[gateway.heartbeat_log.length - 1];
  obj.uptime_s = latest?.uptime_s ?? null;
  obj.rssi     = latest?.rssi     ?? null;
  success(res, { gateway: obj });
});

exports.updateGateway = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findByIdAndUpdate(req.params.gwId, req.body, { new: true });
  success(res, { gateway });
});

exports.deleteGateway = asyncHandler(async (req, res) => {
  await Gateway.findByIdAndDelete(req.params.gwId);
  res.status(204).send();
});

exports.getHeartbeats = asyncHandler(async (req, res) => {
  const gateway = await Gateway.findById(req.params.gwId);
  if (!gateway) throw new AppError('Gateway not found.', 404);
  const log = (gateway.heartbeat_log || []).slice(-50).reverse();
  success(res, { heartbeats: log });
});