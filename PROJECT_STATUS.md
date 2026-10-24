# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Latest completed batch — 2026-10C: performance & smoothness

Implementation on branch `main` (exact SHA in the commit log; hosting pin updated to it).
Contract: `docs/BATCH-2026-10C-SPEC.md`; results: `docs/BATCH-2026-10C-RESULTS.md`.

The user asked for the game to run smoother. The batch was measured before/after with new
instrumentation (`window.__ssPerf()`), not vibes:

| Metric (spawn third-person, high tier) | Before | After |
| --- | --- | --- |
| Draw calls | 88,544 | **301 (−99.7 %)** |
| Triangles | 4,041,177 | **1,760,609 (−56.4 %)** |
| Meshes / scene objects | 96,671 / 175,324 | **852 / 4,728** |
| Geometries | 2,605 | **148** |
| Network transfer to playable | 43.19 MB | **12.20 MB (−71.8 %)** |
| Custom asset payload | 43.51 MB | **9.47 MB (−78.2 %)** |
| Initial preload set | 12.20 MB | **4.71 MB (−61.4 %)** |
| Nav → landing (local) | 5.17 s | **3.73 s** |
| Low vs high tier draw calls | — | 238 vs 301 (−20.7 %) |

SwiftShader rAF fps (relative proxy only) improved 0.58 → 1.35.

### Behaviour changed

- **Assets**: every embedded texture slimmed (512/256 maps; oak 8.26 MB→184 KB, gatehouse
  3.44 MB→47 KB, pine 1.35 MB→317 KB, characters/weapons ≤419 KB); all 58 GLBs flattened/joined/
  quantised — primitives 2,402→78 (pine 2,070→4 with all 12,533 tris kept), skins/animations/
  canonical grips verified unchanged. Only added extension is `KHR_mesh_quantization` (native
  GLTFLoader support). Installed atomically.
- **Rendering**: removed ~95 k duplicate tree-clone meshes; 540 instanced trees now render all
  primitives; castle static geometry merged per material; courtyards/roads merged; mountains and
  fires instanced; shadow casters trimmed; damage labels pooled; torch lights 13→10 at high tier;
  adaptive pixel ratio kept. Quality tiers low/medium/high (DPR, bloom, shadows, lights, particles)
  selectable in the Guide settings, persisted, with adaptive tier-down.
- **Loading/UX**: live `Loading world… N/M` progress; join waits only on the new `coreReady` core
  set and the rest streams in; F3 perf overlay (fps / calls / triangles / quality); audio contexts
  suspend while hidden or in dialogs.
- **Co-op smoothing**: non-local actors render interpolated across the last two authoritative
  snapshots at ~120 ms delay (local actor unchanged, stale fallback).
- **Landing fix**: legacy blue-cone fallback tower art is hidden from frame 0 and only revealed if
  modern `castle_tower`/`fortress_keep` genuinely fail, so the first impression shows stone keeps.

### Checks actually run (final state)

- `npm test` — **58/58 passing**, exactly 58 `test(...)` blocks (tests extended in place only).
- `npx tsc --noEmit` — 0 errors. `vite build` with bundled Node 24 — success; final bundle
  `index-BeMuJwuM.js` (793,960 B). **System Node 22.11 is below Vite 7's floor — always build with
  the bundled Node v24.21.0** (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`,
  prepend its dir to PATH for hosting builds).
- `scripts/validate-assets.mjs` — 62/62.
- Headless Chrome production suite — fresh-build smoke 16/16, perf capture 23/23, co-op 18/18,
  live-baseline 17/17; 0 page/console/log errors, 0 asset 404s, 10 weapon cards.
- Not verified: hardware-GPU frame rate/thermals (SwiftShader only), perceptual smoothness of
  co-op interpolation under real latency, low/medium/high visual comparison on a real GPU.

### Remaining defects / next concrete tasks

1. **Hardware-GPU verification** is the top item: real fps, frame pacing, thermals, and the
   low/medium/high tier comparison on actual graphics hardware.
2. Triangle count at high tier is ~1.76 M; LODs for instanced trees/ruins would reduce further.
   Trees cull at 64 m (possible pop-in while sprinting); merged castle batches sacrifice per-castle
   frustum culling (accepted trade).
3. GLB props still clone individually (~30–40 legacy draws) — a safe merge pass is possible later.
4. Co-op interpolation needs a live two-player playtest for feel; the state-sync suite is green.
5. Full campaign balance/controller/mobile-HUD/perceptual-audio playtesting still outstanding from
   earlier batches; pre-existing `KHR_materials_pbrSpecularGlossiness` loader warning remains on
   `gatehouse.glb.gz`.

## Previous completed batches

- **2026-10B** readability/combat-feel/arsenal/co-op QA: commit `657cdde` (plus docs); live
  deployment verified. Results `docs/BATCH-2026-10B-RESULTS.md`.
- **2026-10** objectives 1–5 battlefield overhaul: commits `c5d3d99`, `6576c37`; results
  `docs/BATCH-2026-10-RESULTS.md`; asset pipeline `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; build via `scripts/build-game.mjs` (fetches the pinned commit, `npm ci`,
  builds the client under `/games/swords-and-shrouds/`). Cloudflare Workers Builds deploys on push;
  `worker.js` imports the pinned `.game-build` simulation source, so the pin controls both client
  and authoritative gameplay.
- Build locally with the bundled Node (see above), then run
  `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build` in the hosting repo.
- Batch 2026-10C deployment: game commit + hosting pin recorded in the commits; live verification
  after push should confirm `/games/swords-and-shrouds/health`, the new JS bundle hash
  (`index-BeMuJwuM.js` expected), the slimmed assets (~12.2 MB total transfer) and that
  `/assets/custom/rapier.glb.gz` etc. are substantially smaller than before.

## Continuity procedure

After each completed batch, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Inspect current commits and complete the next unfinished task. Update the checkpoint."
