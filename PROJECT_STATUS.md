# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep iterating to AAA quality

The user asked to keep cycling improvements until the game is AAA level. Every cycle: fix visible
defects, raise visual fidelity and performance, verify with the headless QA suite, deploy and
verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke + perf capture +
co-op 18/18 + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys
and verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. If a
teammate edits after the Lead's gate, the hash changes and QA must be given the definitive artifact.

## Latest completed cycle — 2026-10M cycle 10: campaign journal, wayfinding, siege bosses

Contract: `docs/BATCH-2026-10M-SPEC.md`; results: `docs/BATCH-2026-10M-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-DTiDZ99w.js` (918,844 B), deterministic across two builds.

### Campaign journal + objectives UI

Modal `#journal` (aria-labelled) opened from HUD Journal button/Guide/hotkey J; 7 live sections
(castles+regions, survivors/camps, nest status, sieges, weapon stats, input-aware controls, tips);
scrollable/safe-area desktop+mobile; pauses input Guide-style and wired into every menu/caption gate
so multiplayer input never desyncs. Next-objective HUD line `#objectiveLine` with direction+distance
(active/imminent siege → nearest hostile castle → survivors → nest → all-clear), HUD cadence from
pure helpers (`deriveObjectiveLine`, `deriveJournalSummary`, `compassBearing`, tested inside the
existing 58th-block structure).

### Objective wayfinding

Pooled 14-marker DOM overlay `#ss-objectives .ss-obj` (0 WebGL draws): survivors/camps gold, hostile
castles red, friendly castles cyan, nest magenta, current objective "NEXT · …"; distance labels,
distance-sorted cap, behind-camera suppression; tier caps 5/9/14 markers, 110/170/240 m; pulse CSS
disabled under reduced motion. `__ssObjectives()` structured hook.

### Siege escalation + boss encounters (server)

`Siege` fields boss/bossName/bossHp/bossId/bossKilled/bossRewarded/index/waveSize, `Actor.boss`.
Every 2nd siege and index ≥9 spawns corrupted **Shroud Warden** (HP 240→280 by index, damage 30/28
first, windup .95, cd 2.2, chase 2.9), wave `min(14, 6+2·sieges+2·(players−1)+boss)`, boss-kill
rewards +10 wood/+5 iron/+1 medicine once; events/toast/caption announce the boss. QA-only
`SS_QA=1` force path: `{type:'qa-siege'}` auto-marks castle[0] friendly via
`qaEnsureFriendlyCastle` (no capture rewards/counters) then normal creation; client
`__ssForceSiege(index?)`. Balance sim: normal siege repelled 9.9 s; first boss (index2) 28.1 s castle
held but both non-blocking bots downed (accepted heavy first-boss moment — cycle-11 human-playtest
note); final boss (index9) 32.6 s both alive.

### Audio QA

`__ssAudioFocus(x,z)` fast-forwards chapel/forge landmark-bed ramps (0.024/0.016 ≈220 ms) and
restores smoothing on null; `__ssAudioState()` reports deterministic internal bed targets. Headless
long-window poll/ear check remains human debt.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-DTiDZ99w.js` twice;
  `validate-assets` **82/82**.
- Fresh-build smoke **26/26** + hash proof, 0 errors/404s; characters **93/93**, perf **98/98**,
  mobile **25/25**, co-op **18/18**, 11 cards.
- Perf spawn TP **183 calls / 1,635,288 tris** (<290/<2.15 M; low 143/1.36 M), payload
  **17.52 MiB**; journal 7/7 sections, wayfinding 6 markers/2+ types, forced boss siege verified.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 10 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-11 (next) — from the audit

1. Near-forge/chapel audio-level ear check (longer headless window); normal forced-siege no-boss
   live capture; journal hotkey/Guide-open capture in QA script.
2. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble.
3. Balance: first-boss heavy-moment tuning via human playtest (e.g. wave-2 bias for index 2); more
   enemy variety; content/campaign depth.

## Previous cycles

- **2026-10L cycle 9** (`docs/BATCH-2026-10L-RESULTS.md`): War Spear (11th weapon) + rackPool drops,
  ruined abbey landmark, hit-flash hold, weapon QA hooks, audio diagnostics.
- **2026-10K cycle 8** (`docs/BATCH-2026-10K-RESULTS.md`): mobile/touch HUD + analog stick,
  device-aware quality/DPR, enemy preview hook, per-hit flash/stagger/impact feedback, nest decals.
- **2026-10J cycle 7** (`docs/BATCH-2026-10J-RESULTS.md`): enemy variants (bloated/armoured),
  strict-mask palette cleared 7/7, QA content-capture culling, plague dressing, a11y captions.
- **2026-10I cycle 6** (`docs/BATCH-2026-10I-RESULTS.md`): Wandering Survivor sixth appearance,
  controller rumble/hints, reduced-motion vignette fix, cloth-wind isolation, altar candle glows.
- **2026-10H cycle 5** (`docs/BATCH-2026-10H-RESULTS.md`): armour art v3 + survivor identity, cloth
  wind, dense snowstorms, combat feel, altar/forge content, surface audio.
- **2026-10G cycle 4** (`docs/BATCH-2026-10G-RESULTS.md`): armour v2, dynamic regional weather +
  weather audio, tone/HUD fixes, wells/stalls.
- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity, warehouse foliage +
  landmark ruins, elite undead, fire/smoke sprites, region audio.
- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2, quantised-ruin fix,
  trees/shadows, keep atlas, adaptive audio.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters, restored
  shadows, 301→173 calls, LODs, working doc links.
- **2026-10C / 2026-10B / 2026-10** earlier batches: performance & smoothness (43.5→9.47 MB payload,
  88,544→301 calls), readability/combat/arsenal/co-op QA, battlefield overhaul; asset pipeline +
  attribution in `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; `scripts/build-game.mjs` fetches the pinned commit, `npm ci`, builds the client
  under `/games/swords-and-shrouds/`. Cloudflare Workers Builds deploys on push.
- Build locally with bundled Node v24.21.0
  (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`; prepend its
  dir to PATH), then `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
  in the hosting repo. System Node 22.11 is below Vite 7's floor.
- Because the hosting build can leave `.game-build` in detached HEAD, always `git checkout main`
  (and fast-forward `main`) before committing docs.

## Continuity procedure

After each cycle, commit the changes and update this file with: the exact implementation commit,
branch and changed behavior; the checks actually run and their results; remaining defects and the
next concrete task; and hosting pin / deployment status, keeping source and live verification
separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
