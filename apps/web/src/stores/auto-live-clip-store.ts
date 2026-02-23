import { create } from "zustand";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import type {
	AutoLiveClipAnalysis,
	AutoLiveClipClipMode,
	AutoLiveClipOptions,
	AutoLiveClipResolutionPreset,
	AutoLiveClipSegmentPlan,
} from "@/types/auto-live-clip";
import {
	analyzeAutoLiveClip,
	renderAutoLiveClip,
} from "@/services/auto-live-clip/client";
import {
	applyAutoLiveClipAnalysisToTracks,
	applyStrictSyncToTracks,
	type SyncPlacement,
} from "@/lib/auto-live-clip/timeline-apply";
import type { MediaAsset } from "@/types/assets";

interface AutoLiveClipStrictSyncResult extends SyncPlacement {
	syncOffsetSeconds: number;
}

interface AutoLiveClipState {
	selectedVideoMediaId: string | null;
	selectedMasterAudioMediaId: string | null;
	clipMode: AutoLiveClipClipMode;
	maxClipMinutes: number | null;
	privacyProtectCrowd: boolean;
	preferLeadSinger: boolean;
	isAnalyzing: boolean;
	isRendering: boolean;
	progressStep: string | null;
	errorMessage: string | null;
	analysis: AutoLiveClipAnalysis | null;
	strictSyncResult: AutoLiveClipStrictSyncResult | null;
	selectedSegmentId: string | null;
	analysisCache: Record<string, AutoLiveClipAnalysis>;

	setSelectedVideoMediaId: (mediaId: string | null) => void;
	setSelectedMasterAudioMediaId: (mediaId: string | null) => void;
	setClipMode: (mode: AutoLiveClipClipMode) => void;
	setMaxClipMinutes: (minutes: number | null) => void;
	setPrivacyProtectCrowd: (value: boolean) => void;
	setPreferLeadSinger: (value: boolean) => void;
	selectSegment: (segmentId: string | null) => void;
	setAnalysis: (analysis: AutoLiveClipAnalysis | null) => void;
	strictSyncTimeline: ({ editor }: { editor: EditorCore }) => Promise<void>;
	analyzeAndBuildTimeline: ({ editor }: { editor: EditorCore }) => Promise<void>;
	exportPreset: ({
		editor,
		preset,
	}: {
		editor: EditorCore;
		preset: AutoLiveClipResolutionPreset;
	}) => Promise<void>;
}

function getMediaById({
	assets,
	mediaId,
	expectedType,
}: {
	assets: MediaAsset[];
	mediaId: string | null;
	expectedType: MediaAsset["type"];
}): MediaAsset {
	const media = assets.find((asset) => asset.id === mediaId);
	if (!media || media.type !== expectedType) {
		throw new Error(`Missing ${expectedType} media selection`);
	}
	return media;
}

async function hashFileForCache({ file }: { file: File }): Promise<string> {
	if (!("crypto" in window) || !window.crypto.subtle) {
		return `${file.name}:${file.size}:${file.lastModified}`;
	}
	const payload = await file.arrayBuffer();
	const digest = await crypto.subtle.digest("SHA-256", payload);
	const bytes = Array.from(new Uint8Array(digest));
	return bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
}

function buildOptions({
	clipMode,
	maxClipMinutes,
	privacyProtectCrowd,
	preferLeadSinger,
}: {
	clipMode: AutoLiveClipClipMode;
	maxClipMinutes: number | null;
	privacyProtectCrowd: boolean;
	preferLeadSinger: boolean;
}): AutoLiveClipOptions {
	return {
		clipMode,
		maxClipMinutes: clipMode === "minutes" ? maxClipMinutes ?? 1 : null,
		privacyProtectCrowd,
		preferLeadSinger,
	};
}

function selectAndRevealSegment({
	editor,
	segment,
}: {
	editor: EditorCore;
	segment: AutoLiveClipSegmentPlan;
}): void {
	editor.playback.seek({ time: segment.start });
	if (segment.trackId && segment.elementId) {
		editor.selection.setSelectedElements({
			elements: [{ trackId: segment.trackId, elementId: segment.elementId }],
		});
	}
}

function triggerDownload({
	url,
	filename,
}: {
	url: string;
	filename: string;
}): void {
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
}

export const useAutoLiveClipStore = create<AutoLiveClipState>((set, get) => ({
	selectedVideoMediaId: null,
	selectedMasterAudioMediaId: null,
	clipMode: "whole_song",
	maxClipMinutes: null,
	privacyProtectCrowd: true,
	preferLeadSinger: true,
	isAnalyzing: false,
	isRendering: false,
	progressStep: null,
	errorMessage: null,
	analysis: null,
	strictSyncResult: null,
	selectedSegmentId: null,
	analysisCache: {},

	setSelectedVideoMediaId: (mediaId) => set({ selectedVideoMediaId: mediaId }),
	setSelectedMasterAudioMediaId: (mediaId) =>
		set({ selectedMasterAudioMediaId: mediaId }),
	setClipMode: (mode) => set({ clipMode: mode }),
	setMaxClipMinutes: (minutes) => set({ maxClipMinutes: minutes }),
	setPrivacyProtectCrowd: (value) => set({ privacyProtectCrowd: value }),
	setPreferLeadSinger: (value) => set({ preferLeadSinger: value }),
	selectSegment: (segmentId) => set({ selectedSegmentId: segmentId }),
	setAnalysis: (analysis) =>
		set({
			analysis,
			selectedSegmentId: analysis?.segments[0]?.segmentId ?? null,
		}),

	strictSyncTimeline: async ({ editor }) => {
		try {
			set({
				isAnalyzing: true,
				errorMessage: null,
				progressStep: "Preparing media for strict sync...",
			});
			const assets = editor.media.getAssets();
			const videoAsset = getMediaById({
				assets,
				mediaId: get().selectedVideoMediaId,
				expectedType: "video",
			});
			const masterAudioAsset = getMediaById({
				assets,
				mediaId: get().selectedMasterAudioMediaId,
				expectedType: "audio",
			});
			const options = buildOptions({
				clipMode: "whole_song",
				maxClipMinutes: null,
				privacyProtectCrowd: get().privacyProtectCrowd,
				preferLeadSinger: get().preferLeadSinger,
			});

			set({ progressStep: "Hashing media for sync cache..." });
			const [videoHash, audioHash] = await Promise.all([
				hashFileForCache({ file: videoAsset.file }),
				hashFileForCache({ file: masterAudioAsset.file }),
			]);
			const cacheKey = `${videoHash}:${audioHash}:${JSON.stringify(options)}`;

			let analysis = get().analysisCache[cacheKey] ?? null;
			if (!analysis) {
				set({ progressStep: "Extracting audio and syncing..." });
				analysis = await analyzeAutoLiveClip({
					videoFile: videoAsset.file,
					masterAudioFile: masterAudioAsset.file,
					options,
				});
				set((state) => ({
					analysisCache: {
						...state.analysisCache,
						[cacheKey]: analysis,
					},
				}));
			}

			set({ progressStep: "Building strict synced timeline..." });
			const result = applyStrictSyncToTracks({
				existingTracks: editor.timeline.getTracks(),
				videoAsset,
				masterAudioAsset,
				syncOffsetSeconds: analysis.syncOffsetSeconds,
			});
			editor.timeline.updateTracks(result.tracks);
			editor.playback.seek({ time: result.placement.videoTimelineStart });

			set({
				isAnalyzing: false,
				progressStep: null,
				errorMessage: null,
				analysis,
				selectedSegmentId: analysis.segments[0]?.segmentId ?? null,
				strictSyncResult: {
					syncOffsetSeconds: analysis.syncOffsetSeconds,
					...result.placement,
				},
			});
			toast.success("Strict sync timeline generated");
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Strict sync failed";
			set({
				isAnalyzing: false,
				progressStep: null,
				errorMessage,
			});
			toast.error(errorMessage);
		}
	},

	analyzeAndBuildTimeline: async ({ editor }) => {
		try {
			set({
				isAnalyzing: true,
				errorMessage: null,
				progressStep: "Preparing media...",
			});
			const assets = editor.media.getAssets();
			const videoAsset = getMediaById({
				assets,
				mediaId: get().selectedVideoMediaId,
				expectedType: "video",
			});
			const masterAudioAsset = getMediaById({
				assets,
				mediaId: get().selectedMasterAudioMediaId,
				expectedType: "audio",
			});
			const options = buildOptions({
				clipMode: get().clipMode,
				maxClipMinutes: get().maxClipMinutes,
				privacyProtectCrowd: get().privacyProtectCrowd,
				preferLeadSinger: get().preferLeadSinger,
			});

			set({ progressStep: "Hashing media for analysis cache..." });
			const [videoHash, audioHash] = await Promise.all([
				hashFileForCache({ file: videoAsset.file }),
				hashFileForCache({ file: masterAudioAsset.file }),
			]);
			const cacheKey = `${videoHash}:${audioHash}:${JSON.stringify(options)}`;

			let analysis = get().analysisCache[cacheKey] ?? null;
			if (!analysis) {
				set({ progressStep: "Extracting audio and syncing..." });
				analysis = await analyzeAutoLiveClip({
					videoFile: videoAsset.file,
					masterAudioFile: masterAudioAsset.file,
					options,
				});
				set((state) => ({
					analysisCache: {
						...state.analysisCache,
						[cacheKey]: analysis,
					},
				}));
			}

			set({ progressStep: "Building editable timeline..." });
			const result = applyAutoLiveClipAnalysisToTracks({
				existingTracks: editor.timeline.getTracks(),
				videoAsset,
				masterAudioAsset,
				analysis,
			});
			editor.timeline.updateTracks(result.tracks);
			editor.scenes.setActiveSceneAutoLiveClip({
				autoLiveClip: result.sceneMetadata,
			});

			const firstSegment = result.sceneMetadata.analysis.segments[0] ?? null;
			if (firstSegment) {
				selectAndRevealSegment({ editor, segment: firstSegment });
			}

			set({
				analysis: result.sceneMetadata.analysis,
				strictSyncResult: null,
				selectedSegmentId: firstSegment?.segmentId ?? null,
				isAnalyzing: false,
				progressStep: null,
				errorMessage: null,
			});
			toast.success("Auto Live Clip timeline generated");
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Auto Live Clip failed";
			set({
				isAnalyzing: false,
				progressStep: null,
				errorMessage,
			});
			toast.error(errorMessage);
		}
	},

	exportPreset: async ({ editor, preset }) => {
		try {
			set({
				isRendering: true,
				errorMessage: null,
				progressStep: `Rendering ${preset.toUpperCase()}...`,
			});
			const analysis = get().analysis;
			if (!analysis) {
				throw new Error("Run Analyze & Build Timeline before exporting.");
			}
			const assets = editor.media.getAssets();
			const videoAsset = getMediaById({
				assets,
				mediaId: get().selectedVideoMediaId,
				expectedType: "video",
			});
			const masterAudioAsset = getMediaById({
				assets,
				mediaId: get().selectedMasterAudioMediaId,
				expectedType: "audio",
			});
			const result = await renderAutoLiveClip({
				videoFile: videoAsset.file,
				masterAudioFile: masterAudioAsset.file,
				analysis,
				preset,
				privacyProtectCrowd: get().privacyProtectCrowd,
			});
			const response = await fetch(result.downloadUrl);
			if (!response.ok) {
				throw new Error(`Download failed (${response.status})`);
			}
			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const projectName = editor.project.getActive().metadata.name;
			triggerDownload({
				url: objectUrl,
				filename: `${projectName}-auto-live-clip-${preset}.mp4`,
			});
			URL.revokeObjectURL(objectUrl);
			set({
				isRendering: false,
				progressStep: null,
				errorMessage: null,
			});
			toast.success(`Exported ${preset.toUpperCase()} clip`);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Auto Live Clip export failed";
			set({
				isRendering: false,
				progressStep: null,
				errorMessage,
			});
			toast.error(errorMessage);
		}
	},
}));
