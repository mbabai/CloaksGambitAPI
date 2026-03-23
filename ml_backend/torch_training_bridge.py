import copy
import json
import math
import os
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


def clamp_int(value: Any, fallback: int, minimum: int = 1, maximum: int | None = None) -> int:
  try:
    parsed = int(value)
  except Exception:
    parsed = int(fallback)
  bounded = max(minimum, parsed)
  if maximum is not None:
    bounded = min(maximum, bounded)
  return bounded


def configure_torch_runtime() -> dict[str, Any]:
  cpu_count = max(1, int(os.cpu_count() or 1))
  intra_threads = clamp_int(
    os.environ.get('ML_TRAINING_TORCH_THREADS'),
    cpu_count,
    1,
    cpu_count,
  )
  interop_threads = clamp_int(
    os.environ.get('ML_TRAINING_TORCH_INTEROP_THREADS'),
    max(1, min(4, cpu_count)),
    1,
    cpu_count,
  )

  torch.set_num_threads(intra_threads)
  try:
    torch.set_num_interop_threads(interop_threads)
  except RuntimeError:
    pass
  if hasattr(torch, 'set_float32_matmul_precision'):
    try:
      torch.set_float32_matmul_precision('high')
    except Exception:
      pass

  configured_interop_threads = None
  if hasattr(torch, 'get_num_interop_threads'):
    try:
      configured_interop_threads = int(torch.get_num_interop_threads())
    except Exception:
      configured_interop_threads = None

  return {
    'cpuCount': cpu_count,
    'torchNumThreads': int(torch.get_num_threads()),
    'torchNumInteropThreads': configured_interop_threads,
  }


def apply_training_thread_budget(training_options: dict[str, Any] | None, device: torch.device | None = None) -> None:
  options = training_options or {}
  max_logical_processors = options.get('maxLogicalProcessors')
  if max_logical_processors in (None, '', 0):
    return
  cpu_count = max(1, int(os.cpu_count() or 1))
  intra_threads = clamp_int(max_logical_processors, cpu_count, 1, cpu_count)
  try:
    torch.set_num_threads(intra_threads)
  except Exception:
    return


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


def is_shared_bundle(model_bundle: dict[str, Any]) -> bool:
  return str(model_bundle.get('family') or '').strip().lower() == 'shared_encoder_belief_ismcts_v1'


TRAINER_SESSIONS: dict[str, dict[str, Any]] = {}


def create_grad_scaler(enabled: bool) -> Any:
  if hasattr(torch, 'amp') and hasattr(torch.amp, 'GradScaler'):
    try:
      return torch.amp.GradScaler('cuda', enabled=enabled)
    except Exception:
      pass
  if hasattr(torch.cuda, 'amp') and hasattr(torch.cuda.amp, 'GradScaler'):
    try:
      return torch.cuda.amp.GradScaler(enabled=enabled)
    except Exception:
      pass
  return None


def get_autocast_context(device: torch.device, enabled: bool) -> Any:
  if hasattr(torch, 'autocast'):
    return torch.autocast(device_type=device.type, dtype=torch.float16, enabled=enabled)
  if hasattr(torch.cuda, 'amp') and hasattr(torch.cuda.amp, 'autocast'):
    return torch.cuda.amp.autocast(enabled=enabled)
  return torch.autocast(device_type=device.type, enabled=False)


def maybe_compile_module(module: nn.Module, enabled: bool) -> tuple[Any, bool]:
  if not enabled or not hasattr(torch, 'compile'):
    return module, False
  try:
    return torch.compile(module, mode='reduce-overhead'), True
  except Exception:
    return module, False


def is_compile_runtime_error(err: Exception) -> bool:
  message = str(err or '').strip().lower()
  if not message:
    return False
  return any(fragment in message for fragment in (
    'triton',
    'torch._inductor',
    'inductor',
    'dynamo',
    'cannot find a working triton installation',
  ))


def disable_session_compile(session: dict[str, Any]) -> None:
  session['encoderForward'] = session['encoderModel']
  session['policyForward'] = session['policyModel']
  session['valueForward'] = session['valueModel']
  session['identityForward'] = session['identityModel']
  session['compileEnabled'] = False


def build_shared_samples_from_legacy_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
  combined: dict[str, dict[str, Any]] = {}

  def make_key(sample: dict[str, Any], prefix: str, index: int) -> str:
    created_at = str(sample.get('createdAt') or '').strip()
    if created_at:
      return f't:{created_at}'
    return f'{prefix}:{index}'

  def ensure_entry(sample: dict[str, Any], key: str) -> dict[str, Any]:
    entry = combined.get(key)
    state_input = sample.get('stateInput') or sample.get('features') or []
    if entry is None:
      entry = {
        'stateInput': state_input,
        'policyTarget': None,
        'valueTarget': None,
        'identityTargets': [],
      }
      combined[key] = entry
    elif not entry.get('stateInput') and state_input:
      entry['stateInput'] = state_input
    return entry

  policy_samples = payload.get('samples', {}).get('policySamples') or []
  value_samples = payload.get('samples', {}).get('valueSamples') or []
  identity_samples = payload.get('samples', {}).get('identitySamples') or []

  for index, sample in enumerate(policy_samples):
    if not isinstance(sample, dict):
      continue
    entry = ensure_entry(sample, make_key(sample, 'policy', index))
    entry['policyTarget'] = sample.get('target') or None

  for index, sample in enumerate(value_samples):
    if not isinstance(sample, dict):
      continue
    entry = ensure_entry(sample, make_key(sample, 'value', index))
    target = sample.get('target')
    if isinstance(target, (int, float)):
      entry['valueTarget'] = float(target)

  for index, sample in enumerate(identity_samples):
    if not isinstance(sample, dict):
      continue
    entry = ensure_entry(sample, make_key(sample, 'identity', index))
    piece_slot = sample.get('pieceSlot')
    truth_index = sample.get('trueIdentityIndex')
    if isinstance(piece_slot, int) and isinstance(truth_index, int):
      entry['identityTargets'].append({
        'pieceSlot': piece_slot,
        'truthIndex': truth_index,
      })

  return list(combined.values())


def normalize_shared_samples(payload: dict[str, Any], state_input_size: int, policy_output_size: int, belief_slot_count: int, belief_identity_count: int) -> list[dict[str, Any]]:
  raw_shared_samples = payload.get('sharedSamples')
  if not isinstance(raw_shared_samples, list):
    raw_shared_samples = build_shared_samples_from_legacy_payload(payload)

  normalized = []
  for sample in raw_shared_samples or []:
    if not isinstance(sample, dict):
      continue
    state_input = sample.get('stateInput') or sample.get('features') or []
    if len(state_input) != state_input_size:
      continue
    policy_target = sample.get('policyTarget')
    if policy_target is None:
      policy_target = sample.get('target')
    normalized_policy_target = None
    if isinstance(policy_target, list):
      normalized_policy_target = normalize_target(policy_target)
      if len(normalized_policy_target) != policy_output_size:
        normalized_policy_target = None

    value_target = sample.get('valueTarget')
    if not isinstance(value_target, (int, float)):
      value_target = None

    identity_targets = []
    for identity_target in sample.get('identityTargets') or []:
      if not isinstance(identity_target, dict):
        continue
      piece_slot = identity_target.get('pieceSlot')
      truth_index = identity_target.get('truthIndex', identity_target.get('trueIdentityIndex'))
      if not isinstance(piece_slot, int) or piece_slot < 0 or piece_slot >= belief_slot_count:
        continue
      if not isinstance(truth_index, int) or truth_index < 0 or truth_index >= belief_identity_count:
        continue
      identity_targets.append({
        'pieceSlot': piece_slot,
        'truthIndex': truth_index,
      })

    if normalized_policy_target is None and value_target is None and not identity_targets:
      continue

    normalized.append({
      'stateInput': state_input,
      'policyTarget': normalized_policy_target,
      'valueTarget': float(value_target) if value_target is not None else None,
      'identityTargets': identity_targets,
    })
  return normalized


def maybe_pin_tensor(tensor: torch.Tensor, enabled: bool) -> torch.Tensor:
  if not enabled or not isinstance(tensor, torch.Tensor) or tensor.device.type != 'cpu':
    return tensor
  try:
    return tensor.pin_memory()
  except Exception:
    return tensor


def build_shared_training_batch_data(samples: list[dict[str, Any]], device: torch.device) -> dict[str, Any]:
  state_inputs = torch.tensor([sample['stateInput'] for sample in samples], dtype=torch.float32)
  policy_target_size = 0
  for sample in samples:
    if isinstance(sample.get('policyTarget'), list):
      policy_target_size = len(sample['policyTarget'])
      break
  policy_mask = torch.tensor(
    [1 if isinstance(sample.get('policyTarget'), list) else 0 for sample in samples],
    dtype=torch.bool,
  )
  policy_targets = torch.zeros((len(samples), policy_target_size), dtype=torch.float32) if policy_target_size > 0 else None
  if policy_targets is not None:
    for index, sample in enumerate(samples):
      if isinstance(sample.get('policyTarget'), list):
        policy_targets[index] = torch.tensor(sample['policyTarget'], dtype=torch.float32)
  value_mask = torch.tensor(
    [1 if isinstance(sample.get('valueTarget'), (int, float)) else 0 for sample in samples],
    dtype=torch.bool,
  )
  value_targets = torch.zeros(len(samples), dtype=torch.float32) if bool(value_mask.any().item()) else None
  if value_targets is not None:
    for index, sample in enumerate(samples):
      if isinstance(sample.get('valueTarget'), (int, float)):
        value_targets[index] = float(sample['valueTarget'])
  identity_targets_by_sample = []
  for sample in samples:
    per_sample = []
    for identity_target in sample.get('identityTargets') or []:
      per_sample.append((
        int(identity_target['pieceSlot']),
        int(identity_target['truthIndex']),
      ))
    identity_targets_by_sample.append(per_sample)

  use_pinned_memory = device.type == 'cuda'
  return {
    'stateInputs': maybe_pin_tensor(state_inputs, use_pinned_memory),
    'policyMask': maybe_pin_tensor(policy_mask, use_pinned_memory),
    'policyTargets': maybe_pin_tensor(policy_targets, use_pinned_memory) if policy_targets is not None else None,
    'valueMask': maybe_pin_tensor(value_mask, use_pinned_memory),
    'valueTargets': maybe_pin_tensor(value_targets, use_pinned_memory) if value_targets is not None else None,
    'identityTargetsBySample': identity_targets_by_sample,
    'usePinnedMemory': use_pinned_memory,
  }


def create_shared_training_session(session_id: str | None, payload: dict[str, Any]) -> dict[str, Any]:
  device = choose_device(payload.get('devicePreference'))
  model_bundle = copy.deepcopy(payload.get('modelBundle') or {})
  optimizer_state = payload.get('optimizerState') or {}
  training_options = payload.get('trainingOptions') or {}
  amp_enabled = device.type == 'cuda' and payload.get('enableAmp', True) is not False
  compile_enabled = device.type == 'cuda' and payload.get('enableCompile', True) is not False
  encoder_model = JsonMlp(model_bundle['encoder']['network']).to(device)
  policy_model = JsonMlp(model_bundle['policy']['network']).to(device)
  value_model = JsonMlp(model_bundle['value']['network']).to(device)
  identity_model = JsonMlp(model_bundle['identity']['network']).to(device)

  load_network_into_model(encoder_model, model_bundle['encoder']['network'], device)
  load_network_into_model(policy_model, model_bundle['policy']['network'], device)
  load_network_into_model(value_model, model_bundle['value']['network'], device)
  load_network_into_model(identity_model, model_bundle['identity']['network'], device)

  encoder_optimizer = build_optimizer(
    encoder_model,
    training_options.get('learningRate', 0.0025),
    training_options.get('weightDecay', 0.0001),
    optimizer_state.get('encoder'),
    device,
  )
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

  compiled_encoder, encoder_compiled = maybe_compile_module(encoder_model, compile_enabled)
  compiled_policy, policy_compiled = maybe_compile_module(policy_model, compile_enabled)
  compiled_value, value_compiled = maybe_compile_module(value_model, compile_enabled)
  compiled_identity, identity_compiled = maybe_compile_module(identity_model, compile_enabled)

  return {
    'sessionId': session_id,
    'device': device,
    'modelBundleTemplate': model_bundle,
    'stateInputSize': int(model_bundle.get('interface', {}).get('stateInputSize', model_bundle.get('encoder', {}).get('network', {}).get('inputSize', 0) or 0)),
    'policyOutputSize': int(model_bundle.get('policy', {}).get('network', {}).get('outputSize', 0) or 0),
    'beliefSlotCount': int(model_bundle.get('identity', {}).get('beliefSlotCount', model_bundle.get('interface', {}).get('beliefPieceSlotsPerPerspective', 0) or 0)),
    'beliefIdentityCount': len(model_bundle.get('identity', {}).get('inferredIdentities') or []),
    'policyTemperature': float(model_bundle.get('policy', {}).get('temperature', 1.0) or 1.0),
    'encoderModel': encoder_model,
    'policyModel': policy_model,
    'valueModel': value_model,
    'identityModel': identity_model,
    'encoderForward': compiled_encoder,
    'policyForward': compiled_policy,
    'valueForward': compiled_value,
    'identityForward': compiled_identity,
    'encoderOptimizer': encoder_optimizer,
    'policyOptimizer': policy_optimizer,
    'valueOptimizer': value_optimizer,
    'identityOptimizer': identity_optimizer,
    'ampEnabled': amp_enabled,
    'compileEnabled': compile_enabled and (encoder_compiled or policy_compiled or value_compiled or identity_compiled),
    'scaler': create_grad_scaler(amp_enabled),
  }


def export_shared_training_session(session: dict[str, Any], include_optimizer_state: bool = True) -> dict[str, Any]:
  model_bundle = session['modelBundleTemplate']
  result = {
    'backend': 'python',
    'device': str(session['device']),
    'cudaAvailable': bool(torch.cuda.is_available()),
    'torchVersion': torch.__version__,
    'ampEnabled': bool(session.get('ampEnabled')),
    'compileEnabled': bool(session.get('compileEnabled')),
    'modelBundle': {
      **model_bundle,
      'encoder': {
        **model_bundle.get('encoder', {}),
        'network': export_model_to_network(session['encoderModel'], model_bundle['encoder']['network']),
      },
      'policy': {
        **model_bundle.get('policy', {}),
        'network': export_model_to_network(session['policyModel'], model_bundle['policy']['network']),
      },
      'value': {
        **model_bundle.get('value', {}),
        'network': export_model_to_network(session['valueModel'], model_bundle['value']['network']),
      },
      'identity': {
        **model_bundle.get('identity', {}),
        'network': export_model_to_network(session['identityModel'], model_bundle['identity']['network']),
      },
    },
    'optimizerState': None,
  }
  if include_optimizer_state:
    result['optimizerState'] = {
      'encoder': serialize_optimizer_state(session['encoderOptimizer']),
      'policy': serialize_optimizer_state(session['policyOptimizer']),
      'value': serialize_optimizer_state(session['valueOptimizer']),
      'identity': serialize_optimizer_state(session['identityOptimizer']),
    }
  return result


def train_shared_session(session: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
  training_options = payload.get('trainingOptions') or {}
  apply_training_thread_budget(training_options, session.get('device'))
  epochs = max(1, int(payload.get('epochs', 1)))
  batch_size = max(1, int(training_options.get('batchSize', 24)))
  clip_norm = max(0.0, float(training_options.get('gradientClipNorm', 0.0)))
  safe_temperature = float(session.get('policyTemperature', 1.0) or 1.0)
  valid_samples = normalize_shared_samples(
    payload,
    session['stateInputSize'],
    session['policyOutputSize'],
    session['beliefSlotCount'],
    session['beliefIdentityCount'],
  )
  history = []
  if not valid_samples:
    return {
      'history': [{
        'epoch': 1,
        'policyLoss': 0.0,
        'valueLoss': 0.0,
        'identityLoss': 0.0,
        'identityAccuracy': 0.0,
        'policySamples': 0,
        'valueSamples': 0,
      'identitySamples': 0,
      }],
    }
  batch_data = build_shared_training_batch_data(valid_samples, session['device'])
  non_blocking = bool(batch_data.get('usePinnedMemory'))

  def run_fused_training_epoch() -> dict[str, Any]:
    shuffled_indices = list(range(len(valid_samples)))
    random.shuffle(shuffled_indices)
    policy_total_loss = 0.0
    value_total_loss = 0.0
    identity_total_loss = 0.0
    policy_processed = 0
    value_processed = 0
    identity_processed = 0
    identity_correct = 0

    for start in range(0, len(shuffled_indices), batch_size):
      batch_indices = shuffled_indices[start:start + batch_size]
      batch_index_tensor_cpu = torch.tensor(batch_indices, dtype=torch.long)
      state_input = batch_data['stateInputs'].index_select(0, batch_index_tensor_cpu).to(
        session['device'],
        non_blocking=non_blocking,
      )
      policy_indices = []
      value_indices = []
      identity_state_indices = []
      identity_piece_slots = []
      identity_truth_indices = []

      policy_mask = batch_data['policyMask'].index_select(0, batch_index_tensor_cpu)
      if bool(policy_mask.any().item()):
        policy_indices = torch.nonzero(policy_mask, as_tuple=False).flatten().tolist()
      value_mask = batch_data['valueMask'].index_select(0, batch_index_tensor_cpu)
      if bool(value_mask.any().item()):
        value_indices = torch.nonzero(value_mask, as_tuple=False).flatten().tolist()

      for local_index, sample_index in enumerate(batch_indices):
        for piece_slot, truth_index in batch_data['identityTargetsBySample'][sample_index]:
          identity_state_indices.append(local_index)
          identity_piece_slots.append(piece_slot)
          identity_truth_indices.append(truth_index)

      active_optimizers = [session['encoderOptimizer']]
      active_parameters = list(session['encoderModel'].parameters())
      session['encoderOptimizer'].zero_grad(set_to_none=True)
      if policy_indices:
        session['policyOptimizer'].zero_grad(set_to_none=True)
        active_optimizers.append(session['policyOptimizer'])
        active_parameters.extend(list(session['policyModel'].parameters()))
      if value_indices:
        session['valueOptimizer'].zero_grad(set_to_none=True)
        active_optimizers.append(session['valueOptimizer'])
        active_parameters.extend(list(session['valueModel'].parameters()))
      if identity_truth_indices:
        session['identityOptimizer'].zero_grad(set_to_none=True)
        active_optimizers.append(session['identityOptimizer'])
        active_parameters.extend(list(session['identityModel'].parameters()))

      with get_autocast_context(session['device'], bool(session.get('ampEnabled'))):
        latent = session['encoderForward'](state_input)
        total_loss = None
        policy_loss = None
        value_loss = None
        identity_loss = None

        if policy_indices:
          policy_local_indices = torch.tensor(policy_indices, dtype=torch.long, device=session['device'])
          policy_target_indices = batch_index_tensor_cpu[policy_indices]
          policy_target_tensor = batch_data['policyTargets'].index_select(0, policy_target_indices).to(
            session['device'],
            non_blocking=non_blocking,
          )
          policy_latent = latent[policy_local_indices]
          logits = session['policyForward'](policy_latent) / safe_temperature
          log_probs = F.log_softmax(logits, dim=1)
          policy_loss = -(policy_target_tensor * log_probs).sum(dim=1).mean()
          total_loss = policy_loss if total_loss is None else (total_loss + policy_loss)

        if value_indices:
          value_local_indices = torch.tensor(value_indices, dtype=torch.long, device=session['device'])
          value_target_indices = batch_index_tensor_cpu[value_indices]
          value_target_tensor = batch_data['valueTargets'].index_select(0, value_target_indices).to(
            session['device'],
            non_blocking=non_blocking,
          ).unsqueeze(1)
          value_latent = latent[value_local_indices]
          raw = session['valueForward'](value_latent)
          pred = torch.tanh(raw)
          value_loss = F.mse_loss(pred, value_target_tensor)
          total_loss = value_loss if total_loss is None else (total_loss + value_loss)

        if identity_truth_indices:
          identity_state_tensor = torch.tensor(identity_state_indices, dtype=torch.long, device=session['device'])
          identity_piece_tensor = torch.tensor(identity_piece_slots, dtype=torch.long, device=session['device'])
          identity_target_tensor = torch.tensor(identity_truth_indices, dtype=torch.long, device=session['device'])
          identity_logits = session['identityForward'](latent).reshape(len(batch_indices), session['beliefSlotCount'], session['beliefIdentityCount'])
          selected_logits = identity_logits[identity_state_tensor, identity_piece_tensor]
          identity_loss = F.cross_entropy(selected_logits, identity_target_tensor)
          total_loss = identity_loss if total_loss is None else (total_loss + identity_loss)
        else:
          selected_logits = None
          identity_target_tensor = None

      if total_loss is None:
        continue

      scaler = session.get('scaler')
      if scaler is not None:
        scaler.scale(total_loss).backward()
        if clip_norm > 0:
          for optimizer in active_optimizers:
            scaler.unscale_(optimizer)
          torch.nn.utils.clip_grad_norm_(active_parameters, clip_norm)
        for optimizer in active_optimizers:
          scaler.step(optimizer)
        scaler.update()
      else:
        total_loss.backward()
        if clip_norm > 0:
          torch.nn.utils.clip_grad_norm_(active_parameters, clip_norm)
        for optimizer in active_optimizers:
          optimizer.step()

      if policy_loss is not None:
        policy_total_loss += float(policy_loss.detach().item()) * len(policy_indices)
        policy_processed += len(policy_indices)
      if value_loss is not None:
        value_total_loss += float(value_loss.detach().item()) * len(value_indices)
        value_processed += len(value_indices)
      if identity_loss is not None and selected_logits is not None and identity_target_tensor is not None:
        identity_total_loss += float(identity_loss.detach().item()) * len(identity_truth_indices)
        identity_processed += len(identity_truth_indices)
        predictions = torch.argmax(selected_logits.detach(), dim=1)
        identity_correct += int((predictions == identity_target_tensor).sum().item())

    return {
      'policyLoss': (policy_total_loss / policy_processed) if policy_processed > 0 else 0.0,
      'valueLoss': (value_total_loss / value_processed) if value_processed > 0 else 0.0,
      'identityLoss': (identity_total_loss / identity_processed) if identity_processed > 0 else 0.0,
      'identityAccuracy': (identity_correct / identity_processed) if identity_processed > 0 else 0.0,
      'policySamples': int(policy_processed),
      'valueSamples': int(value_processed),
      'identitySamples': int(identity_processed),
    }

  for epoch_index in range(epochs):
    try:
      epoch_metrics = run_fused_training_epoch()
    except Exception as err:
      if session.get('compileEnabled') and is_compile_runtime_error(err):
        disable_session_compile(session)
        epoch_metrics = run_fused_training_epoch()
      else:
        raise

    history.append({
      'epoch': epoch_index + 1,
      'policyLoss': epoch_metrics['policyLoss'],
      'valueLoss': epoch_metrics['valueLoss'],
      'identityLoss': epoch_metrics['identityLoss'],
      'identityAccuracy': epoch_metrics['identityAccuracy'],
      'policySamples': epoch_metrics['policySamples'],
      'valueSamples': epoch_metrics['valueSamples'],
      'identitySamples': epoch_metrics['identitySamples'],
    })

  return {'history': history}


def get_or_create_shared_training_session(payload: dict[str, Any]) -> dict[str, Any]:
  session_id = str(payload.get('sessionId') or '').strip()
  if not session_id:
    raise RuntimeError('Shared training session id is required')
  reset_session = payload.get('resetSession') is True
  session = None if reset_session else TRAINER_SESSIONS.get(session_id)
  if session is None:
    session = create_shared_training_session(session_id, payload)
    TRAINER_SESSIONS[session_id] = session
  return session


def close_training_session(session_id: str) -> bool:
  if not session_id:
    return False
  session = TRAINER_SESSIONS.pop(session_id, None)
  if session is None:
    return False
  del session
  if torch.cuda.is_available():
    try:
      torch.cuda.empty_cache()
    except Exception:
      pass
  return True


def train_shared_bundle(payload: dict[str, Any]) -> dict[str, Any]:
  session = create_shared_training_session(None, payload)
  training_result = train_shared_session(session, payload)
  exported = export_shared_training_session(session, include_optimizer_state=True)
  exported['history'] = training_result.get('history') or []
  return exported


def train_bundle(payload: dict[str, Any]) -> dict[str, Any]:
  device = choose_device(payload.get('devicePreference'))
  model_bundle = payload.get('modelBundle') or {}
  if is_shared_bundle(model_bundle):
    return train_shared_bundle(payload)
  optimizer_state = payload.get('optimizerState') or {}
  training_options = payload.get('trainingOptions') or {}
  apply_training_thread_budget(training_options, device)
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
    cuda_total_memory_mb = None
    if torch.cuda.is_available():
      try:
        cuda_total_memory_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
      except Exception:
        cuda_total_memory_mb = None
    return {
      'backend': 'python',
      'torchVersion': torch.__version__,
      'cudaAvailable': bool(torch.cuda.is_available()),
      'cudaDeviceCount': int(torch.cuda.device_count()) if torch.cuda.is_available() else 0,
      'cudaDeviceName': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
      'cudaTotalMemoryMb': cuda_total_memory_mb,
      'cpuCount': RUNTIME_CONFIG['cpuCount'],
      'torchNumThreads': RUNTIME_CONFIG['torchNumThreads'],
      'torchNumInteropThreads': RUNTIME_CONFIG['torchNumInteropThreads'],
      'pythonVersion': sys.version.split()[0],
    }
  if command == 'train_batch':
    return train_bundle(payload)
  if command == 'train_session_batch':
    session = get_or_create_shared_training_session(payload)
    result = train_shared_session(session, payload)
    response = {
      'backend': 'python',
      'device': str(session['device']),
      'cudaAvailable': bool(torch.cuda.is_available()),
      'torchVersion': torch.__version__,
      'ampEnabled': bool(session.get('ampEnabled')),
      'compileEnabled': bool(session.get('compileEnabled')),
      'sessionId': session.get('sessionId'),
      'history': result.get('history') or [],
    }
    if payload.get('exportState') is True:
      exported = export_shared_training_session(
        session,
        include_optimizer_state=payload.get('includeOptimizerState', True) is True,
      )
      response['modelBundle'] = exported.get('modelBundle')
      response['optimizerState'] = exported.get('optimizerState')
    return response
  if command == 'export_training_session':
    session_id = str(payload.get('sessionId') or '').strip()
    if not session_id:
      raise RuntimeError('Training session id is required')
    session = TRAINER_SESSIONS.get(session_id)
    if session is None:
      raise RuntimeError(f'Training session {session_id} is not active')
    exported = export_shared_training_session(
      session,
      include_optimizer_state=payload.get('includeOptimizerState', True) is True,
    )
    exported['sessionId'] = session_id
    return exported
  if command == 'close_training_session':
    session_id = str(payload.get('sessionId') or '').strip()
    return {
      'sessionId': session_id,
      'closed': close_training_session(session_id),
    }
  raise RuntimeError(f'Unsupported command: {command or "unknown"}')


def main() -> None:
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


RUNTIME_CONFIG = configure_torch_runtime()

if __name__ == '__main__':
  main()
