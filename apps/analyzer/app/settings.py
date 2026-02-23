from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class AnalyzerSettings:
    host: str = os.environ.get("AUTO_LIVE_CLIP_HOST", "127.0.0.1")
    port: int = int(os.environ.get("AUTO_LIVE_CLIP_PORT", "8765"))
    cache_dir: Path = Path(
        os.environ.get("AUTO_LIVE_CLIP_CACHE_DIR", "apps/analyzer/.cache")
    )
    temp_dir: Path = Path(
        os.environ.get("AUTO_LIVE_CLIP_TEMP_DIR", "apps/analyzer/.cache/tmp")
    )
    max_sync_shift_seconds: float = float(
        os.environ.get("AUTO_LIVE_CLIP_MAX_SYNC_SHIFT", "8.0")
    )


def get_settings() -> AnalyzerSettings:
    settings = AnalyzerSettings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    return settings

