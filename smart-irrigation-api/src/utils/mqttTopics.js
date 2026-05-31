module.exports = {
  telemetry: (farmId, nodeId) => `farm/${farmId}/${nodeId}/telemetry`,
  command:   (farmId, nodeId) => `farm/${farmId}/${nodeId}/command`,
  status:    (farmId, nodeId) => `farm/${farmId}/${nodeId}/status`,
  heartbeat: (farmId, gwId)  => `farm/${farmId}/gateway/${gwId}/heartbeat`,
  ota:       (farmId, nodeId) => `farm/${farmId}/${nodeId}/ota`,
  alert:     (farmId, nodeId) => `farm/${farmId}/${nodeId}/alerts`,
  allFarm:   (farmId)        => `farm/${farmId}/#`,
};
