from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def ffprobe_json(path: Path) -> dict[str, Any]:
    result = run_command(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(path),
        ]
    )
    return json.loads(result.stdout)


def media_duration_seconds(path: Path) -> float:
    payload = ffprobe_json(path)
    format_payload = payload.get("format", {})
    duration = format_payload.get("duration")
    if duration is None:
        return 0.0
    return float(duration)


def video_dimensions(path: Path) -> tuple[int, int]:
    payload = ffprobe_json(path)
    streams = payload.get("streams", [])
    for stream in streams:
        if stream.get("codec_type") == "video":
            width = int(stream.get("width", 0))
            height = int(stream.get("height", 0))
            if width > 0 and height > 0:
                return width, height
    raise ValueError(f"No video stream found in {path}")


def extract_audio_wav(input_path: Path, output_path: Path, sample_rate: int = 2000) -> None:
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
    )

