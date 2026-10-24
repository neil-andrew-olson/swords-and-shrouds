# Swords & Shrouds — project checkpoint

Updated: 2026-10-23. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Latest completed batch — Objectives 1–5: battlefield art, ruins, arsenal, atmosphere, audio

Implementation commits (branch `main`):
- `c5d3d99` — phase 1: scanned ground materials, terrain-surfaces pass, post-FX composer,
  PMREM environment + pooled lighting, regional fog/moonlight grading, combat-effects system,
  ruins/props/courtyard-rack framework, WebAudio ambience, and three new weapons (rapier, halberd,
  dane axe) with canonical grip profiles and rack distribution.
- `6576c37` — phase 2: eleven baked scene assets (chapel/aqueduct/bridge/courtyard ruins, modular
  fortress keep, castle tower, well, chest, bench, grass tuft, rock cluster), modular keeps and
  instanced towers for all nine castles, courtyard/camp props, visible camera-following night sky
  (far-plane + sRGB gradient fixes), softened ground lighting, and asset/QA documentation.

Deployed asset work lives in `public/assets/custom/*.glb.gz` (14 new GLBs) and
`public/assets/textures/` (4 scanned seamless tiles). The bake pipeline is reproducible from
`scripts/bake/` with Blender 5.2 + glTF-Transform + sharp + Python; sources and attribution are in
`docs/ASSET-PIPELINE.md` and `public/assets/CREDITS.txt`. Contracts and acceptance criteria:
`docs/BATCH-2026-10-SPEC.md`; results and remaining defects: `docs/BATCH-2026-10-RESULTS.md`;
browser evidence: `docs/QA-REPORT.md`.

### Behaviour changed

- Objective 1: road network, three region slabs and castle courtyards use scanned seamless
  country-road/cobblestone albedo + normal maps, with per-mesh material cloning, geometry-derived
  tiling and a night-level tint. The high-contrast grass/soil detail map is remapped to a
  low-contrast cool night albedo so the ground no longer reads as day-green polygons.
- Objective 2: all nine castles replace the simplified keep boxes with region-tinted modular
  `fortress_keep` models and `castle_tower` masonry; gothic chapel, aqueduct and broken-bridge ruins
  line the Castle 1 → Castle 2 road (plus per-region repeats); wells, chests and stone benches dress
  every castle courtyard and survivor camp. Every new asset is optional: a missing file leaves the
  previous art in place.
- Objective 3: `rapier` (fast 1H thrust, shield), `halberd` (longest reach, two-handed) and
  `dane_axe` (heavy two-handed cleave) added with measured canonical grips, distinct stats and
  server-authoritative behaviour. Castle racks cover every `WEAPON_IDS` entry; captured castles
  display a 3-D rack of every weapon.
- Objective 4: two extra InstancedMeshes (`grass_tuft` ×440, `rock_cluster` ×96) plus 540 varied
  trees; the wind shader still drives both procedural and baked foliage.
- Objective 5: night-sky immersion (visible gradient dome, stars and moon; camera-following),
  post-processing bloom with correct tone mapping/colour space, regional fog and moonlight grading,
  constant 14-light torch pool + player fill, pooled combat particles (sparks/blood/corruption/dust/
  embers), tinted hit flashes, procedural ambience and layered combat audio, plus HUD/landing fixes.
- New tooling: `scripts/validate-assets.mjs`, the `scripts/bake/` pipeline, and
  `scripts/smoke-browser.mjs` (headless-Chrome QA harness with WebSocket instrumentation).

### Checks actually run (final state)

- `npm test` — **58/58 passing**, exactly 58 `test(...)` blocks (no tests added or removed; existing
  tests extended in place for the new weapons and cue metadata).
- `npx tsc --noEmit` — 0 errors.
- `vite build` — success (758.7 kB JS / 202.3 kB gzip; CSS 15.7 kB). **System Node is 22.11.0, which
  is below Vite 7's engine floor; builds must use the bundled Node v24.21.0** at
  `C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (the QA harness
  auto-selects it).
- `node scripts/validate-assets.mjs` — 58/58 checks (glTF 2.0, embedded buffers/images, TEXCOORD_0,
  indexed primitives, triangle budgets, gzip-9, no Draco/KTX2/meshopt extensions).
- Headless Chrome production smoke — 16/16 gates, 0 page errors, 0 console errors, 0 failed
  requests, 0 asset 404s, `#weaponCards = 8`, both cameras, live input/combat, WS lifecycle
  recorded. Screenshots: `qa/final/` (gitignored) and `qa/final-lead2/` (Lead re-run after the final
  sky/ground polish).
- Not verified: real-GPU frame rate (SwiftShader software rendering only, sub-1 fps), perceptual
  audio, physical Xbox controller, and a full campaign playthrough.

### Remaining defects / next concrete tasks

1. Ground/atmosphere is now a readable stylised night, but moonlit ground vs castle shadow still has
   strong contrast and the road/scanned albedo remains light; further tonal art direction is a call.
2. NPC/player bodies are readable but still dark in third-person distance; distant enemies rely on
   markers.
3. Combat hit reactions/animations, two-handed support-hand posing and custom-undead dismemberment
   parity remain from earlier batches.
4. Full campaign balance/formation playtest, controller test, real-GPU performance pass, mobile HUD
   pass, and live Cloudflare smoke after deployment are outstanding.
5. Sky/stars/moon are visible when looking up, but the default third-person framing only shows the
   dark night limb; a star/moon elevation tweak would put them in frame if desired.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; build via `scripts/build-game.mjs` (fetches the pinned commit, `npm ci`,
  builds the client under `/games/swords-and-shrouds/`).
- Cloudflare Workers Builds deploys on push; `worker.js` imports the pinned `.game-build` simulation
  source, so the game-source pin controls both client and authoritative gameplay.
- This checkpoint will be committed and the hosting pin updated to the resulting game commit; the
  live URL must be verified separately after Cloudflare finishes building.

## Continuity procedure

After each completed batch, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Inspect current commits and complete the next unfinished task. Update the checkpoint."
