import { describe, expect, test } from "bun:test";
import { buildNudgeElementUpdates } from "../nudge-selected-elements";
import type { TimelineTrack } from "@/types/timeline";

function makeTracks(): TimelineTrack[] {
	return [
		{
			id: "v1",
			type: "video",
			name: "Main Track",
			isMain: true,
			hidden: false,
			muted: false,
			elements: [
				{
					id: "video",
					type: "video",
					mediaId: "mv",
					name: "video",
					startTime: 10,
					duration: 5,
					trimStart: 0,
					trimEnd: 0,
					muted: false,
					hidden: false,
					opacity: 1,
					transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 },
				},
			],
		},
		{
			id: "a1",
			type: "audio",
			name: "Master Audio",
			muted: false,
			elements: [
				{
					id: "audio",
					type: "audio",
					sourceType: "upload",
					mediaId: "ma",
					name: "audio",
					startTime: 9.5,
					duration: 20,
					trimStart: 0,
					trimEnd: 0,
					volume: 1,
					muted: false,
				},
			],
		},
	];
}

describe("buildNudgeElementUpdates", () => {
	test("nudges selected elements while preserving relative offset", () => {
		const result = buildNudgeElementUpdates({
			tracks: makeTracks(),
			selectedElements: [
				{ trackId: "v1", elementId: "video" },
				{ trackId: "a1", elementId: "audio" },
			],
			deltaSeconds: 0.25,
		});

		expect(result.appliedDeltaSeconds).toBe(0.25);
		expect(result.updates).toEqual([
			{ trackId: "v1", elementId: "video", startTime: 10.25 },
			{ trackId: "a1", elementId: "audio", startTime: 9.75 },
		]);
	});

	test("clamps negative nudge as a group to avoid desync", () => {
		const result = buildNudgeElementUpdates({
			tracks: makeTracks(),
			selectedElements: [
				{ trackId: "v1", elementId: "video" },
				{ trackId: "a1", elementId: "audio" },
			],
			deltaSeconds: -15,
		});

		expect(result.appliedDeltaSeconds).toBe(-9.5);
		expect(result.updates).toEqual([
			{ trackId: "v1", elementId: "video", startTime: 0.5 },
			{ trackId: "a1", elementId: "audio", startTime: 0 },
		]);
	});
});

