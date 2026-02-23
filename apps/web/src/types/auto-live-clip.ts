export type AutoLiveClipClipMode = "whole_song" | "minutes";
export type AutoLiveClipResolutionPreset = "1080p" | "2k" | "4k";

export interface AutoLiveClipTransform {
	scale: number;
	positionX: number;
	positionY: number;
}

export interface AutoLiveClipBlurRegion {
	x: number;
	y: number;
	width: number;
	height: number;
	strength: number;
}

export interface AutoLiveClipSegmentPlan {
	segmentId: string;
	start: number;
	end: number;
	sourceStart: number;
	sourceEnd: number;
	transform: AutoLiveClipTransform;
	reasons: string[];
	leadConfidence: number;
	blurRegions: AutoLiveClipBlurRegion[];
	trackId?: string;
	elementId?: string;
}

export interface AutoLiveClipOptions {
	clipMode: AutoLiveClipClipMode;
	maxClipMinutes: number | null;
	privacyProtectCrowd: boolean;
	preferLeadSinger: boolean;
}

export interface AutoLiveClipAnalysis {
	analysisId: string;
	syncOffsetSeconds: number;
	segments: AutoLiveClipSegmentPlan[];
	generatedAt: string;
	options: AutoLiveClipOptions;
}

export interface AutoLiveClipSceneMetadata {
	analysis: AutoLiveClipAnalysis;
	lastBuiltAt: string;
}

export interface AutoLiveClipAnalyzeResponse {
	analysis_id: string;
	sync_offset_seconds: number;
	segments: Array<{
		segment_id: string;
		start: number;
		end: number;
		source_start: number;
		source_end: number;
		transform: {
			scale: number;
			position_x: number;
			position_y: number;
		};
		reasons: string[];
		lead_confidence: number;
		blur_regions: Array<{
			x: number;
			y: number;
			width: number;
			height: number;
			strength: number;
		}>;
	}>;
}

export interface AutoLiveClipRenderResponse {
	artifact_id: string;
	download_url: string;
	width: number;
	height: number;
	preset: string;
}
