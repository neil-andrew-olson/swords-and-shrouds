# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep iterating to AAA quality

The user asked to keep cycling improvements until the game is AAA level. Every cycle: fix visible
defects, raise visual fidelity and performance, verify with the headless QA suite, deploy and
verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke 16+/16 + perf capture +
co-op 18/18 + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys
and verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures.

## Latest completed cycle — 2026-10G cycle 4: armour v2, weather systems, tone/HUD fixes

Contract: `docs/BATCH-2026-10G-SPEC.md`; results: `docs/BATCH-2026-10G-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `dist/client/assets/index-CZ8DITNA.js` (861,937 B), reproduced by a
fresh build.

### Character / armour identity v2

All 7 player/companion bodies now have distinct full armour silhouettes as extra skinned prims on the
existing Mixamo rigs (single skin, 6 clips, hand sockets; body/anim data hash-identical):
templar great-helm+cuirass+tabard, hero visored helm+knight cuirass, ally helm+tabard, berserker
horned helm+fur shoulders, ranger hood+cloak+quiver, survivor ragged cloak+pack, fallen crest helm+
spiked plate. `<body>_plate`/`<body>_cloth` prims with 512 albedo + 256 normal/ORM maps; runtime
plate/cloth tone split. 8,749–9,388 tris/body, 652.8–687.8 KB. QA: 7/7 distinct 10 m silhouettes,
body-mask torso mean 85.7 / p50 71.3, close-up body-mask colours 607–874 (gate ≥300), clip 0 %.

### Dynamic regional weather

180–330 s phase machines with pooled quality-tiered particles:
- Green March clear → light-rain → downpour (228→550 rain streaks, splashes, wet-road sheen,
  lightning + delayed thunder);
- Ashen Moor calm → ashfall → haze (4→14 ash/haze banks, embers, gusts);
- Frozen Crown clear → snow → snowstorm (pooled snow, fog +0.0045×intensity, gusts).
`__ssWeather()` / `__ssSetWeather(region,phase,intensity)` + `ss-weather|ss-lightning|ss-thunder`
window events drive weather-reactive audio (rain beds/plips/thunder, snow hush/howl, ash hiss/groans,
under-cover muffling). Low tier = zero weather particles while state still publishes.

### Tone / framing / night mood / HUD

- Foliage desaturated (leaves HSL sat ×0.8 / light ×0.86; maple sat ×0.42, share 55 %→35 %).
- `region-crown` camera moved out of the canopy; night mood verified (spawn TP canvas mean 51.6–60.9).
- Software renderers default to LOW quality (unless user saved a choice) with a tier exposure bias so
  night still reads; high tier keeps cycle-3 lighting.
- `__ssLoadTimings()` marks + click→HUD **158 ms**, click→state **1,505 ms**, join **3.40 s**;
  nav→HUD 17.84 s is QA landing idle, documented. Real-GPU async shader warmup engages where
  `KHR_parallel_shader_compile` exists (SwiftShader can't).

### New content

`stone_well` (warehouse scan) ×6 in courtyards/camps; `blacksmith_stall` ×2 (procedural forge) at the
Green village landmark + camp with barrel/crate dressing; +4 instanced draws, ~52 k tris map-wide.

### Verification (final build)

- `npm test` **58/58**; `tsc` 0; clean build reproduced `index-CZ8DITNA.js`; `validate-assets` **76/76**.
- Perf spawn TP **206 calls / 1,708,376 tris** (gates <260 / <1.95 M); FP 160 / 1.59 M; low 160 /
  1.40 M; payload **15.76 MB**. QA: armour+elite 27/27, weather pass (crown snow density weak),
  tone/framing pass, perf 34/34, fresh-build 17/17 + hash proof, co-op 18/18, live baseline 18/18.
- **Debts:** armour plate art richness (1024 atlas, triplanar UVs, sculpted detail), crown snowstorm
  density/visibility, `__ssPreviewBody` synthetic-body framing bug, survivor identity, region-crown
  camera sits in the moor↔crown blend band, real-GPU/perceptual/controller/mobile playtests.

### Cycle-5 (next) — from the audit

1. Armour art pass: 1024 atlas for low-variety bodies, hue-separated patina/trim, world-scale/triplanar
   plate UVs, better plate silhouettes; survivor-specific rig identity.
2. Frozen Crown snowstorm density + snow particle counter; weather polish.
3. Fix `__ssPreviewBody` framing hook; region-crown pose fully inside crown.
4. Combat/content depth: more enemy variety (warehouse models), siege/campaign objectives polish.
5. Real-GPU profiling, controller/mobile support, perceptual audio pass.

## Previous cycles

- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity (fog/grading/foliage/
  decals), warehouse card foliage + landmark ruins, elite undead, fire/smoke sprites, region audio,
  loading rework; 195 calls / 1.667 M tris.
- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2 (normal/ORM maps,
  silhouettes), quantised-ruin geometry fix, near/far trees, tent/wall shadows, atmosphere, keep
  atlas merge (45→9 draws), adaptive audio.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters (UV0 rebuild
  + baked atlases + rim), restored shadows, 301→173 draw calls, tree & tower LODs, doc-link fix.
- **2026-10C performance & smoothness** (`docs/BATCH-2026-10C-RESULTS.md`): payload 43.5→9.47 MB,
  draw calls 88,544→301, triangles 4.04 M→1.76 M, quality tiers, progressive loading.
- **2026-10B readability/combat/arsenal/co-op QA** (`docs/BATCH-2026-10B-RESULTS.md`) and the
  **2026-10 objectives 1–5 battlefield overhaul** (`docs/BATCH-2026-10-RESULTS.md`); asset pipeline +
  attribution in `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; `scripts/build-game.mjs` fetches the pinned commit, `npm ci`, builds the
  client under `/games/swords-and-shrouds/`. Cloudflare Workers Builds deploys on push.
- Build locally with bundled Node v24.21.0
  (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`; prepend its
  dir to PATH), then `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
  in the hosting repo. System Node 22.11 is below Vite 7's floor.
- Local play: `$env:PORT=3000; node --import tsx src/server/index.ts` from the game repo (serves
  `dist/client` at http://localhost:3000/). Because the hosting build can leave `.game-build` in
  detached HEAD, always `git checkout main` (and fast-forward `main`) before committing docs.
- Cycle-4 deployment: see commit history (`feat: AAA cycle 4 …` then hosting pin commit).

## Continuity procedure

After each cycle, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and the next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
