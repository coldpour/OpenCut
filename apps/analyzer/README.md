# Auto Live Clip Analyzer

Local analyzer/renderer service for OpenCut Auto Live Clip MVP.

## Requirements

- Python 3.11+
- `ffmpeg` and `ffprobe` on `PATH`

## Run

From repository root:

```bash
PYTHONPATH=apps/analyzer python3 -m app.main
```

Default endpoint: `http://127.0.0.1:8765`

## API

- `GET /health`
- `POST /analyze`
  - multipart fields:
    - `video` (single-cam video file)
    - `master_audio` (master mix audio file)
    - `options` (JSON string)
- `POST /render`
  - multipart fields:
    - `video`
    - `master_audio`
    - `analysis_id`
    - `plan` (JSON string with segments)
    - `sync_offset_seconds`
    - `preset` (`1080p`, `2k`, `4k`)
    - `privacy_protect_crowd`
- `GET /artifact/{id}`

## Notes

- Analysis artifacts and rendered files are cached under `apps/analyzer/.cache`.
- Sync uses local ffmpeg extraction + waveform cross-correlation.
- Reframing uses deterministic heuristics biased toward center-stage and smooth motion.
- Privacy blur is only applied on segments flagged as crowd-risk during analysis.
