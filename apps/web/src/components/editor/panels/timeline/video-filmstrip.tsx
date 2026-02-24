"use client";

import { useEffect, useRef } from "react";
import { videoCache } from "@/services/video-cache/service";

export function VideoFilmstrip({
	mediaId,
	file,
	trimStart,
	duration,
	width,
	height,
	className = "",
}: {
	mediaId: string;
	file: File;
	trimStart: number;
	duration: number;
	width: number;
	height: number;
	className?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		let cancelled = false;

		const draw = async () => {
			const canvas = canvasRef.current;
			if (!canvas) return;

			const cssWidth = Math.max(1, Math.floor(width));
			const cssHeight = Math.max(1, Math.floor(height));
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
			canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
			canvas.style.width = `${cssWidth}px`;
			canvas.style.height = `${cssHeight}px`;

			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.scale(dpr, dpr);
			ctx.fillStyle = "rgba(255,255,255,0.04)";
			ctx.fillRect(0, 0, cssWidth, cssHeight);

			if (duration <= 0 || cssWidth < 8) return;

			const frameCount = Math.max(1, Math.min(12, Math.floor(cssWidth / 56)));
			const segmentWidth = cssWidth / frameCount;
			const visibleDuration = Math.max(0.01, duration);

			for (let index = 0; index < frameCount; index++) {
				if (cancelled) return;
				const t = (index + 0.5) / frameCount;
				const mediaTime = trimStart + visibleDuration * t;
				try {
					const frame = await videoCache.getFrameAt({
						mediaId,
						file,
						time: mediaTime,
					});
					if (!frame || cancelled) continue;

					const x = index * segmentWidth;
					ctx.drawImage(frame.canvas, x, 0, segmentWidth + 1, cssHeight);
				} catch {
					// Fail soft: leave background fill if frame extraction fails.
				}
			}
		};

		void draw();

		return () => {
			cancelled = true;
		};
	}, [mediaId, file, trimStart, duration, width, height]);

	return <canvas ref={canvasRef} className={className} aria-hidden />;
}
