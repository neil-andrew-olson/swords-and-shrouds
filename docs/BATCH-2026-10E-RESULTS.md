# Iteration cycle 2026-10E — Results (AAA loop, cycle 2)

Second cycle of the standing AAA loop. User priorities carried forward: finish the character
fidelity work, keep the browser smooth, expand believable world content, keep deploying verified.
Contract: [`docs/BATCH-2026-10E-SPEC.md`](./BATCH-2026-10E-SPEC.md).

## 1. Characters — material depth, tone and distinct silhouettes

- **Material v2:** all 7 player/companion bodies re-baked with a night tone (albedo ×0.84 of cycle 1,
  adaptive runtime target 84 sRGB), richer procedural detail (plate seams/rivets, chainmail
  micro-relief, cloth weave, leather grain, heraldic bands, wear) and **new embedded maps**:
  512² normal + 512² packed ORM (AO/roughness/metalness), base colour 512. Geometry/skins/clips
  hash-identical. Files 591–621 KB each, initial preload ≈6.0 MB (≤6.5 target).
- **Distinct silhouettes:** each body got one extra rigid-skinned primitive in the same single
  skin — steel pauldrons (hero/templar/ally/berserker), hood + shoulder cape (ranger/survivor),
  helmet crest fins + corrupted horns (fallen). +204–424 tris each (8,653–8,873 total), same 12
  clips/single skin/hand sockets.
- **Runtime response:** metalness ≤0.35, roughness ≥0.65, envMapIntensity ≥2 (scene sets 2.2),
  adaptive albedo tint toward 84 sRGB, cool-dusk Fresnel rim at 0.28 weight, dormant non-destructive
  UV-black fallback. A transient `sampled` scope bug was caught by world-scene and fixed before the
  final build.
- **Measured in-game (QA):** torso mean **89.31** (gate 65–95), p50 **95.98** (60–100), black
  **14.75 %** (<25 %), clipping **0 %**, close-ups show surface detail (up to 505 unique colours;
  min 407 — cycle-3 polish target), all 5 appearances + skeleton/zombie readable.

## 2. Critical visual bug fixed — quantised ruin/camp geometry

Cycle-1's asset re-bake quantised ruin/tent/wall/prop assets (`KHR_mesh_quantization`, Int16
normalised positions + node dequant scale). `ruins.ts` was baking those integer attributes through
`geometry.applyMatrix4(mesh.matrixWorld)`, normalising/wrapping them — so the 12 ruin set pieces,
27 tents, 10 stone walls and well/chest/bench props rendered as ~2 m corrupted blobs in the deployed
cycle-1 build. Instancing now never touches attributes: each GLTF mesh becomes an `InstancedMesh`
with `placement × normalise × mesh.matrixWorld` folded into the instance matrix. Verified against
the shipped GLBs (chapel 8.50 m, bridge 5.00 m, stone wall 5.60 m long, tent 2.21 m, well 1.60 m —
all ground-centred); QA's before/after screenshots confirm the blobs are gone.

## 3. World realism & atmosphere

- **Near/far tree band:** full-res pine/oak 0–22 m, LODs 22–54 m, matrices reassigned only when the
  camera moves >2 m; `__ssPerf().landscape` proves both bands populate (e.g. treeline 6 full + 11
  LOD pines, 4 full + 14 LOD oaks).
- **Cast shadows restored** for tents and ruined stone walls (casters: architecture, keeps,
  gatehouses, towers, actors, ruins/tents/walls; dressing/racks receive-only).
- **Atmosphere particles:** pooled torch smoke wisps, drifting ash, moon-dust motes (zero per-frame
  allocations, reduced/off at low tier).
- **Environment composition (existing assets only, +7 draws):** brazier pairs + emissive flames at
  all 9 castle gates (no new dynamic lights), friendly-only courtyard banner posts, roadside stake
  lines on the Castle 1→2 road, camp barrel/cart clusters, Fallen Keep grave field.
- **Keeps:** `fortress_keep` merged from 5 prims / 5 trimsheets → **1 prim / 1 material** via a baked
  2048² atlas → **45 → 9 draw calls** across the nine keeps, tris/bbox unchanged.
- **QA camera hook:** `__ssQAView(name)` for treeline/fire/camp/courtyard/region-* plus
  `__ssQAPose`; landscape culling follows the QA camera. Treeline pose fixed to a verified grove
  (9 full-res + 12 LOD trees in frame).

## 4. Audio

Quiet adaptive WebAudio music bed: detuned D-minor string pads + drone, filter breathing/shimmer,
tension pair near the plague nest, siege swell, 24 s capture relief, combat sidechain ducking
(impact/hurt full, swing/block 55 %), fire crackle + ember rumble, rate-limited distant undead
moans. Lazy-built/auto-torn-down when inaudible; Sound checkbox and pause gating authoritative.

## 5. Verification (all green on `index-BfnriryF.js`)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58 passing** (exactly 58 test blocks) |
| `npx tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | success; bundle `index-BfnriryF.js` 815,540 B; fresh-build reproduced the exact hash |
| `scripts/validate-assets.mjs` | **65/65** |
| Character audit | **24/24** — tone 89.3/96.0, black 14.75 %, clip 0 %, detail visible |
| Perf capture | **26/26** — **169 calls**, **1,658,880 tris** (gates <210 / <1.85 M), tiers intact, 7 QA views |
| Fresh-build smoke | **16/16**, 0 page/console/log errors/warnings, 0 404s, 10 cards, server-stayed-up gate |
| 2-player co-op | **18/18** |
| Live baseline (deployed cycle-1) | **17/17** |
| Payload / load | 13.69 MB, nav→landing 3.56 s, loading 0/20→13/20, join 3.70 s |

## 6. AAA gaps handed to cycle 3 (from QA's visual audit)

1. Regional identity is weak — the three regions look near-identical; need biome dressing,
   colour grading/fog variation and distinct landmarks.
2. Tree foliage reads as pale shard clumps; LOD band is visible — improve foliage cards/blending.
3. Magenta corruption patches look like flat unblended decals on roads/courtyards.
4. Flat emissive cone flames and sparse smoke — upgrade flame sprites/embers.
5. Add-on armour silhouettes barely differentiate characters at 10 m; close-up colour variety is
   near the gate (min 407 vs 500 target).
6. Long SwiftShader time-to-HUD (16.3 s) — main-thread/shader cost; worth profiling real GPU too.
7. Hard-edged moon halo, bright flat tents, no wind animation.

Plus carried debt: no hardware-GPU measurement, GLB props at ~30 draws, tents/walls casting now
restored but tight triangle budget, and campaign/controller/mobile/perceptual-audio playtests.
