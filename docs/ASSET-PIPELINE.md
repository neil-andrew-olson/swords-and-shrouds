# Asset pipeline — Batch 2026-10 (asset-forge)

How every new GLB and scanned texture in this batch was produced, validated and installed.
Contract: [`docs/BATCH-2026-10-SPEC.md`](./BATCH-2026-10-SPEC.md). Raw material lives in the
local warehouse (`…/swords/sketchlab`); all intermediate files stay in `…/swords/temp_sketchlab`
and are never shipped.

## Tooling

| Tool | Location | Used for |
| --- | --- | --- |
| Blender 5.2 LTS (headless) | `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` | FBX/GLB import, join, decimate, material repair, GLB export, preview renders |
| glTF-Transform 4.5 + meshoptimizer | `scripts/custom-assets/node_modules` (preinstalled, never `npm install`) | meshopt simplification, texture re-encode (sharp), join/prune/dedup, GLB write |
| sharp | same | texture resize / JPEG / PNG re-encode |
| Python 3.12 + Pillow + NumPy + SciPy | `C:\Users\neil\AppData\Local\Programs\Python\Python312\python.exe` | GLB JSON parsing, image extraction, seamless tiling, normal-map derivation, procedural bench textures |

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/bake/bake-lib.mjs` | shared glTF-Transform helpers (mat4, triangle counting, staging paths) |
| `scripts/bake/bake_weapons_blender.py` | weapon bake: crop display sets, orient grip-at-origin/blade +Z (Blender) → +Y (glTF), decimate, export |
| `scripts/bake/bake_assets_blender.py` | ruins / keeps / props bake: import, join, real-world scale, ground-centre origin, decimate, material repair, export |
| `scripts/bake/bake-simple-glb.mjs` | pure glTF-Transform bake for single-GLB sources that Blender cannot decimate to budget (castle_tower) |
| `scripts/bake/build_grass_tuft.mjs` | builds the alpha-tested grass tuft (crossed quads + real grass texture) |
| `scripts/bake/postprocess-glb.mjs` | resizes/re-encodes embedded textures, forces indexed prims + TEXCOORD_0, drops skins/animations, gzip level 9, installs into `public/assets/custom` |
| `scripts/bake/bake_ground_textures.py` | seamless ground tiles from the raw photogrammetry scans |
| `scripts/bake/make_bench_textures.py` | procedural stone-bench basecolor + normal |
| `scripts/bake/inspect_source.py`, `preview_glb_blender.py` | source recon + orthographic Workbench preview renders |
| `scripts/validate-assets.mjs` | offline validator for every shipped GLB and scanned texture |

## Workflow

```powershell
cd C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build
# 1. bake geometry into temp_sketchlab/bake/<name>.glb (uncompressed, textures embedded)
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup `
  --python scripts\bake\bake_assets_blender.py -- --only chapel_ruin,aqueduct_ruin
# 2. texture budget + gzip-9 + install into public/assets/custom
node scripts/bake/postprocess-glb.mjs --only chapel_ruin,aqueduct_ruin
# 3. validate (never ship a file the validator rejects)
node scripts/validate-assets.mjs
node --import tsx --test tests/assets.test.ts
```

Only validated `.glb.gz` files are ever copied into `public/assets/custom`; staging output and
all rejected variants stay in `temp_sketchlab`.

## Shipped-asset contract (enforced by `scripts/validate-assets.mjs`)

* glTF 2.0 container, declared length correct, gzip level 9.
* Self-contained: no external URIs, every image has a `bufferView` (embedded).
* Every primitive indexed and carrying `TEXCOORD_0`.
* No Draco / KTX2 / meshopt-compression extensions (plain `GLTFLoader` must read them).
* Triangle budgets: weapons ≤ 3,400 (`dane_axe` ≤ 1,200), ruins/keeps ≤ 14,000, props ≤ 6,000,
  `grass_tuft` ≤ 1,500.
* Orientation: weapons = grip point at local origin, blade/head +Y, ~20 % of the total height
  below the origin (printed from the shipped file's decoded bounds); ruins/props = origin at
  ground centre, Y-up (min.y = 0, bbox centre x/z = 0).
* ≤ 3 MB compressed each; total new assets ≤ 30 MB (this batch: 15.25 MB).

## Shipped assets — sources, attribution, changes

Licences are quoted only where the source file/archive records them; for the Tripo-built scan
archives the licence is carried by the original Sketchfab download (recorded with the source
archive) and is not re-guessed here.

| Asset (`.glb.gz`) | Source | Author / collection | Licence | Changes |
| --- | --- | --- | --- | --- |
| `rapier` (3,366 tris) | `sketchlab/spanish_rapier.glb` | Lathander (sketchfab.com/Lathander) — "Spanish Rapier" | CC-BY-4.0 | joined 14 parts into 2 primitives, decimated 8,218→3,366, re-oriented grip-at-origin, textures 1024 JPEG, gzip-9 |
| `halberd` (1,912 tris) | `sketchlab/viking_halberd.glb` (spec suggested `halabardy.glb`, see deviations) | beyondmatter — "Viking Halberd" | CC-BY-4.0 | PCA-aligned shaft to +Y, grip-at-origin, textures 1024 JPEG, gzip-9 |
| `dane_axe` (374 tris) | `sketchlab/great_dane_axe.glb` | Guillaume Bru (EddyTeacher) — "Great Dane Axe" | CC-BY-4.0 | re-oriented grip-at-origin, textures 1024 JPEG, gzip-9 |
| `chapel_ruin` (13,859 tris) | `collapsed-gothic-chapel-ruin.zip` → `source/Zyklus15_Zeile1.zip` | Tripo scan; licence recorded with the source archive | recorded with the source archive | decimated 1,818,874→13,859, scaled to 7 m, ground-centre origin, basecolor/normal/roughness 1024 JPEG, gzip-9 |
| `aqueduct_ruin` (13,860 tris) | `ruined-aqueduct-arches-segment.zip` → `source/Zyklus15_Zeile7.zip` | Tripo scan; licence recorded with the source archive | recorded with the source archive | decimated 1,853,457→13,860, scaled to 6 m, ground-centre origin, textures 1024 JPEG |
| `bridge_ruin` (13,860 tris) | `ruined-stone-bridge-broken-arch.zip` → `source/Zyklus15_Zeile4.zip` | Tripo scan; licence recorded with the source archive | recorded with the source archive | decimated 1,939,255→13,860, scaled to 4.5 m, ground-centre origin, textures 1024 JPEG |
| `courtyard_ruin` (13,860 tris) | `overgrown-courtyard-patio-ruin.zip` → `source/Zyklus15_Zeile2.zip` | Tripo scan; licence recorded with the source archive | recorded with the source archive | decimated 1,910,497→13,860, scaled to 2.4 m, ground-centre origin, textures 1024 JPEG |
| `fortress_keep` (10,923 tris) | `modular-castle.zip` → `source/MOD_castle.fbx` | modular castle kit; licence recorded with the source archive | recorded with the source archive | kept 10,923 tris (under budget), scaled to 8 m, ground-centre origin, 5 trimsheet materials → 1024 JPEG, gzip-9 |
| `castle_tower` (13,854 tris) | `sketchlab/vashlovani_tower.glb` | Nik (sketchfab.com/nikska) — "Vashlovani Tower" | CC-BY-4.0 | merged the 13 index-chunk primitives into one mesh, meshopt-simplified 999,999→13,854, scaled to 9 m, ground-centre origin, texture 1024 JPEG |
| `well` (5,940 tris) | `medieval-stone-well-game-prop.zip` → `source/Zyklus6_Zeile9.zip` | Tripo scan; licence recorded with the source archive | recorded with the source archive | decimated 1,935,315→5,940, scaled to 1.5 m width, ground-centre origin, textures 1024 JPEG |
| `chest` (5,939 tris) | `sketchlab/medieval_era_chest.glb` | Geeky_ (sketchfab.com/Geeky_kek) — "Medieval Era Chest" | CC-BY-4.0 | decimated 7,622→5,939, scaled to 1.1 m width, ground-centre origin, textures 1024 JPEG |
| `bench` (36 tris) | modelled in this batch — no bench exists in `medieval-props-asset-low-poly-game-ready.zip` (`asset_low.fbx` = barrel/krishka/box/chest/klepki/lok only) | asset-forge (original work) | project-owned | three chamfer-less stone blocks with box-projected UVs, procedural running-bond stone basecolor + derived normal (`make_bench_textures.py`), 512 PNG/JPEG |
| `grass_tuft` (10 tris) | `grass-patches-circle.zip` → `textures/SF_Grass_Dif.png` (the FBX's 204 k-tri patch is unusable at a 1,500-tri scatter budget) | source archive; licence recorded with the source archive | recorded with the source archive | rebuilt as 5 crossed alpha-tested quads sampling the original RGBA grass strip; `alphaMode: MASK`, `doubleSided`, 512 PNG atlas |
| `rock_cluster` (5,933 tris) | `stones-and-grass.zip` → `source/stones_and_grass.fbx` | source archive; licence recorded with the source archive | recorded with the source archive | dropped the two grass helper meshes (187 k/294 k tris), kept the four rock meshes, decimated 124 k→5,933, scaled to 1.7 m, 512 JPEG |

### Scanned ground textures (`public/assets/textures/`)

| File | Source | Author / collection | Licence | Changes |
| --- | --- | --- | --- | --- |
| `road_country_basecolor.jpg` (1024², 318 KB) | `sketchlab/ground_03_-_country_road.glb` — `KHR_materials_pbrSpecularGlossiness.diffuseTexture` (image 0) | Andrea Spognetta (Spogna) — "Ground 03 - Country Road" | CC-BY-NC-4.0 | atlas-gutter mask → largest fully covered 1024² inscribed square (aligned with the normal map), seamless roll + cosine cross-fade, JPEG q88 |
| `road_country_normal.png` (1024², 1.72 MB) | same file — `normalTexture` (image 1) | as above | CC-BY-NC-4.0 | same crop rect, seamless cross-fade, renormalised, kept OpenGL (+Y) as exported by the glTF source |
| `cobblestone_basecolor.jpg` (1024², 326 KB) | `sketchlab/cobblestone_ground_-_highpoly.glb` — albedo image 0 (of 3) | SPLEEN VISION — "cobblestone ground - highpoly" | CC-BY-4.0 | highest-detail albedo, 3 % border crop, seamless roll + cosine cross-fade, JPEG q88 |
| `cobblestone_normal.png` (1024², 1.08 MB) | derived | — | — | source has **no** normal map: luminance height field → blurred periodic central differences → OpenGL (+Y) tangent normal, renormalised |

Existing `texture_ground_cobblestone.png` / `texture_ground_mud_grass.png` were left untouched.

## Deviations & limitations (reported to the Lead)

1. **halberd source** — `sketchlab/halabardy.glb` is not a single weapon: it is a two-rack
   *display set* of ~10 polearms (two ~15 k-tri racks, flat display boards) whose heads
   interpenetrate in 3D. Cropping one polearm would slice neighbouring blades, so the single-model
   `sketchlab/viking_halberd.glb` (1,912 tris, one mesh, embedded PBR textures) was baked instead.
2. **fortress_keep source** — `medieval-fortress-kit.zip` → `source/fortress.fbx` is an ASCII FBX,
   which Blender 5.2 refuses to import. The spec's documented alternative
   `modular-castle.zip` → `source/MOD_castle.fbx` was used (10,923 tris, five 1024² trimsheets).
3. **bench** — the low-poly props FBX contains no bench; a simple stone bench was modelled and
   given a procedural stone texture (per the task's fallback instruction).
4. **grass_tuft** — the supplied FBX is a 204,236-triangle circular grass patch of alpha cards.
   Decimation destroys alpha-card foliage, and 1,500 tris is the scatter budget, so the tuft is
   rebuilt as 5 crossed quads using the archive's own grass texture (10 tris).
5. **Decimation quality** — the four Tripo ruin scans lose fine surface detail at 14 k tris
   (expected at ~0.75 % of the source); silhouettes and the chapel window tracery still read
   correctly. `castle_tower` (photogrammetry, 1 M tris) is deliberately rough-looking stone at
   13.8 k tris.
6. **No Draco/KTX2/meshopt compression** anywhere: the client and tests parse with a plain
   `GLTFLoader`.

## Batch 2026-10B additions (task-13)

Four more GLBs for the arsenal/environment pass, same contract and pipeline. New helper scripts:
`scripts/bake/extract_camp_tent.py` (connected-component prop isolation),
`scripts/bake/render_glb_cycles.py` (true-PBR CPU preview checks),
`scripts/bake/inspect_loose_parts.py` (source recon), and the batch-1 `bake-simple-glb.mjs`
gained a `--length` scale mode and `bake_weapons_blender.py` an FBX import path, a sword
"guard/blade" orientation mode and a texture-wiring helper.

| Asset (`.glb.gz`) | Source | Author / collection | Licence | Changes |
| --- | --- | --- | --- | --- |
| `flamberge` (3,366 tris, 1,217.3 KB gz) | `flamberge.zip` → `source/Flamberg2.fbx` | source archive; licence recorded with the source archive | recorded with the source archive | FBX ships no material: wired the 5-PNG set (baseColor / Normal / Roughness / Metallic) into one Principled material, "crossguard = widest cross-section, blade = longer side" orientation (blade +Y), grip-at-origin (20 % below), decimated 15,998→3,366, textures 1024 JPEG, gzip-9 |
| `mace` (3,366 tris, 246.3 KB gz) | `medieval-mace.zip` → `source/Mace.rar` (extracted with `tar -xf Mace.rar`, bsdtar/libarchive 3.8.9) → `Mace/Mace.fbx` | source archive; licence recorded with the source archive | recorded with the source archive | wired `DefaultMaterial_Base_Color` + `Normal_OpenGL` + Roughness/Metallic into one material, PCA orientation (flanged head = wider end, +Y), grip-at-origin (20 % below), decimated 12,762→3,366, textures 512 JPEG, gzip-9 |
| `camp_tent` (5,940 tris, 1,401.9 KB gz) | `sketchlab/top_down_low_poly_medieval_camp.glb` — tent/shelter cluster only | rakutin (sketchfab.com/rakutin) — "Top down low poly medieval camp" | CC-BY-4.0 | joined the 3-mesh, 8,211-loose-part camp scene, isolated the shelter by connected components (footprint + "tops above the ground clutter") and dropped the boulder-pile material, removed vertex colours + emissive lantern glow, decimated 33,698→5,940, scaled to 3.0 m tall, ground-centre origin, texture 1024 JPEG |
| `stone_wall` (7,907 tris, 789.0 KB gz) | `sketchlab/stone_wall_scan_2.glb` (377,798 tris, 4 index chunks) | JabRomich (sketchfab.com/JabRomich) — "stone wall scan 2" | SKETCHFAB Standard (per the source file's asset metadata) | merged the 4 chunk primitives into one mesh, meshopt-simplified 377,798→7,907, scaled so the wall is 6.0 m long (0.86 m tall, 1.0 m deep), ground-centre origin, baseColor/normal 1024 JPEG |

Batch-2 new-asset total: **3.57 MB** (flamberge 1.19 + mace 0.24 + camp_tent 1.37 + stone_wall
0.77), inside the per-file ≤ 3 MB and batch ≤ 30 MB budgets. Validated with
`node scripts/validate-assets.mjs` (62/62 checks) and `node --import tsx --test tests/assets.test.ts`
(5/5).

Additional deviations / notes for batch 2:

7. **flamberge material** — `Flamberg2.fbx` has no material or texture references at all, so the
   five-PNG texture set from the same archive was wired manually (the exported glTF carries
   baseColor + normal + a packed metallicRoughness map).
8. **mace archive** — the spec's `source/Mace.rar` needed `tar -xf` (bsdtar); it expands to
   `Mace/Mace.fbx` plus a `Mace/` texture folder. `DefaultMaterial_Normal.jpg` exists alongside
   `DefaultMaterial_Normal_OpenGL.jpg`; the OpenGL variant was used because glTF/three.js expect
   the OpenGL (+Y) tangent convention.
9. **camp_tent isolation** — the source is one big top-down camp *scene*, not a tent prop. The
   shelter is a tarp canopy on four poles sharing space with boulders, crates and barrels; it is
   isolated by connected-component filtering on the joined mesh (keep components whose centre is
   in the shelter footprint and whose top is above the ground clutter, minus the boulder-material
   faces). A couple of supply barrels/crates under the canopy are deliberately kept — they read as
   camp shelter equipment. Its colour comes from the shared camp texture atlas (mean sampled
   tent albedo `#5c4b3a`); the source's emissive lantern flag was cleared so the tent does not glow.
10. **stone_wall scale** — the scanned wall is 9.34 m long × 1.35 m tall natively; it is scaled to
    the requested 6 m length (giving a waist-high ruined wall, 0.86 m), which keeps the scan's
    broken ends intact instead of cropping open cross-sections.

## Batch 2026-10C — payload slimming (performance pass)

The user asked for a smoother game, so all 58 shipped custom GLBs and the scanned terrain
textures were re-encoded. **Nothing structural was removed**: rendered triangle counts, skins,
animation clips, node/skeleton names, weapon grip orientation and the glTF contract are unchanged;
embedded texture budgets, unused vertex attributes, material factor fallbacks and primitive
merging (unskinned meshes only) changed.

### Tools added

| Script | Purpose |
| --- | --- |
| `scripts/bake/audit-assets.mjs` | per-GLB gzip size / tris / prims / image dimensions, flags the client preload set |
| `scripts/bake/audit-bytes.mjs` | byte breakdown (geometry attributes vs animation vs images) to target real payload drivers |
| `scripts/bake/optimize-assets.mjs` | the slimming pass: attribute pruning, primitive merge (unskinned), quantisation (pine only), texture re-encode / map→factor replacement, gzip-9 → staged in `temp_sketchlab/optimized` |
| `scripts/bake/optimize-textures.mjs` | scanned terrain textures → 512 (normals + ground detail), filenames unchanged |
| `scripts/bake/verify-staged.mjs` | pre-install gate: re-parses every staged GLB, compares rendered triangles / animations / skins against the live file, decodes every image, re-checks canonical weapon grip bboxes |
| `scripts/bake/install-optimized.mjs` | atomic install: copies every staged file to `<dest>.tmp` first, then a single rename loop swaps all of them (other owners never see a half-installed set) |
| `scripts/validate-assets.mjs` | gained `--root <dir>` so the staged mirror can be validated before installation |

### Policy

| Asset class | Base colour | Normal | Metallic/roughness | Other edits |
| --- | --- | --- | --- | --- |
| 9 characters + 10 weapons + shield (preload set) | 512 JPEG q80–82 | weapons 256 JPEG (dropped on mace/dane_axe/shield), characters had none | replaced by factors (0.85/0.45 metal, 0.25/0.45 shield) | dropped 12 unused UV sets per character (TEXCOORD_1…12), dropped TANGENT/COLOR_0, animations/skins untouched |
| `oak` | 512 JPEG + leaf atlas 512 PNG with alpha | — | factors | stripped unused specular/ior extension layers, dropped MR/emissive maps |
| `pine` | 256 JPEG | — | factors | dropped TEXCOORD_1; **flattened the 2,070 leaf-card meshes / 3,713 nodes into 1 node with 4 primitives** (one per material), all 12,533 rendered triangles kept; tiling UVs wrapped into [0,1] and attributes quantised (`KHR_mesh_quantization`, natively supported by `GLTFLoader`; no decoder) |
| `gatehouse` | 512 JPEG | 256 JPEG | factors (0/0.9) | raw-GLB pre-patch converts the legacy `KHR_materials_pbrSpecularGlossiness` material to plain metal/rough so the shipped file declares no unsupported extension |
| ruins / keep / tower / props | 512 JPEG | 256 JPEG for ruins/stone, dropped on trees/tent/house | factors | MR/occlusion maps dropped, TANGENT dropped, compatible primitives merged |
| `fortress_keep` | 5 × 512 JPEG trimsheets | — | factors | as above |

### Draw-call flattening (the biggest scene win)

`flatten()` bakes every static node transform into the vertex data, then a two-pass `join()` merges
all meshes that share a material (the second pass runs after material factors are normalised, when
previously-distinct materials become identical and dedup collapses them). Skinned meshes are never
flattened. Across all 58 assets this took **2,402 primitives → 78** and **~5,900 nodes → 800**;
`pine` alone went from 2,070 prims / 3,713 nodes to 4 prims / 4 nodes, which is what removes the
"46 cloned pines × 2,070 meshes ≈ 95 k meshes" burst in the scene.

| Asset | prims (before → after) | nodes (before → after) |
| --- | --- | --- |
| `pine` | 2,070 → 4 | 3,713 → 4 |
| `castle_high_citadel` | 68 → 4 | 68 → 4 |
| `gate` | 45 → 1 | 46 → 1 |
| `castle_border_fortress` | 35 → 2 | 35 → 2 |
| `beacon` | 21 → 3 | 22 → 3 |
| `firepit` | 17 → 3 | 18 → 3 |
| `castle_fallen_keep` | 17 → 3 | 17 → 3 |
| `mill` | 16 → 2 | 17 → 2 |
| `barrels` | 12 → 1 | 12 → 1 |
| `fallen_keep` / `cart` / `high_citadel` | 12 / 11 / 11 → 1 | 13 / 11 / 12 → 1 |
| `border_fortress` | 7 → 1 | 8 → 1 |
| `brazier` / `grave` | 6 / 5 → 1 | 6 / 5 → 1 |
| `fortress_keep` | 5 → 5 (five distinct trimsheet materials) | 1 → 1 |
| `oak` / `rapier` | 2 → 2 (two distinct materials each) | 5 / 4 → 2 / 1 |
| all other 38 assets | 1 → 1 | unchanged |

The 13 tiny castle modules (`gate`, `beacon`, `firepit`, `mill`, `braves`…) grew a few KB each
because merging transforms duplicates their shared vertices, but each dropped from 5–68 primitives
to 1–4, which is the right trade at scene scale (their total growth is ~60 KB for ~230 fewer draw
calls). `barrels` (12→1 prim) and `cart` (11→1) grew similarly for the same reason.

### Results (gzip-9, live `public/assets`)

* `public/assets/custom`: **43.51 MB → 9.47 MB** (−78 %), 58 files, every file ≤ 381 KB
  (largest is now `hero`/`templar` at 419/417 KB inside the preload set, then `fortress_keep`
  381 KB; was `oak` 8.26 MB).
* client initial preload set (10 weapons + shield + 9 characters): **12.20 MB → 4.71 MB** (−61 %);
  every character/weapon ≤ 450 KB (largest `hero` 419.2 KB, then `berserker` 418.7).
* `oak` 8,258.5 → **184.2 KB**, `gatehouse` 3,444.3 → **47.2 KB**, `pine` 1,353.6 → **317.1 KB**,
  `fortress_keep` 1,570.6 → **381.2 KB**, `camp_tent` 1,401.9 → **186.5 KB**.
* streamed (post-join) payload: **31.3 MB → 4.76 MB**.
* scanned textures: **6.36 MB → 1.49 MB** (`road_country_normal.png` 1,720→248 KB,
  `cobblestone_normal.png` 1,083→256 KB, `texture_ground_mud_grass.png` 1,723→264 KB,
  `texture_ground_cobblestone.png` 1,345→254 KB at 512², filenames/API unchanged; the two
  base-colour JPEGs are untouched at 1024²).

### Verification

`node scripts/validate-assets.mjs` → 62/62 checks; staged-set gate (`verify-staged.mjs`) reported
"STAGED SET OK (geometry/animations/skins/images intact)" — every rendered triangle count,
animation count, skin count and embedded image matches or decodes; the flatten pass keeps total
primitives at 78 and nodes at 800. Canonical weapon grip bboxes unchanged
(rapier/halberd/dane_axe/flamberge/mace: 20 % handle below origin, blade +Y).

Quantised assets are additionally loaded with the real three.js `GLTFLoader` (images stripped the
same way `tests/equipment.test.ts` does) and their world bounding boxes compared with the
pre-optimisation values — e.g. `pine` comes back at exactly the original
`[-122.44,-1.28,-126.59]…[120.00,324.14,120.00]` with 12,533 rendered triangles and 4 drawables
(was 2,070). `scripts/validate-assets.mjs` also learned to decode normalised quantised POSITION
accessors, so its printed bounds remain meaningful (its AABB is conservative for rotated nodes —
use the GLTFLoader measurement when exact bounds matter).

`node --import tsx --test tests/assets.test.ts` 5/5 and `tests/equipment.test.ts` 5/5 pass on the
installed set.

### Visual trade-offs

* Characters/weapons: 1024→512 base colour (characters) and normal maps at 256 — indistinguishable
  at gameplay distance/night lighting; the equipment/rack UI still reads correctly.
* `pine` is the most aggressive (256 px, quantised attributes, flattened to 4 prims); leaf cards
  are soft up close but the tree silhouette and coverage are unchanged in the night scene.
* The 13 tiny castle modules and `barrels`/`cart` grew a few KB (vertex duplication from merging
  transforms) in exchange for 5–68× fewer draw calls each.
* Ruins/keep keep a 256 px normal map for masonry relief; MR maps were replaced with roughness
  factors (stone/wood are near-uniform rough at night anyway).
* `gatehouse` had a legacy spec/gloss source; the conversion keeps its diffuse + normal maps, so
  the stone look is preserved (verified with a Cycles render).
* No decoders are required: the only extension added is `KHR_mesh_quantization`, read natively by
  `GLTFLoader`; Draco/KTX2/meshopt remain forbidden/absent.

## Batch 2026-10D cycle 1 — tree LODs (`pine_lod`, `oak_lod`)

Distance LODs for the landscape: near instanced trees keep the full `pine`/`oak`, far instances
swap to these low-poly variants. They are decimated from the **current shipped** assets (so the
palette, ground-centre origin and scale convention match exactly and a LOD swap at the same
instance transform does not move the tree), and they keep only the visible parts of the tree.

| Asset (`.glb.gz`) | Source | Changes | Tris | Prims | gzip |
| --- | --- | --- | --- | --- | --- |
| `pine_lod` | `custom/pine.glb.gz` (current, 12,533 rendered tris) | dequantised, dropped the `Groundcover_Wood_Mix` ground disc + `grass` cards (invisible at 60–90 m), meshopt-simplified foliage+bark 12,427 → 2,267, base colours re-encoded to 256 px JPEG (leaf + bark), factor-normalised matte, gzip-9 | **2,267** | 2 (leaf + bark) | **88.3 KB** |
| `oak_lod` | `custom/oak.glb.gz` (current, 7,112 rendered tris) | dequantised, meshopt-simplified 7,112 → 2,474, leaf atlas 512 → 256 PNG (**alpha kept**, `alphaMode: MASK`, cutoff 0.5, doubleSided), bark 256 JPEG, dropped stale specular/ior extension layers, gzip-9 | **2,474** | 2 (leaf + bark) | **79.7 KB** |

Script: `scripts/bake/bake-tree-lods.mjs` (read current asset → dequantise → drop helper prims →
meshopt simplify to the 2,500-tri budget → 256 px textures → alpha-tested foliage → stage in
`temp_sketchlab/optimized_lod` → validate → atomic install via `install-optimized.mjs --stage`).

* Bounds/scale match the full assets (three.js `GLTFLoader` measurement): `pine_lod`
  `[-120.67,-1.28,-101.38]…[107.79,322.25,115.72]` vs full `[-122.44,-1.28,-126.59]…[120.00,324.14,120.00]`
  (foliage extents shrink ~5–12 % from card decimation, trunk base y and scale unchanged);
  `oak_lod` bounds are identical to the full oak. No re-origin, so instances align on swap.
* Foliage correctness: oak keeps its real alpha atlas as a PNG with `MASK`/0.5/`doubleSided`
  (converted from the source's expensive `BLEND` — appropriate for foliage LODs and avoids sort
  artefacts); pine's leaf cards are opaque JPEGs in the source (no alpha channel), so the LOD keeps
  the same opaque cards as the full asset for an exact colour/silhouette match.
* Contract: plain glTF 2.0, gzip-9, embedded images with `bufferView`, indexed prims, TEXCOORD_0,
  no Draco/KTX2/meshopt and no stale extension declarations. `scripts/validate-assets.mjs` budgets
  now include `pine_lod`/`oak_lod` = 2,500 tris; staged mirror validated 64/64 before install.

### Cycle-1 follow-up — `castle_tower_lod`

| Asset (`.glb.gz`) | Source | Changes | Tris | Prims | gzip |
| --- | --- | --- | --- | --- | --- |
| `castle_tower_lod` | `custom/castle_tower.glb.gz` (current, 13,854 tris, 1 prim, 512 px texture) | dequantised, meshopt-simplified 13,854 → 3,939 (ratio 0.286, Permissive), re-quantised (`KHR_mesh_quantization`), base-colour texture and material carried over **byte-identically** (512 px JPEG, 61.6 KB), gzip-9 | **3,939** | 1 | **120.3 KB** |

Script: `scripts/bake/bake-castle-tower-lod.mjs`. For the 18 castle-corner tower instances this cuts
18 × 13,854 ≈ 249 k tris down to 18 × 3,939 ≈ 71 k tris (−178 k tris rendered) with **no change to
draw calls** (both 1 prim) and no payload/palette risk: the texture is not re-encoded.

* Bounds are identical to the full tower (three.js `GLTFLoader`): `[-2.74,0.00,-3.00]…[2.74,9.00,3.00]`
  — ground-centre origin (y = 0) and scale unchanged, so a distance swap at the same instance matrix
  cannot move it.
* `scripts/validate-assets.mjs` budget `castle_tower_lod: 4000`; staged mirror 65/65, live
  65/65 after atomic install; `tests/assets.test.ts` 5/5; preview
  `temp_sketchlab/lod_previews/castle_tower_lod.png` (rough stone silhouette + crenellations read
  correctly; the surface is deliberately softer than the 13.8 k-tri scan, which is what the LOD is for).

### `fortress_keep` LOD assessment (not baked)

`fortress_keep` is 10,923 tris / **5 prims** (five distinct 1024² trimsheet materials) / 381 KB and is
instanced 9× → 98 k tris and 45 draw calls scene-wide. A decimated LOD would save ≈ 75 k tris (about
6 % of a 1.2 M triangle target) but **zero draw calls** because the five materials would still need
five primitives, and the keep is the castle hero landmark (seen at shorter range, with fine
crenellations/windows) so decimation risk is real. Recommendation: **skip a keep LOD** unless draw
calls remain over target. The high-value version of that job would be merging the five trimsheets
into one texture atlas (5 prims → 1 ⇒ 45 draws → 9) rather than a tri-reduction LOD; that is a
separate, larger task (UV re-atlas + bake) and should be scheduled with a QA visual check.

## Batch 2026-10D — character base-colour atlas repair (black characters)

Seven of the nine character bodies (`hero`, `ally`, `fallen`, `templar`, `berserker`, `ranger`,
`survivor`) shipped with a **broken UV0 layout**: 93 % of their triangles had zero UV area (37
islands crammed into 7.9 % of the atlas), so sampling the embedded atlas at the mesh's own UVs
returned the black gutters between charts (UV-sampled mean luminance 5–9 / 255 while the atlas image
itself averaged 37–102). `zombie` and `skeleton-soldier` map correctly and were left untouched.

Fix (geometry/rig/animations untouched apart from the UV seams it requires):

1. `scripts/bake/bake-character-atlas.py` (Blender headless): imports the shipped GLB, rebuilds UV0
   with Smart UV Project (1,216 charts, 58 % UV coverage, 0 % degenerate triangles), builds a
   per-character procedural "dressed armour" material (metal torso/helmet, cloth mid-body, leather
   boots, thin accent trim bands, broad wear noise — Generated-space so frequency is independent of
   the mesh's centimetre-like units) and bakes it with a Cycles **EMIT** pass to 1024² (no lighting
   baked in). The linear bake is converted to sRGB and encoded to a 384²/512² JPEG.
2. `scripts/bake/bake-character-atlases.mjs` (Node): grafts the new UV chart onto the **original**
   skinned primitive. Blender's mesh-only re-export bakes the import transform into the vertices, so
   the script brute-forces the 48 signed axis permutations to recover the similarity transform and
   matches every exported triangle corner back to an original vertex (8,596/8,596 corners matched).
   Vertices are split only where the new UV differs (5,534 → ~8,593 verts — the normal glTF
   representation of UV seams). POSITION and JOINTS_0 are copied verbatim; NORMAL (int8), TEXCOORD_0
   (uint16) and WEIGHTS_0 (uint8) are normalised-packed and the mesh is marked
   `KHR_mesh_quantization` (plain attribute packing, no decoder, read natively by `GLTFLoader`) to
   keep every file inside the 450 KB budget. Animation accessors are untouched and their hashes are
   verified unchanged after the rewrite.
3. Stage → validate the whole mirrored set (65/65) → atomic install (copy-to-`.tmp` + single rename)
   → live validator 65/65; `tests/assets.test.ts` 5/5, `tests/equipment.test.ts` 5/5,
   `tests/armory.test.ts` 5/5.

| Character | atlas image mean (old → new) | **UV-sampled mean (old → new)** | lit UV samples > 25 | gzip (old → new) | atlas |
| --- | --- | --- | --- | --- | --- |
| `hero` | 91.1 → 126.4 | **6.5 → 136.4** | 5.4 % → 99.1 % | 418.7 → 441.3 KB | 384² |
| `templar` | 87.1 → 160.3 | **6.3 → 171.8** | 5.4 % → 99.2 % | 417.3 → 440.4 KB | 384² |
| `ally` | 73.0 → 87.1 | **5.4 → 93.2** | 5.2 % → 98.9 % | 414.2 → 438.6 KB | 384² |
| `survivor` | 71.4 → 97.7 | **5.2 → 105.3** | 5.2 % → 99.3 % | 414.8 → 448.4 KB | 512² |
| `ranger` | 79.4 → 58.7 | **8.5 → 63.1** | 5.3 % → 98.9 % | 416.0 → 444.7 KB | 512² |
| `berserker` | 69.9 → 41.0 | **6.1 → 43.9** | 5.2 % → 98.4 % | 418.0 → 446.7 KB | 512² |
| `fallen` | 36.9 → 36.9 | **5.1 → 39.8** | 3.6 % → 84.2 % | 407.8 → 448.6 KB | 512² |

Rig preservation (checked in the rewrite for every file): triangles 8,449 unchanged, `skins` = 1,
`animations` = 12, animation-sampler accessors hash-identical, canonical node/socket names unchanged.
The darker rows (`berserker` crimson/iron, `fallen` corrupted violet/iron) are intentionally dark
palettes but now read as material with 84–98 % lit samples instead of pure black.

Visual proof (headless-Chrome three.js renders of the shipped GLBs): `temp_sketchlab/atlas/`
`compare_hero.png`, `compare_templar.png`, `shot_hero_after.png`, `shot_templar_after.png`,
`shot_fallen_after.png`; the per-character baked atlases are `hero_basecolor_preview.png` etc. in the
same folder. The hero before/after sheet shows a pure black silhouette vs readable silver armour.

Deviation / cost: each repaired body is 438–449 KB (all still ≤ 450 KB) but ~+6–8 % versus the
slimmed versions — the cost of the UV-seam vertex splits. 512² would not fit for the 384² rows at the
default quality ordering, so the atlas dimension is chosen per character by the budget loop. The
original atlas image is replaced (not kept) and the material stays metallic 0 / roughness 0.85; the
new colour is a procedural armour palette rather than the original hand-painted skin, because the
source UVs made the original atlas unusable and no UV-compatible copy of it exists in the repo.

## Batch 2026-10E — character material v2 + silhouette add-ons

### Phase A — material depth / night tone (7 bodies, installed)

Rebuilt the base-colour atlas and added full PBR map sets on the cycle-1 rigs. Geometry, UV charts,
skins and clips were **not** touched: for every file the POSITION / NORMAL / TEXCOORD_0 / JOINTS_0 /
WEIGHTS_0 accessors, the index buffer and every animation-sampler accessor hash identically before
and after the rewrite (`geometry/anim/skin unchanged = true`).

- Baked with `scripts/bake/bake-character-maps.py` (Blender headless, one material per body: plate
  seams + rivets via Voronoi distance-to-edge, chainmail micro-relief, cloth weave, leather grain,
  heraldic bands, vertical grime): albedo (EMIT, 1024 → 512 sRGB, night tone ×0.82 of cycle-1),
  roughness (EMIT), metallic (EMIT), normal (Cycles NORMAL bake from a procedural bump, relief
  attenuated ×0.62 in the composer so close-ups read as armour rather than hammered clay), AO
  (Cycles AO bake, softened ×0.5 bias so indirect light never crushes the body).
- `scripts/bake/bake-character-maps.mjs` packs them into `baseColorTexture` (512 JPEG), `normalTexture`
  (512 JPEG) and one packed ORM `metallicRoughnessTexture` + `occlusionTexture` (512 JPEG: R = AO,
  G = roughness, B = metalness) with `metallicFactor`/`roughnessFactor` = 1, then re-gzips.
  `GLTFLoader`-compatible, embedded images only, no Draco/KTX2/meshopt.
- Sizes: hero 596.6 · templar 601.4 · ally 591.0 · berserker 592.7 · ranger 594.4 · survivor 592.9 ·
  fallen 594.8 KB (all inside the ~700 KB per-file budget; custom set 9.95 → 11.06 MB).
- Tone: albedo chart mean is 0.84× cycle-1 (cycle-1 in-game third-person torso mean was 102.8, so the
  expected value is ≈ 86, inside the 65–95 acceptance band); close-ups show plate seams, rivet
  relief, wear and AO rather than the previous flat white.

### Phase B — distinct silhouettes as rigid-skinned add-ons (installed)

Each body gained ONE additional primitive on the existing skinned mesh; the mesh node, the single
skin, the 12 clips and the Mixamo hand sockets are untouched (verified; `clips 12`, `sockets true`,
`body/anim unchanged = true` for every body). Add-on vertices are authored in the mesh's bind space
around the exact joint pivot recovered from the inverse-bind matrices (the matrices carry the rig's
uniform scale, so the pivot is solved as a 3×3 system), then weighted 100 % to that joint. Each body
also gets a small dedicated 128² albedo + normal + ORM map set so the add-on reads as a real armour
piece instead of flat colour.

| Body | Add-on | Tris added | Total tris | Prims | gzip |
| --- | --- | --- | --- | --- | --- |
| hero | steel pauldrons (L/R shoulder) | 424 | 8,873 | 2 | 607.3 KB |
| templar | steel pauldrons | 424 | 8,873 | 2 | 612.4 KB |
| ally | steel pauldrons | 424 | 8,873 | 2 | 602.0 KB |
| berserker | steel pauldrons | 424 | 8,873 | 2 | 603.6 KB |
| ranger | hood + shoulder cape (Head / Spine2) | 382 | 8,831 | 2 | 605.2 KB |
| survivor | hood + shoulder cape | 382 | 8,831 | 2 | 604.0 KB |
| fallen | helmet crest fins + corrupted horns (Head) | 204 | 8,653 | 2 | 602.3 KB |

Script: `scripts/bake/bake-character-addons.mjs` (reads the Phase-A asset as its base, so re-runs are
idempotent). Everything is inside the ≤16 k tris/body and ≤700 KB/body budgets.

### Verification (both phases)

Staged mirrored set validated before install (65/65), atomic install (copy-to-.tmp + single rename),
live `scripts/validate-assets.mjs` 65/65, `tests/assets.test.ts` 5/5, `tests/equipment.test.ts` 5/5
(nine-body grounding with the new maps and the extra primitives), `tests/armory.test.ts` 5/5.
Screenshots (headless Chrome + `GLTFLoader`, game-like night IBL at env intensity 2.2):
`temp_sketchlab/atlas2/v2_shot_hero_close.png` (normal/AO detail), `v2_shot_templar_close.png`,
`v2_shot_fallen_close.png`, `final_hero.png` / `final2_ranger.png` / `final2_fallen.png` (silhouettes).

Known limits: add-ons are rigid single-bone attachments (no blended deformation), so very extreme
clips may show a small seam at the attachment; the body atlas still uses procedural palettes rather
than hand-painted skin art; the one extra primitive per body adds one draw call each (7 total).

### `fortress_keep` 5-trimsheet → single-atlas merge (task-33, installed)

The keep was 10,923 tris / **5 prims / 5 materials** (T_Trim 7,402 · T_Wood 1,647 · T_Ground 1,152 ·
T_Wall 646 · T_roof1 76 tris) with five 1024² trimsheets; instanced 9× that is **45 draw calls**.
`scripts/bake/bake-keep-atlas.mjs` repacks the five existing UV spaces into one 2048² atlas
(T_Trim 1024², T_Ground 1024², T_Wall / T_Wood / T_roof1 512² each — the small sheets are
half-res, invisible at night), blits the five source textures into their tiles, scales every prim's
UVs into its tile, concatenates the five primitives into **one primitive** with **one material**
(roughness 0.85 / metallic 0 / double-sided, matching the originals) and then welds + re-quantises
the merged geometry (`KHR_mesh_quantization`, position 14 / normal 10 / texcoord 12 bits).

| | before | after |
| --- | --- | --- |
| prims / materials / textures | 5 / 5 / 5 | **1 / 1 / 1** |
| tris | 10,923 | 10,923 (unchanged) |
| draw calls at 9 keeps | 45 | **9** |
| world bbox | `[-4.981, 0.000, -4.959] … [4.981, 8.000, 4.959]` | identical (same node transform, same POSITION range) |
| file | 381.2 KB | 462.5 KB (atlas 277.6 KB; +81 KB for the merged atlas vs 5 smaller sheets) |

Visual check: headless three.js before/after renders are pixel-comparable (same stone/wood/roof
textures, crenellations and door/window detail preserved); see
`temp_sketchlab/keep_atlas/keep_before.png` / `keep_after2.png`. UV convention note: glTF texture
origin is the **top-left** of the image and `GLTFLoader` uses `flipY=false`, so the atlas row is
`v * height` (an earlier `1 - v` mapping is what produced a black keep during development).
Validation: staged mirror 65/65 (fortress_keep PASS 10,923/14,000 tris) → atomic install → live
65/65; `tests/assets` 5/5, `tests/equipment` 5/5, `tests/armory` 5/5. Custom payload 11.06 → 11.13 MB.

## Batch 2026-10F — region identity assets (effects, foliage v2, props, landmarks)

### Phase A — effects/corruption/decals + foliage v2 + region props (installed)

Textures (`public/assets/textures/`, PNG, procedural, no external refs, night-toned):
`flame_soft.png` 256 (soft additive tongue), `flame_core.png` 128 (bright core), `smoke_puff.png` 128,
`ember_dot.png` 128, `corruption_feather.png` 256 (feathered noisy-edge plague mask), and ground
decals with soft/feathered alpha edges: `snow_patch.png` 512, `ash_patch.png` 512 (ember specks),
`grass_patch.png` 512 (blade strokes). Generator: `scripts/bake/bake-effects-textures.py`.

Foliage v2 + props (`public/assets/custom/`, ground-centred origin y = 0, trunk at x = z = 0, identity
node transforms, geometry in world units, embedded textures, gzip-9):
| asset | tris | prims | gz | native size |
| --- | --- | --- | --- | --- |
| `pine_v2` | 1,272 | 2 | 119.6 KB | 4.55 × 9.08 × 4.43 |
| `snow_pine` | 1,286 | 2 | 115.5 KB | 4.54 × 9.16 × 4.27 |
| `oak_v2` | 514 | 2 | 93.4 KB | 5.89 × 7.26 × 5.98 |
| `maple` | 514 | 2 | 104.7 KB | 6.03 × 7.24 × 5.94 |
| `dead_tree` | 464 | 1 | 91.4 KB | 5.26 × 7.72 × 5.63 |
| `standing_stone` | 63 | 1 | 83.4 KB | 2.99 × 3.25 × 2.90 |
| `ice_shard` | 108 | 1 | 82.0 KB | 1.39 × 1.95 × 0.92 |
Trees use alpha-cut needle/leaf card atlases (`alphaMode: MASK`, cutoff 0.42, doubleSided, bark +
`*_leaves` materials so the landscape foliage regex/wind picks them up). Builder:
`scripts/bake/bake-foliage-props.mjs`. Quality gate: headless three.js renders at 5/10/20 m
(`temp_sketchlab/cycle3_tex/distance_sheet2.png`) show oak_v2/maple holding up at every distance and
pine_v2/snow_pine reading clearly as conifers from 10 m (better than the shipped pine_lod at close
range), so **one card asset per tree serves all distances** and no `_near` LOD variant is needed.

### Phase B — landmark ruins (installed)

Baked from the sketchlab warehouse: `collapsed-gothic-chapel-ruin.zip` (inner FBX scan + 4096
base colour), `vashlovani_tower.glb` (1 M-tri scan, unlit material) and
`medieval-village-house-low-polygame-ready.zip` (FBX). Pipeline:
`scripts/bake/bake-landmark.py` (Blender: import/join, night-toned single material, ground-centre,
full-res GLB export) then `scripts/bake/bake-landmark.mjs` (merge primitives + bake node transforms
into vertices, meshoptimizer simplify to budget, uniform scale to a game height, 1024 night-toned
embedded base colour, quantise). All are 1 prim / 1 material / 1 texture, `KHR_mesh_quantization`,
ground-centred, gzip-9, atomically installed (chapel_ruin replaced under the same name; village
house and watchtower are new).

| asset | tris | budget | gz | size (x × y × z) | note |
| --- | --- | --- | --- | --- | --- |
| `chapel_ruin` | 13,810 | 14,000 | 433.9 KB | 6.90 × 7.00 × 6.44 | replaced; bbox matches the old set-piece asset (6.91 × 7.00 × 6.43) |
| `watchtower_ruin` | 9,817 | 10,000 | 466.7 KB | 6.08 × 10.00 × 6.67 | new; photogrammetry-derived weathered stone |
| `village_house_ruin` | 2,475 | 8,000 | 144.3 KB | 13.81 × 6.50 × 7.66 | new; medieval village house, scale-matched to the ruin set |

Preview: `temp_sketchlab/landmarks/landmarks_sheet2.png` (chapel arches/windows read clearly, house
roof/beams read, tower weathered stone). Note: an early bake produced world-invisible assets because
the exporter had left the original empty scene as the glTF default scene — the Node baker now reuses
scene[0] and sets it as default; worth remembering for any Blender-exported GLB stage.

### Verification

Staged mirrored set validated before every install (72/72 after Phase A, 74/74 after Phase B), atomic
install (copy-to-.tmp + single rename), live `validate-assets.mjs` 74/74, `tests/assets` 5/5,
`tests/equipment` 5/5, `tests/armory` 5/5. Custom payload 11.13 → 12.46 MB (70 files).

## Batch 2026-10G — character armour identity v2 + new props

### Phase A — full armour silhouettes (7 bodies, installed)

Each player/companion body gained **two extra skinned primitives** on the existing Mixamo rig:
`<name>_plate` (hard armour: helm/cuirass/pauldrons/bracers/belt/spikes, roughness 0.62, metalness 0.3)
and `<name>_cloth` (tabard/cloak/hood/fur/pack/quiver, roughness 0.85, metalness 0). Body geometry,
weights, skin and all 12 clips are untouched (hash-verified per body); the cycle-2 small add-ons are
folded into this set (no duplicates). All pieces are authored procedurally in the mesh's bind space
around joint pivots solved from the inverse-bind matrices and rigid-weighted to the matching joint;
each body gets its own 512 procedural armour atlas (metal / cloth / accent bands, night palette).

| body | armour pieces | armour tris | total tris | prims | gz |
| --- | --- | --- | --- | --- | --- |
| templar | great-helm, cuirass, tabard, large pauldrons, bracers, belt | +827 | 9,276 | 3 | 687.8 KB |
| hero | visored helm, knight cuirass, layered pauldrons, bracers, belt | +939 | 9,388 | 2 | 678.3 KB |
| ally | helm, cuirass, tabard, large pauldrons, bracers | +782 | 9,231 | 3 | 670.5 KB |
| berserker | horned helm, bracers, fur shoulders, belt (bare torso) | +300 | 8,749 | 3 | 654.6 KB |
| ranger | hood, long cloak, leather cuirass, quiver, bracers | +572 | 9,021 | 3 | 660.1 KB |
| survivor | hood, ragged cloak, pack, bracers | +408 | 8,857 | 3 | 660.8 KB |
| fallen | crest helm, back plate, spiked pauldrons, bracers | +389 | 8,838 | 2 | 652.8 KB |

All ≤15,500 tris/body and ≤900 KB; every prim has JOINTS_0/WEIGHTS_0 on the single skin, and the six
required clips + hand sockets are preserved. Builder: `scripts/bake/bake-character-armour.mjs`
(reads the cycle-2 Phase-A body with the repaired UVs/atlases, so body material detail is kept).
Armour materials carry a 512 albedo + 256 normal + 256 packed ORM atlas each (band-aligned: plate
metalness ~0.6/roughness ~0.45, cloth 0/0.85, with seam/rivet/weave relief in the normal), plus a
richer palette (two-tone metal with patina/seams/rivets/scratch grain, two-tone cloth with weave,
folds and stains, three-tone heraldry) — unique RGB in the armour atlas rose 15–53 % per body after
weapons-armory's close-up audit (templar 9,050→10,745, hero 5,810→7,872, ally 5,899→6,772,
survivor 3,519→4,346, fallen 3,191→4,889).
Runtime note: the material names follow `<body>_plate` (hard armour) / `<body>_cloth` (soft) so
`custom-character.ts` can tint the two classes separately.

**Cycle-4 freeze (Lead accepted this state) and cycle-5 backlog.** The shipped armour set is the
654.6–704.3 KB / normal+ORM-equipped build above; no further character asset changes in cycle 4.
Deferred to cycle 5 as an art task: (a) body-mask close-up colour variety is 250–515 on
weapons-armory's 5-bit alpha-mask metric vs the ≥500 target — next steps are a 1024 armour atlas
(tight at ~884 KB for templar under the 900 KB cap, so likely only for the low-variety bodies
survivor/ally/fallen) plus strongly *hue*-separated patina/trim variation rather than luminance
mottling, because at night tone + ACES the quantised colour count is dominated by lighting range;
(b) plate faces read as oversized flat panels with stretched "wood grain" at 2.8 m — needs tighter
UV texel density (triplanar/world-scale mapping instead of the current per-piece 0–1 band mapping),
trimmed plate shapes that follow the body curves, and eventually sculpted/hand-made armour detail.

### Phase B — stone well + blacksmith stall (installed)

| asset | tris | prims | gz | bbox (x × y × z) | source |
| --- | --- | --- | --- | --- | --- |
| `stone_well` | 2,968 | 1 | 217.0 KB | 1.82 × 1.60 × 1.72 | medieval-stone-well scan (1.9 M tris simplified, scaled to 1.6 m) |
| `blacksmith_stall` | 196 | 1 | 15.9 KB | 3.80 × 3.05 × 2.38 | procedural forge hearth + anvil + canopy + tool rack |

Both are ground-centred (min y = 0, centred x/z), single 512 embedded night-toned base colour,
`KHR_mesh_quantization`, gzip-9, atomically installed. Note: the warehouse `medieval-props-asset`
candidate turned out to be a wooden chest rather than a stall, so the blacksmith stall is built
procedurally in the same night palette (cheap, 196 tris) pending a better warehouse stall asset.
Preview: `temp_sketchlab/armour/props_sheet.png`; armour sheets `temp_sketchlab/armour/m10_sheet.png`.

### Verification

Staged mirrors validated before every install (74/74 after the armour pass, 76/76 after the props),
atomic install (copy-to-.tmp + single rename), live `validate-assets.mjs` **76/76**,
`tests/assets` 5/5, `tests/equipment` 5/5, `tests/armory` 5/5 (all after both phases).

## Batch 2026-10H — armour art v3 + altar/forge props

### Phase A — armour v3 (7 bodies, installed)

Cleared the cycle-4 art debt:
- **Uniform texel density**: the per-piece 0–1 band mapping was replaced by world-scale UVs — each
  piece's own parametrisation is scaled by its real size (≈1 tile / 2.6 world units; revolved pieces
  by circumference × height, sheets by real width/height, boxes by planar world mapping), so plate
  faces no longer stretch one tile across a whole panel. The atlas content was also moved to
  low-frequency gradients + broad patina (the earlier high-frequency seams/rivets tiled visibly and
  read as "wood grain"), and the normal relief was softened (S = 1.3).
- **Hue-separated detail**: plate = blue-grey steel tones + teal-green patina + rust-orange + dark
  oxide patches; cloth = hue-shifted brown/olive/purple stains + accent trim; heraldry = three hue
  families with broad cross/band patterns. Armour atlas is **1024² on all seven bodies** (all fit the
  budget; no 512 fallback needed).
- **Survivor identity**: no plate at all — tattered hood, tattered cloak (jagged hem + sewn patches),
  bedroll/satchel pack, rope belt, walking staff rigid-weighted to RightHand, faded brown/tan palette
  with orange-red patch accents (+498 armour tris).
| body | armour tris | total tris | prims | gz |
| --- | --- | --- | --- | --- |
| templar | +863 | 9,312 | 3 | 781.7 KB |
| hero | +984 | 9,433 | 2 | 767.5 KB |
| ally | +818 | 9,267 | 3 | 783.8 KB |
| berserker | +300 | 8,749 | 3 | 743.1 KB |
| ranger | +572 | 9,021 | 3 | 731.9 KB |
| survivor | +552 | 9,001 | 3 | 766.4 KB |
| fallen | +425 | 8,874 | 2 | 706.6 KB |
**Final cycle-5 pass** (hue chips + plate-triangle split, atlas-only for the colours): cloth band got
per-panel hue-shifted patchwork panels, contrasting stitch lines and a per-texel hue-jittered weave;
the ranger palette was darkened to forest-leather with an ochre accent; armour geometry now splits any
triangle over 0.5 bind-unit² so no plate face reads as one big quad (fallen max face 0.0353 → 0.0095 m²,
max edge ≤0.479 m across all bodies). Proxy 5-bit masked close-up colour variety after the pass:
templar 1427 · hero 1047 · ally 1213 · berserker 679 · ranger 509 · survivor 1048 · fallen 588 →
**7/7 above 500 on the local proxy**.

**Authoritative masked numbers** (weapons-armory's body-silhouette mask, 5-bit unique colours, 2.8 m
close-up) for the frozen final bytes: templar **606** (was 521), berserker **739** (519), survivor
**1073** (519), ally **697** (495), hero **402** (379), fallen **424** (363), ranger **376** (203) —
4/7 ≥500 on the strict mask. Cycle-6 backlog targets (per weapons-armory's per-prim analysis):
- ranger (376): the big pale hood/cloak panels dominate; break up the **cloak exterior** with
  hue-separated panels/patches (the hood already shows the chips).
- hero (402): plate prim dominates (all-hard-armour body) — add **plate hue chips / coloured trim**
  on the large pauldron and cuirass faces.
- fallen (424): plate prim dominates — add **patina/rust hue chips across the large corrupted plates**
  (the crest/back piece is split now but still smooth).
Evidence: `temp_sketchlab/armour/v3h_close_{body}.png`, `v3_sil_sheet.png`.

### Phase B — stone altar + forge furnace (installed)

| asset | tris | prims | gz | bbox (x × y × z) | source |
| --- | --- | --- | --- | --- | --- |
| `stone_altar` | 3,944 | 1 | 215.7 KB | 1.02 × 1.10 × 1.84 | gothic candle/wax/ritual-book altar scan (1.9 M tris simplified, scaled to 1.1 m) |
| `forge_furnace` | 6,979 | 1 | 274.2 KB | 5.87 × 2.90 × 3.45 | furnace asset (brick/stone forge with hood and fire bowl, scaled to 2.9 m) |

Both ground-centred (min y = 0, centred x/z), single night-toned embedded base colour (512 / 1024),
`KHR_mesh_quantization`, gzip-9, atomically installed. Preview:
`temp_sketchlab/armour/props5_sheet.png`.

### Verification

Staged mirrors validated before each install (76/76 armour v3, 78/78 props), atomic install
(copy-to-.tmp + single rename), live `validate-assets.mjs` **78/78**, `tests/assets` 5/5,
`tests/armory` 5/5 after both phases. `tests/equipment` is 5/5 for the cycle-5 state; the cycle-6
rebuild below changes the survivor staff weighting, so that assertion needs the cycle-6 update.

## Batch 2026-10S — body-scan base-atlas tone pass (cycle 16)

The v5.1 armour atlas reads coherently, but the **base body colour atlas** (arms / legs / torso skin +
underlayer, a separate 512² scan texture) still read pale blue-grey next to the steel and leather.
Cycle 16 tones that texture only: warm + desaturate + a slight value floor and a gentle overall value
reduction, so the limbs read as a skin/leather underlayer instead of bright stone, while contrast is
preserved so faces/hands stay readable.

Builder: `scripts/bake/tone-body-atlas.mjs` (operates on the shipped GLBs, replaces only the body
primitive's baseColor texture; verifies body indices/positions and every animation hash unchanged and
every other texture byte-identical). Parameters: `desat 0.74`, `warm 1.10` / `blue 0.85`,
`value 0.86`, `floor 0.03` (all CLI-overridable).

| body | torso mean before → after | p50 | torso sat | arms mean/sat | legs mean/sat |
| --- | --- | --- | --- | --- | --- |
| templar | 101.4 → 88.9 | 102.6 → 87.7 | 0.20 → 0.34 | 86.6 → 77.3 / .34 | 79.2 → 66.6 / .36 |
| hero | 103.3 → 90.6 | 104.2 → 89.5 | 0.16 → 0.31 | 82.2 → 73.3 / .31 | 81.8 → 69.2 / .31 |
| ally | 101.1 → 88.5 | 99.3 → 84.7 | 0.17 → 0.32 | 84.5 → 74.6 / .29 | 81.6 → 68.8 / .33 |
| berserker | 96.8 → 84.3 | 95.4 → 81.5 | 0.19 → 0.35 | 73.5 → 65.4 / .33 | 75.8 → 64.9 / .32 |
| ranger | 96.2 → 84.5 | 95.3 → 81.3 | 0.19 → 0.34 | 67.9 → 61.3 / .36 | 77.3 → 65.1 / .33 |
| survivor | 94.1 → 82.4 | 92.4 → 78.5 | 0.20 → 0.34 | 82.9 → 70.3 / .39 | 75.6 → 64.2 / .32 |
| fallen | 100.6 → 87.8 | 97.6 → 83.7 | 0.16 → 0.32 | 66.6 → 58.1 / .36 | 76.9 → 65.3 / .31 |

(stats: night viewer, front capture at 2.5 m, background/ground masked; "arms"/"legs" are fixed side
and lower-leg boxes.)

Strict silhouette-mask palette with the repo counter `qa/masked-palette.py` on the installed bytes:
templar **1246** (228+1018) · hero **982** (181+801) · ally **1265** (163+1102) ·
berserker **805** (178+627) · ranger **839** (171+668) · survivor **801** (177+624) ·
fallen **850** (174+676) → **7/7 ≥801**, all ≥560. Files 726.0–752.3 KB. Body/anim
hashes and prim/skin/clip counts unchanged; only texture index 0 differs from the pre-pass backup
(armour textures byte-identical). Validator 87/87, tests/assets + equipment + armory 5/5.
Backups: `temp_sketchlab/backups/v51_pre_bodytone_cycle16/` (armour v5.1 + old body atlas) and the
`armour_v5_cycle15/` / `armour_v4_cycle14/` sets. Before/after captures:
`temp_sketchlab/armour/c16_{before,final}_{front,back}_sheet.png`, head check `c16_{before,after}_hero_head.png`.

QA gate recommendation for the limb tone: in-game front capture, measure torso and fixed forearm /
lower-leg boxes: limb mean should be ≤ torso mean + 3 (limbs no longer brighter/paler), limb saturation
≥ 0.25, torso mean/p50 inside 60–95, strict mask 7/7 ≥560.

## Batch 2026-10R — armour atlas v5 (cycle 15)

Rebaked the procedural **armour atlas** for all seven bodies to replace the cycle-6/7 strict-mask
"hue chips / chip blocks / cloth patches" look, which read as rainbow patchwork at 2–3 m.

### What changed in the bake

`scripts/bake/bake-character-armour.mjs` `makeAtlas()` is a new four-band coherent-material atlas
(the old `metalChips` / `metalHueAmp` / `chipBoost` / `chipBlocks` / `plateFamilies` / `plateGems` /
`plateStripes` / `clothPatches` / `clothHueAmp` knobs are gone; all per-body `atlas:` option blocks
were removed, so a rebuild cannot reintroduce the debug chips):

| band (v) | material | content |
| --- | --- | --- |
| 0.00–0.40 | steel plate | large coherent field, low-frequency value variation, brushed streaks, four×six panel seams with regular brass rivets, top-edge scuffs, bottom weathering/dirt gradient, rare diagonal scratches |
| 0.40–0.62 | dark leather | straps / underlayers / quivers / packs, fine grain, worn top edge, dashed brass stitching |
| 0.62–0.86 | faction cloth | clean panel colour (deep red / steel blue / moss green / rust / brown), five vertical panel seams with highlight, restrained brass emblem rules near the top, hem dirt gradient, subtle weave |
| 0.86–1.00 | brass trim | restrained warm accent for belts/trim/crests, grooved with worn polish |

Pieces are assigned to bands by their own role: `belt`, `quiver`, `survivorPack`, `ropeBelt`, `pack`,
`leatherCuirass`, `walkingStaff` → **leather**; cloth garments (tabards, cloaks, hoods, fur, packs cloth,
tattered layers) → **cloth**; helmets/cuirasses/pauldrons/bracers/back plates → **steel**; belts/hem
trim bits → **trim**. Steel and trim ORM metalness was lowered (0.47–0.63 steel, 0.66–0.83 trim)
and matching roughness raised so the night IBL no longer blows the plate fields out to pale stone.

Per-body palettes were re-authored around faction identity: templar steel + deep red, hero bright steel
+ steel blue, ally blue-grey steel + steel blue, berserker dark steel + rust, ranger dull steel + moss
green + leather, survivor brown/tan leather+cloth, fallen dark violet steel + black-purple cloth.

### v5.1 structured-variety pass (strict-mask repair)

The coherent v5 atlas dropped the strict silhouette-mask palette below the gate because all of the
random chip knobs were deleted. v5.1 keeps the coherent material read and adds **structured** variety
only (no random chips), per the cycle-15b brief:
- steel: 24 plates (4 rows × 6 columns), each with its own value/hue step, a raised edge highlight,
  a mid-tone inset panel and regular rivet rows in three brass shades (`#c9a24b`, `#a87c2f`, `#8a6420`)
  with dark-iron (`#4a4038`) shadow variants;
- leather: 3 tone segments per strap with brass buckles, dark pins and dark/off-white dashed stitching;
- cloth: 5 panels with per-panel tone/hue steps, fold shading, stitched seam lines, an off-white rule
  and (on emblem panels) a 3-stripe emblem block in dark shadow / brass / off-white;
- trim: alternating brass / steel / dark-leather segments with rivet heads at each end.
Measured with the repo counter `qa/masked-palette.py` on the installed bytes (body image + armour image,
both images summed as the counter reports):

| body | body img | armour img | total | torso mean |
| --- | --- | --- | --- | --- |
| templar | 293 | 1018 | **1311** | 91.3 |
| hero | 186 | 801 | **987** | 92.4 |
| ally | 112 | 1102 | **1214** | 92.4 |
| berserker | 89 | 627 | **716** | 91.0 |
| ranger | 136 | 666 | **802** | 79.9 |
| survivor | 104 | 624 | **728** | 87.1 |
| fallen | 101 | 676 | **777** | 90.3 |
All seven ≥560 (target) and ≥500 (house gate 7/7); torso means inside 60–95; file sizes
718–746 KB. Backups: `temp_sketchlab/backups/armour_v4_cycle14/` (pre-v5) and
`armour_v5_cycle15/` (v5 coherent-only). Captures: `temp_sketchlab/armour/c15b_{front,back}_sheet.png`.

### Measured (viewer close-ups, before → after)

| body | tris | prims | KB | torso mean (front) |
| --- | --- | --- | --- | --- |
| templar | 9,312 | 3 | 701.6 | 108.0 → 93.6 |
| hero | 9,433 | 2 | 701.6 | 105.6 → 93.6 |
| ally | 9,267 | 3 | 698.0 | 97.7 → 94.3 |
| berserker | 8,749 | 3 | 680.5 | 97.9 → 91.1 |
| ranger | 9,021 | 3 | 682.5 | 93.0 → 80.2 |
| survivor | 9,001 | 3 | 677.4 | 94.5 → 88.0 |
| fallen | 8,874 | 2 | 674.8 | 97.5 → 90.2 |
All ≤900 KB, tri/prim/skin/clip counts unchanged, body/anim hashes verified unchanged per file.
Before/after captures: `temp_sketchlab/armour/c15_before_{front,back}_sheet.png`,
`c15_final_{front,back}_sheet.png`, per-body `c15_{body}_before_after.png`; v4 bytes backed up in
`temp_sketchlab/backups/armour_v4_cycle14/`. Validator 87/87, tests/assets + equipment + armory 5/5.

## Batch 2026-10Q — windmill tower + sails (cycle 14)

Two procedural night-palette assets (no warehouse windmill existed), built by
`scripts/bake/bake-windmill.mjs` from a shared 512² atlas (stone / timber / canvas / iron / dark
bands), one primitive + one material each, quantized (`KHR_mesh_quantization`), gzip-9, no lights.

| asset | tris | prims | gzip | bbox (x × y × z) | pivot / orientation |
| --- | --- | --- | --- | --- | --- |
| `windmill` | 1,000 | 1 | 38.1 KB | 6.10 × 10.01 × 6.45 | ground-centred (min y = 0, x/z centred), door faces **+Z**; stone shaft with timber bands, door + porch, five windows, gallery deck/railing at 6.9–8.0 m, conical cap + finial to 10.0 m |
| `windmill_sails` | 668 | 1 | 35.8 KB | 7.17 × 7.17 × 0.68 | **hub pivot at the local origin** (bbox symmetric ±3.585 x/y, ±0.34 z), 4 lattice sail blades in the **XY plane** → animate a single rotation about **local Z** |

Mounting contract for the client: add the sails mesh as a child group of the tower at tower-local
**(0, 7.20, +3.45)** (in front of the gallery, clear of its 3.05 m overhang) and rotate that group
about its own **Z axis** (positive = counter-clockwise seen from the +Z front). Blade tips sweep a
7.17 m diameter, y ≈ 3.6–10.8 m. Reduced-motion = stopped. Validator budgets
`windmill: 2500`, `windmill_sails: 800`. Previews: `temp_sketchlab/armour/c14_windmill2.png`,
`c14_sails2.png`. Payload 83 files / 15.32 MB.

## Batch 2026-10P — camp/village props (cycle 13)

Three roadside/camp dressing props, authored procedurally in the night palette because the warehouse
candidates for these specific props were not usable as-is (the `top_down_low_poly_medieval_camp` GLB
separates into 6,577 loose parts, `medieval-castle-modular-kits-interior` is a ruined room, and
`medieval-props-asset-low-poly` contains only a chest/barrel/box). Builder:
`scripts/bake/bake-camp-props.mjs` (same approach as the blacksmith_stall precedent). Each prop: one
primitive, one 512² atlas with shared bands (wood / iron / parchment / stone / ember), roughness 0.86,
metallic 0.08, no lights, gzip-9, no extensions, ground-centred (min y = 0, centred x/z), front faces
**+Z**.

| prop | tris | prims | gzip | bbox (x × y × z) | read / use |
| --- | --- | --- | --- | --- | --- |
| `notice_board` | 192 | 1 | 34.1 KB | 2.00 × 2.26 × 0.72 | twin posts, board covered in pale notices, lean-to shingle roof, iron brackets, stone feet — village/quest board |
| `fence_segment` | 252 | 1 | 34.5 KB | 2.57 × 1.35 × 0.24 | two rails in front of seven pickets, four capped posts — camp/road boundary; long axis X, symmetric enough to face either way |
| `torch_post` | 152 | 1 | 33.7 KB | 0.64 × 2.50 × 0.64 | stone footing, iron-banded pole, iron basket with charcoal bed — road-side milestone/torch stand (no light source) |

Validator budgets added (`notice_board`/`fence_segment`/`torch_post`: 3,000). Previews:
`temp_sketchlab/armour/c13c_props_sheet.png`. Payload 81 files / 15.29 MB.

## Batch 2026-10L — war spear + ruined abbey (cycle 9)

### Phase A — `spear` (11th weapon, installed)

Baked from the `low-poly-spear-set` warehouse pack: `scripts/bake/bake-spear-source.py` picks one of
the six spear variants from `Low.fbx`, joins it with the `lambert1` basecolour/normal material and
exports `spear_source.glb`; `scripts/bake/bake-weapons.mjs` then bakes it through the standard weapon
pipeline (new `girthMax` head heuristic + `normalizeHeight` + `dropNormal` + night-tone options).

- **Canonical orientation** (same convention as halberd/rapier/dane_axe/flamberge/mace): grip at local
  origin (0,0,0), point/blade along **+Y**, vertical shaft, x/z centred (x −0.038…+0.037,
  z ±0.019); blade tip **y=+1.760**, butt **y=−0.440** (handle = 20 % of length below origin);
  **total length 2.200** = `WEAPONS.spear.length`, so `equipmentModel` scale is exactly 1.0 and
  `WEAPON_GRIPS.spear = {grip:[0,0,0], blade:[0,1,0]}` needs no re-fit rotation.
- Contract: **504 tris / 1 prim / 44.1 KB gzip**, one embedded 512² night-toned JPEG albedo
  (0.84× + cool tint; no normal map to keep the payload in weapon range), indexed + TEXCOORD_0,
  no skins/animations, no extensions. Validator budget `spear: 3400`; spear added to the weapon class
  (no-skin/no-animation assertions). Preview: `temp_sketchlab/armour/c9_spear3.png`.

### Phase B — `abbey_ruin` (installed)

Baked from `overgrown-courtyard-patio-ruin.zip` (Tripo courtyard/patio scan, 1.91 M tris) through the
landmark pipeline: Blender export (`bake-landmark.py`, 1,024 night-toned basecolour) then
`bake-landmark.mjs` (meshopt simplify + ground-centre + quantize + 1,024 embedded JPEG).
- **13,786 tris / 1 prim / 406.8 KB gzip** (budget 14,000), `KHR_mesh_quantization`, gzip-9.
- **bbox 7.411 × 5.000 × 7.390 m** (x × y × z), min y = 0, centred on x/z
  (±3.71 / ±3.70) — comparable footprint to `chapel_ruin` (6.90 × 7.00 × 6.44),
  reads as an overgrown cloister/courtyard: colonnade, balustrade, vine-covered posts.
- Preview: `temp_sketchlab/armour/c9_abbey.png`. Validator budget `abbey_ruin: 14000`.

### Verification

Staged mirror 82/82 before install, atomic install (spear new; abbey_ruin new + 7 unchanged landmark
files re-written from the same staged bytes), live `validate-assets.mjs` **82/82**,
`tests/assets` 5/5, `tests/equipment` 5/5, `tests/armory` 5/5; payload 78 files / ~15.2 MB.

## Batch 2026-10K — zombie-bloated night tone + hero headroom (cycle 8)

Two asset files were touched this cycle; everything else is byte-identical to cycle 7.

### zombie-bloated night tone

The bloated variant read too bright at close range (weapons-armory's 2.8 m mask: body mean 126 vs base
zombie 83). The fix was **albedo level, not mottle**, applied in three measured steps:
1. body albedo x0.78, add-on albedo x0.62, plague material roughness 0.85 -> 0.95 (mean 126 -> 112.7);
2. add-on albedo -> x0.52 (112.7 -> 110.5 — confirming the big-belly mean is lighting-dominated);
3. explicit `baseColorFactor` 0.85 on BOTH bloated materials plus body albedo x0.72 (final).
Final contract: **10,620 tris / 2 prims / 30-joint skin / 10 clips / 358.6 KB**, silhouette and clips
unchanged. Local harness close-up body mean: base 64.3 -> bloated 62.5 (same mask); weapons-armory's
pose-pinned mask measured **106.94 on the final bytes (base zombie 82.45)**, down from 131 at cycle 7
via 110.5 (factor-less) — i.e. the last global lever moved it only ~3.5 points because this render's
mean is lighting-dominated, not albedo-dominated. **Accepted and frozen at base+24**: the silhouette and
palette read as intentionally plague-pale, and a factor low enough to reach 100 (~0.65) would erode the
read. Cycle-9 nicety (optional): bias the lighting contribution instead (slightly darker emissive /
roughness bias), not more albedo shrink. Preview: `temp_sketchlab/armour/c8_bloat5.png`.

### hero strict-mask headroom (closed as "no change")

A headroom candidate (stronger large-scale luminance blocks + hue-family tint + sparse saturated
heraldic inset chips on the big plate faces) was built and measured: weapons-armory's strict mask came
in at **492 vs 526** for the cycle-7 bytes — the block/chip lever loses strict colours even though the
wide local proxy barely moved (1304 -> 1210). Hero was therefore **reverted byte-for-byte** to the
cycle-7 file (sha verified, 783.4 KB, strict **526**), and the bake-script options were reverted to the
cycle-7 values; the experimental headroom code (hue families / stripes / inset chips) remains in the
builder dormant at 0 defaults. Cycle-9 note: hero headroom should be attacked via the **body atlas**
(the lever that took ranger 379 -> 651), not more plate texture.

### Verification

Staged mirrors 80/80 before every install, atomic installs, live `validate-assets.mjs` **80/80**,
`tests/assets` 5/5, `tests/equipment` 5/5, `tests/armory` 5/5; payload 76 files / 14.75 MB;
`hero.glb.gz` byte-identical to the cycle-7 accepted file; no stray `.tmp`.

## Batch 2026-10J — enemy variants + strict-mask palette (cycle 7)

### Phase A — undead variants (installed, additional assets)

Two new files reuse the existing enemy rigs/clips unchanged (base zombie / skeleton-soldier
files are byte-identical, untouched). Builder: scripts/bake/bake-enemy-variants.mjs (append a
skinning primitive to the base GLB; body indices/positions and animation hashes verified identical;
every prim has JOINTS_0/WEIGHTS_0 with rigid single-joint weights; embedded 256 JPEG; gzip-9; no new
extensions). Validator budgets added: zombie-bloated 11,000 tris, skeleton-armoured 8,500.

| asset | tris | prims | joints | clips | gz | add-on |
| --- | --- | --- | --- | --- | --- | --- |
| zombie-bloated | 10,620 | 2 | 30 | 10 | 358.9 KB | +620 |
| skeleton-armoured | 7,089 | 2 | 51 | 9 | 285.9 KB | +268 |

zombie-bloated: obese belly/chest masses (spine_02/03), back hump (spine_04), shoulder/arm/neck
tumours and hanging belly folds, all rigid to existing joints, plague-green pustule palette.
skeleton-armoured: iron bucket helm with rim/crest (Head1), domed pauldrons (both UpperArms) and a
kite shield on the left forearm (L_Forearm), aged-iron + bone palette. Preview:
	emp_sketchlab/armour/enemies_sheet3.png.

### Phase B — strict-mask palette (ranger / hero / fallen)

Atlas-only rebuild of three bodies (other four untouched):
- ranger: cloak base lightened from dark forest-green to mid-tone (0.16/0.22/0.13 →
  0.34/0.42/0.26) with a brighter accent, un-crushing the hue panels under 5-bit quantisation.
- hero: coarser paint chips (7×6 cells), full-strength cream/gold chips, dark trim bands beside the
  coloured ones and bright rivet accents for two-way luminance separation.
- fallen: stronger patina coverage plus a bright-rust blob pass (patinaBoost 1.9).

| body | tris | prims | gz | wide-proxy colours (before → after) |
| --- | --- | --- | --- | --- |
| ranger | 9,021 | 3 | 811.2 KB | 520 → 895 |
| hero | 9,433 | 2 | 780.9 KB | 1,228 → 1,348 |
| fallen | 8,874 | 2 | 736.8 KB | 590 → 908 |
Unchanged: templar 781.7 KB, berserker 743.1 KB, ally 783.8 KB, survivor 772.7 KB. Authority for the
acceptance gate remains weapons-armory's strict silhouette mask; the wide local proxy is an indicator
only. Preview: 	emp_sketchlab/armour/c7_close_{body}.png.

### Final strict-mask result (cycle-7, weapons-armory pose-pinned mask)

**7/7 bodies ≥500** after the polish pass: templar 561, hero **526** (was 491; gentle large-scale
luminance blocks tipped it), berserker 721, ranger **651** (was 379), ally 694, survivor 1082,
fallen **937** (was 460). SPEC target (≥5/7) exceeded. Hero close-up evidence:
qa/char-viewer/shots/c7h2-base-closeup-hero.png.

**Cycle-8 note (zombie-bloated)**: night-matching lowered the close-up body mean 131 → 126 and the
finer mottle reduced the coarse blocking, but it still reads brighter than the base zombie (83) and the
2.8 m belly shows some pale patch structure. Acceptable at gameplay distance as an intentional
plague-pale blob; the remaining lever if cycle 8 touches it is the additive belly albedo's **overall
level** (not more mottle). Variant contract unchanged: 10,620 tris / 2 prims / 30 joints / 10 clips /
361.0 KB.

### Polish pass (after weapons-armory's cycle-7 verification)

- **hero**: strict mask came in at 491 (9 short of 500) because the large plate faces still quantise
  down at night; added gentle large-scale luminance blocks over the biggest pauldron/cuirass faces
  (brightened plates + slightly darkened ones, no hard blocks so the chip variation is preserved).
  heroes file 783.4 KB (was 780.9).
- **zombie-bloated**: the variant read much brighter than the base zombie at night (close-up body mean
  131 vs 83) and its belly albedo was blocky at 2.8 m; the add-on plague texture was night-matched
  (texture mean RGB 61.6 vs base 99.2) and given finer 2 px / 8 px mottle. Variant 361.0 KB (was 358.9).

### Verification

Staged mirrors 80/80 before both installs, atomic installs (2 new files for Phase A, 3 replaced for
Phase B), live alidate-assets.mjs **80/80**, 	ests/assets 5/5, 	ests/equipment 5/5,
	ests/armory 5/5. Custom payload 76 files / 14.68 MB.

## Batch 2026-10I — masked-palette hue chips + survivor staff stow (cycle 6)

Rebuilt 4 of the 7 bodies (atlas-only for the palette work, plus the Lead-requested survivor staff
reweight); the other three bodies are byte-unchanged.

- **ranger**: cloth band driven with `clothHueAmp 4.0` + dyed/stitched patchwork panels and panel
  seams, aimed at the large smooth cloak exterior (the hood/edges already read on the strict mask).
- **hero**: plate band now carries broad coloured trim bands + paint chips (blue/gold/cream) via
  `metalChips 0.85 / metalHueAmp 2.4` — the body is all plate, so the hue variety has to live on the
  pauldron/cuirass/helm faces.
- **fallen**: same plate-chip mechanism pushed to `metalChips 0.9 / metalHueAmp 3.0` for
  patina/rust/trim chips across the corrupted plates.
- **survivor**: the walking staff is no longer rigid-weighted to `mixamorigRightHand` (it swung with
  a sword and clashed with shields once the survivor became a playable appearance). It is now rigid
  to `mixamorigSpine2` and authored stowed diagonally across the back; `survivor_plate` dominant
  joints are Hips 50 / Spine2 52 verts with zero RightHand-weighted armour vertices, so hands stay
  free for weapons and no runtime change is needed.

| body | tris | prims | gz | my-proxy masked colours (before → after) |
| --- | --- | --- | --- | --- |
| ranger | 9,021 | 3 | 761.6 KB | 509 → 520 |
| hero | 9,433 | 2 | 779.6 KB | 1,047 → 1,228 |
| fallen | 8,874 | 2 | 714.7 KB | 588 → 590 |
| survivor | 8,989 | 3 | 772.7 KB | 1,048 → 1,058 (staff stowed) |
Unchanged: templar 9,312 / 781.7 KB, berserker 8,749 / 743.1 KB, ally 9,267 / 783.8 KB.
The acceptance counter is weapons-armory's strict body-silhouette mask (5-bit unique colours, 2.8 m
close-up) — the local proxy above is a different, wider mask and is only an indicator. Evidence:
`temp_sketchlab/armour/c6final_close_{body}.png`, `c6_survivor_staff.png`. Installed atomically;
staged mirror 78/78 → live validator **78/78**; assets 5/5, equipment 5/5 (after the survivor staff
assertion was updated to Spine2), armory 5/5.

**Strict-mask result on the cycle-6 bytes** (weapons-armory, pose-pinned deterministic 30-step pose,
2.8 m close-ups): templar 559 · ally 707 · berserker 725 · survivor 1,077 → **4/7 ≥500**;
hero 454 (was 402), fallen 460 (was 424), ranger 379 (was 376). SPEC target of ≥5/7 is therefore not
met on the strict mask this cycle; the Lead accepted the state and the remainder is a cycle-7 item.
Plate geometry passes everywhere (max face 0.0028–0.0088 m², max edge ≤0.467 m) and the survivor
staff reweight is confirmed (rigid only to Spine2/Hips, zero hand-rigid vertices).

**Cycle-7 backlog (masked palette, per weapons-armory's dominant-prim analysis):**
- **ranger** (379, cloth-dominant): the re-dyed cloak got darker — close-up black% rose 4.3 → 6.2,
  which costs quantised colour. Fix is to **lighten the dye/panel base so the hue chips survive 5-bit
  quantisation** (and/or add extra cloak-panel geometry), not more atlas tiling.
- **hero** (454, plate-dominant): plate chips helped (+52) but need **stronger luminance-separated
  chips/coloured trim** on the large pauldron/cuirass faces (5-bit quantisation collapses subtle
  chromatic variation at night tone).
- **fallen** (460, plate-dominant): same — **bigger, brighter patina/rust chips** across the corrupted
  plates rather than more subtle mottling.
