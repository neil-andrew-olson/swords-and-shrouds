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

## Cycle 16 (2026-10S) — body tone, animation depth, movement VFX (DEPLOYED)

Final bundle **`index-BWKLWhO3.js`** (964,279 B). Contract `docs/BATCH-2026-10S-SPEC.md`, results
`docs/BATCH-2026-10S-RESULTS.md`. Roadmap milestone A complete except one gap (sprint foot-slide).

### Body-scan base-atlas tone pass
Base body colour atlas only: desat .74 / warm 1.10 / blue .85 / value .86 / floor .03; armour atlas
byte-identical to v5.1. Torso means 82.4–90.6, limbs now darker than torso (−11…−30 arms, −18…−23
legs), limb sat .29–.39; strict-mask 7/7 ≥801 (1246/982/1265/805/839/801/850); files ≤753 KB;
builder `scripts/bake/tone-body-atlas.mjs`; validator 87/87.

### Animation-depth pass (client)
`runTimeScaleFor` = clamp(speed/stride, .6–1.35) with slideFactor residual exposed (2→.600/.206,
4.2→1.0/0, 6→1.35/.058, **8→1.35/.411** — sprint-bound gap to fix in cycle 17: real run speed is 8,
so raise clamp to ~2.2/calibrate stride). Weapon-class attack timing tied to server cooldowns
(thrust→attack_1: sword windup 169 ms/.507 s; cleave/crush→attack_2: hammer 483/1.0925) with
anticipation lean/follow-through; idle breathing sway 3.2 s (reduced-motion suppressed); deterministic
±25° death variation per actor; landing crouch impulse >2.2 m/s decel; hooks `__ssAnimState`,
`__ssAnimActors`, `__ssDeathVariants`; pure helpers tested inside existing blocks.

### Movement VFX
Stride-based footstep dust (1.85 m stride, pooled, 26 m cull) + landing poofs (local player, bounded
against NPC network snaps), skipped under reduced motion, **0 extra draws**; `__ssMoveFx()` +
`__ssTriggerMoveFx`.

### Verification
- 58/58 tests; tsc 0; deterministic `index-BWKLWhO3.js` + freshness; validator 87/87.
- QA: fresh 27/27, characters **147/149** (2 harness-only death-timing samples; owner state
  evidence green), perf **149/150** (1 synthetic attack-input race; same run observed
  attack_1/thrust/169 ms), mobile 26/26, co-op 22/22, live baseline 34/34; body torso 88.8, limbs
  ≤ torso+3, strict-mask 7/7 ≥801; spawn **167 calls / 1,619,105 tris**; night 55.96.

### Cycle-17 (next) — roadmap A close-out → B
1. **Foot-slide recalibration** (clamp ~2.2 / stride calibration at real speed 8).
2. **Enemy family #2 (roadmap B): ranged corrupted with projectile AI + hound-style harasser**, with
   distinct telegraphs, spawn integration, co-op/tests and QA evidence.
3. Audio landmark ear check (human); physical-device/real-GPU/perceptual; hardware rumble.
4. Then second boss with phases/arena.

## Previous cycles

- **2026-10R cycle 15**: character armour atlas v5.1 (coherent steel/leather/cloth/trim, structured
  variety) + look-pass v5; Warden/Screamer capture debt closed (`docs/BATCH-2026-10R-RESULTS.md`).
- **2026-10Q cycle 14**: windmill + animated sails, torch-lit roads/torch ambience; character look
  hotfix (great-helm, steel tint, opaque capes, no green companion, distance-gated markers); AAA
  roadmap (`docs/BATCH-2026-10Q-RESULTS.md`).
- **2026-10P cycle 13**: camp props, siege audio layers/stings, shield bash, freshness process
  (`docs/BATCH-2026-10P-RESULTS.md`).
- **2026-10O cycle 12**: chronicle lore (16), run recap+epilogue, Screamer, victory/defeat mood
  (`docs/BATCH-2026-10O-RESULTS.md`).
- **2026-10N cycle 11**: difficulty modes, boss HP bar + aura/scale/tint, balance sims
  (`docs/BATCH-2026-10N-RESULTS.md`).
- **2026-10M cycle 10**: campaign journal, wayfinding overlay, siege bosses, QA force-siege
  (`docs/BATCH-2026-10M-RESULTS.md`).
- **2026-10L cycle 9**: War Spear (11th), ruined abbey, hit-flash hold, audio diagnostics
  (`docs/BATCH-2026-10L-RESULTS.md`).
- **2026-10K cycle 8**: mobile/touch HUD, device-aware quality, enemy preview, hit feedback
  (`docs/BATCH-2026-10K-RESULTS.md`).
- **2026-10J cycle 7**: enemy variants, strict-mask palette 7/7, content captures, plague dressing,
  a11y captions (`docs/BATCH-2026-10J-RESULTS.md`).
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
