from __future__ import annotations

from pathlib import Path
from typing import Any

from app.ffmpeg_utils import run_command, video_dimensions


RESOLUTION_PRESETS = {
    "1080p": (1920, 1080),
    "2k": (2560, 1440),
    "4k": (3840, 2160),
}


def resolution_for_preset(preset: str) -> tuple[int, int]:
    normalized = preset.lower().strip()
    if normalized not in RESOLUTION_PRESETS:
        raise ValueError(f"Unsupported preset: {preset}")
    return RESOLUTION_PRESETS[normalized]


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def _segment_crop(
    *,
    video_width: int,
    video_height: int,
    out_width: int,
    out_height: int,
    scale: float,
    position_x: float,
    position_y: float,
) -> tuple[int, int, int, int]:
    target_ratio = out_width / out_height
    safe_scale = max(1.0, min(scale, 2.5))

    crop_width = video_width / safe_scale
    crop_height = crop_width / target_ratio
    if crop_height > video_height:
        crop_height = video_height / safe_scale
        crop_width = crop_height * target_ratio

    crop_width = min(crop_width, video_width)
    crop_height = min(crop_height, video_height)

    center_x = (video_width / 2.0) + position_x * (video_width * 0.25)
    center_y = (video_height * 0.38) + position_y * (video_height * 0.20)
    x = _clamp(center_x - crop_width / 2.0, 0.0, float(video_width - crop_width))
    y = _clamp(center_y - crop_height / 2.0, 0.0, float(video_height - crop_height))

    return int(crop_width), int(crop_height), int(x), int(y)


def render_from_plan(
    *,
    video_path: Path,
    master_audio_path: Path,
    segments: list[dict[str, Any]],
    sync_offset_seconds: float,
    preset: str,
    output_path: Path,
    apply_privacy_blur: bool,
) -> None:
    if not segments:
        raise ValueError("segments cannot be empty")

    output_width, output_height = resolution_for_preset(preset)
    video_width, video_height = video_dimensions(video_path)

    filter_parts: list[str] = []
    concat_inputs: list[str] = []
    total_duration = 0.0

    for index, segment in enumerate(segments):
        source_start = float(segment["source_start"])
        source_end = float(segment["source_end"])
        transform = segment.get("transform", {})
        scale = float(transform.get("scale", 1.0))
        position_x = float(transform.get("position_x", 0.0))
        position_y = float(transform.get("position_y", -0.1))
        crop_w, crop_h, crop_x, crop_y = _segment_crop(
            video_width=video_width,
            video_height=video_height,
            out_width=output_width,
            out_height=output_height,
            scale=scale,
            position_x=position_x,
            position_y=position_y,
        )

        video_label = f"v{index}"
        filter_parts.append(
            (
                f"[0:v]trim=start={source_start:.6f}:end={source_end:.6f},"
                f"setpts=PTS-STARTPTS,crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
                f"scale={output_width}:{output_height},setsar=1[{video_label}]"
            )
        )

        blur_regions = segment.get("blur_regions", [])
        output_label = f"{video_label}o"
        if apply_privacy_blur and blur_regions:
            filter_parts.append(f"[{video_label}]split[{video_label}a][{video_label}b]")
            filter_parts.append(
                (
                    f"[{video_label}b]crop=iw:ih*0.3:0:ih*0.7,boxblur=20:2"
                    f"[{video_label}blur]"
                )
            )
            filter_parts.append(
                f"[{video_label}a][{video_label}blur]overlay=0:ih*0.7[{output_label}]"
            )
        else:
            filter_parts.append(f"[{video_label}]null[{output_label}]")

        concat_inputs.append(f"[{output_label}]")
        total_duration += max(0.0, source_end - source_start)

    filter_parts.append(
        f"{''.join(concat_inputs)}concat=n={len(segments)}:v=1:a=0[vout]"
    )

    # `sync_offset_seconds` is the lag returned by correlation where:
    # candidate(master)[t + lag] ~= reference(video)[t]
    # Positive lag means master is later than video in the source file and must be
    # advanced (trimmed) for video-anchored renders.
    if sync_offset_seconds >= 0:
        trim_start = sync_offset_seconds
        filter_parts.append(
            (
                f"[1:a]atrim=start={trim_start:.6f},asetpts=PTS-STARTPTS,"
                f"atrim=duration={total_duration:.6f}[aout]"
            )
        )
    else:
        delay_ms = int(abs(sync_offset_seconds) * 1000.0)
        filter_parts.append(
            f"[1:a]adelay={delay_ms}|{delay_ms},atrim=duration={total_duration:.6f},asetpts=PTS-STARTPTS[aout]"
        )

    filter_complex = ";".join(filter_parts)
    run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-i",
            str(master_audio_path),
            "-filter_complex",
            filter_complex,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
