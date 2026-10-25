# Swords & Shrouds — Iteration cycle 2026-10N (AAA loop, cycle 11)

Cycle 10 (`docs/BATCH-2026-10M-RESULTS.md`) shipped the campaign journal, wayfinding overlay and
siege bosses at 183 calls / 1.64 M tris. Cycle 11 adds **player-facing difficulty modes** (a real
accessibility/balance feature), **boss presentation** (HP bar + visual distinction), a **balance
pass** backed by headless bot sims, and closes the remaining QA verification gaps. Standing gates
unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Difficulty modes (server-authoritative)
- Three modes with clear identities, e.g. **Squire** (forgiving), **Knight** (default/intended),
  **Warden** (hard): multipliers for enemy damage dealt, enemy HP, and siege wave size; player
  damage/stamina untouched so combat feel stays constant.
- Host chooses the mode when creating a room (solo or co-op); joiners inherit and see it. Persisted
  per room; client displays it in the landing/room UI and the campaign journal; server validates
  and applies it authoritatively (no client trust).
- Balance acceptance (headless bot sim): Squire survives first boss siege with at least one player
  alive (fixing the cycle-10 "first boss downs both bots" note), Knight keeps the heavy-but-
  survivable moment, Warden is clearly hardest; normal sieges remain winnable in all modes; existing
  58 test blocks stay green with new assertions inside them.

### 2. Boss presentation (HUD + world)
- **Boss HP bar** in the HUD during boss sieges: boss name ("Shroud Warden"), segmented HP, phase
  colour, announced with the siege banner; hidden otherwise; mobile-safe; no per-frame allocations.
- **World visual distinction**: boss is slightly larger with a crimson/plague aura ring + heavier
  silhouette tint (no new textures), pulse suppressed under reduced motion; QA hook to verify.
- Capture: screenshots of boss bar + boss in world.

### 3. QA gap closure (no product change)
- Audio landmark beds: QA polls `__ssAudioState()` until stable (up to ~3 s) instead of a single
  window, so near-forge/chapel levels are recorded (ear check remains human).
- Forced normal siege: after the boss siege resolves/stops, call `__ssForceSiege(1)` and assert no
  boss (or provide `__ssStopSiege`-style cleanup if the server permits; otherwise wait for resolve).
- Journal hotkey `J` and Guide-open capture in the QA script.
- Contract tests for the difficulty modes in co-op (host's choice seen by all clients; joiners cannot
  change it).

## Ownership

| Owner | Files |
| --- | --- |
| **weapons-armory** | `src/shared/types.ts`, `src/simulation/game.ts`, `src/server/index.ts` (Lead-approved), shared difficulty presets, tests inside existing blocks |
| **audio-polish** | `main.ts`, `style.css`, `controller.ts` (difficulty UI, boss HP bar, journal display), tests/feedback.ts assertions |
| **world-scene** | `scene.ts`, `effects.ts` (boss visual/aura, `__ssBossVisual()` hook) |
| **qa-verifier** | `smoke-browser.mjs` (gap closure + difficulty/boss probes), `QA-REPORT.md`, `qa/**` |
| **asset-forge / ruins-builder** | standby this cycle |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 11:** spawn TP calls **<290**, triangles **<2.15 M**, boss bar/aura adds no
  meaningful draw cost; reduced motion respected.
- Report measured before/after + screenshots; defer if needed and say so.
