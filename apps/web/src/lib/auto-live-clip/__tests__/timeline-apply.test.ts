import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "@/types/assets";
import type { AutoLiveClipAnalysis } from "@/types/auto-live-clip";
import {
	applyAutoLiveClipAnalysisToTracks,
	applyStrictSyncToTracks,
	computeMasterAnchoredSyncPlacement,
	computeVideoAnchoredSyncPlacement,
} from "@/lib/auto-live-clip/timeline-apply";
import type { TimelineTrack } from "@/types/timeline";

function mockMediaAsset(overrides: Partial<MediaAsset>): MediaAsset {
	return {
		id: "asset-id",
		name: "asset",
		type: "video",
		file: new File(["x"], "asset.bin", { type: "application/octet-stream" }),
		url: "blob://asset",
		duration: 10,
		width: 1920,
		height: 1080,
		...overrides,
	};
}

describe("applyAutoLiveClipAnalysisToTracks", () => {
	test("builds sequential video cuts and master audio mapping", () => {
		const analysis: AutoLiveClipAnalysis = {
			analysisId: "analysis-1",
			syncOffsetSeconds: 0.25,
			segments: [
				{
					segmentId: "seg-1",
					start: 0,
					end: 2,
					sourceStart: 0,
					sourceEnd: 2,
					transform: { scale: 1.2, positionX: 0.1, positionY: -0.2 },
					reasons: ["lead singer"],
					leadConfidence: 0.8,
					blurRegions: [],
				},
				{
					segmentId: "seg-2",
					start: 2,
					end: 4,
					sourceStart: 2,
					sourceEnd: 4,
					transform: { scale: 1.1, positionX: -0.1, positionY: -0.1 },
					reasons: ["motion peak"],
					leadConfidence: 0.7,
					blurRegions: [],
				},
			],
			generatedAt: new Date().toISOString(),
			options: {
				clipMode: "whole_song",
				maxClipMinutes: null,
				privacyProtectCrowd: true,
				preferLeadSinger: true,
			},
		};

		const result = applyAutoLiveClipAnalysisToTracks({
			existingTracks: [] as TimelineTrack[],
			videoAsset: mockMediaAsset({
				id: "video-1",
				type: "video",
				duration: 12,
				name: "camera.mp4",
			}),
			masterAudioAsset: mockMediaAsset({
				id: "audio-1",
				type: "audio",
				duration: 8,
				name: "master.wav",
			}),
			analysis,
		});

		expect(result.tracks.length).toBe(2);
		const [videoTrack, audioTrack] = result.tracks;
		expect(videoTrack.type).toBe("video");
		expect(audioTrack.type).toBe("audio");

		if (videoTrack.type !== "video") return;
		expect(videoTrack.elements.length).toBe(2);
		expect(videoTrack.elements[0]?.type).toBe("video");
		if (videoTrack.elements[0]?.type !== "video") return;
		expect(videoTrack.elements[0].muted).toBe(true);
		expect(videoTrack.elements[0].transform.scale).toBe(1.2);
		expect(videoTrack.elements[1]?.startTime).toBe(2);

		if (audioTrack.type !== "audio") return;
		expect(audioTrack.elements.length).toBe(1);
		const master = audioTrack.elements[0];
		expect(master?.sourceType).toBe("upload");
		expect(master?.startTime).toBe(0);
		expect(master?.trimStart).toBe(0.25);
		expect(master?.duration).toBe(4);
	});

	test("computeVideoAnchoredSyncPlacement delays audio only for negative lag", () => {
		expect(
			computeVideoAnchoredSyncPlacement({
				syncOffsetSeconds: 0.4,
			}),
		).toEqual({
			videoTimelineStart: 0,
			videoTrimStart: 0,
			audioTimelineStart: 0,
			audioTrimStart: 0.4,
		});

		expect(
			computeVideoAnchoredSyncPlacement({
				syncOffsetSeconds: -1.25,
			}),
		).toEqual({
			videoTimelineStart: 0,
			videoTrimStart: 0,
			audioTimelineStart: 1.25,
			audioTrimStart: 0,
		});
	});

	test("strict sync anchors master audio and leaves black leader when master starts earlier", () => {
		const placement = computeMasterAnchoredSyncPlacement({
			syncOffsetSeconds: 3.5,
		});
		expect(placement).toEqual({
			videoTimelineStart: 3.5,
			videoTrimStart: 0,
			audioTimelineStart: 0,
			audioTrimStart: 0,
		});

		const result = applyStrictSyncToTracks({
			existingTracks: [] as TimelineTrack[],
			videoAsset: mockMediaAsset({
				id: "video-1",
				type: "video",
				duration: 12,
				name: "camera.mp4",
			}),
			masterAudioAsset: mockMediaAsset({
				id: "audio-1",
				type: "audio",
				duration: 20,
				name: "master.wav",
			}),
			syncOffsetSeconds: 3.5,
		});

		const [videoTrack, audioTrack] = result.tracks;
		if (videoTrack?.type !== "video") return;
		if (audioTrack?.type !== "audio") return;
		expect(videoTrack.elements[0]?.startTime).toBe(3.5);
		expect(videoTrack.elements[0]?.trimStart).toBe(0);
		expect(audioTrack.elements[0]?.startTime).toBe(0);
		expect(audioTrack.elements[0]?.trimStart).toBe(0);
	});
});
