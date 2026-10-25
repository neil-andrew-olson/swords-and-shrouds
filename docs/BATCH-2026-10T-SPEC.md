# Swords & Shrouds — Iteration cycle 2026-10T (AAA loop, cycle 17)

Cycle 16 (`docs/BATCH-2026-10S-RESULTS.md`) shipped the body-atlas tone pass, animation-depth pass and
movement VFX at 167 spawn calls / 1.62 M tris. Cycle 17 closes the one animation gap (sprint
foot-slide) and starts **roadmap milestone B: enemy family #2** — a **ranged corrupted "Shroud
Caster"** with projectile AI, telegraph and distinct FX/audio, plus QA and deployment. Standing gates
unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Foot-slide recalibration (close-out)
- Real run speed measures ~8 (cycle-16 gate observed `speed 8 → runTimeScale 1.35, slideFactor .411`).
  Recalibrate `runTimeScaleFor` stride/clamp so the residual slide at full speed is **≤0.06** while
  low-speed movement still animates sensibly: e.g. stride light 5.925 / heavy 5.08 and clamp 0.6–1.6
  (calibrate against the real run/ash/slow speeds), or an equivalent measured solution.
- Acceptance: helper table shows slide ≤.06 at the actual full speed and low-speed behaviour
  documented; in-game run capture `__ssAnimState().slideFactor` ≤.06; no change to movement speed.

### 2. Enemy family #2: Shroud Caster (ranged corrupted)
- Server-authoritative ranged enemy: corrupted appearance (fallen/skeleton-armoured variant), spawns
  in sieges from index ≥2 and near the plague nest; behaviour:
  - seeks line-of-sight at 10–20 m, **telegraphs** (~1.0 s charge: glow/cue/event) then launches a
    slow **shadow bolt projectile** toward the target's predicted position; bolt travels, collides
    with actors/walls/ground, deals moderate damage (e.g. 14–18), cannot hit through walls, friendly
    fire rules unchanged; cooldown ~3 s; melee fallback if close.
  - deterministic spawn rule/counts; counts as corrupted for all rules; co-op synced (projectile id,
    origin/direction, hit events); no exploits; stats counters for QA
    (`stats.casters`, `stats.casterBolts`), reset on restart.
- Client: projectile mesh + trail/impact FX (pooled), telegraph glow/ground ring, a distinct **charge
  cue sound** + caption on launch, caster silhouette readable (aura/tint marker separate from boss);
  QA hooks `__ssCasters()`, `__ssProjectiles()`, `__ssCasterFx()`.
- Acceptance: server tests (spawn/gating/telegraph timing/projectile travel/hit/wall/co-op sync/
  counters), in-game capture of telegraph → bolt → hit, perf within gates (<290 calls/<2.15M).

### 3. Polish + regression
- Caption for caster launch; audio cue; reduced-motion safe FX.
- All previous gates: look/markers/windmill/torches/animation/move FX/journal/lore/recap/mood/
  difficulty/mobile/co-op/perf/payload/freshness.

## Ownership

| Owner | Files |
| --- | --- |
| **weapons-armory** | `src/client/custom-character.ts` (foot-slide recalibration), `src/simulation/game.ts`, `src/shared/types.ts`, `src/server/index.ts` (Lead-approved), tests |
| **world-scene** | `scene.ts`, `effects.ts` (projectile/telegraph/impact FX, `__ssCasters`/`__ssProjectiles`/`__ssCasterFx`) |
| **audio-polish** | `ambience.ts`/`combat-feedback.ts`/`main.ts` (caster charge/launch cue, caption wiring) |
| **qa-verifier** | smoke harness, QA-REPORT, qa/** |
| **asset-forge / ruins-builder** | standby (caster reuses existing undead assets + FX) |
| **Lead** | docs, PROJECT_STATUS, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with cleared Vite cache before handing a hash.
- **Perf acceptance cycle 17:** spawn TP calls **<290**, triangles **<2.15 M**; projectiles pooled.
- Report measured before/after + screenshots; defer if needed and say so.
