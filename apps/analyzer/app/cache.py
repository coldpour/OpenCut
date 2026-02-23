from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any


class AnalyzerCache:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.upload_dir = cache_dir / "uploads"
        self.analysis_dir = cache_dir / "analysis"
        self.artifact_dir = cache_dir / "artifacts"
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.analysis_dir.mkdir(parents=True, exist_ok=True)
        self.artifact_dir.mkdir(parents=True, exist_ok=True)

    def hash_bytes(self, payload: bytes) -> str:
        return hashlib.sha256(payload).hexdigest()

    def hash_file(self, path: Path) -> str:
        sha = hashlib.sha256()
        with path.open("rb") as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                sha.update(chunk)
        return sha.hexdigest()

    def persist_upload(self, *, filename: str, payload: bytes) -> tuple[Path, str]:
        digest = self.hash_bytes(payload)
        suffix = Path(filename).suffix or ".bin"
        target = self.upload_dir / f"{digest}{suffix}"
        if not target.exists():
            target.write_bytes(payload)
        return target, digest

    def analysis_path(self, analysis_id: str) -> Path:
        return self.analysis_dir / f"{analysis_id}.json"

    def get_analysis_by_id(self, analysis_id: str) -> dict[str, Any] | None:
        path = self.analysis_path(analysis_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def find_analysis_by_key(self, analysis_key: str) -> dict[str, Any] | None:
        for candidate in self.analysis_dir.glob("*.json"):
            data = json.loads(candidate.read_text(encoding="utf-8"))
            if data.get("analysis_key") == analysis_key:
                return data
        return None

    def save_analysis(self, payload: dict[str, Any]) -> dict[str, Any]:
        if "analysis_id" not in payload:
            payload["analysis_id"] = uuid.uuid4().hex
        path = self.analysis_path(payload["analysis_id"])
        path.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    def make_artifact_path(self, suffix: str = ".mp4") -> tuple[str, Path]:
        artifact_id = uuid.uuid4().hex
        return artifact_id, self.artifact_dir / f"{artifact_id}{suffix}"

    def artifact_path(self, artifact_id: str) -> Path | None:
        for candidate in self.artifact_dir.glob(f"{artifact_id}.*"):
            return candidate
        return None

    def clear(self) -> None:
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.analysis_dir.mkdir(parents=True, exist_ok=True)
        self.artifact_dir.mkdir(parents=True, exist_ok=True)

