const Node    = require('../models/Node.model');
const Command = require('../models/Command.model');
const { publish }  = require('../mqtt/mqttClient');
const topics       = require('../utils/mqttTopics');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

async function issueCommand(req, res, type) {
  const node = await Node.findById(req.params.nodeId);
  if (!node) return res.status(404).json({ success:false, message:'Node not found' });
  const cmd = await Command.create({
    node:node._id, farm:node.farm, type,
    payload: req.body||{}, issuedBy:req.user._id, source:'manual',
  });
  publish(topics.command(node.farm.toString(), node.device_id), {
    cmd_id:cmd._id.toString(), type, payload:cmd.payload, ts:Date.now(),
  });
  cmd.status = 'sent';
  await cmd.save();
  created(res, { command:cmd }, 'Command sent');
}

exports.openValve   = (req,res) => issueCommand(req,res,'valve_open');
exports.closeValve  = (req,res) => issueCommand(req,res,'valve_close');
exports.toggleValve = (req,res) => issueCommand(req,res,'valve_toggle');
exports.startPump   = (req,res) => issueCommand(req,res,'pump_start');
exports.stopPump    = (req,res) => issueCommand(req,res,'pump_stop');

exports.getCommands = asyncHandler(async (req, res) => {
  const { page=1, limit=20, status } = req.query;
  const filter = { node:req.params.nodeId };
  if (status) filter.status = status;
  const total    = await Command.countDocuments(filter);
  const commands = await Command.find(filter)
    .populate('issuedBy','name').sort({ createdAt:-1 })
    .skip((page-1)*limit).limit(+limit);
  res.json({ success:true, data:commands, pagination:{ page:+page, limit:+limit, total } });
});

exports.getCommandStatus = asyncHandler(async (req, res) => {
  const cmd = await Command.findOne({ _id:req.params.cmdId, node:req.params.nodeId })
    .populate('issuedBy','name');
  if (!cmd) return res.status(404).json({ success:false, message:'Command not found' });
  success(res, { command:cmd });
});
