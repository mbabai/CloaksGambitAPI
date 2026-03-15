const PACKED_TENSOR_FORMAT = 'f32-base64-v1';
const PACKED_NETWORK_FORMAT = 'ml-network-packed-v1';
const PACKED_ADAM_FORMAT = 'ml-adam-packed-v1';

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function packFloat32(values = []) {
  const typed = Float32Array.from((Array.isArray(values) ? values : []).map((value) => toFiniteNumber(value)));
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
}

function unpackFloat32(encoded, expectedLength = 0) {
  if (typeof encoded !== 'string' || !encoded.trim()) {
    return new Array(Math.max(0, Number(expectedLength || 0))).fill(0);
  }
  const buffer = Buffer.from(encoded, 'base64');
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const typed = new Float32Array(arrayBuffer);
  const values = Array.from(typed, (value) => Number(value));
  if (!Number.isFinite(expectedLength) || expectedLength <= 0 || values.length === expectedLength) {
    return values;
  }
  if (values.length > expectedLength) {
    return values.slice(0, expectedLength);
  }
  return values.concat(new Array(expectedLength - values.length).fill(0));
}

function flattenMatrix(matrix = [], outputSize = 0, inputSize = 0) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const flattened = new Array(Math.max(0, outputSize * inputSize));
  let offset = 0;
  for (let out = 0; out < outputSize; out += 1) {
    const row = Array.isArray(rows[out]) ? rows[out] : [];
    for (let input = 0; input < inputSize; input += 1) {
      flattened[offset] = toFiniteNumber(row[input]);
      offset += 1;
    }
  }
  return flattened;
}

function inflateMatrix(flatValues = [], outputSize = 0, inputSize = 0) {
  const matrix = [];
  let offset = 0;
  for (let out = 0; out < outputSize; out += 1) {
    const row = new Array(inputSize);
    for (let input = 0; input < inputSize; input += 1) {
      row[input] = toFiniteNumber(flatValues[offset]);
      offset += 1;
    }
    matrix.push(row);
  }
  return matrix;
}

function isPackedNetwork(network) {
  return Boolean(network && network.storageFormat === PACKED_NETWORK_FORMAT);
}

function packNetwork(network) {
  if (!network || typeof network !== 'object') return null;
  if (isPackedNetwork(network)) return network;
  const layers = Array.isArray(network.layers) ? network.layers : [];
  return {
    ...network,
    storageFormat: PACKED_NETWORK_FORMAT,
    layers: layers.map((layer) => {
      const inputSize = Math.max(0, Number(layer?.inputSize || 0));
      const outputSize = Math.max(0, Number(layer?.outputSize || 0));
      return {
        inputSize,
        outputSize,
        tensorFormat: PACKED_TENSOR_FORMAT,
        packedWeights: packFloat32(flattenMatrix(layer?.weights, outputSize, inputSize)),
        packedBiases: packFloat32(
          Array.from({ length: outputSize }, (_, index) => toFiniteNumber(layer?.biases?.[index])),
        ),
      };
    }),
  };
}

function unpackNetwork(network) {
  if (!network || typeof network !== 'object') return null;
  if (!isPackedNetwork(network)) return network;
  const layers = Array.isArray(network.layers) ? network.layers : [];
  return {
    ...network,
    layers: layers.map((layer) => {
      const inputSize = Math.max(0, Number(layer?.inputSize || 0));
      const outputSize = Math.max(0, Number(layer?.outputSize || 0));
      const weights = inflateMatrix(
        unpackFloat32(layer?.packedWeights, outputSize * inputSize),
        outputSize,
        inputSize,
      );
      const biases = unpackFloat32(layer?.packedBiases, outputSize);
      return {
        inputSize,
        outputSize,
        weights,
        biases,
      };
    }),
  };
}

function packModelBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return null;
  return {
    ...bundle,
    encoder: bundle.encoder
      ? {
        ...bundle.encoder,
        network: packNetwork(bundle.encoder.network),
      }
      : bundle.encoder,
    policy: bundle.policy
      ? {
        ...bundle.policy,
        network: packNetwork(bundle.policy.network),
      }
      : bundle.policy,
    value: bundle.value
      ? {
        ...bundle.value,
        network: packNetwork(bundle.value.network),
      }
      : bundle.value,
    identity: bundle.identity
      ? {
        ...bundle.identity,
        network: packNetwork(bundle.identity.network),
      }
      : bundle.identity,
  };
}

function unpackModelBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return null;
  return {
    ...bundle,
    encoder: bundle.encoder
      ? {
        ...bundle.encoder,
        network: unpackNetwork(bundle.encoder.network),
      }
      : bundle.encoder,
    policy: bundle.policy
      ? {
        ...bundle.policy,
        network: unpackNetwork(bundle.policy.network),
      }
      : bundle.policy,
    value: bundle.value
      ? {
        ...bundle.value,
        network: unpackNetwork(bundle.value.network),
      }
      : bundle.value,
    identity: bundle.identity
      ? {
        ...bundle.identity,
        network: unpackNetwork(bundle.identity.network),
      }
      : bundle.identity,
  };
}

function isPackedAdamState(state) {
  return Boolean(state && state.storageFormat === PACKED_ADAM_FORMAT);
}

function packAdamState(state) {
  if (!state || typeof state !== 'object') return null;
  if (isPackedAdamState(state)) return state;
  const layers = Array.isArray(state.layers) ? state.layers : [];
  return {
    step: Math.max(0, Number(state.step || 0)),
    storageFormat: PACKED_ADAM_FORMAT,
    layers: layers.map((layer) => {
      const outputSize = Array.isArray(layer?.mBiases)
        ? layer.mBiases.length
        : Math.max(
          Array.isArray(layer?.mWeights) ? layer.mWeights.length : 0,
          Array.isArray(layer?.vWeights) ? layer.vWeights.length : 0,
          Array.isArray(layer?.vBiases) ? layer.vBiases.length : 0,
        );
      const inputSize = Array.isArray(layer?.mWeights?.[0])
        ? layer.mWeights[0].length
        : (Array.isArray(layer?.vWeights?.[0]) ? layer.vWeights[0].length : 0);
      return {
        inputSize,
        outputSize,
        tensorFormat: PACKED_TENSOR_FORMAT,
        packedMWeights: packFloat32(flattenMatrix(layer?.mWeights, outputSize, inputSize)),
        packedVWeights: packFloat32(flattenMatrix(layer?.vWeights, outputSize, inputSize)),
        packedMBiases: packFloat32(
          Array.from({ length: outputSize }, (_, index) => toFiniteNumber(layer?.mBiases?.[index])),
        ),
        packedVBiases: packFloat32(
          Array.from({ length: outputSize }, (_, index) => toFiniteNumber(layer?.vBiases?.[index])),
        ),
      };
    }),
  };
}

function unpackAdamState(state) {
  if (!state || typeof state !== 'object') return null;
  if (!isPackedAdamState(state)) return state;
  const layers = Array.isArray(state.layers) ? state.layers : [];
  return {
    step: Math.max(0, Number(state.step || 0)),
    layers: layers.map((layer) => {
      const inputSize = Math.max(0, Number(layer?.inputSize || 0));
      const outputSize = Math.max(0, Number(layer?.outputSize || 0));
      return {
        mWeights: inflateMatrix(
          unpackFloat32(layer?.packedMWeights, outputSize * inputSize),
          outputSize,
          inputSize,
        ),
        vWeights: inflateMatrix(
          unpackFloat32(layer?.packedVWeights, outputSize * inputSize),
          outputSize,
          inputSize,
        ),
        mBiases: unpackFloat32(layer?.packedMBiases, outputSize),
        vBiases: unpackFloat32(layer?.packedVBiases, outputSize),
      };
    }),
  };
}

function encodeMlPersistenceArtifacts(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => encodeMlPersistenceArtifacts(entry, parentKey));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (parentKey === 'modelBundle') {
    return packModelBundle(value);
  }
  if (parentKey === 'optimizerState') {
    return packAdamState(value);
  }
  const result = {};
  Object.keys(value).forEach((key) => {
    result[key] = encodeMlPersistenceArtifacts(value[key], key);
  });
  return result;
}

function decodeMlPersistenceArtifacts(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeMlPersistenceArtifacts(entry, parentKey));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (parentKey === 'modelBundle') {
    return unpackModelBundle(value);
  }
  if (parentKey === 'optimizerState') {
    return unpackAdamState(value);
  }
  const result = {};
  Object.keys(value).forEach((key) => {
    result[key] = decodeMlPersistenceArtifacts(value[key], key);
  });
  return result;
}

module.exports = {
  decodeMlPersistenceArtifacts,
  encodeMlPersistenceArtifacts,
};
