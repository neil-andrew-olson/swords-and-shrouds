# Swords & Shrouds — Batch 2026-10 (Objectives 1–5) — Team Specification

This is the shared contract for the current autonomous development batch. Every teammate must read
this before touching files. The Lead owns integration, git, and deployment; teammates never commit.

## Absolute paths

- Game repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build`
- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev`
- Raw asset warehouse: `C:\Users\neil\Desktop\AIprojects\swords\sketchlab`
- Scratch space for extraction: `C:\Users\neil\Desktop\AIprojects\swords\temp_sketchlab`
- Blender: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
- Python: `C:\Users\neil\AppData\Local\Programs\Python\Python312\python.exe`
- The shell starts in a different directory. Always `cd` to the game repo (or use absolute paths)
  in every command.

## Non-negotiable acceptance gates (Lead runs these at the end)

1. `npm test` in the game repo: **exactly 58 tests, all passing**. Do not add or remove `test(...)`
   blocks. You may extend assertions inside existing tests.
2. `npx tsc --noEmit` — 0 errors.
3. `npm run build` (tsc + vite) — succeeds.
4. `tests/assets.test.ts` rules for every `public/assets/custom/*.glb.gz`:
   valid glTF 2.0; internal buffers/images only (no external URIs); every primitive has
   `TEXCOORD_0`; every asset has at least one embedded image; indexed primitives;
   total triangles ≤ 16,000 (weapons ≤ 3,500; ruins/modules ≤ 14,000).
5. `tests/equipment.test.ts` rules: 9 characters grounded; every `WEAPON_IDS` entry has a
   `custom/<id>.glb.gz`; attached weapon bounds diagonal < 2.2; grip profiles consistent.
6. Browser smoke: production build renders with no page errors (qa-verifier harness).

## File ownership (do not edit files outside your scope)

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom/<new>.glb.gz`, `public/assets/textures/*`, `scripts/bake/*`, `scripts/validate-assets.mjs`, `temp_sketchlab/**`, `docs/ASSET-PIPELINE.md` |
| **weapons-armory** | `src/shared/weapons.ts`, `src/client/equipment.ts`, `src/simulation/game.ts` (weaponDrops seed line only), `tests/armory.test.ts`, `tests/equipment.test.ts` |
| **world-scene** | `src/client/scene.ts`, `src/client/landscape.ts`, `src/client/postfx.ts` (new), `src/client/effects.ts` (new) |
| **ruins-builder** | `src/client/ruins.ts` (new), `src/client/terrain-surfaces.ts` (new) |
| **audio-polish** | `src/client/main.ts`, `src/client/combat-feedback.ts`, `src/client/ambience.ts` (new), `src/client/style.css`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs` (new), `docs/QA-REPORT.md`, `qa/**` screenshots only |
| **Lead** | `docs/**` (except ASSET-PIPELINE.md), `PROJECT_STATUS.md`, `index.html`, git, deployment |

Never edit another owner's file. If you need a change there, message the Lead.

## Testing etiquette while the tree is shared

- Run only your scoped test files: `node --import tsx --test tests/assets.test.ts` etc.
- Do **not** run `git add/commit/push/reset/checkout`.
- Do not `npm install` in the game repo (node_modules is complete). The gltf-transform/sharp
  tooling is preinstalled at `scripts/custom-assets/node_modules`.
- Do not delete or rewrite existing custom assets; only add new ones.
- If a full `npm test` fails because another owner is mid-edit, ignore errors outside your files
  and report to the Lead instead of fixing it yourself.

## New custom asset contract (asset-forge delivers; everyone else codes against these names)

All new models go to `public/assets/custom/<name>.glb.gz`, gzip level 9, embedded textures,
UVs (`TEXCOORD_0`), indexed primitives, Y-up, origin at ground center (ruins/props) or at the
grip (weapons). Target compressed size ≤ 3 MB each; total new assets ≤ 30 MB.

### Weapons — canonical bake orientation: **grip point at local origin, blade/head pointing +Y**

| File | Source | Tri budget |
| --- | --- | --- |
| `rapier.glb.gz` | `sketchlab/spanish_rapier.glb` (8,218 tris) | ≤ 3,400 |
| `halberd.glb.gz` | `sketchlab/halabardy.glb` (31,798 tris) | ≤ 3,400 |
| `dane_axe.glb.gz` | `sketchlab/great_dane_axe.glb` (374 tris) | ≤ 1,200 |

Bake so that the handle extends ≈15–25 % of total height below the origin and the blade/head
extends above it. Weapons need no skeleton/animation. One or two materials max.

### Ruins & architecture — origin at ground center, Y-up, ≤ 14,000 tris

| File | Source (nested under `<archive>/source/`) |
| --- | --- |
| `chapel_ruin.glb.gz` | `collapsed-gothic-chapel-ruin.zip` → `source/Zyklus15_Zeile1.zip` |
| `aqueduct_ruin.glb.gz` | `ruined-aqueduct-arches-segment.zip` → `source/Zyklus15_Zeile7.zip` |
| `bridge_ruin.glb.gz` | `ruined-stone-bridge-broken-arch.zip` → `source/Zyklus15_Zeile4.zip` |
| `courtyard_ruin.glb.gz` | `overgrown-courtyard-patio-ruin.zip` → `source/Zyklus15_Zeile2.zip` |
| `fortress_keep.glb.gz` | `medieval-fortress-kit.zip` → `source/fortress.fbx` (or `modular-castle.zip` → `source/MOD_castle.fbx`) |
| `castle_tower.glb.gz` | `sketchlab/vashlovani_tower.glb` (999,999 tris → decimate) |

### Props & scatter — origin at ground center, ≤ 6,000 tris (grass ≤ 1,500)

| File | Source |
| --- | --- |
| `well.glb.gz` | `medieval-stone-well-game-prop.zip` → `source/Zyklus6_Zeile9.zip` |
| `chest.glb.gz` | `sketchlab/medieval_era_chest.glb` (7,622 → decimate) |
| `bench.glb.gz` | `sketchlab/medieval-props-asset-low-poly-game-ready.zip` → `source/asset_low.fbx` (isolate a bench; if none, build a simple stone bench in Blender and give it a baked/UV texture) |
| `grass_tuft.glb.gz` | `sketchlab/grass-patches-circle.zip` → `source/GrassPatch_Circle.fbx` (alpha-tested basecolor texture) |
| `rock_cluster.glb.gz` | `sketchlab/stones-and-grass.zip` → `source/stones_and_grass.fbx` (isolate rocks; grass optional) |

### Scanned ground textures — `public/assets/textures/`

| File | Source | Notes |
| --- | --- | --- |
| `road_country_basecolor.jpg` + `road_country_normal.png` | `ground_03_-_country_road.glb` | 1024², seamless (offset + cross-fade), basecolor JPEG q≈88 ≤ 400 KB, normal PNG ≤ 2 MB |
| `cobblestone_basecolor.jpg` + `cobblestone_normal.png` | `cobblestone_ground_-_highpoly.glb` | same rules |

Additional sources if useful: `cobblestone-road-near-berlin-realityscan.zip` (nested FBX + textures).
Do not ship raw high-poly scans. Do not overwrite the existing `texture_ground_*.png` files.

## Code interfaces (agreed so parallel work integrates cleanly)

### `src/client/terrain-surfaces.ts` (ruins-builder)
```ts
import type * as THREE from 'three';
/** Loads scanned textures + applies them to meshes tagged by world-scene. Never throws. */
export function applySurfaceTextures(scene: THREE.Scene, maxAnisotropy: number): Promise<void>;
```
- Applies to `mesh.userData.surface`: `'road'` → road textures; `'cobble'` → cobblestone textures;
  `'ground'` → existing `assets/textures/texture_ground_mud_grass.png` (detail map) blended with
  region tint; missing files leave materials untouched.
- Sets `map.colorSpace = SRGBColorSpace`, `wrapS/T = RepeatWrapping`, `anisotropy = maxAnisotropy`,
  and clones the per-mesh material. Normal map uses `NoColorSpace`.
- Clones textures once and reuses them (no per-mesh downloads).

### `src/client/ruins.ts` (ruins-builder)
```ts
import type * as THREE from 'three';
import type {Actor, Game} from '../shared/types';
export function addRuins(scene: THREE.Scene): {
  update(game: Game | undefined, me: Actor | undefined, time: number): void;
};
```
- Adds, asynchronously and defensively (missing asset ⇒ skip, never throw):
  gothic chapel ruin + aqueduct arches + broken bridge between Castle 1 and Castle 2,
  courtyard ruin decoration, wells/chests/stone benches in castle courtyards and survivor
  camps, and 3D weapon-rack displays in captured castle courtyards showing every
  `WEAPON_IDS` model (`equipmentModel(source.scene, WEAPONS[id].length, false, id)`).
- Places set pieces ≥ 6 m off the road centerline and outside castle wall footprints
  (`walls(c)`); cannot block the gate corridor at `(c.x, c.z+10)`.
- `update()` toggles courtyard racks with castle ownership and animates subtle idle motion;
  must be cheap (no allocation per frame).

### `src/client/postfx.ts` (world-scene)
```ts
export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera):
  { render(): void; setSize(w: number, h: number): void; dispose(): void };
```
- EffectComposer + RenderPass + UnrealBloomPass (subtle: strength ≈ 0.3–0.45, threshold ≈ 0.7,
  radius ≈ 0.4) + OutputPass; falls back to `renderer.render` if unavailable.

### `src/client/effects.ts` (world-scene)
```ts
export class CombatEffects {
  constructor(scene: THREE.Scene);
  sparks(position: THREE.Vector3, kind: 'metal' | 'flesh' | 'undead'): void;
  blood(position: THREE.Vector3, corruption: boolean): void;
  dust(position: THREE.Vector3, intensity: number): void;
  update(dt: number): void;
}
```
- Pooled/instanced, no per-frame allocation, respects the existing 48–64 debris budget.

### `src/client/ambience.ts` (audio-polish)
```ts
import type {Actor, Game} from '../shared/types';
export class Ambience {
  constructor(enabled: () => boolean);
  unlock(): void;                       // from a user gesture
  update(dt: number, game: Game | undefined, me: Actor | undefined): void;
}
```
- Wind bed, horde drone level from nearest undead count, nest hum near the plague nest,
  torch crackle near fires, low-health heartbeat, footsteps while moving. All synthesized
  WebAudio; silence when the Sound checkbox is off or before unlock.

## Shared behavioural notes

- Weapons: add exactly three — `rapier`, `halberd`, `dane_axe` — with distinct damage/reach/
  cooldown/stamina/arc/length and `asset` equal to the asset name. `shield` true only if a
  one-handed loadout. Canonical grips: `{grip:[0,0,0],blade:[0,1,0]}` (baked orientation).
- `game.ts` weaponDrops seed must continue to expose every `WEAPON_IDS` entry across the nine
  castle racks (e.g. `WEAPON_IDS[1+i%(WEAPON_IDS.length-1)]`).
- main.ts HUD text must not hardcode the weapon count.
- world-scene wires `applySurfaceTextures`, `addRuins`, `createPostFX`, `CombatEffects` into
  `scene.ts`; `landscape.ts` adds instanced `grass_tuft`/`rock_cluster` scatter near camps and
  forest edges (2 InstancedMeshes, no per-prop draw calls).
- Keep the existing feel: no gameplay rule changes outside the listed weapons content;
  authoritative simulation stays server-driven.

## Reporting

When your workstream is complete: reply to the Lead with (1) files changed, (2) exact commands
run + results, (3) measured asset triangles/sizes, (4) anything incomplete or risky. Do not mark
a shared task complete until your acceptance gate passes, then mark it complete on the board.
