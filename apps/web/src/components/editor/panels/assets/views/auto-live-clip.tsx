"use client";

import { useEffect, useMemo } from "react";
import { invokeAction } from "@/lib/actions";
import { useEditor } from "@/hooks/use-editor";
import { useAutoLiveClipStore } from "@/stores/auto-live-clip-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";

function confidenceLabel(confidence: number): string {
	if (confidence >= 0.75) return "high";
	if (confidence >= 0.5) return "medium";
	return "low";
}

export function AutoLiveClipView() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const activeScene = editor.scenes.getActiveScene();
	const mediaAssets = editor.media.getAssets().filter((asset) => !asset.ephemeral);
	const videoAssets = useMemo(
		() => mediaAssets.filter((asset) => asset.type === "video"),
		[mediaAssets],
	);
	const audioAssets = useMemo(
		() => mediaAssets.filter((asset) => asset.type === "audio"),
		[mediaAssets],
	);

	const {
		selectedVideoMediaId,
		selectedMasterAudioMediaId,
		clipMode,
		maxClipMinutes,
		privacyProtectCrowd,
		preferLeadSinger,
		isAnalyzing,
		isRendering,
		progressStep,
		errorMessage,
		analysis,
		strictSyncResult,
		selectedSegmentId,
		setSelectedVideoMediaId,
		setSelectedMasterAudioMediaId,
		setClipMode,
		setMaxClipMinutes,
		setPrivacyProtectCrowd,
		setPreferLeadSinger,
		selectSegment,
		setAnalysis,
	} = useAutoLiveClipStore();

	useEffect(() => {
		const sceneAnalysis = activeScene.autoLiveClip?.analysis ?? null;
		if (!sceneAnalysis || analysis?.analysisId === sceneAnalysis.analysisId) {
			return;
		}
		setAnalysis(sceneAnalysis);
	}, [activeScene.autoLiveClip, analysis?.analysisId, setAnalysis]);

	useEffect(() => {
		if (!selectedVideoMediaId && videoAssets[0]) {
			setSelectedVideoMediaId(videoAssets[0].id);
		}
		if (!selectedMasterAudioMediaId && audioAssets[0]) {
			setSelectedMasterAudioMediaId(audioAssets[0].id);
		}
	}, [
		selectedVideoMediaId,
		selectedMasterAudioMediaId,
		videoAssets,
		audioAssets,
		setSelectedVideoMediaId,
		setSelectedMasterAudioMediaId,
	]);

	const selectedSegment = analysis?.segments.find(
		(segment) => segment.segmentId === selectedSegmentId,
	);

	const handleSegmentClick = ({
		segmentId,
	}: {
		segmentId: string;
	}) => {
		selectSegment(segmentId);
		const segment = analysis?.segments.find(
			(item) => item.segmentId === segmentId,
		);
		if (!segment) return;
		editor.playback.seek({ time: segment.start });
		if (segment.trackId && segment.elementId) {
			editor.selection.setSelectedElements({
				elements: [{ trackId: segment.trackId, elementId: segment.elementId }],
			});
		}
	};

	const canAnalyze = !!selectedVideoMediaId && !!selectedMasterAudioMediaId;
	const busy = isAnalyzing || isRendering;

	return (
		<div className="flex h-full flex-col">
			<div className="border-b p-4">
				<h3 className="text-sm font-semibold">Auto Live Clip</h3>
				<p className="text-muted-foreground mt-1 text-xs">
					Build an editable live-performance timeline from one camera video and
					a master audio mix.
				</p>
			</div>

			<ScrollArea className="flex-1">
				<div className="space-y-4 p-4">
					<div className="space-y-2">
						<Label className="text-xs">Video source</Label>
						<Select
							value={selectedVideoMediaId ?? undefined}
							onValueChange={(value) => setSelectedVideoMediaId(value)}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select imported video" />
							</SelectTrigger>
							<SelectContent>
								{videoAssets.map((asset) => (
									<SelectItem key={asset.id} value={asset.id}>
										{asset.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label className="text-xs">Master audio</Label>
						<Select
							value={selectedMasterAudioMediaId ?? undefined}
							onValueChange={(value) => setSelectedMasterAudioMediaId(value)}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select imported audio" />
							</SelectTrigger>
							<SelectContent>
								{audioAssets.map((asset) => (
									<SelectItem key={asset.id} value={asset.id}>
										{asset.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label className="text-xs">Clip length</Label>
						<RadioGroup
							value={clipMode}
							onValueChange={(value) =>
								setClipMode(value as "whole_song" | "minutes")
							}
						>
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="whole_song" id="whole_song" />
								<Label htmlFor="whole_song">Whole song (default)</Label>
							</div>
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="minutes" id="minutes" />
								<Label htmlFor="minutes">1-4 minute clip</Label>
							</div>
						</RadioGroup>
						{clipMode === "minutes" && (
							<Select
								value={(maxClipMinutes ?? 2).toString()}
								onValueChange={(value) => setMaxClipMinutes(Number(value))}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select duration" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="1">1 minute</SelectItem>
									<SelectItem value="2">2 minutes</SelectItem>
									<SelectItem value="3">3 minutes</SelectItem>
									<SelectItem value="4">4 minutes</SelectItem>
								</SelectContent>
							</Select>
						)}
					</div>

					<div className="space-y-2">
						<div className="flex items-center space-x-2">
							<Checkbox
								id="privacy-protect-crowd"
								checked={privacyProtectCrowd}
								onCheckedChange={(checked) => setPrivacyProtectCrowd(!!checked)}
							/>
							<Label htmlFor="privacy-protect-crowd">Privacy protect crowd</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="prefer-lead-singer"
								checked={preferLeadSinger}
								onCheckedChange={(checked) => setPreferLeadSinger(!!checked)}
							/>
							<Label htmlFor="prefer-lead-singer">Prefer lead singer</Label>
						</div>
					</div>

					<div className="space-y-2">
						<Button
							variant="secondary"
							className="w-full"
							disabled={!canAnalyze || busy}
							onClick={() => invokeAction("auto-live-clip-strict-sync")}
						>
							Sync Audio + Video (Strict)
						</Button>
						<Button
							className="w-full"
							disabled={!canAnalyze || busy}
							onClick={() => invokeAction("auto-live-clip-analyze-build")}
						>
							Analyze &amp; Build Timeline
						</Button>
					</div>

					{progressStep && (
						<p className="text-muted-foreground text-xs">{progressStep}</p>
					)}
					{errorMessage && <p className="text-destructive text-xs">{errorMessage}</p>}

					{strictSyncResult && (
						<div className="space-y-2 rounded-md border p-3">
							<h4 className="text-xs font-semibold">Strict sync result</h4>
							<p className="text-muted-foreground text-xs">
								Correlation lag (master vs camera):{" "}
								{strictSyncResult.syncOffsetSeconds.toFixed(2)}s
							</p>
							<ul className="list-disc space-y-1 pl-4 text-xs">
								<li>
									Video start on timeline:{" "}
									{strictSyncResult.videoTimelineStart.toFixed(2)}s
								</li>
								<li>
									Video trim start: {strictSyncResult.videoTrimStart.toFixed(2)}s
								</li>
								<li>
									Master audio start on timeline:{" "}
									{strictSyncResult.audioTimelineStart.toFixed(2)}s
								</li>
								<li>
									Master audio trim start:{" "}
									{strictSyncResult.audioTrimStart.toFixed(2)}s
								</li>
							</ul>
						</div>
					)}

					<div className="space-y-2">
						<h4 className="text-xs font-semibold">Edit rationale</h4>
						{analysis?.segments.length ? (
							<div className="space-y-2">
								{analysis.segments.map((segment) => {
									const active = segment.segmentId === selectedSegmentId;
									return (
										<button
											key={segment.segmentId}
											type="button"
											className={`w-full rounded-md border px-3 py-2 text-left ${
												active ? "border-primary bg-accent" : "border-border"
											}`}
											onClick={() =>
												handleSegmentClick({ segmentId: segment.segmentId })
											}
										>
											<div className="text-xs font-medium">
												{segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s
											</div>
											<div className="text-muted-foreground mt-1 text-xs">
												Lead singer confidence:{" "}
												{confidenceLabel(segment.leadConfidence)}
											</div>
										</button>
									);
								})}
							</div>
						) : (
							<p className="text-muted-foreground text-xs">
								Run analysis to generate cut explanations.
							</p>
						)}
					</div>

					{selectedSegment && (
						<div className="space-y-2 rounded-md border p-3">
							<h4 className="text-xs font-semibold">Why this cut?</h4>
							<p className="text-muted-foreground text-xs">
								Segment {selectedSegment.segmentId} |{" "}
								{selectedSegment.start.toFixed(2)}s -{" "}
								{selectedSegment.end.toFixed(2)}s
							</p>
							<ul className="list-disc space-y-1 pl-4 text-xs">
								{selectedSegment.reasons.map((reason) => (
									<li key={reason}>{reason}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</ScrollArea>

			{!activeProject && (
				<div className="border-t p-3 text-xs text-amber-600">
					Open a project to use Auto Live Clip.
				</div>
			)}
		</div>
	);
}
