"""Training orchestration utilities for Cloaks' Gambit.

This module intentionally contains scaffolding that still needs integration with the
actual game server data formats and MongoDB schemas. The goal is to provide a
clear extension point for future development.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List

import torch
from torch import nn
from torch.optim import Optimizer

from model_def import CloaksGambitNet

# TODO: configure real MongoDB client and collections.
# from motor.motor_asyncio import AsyncIOMotorClient


@dataclass
class ReplaySample:
    """Container for a single replay buffer entry."""

    state: torch.Tensor
    policy: torch.Tensor
    value: torch.Tensor
    guess: torch.Tensor


class ReplayBuffer:
    """Fixed-size buffer storing recent simulation samples."""

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.buffer: List[ReplaySample] = []

    def add(self, sample: ReplaySample) -> None:
        if len(self.buffer) >= self.capacity:
            self.buffer.pop(0)
        self.buffer.append(sample)

    def extend(self, samples: Iterable[ReplaySample]) -> None:
        for sample in samples:
            self.add(sample)

    def __len__(self) -> int:  # pragma: no cover - simple delegation
        return len(self.buffer)

    def to_batches(self, batch_size: int) -> Iterable[List[ReplaySample]]:
        """Yield mini-batches of samples."""

        for idx in range(0, len(self.buffer), batch_size):
            yield self.buffer[idx : idx + batch_size]


@dataclass
class TrainingRun:
    """Metadata container tracked during a training run."""

    run_id: str
    model_id: str
    dataset_id: str
    hyperparams: Dict[str, Any]
    notes: str | None = None
    status: str = "queued"
    metrics: List[Dict[str, Any]] = field(default_factory=list)


class TrainingManager:
    """Coordinates training runs, replay buffers, and metrics streaming."""

    def __init__(self, models_dir: Path, runs_dir: Path, config_path: Path) -> None:
        self.models_dir = models_dir
        self.runs_dir = runs_dir
        self.config_path = config_path
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

        self._runs: Dict[str, TrainingRun] = {}
        self._listeners: Dict[str, List[asyncio.Queue]] = {}
        self._listener_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

        # Placeholder for MongoDB. Configure AsyncIOMotorClient here.
        # self.db_client = AsyncIOMotorClient("mongodb://localhost:27017")  # TODO: move to env var
        # self.db = self.db_client["cloaks_gambit"]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def create_model_record(self, name: str, description: str | None) -> Dict[str, Any]:
        """Create a new model entry and stub checkpoint directory."""

        model_id = uuid.uuid4().hex
        model_dir = self.models_dir / model_id
        model_dir.mkdir(parents=True, exist_ok=True)
        metadata = {
            "_id": model_id,
            "name": name,
            "description": description,
            "created_at": time.time(),
        }

        # TODO: persist to MongoDB collection `models`.
        metadata_path = model_dir / "metadata.json"
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return metadata

    def schedule_training(
        self,
        *,
        dataset_id: str,
        model_id: str,
        hyperparams: Dict[str, Any],
        notes: str | None,
    ) -> str:
        """Create a training run entry and enqueue it for execution."""

        run_id = uuid.uuid4().hex
        training_run = TrainingRun(
            run_id=run_id,
            model_id=model_id,
            dataset_id=dataset_id,
            hyperparams=hyperparams,
            notes=notes,
            status="scheduled",
        )
        self._runs[run_id] = training_run

        # TODO: insert into MongoDB `training_runs` collection.
        run_path = self.runs_dir / f"{run_id}.json"
        run_path.write_text(json.dumps(training_run.__dict__, indent=2), encoding="utf-8")
        return run_id

    # ------------------------------------------------------------------
    # Metrics streaming helpers
    # ------------------------------------------------------------------

    def register_listener(self, run_id: str) -> "asyncio.Queue[Dict[str, Any]]":
        queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
        if self._loop is None:
            self._loop = asyncio.get_event_loop()
        with self._listener_lock:
            self._listeners.setdefault(run_id, []).append(queue)
        return queue

    def unregister_listener(self, run_id: str, queue_obj: "asyncio.Queue[Dict[str, Any]]") -> None:
        with self._listener_lock:
            listeners = self._listeners.get(run_id, [])
            if queue_obj in listeners:
                listeners.remove(queue_obj)

    def _broadcast(self, run_id: str, payload: Dict[str, Any]) -> None:
        with self._listener_lock:
            queues = list(self._listeners.get(run_id, []))

        loop = self._loop
        if loop is None:
            return
        for q in queues:
            asyncio.run_coroutine_threadsafe(q.put(payload), loop=loop)

    # ------------------------------------------------------------------
    # Gradio callback helpers
    # ------------------------------------------------------------------

    def gradio_training_handler(
        self, dataset_id: str, model_id: str, hyperparams: Dict[str, Any], notes: str | None
    ) -> Dict[str, Any]:
        """Callback used by Gradio to trigger a training run."""

        run_id = self.schedule_training(
            dataset_id=dataset_id,
            model_id=model_id,
            hyperparams=hyperparams,
            notes=notes,
        )
        threading.Thread(target=self.execute_training, args=(run_id,), daemon=True).start()
        return {"status": "started", "run_id": run_id}

    def gradio_batch_handler(self, batch_plan: Dict[str, Any]) -> Dict[str, Any]:
        """Placeholder handler for the Batch tab."""

        # TODO: implement job scheduling.
        return {"status": "queued", "details": batch_plan}

    # ------------------------------------------------------------------
    # Training execution
    # ------------------------------------------------------------------

    def execute_training(self, run_id: str) -> None:
        """Simplified training loop placeholder."""

        run = self._runs.get(run_id)
        if not run:
            return

        run.status = "running"
        self._broadcast(run_id, {"status": run.status, "run_id": run_id})

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = CloaksGambitNet().to(device)

        # TODO: load optimizer, scheduler, dataset, and actual batches
        optimizer = self._configure_optimizer(model, run.hyperparams)
        replay_buffer = ReplayBuffer(capacity=int(run.hyperparams.get("replay_buffer_size", 1000)))

        lambda_guess = float(run.hyperparams.get("λ_guess", run.hyperparams.get("lambda_guess", 1.0)))

        for epoch in range(int(run.hyperparams.get("epochs", 1))):
            time.sleep(0.5)  # Simulate work
            loss = self._perform_fake_training_step(
                model, optimizer, replay_buffer, device, lambda_guess=lambda_guess
            )

            metric = {"epoch": epoch + 1, "loss": loss}
            run.metrics.append(metric)
            self._broadcast(run_id, {"run_id": run_id, "metric": metric})

        run.status = "completed"
        self._broadcast(run_id, {"status": run.status, "run_id": run_id})

        # TODO: persist final metrics and checkpoints to disk + MongoDB.

    # ------------------------------------------------------------------
    # Internal training utilities
    # ------------------------------------------------------------------

    def _configure_optimizer(self, model: nn.Module, hyperparams: Dict[str, Any]) -> Optimizer:
        lr = float(hyperparams.get("learning_rate", 3e-4))
        weight_decay = float(hyperparams.get("weight_decay", 0.0))
        optimizer_name = str(hyperparams.get("optimizer", "Adam")).lower()

        if optimizer_name == "adam":
            return torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
        if optimizer_name == "sgd":
            return torch.optim.SGD(model.parameters(), lr=lr, weight_decay=weight_decay, momentum=0.9)

        raise ValueError(f"Unsupported optimizer: {optimizer_name}")

    def _perform_fake_training_step(
        self,
        model: nn.Module,
        optimizer: Optimizer,
        replay_buffer: ReplayBuffer,
        device: torch.device,
        *,
        lambda_guess: float,
    ) -> float:
        """Placeholder training logic using random tensors.

        Replace with dataset iteration, loss computation across the policy/value/guess
        heads, and gradient updates with optional mixed precision via ``torch.cuda.amp``.
        """

        optimizer.zero_grad()
        dummy_input = torch.randn(8, 12, 8, 8, device=device)  # TODO: match board encoding
        policy_target = torch.randn(8, 64, device=device)
        value_target = torch.randn(8, 1, device=device)
        guess_target = torch.randn(8, 1, device=device)

        model.train()
        outputs = model(dummy_input)

        policy_loss = torch.nn.functional.mse_loss(outputs["policy"], policy_target)
        value_loss = torch.nn.functional.mse_loss(outputs["value"], value_target)
        guess_loss = torch.nn.functional.mse_loss(outputs["guess"], guess_target)

        loss = policy_loss + value_loss + lambda_guess * guess_loss
        loss.backward()
        optimizer.step()

        return float(loss.item())

