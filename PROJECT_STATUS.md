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
`node_modules/.vite` cleared (cycle-11/13/14 lessons: post-freeze edits and races produced superseded
artifacts — only gate a hash a clean rebuild reproduces).

## Cycle 17 (2026-10T) — foot-slide fix + Shroud Caster (DEPLOYED after live pass)

Final bundle **`index-EHFLh_ew.js`** (976,975 B). Contract `docs/BATCH-2026-10T-SPEC.md`, results
`docs/BATCH-2026-10T-RESULTS.md`. Roadmap A closed (foot-slide), milestone B started.

### Foot-slide recalibration
`ANIM_STRIDE` light 5.925 / heavy 5.08, clamp 0.6–1.6: helper table 4.2→.709/0, 6→1.013/0,
**8→1.350/slide 0** (real full speed), 10→1.600/.054; in-game `__ssAnimState()` slideFactor 1.11e-16;
movement speed unchanged.

### Shroud Caster (first ranged enemy, server-authoritative)
Kind corrupted `caster:true`, HP 88, 2 nest guards + 1 per siege index ≥2; LOS 10–20 m, 1.0 s
telegraph (`casterCharge` + `A Shroud Caster gathers shadow!`), speed-8.5 shadow bolt (16 dmg, 3 s
cooldown, lead prediction), `game.projectiles[]` with wall/actor/ground hits, co-op synced,
`stats.casters/casterBolts`; events gather/launch/strike/fizzle/scatter. Client: pooled InstancedMesh
telegraph ring (violet aura idle, pulsing charge, static under reduced motion, 1 draw), pooled bolt orb
+ additive trail (1 draw active), impact sparks/smoke + scorch; `__ssCasters/__ssProjectiles/
__ssCasterFx/__ssTriggerCasterFx`. Audio: charge/launch/impact synth cues + cue counts in
`__ssAudioState().cues`, captions "A Shroud Caster gathers shadow." / "Shadow bolt!",
`__ssCasterAudio`. Sim: index2 32.6 s/7 bolts, index5 37.1 s/8, index9 73.5 s/15, castle held.

### Verification
- 58/58 tests; tsc 0; deterministic `index-EHFLh_ew.js` + freshness; validator 87/87.
- QA: fresh 27/27, characters **108/109** (one death-induced harness sample; new gates green),
  perf **153/153** (spawn **158 calls / 1,622,187 tris**; high 188/1,646,952), mobile 26/26,
  co-op 22/22, live baseline 34/34; foot-slide pass; caster roster/FX/cues/captions pass; payload
  **17.52 MiB**; night 56.93.
- **Deferred (honest):** real forced-siege caster telegraph→bolt→hit stills (headless caster stayed
  out of LOS >30 s) — covered by tests/sim + deterministic FX trigger; also audio ear check,
  physical-device/real-GPU/perceptual, hardware rumble remain human/device debts.

### Cycle-18 (next) — roadmap B (spec already written: `docs/BATCH-2026-10U-SPEC.md`)
1. **Shroud Stalker** — fast flanking harasser (existing rig): circles 6–10 m, telegraphed lunge
   (~0.45 s), ~18 dmg, 2/siege index ≥3 + moor wilds, counters, co-op sync; FX/windup/trail,
   lunge cue + caption.
2. **Two-phase Shroud Warden** — enrage at ≤50 % HP (cadence up, aura intensifies, summons 2 adds
   once, event), HUD phase FRENZIED, co-op synced.
3. Cycle 19: fully distinct second boss (phases/arena).
4. Human/device debts: audio ear check, real-GPU/perceptual/mobile hardware, hardware rumble.

## Previous cycles

- **2026-10S cycle 16**: body-scan atlas tone, animation depth, movement VFX
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
