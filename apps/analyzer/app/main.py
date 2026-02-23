from __future__ import annotations

import json
import shutil
import threading
import uuid
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.audio_sync import estimate_sync_offset_from_wav_files
from app.cache import AnalyzerCache
from app.ffmpeg_utils import extract_audio_wav, media_duration_seconds
from app.models import AnalyzeOptions
from app.render import render_from_plan, resolution_for_preset
from app.segmentation import build_segment_plan
from app.settings import AnalyzerSettings, get_settings


def _parse_content_disposition(header_value: str) -> dict[str, str]:
    parts = [part.strip() for part in header_value.split(";")]
    result: dict[str, str] = {}
    if parts:
        result["type"] = parts[0].lower()
    for part in parts[1:]:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        result[key.strip().lower()] = value.strip().strip('"')
    return result


def parse_multipart_form_data(
    *, content_type: str, body: bytes
) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    if "boundary=" not in content_type:
        raise ValueError("Missing multipart boundary")
    boundary = content_type.split("boundary=", 1)[1].strip()
    boundary_bytes = ("--" + boundary).encode("utf-8")

    fields: dict[str, str] = {}
    files: dict[str, dict[str, Any]] = {}
    for raw_part in body.split(boundary_bytes):
        part = raw_part.strip()
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2]
        part = part.strip(b"\r\n")
        header_bytes, separator, data = part.partition(b"\r\n\r\n")
        if not separator:
            continue

        headers: dict[str, str] = {}
        for line in header_bytes.split(b"\r\n"):
            key, _, value = line.decode("utf-8").partition(":")
            headers[key.strip().lower()] = value.strip()

        disposition = _parse_content_disposition(
            headers.get("content-disposition", "")
        )
        name = disposition.get("name")
        if not name:
            continue

        payload = data.rstrip(b"\r\n")
        filename = disposition.get("filename")
        if filename:
            files[name] = {
                "filename": filename,
                "content_type": headers.get("content-type", "application/octet-stream"),
                "content": payload,
            }
        else:
            fields[name] = payload.decode("utf-8")

    return fields, files


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode("utf-8")


def _parse_json_field(fields: dict[str, str], key: str) -> dict[str, Any]:
    if key not in fields:
        return {}
    value = fields[key].strip()
    if not value:
        return {}
    return json.loads(value)


def _parse_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


class AnalyzerRequestHandler(BaseHTTPRequestHandler):
    cache: AnalyzerCache
    settings: AnalyzerSettings
    server_version = "AutoLiveClipAnalyzer/0.1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return

        if parsed.path.startswith("/artifact/"):
            artifact_id = parsed.path.removeprefix("/artifact/")
            artifact_path = self.cache.artifact_path(artifact_id)
            if artifact_path is None or not artifact_path.exists():
                self._send_json(
                    HTTPStatus.NOT_FOUND, {"error": "artifact not found", "artifact_id": artifact_id}
                )
                return

            payload = artifact_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self._send_cors_headers()
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header(
                "Content-Disposition", f'attachment; filename="{artifact_path.name}"'
            )
            self.end_headers()
            self.wfile.write(payload)
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/analyze":
            self._handle_analyze()
            return
        if parsed.path == "/render":
            self._handle_render()
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def _handle_analyze(self) -> None:
        try:
            fields, files = self._read_multipart_request()
            video_file = files.get("video")
            master_audio_file = files.get("master_audio")
            if not video_file or not master_audio_file:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Missing required files: video and master_audio"},
                )
                return

            options_payload = _parse_json_field(fields, "options")
            options = AnalyzeOptions.from_payload(options_payload)

            video_path, video_hash = self.cache.persist_upload(
                filename=video_file["filename"],
                payload=video_file["content"],
            )
            master_audio_path, master_audio_hash = self.cache.persist_upload(
                filename=master_audio_file["filename"],
                payload=master_audio_file["content"],
            )

            analysis_key = self.cache.hash_bytes(
                _json_bytes(
                    {
                        "analyzer_pipeline_version": 2,
                        "video_hash": video_hash,
                        "master_audio_hash": master_audio_hash,
                        "options": asdict(options),
                    }
                )
            )
            cached = self.cache.find_analysis_by_key(analysis_key)
            if cached:
                self._send_json(HTTPStatus.OK, self._public_analysis_payload(cached))
                return

            analysis = self._analyze_media(
                video_path=video_path,
                master_audio_path=master_audio_path,
                options=options,
                analysis_key=analysis_key,
            )
            saved = self.cache.save_analysis(analysis)
            self._send_json(HTTPStatus.OK, self._public_analysis_payload(saved))
        except Exception as error:  # noqa: BLE001
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Analyze failed: {error}"},
            )

    def _handle_render(self) -> None:
        try:
            content_type = self.headers.get("Content-Type", "")
            payload: dict[str, Any] = {}
            fields: dict[str, str] = {}
            files: dict[str, dict[str, Any]] = {}

            if content_type.startswith("multipart/form-data"):
                fields, files = self._read_multipart_request()
                payload = _parse_json_field(fields, "payload")
            else:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length)
                payload = json.loads(raw.decode("utf-8")) if raw else {}

            analysis_id = payload.get("analysis_id") or fields.get("analysis_id")
            plan = payload.get("plan")
            if not plan and "plan" in fields:
                plan = json.loads(fields["plan"])

            preset = str(payload.get("preset") or fields.get("preset") or "1080p")
            apply_privacy_blur = _parse_bool(
                payload.get("privacy_protect_crowd")
                or fields.get("privacy_protect_crowd"),
                True,
            )

            sync_offset_seconds = float(payload.get("sync_offset_seconds", 0.0))
            video_path: Path | None = None
            audio_path: Path | None = None

            if files.get("video"):
                video_path, _ = self.cache.persist_upload(
                    filename=files["video"]["filename"],
                    payload=files["video"]["content"],
                )
            if files.get("master_audio"):
                audio_path, _ = self.cache.persist_upload(
                    filename=files["master_audio"]["filename"],
                    payload=files["master_audio"]["content"],
                )

            if analysis_id:
                cached = self.cache.get_analysis_by_id(str(analysis_id))
                if cached:
                    if plan is None:
                        plan = {"segments": cached.get("segments", [])}
                    sync_offset_seconds = float(
                        payload.get(
                            "sync_offset_seconds",
                            cached.get("sync_offset_seconds", sync_offset_seconds),
                        )
                    )
                    if video_path is None and cached.get("video_path"):
                        video_path = Path(cached["video_path"])
                    if audio_path is None and cached.get("master_audio_path"):
                        audio_path = Path(cached["master_audio_path"])

            if plan is None:
                raise ValueError("Missing plan payload")
            segments = plan.get("segments", []) if isinstance(plan, dict) else plan
            if not isinstance(segments, list) or not segments:
                raise ValueError("Plan must include at least one segment")
            if video_path is None or audio_path is None:
                raise ValueError("Missing source media for render")

            artifact_id, output_path = self.cache.make_artifact_path(".mp4")
            render_from_plan(
                video_path=video_path,
                master_audio_path=audio_path,
                segments=segments,
                sync_offset_seconds=sync_offset_seconds,
                preset=preset,
                output_path=output_path,
                apply_privacy_blur=apply_privacy_blur,
            )
            width, height = resolution_for_preset(preset)
            self._send_json(
                HTTPStatus.OK,
                {
                    "artifact_id": artifact_id,
                    "download_url": f"/artifact/{artifact_id}",
                    "width": width,
                    "height": height,
                    "preset": preset.lower(),
                },
            )
        except Exception as error:  # noqa: BLE001
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"Render failed: {error}"},
            )

    def _analyze_media(
        self,
        *,
        video_path: Path,
        master_audio_path: Path,
        options: AnalyzeOptions,
        analysis_key: str,
    ) -> dict[str, Any]:
        work_dir = self.settings.temp_dir / uuid.uuid4().hex
        work_dir.mkdir(parents=True, exist_ok=True)

        video_wav = work_dir / "video.wav"
        master_wav = work_dir / "master.wav"
        extract_audio_wav(video_path, video_wav, sample_rate=2000)
        extract_audio_wav(master_audio_path, master_wav, sample_rate=2000)

        video_duration = media_duration_seconds(video_path)
        master_duration = media_duration_seconds(master_audio_path)
        dynamic_max_shift_seconds = max(
            self.settings.max_sync_shift_seconds,
            abs(master_duration - video_duration) + 10.0,
        )

        sync_offset_seconds = estimate_sync_offset_from_wav_files(
            video_wav_path=video_wav,
            master_wav_path=master_wav,
            max_shift_seconds=dynamic_max_shift_seconds,
        )
        target_duration = min(video_duration, master_duration)
        if options.clip_mode == "minutes" and options.max_clip_minutes:
            target_duration = min(target_duration, float(options.max_clip_minutes) * 60.0)

        segments = build_segment_plan(
            duration_seconds=target_duration,
            sync_offset_seconds=sync_offset_seconds,
            options=options,
        )

        shutil.rmtree(work_dir, ignore_errors=True)
        return {
            "analysis_id": uuid.uuid4().hex,
            "analysis_key": analysis_key,
            "sync_offset_seconds": round(sync_offset_seconds, 6),
            "segments": [segment.to_dict() for segment in segments],
            "artifacts": {
                "video_path": str(video_path),
                "master_audio_path": str(master_audio_path),
            },
            "video_path": str(video_path),
            "master_audio_path": str(master_audio_path),
        }

    def _public_analysis_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "analysis_id": payload.get("analysis_id"),
            "sync_offset_seconds": payload.get("sync_offset_seconds", 0.0),
            "segments": payload.get("segments", []),
            "artifacts": {
                "analysis_id": payload.get("analysis_id"),
            },
        }

    def _read_multipart_request(self) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        return parse_multipart_form_data(content_type=content_type, body=body)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        data = _json_bytes(payload)
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


class AnalyzerServer:
    def __init__(
        self,
        *,
        host: str | None = None,
        port: int | None = None,
        settings: AnalyzerSettings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.host = host or self.settings.host
        self.port = self.settings.port if port is None else port
        self._thread: threading.Thread | None = None
        self._server: ThreadingHTTPServer | None = None

    def start(self) -> None:
        if self._server is not None:
            return
        cache = AnalyzerCache(self.settings.cache_dir)
        handler = self._build_handler(cache=cache, settings=self.settings)
        self._server = ThreadingHTTPServer((self.host, self.port), handler)
        self.host = str(self._server.server_address[0])
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is None:
            return
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
        self._thread = None
        self._server = None

    @staticmethod
    def _build_handler(
        *, cache: AnalyzerCache, settings: AnalyzerSettings
    ) -> type[AnalyzerRequestHandler]:
        class BoundAnalyzerHandler(AnalyzerRequestHandler):
            pass

        BoundAnalyzerHandler.cache = cache
        BoundAnalyzerHandler.settings = settings
        return BoundAnalyzerHandler


def main() -> None:
    server = AnalyzerServer()
    print(f"Auto Live Clip analyzer listening on http://{server.host}:{server.port}")  # noqa: T201
    server.start()
    try:
        while True:
            threading.Event().wait(timeout=3600)
    except KeyboardInterrupt:
        server.stop()


if __name__ == "__main__":
    main()
