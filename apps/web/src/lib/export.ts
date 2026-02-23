import { EXPORT_MIME_TYPES } from "@/constants/export-constants";
import type { ExportFormat, ExportQuality } from "@/types/export";

export function getExportMimeType({
	format,
}: {
	format: ExportFormat;
}): string {
	return EXPORT_MIME_TYPES[format];
}

export function getExportFileExtension({
	format,
}: {
	format: ExportFormat;
}): string {
	return `.${format}`;
}

export function buildExportDownloadFilename({
	projectName,
	format,
}: {
	projectName: string;
	format: ExportFormat;
}): string {
	const extension = getExportFileExtension({ format });
	const trimmedName = projectName.trim().replace(/[. ]+$/g, "");
	const safeBaseName = trimmedName.length > 0 ? trimmedName : "export";
	if (safeBaseName.toLowerCase().endsWith(extension.toLowerCase())) {
		return safeBaseName;
	}
	return `${safeBaseName}${extension}`;
}

const QUALITY_FACTOR_MAP: Record<ExportQuality, number> = {
	low: 0.6,
	medium: 1,
	high: 2,
	very_high: 4,
};

const VIDEO_CODEC_BY_FORMAT: Record<ExportFormat, "avc" | "vp9"> = {
	mp4: "avc",
	webm: "vp9",
};

const AUDIO_CODEC_BY_FORMAT: Record<ExportFormat, "aac" | "opus"> = {
	mp4: "aac",
	webm: "opus",
};

export function getExportQualityStats({
	format,
	quality,
	width,
	height,
}: {
	format: ExportFormat;
	quality: ExportQuality;
	width: number;
	height: number;
}): {
	qualityFactor: number;
	videoCodec: "H.264/AVC" | "VP9";
	audioCodec: "AAC" | "Opus";
	videoBitrateBps: number;
	audioBitrateBps: number;
	totalBitrateBps: number;
	estimatedMegabytesPerMinute: number;
} {
	const codec = VIDEO_CODEC_BY_FORMAT[format];
	const audioCodec = AUDIO_CODEC_BY_FORMAT[format];
	const pixels = Math.max(1, width) * Math.max(1, height);
	const codecEfficiencyFactor = codec === "avc" ? 1 : 0.6;
	const qualityFactor = QUALITY_FACTOR_MAP[quality];
	const rawVideoBitrate =
		3000000 *
		(pixels / 2073600) ** 0.95 *
		codecEfficiencyFactor *
		qualityFactor;
	const videoBitrateBps = Math.ceil(rawVideoBitrate / 1000) * 1000;

	let audioBitrateBps = (audioCodec === "aac" ? 128000 : 64000) * qualityFactor;
	if (audioCodec === "aac") {
		audioBitrateBps = [96000, 128000, 160000, 192000].reduce((previous, current) =>
			Math.abs(current - audioBitrateBps) < Math.abs(previous - audioBitrateBps)
				? current
				: previous,
		);
	} else {
		audioBitrateBps = Math.max(6000, Math.round(audioBitrateBps / 1000) * 1000);
	}

	return {
		qualityFactor,
		videoCodec: codec === "avc" ? "H.264/AVC" : "VP9",
		audioCodec: audioCodec === "aac" ? "AAC" : "Opus",
		videoBitrateBps,
		audioBitrateBps,
		totalBitrateBps: videoBitrateBps + audioBitrateBps,
		estimatedMegabytesPerMinute:
			((videoBitrateBps + audioBitrateBps) / 8) * 60 / 1_000_000,
	};
}

export function formatBitrateMbps(bps: number): string {
	return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

export function formatBitrateKbps(bps: number): string {
	return `${Math.round(bps / 1000)} kbps`;
}

export function formatMegabytesPerMinute(megabytesPerMinute: number): string {
	return `~${megabytesPerMinute.toFixed(1)} MB/min`;
}
