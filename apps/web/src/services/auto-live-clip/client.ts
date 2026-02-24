import type {
	AutoLiveClipAnalysis,
	AutoLiveClipAnalyzeResponse,
	AutoLiveClipOptions,
	AutoLiveClipRenderResponse,
	AutoLiveClipResolutionPreset,
} from "@/types/auto-live-clip";

const DEFAULT_ANALYZER_URL = "http://127.0.0.1:8765";

function getAnalyzerBaseUrl(): string {
	const envUrl =
		typeof process !== "undefined"
			? process.env.NEXT_PUBLIC_AUTO_LIVE_CLIP_ANALYZER_URL
			: undefined;
	return (envUrl || DEFAULT_ANALYZER_URL).replace(/\/$/, "");
}

function toAnalysis({
	response,
	options,
}: {
	response: AutoLiveClipAnalyzeResponse;
	options: AutoLiveClipOptions;
}): AutoLiveClipAnalysis {
	return {
		analysisId: response.analysis_id,
		syncOffsetSeconds: response.sync_offset_seconds,
		syncCandidates: (response.sync_candidates ?? []).map((candidate) => ({
			offsetSeconds: candidate.lag_seconds,
			score: candidate.score,
			scoreRatio: candidate.score_ratio,
			overlapSamples: candidate.overlap_samples,
			rank: candidate.rank,
			isDefault: candidate.is_default,
		})),
		beatMarkers: {
			videoSeconds: response.beat_markers?.video_seconds ?? [],
			masterAudioSeconds: response.beat_markers?.master_audio_seconds ?? [],
		},
		generatedAt: new Date().toISOString(),
		options,
		segments: response.segments.map((segment) => ({
			segmentId: segment.segment_id,
			start: segment.start,
			end: segment.end,
			sourceStart: segment.source_start,
			sourceEnd: segment.source_end,
			transform: {
				scale: segment.transform.scale,
				positionX: segment.transform.position_x,
				positionY: segment.transform.position_y,
			},
			reasons: segment.reasons,
			leadConfidence: segment.lead_confidence,
			blurRegions: segment.blur_regions.map((region) => ({
				x: region.x,
				y: region.y,
				width: region.width,
				height: region.height,
				strength: region.strength,
			})),
		})),
	};
}

export async function analyzeAutoLiveClip({
	videoFile,
	masterAudioFile,
	options,
}: {
	videoFile: File;
	masterAudioFile: File;
	options: AutoLiveClipOptions;
}): Promise<AutoLiveClipAnalysis> {
	const formData = new FormData();
	formData.append("video", videoFile, videoFile.name);
	formData.append("master_audio", masterAudioFile, masterAudioFile.name);
	formData.append(
		"options",
		JSON.stringify({
			clip_mode: options.clipMode,
			max_clip_minutes: options.maxClipMinutes,
			privacy_protect_crowd: options.privacyProtectCrowd,
			prefer_lead_singer: options.preferLeadSinger,
		}),
	);

	const response = await fetch(`${getAnalyzerBaseUrl()}/analyze`, {
		method: "POST",
		body: formData,
	});
	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Analyze failed (${response.status}): ${message}`);
	}
	const payload = (await response.json()) as AutoLiveClipAnalyzeResponse;
	return toAnalysis({ response: payload, options });
}

export async function renderAutoLiveClip({
	videoFile,
	masterAudioFile,
	analysis,
	preset,
	privacyProtectCrowd,
}: {
	videoFile: File;
	masterAudioFile: File;
	analysis: AutoLiveClipAnalysis;
	preset: AutoLiveClipResolutionPreset;
	privacyProtectCrowd: boolean;
}): Promise<{
	artifactId: string;
	downloadUrl: string;
	width: number;
	height: number;
}> {
	const formData = new FormData();
	formData.append("video", videoFile, videoFile.name);
	formData.append("master_audio", masterAudioFile, masterAudioFile.name);
	formData.append("analysis_id", analysis.analysisId);
	formData.append(
		"plan",
		JSON.stringify({
			segments: analysis.segments.map((segment) => ({
				segment_id: segment.segmentId,
				start: segment.start,
				end: segment.end,
				source_start: segment.sourceStart,
				source_end: segment.sourceEnd,
				transform: {
					scale: segment.transform.scale,
					position_x: segment.transform.positionX,
					position_y: segment.transform.positionY,
				},
				reasons: segment.reasons,
				lead_confidence: segment.leadConfidence,
				blur_regions: segment.blurRegions.map((region) => ({
					x: region.x,
					y: region.y,
					width: region.width,
					height: region.height,
					strength: region.strength,
				})),
			})),
		}),
	);
	formData.append("sync_offset_seconds", analysis.syncOffsetSeconds.toString());
	formData.append("preset", preset);
	formData.append("privacy_protect_crowd", String(privacyProtectCrowd));

	const response = await fetch(`${getAnalyzerBaseUrl()}/render`, {
		method: "POST",
		body: formData,
	});
	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Render failed (${response.status}): ${message}`);
	}
	const payload = (await response.json()) as AutoLiveClipRenderResponse;
	const absoluteDownloadUrl = payload.download_url.startsWith("http")
		? payload.download_url
		: `${getAnalyzerBaseUrl()}${payload.download_url}`;
	return {
		artifactId: payload.artifact_id,
		downloadUrl: absoluteDownloadUrl,
		width: payload.width,
		height: payload.height,
	};
}
