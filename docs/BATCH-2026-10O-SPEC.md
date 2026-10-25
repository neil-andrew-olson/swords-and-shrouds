# Swords & Shrouds — Iteration cycle 2026-10O (AAA loop, cycle 12)

Cycle 11 (`docs/BATCH-2026-10N-RESULTS.md`) added difficulty modes, boss presentation and balance
sims at 183 calls / 1.64 M tris. Cycle 12 deepens the **campaign content**: an unlockable
**chronicle/lore** system, an **end-of-run recap** with epilogue, a new **Screamer** enemy behaviour
that spreads the horde, and closes the remaining QA verification debt. Standing gates unchanged
(58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Chronicle / lore (client content)
- New `src/shared/lore.ts` (or client data module) with **12–16 short lore entries** covering the
  three regions, key castles, survivors, the plague nest, the Shroud Warden, weapon lineages and the
  ending; each has an unlock condition derived from existing campaign state (castles reclaimed ≥N,
  survivors rescued ≥N, sieges survived ≥N, nest sealed/vulnerable, boss seen/killed, difficulty).
- Journal gains a **Chronicle** section listing unlocked entries (locked ones as "unrecorded" hints);
  a subtle "New chronicle entry" toast/caption fires once per unlock; unlocks persist across reloads
  via existing save/state (pure helper functions), and are readable through a new `__ssLore()` hook.
- Acceptance: QA verifies lock/unlock transitions with real state, no spam, journal scroll stays sane;
  pure helper tests inside the existing block (58 preserved).

### 2. End-of-run recap + epilogue (client)
- Victory/defeat screen gains a **run recap**: time played, castles reclaimed /9, survivors /9, camps,
  sieges survived, bosses felled, difficulty label, weapon used; plus an **epilogue line** per outcome
  (victory with the nest sealed / defeat of the fellowship) and a "begins anew" restart affordance.
- Stats come from authoritative snapshot stats (extend only if an existing counter is missing) and are
  qualitative-correct for co-op (party totals). Source data through a tested pure helper.
- Acceptance: QA captures victory/defeat recap (can use QA preview/state hooks or a local forced setup),
  values match state, mobile layout scrollable, restart works.

### 3. Shroud Screamer (server enemy behaviour)
- A rare corrupted enemy — **Shroud Screamer** (name, appearance skeleton-armoured or fallen, lower HP
  than corrupted, light armor) — spawns in sieges from index ≥3: on first aggro it emits a noise that
  calls nearby undead (existing noise system), with a distinct event/caption tick; no new actor kind
  (kind corrupted, `screamer:true`), deterministic spawn rule, co-op safe, no dupe/exploit.
- Acceptance: sim/test proves spawn rule/behaviour; QA sees the event/caption in a forced siege if
  feasible (or sim evidence); balance unaffected (screamer is squishy but dangerous in numbers).

### 4. Verification debt
- Fix/確認 `game.difficulty` snapshot exposure if QA's live summary read null for default rooms
  (always include the field).
- QA: re-attempt the Warden-mode forced boss siege capture; close remaining gaps noted in cycle 11.
- Optional world-scene: victory/defeat world mood (fog/tint/embers shift) for the recap moment.

## Ownership

| Owner | Files |
| --- | --- |
| **audio-polish** | `src/shared/lore.ts` (new), `main.ts`, `style.css`, `controller.ts`, `tests/feedback.test.ts` (assertions inside existing block) |
| **weapons-armory** | `src/shared/types.ts`, `src/simulation/game.ts`, `src/server/index.ts` (snapshot field), tests inside existing blocks |
| **world-scene** | `scene.ts` (victory/defeat mood, optional `__ssMood` hook) |
| **qa-verifier** | `smoke-browser.mjs`, `QA-REPORT.md`, `qa/**` |
| **asset-forge / ruins-builder** | standby this cycle |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact mtime before handing a hash (cycle-11 lesson).
- **Perf acceptance cycle 12:** spawn TP calls **<290**, triangles **<2.15 M**; lore/recap are DOM-only.
- Report measured before/after + screenshots; defer if needed and say so.
