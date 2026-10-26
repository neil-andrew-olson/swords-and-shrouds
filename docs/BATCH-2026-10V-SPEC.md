# Swords & Shrouds — Iteration cycle 2026-10V (AAA loop, cycle 19)

Cycle 18 (`docs/BATCH-2026-10U-SPEC.md`) added the Shroud Stalker harasser and the two-phase Warden
at 184 spawn calls / 1.65 M tris. Cycle 19 continues **roadmap milestone B (content depth)** with a
**distinct second boss**: the **Shroud Colossus** — a huge corrupted siege-breaker with telegraphed
ground-slam AoE, lingering **corruption pool** hazards and multi-phase escalation, plus its HUD/audio/FX
presentation and QA. Standing gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goal: Shroud Colossus boss encounter

### Server (authoritative)
- Second boss type alternating with the Warden for qualifying sieges (e.g. boss index %3===0 or
  index ≥7) and optionally guarding the plague nest endgame: corrupted `colossus:true`,
  name **'Shroud Colossus'**, HP **420** (difficulty-scaled), heavy armour, slow speed (~2.2),
  large scale (client presentation).
- **Ground-slam attack**: 1.4 s telegraph at the target's position (event + `slamCharge` state),
  then impact **AoE radius 5.5** dealing **34 damage** to non-hostile actors inside, ignoring walls
  only where the blast is unobstructed (wall-checked line from boss to impact) — not a melee cone.
- **Corruption pools**: each slam leaves a hazard entry `game.hazards[]`
  `{id,x,z,radius,expiresAt,damagePerSecond}` lasting **12 s** dealing **6 dps** to non-hostile
  actors inside; hazards expire/cap (e.g. max 6 simultaneously), co-op synced.
- **Phases**: phase 2 at ≤66 % HP — slam cooldown shortens + summons 2 Stalkers once; phase 3 at
  ≤33 % — speed up, slam telegraph shortens, event/occasional double slam; enrage/summons once,
  no dupe; co-op synced; counters `stats.colossi`, `stats.slams`, `stats.pools`.
- Deterministic spawn/alternation rule; counts as corrupted everywhere; no exploits; balance sims
  (2 bots at the qualifying siege indices) confirm winnable with the castle held.

### Client presentation
- Colossus: 1.6× scale, heavy corrupted silhouette (existing bloated/armoured appearance), distinct
  violet-green aura; **slam telegraph**: growing ground ring + charge glow (static under reduced
  motion); **impact**: burst + dust + camera shake (reduced-motion attenuated); **corruption pools**:
  pooled dark-violet ground decals with slow pulse (static reduced-motion), pooled/alloc-free, culled.
- HUD: boss bar name/HP/phase works for Colossus (reuse boss siege bar with per-boss name), and the
  existing `__ssBossVisual()` reports the correct scale/phase.
- Hooks: `__ssColossus()` {count,ids,phase,slamCharge}, `__ssHazards()` {count,positions,expires},
  `__ssColossusFx()` {telegraphVisible,slams,impacts,pools,draws,reducedMotion}; QA trigger
  `__ssTriggerColossusFx('telegraph'|'slam'|'pool')`.
- Audio/captions: slam charge cue + impact boom, phase-change cue, captions for slam windup/impact
  and phase transitions; cue state in `__ssAudioState().cues`.

## Ownership

| Owner | Files |
| --- | --- |
| **weapons-armory** | `src/simulation/game.ts`, `src/shared/types.ts`, `src/server/index.ts` if needed (Lead-approved), `src/client/custom-character.ts` if scale/tint needed, tests |
| **world-scene** | `scene.ts`, `effects.ts` (telegraph/slam/pools/aura, hooks, culling) |
| **audio-polish** | `ambience.ts`/`main.ts`/`controller.ts` (slam/phase cues + captions) |
| **qa-verifier** | smoke harness, QA-REPORT, qa/** |
| **asset-forge / ruins-builder** | standby (reuse existing undead rigs; no new assets required) |
| **Lead** | docs, PROJECT_STATUS, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with cleared Vite cache before handing a hash.
- **Perf acceptance cycle 19:** spawn TP calls **<290**, triangles **<2.15 M**; pools/telegraph/pools
  pooled with bounded draws.
- Report measured before/after + screenshots; defer if needed and say so.
