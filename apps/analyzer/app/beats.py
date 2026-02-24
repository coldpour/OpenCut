from __future__ import annotations

from pathlib import Path

from app.audio_sync import _envelope_downsample, load_wav_mono


def _moving_average(values: list[float], window: int) -> list[float]:
    if window <= 1 or not values:
        return values[:]
    result: list[float] = []
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= window:
            running -= values[index - window]
        count = min(window, index + 1)
        result.append(running / count)
    return result


def detect_beat_markers(
    *,
    signal: list[float],
    sample_rate: int,
    target_rate: int = 120,
    min_spacing_seconds: float = 0.22,
    max_markers: int = 2000,
) -> list[float]:
    if sample_rate <= 0 or not signal:
        return []

    envelope, envelope_rate = _envelope_downsample(
        signal=signal,
        sample_rate=sample_rate,
        target_rate=target_rate,
    )
    if not envelope or envelope_rate <= 0:
        return []

    fast = _moving_average(envelope, max(1, int(0.05 * envelope_rate)))
    slow = _moving_average(envelope, max(1, int(0.35 * envelope_rate)))
    flux = [max(0.0, fast[index] - slow[index]) for index in range(len(envelope))]
    if not flux:
        return []

    local_floor = _moving_average(flux, max(1, int(0.6 * envelope_rate)))
    min_spacing_samples = max(1, int(min_spacing_seconds * envelope_rate))
    threshold_floor = max(flux) * 0.12 if flux else 0.0

    markers: list[float] = []
    last_pick = -min_spacing_samples
    for index in range(1, len(flux) - 1):
        value = flux[index]
        dynamic_threshold = max(threshold_floor, local_floor[index] * 1.35)
        if value < dynamic_threshold:
            continue
        if value < flux[index - 1] or value < flux[index + 1]:
            continue
        if index - last_pick < min_spacing_samples:
            if markers and value > flux[last_pick]:
                markers[-1] = index / float(envelope_rate)
                last_pick = index
            continue
        markers.append(index / float(envelope_rate))
        last_pick = index
        if len(markers) >= max_markers:
            break

    return markers


def detect_beat_markers_from_wav_file(
    *,
    wav_path: Path,
    target_rate: int = 120,
) -> list[float]:
    signal, sample_rate = load_wav_mono(wav_path)
    return detect_beat_markers(
        signal=signal,
        sample_rate=sample_rate,
        target_rate=target_rate,
    )

