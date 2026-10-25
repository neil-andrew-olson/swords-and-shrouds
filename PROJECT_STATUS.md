# Swords & Shrouds — project checkpoint

Updated: 2026-10-25. Read this file first when continuing in a new chat.
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
"File not found"). `PROJECT_STATUS.md`, `docs/*.md` (incl. `docs/AAA-ROADMAP.md`) and screenshots are
mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. **Always**
re-check source mtimes vs the artifact mtime before handing a hash, and rebuild twice with
`node_modules/.vite` cleared (cycle-11/13/14 lessons: post-freeze edits and races produced superseded
artifacts — only gate a hash a clean rebuild reproduces).

## Cycle 14 (2026-10Q) — landmark content + character look hotfix (DEPLOYED)

Final bundle **`index-DYb3SbYc.js`** (960,484 B). Contract `docs/BATCH-2026-10Q-SPEC.md`, results
`docs/BATCH-2026-10Q-RESULTS.md`; roadmap `docs/AAA-ROADMAP.md`.

### Character look hotfix (user-flagged)
- Overhead actor markers (white diamonds): size .13→.085, height 2.45→2.55, distance-gated >6 m, no
  marker for the local player, friendly .55/hostile .85/downed .9 opacity, bob only in normal motion;
  `__ssMarkers()` hook.
- Character look pass v4 in `custom-character.ts`: in-shader albedo grade (saturation 1.3, contrast
  1.08), rim .10 armour/.14 cloth/.12 body, env 1.5/1.3, roughness floors .68/.72, faction steel tint;
  **procedural great-helm** (252 tris, dome+faceplate+dark T-slit+neck guard, steel `#5c6470`) for all
  armoured humans, dark low cowl for ranger/survivor; all cloth forced opaque with deep faction cape
  colours (no translucent purple panel); companion soldiers forced neutral steel so no green
  "orb" artifact. `__ssCharacterLook()` hook for QA. Torso mean 88.0 (60–95 gate).
- Remaining art debt: baked atlases still patchwork/pale at extreme close range → **character atlas
  rebake v5** is cycle 15 priority.

### New content
- `windmill` (1,000 tris, 10 m) + `windmill_sails` (668 tris) at Green March (64,36): animated
  wind-scaled sails (stopped under reduced motion, +1 draw when visible, 85 m culling),
  `__ssWindmill()`; relocated to tree-free cell after occlusion review.
- `torch_post` ×8 on one instanced layer along the main roads (+1 draw, 1,216 tris), flame cones on
  the existing flames layer (no new lights); `TORCH_POSTS` exported; new torch-fire crackle ambience
  bed in `__ssAudioState().landmarkBeds.torches` (10 m radius, level 0.018 at post, QA-focus).

### Verification
- `npm test` 58/58; tsc 0; deterministic `index-DYb3SbYc.js` + source-freshness; validator **87/87**.
- QA: fresh **27/27**, characters **139/140** (one harness timing read, green in probe/perf),
  perf **137/137** (spawn **186 calls / 1,637,968 tris**), mobile **26/26**, co-op **22/22**,
  live baseline **34/34**; windmill angle delta 0.442–0.470 rad / reduced 0, torch bed 0.018/0,
  look/markers gates green; payload **17.74 MiB**; night 50.96.

### Deployed state
Live bundle is the hosting build of the cycle-14 commit sequence (`feat: AAA cycle 14 …` → hosting pin
→ Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-15 (next) — from the roadmap
1. **Character atlas rebake v5**: semantic armour/leather/skin/cloth regions, richer close-up detail;
   keep strict-mask palette + tone gates; in-game close-up proof.
2. Deferred captures: Warden forced-boss shot, forced Screamer via `__ssForceSiege(3)`, normal
   forced-siege after resolve.
3. Audio ear check (human); physical-device/real-GPU/perceptual playtests; hardware rumble.
4. Roadmap milestone B start: animation depth (heavy attack, dodge/step, death variants, foot-slide).

## Previous cycles

- **2026-10P cycle 13**: new camp props (notice board, fences), siege audio layers/stings, shield
  bash (server+client+FX), hash-freshness process (`docs/BATCH-2026-10P-RESULTS.md`).
- **2026-10O cycle 12**: chronicle lore (16), run recap+epilogue, Shroud Screamer, victory/defeat
  mood, difficulty snapshot fix (`docs/BATCH-2026-10O-RESULTS.md`).
- **2026-10N cycle 11**: difficulty modes (Squire/Knight/Warden), boss HP bar + aura/scale/tint,
  balance sims (`docs/BATCH-2026-10N-RESULTS.md`).
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
