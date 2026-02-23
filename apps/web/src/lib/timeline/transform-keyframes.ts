import type { Transform, TransformKeyframe } from "@/types/timeline";

function sortKeyframes(
	keyframes: TransformKeyframe[],
): TransformKeyframe[] {
	return [...keyframes].sort((a, b) => a.time - b.time);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function getTransformAtLocalTime({
	transform,
	localTime,
}: {
	transform: Transform;
	localTime: number;
}): Omit<Transform, "keyframes"> {
	const keyframes = transform.keyframes?.filter((keyframe) =>
		Number.isFinite(keyframe.time),
	);
	if (!keyframes || keyframes.length === 0) {
		return transform;
	}

	const sorted = sortKeyframes(keyframes);
	if (localTime <= sorted[0].time) {
		return {
			scale: sorted[0].scale,
			position: { ...sorted[0].position },
			rotate: transform.rotate,
		};
	}

	const last = sorted[sorted.length - 1];
	if (localTime >= last.time) {
		return {
			scale: last.scale,
			position: { ...last.position },
			rotate: transform.rotate,
		};
	}

	for (let index = 0; index < sorted.length - 1; index++) {
		const start = sorted[index];
		const end = sorted[index + 1];
		if (localTime < start.time || localTime > end.time) {
			continue;
		}

		const span = Math.max(1e-9, end.time - start.time);
		const t = (localTime - start.time) / span;
		return {
			scale: lerp(start.scale, end.scale, t),
			position: {
				x: lerp(start.position.x, end.position.x, t),
				y: lerp(start.position.y, end.position.y, t),
			},
			rotate: transform.rotate,
		};
	}

	return {
		scale: transform.scale,
		position: { ...transform.position },
		rotate: transform.rotate,
	};
}
