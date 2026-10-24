"""Environment for the AI models: download folders inside the project and device selection.

Import this module BEFORE torch / transformers / demucs / whisperx, so their caches point here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Every library keeps its downloads under services/audio/models (not the user profile).
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "huggingface"))
os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / "torch"))
os.environ.setdefault("NLTK_DATA", str(MODELS_DIR / "nltk_data"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


@dataclass
class Device:
    name: str  # "cuda" or "cpu"
    description: str  # what to tell the user

    @property
    def is_gpu(self) -> bool:
        return self.name == "cuda"


def choose_device(torch: Any, requested: str = "auto") -> Device:
    """GPU if a working CUDA device is there (and not turned off), else CPU, with the reason."""
    if requested == "cpu":
        return Device("cpu", "CPU (chosen with --device cpu)")
    if not torch.cuda.is_available():
        reason = "this PyTorch build has no CUDA support" if not torch.version.cuda else "no NVIDIA GPU / driver found"
        if requested == "cuda":
            raise RuntimeError(f"--device cuda was asked for, but {reason}")
        return Device("cpu", f"CPU ({reason})")
    try:
        # A tiny computation: catches builds without kernels for this GPU (e.g. too old for Blackwell).
        (torch.ones(8, device="cuda") * 2).sum().item()
    except Exception as error:  # noqa: BLE001 - any CUDA failure means: use the CPU
        if requested == "cuda":
            raise
        return Device("cpu", f"CPU (the GPU could not be used: {str(error).splitlines()[0]})")
    major, minor = torch.cuda.get_device_capability(0)
    return Device("cuda", f"GPU: {torch.cuda.get_device_name(0)} (CUDA {torch.version.cuda}, compute {major}.{minor})")


def with_cpu_fallback(device: Device, step: str, run: Callable[[str], Any], log: Callable[[str], None]) -> tuple[Any, Device]:
    """Runs `run(device.name)`; if the GPU fails mid-way, runs it again on the CPU and says so."""
    try:
        return run(device.name), device
    except Exception as error:  # noqa: BLE001
        if not device.is_gpu:
            raise
        log(f"{step} failed on the GPU ({str(error).splitlines()[0]}); retrying on the CPU")
        cpu = Device("cpu", "CPU (after a GPU error)")
        return run("cpu"), cpu
