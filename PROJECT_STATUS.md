# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Latest completed batch — 2026-10B: readability, combat feel, arsenal depth, live/co-op QA

Implementation on branch `main` (exact SHA in the commit log; hosting pin updated to it).
Contract: `docs/BATCH-2026-10B-SPEC.md`; results: `docs/BATCH-2026-10B-RESULTS.md`.

### Behaviour changed

- **Readability**: the white ground fill-light pool is gone (player fill is now a shadowless
  camera-facing directional light), exposure/moon/hemisphere were rebalanced with a dusk-blue
  ambient floor, night-sky IBL/actor `envMapIntensity` were raised so distant actors read, the moon
  and 340 stars were moved into the default camera framing, road/cobble were tinted to grey stone
  and the ground detail albedo remapped cooler/darker/lower-contrast. The adaptive-quality composer
  steps pixel ratio down when frame time exceeds ~28 ms and recovers when healthy.
- **Combat feel**: per-weapon first-person motion (thrust/cleave/crush/sweep), pooled third-person
  swing-trail ribbons, hit-stagger lean, brighter HDR impact sparks, and pooled long-lived ground
  blood/corruption splatter decals. The two-handed support-hand pose was rewritten as an analytic
  two-bone reach with finger aim and clavicle assist (wrist→shaft distance 0.64 m → 0.11–0.13 m).
- **Arsenal**: 10 weapons now — `flamberge` (2H wavy greatsword) and `mace` (1H flanged mace) added
  with measured canonical grips; nine castle racks cover every non-sword weapon exactly once.
- **Environment**: 27 camp tents (3 per survivor camp) and 10 low ruined stone-wall segments along
  the Castle 1 → 2 road and the other regions.
- **Audio**: authoritative-state event stingers (capture/rescue/siege/victory/defeat), weapon-class
  swing synthesis profiles, and a quiet plague-nest pad bed.
- **Robustness fix**: the local authoritative server now tolerates two consecutive missed WebSocket
  pongs (~30 s) instead of terminating on the first miss. QA proved the spurious `1006` reconnects
  were renderer main-thread stalls (software rendering) delaying pongs past the old 15 s heartbeat;
  the client reconnect path itself was correct. Cloudflare's Durable Object already used a 45 s
  message-age timeout and was not changed.
- **Assets**: four new GLBs (`flamberge`, `mace`, `camp_tent`, `stone_wall`) — see
  `docs/ASSET-PIPELINE.md` and `public/assets/CREDITS.txt`.

### Checks actually run (final state)

- `npm test` — **58/58 passing**, exactly 58 `test(...)` blocks (tests extended in place only).
- `npx tsc --noEmit` — 0 errors.
- `vite build` — success: `index-KD7Bp8Pr.js` 774.05 kB / 206.88 kB gzip. **Use the bundled Node
  v24.21.0** (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`);
  the system Node 22.11 is below Vite 7's engine floor and hard-fails the build.
- `scripts/validate-assets.mjs` — 62/62 checks; `tests/assets.test.ts` 5/5.
- Headless local smoke — 16/16 gates, 10 weapon cards, 0 page/console/log errors, 0 bad responses,
  0 asset 404s (`qa/final-batch2/`).
- Live-URL mode against the deployed batch-1 site — 17/17, wss connected, 0 asset 404s.
- 2-player co-op — 18/18: same room, both snapshots list both players, movement propagates, shared
  weapon pickup syncs to the second player, both HUDs live, 0 page errors (`qa/coop/`).
- QA harness now supports `--url <url>` (with `--expect-weapons` / `--expect-assets`) and `--coop`
  (two Chrome profiles), plus full reconnect instrumentation (`scripts/smoke-browser.mjs`).
- Not verified: real-GPU frame rate (SwiftShader runs 0.6–1.6 fps), swing-trail/stagger/decal
  visuals, perceptual audio, physical controller, mobile HUD, full campaign playthrough.

### Remaining defects / next concrete tasks

1. Real-GPU visual/perf pass is the top remaining item: verify swing trails, stagger, decals, moon
   framing and frame rate on hardware GPU (software rendering cannot catch the 0.22 s effects).
2. First-person road is still fairly light grey; distant NPCs still dark; the tent reads as a flat
   canopy rather than a pitched tent.
3. Combat animation depth: dedicated polearm/hammer/cleave clips, hit reactions and custom-undead
   dismemberment parity remain from earlier batches.
4. Full campaign balance/formation playtest, controller test, mobile HUD, and live co-op verification
   on the deployed bundle are outstanding.
5. Pre-existing `gatehouse.glb.gz` uses `KHR_materials_pbrSpecularGlossiness` (GLTFLoader warning,
   harmless); the Cloudflare-Insights analytics beacon fails cosmetically in headless Chrome.

## Previous completed batch — 2026-10: objectives 1–5 battlefield overhaul

Commits `c5d3d99` (phase 1) and `6576c37` (phase 2): scanned road/cobblestone PBR textures and
terrain-surfaces pass; post-processing bloom; PMREM environment and pooled torch lighting; regional
fog/moonlight grading; instanced combat particles; ruins/props/courtyard weapon-rack framework;
modular fortress keeps/towers for all nine castles; three new weapons (rapier, halberd, dane axe);
procedural ambience and layered combat audio; docs `docs/BATCH-2026-10-SPEC.md` /
`docs/BATCH-2026-10-RESULTS.md` / `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; build via `scripts/build-game.mjs` (fetches the pinned commit, `npm ci`,
  builds the client under `/games/swords-and-shrouds/`). Cloudflare Workers Builds deploys on push;
  `worker.js` imports the pinned `.game-build` simulation source, so the pin controls both client
  and authoritative gameplay.
- Build locally with the bundled Node: prepend
  `C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin` to PATH, then run
  `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build` in the hosting repo.
- Live verification for batch 2026-10B: recorded in the hosting commit message / this session log;
  after deploying, check `/games/swords-and-shrouds/health`, the new JS bundle hash, the four new
  `.glb.gz` assets and `assets/CREDITS.txt` return 200.

## Continuity procedure

After each completed batch, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Inspect current commits and complete the next unfinished task. Update the checkpoint."
