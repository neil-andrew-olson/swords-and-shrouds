# Swords & Shrouds — Iteration cycle 2026-10M (AAA loop, cycle 10)

Cycle 9 (`docs/BATCH-2026-10L-RESULTS.md`) shipped the War Spear (11th weapon), the ruined abbey
landmark, verification hooks and audio diagnostics at 186 calls / 1.64 M tris. Cycle 10 targets
**campaign clarity and depth**: a proper campaign journal/objectives UI, clearer objective wayfinding,
siege escalation with boss encounters, and the remaining audio/QA polish. Standing gates unchanged
(58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Campaign journal + objectives UI (client)
- **Journal overlay** (open from HUD/Guide or a hotkey) showing: Reclaim the Kingdom progress (castles
  held / 9, regions), survivors rescued (X/9), camps rescued, plague nest status, siege count/next
  siege, current weapon and its stats, controls legend (keyboard/controller/touch aware), and short
  tips ("bring a shield to sieges", "the nest opens once all castles are yours").
- **Next-objective line** in the HUD updated from game state ("Free the Border Fortress · press E" /
  "Rescue the last survivor in the Ashen Moor" / "Destroy the plague nest"), with distance/direction.
- Must work desktop + mobile (scrollable, safe areas), be keyboard/controller/touch accessible,
  pause the game? (default: overlay pauses input like Guide does), 0 console errors, 58 tests kept.
- Acceptance: QA captures the journal with real state at 3 progress stages; next-objective line
  tracks state; mobile layout scrollable; no regressions.

### 2. Objective wayfinding polish
- Distinct, readable world markers/labels for survivors/camps (rescue), plague nest (endgame),
  hostile castles, and the next objective target; distance shown; subtle pulse; no clutter at range.
- Acceptance: screenshots showing markers for at least 2 objective types + distance labels; no draw
  explosion (existing marker system, ≤+2 draws).

### 3. Siege escalation + boss encounters (server-side depth)
- Every 2nd siege (and the final one) includes a **corrupted boss** (e.g. "Shroud Warden", 220–280 HP,
  slower/heavier attack) leading the wave; wave sizes scale a bit with captures; a HUD event banner
  announces boss sieges. Rewards unchanged but boss drops extra iron/wood on death.
- Co-op safe, deterministic spawns, tests extended inside existing blocks (still 58), no exploits
  (boss counts as corrupted for existing rules), headless sim verified.
- Acceptance: simulation test proves boss spawns on qualifying sieges and not otherwise; QA sees the
  banner/HUD when forced (server-side or harness hook); no balance break (player survives normal play).

### 4. Audio/QA polish
- Make `__ssAudioFocus` landmark-bed ramps deterministic for QA (fast-forward the smoothing when
  focus is set) so near-forge/chapel levels are measurable; add `__ssObjectives()` state hook if
  useful to QA.
- Keep surface audio, captions, weather beds intact.

## Ownership

| Owner | Files |
| --- | --- |
| **audio-polish** | `main.ts`, `style.css`, `controller.ts` (journal/objectives UI, mobile layout), `__ssAudioFocus` ramp fix |
| **weapons-armory** | `src/simulation/game.ts` (Lead-approved), `tests/*.test.ts` (assertions inside blocks) |
| **world-scene** | `scene.ts` (objective markers/labels, `content-abbey` named view, `__ssObjectives` if needed), `effects.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **asset-forge / ruins-builder** | standby this cycle (no asset work required) |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 10:** spawn TP calls **<290**, triangles **<2.15 M**, 0 draw explosion from
  markers/journal.
- Report measured before/after + screenshots; defer if needed and say so.
