# Swords & Shrouds — Batch 2026-10C (performance & smoothness)

Third autonomous batch. The user explicitly asked for the game to **run smoother**. Everything in
this batch is judged by before/after measurements, not vibes. Read
[`docs/BATCH-2026-10B-SPEC.md`](./BATCH-2026-10B-SPEC.md) for standing conventions.

## Baseline (measured 2026-10-24, before this batch)

- Custom asset payload: **58 GLBs = 43.51 MB gzip**; the client preloads ~17 assets (10 weapons +
  9 characters + shield ≈ 13–14 MB) before the "Begin a campaign" button is usable, then streams
  ~30 MB more of trees/props/ruins after joining.
  Worst files: oak 8.26 MB, gatehouse 3.44 MB, fortress_keep 1.57 MB, camp_tent 1.40 MB,
  rapier 1.36 MB, pine 1.35 MB, plague/supplies/chest/templar/flamberge/ruins ~1.1–1.4 MB each.
- Scanned textures: ~6.5 MB (road normal 1.72 MB, ground PNGs 1.72/1.35 MB).
- Scene construction creates thousands of individual meshes: every castle is ~120 separate
  `box()` meshes (walls ×5, ~47 individual battlements, 4 towers ×5 parts, 2 upgrade stages,
  keeps, gate, barrier, 2 fires ×3 cones…), and `customEnvironment()` additionally clones
  ~92 individual tree meshes that `landscape.ts` already instances, plus 54 `rocks-large` clones,
  18 mountains, camp furniture, and 9 castles × 12 weapon-rack meshes. Repeated identical
  `BoxGeometry`/`ConeGeometry`/`CircleGeometry` objects are created per call.
- Ad-hoc per-hit `label()` canvases/textures are created and disposed for every damage number.
- Software-rendering headless fps: 0.6–0.8 (SwiftShader — only useful as a relative proxy).
  Real-GPU performance has never been measured; structured draw-call/triangle reductions are the
  reliable target we can verify headlessly.

## Goals + acceptance targets

1. **Asset payload**: total `public/assets/custom` ≤ **22 MB** (from 43.5 MB); initial preload set
   ≤ **6 MB** (from ~13.5 MB); every character/weapon asset ≤ 450 KB; `oak` ≤ 800 KB;
   `gatehouse` ≤ 800 KB. Visual quality preserved at night distance (verify Cycles/screenshot
   previews of at least the hero, oak tree, oak/pine, one ruin, one castle module).
2. **Watchable geometry**: add a `window.__ssPerf()` hook returning `renderer.info` (calls,
   triangles, points, geometries, textures, programs), counts (scene objects, materials, lights,
   skinned meshes), current quality tier, and rolling fps/frame-ms. Target after optimization:
   **draw calls ≤ 35 % of baseline** and **triangles rendered ≤ 60 % of baseline** in the spawn
   third-person view, with zero visual regressions in the QA screenshots.
3. **Quality tiers + smoothness controls**: `low | medium | high` graphics tier selectable in the
   Guide settings (persisted), applied at runtime via `window.__ssQuality`:
   low = DPR 1.0, no bloom, shadow map 1024 (or shadows off), 6 pooled torch lights, reduced
   particle caps; medium = DPR 1.25, bloom on, 1024 shadows, 9 lights; high = current look
   (DPR 1.75, bloom, 2048 shadows, 13 lights). Plus the existing adaptive pixel-ratio stepping.
   A tiny F3 toggle overlay shows fps / draw calls / triangles / quality.
4. **Smoother loading**: a loading progress indicator (assets loaded/total) replacing the static
   "Loading your generated characters…" text; no long main-thread stalls while the world builds;
   trees/props/ruins keep streaming in the background after joining.
5. **Co-op smoothness**: keep the 10 Hz authoritative broadcast but make remote actors visually
   smooth (world-scene: add short snapshot interpolation/buffering for non-local actors only; local
   player keeps its current feel). Also keep the batch-2 two-missed-pong server tolerance.

## File ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom/*.glb.gz` (all 58 may be re-optimised), `public/assets/textures/*`, `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **world-scene** | `src/client/scene.ts`, `src/client/landscape.ts`, `src/client/effects.ts`, `src/client/postfx.ts`, `src/client/assets.ts` (loading/progress + lazy preload), `src/client/terrain-surfaces.ts` only if a measured ground win |
| **ruins-builder** | `src/client/ruins.ts`, `src/client/terrain-surfaces.ts` |
| **audio-polish** | `src/client/main.ts`, `src/client/combat-feedback.ts`, `src/client/ambience.ts`, `src/client/style.css`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | `docs/**` (except ASSET-PIPELINE.md), `PROJECT_STATUS.md`, `index.html`, git, deployment |

## Non-negotiable gates

- `npm test`: **exactly 58 tests, all passing** (extend assertions in place only).
- `npx tsc --noEmit` 0 errors; production `vite build` success with bundled Node 24.
- `scripts/validate-assets.mjs` still passes for every shipped GLB (contract unchanged; budgets
  may only get smaller).
- Browser smoke: 0 page/console errors, 0 asset 404s, 10 weapon cards, both cameras, co-op still
  passes, live-URL mode still passes.
- No gameplay/balance behaviour changes. No new npm dependencies.

## Workstream detail

### asset-forge — asset payload slimming

- Re-encode every embedded texture: base colour ≤512 (hero/hero-adjacent may stay 1024 if under
  budget), normal ≤512 (or drop where visually negligible: foliage, distant props, small weapons),
  metallicRoughness ≤256. Prefer dropping a map and using material factors where the visual cost is
  nil at night.
- Trees: `oak`/`pine` base colour 512, drop normal/roughness if they dominate; target oak ≤800 KB,
  pine ≤400 KB. Props/ruins/keep/weapon/character targets in Goals above.
- Keep every rule: glTF 2.0, gzip-9, embedded images with bufferView, indexed prims + TEXCOORD_0,
  no Draco/KTX2/meshopt, tri budgets unchanged or lower, canonical weapon orientation unchanged
  (geometry untouched — only textures/material factors), character skins/clips unchanged.
- Also slim `public/assets/textures`: road/cobblestone normal maps to 512 (still seamless), ground
  detail to 512 JPEG or PNG; keep `terrain-surfaces.ts` filenames/API unchanged.
- Report a before/after table (bytes per file + totals), confirm all validators pass, and run
  `tests/assets.test.ts` + `tests/equipment.test.ts` (assets unchanged structurally, so both must
  stay green). Update `docs/ASSET-PIPELINE.md` with the optimisation notes.

### world-scene — instrumentation first, then batching

1. Add `window.__ssPerf()` + `window.__ssQuality` (get/set) hooks and record baseline
   calls/triangles/geometries/textures/programs/lights/objects in the spawn third-person view and
   in first-person; report the baseline before changing rendering.
2. Optimise static geometry:
   - Delete the duplicate per-instance tree clones in `customEnvironment()` (landscape already
     instances 540 trees) and instance/merge the `rocks-large` scatter.
   - Batch castle static geometry per castle + material with `BufferGeometryUtils.mergeGeometries`
     (walls, battlements, tower shells/caps, stage detail, keep fallback); keep per-castle groups so
     frustum culling and modern-keep visibility still work. Instance the crenellations across all
     castles as one InstancedMesh if cleaner.
   - Merge the road network into one mesh per material and the nine courtyards into one mesh.
   - Cache shared `BoxGeometry`/`ConeGeometry`/`CircleGeometry` instances for anything not merged.
   - Instance flame cones (3 InstancedMeshes for ~40 fires) and camp furniture where possible.
   - Shadow caster trimming: only large/architectural meshes cast shadows; tiny crenellations,
     flames, ground/flags/props do not. Keep the 2048 map at high tier.
   - Pool damage-number labels (reuse canvases/textures) and distance-cull static labels.
   - Drop pooled torch point lights 13 → 10 (high) and make the count tier-dependent.
3. Quality tiers in `scene.ts` + `postfx.ts`: implement `low|medium|high` per Goals; apply on start
   from localStorage (`ss-quality`) and via `window.__ssQuality` at runtime (shadows can be
   toggled/map resized by recreating the renderer target or simply setting `shadowMap.enabled` and
   light shadow map size). Keep the adaptive pixel-ratio stepper, and let it also step tier down
   (high→medium→low) on sustained low fps.
4. `assets.ts`: expose preload progress (`{loaded,total}` updated per asset) and split preload into
   `coreReady` (characters/weapons needed to join, after slimming ≈6 MB) vs background extras;
   keep `customReady` semantics for existing callers (scene waits for it before custom world props
   but must not block joining). Report the new time-to-join measure.
5. Co-op smoothing: for non-local actors, buffer the last two authoritative snapshots and
   interpolate positions at ~10 Hz toward the newest with a ~120 ms delay (local player unchanged);
   verify no visual snapping in co-op and keep the existing fallback lerp when a snapshot is missed.
6. Re-measure after: report before/after draw calls, triangles, geometries, textures, programs,
   fps, and screenshots. Target: calls ≤35 % baseline, triangles ≤60 %.

### ruins-builder — instance the ruin layer

- Convert the 12 ruin set pieces, 27 camp tents, 10 stone walls and 54 courtyard/camp props
  (wells/chests/benches) to InstancedMeshes (one per asset per visibility class, or one per asset
  with per-instance matrices): target ~8–12 draws for the whole layer instead of ~100.
  Keep ground-centre placement, per-instance yaw/scale, shadows, rescue/far culling for camp props
  (set instance matrices to zero-scale or use a per-instance visible flag update once per frame).
- Weapon racks: only build the per-castle rack contents (plinth + 10 weapon meshes) when the castle
  is friendly **and** the player is within ~45 m; dispose/free far racks (keep the plinth as a single
  instanced mesh so an empty rack still reads as a display). Target ≤2–3 draws for all visible racks
  vs 108.
- Use `window.__ssPerf()` (world-scene hook) to measure the ruins-layer contribution before/after
  if available; otherwise report mesh/instance counts structurally.
- tsc clean; keep defensive missing-asset behaviour and allocation-free update().

### audio-polish — loading progress, perf overlay, quality selector

- `main.ts`: show real loading progress from the new `assets.ts` progress hook in `#connection`
  ("Loading world… 6/17") while preloading, then enable join when `coreReady` resolves; keep
  `customReady` world streaming in the background.
- Add an F3 toggle perf overlay (fixed, small, pointer-events:none) reading `window.__ssPerf()` every
  ~250 ms: fps, draw calls, triangles, quality tier. Hidden by default; persisted preference.
- Add a "Graphics quality" select (low/medium/high, persisted as `ss-quality`) into the Guide
  settings via DOM creation (no index.html edit needed); call `window.__ssQuality(tier)`.
- Suspend/resume the AudioContext and ambience/combat audio when the tab is hidden or the game is
  paused in a dialog; cap voices further if cheap. Keep the feedback tests/semantics intact.
- Keep networking/gameplay untouched.

### qa-verifier — performance evidence

- Add `--perf` capture to the harness: after joining and settling, read `window.__ssPerf()` plus
  `performance` load timings, request bytes/counts, and 3–5 s of frame-time percentiles; repeat for
  quality low/medium/high via `window.__ssQuality` and for first-person. Record into the report JSON.
- Capture before/after numbers: run the perf capture against the current deployed batch-2 site for
  reference fps only (no hook), and against the final local build for calls/tris/geoms/textures/
  programs/fps + load timings; also re-run local smoke, co-op, and live-URL modes and confirm no
  visual regression in screenshots.
- Validate the loading-progress UX (progress text changes, join enabled, no long blank frame) and
  the quality selector (tier persists, draw calls visibly drop at low).
- Update `docs/QA-REPORT.md` with a performance section and final pass/fail + visual notes.

### Lead — integration, deployment, docs

Review diffs, run the full gate (58/58 tests, tsc, build), run QA local + perf + co-op + live,
compare before/after metrics, update `docs/BATCH-2026-10C-RESULTS.md` / `PROJECT_STATUS.md`, commit
and push the game repo, update the hosting pin, build with bundled Node, push, verify the live
bundle/assets, then have QA run the final live mode.
