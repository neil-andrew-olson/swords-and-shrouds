# Batch 2026-10C — Results (performance & smoothness)

Third autonomous batch; the user asked for the game to run noticeably smoother. Contract:
[`docs/BATCH-2026-10C-SPEC.md`](./BATCH-2026-10C-SPEC.md). Raw evidence: `docs/QA-REPORT.md`,
`docs/ASSET-PIPELINE.md`, and the gitignored `qa/` capture folders.

## The measured result

The baseline was extracted from a pre-optimisation build with instrumentation hooks: the scene
constructed **96,671 meshes / 175,324 objects**, producing **88,544 draw calls and 4.04 M triangles**
per frame (main + shadow passes), and the client transferred **43.19 MB** before the world was usable.

| Metric (spawn third-person, high tier) | Before | After | Delta |
| --- | --- | --- | --- |
| Draw calls | 88,544 | **301** | **−99.7 %** (target ≤35 %) |
| Triangles rendered | 4,041,177 | **1,760,609** | **−56.4 %** (target ≤60 %) |
| Meshes | 96,671 | **852** | −99.1 % |
| Scene objects | 175,324 | **4,728** | −97.3 % |
| Geometries | 2,605 | **148** | −94.3 % |
| Mesh primitives across all shipped GLBs | 2,402 | **78** | −96.8 % |
| First-person calls / triangles | 87,317 / 4,070,005 | **259 / 1,584,748** | −99.7 % / −61.1 % |
| Network transfer | 43.19 MB | **12.20 MB** | **−71.8 %** |
| Navigation → landing | 5.17 s | **3.73 s** | −28 % |
| Custom asset payload | 43.51 MB | **9.47 MB** | −78.2 % |
| Initial preload (join-gating set) | 12.20 MB | **4.71 MB** | −61.4 % |
| Scanned textures | 6.36 MB | **1.49 MB** | −76.6 % |
| Low-tier vs high-tier draw calls | — | 238 vs 301 | −20.7 % at low |

Software-renderer rAF fps (SwiftShader, only a relative proxy) improved **0.58 → 1.35** with the same
headless harness, i.e. ~2.3× fewer CPU/GPU cycles per frame; the structural wins above are the
reliable evidence since no hardware GPU is available in this environment.

## What changed

**Assets (asset-forge):**
- Every embedded texture re-encoded/slimmed (base colour 512, normals 512 or dropped where invisible
  at night, MR 256), scanned texture maps down to 512; character/weapon assets now ≤419 KB each,
  `oak` 8.26 MB → 184 KB, `gatehouse` 3.44 MB → 47 KB, `pine` 1.35 MB → 317 KB.
- All 58 GLBs flattened/joined/quantised: primitives 2,402 → 78 (pine 2,070 → 4 with all 12,533
  triangles preserved; gate 45 → 1; castle modules 68/35/17 → 4/2/3). Only extension added is
  `KHR_mesh_quantization`, natively handled by `GLTFLoader`; geometry, skins, animations and
  canonical weapon grips verified unchanged.
- Assets staged and installed atomically so builds never saw a half-updated set.

**Rendering/scene (world-scene):**
- Removed the duplicate per-instance tree clones that were ~95 k meshes (the dominant draw-call
  source); the 540 landscape trees now instance **all** pine (4) / oak (2) primitives with shared
  matrices, dark night-palette foliage, alpha-mask kept, 64 m tree / 80 m rock distance culling.
- Castle static geometry merged per material (walls, crenellations, tower shells/caps, banner poles)
  with per-castle groups for keeps/stages/barriers preserved; the nine courtyards merged into one
  cobble mesh; mountains and ~45 fires instanced (3 cone batches); shadow-caster trimming; pooled
  damage-number labels; torch point lights 13 → 10 at high tier; adaptive pixel-ratio retained.
- Quality tiers `low | medium | high` (DPR 1.0/1.25/1.75, bloom off/on/on, shadows
  off/1024/2048, lights 6/9/10, particle scale 0.5/0.75/1) selectable in the Guide settings,
  persisted, with adaptive tier-down on sustained low fps.
- `window.__ssPerf()` / `window.__ssQuality()` instrumentation hooks (renderer info, scene counts,
  rolling frame pacing, tier), used by QA for before/after evidence.
- Progressive loading: preload split into `coreReady` (join no longer waits for the full custom set)
  with live `progress {loaded,total}`; the rest streams after joining. Co-op smoothing: non-local
  actors interpolate across the last two authoritative snapshots at ~120 ms delay (local actor
  unchanged) with a stale-snapshot fallback.
- Landing-page streaming fix: fallback (blue-cone) tower art is hidden from frame 0 and only
  revealed if the modern castle_tower/fortress_keep assets genuinely fail, so the first impression
  shows the stone fortifications and modern keeps.

**Ruins layer (ruins-builder):** 211 cloned meshes → **29 InstancedMeshes** (~9 static draws in the
spawn view) with ground-centre placements, shadows and rescue/distance compaction preserved; weapon
racks are lazy (instanced shells always, ≤10 instanced weapon draws only within 45 m of a friendly
castle) instead of 108 meshes.

**UX (audio-polish):** real loading progress text (`Loading world… N/M`), F3 perf overlay
(fps / draw calls / triangles / quality), Graphics-quality selector persisted in settings, and
audio-context suspend while hidden or in dialogs (with Sound checkbox still authoritative).

## Verification

| Gate | Result |
| --- | --- |
| `npm test` | **58/58 passing** (exactly 58 test blocks) |
| `npx tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | success; final bundle `index-BeMuJwuM.js` (793,960 B) |
| `scripts/validate-assets.mjs` | **62/62 checks** |
| Local smoke (fresh build) | **16/16** gates, 0 page/console/log errors, 0 asset 404s, 10 cards |
| Perf after-capture (`--perf`) | **23/23** gates; deltas in the table above; quality tiers + loading UX validated |
| 2-player co-op | **18/18** — same room, both snapshots list both players, movement propagates, shared weapon unlock syncs |
| Live baseline (deployed batch-2) | **17/17**, 10 cards, 0 page errors/404s |
| Landing-style regression | early/mid/late landing captures show no legacy blue-cone towers |

## Known risks / remaining work

1. No hardware-GPU measurement exists in this environment (SwiftShader only). The structural numbers
   (draw calls/triangles/meshes/bytes) are the reliable evidence; a real-GPU fps/thermal pass is
   still the top verification item.
2. Triangles are still ~1.76 M at high tier; further reduction would need LODs for the instanced
   trees/ruins and merged castle batches losing per-castle frustum culling (accepted trade for the
   draw-call collapse).
3. Trees use a hard 64 m cull radius (pop-in possible while sprinting; fog masks most of it).
4. GLB props remain individual clones (~30–40 legacy draws) because merging quantised primitives
   produced console errors; within target, but a future pass could merge them safely.
5. Co-op interpolation is implemented and the co-op suite passes; its perceptual smoothness under
   real latency still needs a live two-player playtest.
6. Quality tiers were validated structurally (draw calls drop at low, selector persists); real-GPU
   visual comparison of low/medium/high remains.
