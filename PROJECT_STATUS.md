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

## Cycle 15 (2026-10R) — armour atlas v5.1 + look-pass v5 (DEPLOYED)

Final bundle **`index-Dcbqu6dS.js`** (960,403 B). Contract `docs/BATCH-2026-10R-SPEC.md`, results
`docs/BATCH-2026-10R-RESULTS.md`. Roadmap milestone A (look & feel) progress.

### Armour atlas v5/v5.1 (asset-forge)
Coherent 4-band material atlas replaces the patchwork/debug-chip look: steel plates with stepped
panels/edge highlights/insets and **brass rivet rows**; dark leather straps with buckles/stitching;
clean faction cloth panels with seams/emblems; multi-tone brass trim. All debug chip knobs deleted so
the look can't regress. **Strict-mask palette 7/7 ≥560** (templar 1,311 · hero 987 · ally 1,214 ·
berserker 716 · ranger 802 · survivor 728 · fallen 777); torso means 79.9–92.4; files 718–746 KB;
tris/prims/skins/clips unchanged; validator 87/87. Backups in
`temp_sketchlab/backups/armour_v5_cycle15/` and `armour_v4_cycle14/`.

### Look-pass v5 (client `custom-character.ts`)
Armour grade sat 1.12/contrast 1.04, body-prim .95/1.03, cloth 1.15/1.04 (adaptive target 96); faction
multiply removed (`factionTint:'atlas'`); cloth atlas maps re-enabled opaque/DoubleSide; steel
metalness preserved; body-scan prims non-metal warm-tinted; rim .10/.14, env 1.5/1.3, roughness floors
.78/.82; great-helm/hood, opaque capes, neutral-steel companions, `transparentMaterials:[]` retained.
`__ssCharacterLook()` updated. In-game 2.5 m proof
`qa/char-viewer/shots/ingame-clean-{front-player,back-player,3p}.png`: helm+T-slit, coherent
steel/leather/red-cloth read, no patchwork/green/dots/translucent cape.
**Remaining gap:** body-scan limbs still pale at extreme close range → **cycle-16 body-atlas tone pass**
(asset-side, armour untouched).

### Capture debt closed
Warden forced-boss early screenshot HP 276 (`qa/warden-c15/siege-boss-early.png`); forced Screamer via
`__ssForceSiege(3)` (index3 wave10, Shroud Screamer hp72, stats.screamers 1, `screamer.png`); normal
forced siege after resolve (index1 boss false wave6).

### Verification
- 58/58 tests, tsc 0, deterministic `index-Dcbqu6dS.js` + freshness, validator 87/87.
- QA: fresh 27/27, characters 143/143, perf 139/139 (spawn **186 calls / 1,637,872 tris**), mobile
  26/26, co-op 22/22, live baseline 34/34; look gates 7/7 strict-mask, torso mean 90.65; payload
  **17.47 MiB**; night 51.12.

### Cycle-16 (next) — roadmap A completion → B start
1. **Body-scan body-atlas tone pass** (asset-side): warm/desaturate + slight value floor on base body
   colour atlas only, finish close-up limbs.
2. **Animation depth** (roadmap A): heavy-attack, dodge/step-back, death variants, idle fidgets,
   run speed matching (foot-slide), blend polish.
3. Audio ear check (human); physical-device/real-GPU/perceptual; hardware rumble.
4. Then roadmap B: enemy family #2 (ranged/hound) + second boss.

## Previous cycles

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
