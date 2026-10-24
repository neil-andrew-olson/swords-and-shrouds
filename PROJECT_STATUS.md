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
broad `taskkill /IM node.exe` — a broad cleanup killed QA's local server twice in cycle 2.

## Latest completed cycle — 2026-10E cycle 2: character fidelity, restored ruins, atmosphere

Contract: `docs/BATCH-2026-10E-SPEC.md`; results: `docs/BATCH-2026-10E-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `dist/client/assets/index-BfnriryF.js` (815,540 B), reproduced by
a fresh build.

### Characters (top priority)

- Material v2: all 7 bodies re-baked with night tone (albedo 0.84× cycle 1, adaptive tint target 84
  sRGB), procedural detail (plate seams/rivets, chainmail micro-relief, cloth weave, leather grain,
  heraldic bands, wear) + embedded 512 normal and 512 packed ORM (AO/rough/metal) maps; geometry,
  skin, bones and 12 clips hash-identical; 591–621 KB each, preload ≈6.0 MB.
- Distinct silhouettes: pauldrons (hero/templar/ally/berserker), hood+cape (ranger/survivor),
  crest+horns (fallen) as one rigid-skinned add-on primitive each in the same single skin;
  8,653–8,873 tris per body.
- Runtime: metalness ≤0.35 / roughness ≥0.65 / envMapIntensity ≥2 (scene 2.2), adaptive albedo tint,
  cool-dusk Fresnel rim 0.28, dormant UV-black fallback. Transient `sampled` scope bug fixed before
  the final build.
- QA: torso mean **89.31** / p50 **95.98** / black **14.75 %** / clipping 0 %, close-up detail
  visible (min 407 unique colours — cycle-3 target 500), 5 appearances + skeleton/zombie.

### Critical bug fixed

Cycle-1's asset re-bake quantised ruin/tent/wall/prop assets; the old `ruins.ts` instancing baked
`mesh.matrixWorld` into normalised Int16 position attributes and corrupted them — 12 ruins, 27
tents, 10 walls and 54 small props rendered as ~2 m blobs in the deployed cycle-1 build. New
quantisation-safe instancing folds transforms into instance matrices instead; verified against the
real shipped GLBs and by QA screenshots (chapel 8.5 m, bridge 5 m, tent 2.21 m, wall 5.6 m).

### World / atmosphere / audio

- Near/far tree band: full-res 0–22 m, LODs 22–54 m, matrices reassigned only on >2 m camera moves;
  `__ssPerf().landscape` proves both bands.
- Tent + stone-wall cast shadows restored; casters = architecture, keeps, gatehouses, towers,
  actors, ruins/tents/walls.
- Pooled torch smoke, drifting ash, moon-dust motes (allocation-free, reduced/off at low tier).
- Environment dressing (existing assets, +7 draws): gate brazier pairs + emissive flames (no new
  lights), friendly-only courtyard banners, Castle 1→2 roadside stakes, camp barrel/cart clusters,
  Fallen Keep graves.
- `fortress_keep` 5 prims/5 trimsheets → 1 prim/1 material via baked 2048² atlas: **45 → 9 draws**
  across nine keeps, tris/bbox unchanged.
- QA camera hooks `__ssQAView(name)` / `__ssQAPose` (treeline/fire/camp/courtyard/region-*),
  landscape culling follows the QA camera; treeline pose fixed to a verified grove.
- Audio: quiet adaptive WebAudio music bed (D-minor pads + drone, nest tension, siege swell, capture
  relief, combat ducking), fire crackle + ember rumble, rate-limited distant undead moans; lazy
  build/teardown, Sound/pause gated.

### Checks actually run (final state)

- `npm test` **58/58**; `tsc` 0; `vite build` success; `validate-assets` **65/65**.
- QA authoritative: characters **24/24**, perf **26/26** (**169 calls / 1,658,880 tris**; FP 131 /
  1.55 M; low tier 130 / 1.35 M; gates <210 / <1.85 M), fresh-build smoke **16/16** with hash
  reproduction, co-op **18/18**, live baseline **17/17**. Payload **13.69 MB**, nav→landing 3.56 s,
  loading 0/20→13/20, join 3.70 s. 0 page/console/log errors/warnings, 0 404s, 10 cards.
- **Not verified:** hardware-GPU fps/frame pacing/thermals, perceptual audio, controller, mobile.

### Cycle-3 (next) — concrete backlog from QA's AAA audit

1. **Regional identity:** the three regions look near-identical — add biome dressing, colour
   grading/fog variation and distinct landmarks per region.
2. **Tree foliage:** pale shard clumps and visible LOD band — better foliage cards/alpha, blend
   near/far in fog; consider denser LOD instances.
3. **Corruption decals:** magenta patches look flat/unblended on roads — blend into terrain, add
   gradient/edge feathering.
4. **Fire/moke:** replace flat emissive cone flames with sprite-based flame + embers; richer smoke.
5. **Character identity:** add-on silhouettes are subtle at 10 m and close-up colour variety is
   near the gate — deepen add-on shapes, enrich atlases toward the 500-colour target.
6. **Time-to-HUD (SwiftShader 16.3 s):** profile main-thread/shader cost, defer or batch asset
   decoding; verify on a real GPU.
7. Minor: hard-edged moon halo, bright flat tents, no wind animation.
- Carried: GLB prop clones ~30 draws, triangle budget tight with shadows, no real-GPU/perceptual
  playtest, campaign/controller/mobile unverified.

## Previous cycles

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
- Cycle-2 deployment: game commit → hosting pin bump (`game-source.json`) → hosting build → commit
  + push → Cloudflare deploy → poll live bundle/assets → QA final live pass.

## Continuity procedure

After each cycle, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and the next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
