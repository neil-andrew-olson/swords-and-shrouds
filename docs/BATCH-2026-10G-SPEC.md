# Swords & Shrouds — Iteration cycle 2026-10G (AAA loop, cycle 4)

Cycle 3 (`docs/BATCH-2026-10F-RESULTS.md`) shipped regional identity, warehouse foliage/landmark
content, elite undead and region audio at **195 draw calls / 1.667 M triangles**, live
`index-C1FVaRwU.js`. Cycle 4 targets the biggest remaining art gap (**character/armour variety**),
adds **weather systems**, fixes the cycle-3 tone debts (foliage saturation, crown framing, torso
p50) and attacks **time-to-HUD**. Standing gates unchanged (58/58 tests, tsc, build, validator,
smoke/co-op/live, QA screenshots).

## Goals + acceptance

### 1. Character / armour identity v2 (top priority)
The seven player/companion bodies still share one mesh with different palettes and only small
add-ons. Add **distinct full armour silhouettes per appearance**, built from warehouse armour
models and/or procedural Blender geometry, as extra skinned primitives on the existing Mixamo rig
(single skin, 6 clips, hand sockets preserved):
- templar: crusader great-helm + breastplate/tabard + larger pauldrons;
- hero: knightly cuirass + pauldrons + visored helm;
- berserker: bare arms + iron bracers + horned/iron helm and fur shoulder;
- ranger: hood + long cloak + leather cuirass + quiver/back gear;
- ally: cuirass + tabard + helmet (blue heraldry);
- survivor: ragged cloak + pack;
- fallen: corrupted plate + crest (extend existing).
Budgets: **≤15,500 tris per body** (test limit 16,000), file ≤900 KB, embedded textures, one skin,
rig/clips hash-identical. Close-up and 10 m third-person silhouette must read as distinct
archetypes; atlas colour variety ≥500 unique colours in close-ups.

### 2. Weather systems (regional, dynamic)
Per-region weather states with smooth transitions and pooled particles, quality-tiered:
- **Green March**: light rain (streaks, splashes), wet-road sheen, occasional distant lightning flash
  + delayed thunder; clearer between showers.
- **Ashen Moor**: drifting ash fall, smoke haze banks, stronger gusts, ember drift.
- **Frozen Crown**: snowstorm phases (dense snow, reduced fog visibility, ground whitening feel),
  wind gust howl.
Dynamic cycle (e.g. 3–6 min phases with transitions) so regions change over time; weather state
exposed to audio and QA (`__ssWeather()` returning region/phase/intensity or a shared event).
Acceptance: QA weather captures per region at high/low intensity, no particle spam/allocations,
frames stay within perf gates.

### 3. Tone + HUD debt fixes
- Reduce green foliage saturation/brightness ~10–20 % at night and desaturate maple toward
  autumn-forest tone (keep variety, kill neon look).
- Fix `region-crown` QA camera framing (no canopy covering ~40 % of frame).
- Bring character torso p50 back under 100 without regressing close-ups (likely background fill /
  ambient tweak or crop re-baseline with QA agreement).
- **Time-to-HUD**: profile and reduce (shader precompile/warmup via `renderer.compileAsync` during
  loading, fewer program permutations, defer HUD-only work); expose timing marks; target HUD
  ≤15 s under SwiftShader with landing improvement retained, and document that real-GPU numbers
  are expected much lower.

### 4. New props/structures + weather audio
- Bake 2 new props from the warehouse: `stone_well` (medieval stone well, ≤3,000 tris) and
  `blacksmith_stall` (forge/stall, ≤5,000 tris); integrate at camps/castles/village landmark with
  validated clearances.
- Weather audio (rain loop, snow hush, ash wind, thunder rumbles) tied to weather state, cheap and
  gated; keep 58 test blocks.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom`, `scripts/bake/**`, `docs/ASSET-PIPELINE.md`, validator |
| **world-scene** | `scene.ts`, `landscape.ts`, `effects.ts`, `postfx.ts`, `assets.ts` (weather, tone, HUD) |
| **ruins-builder** | `ruins.ts`, `terrain-surfaces.ts` (new props placement) |
| **weapons-armory** | `custom-character.ts`, `equipment.ts`, `tests/equipment.test.ts` (verify new prims, armour materials, torso tone) |
| **audio-polish** | `ambience.ts`, `main.ts`, `tests/feedback.test.ts` (weather audio) |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings,
  no new npm deps, embedded assets only; one dist builder at a time; PID-scoped kills only;
  teammates never git or touch another owner's files; report measured before/after.
- **Perf acceptance cycle 4:** spawn third-person calls **<260**, triangles **<1.95 M** (weather +
  armour add cost), quality tiers intact; verify weather doesn't spike frame time.
- Deferring a goal is acceptable if stated; no silent regressions.
