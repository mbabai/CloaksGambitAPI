import json
import math
import random
import sys
import traceback
from typing import Any

import torch
import torch.nn as nn
import torch.nn.functional as F


def send_response(request_id: Any, ok: bool, result: Any = None, error: str | None = None) -> None:
  payload = {
    'requestId': request_id,
    'ok': ok,
  }
  if ok:
    payload['result'] = result
  else:
    payload['error'] = error or 'unknown_error'
  sys.stdout.write(json.dumps(payload) + '\n')
  sys.stdout.flush()


def choose_device(preference: str | None) -> torch.device:
  normalized = str(preference or 'auto').strip().lower()
  if normalized == 'cpu':
    return torch.device('cpu')
  if normalized == 'cuda':
    if not torch.cuda.is_available():
      raise RuntimeError('CUDA was requested for training, but torch.cuda.is_available() is false')
    return torch.device('cuda')
  if torch.cuda.is_available():
    return torch.device('cuda')
  return torch.device('cpu')


def normalize_target(target: list[float]) -> list[float]:
  values = [float(value) if isinstance(value, (int, float)) and value > 0 else 0.0 for value in (target or [])]
  total = sum(values)
  if total <= 0:
    return [0.0 for _ in values]
  return [value / total for value in values]


class JsonMlp(nn.Module):
  def __init__(self, network: dict[str, Any]) -> None:
    super().__init__()
    layers = []
    for layer in network.get('layers', []):
      linear = nn.Linear(int(layer.get('inputSize', 1)), int(layer.get('outputSize', 1)))
      layers.append(linear)
    self.layers = nn.ModuleList(layers)

  def forward(self, x: torch.Tensor) -> torch.Tensor:
    current = x
    for index, layer in enumerate(self.layers):
      current = layer(current)
      if index < (len(self.layers) - 1):
        current = F.relu(current)
    return current


def load_network_into_model(model: JsonMlp, network: dict[str, Any], device: torch.device) -> None:
  with torch.no_grad():
    for layer_module, layer_data in zip(model.layers, network.get('layers', [])):
      weight = torch.tensor(layer_data.get('weights', []), dtype=torch.float32, device=device)
      bias = torch.tensor(layer_data.get('biases', []), dtype=torch.float32, device=device)
      layer_module.weight.copy_(weight)
      layer_module.bias.copy_(bias)


def export_model_to_network(model: JsonMlp, template: dict[str, Any]) -> dict[str, Any]:
  result = {
    'type': template.get('type', 'mlp'),
    'version': int(template.get('version', 2)),
    'inputSize': int(template.get('inputSize', 1)),
    'hiddenSizes': list(template.get('hiddenSizes', [])),
    'outputSize': int(template.get('outputSize', 1)),
    'layers': [],
  }
  for layer_module, layer_template in zip(model.layers, template.get('layers', [])):
    result['layers'].append({
      'inputSize': int(layer_template.get('inputSize', layer_module.in_features)),
      'outputSize': int(layer_template.get('outputSize', layer_module.out_features)),
      'weights': layer_module.weight.detach().cpu().tolist(),
      'biases': layer_module.bias.detach().cpu().tolist(),
    })
  return result


def serialize_optimizer_state(optimizer: torch.optim.Optimizer) -> dict[str, Any]:
  state_dict = optimizer.state_dict()
  result = {
    'backend': 'torch',
    'stateDict': {
      'state': {},
      'param_groups': [],
    },
  }
  for key, state in state_dict.get('state', {}).items():
    entry = {}
    for state_key, value in state.items():
      if torch.is_tensor(value):
        entry[state_key] = {
          '__tensor__': True,
          'data': value.detach().cpu().tolist(),
        }
      else:
        entry[state_key] = value
    result['stateDict']['state'][str(key)] = entry
  for group in state_dict.get('param_groups', []):
    result['stateDict']['param_groups'].append({
      key: value
      for key, value in group.items()
      if key != 'params'
    } | {
      'params': list(group.get('params', [])),
    })
  return result


def deserialize_optimizer_state(payload: Any, device: torch.device) -> dict[str, Any] | None:
  if not isinstance(payload, dict):
    return None
  if str(payload.get('backend', '')).strip().lower() != 'torch':
    return None
  state_dict = payload.get('stateDict')
  if not isinstance(state_dict, dict):
    return None
  result = {
    'state': {},
    'param_groups': [],
  }
  for key, state in state_dict.get('state', {}).items():
    restored_state = {}
    for state_key, value in (state or {}).items():
      if isinstance(value, dict) and value.get('__tensor__') is True:
        restored_state[state_key] = torch.tensor(value.get('data', []), dtype=torch.float32, device=device)
      else:
        restored_state[state_key] = value
    result['state'][int(key)] = restored_state
  for group in state_dict.get('param_groups', []):
    result['param_groups'].append(dict(group or {}))
  return result


def build_optimizer(model: JsonMlp, learning_rate: float, weight_decay: float, optimizer_state: Any, device: torch.device) -> torch.optim.Optimizer:
  optimizer = torch.optim.Adam(
    model.parameters(),
    lr=max(1e-6, float(learning_rate)),
    betas=(0.9, 0.999),
    eps=1e-8,
    weight_decay=max(0.0, float(weight_decay)),
  )
  restored = deserialize_optimizer_state(optimizer_state, device)
  if restored:
    optimizer.load_state_dict(restored)
    for group in optimizer.param_groups:
      group['lr'] = max(1e-6, float(learning_rate))
      group['weight_decay'] = max(0.0, float(weight_decay))
  return optimizer


def train_policy_epoch(model: JsonMlp, optimizer: torch.optim.Optimizer, samples: list[dict[str, Any]], options: dict[str, Any], temperature: float, device: torch.device) -> dict[str, Any]:
  valid_samples = []
  for sample in samples or []:
    features = sample.get('features') or []
    target = normalize_target(sample.get('target') or [])
    if not features or len(features) != len(target):
      continue
    valid_samples.append({
      'features': features,
      'target': target,
    })
  if not valid_samples:
    return {'samples': 0, 'loss': 0.0}

  random.shuffle(valid_samples)
  batch_size = max(1, int(options.get('batchSize', 16)))
  clip_norm = max(0.0, float(options.get('gradientClipNorm', 0.0)))
  total_loss = 0.0
  processed = 0
  safe_temperature = temperature if isinstance(temperature, (int, float)) and temperature > 0 else 1.0

  for start in range(0, len(valid_samples), batch_size):
    batch = valid_samples[start:start + batch_size]
    max_actions = max(len(sample['features']) for sample in batch)
    feature_dim = len(batch[0]['features'][0])
    features = torch.zeros((len(batch), max_actions, feature_dim), dtype=torch.float32, device=device)
    target = torch.zeros((len(batch), max_actions), dtype=torch.float32, device=device)
    mask = torch.zeros((len(batch), max_actions), dtype=torch.bool, device=device)

    for index, sample in enumerate(batch):
      action_count = len(sample['features'])
      features[index, :action_count] = torch.tensor(sample['features'], dtype=torch.float32, device=device)
      target[index, :action_count] = torch.tensor(sample['target'], dtype=torch.float32, device=device)
      mask[index, :action_count] = True

    optimizer.zero_grad(set_to_none=True)
    logits = model(features.reshape(-1, feature_dim)).reshape(len(batch), max_actions) / safe_temperature
    logits = logits.masked_fill(~mask, -1e9)
    log_probs = F.log_softmax(logits, dim=1)
    loss = -(target * log_probs).sum(dim=1).mean()
    loss.backward()
    if clip_norm > 0:
      torch.nn.utils.clip_grad_norm_(model.parameters(), clip_norm)
    optimizer.step()

    total_loss += float(loss.item()) * len(batch)
    processed += len(batch)

  return {
    'samples': processed,
    'loss': (total_loss / processed) if processed > 0 else 0.0,
  }


def train_value_epoch(model: JsonMlp, optimizer: torch.optim.Optimizer, samples: list[dict[str, Any]], options: dict[str, Any], device: torch.device) -> dict[str, Any]:
  valid_samples = []
  for sample in samples or []:
    features = sample.get('features') or []
    target = sample.get('target')
    if not features or not isinstance(target, (int, float)):
      continue
    valid_samples.append({
      'features': features,
      'target': float(target),
    })
  if not valid_samples:
    return {'samples': 0, 'loss': 0.0}

  random.shuffle(valid_samples)
  batch_size = max(1, int(options.get('batchSize', 24)))
  clip_norm = max(0.0, float(options.get('gradientClipNorm', 0.0)))
  total_loss = 0.0
  processed = 0

  for start in range(0, len(valid_samples), batch_size):
    batch = valid_samples[start:start + batch_size]
    features = torch.tensor([sample['features'] for sample in batch], dtype=torch.float32, device=device)
    target = torch.tensor([sample['target'] for sample in batch], dtype=torch.float32, device=device).unsqueeze(1)

    optimizer.zero_grad(set_to_none=True)
    raw = model(features)
    pred = torch.tanh(raw)
    loss = F.mse_loss(pred, target)
    loss.backward()
    if clip_norm > 0:
      torch.nn.utils.clip_grad_norm_(model.parameters(), clip_norm)
    optimizer.step()

    total_loss += float(loss.item()) * len(batch)
    processed += len(batch)

  return {
    'samples': processed,
    'loss': (total_loss / processed) if processed > 0 else 0.0,
  }


def train_identity_epoch(model: JsonMlp, optimizer: torch.optim.Optimizer, samples: list[dict[str, Any]], options: dict[str, Any], identity_count: int, device: torch.device) -> dict[str, Any]:
  valid_samples = []
  for sample in samples or []:
    piece_features = sample.get('pieceFeatures') or []
    truth = sample.get('trueIdentityIndex')
    if not piece_features or not isinstance(truth, int):
      continue
    if truth < 0 or truth >= identity_count:
      continue
    valid_samples.append({
      'pieceFeatures': piece_features,
      'truth': truth,
    })
  if not valid_samples:
    return {'samples': 0, 'loss': 0.0, 'accuracy': 0.0}

  random.shuffle(valid_samples)
  batch_size = max(1, int(options.get('batchSize', 24)))
  clip_norm = max(0.0, float(options.get('gradientClipNorm', 0.0)))
  total_loss = 0.0
  processed = 0
  correct = 0

  for start in range(0, len(valid_samples), batch_size):
    batch = valid_samples[start:start + batch_size]
    features = torch.tensor([sample['pieceFeatures'] for sample in batch], dtype=torch.float32, device=device)
    target = torch.tensor([sample['truth'] for sample in batch], dtype=torch.long, device=device)

    optimizer.zero_grad(set_to_none=True)
    logits = model(features)
    loss = F.cross_entropy(logits, target)
    loss.backward()
    if clip_norm > 0:
      torch.nn.utils.clip_grad_norm_(model.parameters(), clip_norm)
    optimizer.step()

    predictions = torch.argmax(logits, dim=1)
    correct += int((predictions == target).sum().item())
    total_loss += float(loss.item()) * len(batch)
    processed += len(batch)

  return {
    'samples': processed,
    'loss': (total_loss / processed) if processed > 0 else 0.0,
    'accuracy': (correct / processed) if processed > 0 else 0.0,
  }


def enrich_identity_samples(samples: list[dict[str, Any]], inferred_identities: list[Any]) -> list[dict[str, Any]]:
  index_by_identity = {identity: index for index, identity in enumerate(inferred_identities)}
  enriched = []
  for sample in samples or []:
    truth = sample.get('trueIdentity')
    if truth not in index_by_identity:
      continue
    enriched.append({
      **sample,
      'trueIdentityIndex': index_by_identity[truth],
    })
  return enriched


def train_bundle(payload: dict[str, Any]) -> dict[str, Any]:
  device = choose_device(payload.get('devicePreference'))
  model_bundle = payload.get('modelBundle') or {}
  optimizer_state = payload.get('optimizerState') or {}
  training_options = payload.get('trainingOptions') or {}
  epochs = max(1, int(payload.get('epochs', 1)))

  policy_model = JsonMlp(model_bundle['policy']['network']).to(device)
  value_model = JsonMlp(model_bundle['value']['network']).to(device)
  identity_model = JsonMlp(model_bundle['identity']['network']).to(device)

  load_network_into_model(policy_model, model_bundle['policy']['network'], device)
  load_network_into_model(value_model, model_bundle['value']['network'], device)
  load_network_into_model(identity_model, model_bundle['identity']['network'], device)

  policy_optimizer = build_optimizer(
    policy_model,
    training_options.get('learningRate', 0.0025),
    training_options.get('weightDecay', 0.0001),
    optimizer_state.get('policy'),
    device,
  )
  value_optimizer = build_optimizer(
    value_model,
    training_options.get('learningRate', 0.0025),
    training_options.get('weightDecay', 0.0001),
    optimizer_state.get('value'),
    device,
  )
  identity_optimizer = build_optimizer(
    identity_model,
    training_options.get('learningRate', 0.0025),
    training_options.get('weightDecay', 0.0001),
    optimizer_state.get('identity'),
    device,
  )

  policy_samples = payload.get('samples', {}).get('policySamples') or []
  value_samples = payload.get('samples', {}).get('valueSamples') or []
  identity_samples = enrich_identity_samples(
    payload.get('samples', {}).get('identitySamples') or [],
    model_bundle.get('identity', {}).get('inferredIdentities') or payload.get('inferredIdentities') or [],
  )

  history = []
  for epoch_index in range(epochs):
    policy = train_policy_epoch(
      policy_model,
      policy_optimizer,
      policy_samples,
      training_options,
      float(model_bundle.get('policy', {}).get('temperature', 1.0) or 1.0),
      device,
    )
    value = train_value_epoch(
      value_model,
      value_optimizer,
      value_samples,
      training_options,
      device,
    )
    identity = train_identity_epoch(
      identity_model,
      identity_optimizer,
      identity_samples,
      training_options,
      len(model_bundle.get('identity', {}).get('inferredIdentities') or payload.get('inferredIdentities') or []),
      device,
    )
    history.append({
      'epoch': epoch_index + 1,
      'policyLoss': float(policy['loss']),
      'valueLoss': float(value['loss']),
      'identityLoss': float(identity['loss']),
      'identityAccuracy': float(identity.get('accuracy', 0.0)),
      'policySamples': int(policy['samples']),
      'valueSamples': int(value['samples']),
      'identitySamples': int(identity['samples']),
    })

  updated_bundle = {
    'version': int(model_bundle.get('version', 2)),
    'policy': {
      **model_bundle.get('policy', {}),
      'network': export_model_to_network(policy_model, model_bundle['policy']['network']),
    },
    'value': {
      **model_bundle.get('value', {}),
      'network': export_model_to_network(value_model, model_bundle['value']['network']),
    },
    'identity': {
      **model_bundle.get('identity', {}),
      'network': export_model_to_network(identity_model, model_bundle['identity']['network']),
    },
  }

  return {
    'backend': 'python',
    'device': str(device),
    'cudaAvailable': bool(torch.cuda.is_available()),
    'torchVersion': torch.__version__,
    'modelBundle': updated_bundle,
    'optimizerState': {
      'policy': serialize_optimizer_state(policy_optimizer),
      'value': serialize_optimizer_state(value_optimizer),
      'identity': serialize_optimizer_state(identity_optimizer),
    },
    'history': history,
  }


def handle_message(payload: dict[str, Any]) -> Any:
  command = str(payload.get('command') or '').strip().lower()
  if command == 'handshake':
    return {
      'backend': 'python',
      'torchVersion': torch.__version__,
      'cudaAvailable': bool(torch.cuda.is_available()),
      'cudaDeviceCount': int(torch.cuda.device_count()) if torch.cuda.is_available() else 0,
      'cudaDeviceName': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
      'pythonVersion': sys.version.split()[0],
    }
  if command == 'train_batch':
    return train_bundle(payload)
  raise RuntimeError(f'Unsupported command: {command or "unknown"}')


def main() -> None:
  torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
  for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
      continue
    request_id = None
    try:
      message = json.loads(line)
      request_id = message.get('requestId')
      result = handle_message(message.get('payload') or {})
      send_response(request_id, True, result=result)
    except Exception as exc:  # noqa: BLE001
      traceback.print_exc(file=sys.stderr)
      sys.stderr.flush()
      send_response(request_id, False, error=str(exc))


if __name__ == '__main__':
  main()
