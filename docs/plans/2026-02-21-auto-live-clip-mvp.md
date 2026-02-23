# Auto Live Clip MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an end-to-end Auto Live Clip flow that analyzes a single-cam live performance (video + master audio), builds an editable OpenCut timeline with explanations, and exports 1080p/2K/4K via a local analyzer renderer.

**Architecture:** Add a local Python FastAPI service under `apps/analyzer` for audio sync, segment/reframe plan generation, and ffmpeg rendering. Add a new `Auto Live Clip` panel in `apps/web` that calls analyzer endpoints, applies timeline edits through EditorCore managers, persists segment rationale metadata in scenes, and triggers render exports via analyzer artifacts.

**Tech Stack:** FastAPI, Python stdlib + ffmpeg subprocess, Bun/TypeScript, OpenCut EditorCore managers/actions, Zustand store.

### Task 1: Baseline modeling + test scaffolding

**Files:**
- Create: `apps/analyzer/pyproject.toml`
- Create: `apps/analyzer/app/__init__.py`
- Create: `apps/analyzer/app/models.py`
- Create: `apps/analyzer/tests/test_models.py`

**Step 1: Write failing tests for proposal and segment schema shape**

**Step 2: Run tests to verify fail**

Run: `python3 -m unittest discover -s apps/analyzer/tests -p 'test_models.py' -v`

**Step 3: Implement minimal models to pass tests**

**Step 4: Re-run tests and verify pass**

### Task 2: Analyzer API skeleton

**Files:**
- Create: `apps/analyzer/app/main.py`
- Create: `apps/analyzer/app/settings.py`
- Create: `apps/analyzer/app/cache.py`
- Create: `apps/analyzer/tests/test_api_integration.py`

**Step 1: Write failing integration test for `/health` + `/analyze` schema**

**Step 2: Run failing test**

Run: `python3 -m unittest discover -s apps/analyzer/tests -p 'test_api_integration.py' -v`

**Step 3: Implement FastAPI app with `/health`, `/analyze`, `/render`, `/artifact/{id}` skeleton returning deterministic stub plan**

**Step 4: Re-run tests and verify pass**

### Task 3: Analyzer core logic (sync, segments, smoothing)

**Files:**
- Create: `apps/analyzer/app/audio_sync.py`
- Create: `apps/analyzer/app/segmentation.py`
- Create: `apps/analyzer/app/reframing.py`
- Create: `apps/analyzer/app/ffmpeg_utils.py`
- Create: `apps/analyzer/tests/test_audio_sync.py`
- Create: `apps/analyzer/tests/test_segmentation.py`
- Create: `apps/analyzer/tests/test_reframing.py`

**Step 1: Write failing tests for sync offset on synthetic signals, segment validity, smoothing speed limits**

**Step 2: Run tests and verify failures are expected**

Run: `python3 -m unittest discover -s apps/analyzer/tests -p 'test_*.py' -v`

**Step 3: Implement minimal passing logic using ffmpeg extraction + cross-correlation and deterministic segmentation/reframing heuristics**

**Step 4: Re-run full analyzer tests and verify pass**

### Task 4: Analyzer render implementation

**Files:**
- Modify: `apps/analyzer/app/main.py`
- Create: `apps/analyzer/app/render.py`
- Modify: `apps/analyzer/tests/test_api_integration.py`

**Step 1: Write failing integration assertions for `/render` response contract**

**Step 2: Run integration test and confirm failure**

**Step 3: Implement ffmpeg render pipeline (trim/crop/scale concat, master audio mapping, optional crowd blur overlays)**

**Step 4: Re-run integration tests and ensure pass**

### Task 5: Web data model for explainability

**Files:**
- Modify: `apps/web/src/types/timeline.ts`
- Modify: `apps/web/src/services/storage/types.ts`
- Modify: `apps/web/src/services/storage/service.ts`
- Create: `apps/web/src/types/auto-live-clip.ts`
- Create: `apps/web/src/lib/auto-live-clip/timeline-apply.ts`
- Create: `apps/web/src/lib/auto-live-clip/__tests__/timeline-apply.test.ts`

**Step 1: Write failing tests for timeline plan application validity and transform limits**

**Step 2: Run test and verify failure**

Run: `bun test apps/web/src/lib/auto-live-clip/__tests__/timeline-apply.test.ts`

**Step 3: Implement scene metadata + timeline apply helper**

**Step 4: Re-run test and verify pass**

### Task 6: Web analyzer client + store + actions

**Files:**
- Create: `apps/web/src/services/auto-live-clip/client.ts`
- Create: `apps/web/src/stores/auto-live-clip-store.ts`
- Modify: `apps/web/src/lib/actions/definitions.ts`
- Modify: `apps/web/src/lib/actions/types.ts`
- Modify: `apps/web/src/hooks/actions/use-editor-actions.ts`

**Step 1: Write failing tests for payload mapping/caching helpers**

**Step 2: Run tests and confirm failure**

**Step 3: Implement analyzer HTTP client, state machine, and action handlers**

**Step 4: Re-run tests and verify pass**

### Task 7: Auto Live Clip panel UI + timeline explainability interactions

**Files:**
- Modify: `apps/web/src/stores/assets-panel-store.tsx`
- Modify: `apps/web/src/components/editor/panels/assets/index.tsx`
- Create: `apps/web/src/components/editor/panels/assets/views/auto-live-clip.tsx`

**Step 1: Add UI tab + controls (master audio selection, clip length, toggles, analyze/build + export buttons)**

**Step 2: Render segment rationale list and click-to-highlight behavior**

**Step 3: Verify with lint/typecheck and manual smoke**

### Task 8: Export integration and docs

**Files:**
- Modify: `README.md`
- Create: `apps/analyzer/README.md`

**Step 1: Document analyzer run steps and UI flow usage, privacy note, metadata storage, and future multi-cam extension**

**Step 2: Run full verification**

Run:
- `bun test`
- `bun run lint:web`
- `bun run build:web`
- `python3 -m unittest discover -s apps/analyzer/tests -p 'test_*.py' -v`

**Step 3: Fix regressions and ensure clean success outputs**

