from __future__ import annotations

from app.models import TransformPlan


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def smooth_transforms(
    *,
    transforms: list[TransformPlan],
    max_pan_delta: float,
    max_zoom_delta: float,
) -> list[TransformPlan]:
    if not transforms:
        return []

    smoothed = [
        TransformPlan(
            scale=transforms[0].scale,
            position_x=transforms[0].position_x,
            position_y=transforms[0].position_y,
        )
    ]

    for transform in transforms[1:]:
        previous = smoothed[-1]
        next_scale = _clamp(
            transform.scale,
            previous.scale - max_zoom_delta,
            previous.scale + max_zoom_delta,
        )
        next_x = _clamp(
            transform.position_x,
            previous.position_x - max_pan_delta,
            previous.position_x + max_pan_delta,
        )
        next_y = _clamp(
            transform.position_y,
            previous.position_y - max_pan_delta,
            previous.position_y + max_pan_delta,
        )
        smoothed.append(
            TransformPlan(
                scale=_clamp(next_scale, 1.0, 2.2),
                position_x=_clamp(next_x, -1.0, 1.0),
                position_y=_clamp(next_y, -1.0, 1.0),
            )
        )

    return smoothed

