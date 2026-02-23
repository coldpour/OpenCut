import unittest

from app.models import (
    AnalyzeOptions,
    SegmentPlan,
    TransformPlan,
    validate_segment_plan,
)


class AnalyzeModelTests(unittest.TestCase):
    def test_transform_plan_defaults(self) -> None:
        transform = TransformPlan()
        self.assertAlmostEqual(transform.scale, 1.0)
        self.assertAlmostEqual(transform.position_x, 0.0)
        self.assertAlmostEqual(transform.position_y, 0.0)

    def test_validate_segment_plan_accepts_increasing_ranges(self) -> None:
        segments = [
            SegmentPlan(
                segment_id="seg-1",
                start=0.0,
                end=1.5,
                source_start=0.0,
                source_end=1.5,
                transform=TransformPlan(scale=1.1),
                reasons=["lead face detected"],
            ),
            SegmentPlan(
                segment_id="seg-2",
                start=1.5,
                end=3.0,
                source_start=1.5,
                source_end=3.0,
                transform=TransformPlan(scale=1.2, position_x=0.1),
                reasons=["motion peak"],
            ),
        ]

        validate_segment_plan(segments)

    def test_validate_segment_plan_rejects_overlap(self) -> None:
        segments = [
            SegmentPlan(
                segment_id="seg-1",
                start=0.0,
                end=2.0,
                source_start=0.0,
                source_end=2.0,
                transform=TransformPlan(),
                reasons=["baseline"],
            ),
            SegmentPlan(
                segment_id="seg-2",
                start=1.9,
                end=3.0,
                source_start=1.9,
                source_end=3.0,
                transform=TransformPlan(),
                reasons=["invalid"],
            ),
        ]

        with self.assertRaises(ValueError):
            validate_segment_plan(segments)

    def test_analyze_options_defaults(self) -> None:
        options = AnalyzeOptions()
        self.assertTrue(options.privacy_protect_crowd)
        self.assertTrue(options.prefer_lead_singer)
        self.assertEqual(options.clip_mode, "whole_song")
        self.assertIsNone(options.max_clip_minutes)


if __name__ == "__main__":
    unittest.main()
