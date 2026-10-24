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
