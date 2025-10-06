"""Utilities for exporting trained PyTorch models to ONNX."""
from __future__ import annotations

from pathlib import Path

import torch

from model_def import CloaksGambitNet


def export_model_to_onnx(*, model_path: Path, export_path: Path, opset: int = 17) -> None:
    """Load a checkpoint from ``model_path`` and export ONNX to ``export_path``."""

    export_path.parent.mkdir(parents=True, exist_ok=True)
    model = CloaksGambitNet()

    # TODO: replace with actual checkpoint loading once training loop is implemented.
    if model_path.exists():
        state_dict = torch.load(model_path, map_location="cpu")
        if isinstance(state_dict, dict):
            model.load_state_dict(state_dict)

    model.eval()
    dummy_input = torch.randn(1, 12, 8, 8)

    torch.onnx.export(
        model,
        dummy_input,
        export_path,
        input_names=["board"],
        output_names=["policy", "value", "guess"],
        opset_version=opset,
        dynamic_axes={
            "board": {0: "batch"},
            "policy": {0: "batch"},
            "value": {0: "batch"},
            "guess": {0: "batch"},
        },
    )

