const { createRng } = require('./engine');

function clampFinite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function createMatrix(rows, cols, fill = 0) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

function createVector(size, fill = 0) {
  return Array.from({ length: size }, () => fill);
}

function cloneMatrix(matrix) {
  return Array.isArray(matrix) ? matrix.map((row) => (Array.isArray(row) ? row.slice() : [])) : [];
}

function cloneVector(vector) {
  return Array.isArray(vector) ? vector.slice() : [];
}

function relu(value) {
  return value > 0 ? value : 0;
}

function reluDerivative(value) {
  return value > 0 ? 1 : 0;
}

function createDenseLayer(inputSize, outputSize, rng) {
  const safeInput = Math.max(1, Math.floor(inputSize));
  const safeOutput = Math.max(1, Math.floor(outputSize));
  const random = typeof rng === 'function' ? rng : createRng(Date.now());
  const scale = Math.sqrt(2 / (safeInput + safeOutput));
  const weights = createMatrix(safeOutput, safeInput, 0);
  const biases = createVector(safeOutput, 0);

  for (let out = 0; out < safeOutput; out += 1) {
    for (let input = 0; input < safeInput; input += 1) {
      weights[out][input] = ((random() * 2) - 1) * scale;
    }
  }

  return {
    inputSize: safeInput,
    outputSize: safeOutput,
    weights,
    biases,
  };
}

function createMlp(options = {}) {
  const inputSize = Math.max(1, Math.floor(options.inputSize || 1));
  const hiddenSizes = Array.isArray(options.hiddenSizes)
    ? options.hiddenSizes
      .map((size) => Math.max(1, Math.floor(size)))
      .filter(Boolean)
    : [];
  const outputSize = Math.max(1, Math.floor(options.outputSize || 1));
  const rng = createRng(Number.isFinite(options.seed) ? options.seed : Date.now());
  const sizes = [inputSize, ...hiddenSizes, outputSize];
  const layers = [];

  for (let idx = 0; idx < sizes.length - 1; idx += 1) {
    layers.push(createDenseLayer(sizes[idx], sizes[idx + 1], rng));
  }

  return {
    type: 'mlp',
    version: 2,
    inputSize,
    hiddenSizes,
    outputSize,
    layers,
  };
}

function cloneNetwork(network) {
  const source = network || createMlp();
  return {
    type: source.type || 'mlp',
    version: Number.isFinite(source.version) ? source.version : 2,
    inputSize: Math.max(1, Math.floor(source.inputSize || 1)),
    hiddenSizes: Array.isArray(source.hiddenSizes) ? source.hiddenSizes.slice() : [],
    outputSize: Math.max(1, Math.floor(source.outputSize || 1)),
    layers: Array.isArray(source.layers)
      ? source.layers.map((layer) => ({
        inputSize: Math.max(1, Math.floor(layer?.inputSize || 1)),
        outputSize: Math.max(1, Math.floor(layer?.outputSize || 1)),
        weights: cloneMatrix(layer?.weights),
        biases: cloneVector(layer?.biases),
      }))
      : [],
  };
}

function prepareInputVector(vector, inputSize) {
  const safeInputSize = Math.max(1, Math.floor(inputSize || 1));
  const source = Array.isArray(vector) ? vector : [];
  const result = createVector(safeInputSize, 0);
  for (let idx = 0; idx < safeInputSize; idx += 1) {
    result[idx] = clampFinite(source[idx], 0);
  }
  return result;
}

function setHiddenValue(target, key, value) {
  if (!target || typeof target !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
    return;
  }
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

function buildCompiledLayer(layer) {
  const inputSize = Math.max(1, Math.floor(layer?.inputSize || 1));
  const outputSize = Math.max(1, Math.floor(layer?.outputSize || 1));
  const weights = new Float64Array(inputSize * outputSize);
  const biases = new Float64Array(outputSize);
  for (let out = 0; out < outputSize; out += 1) {
    biases[out] = clampFinite(layer?.biases?.[out], 0);
    const row = layer?.weights?.[out] || [];
    const rowOffset = out * inputSize;
    for (let inIdx = 0; inIdx < inputSize; inIdx += 1) {
      weights[rowOffset + inIdx] = clampFinite(row[inIdx], 0);
    }
  }
  return {
    inputSize,
    outputSize,
    weights,
    biases,
  };
}

function getCompiledNetwork(network) {
  if (!network || !Array.isArray(network.layers) || !network.layers.length) {
    return null;
  }
  const version = Number(network.__compiledVersion || 0);
  if (network.__compiledCache && network.__compiledCache.version === version) {
    return network.__compiledCache.compiled;
  }
  const compiled = {
    inputSize: Math.max(1, Math.floor(network.inputSize || 1)),
    layers: network.layers.map((layer) => buildCompiledLayer(layer)),
  };
  setHiddenValue(network, '__compiledCache', { version, compiled });
  return compiled;
}

function invalidateCompiledNetwork(network) {
  if (!network || typeof network !== 'object') return;
  setHiddenValue(network, '__compiledVersion', Number(network.__compiledVersion || 0) + 1);
  setHiddenValue(network, '__compiledCache', null);
}

function readVectorValue(vector, index) {
  if (!vector || typeof vector.length !== 'number') return 0;
  return clampFinite(vector[index], 0);
}

function forwardCompiledNetwork(compiledNetwork, input) {
  let current = input && typeof input.length === 'number' ? input : [];
  const layers = Array.isArray(compiledNetwork?.layers) ? compiledNetwork.layers : [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx += 1) {
    const layer = layers[layerIdx];
    const isOutputLayer = layerIdx === layers.length - 1;
    const next = new Array(layer.outputSize);
    for (let out = 0; out < layer.outputSize; out += 1) {
      let total = layer.biases[out];
      const rowOffset = out * layer.inputSize;
      for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
        total += layer.weights[rowOffset + inIdx] * readVectorValue(current, inIdx);
      }
      next[out] = isOutputLayer ? total : relu(total);
    }
    current = next;
  }

  return Array.isArray(current) ? current : Array.from(current || []);
}

function forwardCompiledNetworkBatch(compiledNetwork, inputs = []) {
  const inputBatch = Array.isArray(inputs) ? inputs : [];
  if (!inputBatch.length) return [];
  let currentBatch = inputBatch;
  const layers = Array.isArray(compiledNetwork?.layers) ? compiledNetwork.layers : [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx += 1) {
    const layer = layers[layerIdx];
    const isOutputLayer = layerIdx === layers.length - 1;
    const nextBatch = new Array(currentBatch.length);
    for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
      const current = currentBatch[batchIdx];
      const next = new Array(layer.outputSize);
      for (let out = 0; out < layer.outputSize; out += 1) {
        let total = layer.biases[out];
        const rowOffset = out * layer.inputSize;
        for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
          total += layer.weights[rowOffset + inIdx] * readVectorValue(current, inIdx);
        }
        next[out] = isOutputLayer ? total : relu(total);
      }
      nextBatch[batchIdx] = next;
    }
    currentBatch = nextBatch;
  }

  return currentBatch;
}

function forwardCompiledNetworkScalarBatch(compiledNetwork, inputs = []) {
  const inputBatch = Array.isArray(inputs) ? inputs : [];
  if (!inputBatch.length) return [];
  const layers = Array.isArray(compiledNetwork?.layers) ? compiledNetwork.layers : [];
  if (!layers.length) return inputBatch.map(() => 0);
  const outputLayer = layers[layers.length - 1];
  if (outputLayer.outputSize !== 1) {
    return forwardCompiledNetworkBatch(compiledNetwork, inputBatch).map((output) => clampFinite(output?.[0], 0));
  }

  let currentBatch = inputBatch;
  for (let layerIdx = 0; layerIdx < layers.length - 1; layerIdx += 1) {
    const layer = layers[layerIdx];
    const nextBatch = new Array(currentBatch.length);
    for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
      const current = currentBatch[batchIdx];
      const next = new Array(layer.outputSize);
      for (let out = 0; out < layer.outputSize; out += 1) {
        let total = layer.biases[out];
        const rowOffset = out * layer.inputSize;
        for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
          total += layer.weights[rowOffset + inIdx] * readVectorValue(current, inIdx);
        }
        next[out] = relu(total);
      }
      nextBatch[batchIdx] = next;
    }
    currentBatch = nextBatch;
  }

  const outputs = new Array(currentBatch.length);
  for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
    const current = currentBatch[batchIdx];
    let total = outputLayer.biases[0];
    for (let inIdx = 0; inIdx < outputLayer.inputSize; inIdx += 1) {
      total += outputLayer.weights[inIdx] * readVectorValue(current, inIdx);
    }
    outputs[batchIdx] = total;
  }
  return outputs;
}

function forwardNetwork(network, input, options = {}) {
  if (!options.keepCache) {
    const compiled = getCompiledNetwork(network);
    if (compiled) {
      return forwardCompiledNetwork(compiled, input);
    }
  }
  const preparedInput = prepareInputVector(input, network?.inputSize);
  const activations = [preparedInput];
  const preActivations = [];
  let current = preparedInput;
  const layers = Array.isArray(network?.layers) ? network.layers : [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx += 1) {
    const layer = layers[layerIdx];
    const sums = createVector(layer.outputSize, 0);
    for (let out = 0; out < layer.outputSize; out += 1) {
      let total = clampFinite(layer.biases?.[out], 0);
      for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
        total += clampFinite(layer.weights?.[out]?.[inIdx], 0) * clampFinite(current[inIdx], 0);
      }
      sums[out] = total;
    }

    preActivations.push(sums);
    const isOutputLayer = layerIdx === layers.length - 1;
    current = isOutputLayer ? sums.slice() : sums.map(relu);
    activations.push(current);
  }

  if (!options.keepCache) {
    return current;
  }

  return {
    output: current,
    cache: {
      activations,
      preActivations,
    },
  };
}

function forwardNetworkBatch(network, inputs = []) {
  const compiled = getCompiledNetwork(network);
  if (compiled) {
    return forwardCompiledNetworkBatch(compiled, inputs);
  }
  const preparedBatch = (Array.isArray(inputs) ? inputs : [])
    .map((input) => prepareInputVector(input, network?.inputSize));
  if (!preparedBatch.length) return [];

  let currentBatch = preparedBatch;
  const layers = Array.isArray(network?.layers) ? network.layers : [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx += 1) {
    const layer = layers[layerIdx];
    const isOutputLayer = layerIdx === layers.length - 1;
    const nextBatch = new Array(currentBatch.length);
    for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
      const current = currentBatch[batchIdx];
      const sums = createVector(layer.outputSize, 0);
      for (let out = 0; out < layer.outputSize; out += 1) {
        let total = clampFinite(layer.biases?.[out], 0);
        for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
          total += clampFinite(layer.weights?.[out]?.[inIdx], 0) * clampFinite(current[inIdx], 0);
        }
        sums[out] = total;
      }
      nextBatch[batchIdx] = isOutputLayer ? sums : sums.map(relu);
    }
    currentBatch = nextBatch;
  }

  return currentBatch;
}

function forwardNetworkScalarBatch(network, inputs = []) {
  const compiled = getCompiledNetwork(network);
  if (compiled) {
    return forwardCompiledNetworkScalarBatch(compiled, inputs);
  }
  const preparedBatch = (Array.isArray(inputs) ? inputs : [])
    .map((input) => prepareInputVector(input, network?.inputSize));
  if (!preparedBatch.length) return [];

  const layers = Array.isArray(network?.layers) ? network.layers : [];
  if (!layers.length) return preparedBatch.map(() => 0);
  const outputLayer = layers[layers.length - 1];
  if (outputLayer.outputSize !== 1) {
    return forwardNetworkBatch(network, preparedBatch).map((output) => clampFinite(output?.[0], 0));
  }

  let currentBatch = preparedBatch;
  for (let layerIdx = 0; layerIdx < layers.length - 1; layerIdx += 1) {
    const layer = layers[layerIdx];
    const nextBatch = new Array(currentBatch.length);
    for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
      const current = currentBatch[batchIdx];
      const next = createVector(layer.outputSize, 0);
      for (let out = 0; out < layer.outputSize; out += 1) {
        let total = clampFinite(layer.biases?.[out], 0);
        for (let inIdx = 0; inIdx < layer.inputSize; inIdx += 1) {
          total += clampFinite(layer.weights?.[out]?.[inIdx], 0) * clampFinite(current[inIdx], 0);
        }
        next[out] = relu(total);
      }
      nextBatch[batchIdx] = next;
    }
    currentBatch = nextBatch;
  }

  const outputs = new Array(currentBatch.length);
  for (let batchIdx = 0; batchIdx < currentBatch.length; batchIdx += 1) {
    const current = currentBatch[batchIdx];
    let total = clampFinite(outputLayer.biases?.[0], 0);
    for (let inIdx = 0; inIdx < outputLayer.inputSize; inIdx += 1) {
      total += clampFinite(outputLayer.weights?.[0]?.[inIdx], 0) * clampFinite(current[inIdx], 0);
    }
    outputs[batchIdx] = total;
  }
  return outputs;
}

function createGradientBundle(network) {
  const source = network || createMlp();
  return {
    layers: Array.isArray(source.layers)
      ? source.layers.map((layer) => ({
        weights: createMatrix(layer.outputSize, layer.inputSize, 0),
        biases: createVector(layer.outputSize, 0),
      }))
      : [],
  };
}

function zeroGradientBundle(gradients) {
  if (!gradients || !Array.isArray(gradients.layers)) return gradients;
  gradients.layers.forEach((layer) => {
    layer.weights.forEach((row) => row.fill(0));
    layer.biases.fill(0);
  });
  return gradients;
}

function addL2Penalty(gradients, network, weightDecay = 0) {
  const decay = clampFinite(weightDecay, 0);
  if (decay <= 0) return gradients;
  const layers = Array.isArray(network?.layers) ? network.layers : [];
  gradients.layers.forEach((layerGrad, layerIdx) => {
    const layer = layers[layerIdx];
    if (!layer) return;
    for (let out = 0; out < layerGrad.weights.length; out += 1) {
      for (let input = 0; input < layerGrad.weights[out].length; input += 1) {
        layerGrad.weights[out][input] += decay * clampFinite(layer.weights?.[out]?.[input], 0);
      }
    }
  });
  return gradients;
}

function scaleGradientBundle(gradients, factor = 1) {
  const scale = clampFinite(factor, 1);
  if (!gradients || !Array.isArray(gradients.layers) || scale === 1) return gradients;
  gradients.layers.forEach((layer) => {
    for (let out = 0; out < layer.weights.length; out += 1) {
      for (let input = 0; input < layer.weights[out].length; input += 1) {
        layer.weights[out][input] *= scale;
      }
      layer.biases[out] *= scale;
    }
  });
  return gradients;
}

function computeGradientNorm(gradients) {
  if (!gradients || !Array.isArray(gradients.layers)) return 0;
  let total = 0;
  gradients.layers.forEach((layer) => {
    layer.weights.forEach((row) => {
      row.forEach((value) => {
        total += value * value;
      });
    });
    layer.biases.forEach((value) => {
      total += value * value;
    });
  });
  return Math.sqrt(total);
}

function clipGradientBundle(gradients, maxNorm = 0) {
  const safeMaxNorm = clampFinite(maxNorm, 0);
  if (safeMaxNorm <= 0) return gradients;
  const norm = computeGradientNorm(gradients);
  if (norm <= safeMaxNorm || norm <= 0) return gradients;
  return scaleGradientBundle(gradients, safeMaxNorm / norm);
}

function backpropagateInto(network, cache, outputGradient, gradients) {
  if (!network || !cache || !gradients) return [];
  const layers = Array.isArray(network.layers) ? network.layers : [];
  if (!layers.length) return [];

  let downstream = cloneVector(outputGradient);
  for (let layerIdx = layers.length - 1; layerIdx >= 0; layerIdx -= 1) {
    const layer = layers[layerIdx];
    const layerGrad = gradients.layers[layerIdx];
    const inputActivation = cache.activations[layerIdx] || [];
    const preActivation = cache.preActivations[layerIdx] || [];
    const isOutputLayer = layerIdx === layers.length - 1;

    if (!isOutputLayer) {
      for (let out = 0; out < downstream.length; out += 1) {
        downstream[out] *= reluDerivative(preActivation[out]);
      }
    }

    const previous = createVector(layer.inputSize, 0);

    for (let out = 0; out < layer.outputSize; out += 1) {
      const delta = clampFinite(downstream[out], 0);
      layerGrad.biases[out] += delta;
      for (let inputIdx = 0; inputIdx < layer.inputSize; inputIdx += 1) {
        layerGrad.weights[out][inputIdx] += delta * clampFinite(inputActivation[inputIdx], 0);
        previous[inputIdx] += clampFinite(layer.weights?.[out]?.[inputIdx], 0) * delta;
      }
    }

    downstream = previous;
  }

  return downstream;
}

function createAdamState(network) {
  const source = network || createMlp();
  return {
    step: 0,
    layers: Array.isArray(source.layers)
      ? source.layers.map((layer) => ({
        mWeights: createMatrix(layer.outputSize, layer.inputSize, 0),
        vWeights: createMatrix(layer.outputSize, layer.inputSize, 0),
        mBiases: createVector(layer.outputSize, 0),
        vBiases: createVector(layer.outputSize, 0),
      }))
      : [],
  };
}

function applyAdamUpdate(network, gradients, optimizerState, options = {}) {
  const learningRate = Math.max(1e-6, clampFinite(options.learningRate, 0.001));
  const beta1 = Math.min(0.9999, Math.max(0, clampFinite(options.beta1, 0.9)));
  const beta2 = Math.min(0.999999, Math.max(0, clampFinite(options.beta2, 0.999)));
  const epsilon = Math.max(1e-12, clampFinite(options.epsilon, 1e-8));
  const state = optimizerState || createAdamState(network);
  state.step += 1;

  const biasCorrection1 = 1 - (beta1 ** state.step);
  const biasCorrection2 = 1 - (beta2 ** state.step);

  network.layers.forEach((layer, layerIdx) => {
    const gradLayer = gradients.layers[layerIdx];
    const stateLayer = state.layers[layerIdx];

    for (let out = 0; out < layer.outputSize; out += 1) {
      for (let inputIdx = 0; inputIdx < layer.inputSize; inputIdx += 1) {
        const grad = clampFinite(gradLayer.weights[out][inputIdx], 0);
        stateLayer.mWeights[out][inputIdx] = (beta1 * stateLayer.mWeights[out][inputIdx]) + ((1 - beta1) * grad);
        stateLayer.vWeights[out][inputIdx] = (beta2 * stateLayer.vWeights[out][inputIdx]) + ((1 - beta2) * grad * grad);

        const mHat = stateLayer.mWeights[out][inputIdx] / biasCorrection1;
        const vHat = stateLayer.vWeights[out][inputIdx] / biasCorrection2;
        layer.weights[out][inputIdx] -= learningRate * (mHat / (Math.sqrt(vHat) + epsilon));
      }

      const gradBias = clampFinite(gradLayer.biases[out], 0);
      stateLayer.mBiases[out] = (beta1 * stateLayer.mBiases[out]) + ((1 - beta1) * gradBias);
      stateLayer.vBiases[out] = (beta2 * stateLayer.vBiases[out]) + ((1 - beta2) * gradBias * gradBias);

      const mHatBias = stateLayer.mBiases[out] / biasCorrection1;
      const vHatBias = stateLayer.vBiases[out] / biasCorrection2;
      layer.biases[out] -= learningRate * (mHatBias / (Math.sqrt(vHatBias) + epsilon));
    }
  });

  invalidateCompiledNetwork(network);
  return state;
}

module.exports = {
  addL2Penalty,
  applyAdamUpdate,
  backpropagateInto,
  clipGradientBundle,
  cloneNetwork,
  computeGradientNorm,
  createAdamState,
  createGradientBundle,
  createMlp,
  forwardNetwork,
  forwardNetworkBatch,
  forwardNetworkScalarBatch,
  prepareInputVector,
  scaleGradientBundle,
  zeroGradientBundle,
};
