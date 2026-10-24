# Batch 2026-10 — Results

Objectives 1–5 from the production specification, executed by a 6-teammate parallel team
(asset-forge, weapons-armory, world-scene, ruins-builder, audio-polish, qa-verifier) with the Lead
owning integration, verification and deployment. Full contracts are in
[`docs/BATCH-2026-10-SPEC.md`](./BATCH-2026-10-SPEC.md); the asset pipeline and attribution table are
in [`docs/ASSET-PIPELINE.md`](./ASSET-PIPELINE.md); browser evidence is in
[`docs/QA-REPORT.md`](./QA-REPORT.md).

## Objective 1 — Scanned road & ground surfaces

- Extracted the albedo/normal data from the raw photogrammetry scans
  (`ground_03_-_country_road.glb` 294 k tris, `cobblestone_ground_-_highpoly.glb` 1.4 M tris) with
  Python/Pillow/NumPy: atlas-gutter detection, largest fully covered square, roll-by-half +
  cosine cross-fade for seamless tiling, renormalised normals (cobblestone normal derived from the
  albedo because the source has none).
- Shipped four 1024² tiles (two JPEG basecolours ≤ 326 KB, two normal PNGs ≤ 1.72 MB) and a new
  `terrain-surfaces.ts` pass that clones per-mesh materials, applies sRGB/linear colour spaces,
  anisotropy, RepeatWrapping and geometry-derived tiling (road 4 m, cobble 2.4 m, ground 7 m), and
  tints the naturally light scanned albedo down so paths read as stone rather than white concrete.
- The three region slabs, the road network and each castle courtyard now use scanned materials.

## Objective 2 — Architectural variety & modular castle ruins

- Baked eleven scene assets from the raw kits/scans (Blender 5.2 + glTF-Transform + meshoptimizer):
  gothic `chapel_ruin`, ruined `aqueduct_ruin`, broken `bridge_ruin`, overgrown `courtyard_ruin`
  (13.8 k tris each), modular `fortress_keep` (10.9 k), `castle_tower` (13.8 k from a 1 M-tri scan),
  plus `well`, `chest`, `bench`, `grass_tuft`, `rock_cluster` props.
- Chapel, aqueduct and broken bridge now sit along the Castle 1 → Castle 2 road with per-region
  rotation/scale variance and ≥10 m road clearance; the courtyard ruin decorates each region.
- All nine castles replace the simplified keep boxes with region-tinted modular fortress keeps, and
  castle towers replace the legacy box/cone towers. Wells, chests and stone benches dress all nine
  castle courtyards and survivor camps. Every asset is optional and falls back to the previous art.

## Objective 3 — Weapon racks & arsenal expansion

- Three new weapons with distinct identities: **rapier** (fast thrust, shield, 26 dmg / .42 s /
  3.8 m), **halberd** (longest reach 5.2 m, 48 dmg / 1.05 s), **dane axe** (heavy cleave, 58 dmg /
  1.05 s). All three baked canonically (grip at origin, blade +Y, 20 % handle below the origin) and
  measured through the animated hero (attached diagonal 1.03 / 1.88 / 1.61 vs the 2.2 gate).
- Weapon-rack distribution now covers every weapon ID across the nine castles; the armory grid,
  first-person viewmodel and hand sockets handle all eight weapons.
- Captured castle courtyards display a stone-plinth weapon rack with a 3-D model of every weapon,
  unlocked by ownership.

## Objective 4 — Environment scatter & foliage density

- Two InstancedMeshes total for the new scatter: baked `grass_tuft` ×440 near camps and forest
  edges, `rock_cluster` ×96; tree count 360 → 540 with per-instance tint/scale/rotation variation.
- Existing wind shader retained for both procedural and baked foliage.

## Objective 5 — Visual polish, atmosphere, post-processing & audio

- Post-processing: `RenderPass → UnrealBloom (threshold 1.05) → OutputPass`, pixel-ratio capped,
  resized with the window, graceful fallback to forward rendering.
- Atmosphere: a dark night-sky PMREM (baked once) so PBR armour/metal has reflections, a
  player-following fill light, a constant 14 active point lights (13 pooled torch lights + 1 fill)
  so shaders never recompile, region-graded moonlight/fog, tight 2048 shadow frustum following the
  player, named-region fog tints and a plague-violet haze near the nest.
- Combat FX: pooled `CombatEffects` (sparks 280 / blood 120 / dust 72 instanced particles, zero
  per-frame allocation) for metal/flesh/undead sparks, blood vs corruption splatter, sprint dust and
  fire embers; damage flashes are tinted and restore the original emissive.
- Audio: procedural WebAudio ambience (wind bed, horde drone scaled by nearby undead, plague-nest
  hum, fire crackle, low-health heartbeat, footstep cadence) and a rebuilt layered combat synth
  (mass-dependent whoosh, metal/flesh impact profiles, generated room reverb, voice cap) gated by the
  Sound checkbox and user gesture.
- HUD/UI: 8-card armory grid, low-health pulse, landing layout fixed for 700–900 px-tall viewports,
  weapon-rack labels shrunk and distance-faded, dynamic weapon-count copy.

## Verification

| Gate | Result |
| --- | --- |
| `npm test` | **58 / 58 passing**, exactly 58 `test(...)` blocks (no tests added/removed) |
| `npx tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24; system Node 22.11 is below Vite 7's floor) | success, 758.5 kB JS / 202.2 kB gzip |
| `node scripts/validate-assets.mjs` | **58 / 58 checks** — glTF 2.0, embedded buffers/images, TEXCOORD_0, indexed prims, tri budgets, gzip-9 |
| `tests/assets.test.ts` | 5 / 5 pass (all 44 custom assets + top-level assets) |
| `tests/equipment.test.ts` | 5 / 5 pass (nine grounded bodies, eight weapons, canonical grips) |
| Browser smoke (headless Chrome/SwiftShader, production build) | **16 / 16 gates**, 0 page errors, 0 console errors, 0 failed requests, **0 asset 404s**, WS `opens=1 closes=0`, 8 armory cards, both cameras and live combat exercised |

Visual verification (screenshots in `qa/baseline/` and `qa/final/`, ignored by git) confirmed: the
giant spawn weapon-label band is gone; no white/black character silhouettes; fortress keeps, castle
towers, ruins, courtyard props, weapon displays, scatter and scanned road/cobble all render; landing
footer no longer collides with the room-code row.

## Remaining known defects / follow-ups

1. Ground contrast: the moonlit ground and the shadow cast by each castle still meet with a strong
   light/dark boundary (a stylised moonlight look). The final pass flattens and cools the scanned
   grass/soil detail map and desaturates the region tint so the ground reads blue-grey at night
   instead of day-green; further tonal tuning is a product call.
2. Night sky: the camera far plane (80 m) clipped the sky dome/moon/stars, and the sky gradient
   texture had no sRGB colour space (so ACES rendered it pale grey). The polish pass raised the far
   plane, made the sky follow the camera, disabled fog on celestial materials and fixed the colour
   space — the horizon now reads as a dark night gradient with moon/stars visible when looking up.
3. NPC bodies are readable but still dark in third person; close-up detail resolves, distant enemies
   rely on markers.
4. Combat screenshot timing at SwiftShader's sub-1 fps is not mid-swing; real-GPU playtesting is
   still required for animation/perf/perceptual audio.
5. Pre-existing `custom/gatehouse.glb.gz` uses `KHR_materials_pbrSpecularGlossiness` (GLTFLoader
   warning); `/favicon.ico` is now provided as an inline SVG data URI.
6. Landing viewport coverage: 700–900 px tall is fixed; heights above 900 px use the desktop design,
   and below 700 px tall the pre-existing overlap remains.

## Commits

- `c5d3d99` — phase 1 (scanned surfaces, post-FX/atmosphere, combat FX, ruins framework, three
  weapons, ambience).
- `6576c37` — phase 2 (baked ruins/keeps/props/scatter, modular castles, night sky, ground polish,
  docs).

## Final Lead re-run after the polish pass

The QA suite was re-run by the Lead on the final tree after the night-sky and ground fixes:
`node scripts/smoke-browser.mjs --out qa/final-lead2` (bundled Node 24, fresh production build) →
**16/16 gates pass**, 0 page errors, 0 console errors, 0 bad responses, **0 asset 404s**, 8 armory
cards, both cameras and live input exercised. Canvas third-person mean luminance 48.4 / std 42.4,
98.5 % non-dark, 1655 unique colours. The WebSocket instrumentation showed reconnects during the
software-renderer run at ~0.6 fps (harness/page lifecycle under SwiftShader); the session recovered
and the HUD stayed live. Real-GPU playtesting remains the open verification item.
