const { parentPort } = require('worker_threads');

const { MlRuntime } = require('./runtime');
const {
  trainPolicyModel,
  trainValueModel,
  trainIdentityModel,
} = require('./modeling');

function serializeError(err) {
  return {
    message: err?.message || String(err || 'Worker task failed'),
    stack: err?.stack || null,
  };
}

async function handlePlayGameTask(task = {}) {
  const runtime = new MlRuntime({ persist: false });
  const game = await runtime.runSingleGame(task.options || {});
  return game;
}

function handleTrainHeadTask(task = {}) {
  const head = String(task.head || '').trim().toLowerCase();
  const modelBundle = task.modelBundle || null;
  const samples = Array.isArray(task.samples) ? task.samples : [];
  const trainingOptions = {
    ...(task.trainingOptions || {}),
    optimizerState: task.optimizerState || null,
  };

  if (head === 'policy') {
    const result = trainPolicyModel(modelBundle, samples, trainingOptions);
    return {
      head,
      updatedModel: modelBundle?.policy || null,
      optimizerState: result.optimizerState || null,
      metrics: {
        samples: Number(result.samples || 0),
        loss: Number(result.loss || 0),
      },
    };
  }
  if (head === 'value') {
    const result = trainValueModel(modelBundle, samples, trainingOptions);
    return {
      head,
      updatedModel: modelBundle?.value || null,
      optimizerState: result.optimizerState || null,
      metrics: {
        samples: Number(result.samples || 0),
        loss: Number(result.loss || 0),
      },
    };
  }
  if (head === 'identity') {
    const result = trainIdentityModel(modelBundle, samples, trainingOptions);
    return {
      head,
      updatedModel: modelBundle?.identity || null,
      optimizerState: result.optimizerState || null,
      metrics: {
        samples: Number(result.samples || 0),
        loss: Number(result.loss || 0),
        accuracy: Number(result.accuracy || 0),
      },
    };
  }
  throw new Error(`Unsupported training head task: ${head || 'unknown'}`);
}

async function handleTask(task = {}) {
  const type = String(task.type || '').trim();
  if (type === 'playGame') {
    return handlePlayGameTask(task);
  }
  if (type === 'trainHead') {
    return handleTrainHeadTask(task);
  }
  throw new Error(`Unsupported worker task type: ${type || 'unknown'}`);
}

if (!parentPort) {
  throw new Error('parallelTaskWorker must be run in a worker thread');
}

parentPort.on('message', async (message = {}) => {
  const requestId = message.requestId;
  try {
    const result = await handleTask(message.task || {});
    parentPort.postMessage({
      requestId,
      ok: true,
      result,
    });
  } catch (err) {
    parentPort.postMessage({
      requestId,
      ok: false,
      error: serializeError(err),
    });
  }
});
