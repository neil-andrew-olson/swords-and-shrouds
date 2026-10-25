# Swords & Shrouds — Iteration cycle 2026-10U (AAA loop, cycle 18)

Cycle 17 (`docs/BATCH-2026-10T-SPEC.md`) fixed sprint foot-slide and added the ranged **Shroud
Caster** (projectile AI + telegraph + FX/cues). Cycle 18 continues **roadmap milestone B (content
depth)**: a **Shroud Stalker** harasser enemy (fast, flanking, lunging) and a **two-phase Shroud
Warden** boss fight (enrage at 50 % + adds + intensified presentation), then QA/deploy. Standing gates
unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Shroud Stalker (fast harasser, server-authoritative)
- New corrupted enemy `stalker:true` built on the existing zombie/skeleton rig (no new asset):
  name **'Shroud Stalker'**, HP ~62 (difficulty-scaled), light armour, rapid movement (~5.2),
  **flanking AI**: picks a player, circles at 6–10 m to approach from the side/back, then commits to
  a **telegraphed lunge** (~0.45 s crouch/charge cue) dealing moderate damage (~18) with a short
  recovery; cannot lunge through walls; melee fallback; cooldown ~2.5 s.
- Deterministic spawns: 2 per siege index ≥3, 1–2 in the Ashen Moor wilds near the nest approach;
  counts as corrupted for all rules; co-op synced; counters `stats.stalkers` / `stats.stalkerLunges`
  reset on restart; no exploits.
- Acceptance: server tests (spawn rule/counts, flanking/telegraph, lunge hit/wall, co-op sync,
  counters); in-game capture of a stalker circling/lunging; balance sim evidence (2 bots).

### 2. Two-phase Shroud Warden boss
- Boss fight depth: at **≤50 % HP** the Warden **enrages** — movement/attack cadence increase,
  violet-crimson aura intensifies, and it **summons 2 adds** (screamer + caster or 2 screamers) once;
  phase events (`The Shroud Warden howls — the shroud thickens!`), phase exposed in state/hooks so the
  HUD boss bar shows a phase change (FRENZIED); enrage ends on death; co-op synced; no dupe summons.
- Acceptance: tests (phase transition at HP threshold once, summons once, stat/sync, no exploit);
  QA HUD bar phase FRENZIED + screenshot of enraged boss + adds; balance sim shows still winnable.

### 3. Presentation + polish
- Stalker: pale-violet tint/aura ring distinct from caster/crimson boss, lunge windup ground ring +
  dust trail while sprinting (world-scene, pooled ≤2 draws), charge/lunge cue + caption
  ("A Shroud Stalker closes in!"), reduced-motion safe.
- Warden phase 2: aura colour/intensity shift + phase label in boss bar, event caption.

## Ownership

| Owner | Files |
| --- | --- |
| **weapons-armory** | `src/simulation/game.ts`, `src/shared/types.ts`, `src/server/index.ts` if needed (Lead-approved), `src/client/custom-character.ts` if stalker tint/rig needs it, tests |
| **world-scene** | `scene.ts`, `effects.ts` (stalker aura/windup/trail, enraged boss aura, hooks) |
| **audio-polish** | `ambience.ts`/`main.ts` (stalker lunge cue + caption, enrage howl cue + caption) |
| **qa-verifier** | smoke harness, QA-REPORT, qa/** |
| **asset-forge / ruins-builder** | standby (stalker reuses existing rigs) |
| **Lead** | docs, PROJECT_STATUS, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with cleared Vite cache before handing a hash.
- **Perf acceptance cycle 18:** spawn TP calls **<290**, triangles **<2.15 M**; all new FX pooled.
- Report measured before/after + screenshots; defer if needed and say so.
