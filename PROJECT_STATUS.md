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

## Latest completed cycle — 2026-10J cycle 7: enemy variety, palette cleared, content captures, a11y

Contract: `docs/BATCH-2026-10J-SPEC.md`; results: `docs/BATCH-2026-10J-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-BF93HyxO.js` (889,821 B), deterministic across two builds.

### Enemy variety — two new undead variants

- `zombie-bloated`: zombie 30-joint rig + 10 clips, 2 prims (10,000 + 620 rigid add-on), plague-bloated
  silhouette, 10,620 tris / 361 KB.
- `skeleton-armoured`: skeleton 51-joint rig + 9 clips, 2 prims (6,821 + 268 rigid helm/pauldrons/
  shield), 7,089 tris / 286 KB.
- `undeadVariant(a)` = `UNDEAD_ASSETS[idNumeric % 4]` (~25 % each variant per region, ~50 % bases);
  players/soldiers/corrupted unchanged. `characterAssetFallback` + `assets.ts` fallback degrade to
  base zombie/skeleton if a variant is missing; variants preload after playable.
- QA: `__ssEnemyVariants()` availability, in-world variant captures, distinct silhouettes
  (bloated 31.9/70.5 %, armoured 64.0/96.8 %), animations/grounding verified.

### Strict-mask armour palette — debt cleared (7/7 ≥500)

templar 561 · hero 526 · berserker 721 · ranger 651 · ally 694 · survivor 1,082 · fallen 937.
Fixes: ranger cloak base lightened out of 5-bit crush, hero luminance-separated plate chips/trim,
fallen brighter/larger patina-rust chips, plus a hero polish pass. Crop metric 7/7 (638–1033).

### Content captures + plague dressing

`scene.ts` passes `ruinsUpdate` a debug-only synthetic actor at the QA camera while `__ssQAView` is
active, so `content-altar`/`content-furnace-*` and a new `content-plague` pose render player-distance-
culled dressing; normal play culling unchanged. `__ssPerf().contentFocus` reports QA focus.
Plague nest (0,−664) dressed with existing assets only: 3 wall fragments, 2 braziers + flames,
4 candles, 8 graves, 6 stakes, 2 barrel clusters, corpse cart — 0 new draws/layers/lights, ≈86 k tris
only when visible (nest far beyond spawn far plane).

### Accessibility + controller settings

- Captions (CC): persisted off-by-default toggle, subtle HUD line for thunder, nearby undead, siege
  start/end, low health, castle captured; 2.2 s rate limit + priority interrupts; Sound-independent
  by design. Hooks `__ssCaptions()`, `__ssCaptionDemo(cue)`.
- Controller: deadzone presets (tight .10 / normal .18 / wide .28) + dedicated look sensitivity
  (0.4–2.0) persisted and applied through `readPad` (default path unchanged); hints/rumble guards
  intact. Hooks `__ssControllerSettings()`, extended `__ssPad()`.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-BF93HyxO.js` twice;
  `validate-assets` **80/80**.
- Fresh-build smoke **38/38** + hash proof, 0 errors/404s, 10 cards, WS 1/0; night 53.7 forced-clear.
- Perf **213 calls / 1,735,988 tris** (gates <290/<2.15 M); FP 165/1.62 M; low 164/1.42 M; payload
  **17.02 MiB**; HUD click→HUD 157 ms / state 1.28 s / join 3.35 s.
- Characters **58/58**, perf **60/60**, co-op **18/18**, live baseline **26/26**.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 7 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-8 (next) — from the audit

1. Zombie-bloated night tone (lever: additive belly albedo level); enemy QA framing/spawn hook.
2. Physical controller rumble / real-hardware gamepad test; surface-audio ear check.
3. Real-GPU/perceptual playtests and mobile support.
4. Content depth: campaign/siege objectives polish, balance, more enemy types/props from warehouse.

## Previous cycles

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
