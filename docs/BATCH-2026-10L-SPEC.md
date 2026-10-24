# Swords & Shrouds — Iteration cycle 2026-10L (AAA loop, cycle 9)

Cycle 8 (`docs/BATCH-2026-10K-RESULTS.md`) shipped mobile/touch, device-aware quality, enemy
preview + hit feedback at 211 calls / 1.735 M tris, live `index-NAyaupV0.js`. Cycle 9 adds a new
weapon and landmark content, plus the remaining verification hooks. Standing gates unchanged
(58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. New weapon — War Spear (11th weapon)
- Bake `spear` weapon asset (night palette, canonical grip/orientation consistent with the existing
  polearms — vertical shaft, grip near the lower third, point along +Y, ≤3,400 tris, embedded
  texture, gzip).
- Add `spear` to `src/shared/weapons.ts` as a long-thrust + shield option, e.g. damage 32, reach 5.6
  (longest), cooldown 0.7, stamina 20, arc 0.16, length 2.2, `shield:true`,
  style "Long thrust · shield guard"; add its grip/orientation profile and swing style in
  equipment.ts; ensure drops/armory UI automatically include it (WEAPON_IDS-driven).
- Acceptance: 11 armory cards in-game, spear equip/attack reach/damage/stamina/cooldown work on the
  server, grip looks correct in third person, drops can spawn it, tests still exactly 58 blocks with
  new assertions inside existing ones, QA gates updated 10→11 cards.

### 2. New landmark — ruined abbey / courtyard
Bake `abbey_ruin` from the warehouse (`overgrown-courtyard-patio-ruin.zip`, ≤14,000 tris, 1–2 prims,
embedded 512–1024 night texture, ground-centred) and place it as a second Green March landmark (or
Ashen if composition fits better), with validated clearances and a QA capture pose. Cost ≤3 draws
when visible, receive-only shadows, distance-culled.

### 3. Verification hooks
- **Hit-flash hold**: `__ssSetHitFeedbackHold(true|false)` keeps the per-hit flash active for QA
  stills (slow SwiftShader frames can miss the 130 ms pulse); normal behaviour unchanged.
- **Audio state**: `__ssAudioState()` returns active beds/layers with levels and weather state so a
  human can verify the soundscape systematically (headless ear-check remains a human task).

### 4. Content/doc consistency
Update any "10 weapons" claims in guide copy/QA gates to 11; keep armory card count checks driven
by WEAPON_IDS.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (spear, abbey_ruin), `scripts/bake/**`, validator, ASSET-PIPELINE |
| **weapons-armory** | `src/shared/weapons.ts`, `equipment.ts`, `custom-character.ts`? (grip), tests/armory/equipment (assertions) |
| **world-scene** | `scene.ts` (hit-flash hold, 11-weapon smoke expectations), `effects.ts` if needed |
| **ruins-builder** | `ruins.ts` (abbey placement + QA pose) |
| **audio-polish** | `main.ts`/`ambience.ts` (`__ssAudioState()` hook only) |
| **qa-verifier** | smoke gates 10→11 cards, spear/abbey/hit-hold/audio-state verification, docs |
| **Lead** | docs, PROJECT_STATUS, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 9:** spawn TP calls **<290**, triangles **<2.15 M**; armory preload grows by
  one small weapon (payload acceptable).
- Report measured before/after + screenshots; defer if needed and say so.
