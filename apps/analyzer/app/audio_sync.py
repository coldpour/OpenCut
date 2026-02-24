from __future__ import annotations

import array
import math
import wave
from pathlib import Path
from typing import Any

try:
    import numpy as np
except Exception:  # pragma: no cover - optional dependency fallback
    np = None


def _normalize(signal: list[float]) -> list[float]:
    if not signal:
        return signal
    mean_value = sum(signal) / len(signal)
    centered = [sample - mean_value for sample in signal]
    energy = math.sqrt(sum(sample * sample for sample in centered))
    if energy <= 1e-9:
        return centered
    return [sample / energy for sample in centered]


def _slice_overlap(
    *,
    reference: list[float],
    candidate: list[float],
    lag: int,
) -> tuple[list[float], list[float]]:
    if lag >= 0:
        cand_start = lag
        if cand_start >= len(candidate):
            return [], []
        length = min(len(reference), len(candidate) - cand_start)
        if length <= 0:
            return [], []
        ref_slice = reference[:length]
        cand_slice = candidate[cand_start : cand_start + length]
    else:
        ref_start = -lag
        if ref_start >= len(reference):
            return [], []
        length = min(len(reference) - ref_start, len(candidate))
        if length <= 0:
            return [], []
        ref_slice = reference[ref_start : ref_start + length]
        cand_slice = candidate[:length]

    return ref_slice, cand_slice


def _local_ncc_score(
    *,
    reference: list[float],
    candidate: list[float],
    lag: int,
    sample_rate: int,
) -> tuple[float | None, int]:
    ref_slice, cand_slice = _slice_overlap(reference=reference, candidate=candidate, lag=lag)
    length = len(ref_slice)
    if length < max(4, sample_rate // 5):
        return None, length

    ref_mean = sum(ref_slice) / length
    cand_mean = sum(cand_slice) / length

    numerator = 0.0
    ref_energy = 0.0
    cand_energy = 0.0
    for index in range(length):
        ref_value = ref_slice[index] - ref_mean
        cand_value = cand_slice[index] - cand_mean
        numerator += ref_value * cand_value
        ref_energy += ref_value * ref_value
        cand_energy += cand_value * cand_value

    denominator = math.sqrt(ref_energy * cand_energy)
    if denominator <= 1e-9:
        return 0.0, length

    return numerator / denominator, length


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


def _moving_average_numpy(signal: "np.ndarray", window: int) -> "np.ndarray":
    if window <= 1 or signal.size == 0:
        return signal.copy()
    kernel = np.ones(window, dtype=np.float32) / float(window)
    return np.convolve(signal, kernel, mode="same")


def _vocal_emphasis_envelope_downsample(
    *,
    signal: list[float],
    sample_rate: int,
    target_rate: int = 200,
) -> tuple[list[float], int]:
    if np is None:
        return _envelope_downsample(
            signal=signal,
            sample_rate=sample_rate,
            target_rate=target_rate,
        )
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    if not signal:
        return [], sample_rate

    arr = np.asarray(signal, dtype=np.float32)
    if arr.size < 8:
        return _envelope_downsample(
            signal=signal,
            sample_rate=sample_rate,
            target_rate=target_rate,
        )

    arr = arr - np.mean(arr)
    spectrum = np.fft.rfft(arr)
    freqs = np.fft.rfftfreq(arr.size, d=1.0 / float(sample_rate))
    high_cut = min(1800.0, (sample_rate / 2.0) - 1.0)
    if high_cut <= 200.0:
        return _envelope_downsample(
            signal=signal,
            sample_rate=sample_rate,
            target_rate=target_rate,
        )
    band_mask = (freqs >= 180.0) & (freqs <= high_cut)
    if not np.any(band_mask):
        return _envelope_downsample(
            signal=signal,
            sample_rate=sample_rate,
            target_rate=target_rate,
        )

    filtered_spectrum = spectrum.copy()
    filtered_spectrum[~band_mask] = 0
    band_signal = np.fft.irfft(filtered_spectrum, n=arr.size).astype(np.float32)

    # Emphasize vocal articulation changes over sustained low-frequency energy.
    rectified = np.abs(band_signal)
    baseline = _moving_average_numpy(rectified, max(1, int(sample_rate * 0.12)))
    feature = np.maximum(0.0, rectified - baseline) + (0.35 * rectified)

    bucket_size = max(1, sample_rate // max(1, target_rate))
    if bucket_size == 1:
        return feature.tolist(), sample_rate

    buckets: list[float] = []
    for start in range(0, int(feature.size), bucket_size):
        chunk = feature[start : start + bucket_size]
        if chunk.size == 0:
            continue
        buckets.append(float(np.mean(chunk)))
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
        ref_slice, cand_slice = _slice_overlap(
            reference=normalized_reference,
            candidate=normalized_candidate,
            lag=lag,
        )
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


def _top_correlation_lags(
    *,
    normalized_reference: list[float],
    normalized_candidate: list[float],
    sample_rate: int,
    min_lag_samples: int,
    max_lag_samples: int,
    limit: int,
    min_peak_distance_samples: int,
) -> list[dict[str, Any]]:
    scores: list[tuple[int, float, int]] = []

    for lag in range(min_lag_samples, max_lag_samples + 1):
        ref_slice, cand_slice = _slice_overlap(
            reference=normalized_reference,
            candidate=normalized_candidate,
            lag=lag,
        )
        if not ref_slice or not cand_slice:
            continue

        length = min(len(ref_slice), len(cand_slice))
        if length < max(4, sample_rate // 5):
            continue

        score = 0.0
        for index in range(length):
            score += ref_slice[index] * cand_slice[index]

        scores.append((lag, score, length))

    if not scores:
        return []

    scores.sort(key=lambda item: item[1], reverse=True)
    picked: list[tuple[int, float, int]] = []
    for candidate in scores:
        if any(
            abs(candidate[0] - existing[0]) < min_peak_distance_samples
            for existing in picked
        ):
            continue
        picked.append(candidate)
        if len(picked) >= limit:
            break

    best_score = max(item[1] for item in picked) if picked else 0.0
    results: list[dict[str, Any]] = []
    for lag, score, overlap_samples in picked:
        score_ratio = 0.0 if abs(best_score) <= 1e-9 else score / best_score
        results.append(
            {
                "lag_seconds": lag / float(sample_rate),
                "score": score,
                "score_ratio": score_ratio,
                "overlap_samples": overlap_samples,
            }
        )
    return results


def _merge_candidate_lags(
    *,
    candidates: list[dict[str, Any]],
    extra_lags_seconds: list[float],
    sample_rate: int,
    tolerance_seconds: float = 0.35,
) -> list[dict[str, Any]]:
    merged = list(candidates)
    for lag_seconds in extra_lags_seconds:
        if not math.isfinite(lag_seconds):
            continue
        if any(
            abs(float(item.get("lag_seconds", 0.0)) - lag_seconds) < tolerance_seconds
            for item in merged
        ):
            continue
        merged.append(
            {
                "lag_seconds": lag_seconds,
                "score": 0.0,
                "score_ratio": 0.0,
                "overlap_samples": 0,
                "injected": True,
                "sample_rate": sample_rate,
            }
        )
    return merged


def _combine_feature_scores(
    *,
    lag: int,
    sample_rate: int,
    fine_reference_amp: list[float],
    fine_candidate_amp: list[float],
    fine_reference_vocal: list[float],
    fine_candidate_vocal: list[float],
) -> dict[str, Any] | None:
    amp_score, amp_overlap = _local_ncc_score(
        reference=fine_reference_amp,
        candidate=fine_candidate_amp,
        lag=lag,
        sample_rate=sample_rate,
    )
    vocal_score, vocal_overlap = _local_ncc_score(
        reference=fine_reference_vocal,
        candidate=fine_candidate_vocal,
        lag=lag,
        sample_rate=sample_rate,
    )

    if amp_score is None and vocal_score is None:
        return None

    amp_score_value = 0.0 if amp_score is None else float(amp_score)
    vocal_score_value = 0.0 if vocal_score is None else float(vocal_score)
    overlap_samples = max(amp_overlap, vocal_overlap)

    combined_score = (0.45 * amp_score_value) + (0.55 * vocal_score_value)
    return {
        "lag_seconds": lag / float(sample_rate),
        "score": combined_score,
        "amp_score": amp_score_value,
        "vocal_score": vocal_score_value,
        "overlap_samples": overlap_samples,
    }


def estimate_sync_candidates(
    *,
    reference: list[float],
    candidate: list[float],
    sample_rate: int,
    max_shift_seconds: float,
    limit: int = 4,
) -> list[dict[str, Any]]:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    coarse_reference_amp, coarse_rate = _envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=24,
    )
    coarse_candidate_amp, coarse_candidate_rate = _envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=24,
    )
    if coarse_rate != coarse_candidate_rate:
        raise ValueError("Coarse sample rates must match")

    coarse_reference_vocal, coarse_vocal_rate = _vocal_emphasis_envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=24,
    )
    coarse_candidate_vocal, coarse_candidate_vocal_rate = _vocal_emphasis_envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=24,
    )
    if coarse_vocal_rate != coarse_candidate_vocal_rate:
        raise ValueError("Coarse vocal sample rates must match")

    coarse_max_shift_samples = int(max_shift_seconds * coarse_rate)
    coarse_pool_limit = max(3, limit + 2)
    coarse_candidates_amp = _top_correlation_lags(
        normalized_reference=_normalize(coarse_reference_amp),
        normalized_candidate=_normalize(coarse_candidate_amp),
        sample_rate=coarse_rate,
        min_lag_samples=-coarse_max_shift_samples,
        max_lag_samples=coarse_max_shift_samples,
        limit=coarse_pool_limit,
        min_peak_distance_samples=max(1, int(0.75 * coarse_rate)),
    )
    coarse_candidates_vocal = _top_correlation_lags(
        normalized_reference=_normalize(coarse_reference_vocal),
        normalized_candidate=_normalize(coarse_candidate_vocal),
        sample_rate=coarse_vocal_rate,
        min_lag_samples=-coarse_max_shift_samples,
        max_lag_samples=coarse_max_shift_samples,
        limit=coarse_pool_limit,
        min_peak_distance_samples=max(1, int(0.75 * coarse_rate)),
    )

    end_anchor_seconds = (
        (len(candidate) - len(reference)) / float(sample_rate)
        if len(candidate) > len(reference)
        else 0.0
    )
    coarse_candidates = _merge_candidate_lags(
        candidates=coarse_candidates_amp + coarse_candidates_vocal,
        extra_lags_seconds=[end_anchor_seconds],
        sample_rate=coarse_rate,
    )
    coarse_candidates.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
    coarse_candidates_deduped: list[dict[str, Any]] = []
    injected_coarse_candidates = [
        item for item in coarse_candidates if bool(item.get("injected", False))
    ]
    for item in coarse_candidates:
        if any(
            abs(float(item.get("lag_seconds", 0.0)) - float(existing.get("lag_seconds", 0.0)))
            < 0.75
            for existing in coarse_candidates_deduped
        ):
            continue
        coarse_candidates_deduped.append(item)
        if len(coarse_candidates_deduped) >= max(5, limit * 2):
            break
    for injected_item in injected_coarse_candidates:
        if any(
            abs(float(injected_item.get("lag_seconds", 0.0)) - float(existing.get("lag_seconds", 0.0)))
            < 0.75
            for existing in coarse_candidates_deduped
        ):
            continue
        coarse_candidates_deduped.append(injected_item)
    coarse_candidates = coarse_candidates_deduped

    fine_reference_amp, fine_rate = _envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=90,
    )
    fine_candidate_amp, fine_candidate_rate = _envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=90,
    )
    if fine_rate != fine_candidate_rate:
        raise ValueError("Fine sample rates must match")

    fine_reference_vocal, fine_vocal_rate = _vocal_emphasis_envelope_downsample(
        signal=reference,
        sample_rate=sample_rate,
        target_rate=90,
    )
    fine_candidate_vocal, fine_candidate_vocal_rate = _vocal_emphasis_envelope_downsample(
        signal=candidate,
        sample_rate=sample_rate,
        target_rate=90,
    )
    if fine_vocal_rate != fine_candidate_vocal_rate:
        raise ValueError("Fine vocal sample rates must match")

    normalized_fine_reference_amp = _normalize(fine_reference_amp)
    normalized_fine_candidate_amp = _normalize(fine_candidate_amp)
    normalized_fine_reference_vocal = _normalize(fine_reference_vocal)
    normalized_fine_candidate_vocal = _normalize(fine_candidate_vocal)

    fine_max_shift_samples = int(max_shift_seconds * fine_rate)
    refine_window_samples = max(fine_rate, int(fine_rate * 0.6))

    refined: list[dict[str, Any]] = []
    for coarse_candidate_item in coarse_candidates:
        coarse_lag_seconds = float(coarse_candidate_item.get("lag_seconds", 0.0))
        fine_center_lag = int(round(coarse_lag_seconds * fine_rate))
        min_lag = max(-fine_max_shift_samples, fine_center_lag - refine_window_samples)
        max_lag = min(fine_max_shift_samples, fine_center_lag + refine_window_samples)

        amp_peaks = _top_correlation_lags(
            normalized_reference=normalized_fine_reference_amp,
            normalized_candidate=normalized_fine_candidate_amp,
            sample_rate=fine_rate,
            min_lag_samples=min_lag,
            max_lag_samples=max_lag,
            limit=1,
            min_peak_distance_samples=max(1, int(0.2 * fine_rate)),
        )
        vocal_peaks = _top_correlation_lags(
            normalized_reference=normalized_fine_reference_vocal,
            normalized_candidate=normalized_fine_candidate_vocal,
            sample_rate=fine_rate,
            min_lag_samples=min_lag,
            max_lag_samples=max_lag,
            limit=1,
            min_peak_distance_samples=max(1, int(0.2 * fine_rate)),
        )
        candidate_lags = {fine_center_lag}
        for item in amp_peaks + vocal_peaks:
            candidate_lags.add(int(round(float(item.get("lag_seconds", 0.0)) * fine_rate)))

        for lag in candidate_lags:
            if lag < min_lag or lag > max_lag:
                continue
            combined = _combine_feature_scores(
                lag=lag,
                sample_rate=fine_rate,
                fine_reference_amp=fine_reference_amp,
                fine_candidate_amp=fine_candidate_amp,
                fine_reference_vocal=fine_reference_vocal,
                fine_candidate_vocal=fine_candidate_vocal,
            )
            if combined is None:
                continue
            combined["coarse_lag_seconds"] = coarse_lag_seconds
            if bool(coarse_candidate_item.get("injected", False)):
                combined["injected"] = True
            refined.append(combined)

    if not refined:
        return []

    refined.sort(key=lambda item: float(item["score"]), reverse=True)
    deduped: list[dict[str, Any]] = []
    for item in refined:
        if any(
            abs(float(item["lag_seconds"]) - float(existing["lag_seconds"])) < 0.35
            for existing in deduped
        ):
            continue
        deduped.append(item)
        if len(deduped) >= limit:
            break

    if end_anchor_seconds > 0:
        end_anchor_choice = None
        for item in refined:
            if abs(float(item["lag_seconds"]) - end_anchor_seconds) <= 2.5:
                if end_anchor_choice is None or float(item["score"]) > float(
                    end_anchor_choice["score"]
                ):
                    end_anchor_choice = item
        if (
            end_anchor_choice is not None
            and not any(
                abs(float(item["lag_seconds"]) - float(end_anchor_choice["lag_seconds"])) < 0.35
                for item in deduped
            )
        ):
            if len(deduped) >= limit and deduped:
                deduped[-1] = end_anchor_choice
            else:
                deduped.append(end_anchor_choice)
            deduped.sort(key=lambda item: float(item["score"]), reverse=True)

    best_score = max(float(item["score"]) for item in deduped) if deduped else 0.0
    for item in deduped:
        score = float(item["score"])
        item["score_ratio"] = 0.0 if abs(best_score) <= 1e-9 else score / best_score
    return deduped


def estimate_sync_offset(
    *,
    reference: list[float],
    candidate: list[float],
    sample_rate: int,
    max_shift_seconds: float,
) -> float:
    candidates = estimate_sync_candidates(
        reference=reference,
        candidate=candidate,
        sample_rate=sample_rate,
        max_shift_seconds=max_shift_seconds,
        limit=1,
    )
    if not candidates:
        return 0.0
    return float(candidates[0]["lag_seconds"])


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


def estimate_sync_candidates_from_wav_files(
    *,
    video_wav_path: Path,
    master_wav_path: Path,
    max_shift_seconds: float,
    limit: int = 4,
) -> list[dict[str, Any]]:
    reference, sample_rate_ref = load_wav_mono(video_wav_path)
    candidate, sample_rate_candidate = load_wav_mono(master_wav_path)
    if sample_rate_ref != sample_rate_candidate:
        raise ValueError("Sample rates must match")
    return estimate_sync_candidates(
        reference=reference,
        candidate=candidate,
        sample_rate=sample_rate_ref,
        max_shift_seconds=max_shift_seconds,
        limit=limit,
    )
