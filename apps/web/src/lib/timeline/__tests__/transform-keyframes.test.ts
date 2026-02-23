import { describe, expect, it } from "bun:test";
import type { Transform } from "@/types/timeline";
import { getTransformAtLocalTime } from "@/lib/timeline/transform-keyframes";

function baseTransform(): Transform {
	return {
		scale: 1,
		position: { x: 0, y: 0 },
		rotate: 0,
	};
}

describe("getTransformAtLocalTime", () => {
	it("returns base transform when no keyframes exist", () => {
		const transform = baseTransform();
		expect(getTransformAtLocalTime({ transform, localTime: 1.25 })).toEqual(
			transform,
		);
	});

	it("clamps before first and after last keyframe", () => {
		const transform: Transform = {
			...baseTransform(),
			keyframes: [
				{ time: 1, scale: 1.2, position: { x: 10, y: -5 } },
				{ time: 3, scale: 1.8, position: { x: 50, y: 25 } },
			],
		};

		expect(getTransformAtLocalTime({ transform, localTime: 0 })).toEqual({
			scale: 1.2,
			position: { x: 10, y: -5 },
			rotate: 0,
		});
		expect(getTransformAtLocalTime({ transform, localTime: 10 })).toEqual({
			scale: 1.8,
			position: { x: 50, y: 25 },
			rotate: 0,
		});
	});

	it("linearly interpolates scale and position between keyframes", () => {
		const transform: Transform = {
			...baseTransform(),
			keyframes: [
				{ time: 2, scale: 1.0, position: { x: 0, y: 0 } },
				{ time: 4, scale: 2.0, position: { x: 100, y: -40 } },
			],
		};

		expect(getTransformAtLocalTime({ transform, localTime: 3 })).toEqual({
			scale: 1.5,
			position: { x: 50, y: -20 },
			rotate: 0,
		});
	});

	it("sorts unsorted keyframes before interpolation", () => {
		const transform: Transform = {
			...baseTransform(),
			keyframes: [
				{ time: 5, scale: 2, position: { x: 200, y: 0 } },
				{ time: 1, scale: 1, position: { x: 0, y: 0 } },
			],
		};

		expect(getTransformAtLocalTime({ transform, localTime: 3 })).toEqual({
			scale: 1.5,
			position: { x: 100, y: 0 },
			rotate: 0,
		});
	});
});
