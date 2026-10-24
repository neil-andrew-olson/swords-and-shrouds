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

## Latest completed cycle — 2026-10L cycle 9: War Spear, ruined abbey, hit-hold, audio diagnostics

Contract: `docs/BATCH-2026-10L-SPEC.md`; results: `docs/BATCH-2026-10L-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-2keD53-A.js` (901,729 B), deterministic across two builds.

### New weapon — War Spear (11th)

`spear` asset 504 tris/44.1 KB, canonical polearm orientation (grip origin, +Y shaft, length 2.200);
`WEAPONS.spear` damage 32, reach 5.6 (longest), cooldown 0.7, stamina 20, arc 0.16, length 2.2,
shield allowed, thrust style; grip `{grip:[0,0,0],blade:[0,1,0]}`. Drops now use a generic
`rackPool` in `src/simulation/game.ts` (Lead-approved): 9 castle racks cover all non-starter weapons
exactly once — keep=bastard, border=poleaxe, citadel=zweihander, moor-keep=rapier, moor-border=halberd,
**moor-citadel=spear (−29,−371)**, crown-keep=dane axe, crown-border=flamberge, crown-citadel=mace;
starter hammer unchanged. QA verified 11 armory cards, spear stats/reach, drops mapping and the
third-person spear+shield grip (server-authoritative equip needs rack ownership — capture debt).

### New landmark — ruined abbey

`abbey_ruin` 13,786 tris/406.8 KB from the warehouse `overgrown-courtyard-patio-ruin` scan
(1,024² night texture, ground-centred, 7.411 × 5.000 × 7.390 m). Placed as second Green March
landmark at **(62, −46)** yaw 0.6 h6.5 between the village landmark and border fortress; one
distance-culled instanced layer (+1 draw/13.8 k tris only when visible), receive-only shadows,
validated clearances, spawn culled at 95.8 m. QA captured via `__ssQAPose` + QA-focus culling.

### Verification hooks / audio diagnostics

- `__ssSetHitFeedbackHold(true|false|null)` re-arms per-hit enemy flash/stagger for slow-frame QA
  stills; disable restores normal decay with no emissive leak (QA: flash held >1.2 s, frame diff
  9.66–10.97 / 22.8–26.4 %, then all false).
- `__ssWeaponReadiness()`, `__ssWeaponState()`, `__ssEquipWeapon(id,{preview})` QA hooks.
- `__ssAudioState()` (beds/levels/weather/captions/master) + `__ssAudioFocus(x,z)` for landmark-bed
  verification; QA verified march bed/clear→downpour intensity and rain bed; near-forge ramp remains
  a human ear/debt item.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-2keD53-A.js` twice;
  `validate-assets` **82/82**.
- Fresh-build smoke **26/26** + hash proof, 0 errors/404s; characters **81/81**, perf **85/85**,
  mobile **22/22**, co-op **18/18**, 11 cards.
- Perf spawn TP **186 calls / 1,640,130 tris** (gates <290/<2.15 M; abbey culled), FP 152/1.555 M,
  low 145/1.366 M; payload **17.51 MiB**; HUD click→HUD 158 ms / state 3.945 s / join 3.139 s.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 9 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-10 (next) — from the audit

1. Near-forge audio-level ear check; physical-device mobile / real-GPU / perceptual playtests;
   hardware controller rumble test.
2. Server-authoritative spear equip capture (needs rack ownership) — QA/session task.
3. Content/campaign depth: siege/campaign objectives polish, balance pass, more enemy types/props.
4. Optional named `content-abbey` QA view in scene.ts (pose exists in ruins.ts).

## Previous cycles

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
