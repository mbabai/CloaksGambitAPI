const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runInSimulationRequestContext(callback, metadata = {}) {
  return storage.run({
    internalSimulation: true,
    ...metadata,
  }, callback);
}

function getSimulationRequestContext() {
  return storage.getStore() || null;
}

function isInternalSimulationActive() {
  return Boolean(storage.getStore()?.internalSimulation);
}

module.exports = {
  runInSimulationRequestContext,
  getSimulationRequestContext,
  isInternalSimulationActive,
};
