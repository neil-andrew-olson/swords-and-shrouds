# Swords & Shrouds — Iteration cycle 2026-10F (AAA loop, cycle 3)

Cycle 2 (`docs/BATCH-2026-10E-RESULTS.md`) shipped character materials/silhouettes, the
quantised-geometry fix, near/far trees, shadows, atmosphere, keep atlas and adaptive audio at
**169 draw calls / 1.66 M triangles** (live `index-C_mLlIzi.js`). Cycle 3 attacks QA's visual-audit
gaps and adds new high-fidelity content from the sketchlab warehouse. Standing gates unchanged
(58/58 tests, tsc, build, validate-assets, smoke/co-op/live), build with bundled Node 24.

## Goals + acceptance

### 1. Regional identity (top gap)
The three regions must finally look and feel different. Per region — Green March, Ashen Moor,
Frozen Crown:
- **Atmosphere/grading:** region fog colour + density, moon/hemisphere tint, sky tint and
  ambient/saturation shifts that transition smoothly at borders.
- **Ground decals:** alpha-blended region patches (snow/ice in Frozen Crown, ash/soot in Ashen
  Moor, grass/flower clumps in Green March) that follow terrain and never look like flat stickers.
- **Foliage + props:** snow-tipped pines (Frozen), dead/gnarled trees (Ashen), maple/oak variety
  (Green); region prop scatter (ice shards, standing stones, ash rocks, dead logs).
- **Landmarks:** at least one distinct landmark per region placed by ruins-builder
  (e.g. collapsed gothic chapel in Ashen Moor, watchtower ruin in Frozen Crown, standing-stone
  circle / village-house ruin in Green March), visible from the region road and culled correctly.
Acceptance: QA region captures (`region-green|ashen|crown`) are visibly distinct (colour/fog/foliage/
landmark) while keeping night readability; no z-fighting/pop; 0 console errors.

### 2. Foliage quality
New pine/oak/maple foliage with proper alpha needle/leaf cards and night palette; near/far band
blends through fog (no shard clumps / visible LOD seam). Tri ≤4,000 per tree asset, ≤150 KB gz.

### 3. Corruption decals + fire/smoke fidelity
- Corruption (plague) patches: feather-masked, colour-blended decals that follow terrain and fade
  at edges (no flat magenta blobs); subtle animation allowed.
- Fire: sprite-based additive flames (soft tongue + core, per-fire variation), embers rising,
  smoke puffs; pooled and cheap; no flat emissive cones left.
- Corruption/fire sprite textures baked by asset-forge (PNG, 128–256).

### 4. Time-to-HUD (SwiftShader 16.3 s)
Reduce perceived and real time-to-HUD: core-first progressive asset loading (join/playable with
player, castle, foliage basics; background-load custom props/equipment), defer non-critical shader
variants, avoid blocking asset verification, keep loading progress honest. Target: HUD/playable
noticeably earlier than cycle 2 (measure with harness HUD timings; opt-in SwiftShader numbers).

### 5. Content expansion (warehouse/Blender)
Bake + integrate at least: `dead_tree`, `snow_pine` (or snow-tipped pine variant), `maple_tree`
(or leaf-variant oak), `standing_stone`, `ice_shard`, plus 2–3 structure landmarks
(`chapel_ruin`, `watchtower_ruin`, `village_house_ruin`). All assets follow the established GLB
contract (plain glTF 2.0, gzip-9, embedded images, indexed, TEXCOORD_0, no Draco/KTX2/meshopt
beyond `KHR_mesh_quantization`), tri budgets, ground-centred origins, night palette, atomic install.

### 6. Combat/undead identity + audio
- Elite undead variants get distinct silhouettes (procedural crown/crest/horn add-ons in
  `custom-character.ts`, no new asset dependency) and subtle glowing eyes; weapon trails/flash
  polish. Keep nine-body grounding/grip tests green.
- Region-specific ambience layers (Frozen Crown wind/ice creaks, Ashen Moor ash wind/ember hiss,
  Green March night birds/insects), smooth crossfades, existing Sound/pause gating.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom`, `public/assets/textures`, `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **world-scene** | `src/client/scene.ts`, `landscape.ts`, `effects.ts`, `postfx.ts`, `assets.ts` (time-to-HUD) |
| **ruins-builder** | `src/client/ruins.ts`, `terrain-surfaces.ts` |
| **weapons-armory** | `src/client/custom-character.ts`, `equipment.ts`, `tests/equipment.test.ts` |
| **audio-polish** | `src/client/ambience.ts`, `main.ts`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- `npm test` exactly 58/58 (extend existing assertions only); tsc 0; production build; validator
  all pass; 0 page/console errors or warnings; no new npm deps; embedded assets only.
- One dist builder at a time; QA owns authoritative captures; PID-scoped process kills only
  (never broad `taskkill /IM node.exe`); teammates never run git or edit another owner's files.
- **Perf acceptance for cycle 3:** spawn third-person calls **<230**, triangles **<1.9 M** (new
  content has a cost; visual identity now outranks a strict triangle cap), quality tiers intact.
- Report measured before/after numbers + screenshots; deferring a goal is acceptable if stated.
