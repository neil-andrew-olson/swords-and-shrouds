# Swords & Shrouds — Iteration cycle 2026-10Q (AAA loop, cycle 14)

Cycle 13 (`docs/BATCH-2026-10P-RESULTS.md`) added camp props, siege audio layers/stings and the
shield bash at 185 calls / 1.64 M tris. Cycle 14 is a **landmark + atmosphere** cycle: a new
**windmill landmark with animated sails**, **torch-lit roads** with fire ambience, and closure of the
remaining capture/audio debt. Standing gates unchanged (58/58 tests, tsc, build, validator,
smoke/co-op/live).

## Goals + acceptance

### 1. Windmill landmark with animated sails
- Asset-forge authors (procedurally, night palette — no warehouse windmill exists) two assets:
  `windmill` (tower/body, ~1–2.5k tris, ~9–10 m tall, ground-centred, front +Z) and
  `windmill_sails` (4 sail blades + hub, ~300–800 tris, hub at local origin, blades in a vertical
  plane so a single axis rotation animates them), 1 prim each, shared or own 512² night texture,
  gzip, KHR_mesh_quantization only.
- Ruins-builder places them as a Green March landmark (village/farmland composition, validated
  clearances) with the sails as a sibling group.
- World-scene animates the sails (slow wind-scaled rotation, slowed/stopped under reduced motion),
  showing them only when the windmill is visible (distance culling), +≤1 draw; `__ssWindmill()` hook
  for QA. Acceptance: windmill visible/grounded in captures, sails rotate (angle changes over time),
  reduced-motion behaviour, perf inside gates.

### 2. Torch-lit roads + fire ambience
- Ruins-builder places the installed `torch_post` asset (deferred from cycle 13) along the main roads
  (e.g. 6–8 posts) as one instanced layer, with flame cones appended to the existing flames layer
  (no new lights), validated clearances, 85 m culling; export `TORCH_POSTS` for audio.
- Audio-polish adds a low **torch-fire crackle ambience bed** anchored to the nearest torch posts
  (positional like the chapel/forge beds, with a small radius and low level), exposed in
  `__ssAudioState().landmarkBeds` (e.g. `torches`) and QA-focus-compatible for deterministic checks.
- Acceptance: torches/flames visible in a road capture, audio bed measurable near vs away, perf
  unaffected at spawn.

### 3. Deferred QA captures + debt
- Warden-mode forced-boss screenshot (repeat with early capture), forced Screamer capture via
  `__ssForceSiege(3)`, normal forced-siege after resolve if feasible.
- Audio landmark ear check remains human; re-poll `__ssAudioFocus` landmark beds (chapel/forge/torch)
  with the stable polling harness.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (windmill, windmill_sails), bake scripts, validator, ASSET-PIPELINE |
| **ruins-builder** | `ruins.ts` (windmill landmark, torch posts + flames, QA poses, exports) |
| **world-scene** | `scene.ts`, `effects.ts` (sail animation, `__ssWindmill()`, torch visibility) |
| **audio-polish** | `ambience.ts` (torch-crackle bed), `main.ts` hook exposure if needed, tests inside existing block |
| **qa-verifier** | `smoke-browser.mjs`, `QA-REPORT.md`, `qa/**` |
| **weapons-armory** | standby (no server changes this cycle) |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with a cleared Vite cache before handing a
  hash (cycle-11/13 lesson).
- **Perf acceptance cycle 14:** spawn TP calls **<290**, triangles **<2.15 M**; windmill sails +1 draw
  max; torches instanced (no new lights).
- Report measured before/after + screenshots; defer if needed and say so.
