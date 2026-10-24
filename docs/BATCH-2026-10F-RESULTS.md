# Iteration cycle 2026-10F — Results (AAA loop, cycle 3)

Third cycle of the standing AAA loop. Cycle 2 (`docs/BATCH-2026-10E-RESULTS.md`) ended at
169 calls / 1.66 M triangles with characters, shadows and atmosphere in place. Cycle 3 attacked
QA's visual-audit gaps: regional identity, foliage/fire/corruption fidelity, time-to-HUD, and new
high-fidelity content from the sketchlab warehouse. Final bundle `index-j2KTUVMP.js` (840,799 B),
reproduced exactly by a fresh build.

## 1. Regional identity (QA's #1 gap) — implemented + measured

Each region now has its own atmosphere, grading and foliage, smooth-lerped across border bands
(z −245…−165, −485…−405) with no seams:

| Region | Fog | Density | Moon / hemi | Exposure | Saturation | Foliage |
| --- | --- | --- | --- | --- | --- | --- |
| Green March | `#1e4038` teal | 0.0122 | `#d2ecdf` 2.7 / 4.7 | 1.55 | 1.05 | pine/oak + maple, standing stones |
| Ashen Moor | `#342d42` grey-violet | 0.0208 | `#d9cde9` 2.1 | 1.37 | 0.82 | dead trees, ash haze, chapel ruin |
| Frozen Crown | `#6f93b0` cold blue | 0.0172 | `#cfe6ff` 2.55 | 1.62 | 1.12 | snow pines, snow patches, watchtower |

QA numeric distinctness: pairwise mean-RGB colour distance **9.36 / 31.5 / 32.2**, luminance
spread 15.1; `__ssRegionInfo()` (now QA-camera aware) reports each region's fog/tints/weights.
Supporting content: instanced ground decals (snow/ash/grass, feathered alpha, 72 m cull), region
grass/tuft tinting, pooled snow flakes.

## 2. New high-fidelity content (warehouse / Blender)

- **Card-tree foliage v2**: `pine_v2` (1,272 tris), `snow_pine` (1,286), `oak_v2` (514),
  `maple` (514) — alpha-MASK leaf cards, night palette, one asset band for all distances (no LOD
  seam). Root cause of the first attempt's "leafless" look was found twice over: most leaf pixels
  had alpha below the 0.42 MASK cutoff (re-baked to near-binary alpha, 34–46 % usable leaf area,
  pine palette +15 %) and the client name filter was dropping leaf prims (fixed to instantiate all
  prims; `__ssPerf().landscape.treeDebug` proves bark + leaves render).
- **Region props**: `dead_tree` (464 tris, bark-only), `standing_stone` (63), `ice_shard` (108).
- **Landmark structures** (new, from the warehouse): `chapel_ruin` 13,810 tris (collapsed gothic
  chapel), `watchtower_ruin` 9,817 (photoscan tower), `village_house_ruin` 2,475 (abandoned
  dwelling). 1 prim / 1 embedded night-toned 1024 texture each, ground-centred, gzip-9.
- **One landmark per region** placed by ruins-builder with validated clearances: Green March
  village house + ruined 8-stone circle at **(56, −6)** (65 m from spawn, 32 m off-road), Ashen
  chapel at **(−36, −228)**, Frozen watchtower at **(−34, −472)** on a rock outcrop (top 11.8 m).
  Region scatter: dead_tree ×12, ice_shard ×12, standing_stone ×13. Cost ≈34 k tris across the map,
  +7 instanced draws structurally (+2–3 rendered per regional view); only large landmarks cast.
- **Elite undead silhouettes** (procedural, no assets): tiered crowns/crests/shoulder spikes + eye
  glow, one rigid-skinned add-on per elite sharing the body skeleton (32/76/84 tris); eyeballs now
  render for shrouded undead. QA elite-vs-normal close-up diff 31.1 mean luminance / 88.9 % pixels.
- **Fire/smoke**: flat emissive cones replaced by billboarded additive sprite flames (soft tongue +
  hot core) + pale additive smoke plume + embers; corrupt decals are feather-masked, nest-only.
- **Audio**: region-specific ambience layers (Frozen wind/ice creaks, Ashen ash wind/embers/bells,
  Green rustle/insects/birds) with ±14 m border hysteresis, ~3.2 s crossfades and per-region music
  tint, lazy build/teardown, Sound/pause gated.

## 3. Time-to-HUD work (partially successful)

Join-critical loading reduced to hero/ally/survivor + starter weapon/shield; terrain textures,
props and equipment now start only after core ready, in one ordered queue with yields; world
extras stream after playable. Landing improved 3.56 → **3.28 s**, and the owner probe measured
first-state 12.58 s (−3.72 s). Under the QA harness on the final build, HUD still measured
**18.54 / 17.14 s** (high variance on SwiftShader) vs the 15.0 s target — **carried as cycle-3
debt** for real-GPU profiling (shader compile/warmup, code splitting, deferred UI work).

## 4. Verification (final build `index-j2KTUVMP.js`, hash reproduced)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green; fresh build reproduced the exact hash |
| `validate-assets` | **74/74** |
| Visual re-verification | foliage canopies, soft moon, additive smoke, relocated landmark, decals and region identity **all confirmed fixed** |
| Perf | **195 calls / 1,666,828 tris** (gates <230 / <1.9 M); FP 153 / 1.55 M; low tier 153 / 1.36 M |
| Characters + elite | 24/25 (elite PASS; close-ups 545 colours/0 % clip; torso p50 102.4 vs 100 marginal — debt) |
| Regression | fresh-build smoke **16/16** + hash proof, co-op **18/18** |
| Payload | 15.06 MB (+1.70 MB vs cycle 2: foliage v2, landmarks, decals, sprites, audio code) |

## 5. Carried into cycle 4 (QA + Lead agreed)

1. **Time-to-HUD under SwiftShader** (18.5/17.1 s vs 15 s gate; variance ~1.4 s) — real-GPU
   profile, shader warmup/compile cost, code splitting, defer HUD-only work; treat harness timings
   with variance band.
2. **Character torso p50 102.4** vs 100 (mean 91.5, close-ups unchanged) — likely brighter foliage
   background lifting the crop metric; re-baseline or mild tone tweak.
3. **Regional tone refinement**: green pines/maple read bright/saturated at night (autumnal maple is
   intentional variety but may need desaturation); crown QA camera has a snow-pine canopy over ~40 %
   of frame (framing nit).
4. `__ssRegionInfo`/QA-view framing polish; smoke/flame sprite closer inspection at 1–2 m.
5. Carried from earlier: real-GPU/perceptual playtest, GLB prop clone draws, campaign/controller/
   mobile, more character model variety (new armour models from the warehouse), weather systems.
