# Iteration cycle 2026-10M — Results (AAA loop, cycle 10)

Tenth cycle of the standing AAA loop. Cycle 9 (`docs/BATCH-2026-10L-RESULTS.md`) added the War Spear
and the ruined abbey at 186 calls / 1.64 M tris. Cycle 10 turns the game into a **legible campaign**:
a full campaign journal + next-objective HUD line, world wayfinding markers, and **siege boss
encounters** with escalation, plus QA hooks. Final bundle `index-DTiDZ99w.js` (918,844 B),
deterministic across two builds.

## 1. Campaign journal + objectives UI

- **Journal modal** (`#journal`, aria-labelled) opened from the HUD **Journal · J** button, the Guide,
  or hotkey J; closes via button/J/Esc/backdrop. Opening pauses input Guide-style and is wired into
  every pause/menu/caption gate so multiplayer input never desyncs.
- **7 live sections**: castles held /9 with per-region rows; survivors X/9 + camps secured; plague-nest
  status (sealed/vulnerable/HP); sieges survived + next siege countdown/active; current weapon with
  damage/reach/cooldown/stamina/shield; controls legend adapted to keyboard/controller/touch; five
  field-note tips. Scrollable, safe-area aware, desktop + mobile.
- **Next-objective HUD line** (`#objectiveLine`) with direction arrow + distance, priority
  active siege → imminent siege (≤120 s) → nearest hostile castle → survivors in the most-remaining
  region → plague nest → all-clear, updated at HUD cadence from pure helpers
  (`deriveObjectiveLine`, `deriveJournalSummary`, `compassBearing`, tested inside the existing block).
- QA: 7/7 sections live, preview stages 1/9→5/9→9/9 castles and 1→4→9 survivors, line
  "Free The Fallen Keep · 27 m", input paused while open, mobile portrait/landscape scrollable.

## 2. Objective wayfinding

- Pooled 14-marker DOM overlay (`#ss-objectives .ss-obj`) projected each frame with distance labels:
  survivors/camps gold, hostile castles red, friendly castles cyan, plague nest magenta, current
  objective gold "NEXT · …"; distance scaling, distance-sorted cap, behind-camera suppression;
  tier caps (low 5 ≤110 m / medium 9 ≤170 m / high 14 ≤240 m); subtle CSS pulse disabled under
  reduced motion. **0 additional WebGL draws.**
- QA: 6 visible markers/2+ types with metres, reduced motion strips pulse from all markers,
  `__ssObjectives()` structured hook verified.

## 3. Siege escalation + boss encounters (server-authoritative)

- New `Siege` state fields (`boss`, `bossName`, `bossHp`, `bossId`, `bossKilled`, `bossRewarded`,
  `index`, `waveSize`) and `Actor.boss`.
- **Every 2nd siege and index ≥9** spawns a corrupted **Shroud Warden** boss: HP 240 → 280 (by index),
  damage 30 (28 for the first hp-240 boss), windup 0.95 s / cooldown 2.2 s / chase 2.9 (heavier, slower
  than corrupted 24 / .65 / 1.65 / 3.6), counted as corrupted for every existing rule; wave size
  `min(14, 6 + 2·sieges + 2·(players−1) + boss)`; boss kill rewards +10 wood/+5 iron/+1 medicine once
  (guarded, no dupe); events/toast/caption announce "Shroud Warden leads the siege of X!".
- **QA-only force path (production-safe):** `{type:'qa-siege'}` accepted only with `SS_QA=1`; when no
  castle is friendly it first marks castle[0] friendly via `qaEnsureFriendlyCastle` (no capture
  rewards/counters), then runs the normal creation path; client `window.__ssForceSiege(index?)`.
- Balance sim (2 bots, no blocking/healing): normal siege repelled 9.9 s both alive; first boss
  (index 2, hp 240) repelled 28.1 s with castle held but both bots downed — Lead-accepted as a
  deliberate heavy first-boss moment (cycle-11 human-playtest tuning note); final boss (index 9)
  repelled 32.6 s both alive.
- QA (forced): index-2 siege shows `{boss:true, bossName:'Shroud Warden', bossHp:240, bossId, index:2,
  waveSize:9}`, boss actor corrupted hp 240, banner/caption; normal no-boss path covered by owner
  sim/multiplayer tests (refused while a siege is active); co-op boss sync verified.

## 4. Audio QA polish

- `__ssAudioFocus(x,z)` now fast-forwards chapel/forge landmark-bed ramps while set (owner measured
  0.024/0.016 within ~220 ms) and restores smoothing on `null`; `__ssAudioState()` reports
  deterministic internal bed targets. QA storm/weather path passed; headless landmark poll still
  needs the owner harness (human ear debt remains).

## 5. Verification (final artifact `index-DTiDZ99w.js`, 918,844 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| `validate-assets` | **82/82** |
| Fresh-build smoke | **26/26** + exact hash reproduction, 0 errors/404s |
| Characters/elite | **93/93** |
| Perf | **98/98** — spawn TP **183 calls / 1,635,288 tris**, low 143/1.36 M |
| Mobile | **25/25** (journal included) |
| Journal/objectives | 7/7 live sections, 3 line states, pause/close, mobile scroll |
| Wayfinding | 6 markers/2+ types, reduced-motion off, 0 extra draws |
| Siege boss | forced boss siege verified end-to-end; co-op sync; balance sim |
| Regression | co-op **18/18**, payload **17.52 MiB**, zero errors/404s, 11 cards |

## 6. Carried into cycle 11

1. Near-forge/chapel audio-level ear check (owner-measured; headless poll needs longer window).
2. Normal forced-siege no-boss live capture (refused while active in QA run; covered by owner tests).
3. Journal hotkey/Guide-open capture in QA script (wiring exists).
4. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble.
5. Balance: first-boss heavy moment tuning (wave-2 bias for index 2?) via human playtest; more enemy
   variety; content/campaign depth.
