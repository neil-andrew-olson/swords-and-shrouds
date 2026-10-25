# Swords & Shrouds — Iteration cycle 2026-10P (AAA loop, cycle 13)

Cycle 12 (`docs/BATCH-2026-10O-RESULTS.md`) shipped the chronicle, run recap, Screamer and
victory/defeat mood at 183 calls / 1.64 M tris. Cycle 13 is a **content + combat variety** cycle:
new world props/landmark dressing from the warehouse, richer siege audio (new layers + stings), a
**shield bash** combat action for gameplay depth, and closure of the deferred capture debt.
Standing gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. World content: camp/village props + landmark dressing
- Bake **2–3 new props** from the warehouse (candidates: notice/quest board, hay wagon, wooden
  fence segment, torch post, shrine/waystone) at ≤3,000 tris each, embedded 512² night textures,
  ground-centred, gzip; place them as instanced dressing at camps/villages/roads with validated
  clearances (or a second Green March landmark if the silhouette is strong).
- Acceptance: props render in captures, grounded/clearanced, **0 new lights**, instanced
  (no draw explosion, ≤+2 draws), 0 404s; screenshots.

### 2. Audio depth: siege boss layer, Screamer cue, ending stings
- Add new synthesized audio content: (a) a **boss-siege music layer** that intensifies during boss
  sieges and releases afterwards, (b) a distinct **screamer shriek cue** tied to the server event,
  (c) short **victory and defeat stings** on the recap moment. Expose the new layers in
  `__ssAudioState()` for deterministic QA verification (levels/mode).
- Acceptance: QA verifies layer states via the hook (forced boss siege/screamer event/setMood/recap),
  no sound-crashes, captions unaffected, 58 tests kept, perf unaffected.

### 3. Combat variety: shield bash
- Server-authoritative **shield bash** action: only with a shield-capable weapon; costs stamina,
  short cooldown; small damage (or 0) + **stagger/windup interrupt** + short knockback on the hit
  target; cannot hit through walls; works in co-op; deterministic tests; balances as a defensive
  tool (not a DPS replacement).
- Client: input (e.g. hold block + attack, or a dedicated key/button with HUD hint), animation from
  the existing clip set, FX/caption, HUD/controls legend updated, mobile button added if sensible.
- Acceptance: server tests for gating/stamina/cooldown/stagger/wall checks; co-op sync; QA
  verifies in-world bash (stagger frame/state), HUD hint, existing attacks unchanged.

### 4. Deferred QA captures
- Warden-mode forced boss screenshot; forced Screamer capture (`__ssForceSiege(3)` spawns one per the
  cycle-12 rule); normal forced-siege after resolve if a cleanup path exists; audio layer checks now
  deterministic via the new audio-state fields.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (2–3 props), bake scripts, validator, ASSET-PIPELINE |
| **ruins-builder** | `ruins.ts` (prop/landmark placement + QA poses) |
| **audio-polish** | `ambience.ts`, `main.ts`, `style.css`, `controller.ts` (audio content + bash input/HUD), tests inside existing block |
| **weapons-armory** | `src/simulation/game.ts`, `src/shared/types.ts`, client `equipment.ts`/`custom-character.ts` if needed, tests inside existing blocks |
| **qa-verifier** | `smoke-browser.mjs`, `QA-REPORT.md`, `qa/**` |
| **world-scene** | standby (or tiny FX support for bash/stings if needed) |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact before handing a hash.
- **Perf acceptance cycle 13:** spawn TP calls **<290**, triangles **<2.15 M**; props instanced,
  audio layers allocation-free.
- Report measured before/after + screenshots; defer if needed and say so.
- **Bash protocol (Lead-suggested unless weapons-armory proposes better):** action `'bash'` with
  shield-capable weapon only, stamina ~14, cooldown ~1.1 s, damage ~6 + stagger 0.9 s + 1.2 m
  knockback on a single target in front within ~2.2 m, wall-checked; server validates; client sends
  `{type:'bash'}` on block+attack chord.
