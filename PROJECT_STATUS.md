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
co-op + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys and
verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. Re-check
source mtimes against the artifact mtime before handing a hash (cycle-11 lesson; QA now has an
explicit freshness gate). If a teammate edits after the Lead's gate, rebuild deterministically and
hand QA the new hash.

## Latest completed cycle — 2026-10O cycle 12: chronicle, recap, Screamer, victory/defeat mood

Contract: `docs/BATCH-2026-10O-SPEC.md`; results: `docs/BATCH-2026-10O-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-Do2oPJz3.js` (940,645 B), deterministic across two builds,
source-freshness gate passed (newest src 19:53:23 < artifact 19:57:14).

### Chronicle / lore

`src/shared/lore.ts`: 16 entries (regions, castles, survivors, nest, Shroud Warden, weapon lineages,
Warden difficulty, endings) with pure unlock conditions from campaign state; journal **Chronicle**
section (unlocked text + "Unrecorded" hints), single "New chronicle entry" toast per unlock, ids
persisted in `ss-lore` before the toast (no re-fire on reload), `__ssLore()` + display-only
`__ssLorePreview(early|mid|late)`; tests inside the existing feedback block.

### End-of-run recap

Victory/defeat `#runRecap`: 8 authoritative rows (time, castles, survivors, camps, sieges, bosses
felled, difficulty, weapon), outcome epilogue (victory hearths / defeat "The last fire fades."),
working "Begin again" restart, mobile-safe scrolling; pure tested `deriveRunRecap`/`formatRunTime`;
`__ssRecap()` / `__ssRecapPreview`. New stats: `stats.bossesSeen/bossesFelled/screamers/screams`.

### Shroud Screamer (server)

One per siege at index ≥3: corrupted, `screamer:true`, light armour, alternating fallen/
skeleton-armoured appearance (corrupted actors may now explicitly render skeleton-armoured), HP
72–90 by index (difficulty scaling applies), extra actor (wave size unchanged); first aggro fires
radius-32 noise + event once (`screamerAlerted`), counts as corrupted everywhere, co-op synced.

### Victory/defeat mood

Grade/fog/exposure-only blend: victory = gentle desaturation, warmer golden fog `#d9c089`, exposure
+0.07; defeat = colder muted grade, heavier fog +0.011, crimson-ash `#5a2a32`, exposure −0.14;
normal/restart fades back; reduced motion snaps with no oscillation (honours live media query);
`__ssMood()` / `__ssSetMood()`. No new draws/textures/lights.

### Verification debt

Difficulty snapshot now always emits explicit `difficulty` (`'knight'` default) — QA gate passes;
harness `bossReducedFx` scope bug fixed; source-vs-artifact freshness gate added and passing.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-Do2oPJz3.js` twice;
  `validate-assets` **82/82**.
- Fresh-build smoke **27/27** (incl. freshness) + exact hash, characters **115/115**, perf **114/114**
  (spawn TP **183 calls / 1,635,356 tris**), mobile **25/25**, co-op **22/22**, 11 cards, 0 errors/404s.
- Chronicle/recap/mood verified with deterministic hooks; payload ≈17.55 MiB.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 12 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-13 (next) — from the audit

1. Warden-mode-specific forced-boss authoritative screenshot; QA forced Screamer spawn/shriek
   capture and normal forced-siege-after-resolve (owner sim covers behaviour; may need a QA
   stop/cleanup hook).
2. Near-forge/chapel audio-level human ear check.
3. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
4. Further content/campaign depth and enemy variety.

## Previous cycles

- **2026-10N cycle 11** (`docs/BATCH-2026-10N-RESULTS.md`): server-authoritative difficulty modes
  (Squire/Knight/Warden), boss HP bar + world aura/scale/tint, balance sims, QA gap closure.
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
