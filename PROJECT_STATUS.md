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
teammate edits after the Lead's gate, the hash changes and QA must be given the definitive artifact
(cycle 11: a post-freeze one-line `body.boss-siege` fix landed after the first gate build — the Lead
detected it, rebuilt deterministically, and handed QA the new hash; always re-check source mtimes vs
artifact mtime before handing a hash).

## Latest completed cycle — 2026-10N cycle 11: difficulty modes, boss presentation, balance sim

Contract: `docs/BATCH-2026-10N-SPEC.md`; results: `docs/BATCH-2026-10N-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-DuBFiyZ8.js` (927,007 B), deterministic across two builds
(rebuilt after the post-freeze `body.boss-siege` toggle fix).

### Difficulty modes (server-authoritative)

New `src/shared/difficulty.ts`: **Squire** (enemy dmg ×0.75, HP ×0.85, wave −2), **Knight** default
(×1/×1/0), **Warden** (dmg ×1.30, HP ×1.15, wave +2); player damage/stamina untouched. Room create
accepts validated `difficulty`; joiners inherit host's; unknown→Knight; restart preserves; snapshots
expose `game.difficulty`; multipliers applied at spawn (hostile HP incl. bosses), hurt (hostile
attacker) and siege wave sizing; `siege.bossHp` exposes actual boss HP (index-2: 204/240/276).
UI: landing picker (persisted `ss-difficulty`), HUD badge (`· HOST` for joiners), journal line,
`__ssDifficulty()` hook. Balance sim: Squire index-2 boss leaves ≥1 bot alive; Knight keeps the heavy
moment; Warden clearly hardest (+36 % dmg taken on index 1/2, +56 % final boss); all sieges resolved.

### Boss presentation

HUD `#bossSiegeBar` (banner/name "SHROUD WARDEN"/segmented HP/phase STEADY-FRENZIED-FINAL) visible
only during a living boss siege, hidden on death/resolve, legacy `#bossBar` suppressed, body class
`boss-siege` hides objectives/resources in portrait (the post-freeze one-line fix); mobile-safe,
reduced-motion safe, `__ssBossBar()`. World: boss actors 1.15× scale with crimson tint `#8f2a38` and
one additive ground aura ring `#b43a4a` (calm/static under reduced motion), hiding/restoring on death
or siege end; +1 draw only while active; `__ssBossVisual()`.

### QA gap closure + verification

Audio landmark beds polled up to ~3 s (headless 0; owner harness 0.024/0.016 → ear debt remains);
journal hotkey/Guide captures pass; forced normal-siege after boss deferred (server refuses while
active; owner tests cover); production SS_QA gate keeps force-siege inert live.

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-DuBFiyZ8.js` twice;
  `validate-assets` **82/82**.
- Fresh-build smoke **26/26** + hash proof, 0 errors/404s; perf **104/104** (spawn TP **183 calls /
  1,635,392 tris**, low 143/1.364 M), mobile **25/25**, co-op **21/21**, characters **103/105**
  (two harness-read failures fixed post-run, no character body gate failed), payload **17.54 MiB**.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 11 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-12 (next) — from the audit

1. Warden-mode forced-boss authoritative screenshot; near-forge/chapel audio ear check; forced
   normal-siege capture if a stop hook is added.
2. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
3. Content/campaign depth (more enemy variety, endgame content); further first-boss balance tuning
   from human play.

## Previous cycles

- **2026-10M cycle 10** (`docs/BATCH-2026-10M-RESULTS.md`): campaign journal + next-objective HUD,
  objective wayfinding overlay (0 WebGL draws), siege escalation with Shroud Warden bosses, QA
  force-siege path, audio focus ramp.
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
