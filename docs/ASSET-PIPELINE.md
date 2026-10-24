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
