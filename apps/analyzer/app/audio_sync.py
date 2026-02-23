from __future__ import annotations

import array
import math
import wave
from pathlib import Path


def _normalize(signal: list[float]) -> list[float]:
    if not signal:
        return signal
    mean_value = sum(signal) / len(signal)
    centered = [sample - mean_value for sample in signal]
    energy = math.sqrt(sum(sample * sample for sample in centered))
    if energy <= 1e-9:
        return centered
    return [sample / energy for sample in centered]


def load_wav_mono(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        frame_count = handle.getnframes()
        payload = handle.readframes(frame_count)

    if sample_width != 2:
        raise ValueError("Only 16-bit PCM wav files are supported")

    raw = array.array("h")
    raw.frombytes(payload)
    if channels <= 0:
        raise ValueError("Invalid channel count")

    if channels == 1:
        samples = [value / 32768.0 for value in raw]
    else:
        samples = []
        for index in range(0, len(raw), channels):
            channel_values = raw[index : index + channels]
            samples.append(sum(channel_values) / (32768.0 * channels))
    return samples, sample_rate


def _envelope_downsample(
    *,
    signal: list[float],
    sample_rate: int,
    target_rate: int = 200,
) -> tuple[list[float], int]:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if not signal:
        return [], sample_rate

    bucket_size = max(1, sample_rate // max(1, target_rate))
    if bucket_size == 1:
        return signal[:], sample_rate

    buckets: list[float] = []
    for start in range(0, len(signal), bucket_size):
        chunk = signal[start : start + bucket_size]
        if not chunk:
            continue
        # Use an amplitude envelope so sync remains robust across mix differences.
        buckets.append(sum(abs(sample) for sample in chunk) / len(chunk))
    reduced_rate = max(1, sample_rate // bucket_size)
    return buckets, reduced_rate


def _best_correlation_lag(
    *,
    normalized_reference: list[float],
    normalized_candidate: list[float],
    sample_rate: int,
    min_lag_samples: int,
    max_lag_samples: int,
) -> int:
    best_lag = 0
    best_score = float("-inf")

    for lag in range(min_lag_samples, max_lag_samples + 1):
        if lag >= 0:
            ref_slice = normalized_reference[: len(normalized_reference) - lag]
            cand_slice = normalized_candidate[lag:]
        else:
            ref_slice = normalized_reference[-lag:]
            cand_slice = normalized_candidate[: len(normalized_candidate) + lag]

        if not ref_slice or not cand_slice:
            continue

        length = min(len(ref_slice), len(cand_slice))
        if length < max(4, sample_rate // 5):
            continue

        score = 0.0
        for index in range(length):
            score += ref_slice[index] * cand_slice[index]

        if score > best_score:
            best_score = score
            best_lag = lag

    return best_lag


def estimate_sync_offset(
    *,
    reference: list[float],
    candidate: list[float],
    sample_rate: int,
    max_shift_seconds: float,
) -> float:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    # Two-stage correlation keeps runtime low on song-length audio:
    # 1) coarse search on a low-rate amplitude envelope
    # 2) refine around the best coarse lag on a higher-rate envelope
    coarse_reference, coarse_rate = _envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=24,
    )
    coarse_candidate, coarse_candidate_rate = _envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=24,
    )
    if coarse_rate != coarse_candidate_rate:
        raise ValueError("Coarse sample rates must match")

    coarse_max_shift_samples = int(max_shift_seconds * coarse_rate)
    coarse_lag = _best_correlation_lag(
        normalized_reference=_normalize(coarse_reference),
        normalized_candidate=_normalize(coarse_candidate),
        sample_rate=coarse_rate,
        min_lag_samples=-coarse_max_shift_samples,
        max_lag_samples=coarse_max_shift_samples,
    )

    fine_reference, fine_rate = _envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=180,
    )
    fine_candidate, fine_candidate_rate = _envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=180,
    )
    if fine_rate != fine_candidate_rate:
        raise ValueError("Fine sample rates must match")

    coarse_lag_seconds = coarse_lag / float(coarse_rate)
    fine_center_lag = int(round(coarse_lag_seconds * fine_rate))
    fine_max_shift_samples = int(max_shift_seconds * fine_rate)
    refine_window_samples = max(fine_rate * 3, int(fine_rate * 0.75))

    min_lag = max(-fine_max_shift_samples, fine_center_lag - refine_window_samples)
    max_lag = min(fine_max_shift_samples, fine_center_lag + refine_window_samples)

    fine_lag = _best_correlation_lag(
        normalized_reference=_normalize(fine_reference),
        normalized_candidate=_normalize(fine_candidate),
        sample_rate=fine_rate,
        min_lag_samples=min_lag,
        max_lag_samples=max_lag,
    )

    return fine_lag / float(fine_rate)


def estimate_sync_offset_from_wav_files(
    *,
    video_wav_path: Path,
    master_wav_path: Path,
    max_shift_seconds: float,
) -> float:
    reference, sample_rate_ref = load_wav_mono(video_wav_path)
    candidate, sample_rate_candidate = load_wav_mono(master_wav_path)
    if sample_rate_ref != sample_rate_candidate:
        raise ValueError("Sample rates must match")
    return estimate_sync_offset(
        reference=reference,
        candidate=candidate,
        sample_rate=sample_rate_ref,
        max_shift_seconds=max_shift_seconds,
    )
