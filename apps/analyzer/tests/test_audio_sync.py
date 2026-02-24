import math
import unittest

from app.audio_sync import estimate_sync_candidates, estimate_sync_offset


class AudioSyncTests(unittest.TestCase):
    def test_estimate_sync_offset_detects_positive_delay(self) -> None:
        sample_rate = 1000
        duration_seconds = 3
        samples_count = sample_rate * duration_seconds
        base_signal = []

        for index in range(samples_count):
            time = index / sample_rate
            value = math.sin(2.0 * math.pi * 5.0 * time)
            if 0.9 <= time <= 1.0:
                value += 0.8
            if 1.8 <= time <= 1.9:
                value -= 0.5
            base_signal.append(value)

        delay_seconds = 0.25
        delay_samples = int(delay_seconds * sample_rate)
        delayed_signal = [0.0] * delay_samples + base_signal[:-delay_samples]

        estimated = estimate_sync_offset(
            reference=base_signal,
            candidate=delayed_signal,
            sample_rate=sample_rate,
            max_shift_seconds=1.0,
        )

        self.assertAlmostEqual(estimated, delay_seconds, delta=0.03)

    def test_estimate_sync_offset_detects_negative_delay(self) -> None:
        sample_rate = 500
        samples_count = sample_rate * 6
        base_signal = []
        for index in range(samples_count):
            time = index / sample_rate
            value = math.sin(2.0 * math.pi * 3.0 * time)
            if 2.0 <= time <= 2.25:
                value += 1.0
            base_signal.append(value)

        advance_seconds = 0.6
        advance_samples = int(advance_seconds * sample_rate)
        advanced_signal = base_signal[advance_samples:] + [0.0] * advance_samples

        estimated = estimate_sync_offset(
            reference=base_signal,
            candidate=advanced_signal,
            sample_rate=sample_rate,
            max_shift_seconds=2.0,
        )

        self.assertAlmostEqual(estimated, -advance_seconds, delta=0.05)

    def test_estimate_sync_offset_supports_larger_shift_windows(self) -> None:
        sample_rate = 200
        samples_count = sample_rate * 20
        base_signal = []
        for index in range(samples_count):
            time = index / sample_rate
            value = math.sin(2.0 * math.pi * 2.0 * time)
            if 8.0 <= time <= 8.3:
                value += 1.2
            if 12.0 <= time <= 12.1:
                value -= 0.9
            base_signal.append(value)

        delay_seconds = 5.0
        delay_samples = int(delay_seconds * sample_rate)
        delayed_signal = [0.0] * delay_samples + base_signal[:-delay_samples]

        estimated = estimate_sync_offset(
            reference=base_signal,
            candidate=delayed_signal,
            sample_rate=sample_rate,
            max_shift_seconds=8.0,
        )

        self.assertAlmostEqual(estimated, delay_seconds, delta=0.12)

    def test_estimate_sync_candidates_includes_late_truncated_match(self) -> None:
        sample_rate = 200
        reference_duration = 12
        candidate_duration = 80
        reference_samples = sample_rate * reference_duration
        candidate_samples = sample_rate * candidate_duration

        reference: list[float] = []
        for index in range(reference_samples):
            time = index / sample_rate
            value = 0.0
            # "Vocal-ish" mid-frequency content with unique phrasing pulses.
            value += 0.5 * math.sin(2.0 * math.pi * 13.0 * time)
            if 0.6 <= time <= 0.8:
                value += 0.7 * math.sin(2.0 * math.pi * 30.0 * time)
            if 3.2 <= time <= 3.4:
                value -= 0.6 * math.sin(2.0 * math.pi * 27.0 * time)
            if 7.1 <= time <= 7.35:
                value += 0.9 * math.sin(2.0 * math.pi * 22.0 * time)
            if 9.8 <= time <= 10.2:
                value += 0.5
            reference.append(value)

        candidate = [0.0] * candidate_samples
        # Add an earlier distractor with similar broad envelope but different content.
        distractor_offset_seconds = 18.0
        distractor_offset_samples = int(distractor_offset_seconds * sample_rate)
        for index, value in enumerate(reference):
            target = distractor_offset_samples + index
            if target >= candidate_samples:
                break
            candidate[target] += 0.35 * abs(value)

        # True match starts near the end and runs slightly past candidate end.
        true_lag_seconds = 69.0
        true_lag_samples = int(true_lag_seconds * sample_rate)
        for index, value in enumerate(reference):
            target = true_lag_samples + index
            if target >= candidate_samples:
                break
            candidate[target] += value

        candidates = estimate_sync_candidates(
            reference=reference,
            candidate=candidate,
            sample_rate=sample_rate,
            max_shift_seconds=75.0,
            limit=6,
        )

        self.assertTrue(
            any(abs(float(item["lag_seconds"]) - true_lag_seconds) < 1.2 for item in candidates),
            f"Expected late match near {true_lag_seconds}s, got {candidates}",
        )


if __name__ == "__main__":
    unittest.main()
