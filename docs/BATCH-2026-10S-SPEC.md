# Swords & Shrouds — Iteration cycle 2026-10S (AAA loop, cycle 16)

Cycle 15 (`docs/BATCH-2026-10R-RESULTS.md`) shipped the character armour atlas v5.1 + look-pass v5 and
closed the Warden/Screamer capture debt at 186 calls / 1.64 M tris. Cycle 16 finishes roadmap
milestone A: the **body-scan limb tone pass** and the first **animation-depth pass** (foot-slide,
weapon-class attack timing, idle life, death variation, movement VFX), plus regressions. Standing
gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Body-scan base-atlas tone pass (asset-side)
- Tone the **base body colour atlas only** (arms/legs/torso skin+underlayer) for the seven bodies:
  warm/desaturate and apply a slight value floor so limbs stop reading pale next to steel/leather,
  while keeping face/hand readability; **armour atlas untouched**; body/anim hashes otherwise intact.
- Keep strict-mask palette 7/7 ≥560, torso means 60–95, files ≤900 KB, tris/prims/skins/clips
  unchanged, validator 87/87, atomic install with rollback backups.
- Acceptance: in-game 2.5 m front/back/3p captures show a consistent crafted-knight read (no pale
  limb contrast), measured torso mean/p50 inside gates; before/after sheets.

### 2. Animation-depth pass (client, no new clips/server)
- **Foot-slide fix**: run clip playback rate follows actual horizontal speed (with clamps) so feet
  match ground travel; expose `slideFactor` in a QA hook.
- **Weapon-class attack timing**: thrust weapons use the thrust clip read (attack_1) with quicker
  recovery; cleave/crush use attack_2 with heavier windup hold; playback tied to weapon cooldown so
  hit timing matches server; brief anticipation lean and follow-through on the pivot.
- **Idle life**: subtle breathing/weight-shift sway in idle (procedural, reduced-motion safe).
- **Death variation**: deterministic per-actor variation (fall direction/rotation, e.g. rotate the
  death pose ±25° by actor id) so crowds don't fall identically.
- **Landing/step reaction**: tiny procedural crouch impulse on ground contact after big movement
  changes/knockback; no gameplay effect.
- QA hooks: `__ssAnimState()` → {state, speed, runTimeScale, slideFactor, attackKind, windupMs,
  idlePhase, deathVariant, reducedMotion}; tests inside existing blocks (58 preserved) for pure
  helpers (run timescale, attack kind mapping, death variant, idle phase).

### 3. Movement VFX (world)
- Footstep dust puffs on run (interval by stride), small landing poof on abrupt stop/knockback,
  pooled/distance-culled, reduced-motion attenuated; ≤1 extra draw while active; QA hook
  `__ssMoveFx()`.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `scripts/bake/bake-character-armour.mjs` (body-atlas tone stage), `public/assets/custom/*.glb.gz`, validator, ASSET-PIPELINE |
| **weapons-armory** | `src/client/custom-character.ts` (animation polish), `tests/equipment.test.ts`/`characters.test.ts` assertions, `__ssAnimState()` |
| **world-scene** | `scene.ts`, `effects.ts` (movement VFX + `__ssMoveFx()`) |
| **qa-verifier** | `smoke-browser.mjs`, `QA-REPORT.md`, `qa/**` |
| **audio-polish / ruins-builder** | standby |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with cleared Vite cache before handing a hash.
- **Perf acceptance cycle 16:** spawn TP calls **<290**, triangles **<2.15 M**; VFX pooled.
- Report measured before/after + screenshots; defer if needed and say so.
