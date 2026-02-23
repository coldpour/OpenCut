from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class AnalyzeOptions:
    clip_mode: str = "whole_song"
    max_clip_minutes: int | None = None
    privacy_protect_crowd: bool = True
    prefer_lead_singer: bool = True

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "AnalyzeOptions":
        payload = payload or {}
        clip_mode = str(payload.get("clip_mode", "whole_song"))
        max_clip_minutes = payload.get("max_clip_minutes")
        if max_clip_minutes is not None:
            max_clip_minutes = int(max_clip_minutes)
        return cls(
            clip_mode=clip_mode,
            max_clip_minutes=max_clip_minutes,
            privacy_protect_crowd=bool(payload.get("privacy_protect_crowd", True)),
            prefer_lead_singer=bool(payload.get("prefer_lead_singer", True)),
        )


@dataclass(slots=True)
class TransformPlan:
    scale: float = 1.0
    position_x: float = 0.0
    position_y: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "scale": self.scale,
            "position_x": self.position_x,
            "position_y": self.position_y,
        }


@dataclass(slots=True)
class BlurRegion:
    x: float
    y: float
    width: float
    height: float
    strength: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "strength": self.strength,
        }


@dataclass(slots=True)
class SegmentPlan:
    segment_id: str
    start: float
    end: float
    source_start: float
    source_end: float
    transform: TransformPlan
    reasons: list[str]
    lead_confidence: float = 0.0
    blur_regions: list[BlurRegion] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict[str, Any]:
        return {
            "segment_id": self.segment_id,
            "start": self.start,
            "end": self.end,
            "source_start": self.source_start,
            "source_end": self.source_end,
            "transform": self.transform.to_dict(),
            "reasons": self.reasons,
            "lead_confidence": self.lead_confidence,
            "blur_regions": [region.to_dict() for region in self.blur_regions],
        }


def validate_segment_plan(segments: list[SegmentPlan]) -> None:
    previous_end = 0.0
    for index, segment in enumerate(segments):
        if segment.start < 0:
            raise ValueError("Segment start cannot be negative")
        if segment.end <= segment.start:
            raise ValueError("Segment end must be greater than start")
        if segment.source_end <= segment.source_start:
            raise ValueError("Source end must be greater than source start")
        if index > 0 and segment.start < previous_end:
            raise ValueError("Segments must not overlap")
        previous_end = segment.end

