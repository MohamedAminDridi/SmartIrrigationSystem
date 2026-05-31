const Command  = require('../models/Command.model');
const Node     = require('../models/Node.model');
const { publish } = require('../mqtt/mqttClient');
const topics   = require('../utils/mqttTopics');

exports.issueCommand = async ({ nodeId, type, payload={}, userId, source='manual' }) => {
  const node = await Node.findById(nodeId);
  if (!node) throw Object.assign(new Error('Node not found'), { statusCode:404 });
  const cmd = await Command.create({ node:node._id, farm:node.farm, type, payload, issuedBy:userId, source });
  publish(topics.command(node.farm.toString(), node.device_id), {
    cmd_id:cmd._id.toString(), type, payload, ts:Date.now(),
  });
  cmd.status = 'sent';
  await cmd.save();
  return cmd;
};
