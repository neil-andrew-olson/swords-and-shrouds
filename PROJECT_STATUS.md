# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep iterating to AAA quality

The user asked to keep cycling improvements until the game is AAA level. Every cycle: fix visible
defects, raise visual fidelity and performance, verify with the headless QA suite, deploy and
verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke 16/16 + perf capture +
co-op 18/18 + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys
and verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates must kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures.

## Latest completed cycle — 2026-10F cycle 3: regional identity, new content, foliage/fire fixes

Contract: `docs/BATCH-2026-10F-SPEC.md`; results: `docs/BATCH-2026-10F-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `dist/client/assets/index-j2KTUVMP.js` (840,799 B), reproduced by a
fresh build.

### Regional identity (QA's #1 gap)

Per-region atmosphere/grading with smooth border lerps and QA-camera-aware `__ssRegionInfo()`:
- Green March fog `#1e4038` d 0.0122, moon 2.7, exposure 1.55, sat 1.05 (pine/oak/maple, stones)
- Ashen Moor fog `#342d42` d 0.0208, moon 2.1, exposure 1.37, sat 0.82 (dead trees, chapel, ash)
- Frozen Crown fog `#6f93b0` d 0.0172, moon 2.55, exposure 1.62, sat 1.12 (snow pines, patches,
  watchtower)
QA numeric distinctness: pairwise RGB colour distance 9.36 / 31.5 / 32.2, luminance spread 15.1.
Ground decals (snow/ash/grass, feathered alpha, 72 m cull), region grass/tuft tint, snow flakes.

### New content

- Card foliage v2: `pine_v2` 1,272 tris, `snow_pine` 1,286, `oak_v2` 514, `maple` 514 (alpha-MASK
  leaf cards; one band for all distances; no LOD seam). Two bugs fixed: leaf alpha was mostly below
  the 0.42 MASK cutoff (re-baked near-binary alpha, 34–46 % coverage, pine +15 % brightness), and
  the client filter dropped leaf prims (`__ssPerf().landscape.treeDebug` proves bark+leaves render).
- Props: `dead_tree` 464 tris bark-only, `standing_stone` 63, `ice_shard` 108.
- Landmarks: `chapel_ruin` 13,810 tris, `watchtower_ruin` 9,817, `village_house_ruin` 2,475 —
  1 prim / 1 embedded 1024 night texture each, ground-centred. Placed one per region: Green village
  house + 8-stone circle **(56, −6)** (65 m from spawn), Ashen chapel **(−36, −228)**, Frozen
  watchtower **(−34, −472)** on an outcrop; scatter dead_tree ×12 / ice_shard ×12 / stones ×13.
- Elite undead: procedural tiered crowns/crests/shoulder spikes + eye glow (one rigid-skinned add-on
  per elite: 32/76/84 tris), eyes now render for shrouded undead; QA diff 31.1 luminance / 88.9 %.
- Fire/smoke: additive sprite flames (soft+core), pale additive smoke plume, embers; corruption
  decals feather-masked, nest-only.
- Audio: region-specific ambience layers with hysteresis and crossfades (Frozen wind/ice, Ashen
  ash/embers/bells, Green rustle/insects/birds) + per-region music tint; lazy build/teardown.
- QA additions: `__ssRegionInfo`, `landmark-*`, `foliage`, `corruption`, `wind` views,
  `__ssEliteUndeadIds/Info`, `landscape.treeDebug`, region-distinctness/wind/time-to-HUD gates.

### Verification (final build)

- `npm test` **58/58**; `tsc` 0; clean build reproduced `index-j2KTUVMP.js`; `validate-assets`
  **74/74**.
- Perf **195 calls / 1,666,828 tris** (gates <230 / <1.9 M); FP 153 / 1.55 M; low 153 / 1.36 M;
  payload 15.06 MB. Fresh-build smoke **16/16** + hash proof; co-op **18/18**.
- Visual re-verification: foliage canopies, soft moon, additive smoke, relocated landmark, decals,
  regional identity all confirmed fixed (no giant planes, no opaque smoke domes, no grey moon disc).
- **Debt (documented):** time-to-HUD still 18.5/17.1 s under SwiftShader (gate 15.0; landing improved
  3.56→3.28 s, join 3.84 s; high sample variance); character torso p50 102.4 vs 100 (mean 91.5,
  close-ups unchanged); green foliage reads bright/saturated; crown QA-view has a canopy over ~40 %
  of frame.

### Cycle-4 (next) — from the cycle-3 audit

1. **Time-to-HUD / real-GPU profiling**: shader compile/warmup, code splitting, defer HUD-only work,
   measure on a real GPU where possible; treat SwiftShader numbers with a variance band.
2. **Regional tone refinement**: reduce green-pine/maple saturation for night (or tint maple), tune
   crown QA camera framing.
3. **New character/armour models** from the warehouse (character variety is the largest remaining
   art gap), potentially one distinct armour set per archetype.
4. **Weather systems** (rain/snowstorm/fog banks as regional events), more structures/content, and
   richer combat/feedback polish.
5. **Character torso p50** marginal gate re-baseline + smoke/flame close-up inspection.

## Previous cycles

- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2 (normal/ORM maps,
  silhouettes), quantised-ruin geometry fix, near/far trees, tent/wall shadows, atmosphere, keep
  atlas merge (45→9 draws), adaptive audio; 169 calls / 1.66 M tris.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters (UV0 rebuild
  + baked atlases + rim), restored shadows, 301→173 draw calls / 1.76 M→1.50 M tris, tree & tower
  LODs, doc-link fix.
- **2026-10C performance & smoothness** (`docs/BATCH-2026-10C-RESULTS.md`): payload 43.5→9.47 MB,
  initial preload 12.2→4.71 MB, draw calls 88,544→301, triangles 4.04 M→1.76 M, quality tiers,
  progressive loading, tree/ruin instancing, prop atlas batching.
- **2026-10B readability/combat feel/arsenal/co-op QA** (`docs/BATCH-2026-10B-RESULTS.md`):
  night-sky fix, combat FX/trails, two new weapons (flamberge, mace — 10 total), camp tents and
  ruined walls, audio stingers, co-op test harness.
- **2026-10 objectives 1–5 battlefield overhaul** (`docs/BATCH-2026-10-RESULTS.md`): scanned
  road/cobblestone surfaces, ruins/modular keeps, 3 new weapons (rapier/halberd/dane axe), scatter,
  post-FX/atmosphere/audio. Asset pipeline + attribution in `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; `scripts/build-game.mjs` fetches the pinned commit, `npm ci`, builds the
  client under `/games/swords-and-shrouds/`. Cloudflare Workers Builds deploys on push.
- Build locally with bundled Node v24.21.0
  (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`; prepend its
  dir to PATH), then `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
  in the hosting repo. The system Node 22.11 is below Vite 7's floor.
- Local play: `$env:PORT=3000; node --import tsx src/server/index.ts` from the game repo (serves
  `dist/client` at http://localhost:3000/). Because the hosting build can leave `.game-build` in
  detached HEAD, always `git checkout main` (and fast-forward `main`) before committing docs.
- Cycle-3 deployment: see commit history (`feat: AAA cycle 3 …` then hosting pin commit).

## Continuity procedure

After each cycle, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and the next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
