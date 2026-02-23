import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useEditor } from "@/hooks/use-editor";
import { clamp } from "@/utils/math";
import type {
	ImageElement,
	Transform,
	TransformKeyframe,
	VideoElement,
} from "@/types/timeline";
import {
	PropertyGroup,
	PropertyItem,
	PropertyItemLabel,
	PropertyItemValue,
} from "./property-item";
import { getTransformAtLocalTime } from "@/lib/timeline/transform-keyframes";

const KEYFRAME_EPSILON_SECONDS = 1 / 120;

function sortKeyframes(keyframes: TransformKeyframe[]): TransformKeyframe[] {
	return [...keyframes].sort((a, b) => a.time - b.time);
}

function findKeyframeIndexAtTime({
	keyframes,
	time,
}: {
	keyframes: TransformKeyframe[];
	time: number;
}): number {
	return keyframes.findIndex(
		(keyframe) => Math.abs(keyframe.time - time) <= KEYFRAME_EPSILON_SECONDS,
	);
}

function buildUpdatedTransform({
	transform,
	keyframes,
}: {
	transform: Transform;
	keyframes: TransformKeyframe[];
}): Transform {
	if (keyframes.length === 0) {
		const { keyframes: _unused, ...rest } = transform;
		return rest;
	}
	return {
		...transform,
		keyframes: sortKeyframes(keyframes),
	};
}

function upsertKeyframe({
	transform,
	keyframe,
}: {
	transform: Transform;
	keyframe: TransformKeyframe;
}): Transform {
	const existing = transform.keyframes ?? [];
	const next = [...existing];
	const index = findKeyframeIndexAtTime({ keyframes: next, time: keyframe.time });
	if (index >= 0) {
		next[index] = keyframe;
	} else {
		next.push(keyframe);
	}
	return buildUpdatedTransform({ transform, keyframes: next });
}

function removeKeyframe({
	transform,
	time,
}: {
	transform: Transform;
	time: number;
}): Transform {
	const existing = transform.keyframes ?? [];
	const next = existing.filter(
		(keyframe) => Math.abs(keyframe.time - time) > KEYFRAME_EPSILON_SECONDS,
	);
	return buildUpdatedTransform({ transform, keyframes: next });
}

function updateKeyframeField({
	transform,
	time,
	field,
	value,
}: {
	transform: Transform;
	time: number;
	field: "scale" | "x" | "y";
	value: number;
}): Transform {
	const existing = transform.keyframes ?? [];
	const index = findKeyframeIndexAtTime({ keyframes: existing, time });
	if (index < 0) {
		return transform;
	}
	const next = [...existing];
	const current = next[index];
	next[index] =
		field === "scale"
			? { ...current, scale: value }
			: {
					...current,
					position: {
						...current.position,
						[field]: value,
					},
				};
	return buildUpdatedTransform({ transform, keyframes: next });
}

function clampLocalTime({
	playheadTime,
	element,
}: {
	playheadTime: number;
	element: VideoElement | ImageElement;
}): number {
	const minTime = element.trimStart;
	const maxTime = element.trimStart + element.duration;
	const localTime = playheadTime - element.startTime + element.trimStart;
	return clamp({ value: localTime, min: minTime, max: maxTime });
}

export function VideoProperties({
	element,
	trackId,
}: {
	element: VideoElement | ImageElement;
	trackId: string;
}) {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const canvasSize = activeProject.settings.canvasSize;
	const playbackTime = editor.playback.getCurrentTime();
	const localPlayheadTime = clampLocalTime({ playheadTime: playbackTime, element });
	const sortedKeyframes = useMemo(
		() => sortKeyframes(element.transform.keyframes ?? []),
		[element.transform.keyframes],
	);
	const activeKeyframeIndex = findKeyframeIndexAtTime({
		keyframes: sortedKeyframes,
		time: localPlayheadTime,
	});
	const activeKeyframe =
		activeKeyframeIndex >= 0 ? sortedKeyframes[activeKeyframeIndex] : null;
	const effectiveTransform = getTransformAtLocalTime({
		transform: element.transform,
		localTime: localPlayheadTime,
	});
	const editingTransform = activeKeyframe
		? {
				scale: activeKeyframe.scale,
				position: activeKeyframe.position,
			}
		: {
				scale: element.transform.scale,
				position: element.transform.position,
			};

	const updateElementTransform = (transform: Transform) => {
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, updates: { transform } }],
		});
	};

	const setBaseField = ({
		field,
		value,
	}: {
		field: "scale" | "x" | "y";
		value: number;
	}) => {
		const nextTransform: Transform =
			field === "scale"
				? {
						...element.transform,
						scale: value,
					}
				: {
						...element.transform,
						position: {
							...element.transform.position,
							[field]: value,
						},
					};
		updateElementTransform(nextTransform);
	};

	const setPlayheadField = ({
		field,
		value,
	}: {
		field: "scale" | "x" | "y";
		value: number;
	}) => {
		if (activeKeyframe) {
			updateElementTransform(
				updateKeyframeField({
					transform: element.transform,
					time: localPlayheadTime,
					field,
					value,
				}),
			);
			return;
		}
		setBaseField({ field, value });
	};

	const handleSetKeyframeAtPlayhead = () => {
		updateElementTransform(
			upsertKeyframe({
				transform: element.transform,
				keyframe: {
					time: localPlayheadTime,
					scale: effectiveTransform.scale,
					position: { ...effectiveTransform.position },
				},
			}),
		);
	};

	const handleDeleteKeyframeAtPlayhead = () => {
		updateElementTransform(
			removeKeyframe({
				transform: element.transform,
				time: localPlayheadTime,
			}),
		);
	};

	const xRange = canvasSize.width;
	const yRange = canvasSize.height;

	return (
		<div className="flex h-full flex-col">
			<PropertyGroup title="Transform" hasBorderTop={false} collapsible={false}>
				<div className="space-y-4">
					<PropertyItem direction="column">
						<PropertyItemLabel>
							Playhead local time: {localPlayheadTime.toFixed(2)}s
						</PropertyItemLabel>
						<PropertyItemValue className="flex gap-2">
							<Button
								type="button"
								size="sm"
								variant="default"
								onClick={handleSetKeyframeAtPlayhead}
							>
								{activeKeyframe ? "Update Keyframe" : "Set Keyframe"}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={!activeKeyframe}
								onClick={handleDeleteKeyframeAtPlayhead}
							>
								Delete Keyframe
							</Button>
						</PropertyItemValue>
					</PropertyItem>

					<p className="text-muted-foreground text-xs">
						Editing {activeKeyframe ? "keyframe at playhead" : "base transform"}.
						Add a keyframe to animate pan/zoom.
					</p>

					<TransformControl
						label="Scale"
						value={editingTransform.scale}
						min={0.5}
						max={4}
						step={0.01}
						onChange={(value) =>
							setPlayheadField({
								field: "scale",
								value: clamp({ value, min: 0.5, max: 4 }),
							})
						}
					/>
					<TransformControl
						label="Position X"
						value={editingTransform.position.x}
						min={-xRange}
						max={xRange}
						step={1}
						onChange={(value) =>
							setPlayheadField({
								field: "x",
								value: clamp({ value, min: -xRange, max: xRange }),
							})
						}
					/>
					<TransformControl
						label="Position Y"
						value={editingTransform.position.y}
						min={-yRange}
						max={yRange}
						step={1}
						onChange={(value) =>
							setPlayheadField({
								field: "y",
								value: clamp({ value, min: -yRange, max: yRange }),
							})
						}
					/>

					<div className="rounded-md border p-2">
						<div className="text-xs font-medium">Preview at playhead</div>
						<div className="text-muted-foreground mt-1 text-xs">
							Scale {effectiveTransform.scale.toFixed(2)} · X{" "}
							{Math.round(effectiveTransform.position.x)} · Y{" "}
							{Math.round(effectiveTransform.position.y)}
						</div>
					</div>
				</div>
			</PropertyGroup>

			<PropertyGroup title="Transform Keyframes" collapsible={false}>
				{sortedKeyframes.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						No keyframes yet. Move the playhead and click "Set Keyframe".
					</p>
				) : (
					<div className="space-y-2">
						{sortedKeyframes.map((keyframe) => {
							const timelineTime =
								element.startTime + keyframe.time - element.trimStart;
							const isActive =
								Math.abs(keyframe.time - localPlayheadTime) <=
								KEYFRAME_EPSILON_SECONDS;
							return (
								<div
									key={`${element.id}-${keyframe.time.toFixed(4)}`}
									className={`rounded-md border p-2 ${isActive ? "border-primary" : "border-border"}`}
								>
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="text-xs font-medium">
												Local {keyframe.time.toFixed(2)}s
											</div>
											<div className="text-muted-foreground text-xs">
												Scale {keyframe.scale.toFixed(2)} · X{" "}
												{Math.round(keyframe.position.x)} · Y{" "}
												{Math.round(keyframe.position.y)}
											</div>
										</div>
										<div className="flex gap-1">
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() =>
													editor.playback.seek({
														time: Math.max(0, timelineTime),
													})
												}
											>
												Jump
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() =>
													updateElementTransform(
														removeKeyframe({
															transform: element.transform,
															time: keyframe.time,
														}),
													)
												}
											>
												Delete
											</Button>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</PropertyGroup>
		</div>
	);
}

function TransformControl({
	label,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}) {
	return (
		<PropertyItem direction="column">
			<div className="flex items-center justify-between">
				<PropertyItemLabel>{label}</PropertyItemLabel>
				<Input
					className="h-8 w-24 text-right"
					type="number"
					value={Number.isInteger(value) ? value.toString() : value.toFixed(2)}
					step={step}
					min={min}
					max={max}
					onChange={(event) => {
						const parsed = Number(event.target.value);
						if (Number.isFinite(parsed)) {
							onChange(parsed);
						}
					}}
				/>
			</div>
			<Slider
				value={[value]}
				min={min}
				max={max}
				step={step}
				onValueChange={([next]) => {
					if (typeof next === "number") {
						onChange(next);
					}
				}}
			/>
		</PropertyItem>
	);
}
