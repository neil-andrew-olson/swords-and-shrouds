# Swords & Shrouds — Iteration cycle 2026-10H (AAA loop, cycle 5)

Cycle 4 (`docs/BATCH-2026-10G-RESULTS.md`) shipped character armour v2, dynamic regional weather,
weather audio, tone/HUD fixes and new props at **206 calls / 1.708 M triangles**, live
`index-czSzE-EL.js`. Cycle 5 clears the cycle-4 album debt (armour art richness, snowstorm density,
preview/framing hooks), adds **combat feel** and **surface audio**, and deepens two landmarks with
warehouse content. Standing gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Armour art v3 (asset + runtime)
- Fix the cycle-4 art debt on plate: **uniform texel density** (triplanar/world-scale UVs instead of
  per-piece 0–1 bands), plate shapes that follow body curves, no oversized flat/"wood-grain" faces
  at 2.8 m; richer **hue-separated** patina/trim/heraldry; **1024 armour atlas** for low-variety
  bodies where it fits ≤900 KB per file.
- Give the **survivor** a distinct identity (ragged camp-survivor look, not a soldier clone).
- Optional runtime life: subtle **wind sway on cloth prims** (tabards/cloaks) via a cheap vertex
  shader term consistent with the existing foliage wind, no per-frame allocation.
- Acceptance: body-mask close-up colour variety ≥500 on at least 5/7 bodies; plate faces no longer
  read as stretched single quads at 2.8 m; QA visual pass; tris ≤15,500, single skin, clips/sockets.

### 2. Frozen Crown snowstorm density + hooks
- Snow/snowstorm must read as **dense snow with reduced visibility**: higher particle counts, larger
  flakes, gust-driven drift, fog/whiteout increase with intensity, ground frost tint; verify
  snowstorm clearly differs from snow at 10 m in screenshots.
- Expose **`activeParticles.snow`** (and gust/flash counters) in `__ssWeather()`; keep low-tier
  minimal (0 particles) and quality tiers intact.
- Fix `__ssPreviewBody(name, distance)` framing bug (synthetic body not rendering in the frame).
- Move `region-crown` QA camera fully inside the crown region (currently in the moor↔crown blend).
- Add **combat feel polish** (client-only): heavy-hit **hit-stop** (brief time-scale dip), camera
  kick/shake on heavy attacks and damage, directional damage vignette; must not break input/state
  timing and should respect reduced-motion preference.
- Acceptance: perf <270 calls / <2.0 M tris; snowstorm visual proof; preview hook renders; 0 errors.

### 3. Content: chapel altar + smithy forge (warehouse)
- Bake `stone_altar` (from `gothic-candle-altar-wax-ritual-book.zip`) and `forge_furnace` (from
  `furnace.zip`) as night-toned props (≤4,000 / ≤8,000 tris, embedded texture, ground-centred).
- Place: altar inside/next to the Ashen Moor chapel ruin; furnace at the two blacksmith stalls
  (village + camp), with existing-crate/ingot dressing; validate clearances.
- Acceptance: +2 instanced layers, ≤6 draws; no 404s; landmarks read richer.

### 4. Surface audio
- Footstep audio that varies by surface/region (stone road/castle courtyard, grass, snow, ash,
  wood planks) and by movement (walk/run) with light randomization; plus a quiet chapel/ritual
  ambience near the altar and quench/hammer one-shots near the forge; gated by Sound/pause, cheap,
  no new deps; keep 58 test blocks.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom`, `scripts/bake/**`, `docs/ASSET-PIPELINE.md`, validator |
| **world-scene** | `scene.ts`, `landscape.ts`, `effects.ts`, `postfx.ts`, `assets.ts` |
| **weapons-armory** | `custom-character.ts`, `equipment.ts`, `tests/equipment.test.ts` |
| **ruins-builder** | `ruins.ts`, `terrain-surfaces.ts` |
| **audio-polish** | `ambience.ts`, `main.ts`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 5:** spawn TP calls **<270**, triangles **<2.0 M**, quality tiers intact.
- Report measured before/after + screenshots; defer if needed and say so.
