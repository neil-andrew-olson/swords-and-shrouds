# Iteration cycle 2026-10D — Results (AAA loop, cycle 1)

First cycle of the standing AAA iteration loop (see `PROJECT_STATUS.md` for the goal). User-reported
blockers resolved: **characters no longer render blacked out**, the doc links were a GUI
workspace-path issue, and performance improved again while restoring the shadow pass. Contract:
[`docs/BATCH-2026-10D-SPEC.md`](./BATCH-2026-10D-SPEC.md).

## 1. Blacked-out characters — root cause and real fix

The player/companion bodies (`hero`, `templar`, `ally`, `berserker`, `ranger`, `survivor`, `fallen`)
had **unusable UV0 layouts**: 93 % of triangles had zero UV area (37 charts squeezed into 7.9 % of
the atlas), so every body sampled the black gutters between charts. The atlas images themselves were
fine (mean luminance 37–102); UV-sampled mean was only **5.1–8.5 / 255**. Normals, skinning and
winding were verified healthy (unit normals, 98.8–98.9 % winding agreement, no NaN, weights sum to
1); the correctly-mapped `zombie`/`skeleton-soldier` always rendered bright. This predates the
payload-slimming work.

Fix, in two independent layers:
- **Asset re-bake (asset-forge, Blender 5.2 + Cycles):** rebuilt UV0 with Smart UV Project
  (1,216 charts, 58 % coverage, 0 % degenerate), baked per-character procedural "dressed armour"
  materials (metal torso/helmet, cloth, leather, accent trim, wear noise) to 1024² EMIT atlases,
  then grafted the new UV chart + texture back onto the *original* skinned primitive in Node
  (vertices split only where UVs differ; POSITION/JOINTS copied verbatim; NORMAL/UV/WEIGHTS
  compact-packed; rig triangles/skins/all animation samplers hash-verified unchanged). Palettes:
  hero bright silver, templar silver+gold+white surcoat, ally blue steel, berserker crimson/iron,
  ranger forest green, survivor weathered tan, fallen corrupted violet. UV-sampled luminance
  before → after: hero 6.5→136, templar 6.3→172, ally 5.4→93, survivor 5.2→105, ranger 8.5→63,
  berserker 6.1→44, fallen 5.1→40. Files 407–459 KB, all within the 450 KB budget (fallen 459 KB).
- **Runtime safety net (weapons-armory, `custom-character.ts`):** PBR clamps (metalness ≤0.35,
  roughness ≥0.5, envMapIntensity ≥2), a cached non-destructive fallback for any future
  UV-black-map case (dormant with the new atlases), and a cheap scene-independent Fresnel rim so
  silhouettes read at night. Zero per-frame cost; nine-body grounding/equipment tests stay green.

Measured in-game (QA `--characters`, task-specific crops): normal third-person torso mean
**54.9 → 102.84**, p50 **28.5 → 114.26**, black pixels **44.5 % → 15.42 %**; five-appearance
close-up avg mean **44.46**, p90 **108.57**, black **15.22 %**; unique colours in the player region
226 → 463. Player, companions and undead all read with armour/cloth/limb detail.

Remaining cosmetic debt for cycle 2: the baked atlases read **over-bright/flat white** at night
(little AO/material depth) — dial back tone and add normal/roughness/AO detail or replace with
higher-fidelity models.

## 2. Performance + visual restore (world-scene)

| Metric (spawn third-person, high tier) | Pre-cycle | This cycle |
| --- | --- | --- |
| Draw calls | 301 | **173** (0.195 % of the original 88,544) |
| Triangles | 1,760,609 | **1,500,333** (37.1 % of the original 4,041,177) |
| Geometries / meshes / objects | 148 / 852 / 4,728 | **138 / 606 / 3,325** |
| First-person | 259 calls / 1.58 M tris | **140 / 1.38 M** |
| Low vs high tier calls | 238 vs 301 | **128 vs 172 (−25.6 %)** |
| Payload transfer to playable | 12.20 MB | **12.43 MB** (+0.23 MB character atlases) |
| Nav → landing | 3.73 s | **4.62 s** (measurement variance; payload essentially flat) |

- Static props instanced per asset (trebuchet ×9, gatehouse ×18, beacon ×18, firepit ×9, carts,
  braziers, barrels, graves); keeps instanced per region; roads merged; camp survivors restored to
  2/camp (18); grass restored to 5,600; carts/graves restored.
- **Tree LODs integrated:** new `pine_lod` (2,267 tris, 88 KB) and `oak_lod` (2,474 tris, 80 KB)
  instanced with shared per-instance matrices, distance-banded to 54 m (fog-covered range).
- **Castle tower LOD:** new `castle_tower_lod` (3,939 tris, 120 KB, transform-identical to the full
  13.8 k tower) at one tower per castle → 249 k → 71 k tris for the tower landmark set.
- **Shadows restored** with a curated caster set (architecture, modern keeps, gatehouses, towers,
  player/enemy actors, 12 large ruins cast; tents/walls/foliage/grass/receive-only) at quality-tier
  map sizes (2048 high / 1024 medium / off low), tight ±34 m moon frustum following the player.
- Quality tiers, adaptive stepper, `__ssPerf`/`__ssQuality`, and the new
  `window.__ssCharacterPreview(actorId?)` debug hook are all live (used by QA for character
  close-ups; raycasts the camera boom against castle colliders to avoid clipping).

## 3. Verification (all green)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58 passing** (exactly 58 test blocks) |
| `npx tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | success; final bundle `index-DtnItod1.js` (801,289 B), reproduced identically by a fresh build |
| `scripts/validate-assets.mjs` | **65/65** (61 custom GLBs including 3 LODs) |
| Character QA (`--characters`) | **22/22** — 5 appearances + undead close-ups, luminance gates, clipped-frame rejection |
| Perf capture | **23/23** — 173 calls / 1,500,333 tris / tiers / loading / quality selector |
| Fresh-build smoke | **16/16**, 0 page/console/log errors, 0 asset 404s, 10 weapon cards |
| 2-player co-op | **18/18** — both snapshots list both players, shared weapon unlock syncs |
| Live baseline (deployed batch 3) | **17/17** |

## 4. Known risks / cycle-2 backlog

1. **Character material fidelity** is the top visual debt: over-bright/flat baked atlases need tone
   correction, normal/roughness/AO maps, and ideally distinct higher-fidelity armour models
   (available in the sketchlab warehouse) rather than one shared body mesh with palette swaps.
2. Tree LOD range is 54 m and LOD-only (no near full-res band) — visible on close inspection;
   acceptable under night fog but a near/far split is the next upgrade.
3. Tents, stone walls and camp survivors receive but do not cast shadows (budget); tree/cart/grave
   shadow interaction remains approximate.
4. `fortress_keep` is 5 prims / 45 draw calls across nine keeps; a 5-trimsheet → 1-atlas merge
   (asset-forge recommendation) would cut ~36 draws — good candidate for a later cycle.
5. No hardware-GPU measurement: SwiftShader only. Real fps/frame-pacing/thermals and low/medium/high
   visual comparison still need a real GPU playtest.
6. Doc links in chat: fixed by mirroring `PROJECT_STATUS.md` + `docs/*.md` into the session workspace
   and linking workspace-relative paths / present cards (the GUI cannot resolve absolute Windows
   paths).
