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

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why every md link showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

## Latest completed cycle — 2026-10D cycle 1: characters fixed, shadows restored, further perf

Contract: `docs/BATCH-2026-10D-SPEC.md`; results: `docs/BATCH-2026-10D-RESULTS.md`.

### Characters no longer blacked out (root cause fixed)

The 7 player/companion bodies had **unusable UV0** (93 % zero-area triangles sampling black atlas
gutters), so no material tweak could help. asset-forge re-UV'd (Smart UV Project) and baked
palette-matched procedural armour atlases onto the original rigs in Blender/Cycles without touching
geometry, bones or animation data (UV-sampled luminance 5–8 → 40–172; rig/clips hash-verified).
weapons-armory added a runtime safety layer in `custom-character.ts`: PBR clamps, a dormant
UV-black-map fallback and a cheap Fresnel rim. In-game torso luminance mean 54.9 → 102.8, p50
28.5 → 114.3, black pixels 44.5 % → 15.4 %; player/companions/undead are clearly readable.
Cosmetic debt: the new atlases read over-bright/flat white at night (cycle-2 ledger).

### Performance + visuals

- Draw calls 301 → **173** (0.195 % of the original 88,544); triangles 1.76 M → **1.50 M**
  (37.1 % of original) *with the shadow pass restored*.
- New LOD assets: `pine_lod` (2,267 tris/88 KB), `oak_lod` (2,474/80 KB), `castle_tower_lod`
  (3,939/120 KB, transform-identical to the 13.8 k tower) — instanced trees use LODs to 54 m, one
  LOD tower per castle.
- Static props instanced per asset; keeps instanced per region; roads merged; grass restored to
  5,600; survivors 2/camp; carts/graves restored. Quality tiers + adaptive stepper retained.
- Shadows restored with curated casters (architecture, keeps, gatehouses, towers, actors, large
  ruins cast; foliage/tents/walls/small props receive only), 2048/1024/off by tier, ±34 m moon
  frustum following the player.
- New debug hook `window.__ssCharacterPreview(actorId?)` frames an actor close-up for QA (raycast
  boom against castle colliders); `window.__ssPerf`/`__ssQuality` unchanged.
- Payload 12.20 → 12.43 MB (character atlases +0.23 MB); initial preload unchanged ~4.7 MB.

### Checks actually run (final state)

- `npm test` **58/58**; `tsc` 0 errors; `vite build` success; final bundle `index-DtnItod1.js`
  (801,289 B) reproduced by a fresh build.
- `validate-assets.mjs` **65/65** (61 custom GLBs incl. 3 LODs + repaired characters).
- QA `--characters` **22/22**, perf **23/23** (173 calls, 1,500,333 tris — 0.02 % over the 1.5 M
  target = at-budget), fresh-build smoke **16/16**, co-op **18/18**, live baseline **17/17**;
  0 page/console/log errors, 0 asset 404s, 10 weapon cards.
- **Not verified:** hardware-GPU fps/frame pacing/thermals, perceptual audio, controller, mobile.

### Next cycle (cycle 2) — concrete backlog

1. **Character visual quality (top)**: tone down the over-bright flat atlases, add normal/roughness/
   AO maps and richer armour detail (chainmail, plate segments, surcoat trim, embossing), and
   evaluate replacing the shared body mesh with distinct higher-fidelity character models from the
   sketchlab warehouse (plated-knight/medieval-knight-rigged/cursed-knight archives; retarget the
   authoritative 6 Mixamo clips if models change).
2. `fortress_keep` 5-trimsheet → 1-atlas merge (45 → ~9 draws across the nine keeps).
3. Near/far tree band (full-res <20 m, LOD beyond) and restore cast shadows for tents/stone walls
   once the triangle budget allows.
4. Richer world: more structures/props/foliage from the warehouse, weather/particles, torch smoke,
   audio layers (keep verifying perf every step).
5. Real-GPU playtest pass and low/medium/high visual comparison.

## Previous cycles

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
- A local play server can be run from the game repo with
  `$env:PORT=3000; node --import tsx src/server/index.ts` (serves `dist/client` at
  http://localhost:3000/); because hosting builds may leave `.game-build` in detached HEAD,
  always `git checkout main` before committing docs.
- Cycle-1 deployment: game commit pushed to `swords-and-shrouds` main; hosting pin updated and
  deployed; live verification recorded in the commit messages/session log (new JS bundle, 10 cards,
  repaired character assets, ~12.4 MB transfer).

## Continuity procedure

After each cycle, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and the next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
