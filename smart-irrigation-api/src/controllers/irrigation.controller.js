const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Command = require('../models/Command.model');
const { publish }  = require('../mqtt/mqttClient');
const topics       = require('../utils/mqttTopics');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

const clampPercent = (p) => Math.max(0, Math.min(100, Math.round(Number(p) || 0)));

// ───────────────────────────────────────────────────────────────────────────
// Shared-pump reconciler.
// One pump per farm, wired to the gateway / pump controller. The pump must run
// while ANY node's valve is open and stop only when EVERY valve is closed. We
// derive the desired pump state from the live count of open valves and publish
// ONE pump command to every gateway in the farm (only the pump-wired gateway
// acts on it; firmware also ignores redundant toggles). This is why opening a
// 2nd/3rd node never "re-pulses" an already-running pump, and closing one node
// no longer kills the pump while other nodes are still irrigating.
// ───────────────────────────────────────────────────────────────────────────
async function reconcileFarmPump(farmId) {
  const openValves = await Node.countDocuments({ farm: farmId, valve_state: 'open' });
  const on   = openValves > 0;
  const type = on ? 'pump_start' : 'pump_stop';

  const gateways = await Gateway.find({ farm: farmId }).select('device_id');
  gateways.forEach((gw) => {
    publish(topics.command(String(farmId), gw.device_id), {
      type, payload: { reason: 'valve-sync', openValves }, ts: Date.now(),
    });
  });

  // Reflect the shared pump state on every node so the UI agrees.
  await Node.updateMany({ farm: farmId }, { pump_state: on ? 'on' : 'off' });
  return { on, openValves, gateways: gateways.length };
}

// Log + publish a valve command to a single node, mirror its intended valve
// state, then reconcile the farm's shared pump.
async function issueValve(req, res, type) {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });

  // Opening carries a 0–100% servo position (100% = 90° at the node).
  let payload = req.body || {};
  if (type === 'valve_open') payload = { ...payload, percent: clampPercent(payload.percent ?? 100) };

  const cmd = await Command.create({
    node: node._id, farm: node.farm, type, payload,
    issuedBy: req.user._id, source: 'manual',
  });
  publish(topics.command(node.farm.toString(), node.device_id), {
    id: node.device_id,          // node firmware checks this to filter its own commands
    cmd_id: cmd._id.toString(), type, payload: cmd.payload, ts: Date.now(),
  });
  cmd.status = 'sent';
  await cmd.save();

  // Mirror the intended valve state so the reconciler can count it.
  if (type === 'valve_toggle')      node.valve_state = node.valve_state === 'open' ? 'closed' : 'open';
  else                              node.valve_state = type === 'valve_open' ? 'open' : 'closed';
  node.valve_pct = node.valve_state === 'open' ? clampPercent(payload.percent ?? 100) : 0;
  await node.save();

  const pump = await reconcileFarmPump(node.farm);
  created(res, { command: cmd, pump }, `Command sent · pump ${pump.on ? 'running' : 'stopped'} (${pump.openValves} valve${pump.openValves === 1 ? '' : 's'} open)`);
}

exports.openValve   = asyncHandler((req, res) => issueValve(req, res, 'valve_open'));
exports.closeValve  = asyncHandler((req, res) => issueValve(req, res, 'valve_close'));
exports.toggleValve = asyncHandler((req, res) => issueValve(req, res, 'valve_toggle'));

// Manual pump override. The pump lives on the gateway / pump controller, so we
// publish straight to every gateway in the node's farm. Use sparingly — the
// reconciler will re-derive the pump from valve states on the next valve change.
async function manualPump(req, res, type) {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
  const gateways = await Gateway.find({ farm: node.farm }).select('device_id');
  gateways.forEach((gw) => {
    publish(topics.command(node.farm.toString(), gw.device_id), {
      type, payload: { reason: 'manual' }, ts: Date.now(),
    });
  });
  const on = type === 'pump_start';
  await Node.updateMany({ farm: node.farm }, { pump_state: on ? 'on' : 'off' });
  created(res, { pump: { on } }, on ? 'Pump started' : 'Pump stopped');
}

exports.startPump = asyncHandler((req, res) => manualPump(req, res, 'pump_start'));
exports.stopPump  = asyncHandler((req, res) => manualPump(req, res, 'pump_stop'));

exports.getCommands = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const filter = { node: req.params.nodeId };
  if (status) filter.status = status;
  const total    = await Command.countDocuments(filter);
  const commands = await Command.find(filter)
    .populate('issuedBy', 'name').sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(+limit);
  res.json({ success: true, data: commands, pagination: { page: +page, limit: +limit, total } });
});

exports.getCommandStatus = asyncHandler(async (req, res) => {
  const cmd = await Command.findOne({ _id: req.params.cmdId, node: req.params.nodeId })
    .populate('issuedBy', 'name');
  if (!cmd) return res.status(404).json({ success: false, message: 'Command not found' });
  success(res, { command: cmd });
});
