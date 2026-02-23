import type { MediaAsset } from "@/types/assets";
import type {
	AudioTrack,
	CreateUploadAudioElement,
	TimelineTrack,
	VideoElement,
	VideoTrack,
} from "@/types/timeline";
import type {
	AutoLiveClipAnalysis,
	AutoLiveClipSceneMetadata,
	AutoLiveClipSegmentPlan,
} from "@/types/auto-live-clip";
import { generateUUID } from "@/utils/id";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeSegments(segments: AutoLiveClipSegmentPlan[]) {
	return segments
		.slice()
		.sort((left, right) => left.start - right.start)
		.map((segment) => {
			const start = Math.max(0, segment.start);
			const end = Math.max(start + 0.01, segment.end);
			const sourceStart = Math.max(0, segment.sourceStart);
			const sourceEnd = Math.max(sourceStart + 0.01, segment.sourceEnd);
			return { ...segment, start, end, sourceStart, sourceEnd };
		});
}

export interface SyncPlacement {
	videoTimelineStart: number;
	videoTrimStart: number;
	audioTimelineStart: number;
	audioTrimStart: number;
}

// Correlation lag semantics:
// master[t + lag] ~= video[t]
// Positive lag => master is later in its file than camera scratch audio.
export function computeVideoAnchoredSyncPlacement({
	syncOffsetSeconds,
}: {
	syncOffsetSeconds: number;
}): SyncPlacement {
	return {
		videoTimelineStart: 0,
		videoTrimStart: 0,
		audioTimelineStart: Math.max(0, -syncOffsetSeconds),
		audioTrimStart: Math.max(0, syncOffsetSeconds),
	};
}

export function computeMasterAnchoredSyncPlacement({
	syncOffsetSeconds,
}: {
	syncOffsetSeconds: number;
}): SyncPlacement {
	return {
		videoTimelineStart: Math.max(0, syncOffsetSeconds),
		videoTrimStart: Math.max(0, -syncOffsetSeconds),
		audioTimelineStart: 0,
		audioTrimStart: 0,
	};
}

export function applyAutoLiveClipAnalysisToTracks({
	existingTracks,
	videoAsset,
	masterAudioAsset,
	analysis,
}: {
	existingTracks: TimelineTrack[];
	videoAsset: MediaAsset;
	masterAudioAsset: MediaAsset;
	analysis: AutoLiveClipAnalysis;
}): {
	tracks: TimelineTrack[];
	sceneMetadata: AutoLiveClipSceneMetadata;
} {
	if (videoAsset.type !== "video") {
		throw new Error("Auto Live Clip requires a video asset");
	}
	if (masterAudioAsset.type !== "audio") {
		throw new Error("Auto Live Clip requires a master audio asset");
	}

	const segments = normalizeSegments(analysis.segments);
	if (segments.length === 0) {
		throw new Error("Analysis returned no segments");
	}

	const timelineDuration = segments[segments.length - 1]?.end ?? 0;
	const mainTrackTemplate = existingTracks.find(
		(track): track is VideoTrack => track.type === "video" && track.isMain,
	);
	const audioTrackTemplate = existingTracks.find(
		(track): track is AudioTrack => track.type === "audio",
	);

	const mainTrackId = mainTrackTemplate?.id ?? generateUUID();
	const audioTrackId = audioTrackTemplate?.id ?? generateUUID();

	const videoElements: VideoElement[] = segments.map((segment) => {
		return {
			id: generateUUID(),
			type: "video",
			mediaId: videoAsset.id,
			name: `${videoAsset.name} ${segment.segmentId}`,
			duration: segment.end - segment.start,
			startTime: segment.start,
			trimStart: segment.sourceStart,
			trimEnd: 0,
			muted: true,
			hidden: false,
			opacity: 1,
			transform: {
				scale: clamp(segment.transform.scale, 1, 2.5),
				position: {
					x: clamp(segment.transform.positionX, -1, 1) * 220,
					y: clamp(segment.transform.positionY, -1, 1) * 180,
				},
				rotate: 0,
			},
		};
	});

	const syncPlacement = computeVideoAnchoredSyncPlacement({
		syncOffsetSeconds: analysis.syncOffsetSeconds,
	});
	const syncedAudioStartTime = syncPlacement.audioTimelineStart;
	const masterTrimStart = syncPlacement.audioTrimStart;
	const availableAudioDuration = Math.max(
		0,
		(masterAudioAsset.duration ?? timelineDuration) - masterTrimStart,
	);
	const audioDuration = Math.max(
		0.01,
		Math.min(
			availableAudioDuration,
			Math.max(0, timelineDuration - syncedAudioStartTime),
		),
	);

	const masterAudioElement: CreateUploadAudioElement = {
		type: "audio",
		sourceType: "upload",
		mediaId: masterAudioAsset.id,
		name: masterAudioAsset.name,
		startTime: syncedAudioStartTime,
		duration: audioDuration,
		trimStart: masterTrimStart,
		trimEnd: 0,
		volume: 1,
		muted: false,
	};

	const updatedSegments = segments.map((segment, index) => ({
		...segment,
		trackId: mainTrackId,
		elementId: videoElements[index]?.id,
	}));

	const tracks: TimelineTrack[] = [
		{
			id: mainTrackId,
			type: "video",
			name: mainTrackTemplate?.name ?? "Main Track",
			isMain: true,
			hidden: false,
			muted: false,
			elements: videoElements,
		},
		{
			id: audioTrackId,
			type: "audio",
			name: audioTrackTemplate?.name ?? "Master Audio",
			muted: false,
			elements: [
				{
					...masterAudioElement,
					id: generateUUID(),
				},
			],
		},
	];

	return {
		tracks,
		sceneMetadata: {
			analysis: {
				...analysis,
				segments: updatedSegments,
			},
			lastBuiltAt: new Date().toISOString(),
		},
	};
}

export function applyStrictSyncToTracks({
	existingTracks,
	videoAsset,
	masterAudioAsset,
	syncOffsetSeconds,
}: {
	existingTracks: TimelineTrack[];
	videoAsset: MediaAsset;
	masterAudioAsset: MediaAsset;
	syncOffsetSeconds: number;
}): {
	tracks: TimelineTrack[];
	placement: SyncPlacement;
} {
	if (videoAsset.type !== "video") {
		throw new Error("Strict sync requires a video asset");
	}
	if (masterAudioAsset.type !== "audio") {
		throw new Error("Strict sync requires an audio asset");
	}

	const mainTrackTemplate = existingTracks.find(
		(track): track is VideoTrack => track.type === "video" && track.isMain,
	);
	const audioTrackTemplate = existingTracks.find(
		(track): track is AudioTrack => track.type === "audio",
	);
	const mainTrackId = mainTrackTemplate?.id ?? generateUUID();
	const audioTrackId = audioTrackTemplate?.id ?? generateUUID();

	const placement = computeMasterAnchoredSyncPlacement({ syncOffsetSeconds });
	const videoDuration = Math.max(0.01, (videoAsset.duration ?? 0) - placement.videoTrimStart);
	const audioDuration = Math.max(0.01, masterAudioAsset.duration ?? videoDuration);

	const videoElement: VideoElement = {
		id: generateUUID(),
		type: "video",
		mediaId: videoAsset.id,
		name: videoAsset.name,
		duration: videoDuration,
		startTime: placement.videoTimelineStart,
		trimStart: placement.videoTrimStart,
		trimEnd: 0,
		muted: true,
		hidden: false,
		opacity: 1,
		transform: {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		},
	};

	const masterAudioElement: CreateUploadAudioElement = {
		type: "audio",
		sourceType: "upload",
		mediaId: masterAudioAsset.id,
		name: masterAudioAsset.name,
		startTime: placement.audioTimelineStart,
		duration: audioDuration,
		trimStart: placement.audioTrimStart,
		trimEnd: 0,
		volume: 1,
		muted: false,
	};

	return {
		tracks: [
			{
				id: mainTrackId,
				type: "video",
				name: mainTrackTemplate?.name ?? "Main Track",
				isMain: true,
				hidden: false,
				muted: false,
				elements: [videoElement],
			},
			{
				id: audioTrackId,
				type: "audio",
				name: audioTrackTemplate?.name ?? "Master Audio",
				muted: false,
				elements: [
					{
						...masterAudioElement,
						id: generateUUID(),
					},
				],
			},
		],
		placement,
	};
}
