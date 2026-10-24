# Swords & Shrouds — Iteration cycle 2026-10D (AAA loop, cycle 1)

The user asked to keep cycling improvements until the game is AAA level, and to fix two concrete
issues right now: (a) markdown/doc file links in the chat were broken, and (b) **all characters
render blacked out**. This file defines the first cycle of the standing AAA loop. Read
[`docs/BATCH-2026-10C-SPEC.md`](./BATCH-2026-10C-SPEC.md) for standing conventions.

## Standing per-cycle gates (never relax)

- `npm test` — exactly 58 tests, all passing (extend existing tests only).
- `npx tsc --noEmit` — 0 errors; production `vite build` with bundled Node 24.
- `scripts/validate-assets.mjs` — all shipped GLBs pass the contract.
- Headless Chrome: 0 page/console errors, 0 failed requests/asset 404s, 10 weapon cards, local
  smoke 16/16, perf capture, co-op 18/18, live URL mode.
- QA must capture fresh screenshots and *look at them* (read_image), not just DOM checks.
- Lead commits/pushes game repo, updates hosting pin, deploys, verifies live bundle/assets.

## Cycle-1 workstreams

### A. Character readability (weapons-armory) — TOP PRIORITY

Observation: in `qa/final-batch3/01-third-person.png` and the crop, the player and companions are
near-black silhouettes while their shields/weapons (non-skinned equipment meshes) render bright.
Measured facts:
- character GLB materials: `metalness=0`, `roughness=0.8`, one base-colour texture each;
- base-colour textures are *not* black: mean luminance 73–102 / 255 (p90 127–210);
- zombies and skeletons also read as dark silhouettes in gameplay screenshots;
- batch-2/3 screenshots show the same, so this predates the asset slimming.

Hypotheses to test: skinned-mesh normal/matrix issue, double-sided inverted winding, material
response to the night lighting/env, or lighting that leaves characters below the visible range.
Build a **standalone three.js character viewer** (temporary page under a gitignored dir or
`qa/`, served by `vite dev`; load `custom/<name>.glb.gz` with GLTFLoader + gzip decompression like
`assets.ts`) and render close-ups of hero/ally/fallen/zombie/skeleton in the game's night
environment; iterate until the body armour reads clearly (materials, normals, env intensity, rim).

Fixes to implement in `src/client/custom-character.ts` (and only that file unless coordinated):
- clamp/repair material response: sane `metalness`/`roughness`, raise `envMapIntensity`;
- add a cheap **Fresnel rim light** to the character material (injected in `onBeforeCompile`) so
  silhouettes read against dark backgrounds without extra scene lights;
- subtly lift `emissive`/base colour for near-black materials (no glowing, keep it night-realistic);
- verify both cameras: third-person player/companions/enemies, and first-person is unaffected.
Acceptance: character close-up crops show armour/face/limb detail and readable silhouettes in both
camera modes; no white blow-outs; the nine-body grounding/equipment tests stay green; run tsc +
`tests/equipment.test.ts` + `tests/armory.test.ts`.

### B. Further performance (world-scene) — target draw calls < 150, triangles < 1.2 M

- Now that every shipped GLB is 1–4 prims, merge/instance the remaining static per-asset prop
  clones in `customEnvironment()` (trebuchet, gatehouse, beacon, brazier, barrels, cart, grave,
  house, cauldron, etc.) into one or a few draws each (InstancedMesh or merged geometry), keeping
  positions/rotations/shadows and the upgrade/visibility behaviour intact.
- Integrate the tree LODs from asset-forge (near = full pine/oak, far = low-poly LOD) using two
  InstancedMeshes with distance-based assignment; keep frustum/transparent behaviour.
- Optional if cheap: tighten shadow map only for far cascades is out of scope; keep current visual.
- Re-measure with `__ssPerf` and report before/after calls/tris/geoms/meshes; keep 0 console errors.
- Add a debug hook `window.__ssCharacterPreview(actorId?)` that frames the nearest/selected actor
  close-up for one render (used by QA to verify character readability) — read-only, no gameplay
  effect. Coordinate the API with qa-verifier: `window.__ssCharacterPreview()` returns
  `{ok, actorId}` and positions the camera for subsequent frames until `window.__ssCharacterPreview(null)`.

### C. Tree LOD assets (asset-forge) — `pine_lod.glb.gz`, `oak_lod.glb.gz`

- Bake/decimate from the current pine/oak assets to ≤2,500 tris each, 1–2 prims, 256–512 texture,
  same origin/ground-centre placement and palette; keep the night colour match to the full asset.
- Validate with the asset contract; sizes ≤150 KB each; report tri counts/sizes and a Cycles preview.

### D. Verification (qa-verifier)

- Extend the harness with a `--characters` mode or reuse debug capture: using
  `window.__ssCharacterPreview()` take close-up screenshots of the player (all 5 player
  appearances) and one zombie/skeleton, in third person, and compute mean/p90 luminance over the
  character region to prove they are no longer black silhouettes (before/after numbers).
- Re-run: local smoke 16/16, perf capture (draw calls/tris/geoms, quality tiers, loading), co-op
  18/18, live baseline; inspect all screenshots; update `docs/QA-REPORT.md` with the character
  close-ups, performance deltas and a blunt visual verdict vs `qa/final-batch3`.
- Do not edit src/; report defects back to owners.

### E. Lead

- Fix the user-facing doc-link problem: mirror `PROJECT_STATUS.md`/`docs/*.md` into the session
  workspace (`…\default-workspace\swords-and-shrouds\`) and reference workspace-relative paths in
  replies plus `present` cards, so links resolve in the GUI (absolute Windows paths were failing).
- Keep a local playable server available if useful (`node --import tsx src/server/index.ts` serving
  the built client on a port) and report the URL.
- Integrate, run the full gate, update docs (`docs/BATCH-2026-10D-RESULTS.md`, PROJECT_STATUS),
  commit/push, deploy/pin, verify live, then hand back to QA for the final live pass.
