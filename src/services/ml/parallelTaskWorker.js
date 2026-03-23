const { parentPort } = require('worker_threads');

const { runFastGame } = require('./gameRunner');
const {
  trainPolicyModel,
  trainValueModel,
  trainIdentityModel,
} = require('./modeling');

let currentRequestId = null;

function serializeError(err) {
  return {
    message: err?.message || String(err || 'Worker task failed'),
    stack: err?.stack || null,
  };
}

async function handlePlayGameTask(task = {}, reportProgress = null) {
  return runFastGame(task.options || {}, {
    onProgress: typeof reportProgress === 'function'
      ? (progress) => reportProgress(progress)
      : null,
  });
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
    return handlePlayGameTask(task, (progress) => {
      parentPort.postMessage({
        requestId: currentRequestId,
        ok: true,
        progress: true,
        result: progress,
      });
    });
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
  currentRequestId = requestId;
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
