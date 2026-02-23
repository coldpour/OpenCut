import json
import os
import subprocess
import tempfile
import unittest
import urllib.request
from uuid import uuid4

from app.main import AnalyzerServer


def _make_multipart_body(
    *,
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = f"----AutoLiveClipBoundary{uuid4().hex}"
    chunks: list[bytes] = []

    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
        )
        chunks.append(value.encode("utf-8"))
        chunks.append(b"\r\n")

    for name, (filename, content, content_type) in files.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{name}"; '
                f'filename="{filename}"\r\n'
            ).encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        chunks.append(content)
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


def _generate_fixture_media(temp_dir: str) -> tuple[str, str]:
    video_path = os.path.join(temp_dir, "fixture-video.mp4")
    audio_path = os.path.join(temp_dir, "fixture-master.wav")

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=size=640x360:rate=30:color=black",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:sample_rate=44100:duration=4",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            video_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:sample_rate=44100:duration=4",
            "-c:a",
            "pcm_s16le",
            audio_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    return video_path, audio_path


class AnalyzerApiIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = AnalyzerServer(host="127.0.0.1", port=0)
        self.server.start()

    def tearDown(self) -> None:
        self.server.stop()

    def test_health_analyze_render_flow(self) -> None:
        with urllib.request.urlopen(
            f"http://{self.server.host}:{self.server.port}/health"
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(payload["status"], "ok")

        with tempfile.TemporaryDirectory() as temp_dir:
            video_path, audio_path = _generate_fixture_media(temp_dir)
            with open(video_path, "rb") as video_file:
                video_bytes = video_file.read()
            with open(audio_path, "rb") as audio_file:
                audio_bytes = audio_file.read()

            body, content_type = _make_multipart_body(
                fields={
                    "options": json.dumps(
                        {
                            "clip_mode": "whole_song",
                            "privacy_protect_crowd": True,
                            "prefer_lead_singer": True,
                        }
                    )
                },
                files={
                    "video": ("fixture-video.mp4", video_bytes, "video/mp4"),
                    "master_audio": ("fixture-master.wav", audio_bytes, "audio/wav"),
                },
            )

            request = urllib.request.Request(
                url=f"http://{self.server.host}:{self.server.port}/analyze",
                data=body,
                method="POST",
                headers={"Content-Type": content_type},
            )

            with urllib.request.urlopen(request) as response:
                payload = json.loads(response.read().decode("utf-8"))

            self.assertIn("analysis_id", payload)
            self.assertIn("sync_offset_seconds", payload)
            self.assertIn("segments", payload)
            self.assertIsInstance(payload["segments"], list)
            self.assertGreater(len(payload["segments"]), 0)
            self.assertIn("artifacts", payload)

            render_body, render_content_type = _make_multipart_body(
                fields={
                    "analysis_id": payload["analysis_id"],
                    "plan": json.dumps({"segments": payload["segments"]}),
                    "sync_offset_seconds": str(payload["sync_offset_seconds"]),
                    "preset": "1080p",
                    "privacy_protect_crowd": "true",
                },
                files={
                    "video": ("fixture-video.mp4", video_bytes, "video/mp4"),
                    "master_audio": ("fixture-master.wav", audio_bytes, "audio/wav"),
                },
            )
            render_request = urllib.request.Request(
                url=f"http://{self.server.host}:{self.server.port}/render",
                data=render_body,
                method="POST",
                headers={"Content-Type": render_content_type},
            )
            with urllib.request.urlopen(render_request) as response:
                render_payload = json.loads(response.read().decode("utf-8"))

            self.assertIn("artifact_id", render_payload)
            self.assertIn("download_url", render_payload)
            self.assertEqual(render_payload["width"], 1920)
            self.assertEqual(render_payload["height"], 1080)

            with urllib.request.urlopen(
                f"http://{self.server.host}:{self.server.port}{render_payload['download_url']}"
            ) as response:
                artifact_bytes = response.read()

            artifact_path = os.path.join(temp_dir, "rendered.mp4")
            with open(artifact_path, "wb") as artifact_file:
                artifact_file.write(artifact_bytes)

            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=width,height",
                    "-of",
                    "json",
                    artifact_path,
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            probe_payload = json.loads(probe.stdout)
            first_video_stream = probe_payload["streams"][0]
            self.assertEqual(first_video_stream["width"], 1920)
            self.assertEqual(first_video_stream["height"], 1080)


if __name__ == "__main__":
    unittest.main()
