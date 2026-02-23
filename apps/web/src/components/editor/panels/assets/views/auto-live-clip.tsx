"use client";

import { useEffect, useMemo } from "react";
import { invokeAction } from "@/lib/actions";
import { useEditor } from "@/hooks/use-editor";
import { useAutoLiveClipStore } from "@/stores/auto-live-clip-store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AutoLiveClipView() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
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
		isAnalyzing,
		isRendering,
		progressStep,
		errorMessage,
		strictSyncResult,
		setSelectedVideoMediaId,
		setSelectedMasterAudioMediaId,
	} = useAutoLiveClipStore();
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

	const canAnalyze = !!selectedVideoMediaId && !!selectedMasterAudioMediaId;
	const busy = isAnalyzing || isRendering;

	return (
		<div className="flex h-full flex-col">
			<div className="border-b p-4">
				<h3 className="text-sm font-semibold">Auto Live Clip</h3>
				<p className="text-muted-foreground mt-1 text-xs">
					Build an editable live-performance timeline from one camera video and
					a master audio mix. Full-clip analysis is always used.
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
