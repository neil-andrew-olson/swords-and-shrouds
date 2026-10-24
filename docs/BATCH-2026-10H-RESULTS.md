# Iteration cycle 2026-10H — Results (AAA loop, cycle 5)

Fifth cycle of the standing AAA loop. Cycle 4 (`docs/BATCH-2026-10G-RESULTS.md`) ended at
206 calls / 1.728 M triangles with armour v2, weather systems and weather audio. Cycle 5 cleared
the cycle-4 art debts (plate texel density, palette variety, survivor identity, snowstorm density,
preview/framing hooks), added **combat feel**, **surface-aware audio**, and two warehouse-content
props. Final bundle `index-CsjSWrV-.js` (879,493 B), deterministic across clean builds.

## 1. Armour art v3 + survivor identity

- **Plate texel density fixed:** per-piece 0–1 band UVs replaced by world-scale mapping (revolved
  pieces by circumference×height, sheets by real size, boxes planar); atlas content moved to
  low-frequency gradients + softened normal relief, so the 2.8 m "wood-grain/stretched quad"
  artifact is gone. QA gradient metric 6.66–12.86 (no flat-face outlier), matching the sheet
  cross-check with weapons-armory.
- **Hue-separated detail:** teal patina / rust / oxide on plate, hue-shifted cloth stains, three-hue
  heraldry, per-panel patchwork cloth with stitch lines; **1024² armour atlas on all 7** bodies.
- **Survivor identity rebuilt:** tattered hood/cloak with jagged hem and sewn patches, bedroll +
  satchel, rope belt, **walking staff** rigid-weighted to the right hand, faded brown/tan palette —
  no plate, no soldier clone (QA pre/post diff 4.69 / 10.87 %).
- **Cloth wind sway:** bounds-normalised vertex sway on tabard/cloak/fur prims (hem ~3 % of the
  piece, zero at waist/head), foliage-style time sines, scene-independent clock, allocation-free;
  `setCharacterWindQuality(tier)` removes the shader term at low tier and is wired into
  `setQuality`. QA body-motion 7.8–17.9 vs background ≤0.91; weapons-armory frozen-pose
  cross-check 0.619/0.752/0.540 vs a no-cloth hero control 0.000.
- **Geometry gate:** any armour triangle over 0.5 bind units² is midpoint-subdivided; every body's
  max face 0.0028–0.0088 m², max edge ≤0.467 m (was fallen 0.0353 m²). Plate/preview tests extended
  inside the existing 58 test blocks.
- **Colour variety:** QA crop metric **7/7 bodies ≥500** (618–941); strict silhouette-mask 4/7
  (606/739/1073/697/402/424/376) documented as cycle-6 art debt for ranger/hero/fallen.

## 2. Frozen Crown snowstorm density (cycle-4 debt) + hooks

- Separate dense billboard snow system: **480 flakes at snow 0.6 → 800 at snowstorm 1.0**, larger
  flakes, gust-driven drift (gust 1.23→1.57), whiteout fog density 0.0195→0.0249, ground frost tint;
  **low tier = 0 snow particles** (qualityScale 0). QA: snow 240→800, fog 0.0185→0.0239, low-tier 0;
  visually distinct dense flakes/whiteout.
- `__ssWeather().activeParticles.snow` (+ gust/flash) exposed; `__ssPreviewBody` fixed — async
  on-demand load, camera-quaternion placement, all **7/7 bodies render**; `region-crown` camera moved
  fully inside the region and now reports `region:'crown'`; bonus `__ssSurfaceAt(x,z)` helper.

## 3. Combat feel (new)

- **Hit-stop** 57.8–60 ms on heavy hits (visual-only time scale; input/network untouched), camera
  kick + shake, directional red damage vignette, FOV punch; intensity from `weaponCombatProfile`
  weight (late threshold fix so every attack tier registers).
- `__ssCombatFx()` exposes persistent state; `prefers-reduced-motion` + `__ssSetReducedMotion()`
  path verified (hit-stop 0, kick ≤0.013, vignette 0 in two runs; one residual 0.546 sample noted).

## 4. Content + surface audio

- `stone_altar` (3,944 tris) at the Ashen chapel approach (−27.71, −226.14) and `forge_furnace`
  (6,979 tris) ×2 beside the village and camp blacksmith stalls; +2 instanced layers, +2 draws,
  ~17.9 k tris map-wide, receive-only shadows, 85 m compaction. Furnaces verified visually; altar
  ritual dressing visible but small/low-contrast at night → cycle-6 readability note.
- **Surface-aware footsteps** (stone/grass/snow/ash/wood, walk vs run cadence, randomization,
  Sound/pause gated) plus **chapel/ritual ambience** (choir pad, drone, candle hiss) anchored at the
  real altar and **forge ambience** (roar, hammer clinks, quench hiss) at both furnaces, using
  ruins-builder's exported placement constants; prefers `__ssSurfaceAt` when present.

## 5. Verification (final artifact `index-CsjSWrV-.js`, 879,493 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, **two consecutive builds identical hash** (`index-CsjSWrV-.js`) |
| `validate-assets` | **78/78** |
| Fresh-build smoke | **22/22** + exact hash reproduction, 0 errors/404s/warnings, 10 cards, WS 1/0 |
| Characters/armour | crop palette 7/7 ≥500; tone 68.89/61.16, clip 0; elite 29.87/86.33; preview 7/7 |
| Snowstorm/regions | snow 240→800, fog 0.0185→0.0239, low-tier 0, crown reports crown |
| Combat feel | hit-stop 57.8–60 ms, vignette 0.648–0.816, kick 0.044–0.073, reduced-motion path verified |
| Perf | **208 calls / 1,726,954 tris** (<270/<2.0M); FP 160/1.609 M; low 162/1.414 M |
| Payload / HUD | **16.25 MiB**; click→HUD 158 ms, click→state 1,146 ms, join 3,330 ms (nav figure is QA landing overhead) |
| Regression | co-op **18/18**, live baseline **19/19**, 31/31 views incl. 12 optional content views |

## 6. Carried into cycle 6

1. Strict **silhouette-mask palette** shortfall (ranger 376 / hero 402 / fallen 424) — add hue chips
   on cloak exteriors/plate faces (asset-forge targets documented in ASSET-PIPELINE).
2. **Altar night readability** (small/low-contrast) — scale/position/lighting polish.
3. **Reduced-motion vignette** residual sample (one run showed 0.546) — verify damping.
4. Low-tier **cloth-wind isolation** test; surface-audio **ear check** (headless can't hear).
5. Real-GPU/perceptual/controller/mobile playtests; `landmark-crown` camera still near border
   (informational); ongoing campaign/enemy-variety/content expansion.
