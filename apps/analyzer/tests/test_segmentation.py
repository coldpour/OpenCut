import unittest

from app.models import AnalyzeOptions
from app.segmentation import build_segment_plan


class SegmentationTests(unittest.TestCase):
    def test_build_segment_plan_shapes_valid_segments(self) -> None:
        segments = build_segment_plan(
            duration_seconds=10.0,
            sync_offset_seconds=0.0,
            options=AnalyzeOptions(),
        )

        self.assertGreaterEqual(len(segments), 4)
        self.assertAlmostEqual(segments[0].start, 0.0, delta=1e-6)

        previous_end = 0.0
        for segment in segments:
            self.assertGreater(segment.end, segment.start)
            self.assertGreaterEqual(segment.start, previous_end)
            self.assertGreaterEqual(segment.source_start, 0.0)
            self.assertGreater(segment.source_end, segment.source_start)
            previous_end = segment.end

        self.assertLessEqual(segments[-1].end, 10.0)


if __name__ == "__main__":
    unittest.main()
