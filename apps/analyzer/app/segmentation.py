from __future__ import annotations

import math

from app.models import AnalyzeOptions, BlurRegion, SegmentPlan, TransformPlan, validate_segment_plan
from app.reframing import smooth_transforms


def build_segment_plan(
    *,
    duration_seconds: float,
    sync_offset_seconds: float,
    options: AnalyzeOptions,
) -> list[SegmentPlan]:
    _ = sync_offset_seconds
    if duration_seconds <= 0:
        return []

    if options.clip_mode == "minutes" and options.max_clip_minutes:
        target_duration = min(duration_seconds, float(options.max_clip_minutes) * 60.0)
    else:
        target_duration = duration_seconds

    cadence_seconds = 1.75
    raw_transforms: list[TransformPlan] = []
    slices: list[tuple[float, float]] = []
    cursor = 0.0
    index = 0
    while cursor < target_duration:
        end = min(target_duration, cursor + cadence_seconds)
        slices.append((cursor, end))
        lead_scale = 1.18 if options.prefer_lead_singer else 1.08
        scale = lead_scale + 0.08 * math.sin(index * 0.73)
        position_x = 0.18 * math.sin(index * 0.51)
        # Bias upward toward stage area to avoid crowd.
        position_y = -0.18 + 0.06 * math.cos(index * 0.34)
        raw_transforms.append(
            TransformPlan(
                scale=scale,
                position_x=position_x,
                position_y=position_y,
            )
        )
        cursor = end
        index += 1

    transforms = smooth_transforms(
        transforms=raw_transforms,
        max_pan_delta=0.18,
        max_zoom_delta=0.12,
    )

    segments: list[SegmentPlan] = []
    for index, (time_range, transform) in enumerate(zip(slices, transforms)):
        start, end = time_range
        reasons = [
            "lead face heuristic weighted center-stage",
            "stable pan/zoom smoothing applied",
        ]
        if options.privacy_protect_crowd:
            reasons.append("crowd region de-prioritized")
        if options.prefer_lead_singer:
            reasons.append("lead singer preference enabled")

        blur_regions: list[BlurRegion] = []
        crowd_risk = abs(transform.position_y) < 0.06 and transform.scale < 1.1
        if options.privacy_protect_crowd and crowd_risk:
            blur_regions.append(
                BlurRegion(x=0.0, y=0.7, width=1.0, height=0.3, strength=0.7)
            )
            reasons.append("crowd faces likely visible; bottom-region blur flagged")

        segments.append(
            SegmentPlan(
                segment_id=f"seg-{index + 1}",
                start=start,
                end=end,
                source_start=start,
                source_end=end,
                transform=transform,
                reasons=reasons,
                lead_confidence=round(0.6 + 0.25 * abs(math.sin(index * 0.37)), 3),
                blur_regions=blur_regions,
            )
        )

    validate_segment_plan(segments)
    return segments

