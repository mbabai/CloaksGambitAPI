"""Neural network definition for Cloaks' Gambit training.

The architecture follows a residual CNN body with three separate heads for policy,
value, and guess predictions. Channel and board dimensions are placeholders and
should be aligned with the actual game representation.
"""
from __future__ import annotations

from typing import Dict

import torch
from torch import nn


class ResidualBlock(nn.Module):
    """Simple residual block with batch normalization."""

    def __init__(self, channels: int) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.relu = nn.ReLU(inplace=True)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # pragma: no cover - standard block
        residual = x
        out = self.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out += residual
        return self.relu(out)


class CloaksGambitNet(nn.Module):
    """Baseline convolutional neural network with three prediction heads."""

    def __init__(self, input_channels: int = 12, board_size: int = 8, num_res_blocks: int = 4) -> None:
        super().__init__()
        self.board_size = board_size

        self.input = nn.Sequential(
            nn.Conv2d(input_channels, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
        )

        blocks = [ResidualBlock(128) for _ in range(num_res_blocks)]
        self.residual_layers = nn.Sequential(*blocks)

        # Policy head
        self.policy_head = nn.Sequential(
            nn.Conv2d(128, 64, kernel_size=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Flatten(),
            nn.Linear(64 * board_size * board_size, board_size * board_size),
        )

        # Value head
        self.value_head = nn.Sequential(
            nn.Conv2d(128, 32, kernel_size=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Flatten(),
            nn.Linear(32 * board_size * board_size, 256),
            nn.ReLU(inplace=True),
            nn.Linear(256, 1),
            nn.Tanh(),
        )

        # Guess head (for hidden information inference)
        self.guess_head = nn.Sequential(
            nn.Conv2d(128, 32, kernel_size=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Flatten(),
            nn.Linear(32 * board_size * board_size, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, 1),
        )

    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Forward pass returning a dictionary of head outputs."""

        features = self.residual_layers(self.input(x))
        policy = self.policy_head(features)
        value = self.value_head(features)
        guess = self.guess_head(features)
        return {"policy": policy, "value": value, "guess": guess}


__all__ = ["CloaksGambitNet"]
