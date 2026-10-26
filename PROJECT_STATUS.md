# Swords & Shrouds — project checkpoint

Updated: 2026-10-25. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep looping toward AAA

The user asked to keep cycling improvements until the game is AAA level, using
`docs/AAA-ROADMAP.md` as the guide. Every cycle: fix visible defects, raise visual fidelity and
performance, verify with the headless QA suite, deploy and verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke + perf capture +
co-op + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys and
verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths. `PROJECT_STATUS.md`,
`docs/*.md` (incl. `docs/AAA-ROADMAP.md`) and screenshots are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. **Always**
re-check source mtimes vs the artifact mtime before handing a hash, and rebuild twice with
`node_modules/.vite` cleared (cycle-11/13/14/18 lessons: post-freeze edits and races produced
superseded artifacts — only gate a hash a clean rebuild reproduces).

## Cycle 19 (2026-10V) — Shroud Colossus second boss (DEPLOYING)

Final bundle **`index-tknOtxLM.js`** (998,421 B). Contract `docs/BATCH-2026-10V-SPEC.md`, results
`docs/BATCH-2026-10V-RESULTS.md`. Roadmap milestone B.

### Shroud Colossus (distinct second boss, server-authoritative)
- Alternation documented: Colossus when boss siege `index%4===0` (4, 8, 12), Warden otherwise;
  `siege.bossKind/bossName/bossPhase/bossHp` exposed. HP **420** difficulty-scaled, heavy armour,
  speed 2.2, `colossus:true`.
- **Ground slam**: 1.4 s telegraph at `slamTarget` (0.95 s phase 3, event
  `The Shroud Colossus raises its fist!`) → **radius 5.5 / 34 dmg**, wall-checked (stone event),
  impact event `The Colossus splinters the earth!`.
- **Corruption pools**: `game.hazards[]` `{id,x,z,radius:4.5,expiresAt:+12 s,damagePerSecond:6}`,
  max 6, co-op synced, pooled dark-violet decals with slow pulse (static reduced-motion).
- **Phases**: p2 ≤66 % (`The Shroud Colossus roars — its hide splits!`) faster cadence + summons
  2 Stalkers once; p3 ≤33 % (`The Shroud Colossus cracks the earth — no mercy remains!`) speed 2.8,
  shorter telegraph, occasional double slam; one-shot guards; counters `stats.colossi/slams/pools`.
- Presentation: 1.6× scale, violet-green aura `#5f9f7f` → phase-3 `#6a4a9a`, rig tint
  `#4f7a5f` → `#5f3f7a`; HUD bar per-boss name/phase (FRENZIED); `__ssBossVisual()` reports scale/phase.
- Hooks `__ssColossus/__ssHazards/__ssColossusFx/__ssTriggerColossusFx`; audio cues
  `colossusChargeAt/SlamAt/PhaseAt` + captions; sims index4 78 s (castle held, 5 slams/5 pools),
  index8 59.8 s, index12 82.6 s — all winnable.

### Fixes from cycle-18 review
- **HUD boss-bar overlap**: `#bossSiegeBar` z-index 10000 above wayfinding markers, backdrop,
  non-wrapping phase-coloured FRENZIED/FINAL label; `#siege`/`#objectiveLine`/marker layer suppressed
  during boss sieges; desktop 520×79 and mobile 340×71 verified.
- **Teal-quad artifact**: caused by flat cloth planes (captured castle flag + courtyard banner cloth),
  not aura geometry — flags now use a generated heraldic cloth texture at y 4.35 and banner cloth is
  muted/roughened; banners read as cloth.

### Verification
- 58/58 tests; tsc 0; deterministic `index-tknOtxLM.js` + freshness; validator 87/87.
- QA: fresh smoke 27/27, characters **117/118**, perf **163/164** (both one death-induced
  controller-hints timing + post-death timeout; all new gates green), mobile 26/26, co-op 22/22,
  live baseline 34/34; spawn **187 calls / 1,646,274 tris** (high sample), payload **17.54 MiB**;
  night 55.65; Colossus hooks/trigger stills/pools/phase evidence owner-verified on this exact dist.
- Deferred (documented): QA forced Colossus phase2/3 + slam happy-path stills (owner in-game
  evidence), boss-bar DOM sampled outside an active event (owner screenshots), audio landmark ear
  check, physical-device/real-GPU/perceptual, hardware rumble.

### Cycle-20 (next) — roadmap C
1. **Progression/meta systems**: weapon/armour upgrade tiers at camps, crafting/resource sinks,
   cross-run unlocks (meta progression), New Game+ modifier.
2. Close capture gaps with a clean harness sequence (forced-phase helper if useful).
3. Human/device debts; continued world/content polish.

## Previous cycles

- **2026-10U cycle 18**: Shroud Stalker flanking harasser + two-phase Warden (enrage, FRENZIED,
  adds) + production-safe QA force-enrage (`docs/BATCH-2026-10U-RESULTS.md`).
- **2026-10T cycle 17**: sprint foot-slide recalibration + Shroud Caster ranged enemy
  (`docs/BATCH-2026-10T-RESULTS.md`).
- **2026-10S cycle 16**: body-atlas tone pass, animation-depth pass, movement VFX
  (`docs/BATCH-2026-10S-RESULTS.md`).
- **2026-10R cycle 15**: armour atlas v5.1 + look-pass v5; Warden/Screamer capture debt closed
  (`docs/BATCH-2026-10R-RESULTS.md`).
- **2026-10Q cycle 14**: windmill/sails, torch-lit roads/ambience; character look hotfix; AAA roadmap
  (`docs/BATCH-2026-10Q-RESULTS.md`).
- **2026-10P cycle 13**: camp props, siege audio layers/stings, shield bash
  (`docs/BATCH-2026-10P-RESULTS.md`).
- **2026-10O cycle 12**: chronicle lore, recap+epilogue, Screamer, victory/defeat mood
  (`docs/BATCH-2026-10O-RESULTS.md`).
- **2026-10N cycle 11**: difficulty modes, boss HP bar + aura/scale/tint, balance sims
  (`docs/BATCH-2026-10N-RESULTS.md`).
- **2026-10M cycle 10**: campaign journal, wayfinding overlay, siege bosses, QA force-siege
  (`docs/BATCH-2026-10M-RESULTS.md`).
- **2026-10L cycle 9**: War Spear (11th), ruined abbey, hit-flash hold, audio diagnostics
  (`docs/BATCH-2026-10L-RESULTS.md`).
- **2026-10K cycle 8**: mobile/touch HUD, device-aware quality, enemy preview, hit feedback
  (`docs/BATCH-2026-10K-RESULTS.md`).
- **2026-10J cycle 7**: enemy variants, strict-mask palette 7/7, content captures, plague dressing
  (`docs/BATCH-2026-10J-RESULTS.md`).
- **2026-10I cycle 6**: Wandering Survivor, rumble/hints, reduced-motion fix, cloth wind
  (`docs/BATCH-2026-10I-RESULTS.md`).
- **2026-10H cycle 5**: armour v3 + survivor identity, snowstorms, combat feel, surface audio
  (`docs/BATCH-2026-10H-RESULTS.md`).
- **2026-10G cycle 4**: armour v2, weather + weather audio, tone/HUD, wells/stalls
  (`docs/BATCH-2026-10G-RESULTS.md`).
- **2026-10F cycle 3**: regional identity, foliage/ruins, elites, fire/smoke, region audio
  (`docs/BATCH-2026-10F-RESULTS.md`).
- **2026-10E cycle 2**: character material v2, quantised-ruin fix, trees/shadows, adaptive audio
  (`docs/BATCH-2026-10E-RESULTS.md`).
- **2026-10D cycle 1**: fixed blacked-out characters, shadows, 301→173 calls, LODs, doc links
  (`docs/BATCH-2026-10D-RESULTS.md`).
- Earlier batches: performance & smoothness, combat/arsenal/co-op QA, battlefield overhaul
  (`docs/BATCH-2026-10*-*`); asset pipeline in `docs/ASSET-PIPELINE.md`.

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
