import unittest

from app.models import TransformPlan
from app.reframing import smooth_transforms


class ReframingTests(unittest.TestCase):
    def test_smooth_transforms_limits_step_changes(self) -> None:
        raw = [
            TransformPlan(scale=1.0, position_x=0.0, position_y=0.0),
            TransformPlan(scale=1.8, position_x=0.9, position_y=0.6),
            TransformPlan(scale=1.1, position_x=-0.9, position_y=-0.6),
        ]

        smoothed = smooth_transforms(
            transforms=raw,
            max_pan_delta=0.2,
            max_zoom_delta=0.15,
        )

        self.assertEqual(len(smoothed), len(raw))

        for index in range(1, len(smoothed)):
            prev = smoothed[index - 1]
            curr = smoothed[index]
            self.assertLessEqual(abs(curr.position_x - prev.position_x), 0.2 + 1e-6)
            self.assertLessEqual(abs(curr.position_y - prev.position_y), 0.2 + 1e-6)
            self.assertLessEqual(abs(curr.scale - prev.scale), 0.15 + 1e-6)


if __name__ == "__main__":
    unittest.main()
