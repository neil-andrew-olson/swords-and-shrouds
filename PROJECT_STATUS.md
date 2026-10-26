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
superseded artifacts — only gate a hash a clean rebuild reproduces; cycle 18 needed an emergency
rebuild after a last-minute scene fix, and the client hash legitimately repeated because server-only
code does not enter the client bundle).

## Cycle 18 (2026-10U) — Stalker + two-phase Warden (DEPLOYING)

Final bundle **`index-Bnc8c7Xv.js`** (986,604 B). Contract `docs/BATCH-2026-10U-SPEC.md`, results
`docs/BATCH-2026-10U-RESULTS.md`. Roadmap milestone B continues.

### Shroud Stalker (fast harasser, server-authoritative)
Kind corrupted `stalker:true`, HP 62, speed 5.2, existing undead rig: picks a player, orbits ~7.5 m
to side/back, **0.45 s telegraphed windup** (`A Shroud Stalker closes in!`), **0.32 s lunge dash**
(`Shroud Stalker lunges!`) for **18 dmg** wall-checked (`A Shroud Stalker rakes <name>!` on connect),
2.5 s cooldown, melee fallback; spawns 2 wilds + 2/siege index ≥3; counters `stats.stalkers`/
`stalkerLunges`; co-op synced. Presentation: pale green-violet tint + aura, pooled bright lunge-windup
ring (≤1 draw, static reduced-motion), 1.25 m-stride dust trail; hooks `__ssStalkers/__ssStalkerFx/
__ssTriggerStalkerFx`; lunge/hit cues + caption (corrected to server wording).

### Two-phase Shroud Warden
`actor.bossPhase`/`siege.bossPhase`; at ≤50 % HP **enrages once**: howl event, cadence up
(move 3.8 / windup .62 / cd 1.5), **summons 1 Screamer + 1 Caster once** (no dupe), co-op synced;
presentation aura ×1.35/opacity .62, crimson → violet-crimson `#7a2a5a` tint, embers, FRENZIED HUD,
`__ssBossVisual().phase`; enrage reverts on death. **QA-only force-enrage**: `qaForceEnrage()` +
2 s `SS_QA`-gated room timer drops a live boss to 45 % and runs the normal enrage; production-safe;
one-shot guard tested.

### Verification
- 58/58 tests; tsc 0; deterministic `index-Bnc8c7Xv.js` + freshness; validator 87/87.
- QA: fresh smoke **27/27**, characters **112/113** (one death-induced harness sample), perf
  **157/159** (2 fails = harness's forced siege rejected while a prior siege active; owner in-game
  phase-2 proof on this exact hash), mobile 26/26, co-op 22/22, live baseline 34/34; spawn
  **184 calls / 1,645,056 tris** (low 149/1,367,728); payload **17.53 MiB**; night 56.93.
- Deferred (documented): QA forced-enrage still (owner phase-2 proof exists), real stalker lunge
  still (owner forced run), audio landmark ear check, physical-device/real-GPU/perceptual, hardware
  rumble.

### Cycle-19 (next) — roadmap B
1. **Distinct second boss encounter** with its own arena/phases (nest-mother/bone-colossus style),
   reusing the multi-phase infrastructure.
2. Close harness capture gaps (clean enrage-still sequence).
3. Human/device debts; then roadmap C (progression/meta systems) and more world content.

## Previous cycles

- **2026-10T cycle 17**: sprint foot-slide recalibration (slideFactor 1.11e-16) + Shroud Caster ranged
  enemy with projectile AI/telegraph/FX/cues/captions (`docs/BATCH-2026-10T-RESULTS.md`).
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
