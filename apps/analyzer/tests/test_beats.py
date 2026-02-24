import unittest

from app.beats import detect_beat_markers


class BeatDetectionTests(unittest.TestCase):
    def test_detect_beat_markers_finds_regular_pulses(self) -> None:
        sample_rate = 1000
        duration_seconds = 6
        samples_count = sample_rate * duration_seconds
        signal = [0.0] * samples_count

        expected_times = [1.0, 2.0, 3.0, 4.0, 5.0]
        for pulse_time in expected_times:
            center = int(pulse_time * sample_rate)
            for offset in range(-15, 16):
                index = center + offset
                if 0 <= index < len(signal):
                    signal[index] += max(0.0, 1.0 - (abs(offset) / 16.0))

        markers = detect_beat_markers(
            signal=signal,
            sample_rate=sample_rate,
            target_rate=100,
            min_spacing_seconds=0.4,
        )

        self.assertGreaterEqual(len(markers), 4)
        for expected in expected_times:
            self.assertTrue(
                any(abs(marker - expected) < 0.12 for marker in markers),
                f"Missing marker near {expected}s in {markers}",
            )


if __name__ == "__main__":
    unittest.main()

