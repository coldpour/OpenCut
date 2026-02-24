import type { TimelineTrack } from "@/types/timeline";

export interface SelectedTimelineElementRef {
	trackId: string;
	elementId: string;
}

export function buildNudgeElementUpdates({
	tracks,
	selectedElements,
	deltaSeconds,
}: {
	tracks: TimelineTrack[];
	selectedElements: SelectedTimelineElementRef[];
	deltaSeconds: number;
}): {
	appliedDeltaSeconds: number;
	updates: Array<{
		trackId: string;
		elementId: string;
		startTime: number;
	}>;
} {
	if (selectedElements.length === 0 || Math.abs(deltaSeconds) <= 1e-9) {
		return { appliedDeltaSeconds: 0, updates: [] };
	}

	const selectedMap = new Map<string, { trackId: string; elementId: string; startTime: number }>();
	for (const selected of selectedElements) {
		const track = tracks.find((item) => item.id === selected.trackId);
		const element = track?.elements.find((item) => item.id === selected.elementId);
		if (!track || !element) continue;
		selectedMap.set(`${track.id}:${element.id}`, {
			trackId: track.id,
			elementId: element.id,
			startTime: element.startTime,
		});
	}

	const selectedResolved = Array.from(selectedMap.values());
	if (selectedResolved.length === 0) {
		return { appliedDeltaSeconds: 0, updates: [] };
	}

	let appliedDeltaSeconds = deltaSeconds;
	if (deltaSeconds < 0) {
		const minStartTime = selectedResolved.reduce(
			(minimum, item) => Math.min(minimum, item.startTime),
			Number.POSITIVE_INFINITY,
		);
		appliedDeltaSeconds = Math.max(deltaSeconds, -minStartTime);
	}

	return {
		appliedDeltaSeconds,
		updates: selectedResolved.map((item) => ({
			trackId: item.trackId,
			elementId: item.elementId,
			startTime: Math.max(0, item.startTime + appliedDeltaSeconds),
		})),
	};
}

