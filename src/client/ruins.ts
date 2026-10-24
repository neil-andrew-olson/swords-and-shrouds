import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadAsset} from './assets';
import {equipmentModel} from './equipment';
import {WEAPONS, WEAPON_IDS, type WeaponId} from '../shared/weapons';
import {CAMPS, CASTLES, REGIONS} from '../shared/world';
import type {Actor, Game} from '../shared/types';

/**
 * Ruins, survivor-camp props and courtyard weapon displays (ruins-builder).
 *
 * Everything here is additive and defensive: asset-forge bakes the GLBs in parallel, so a missing
 * `custom/<name>` simply skips that placement (the load is retried a few times, then dropped).
 * GLTF scenes are always cloned per placement; the shared `loadAsset` cache means one download per
 * model. Set pieces are hard-placed with the coordinates verified against `shared/world` roads,
 * castle wall footprints and camp anchors:
 *
 *  - all set pieces are >= 10 m from every road centreline (spec floor is 6 m),
 *  - all set pieces are >= 11 m clear of every `walls(castle)` footprint,
 *  - the gate corridor along `(castle.x, castle.z + 10)` is kept empty of ruins/racks/props.
 *
 * Batch 2026-10B adds camp tents (2-3 per survivor camp, hidden with the camp's rescued/far
 * visibility) and ruined `stone_wall` segments flanking the Castle 1 -> Castle 2 road plus a few
 * per other region: all >= 8 m from every road centreline, clear of castle wall footprints, off
 * the gate corridor and >= 10 m apart (verified against `shared/world` by a placement check).
 */

export type RuinAsset = 'chapel_ruin' | 'aqueduct_ruin' | 'bridge_ruin' | 'courtyard_ruin';
export type PropAsset = 'well' | 'chest' | 'bench';

export interface RuinPlacement {
  asset: RuinAsset;
  /** Index into `REGIONS`. */
  region: number;
  /** Absolute world coordinates (origin at ground centre). */
  x: number;
  z: number;
  rotY: number;
  /** Target model height in metres (the loader normalises by bounds). */
  height: number;
}

export interface RuinPropPlacement {
  asset: PropAsset;
  /** Offset from a castle/camp anchor. */
  dx: number;
  dz: number;
  height: number;
  rotY: number;
}

export interface CampTentPlacement {
  /** Offset from the camp anchor (mill / crossing / hamlet layout). */
  dx: number;
  dz: number;
  /** Target model height in metres. */
  height: number;
}

export interface StoneWallPlacement {
  /** Index into `REGIONS`. */
  region: number;
  /** Absolute world coordinates (origin at ground centre). */
  x: number;
  z: number;
  /** Yaw of the road the wall flanks; the loader aligns the model's long horizontal axis to it. */
  rotY: number;
  /** Target wall length along its long axis in metres (the scan is only ~0.86 m tall). */
  length: number;
}

interface RuinSite {
  asset: RuinAsset;
  localX: number;
  /** Local z relative to the region offset; keep well clear of the road corridor. */
  localZ: number;
  height: number;
  /** Per-region yaw so the three regions do not repeat exactly. */
  rotations: readonly [number, number, number];
  /** Per-region scale variance. */
  scales: readonly [number, number, number];
}

const RUIN_SITES: readonly RuinSite[] = [
  // Chapel, aqueduct and broken bridge all sit in the corridor between Castle 1 (keep, 0,0)
  // and Castle 2 (border fortress, 42,-67).
  {asset: 'chapel_ruin', localX: 16, localZ: -22, height: 8.5, rotations: [0.42, 2.18, 4.05], scales: [1, 0.93, 1.04]},
  {asset: 'aqueduct_ruin', localX: 8, localZ: -35, height: 7, rotations: [-0.28, 0.95, 2.65], scales: [1, 1.06, 0.94]},
  {asset: 'bridge_ruin', localX: 13, localZ: -52, height: 5, rotations: [1.15, -0.62, 2.14], scales: [1, 0.95, 1.08]},
  // A collapsed courtyard just outside the keep's north-east wall, one per region.
  {asset: 'courtyard_ruin', localX: 20, localZ: 16, height: 3.4, rotations: [0.2, 1.62, 3.28], scales: [1, 0.9, 1.08]}
];

const RUIN_ASSETS: readonly RuinAsset[] = ['chapel_ruin', 'aqueduct_ruin', 'bridge_ruin', 'courtyard_ruin'];
const PROP_ASSETS: readonly PropAsset[] = ['well', 'chest', 'bench'];

/** Exported so the Lead / world-scene can reason about the ruin footprint. */
export const RUIN_PLACEMENTS: readonly RuinPlacement[] = RUIN_SITES.flatMap((site) =>
  REGIONS.map((region, index) => ({
    asset: site.asset,
    region: index,
    x: site.localX,
    z: region.offset + site.localZ,
    rotY: site.rotations[index],
    height: site.height * site.scales[index]
  }))
);

/** Courtyard furniture offsets, relative to each castle centre (inside the walls, off the gate corridor). */
export const COURTYARD_PROPS: readonly RuinPropPlacement[] = [
  {asset: 'well', dx: -6.2, dz: 3.6, height: 1.6, rotY: 0},
  {asset: 'chest', dx: 4.2, dz: -1.4, height: 1.0, rotY: -0.62},
  {asset: 'bench', dx: -3.6, dz: 2.4, height: 0.85, rotY: Math.PI / 2}
];

/** Survivor-camp furniture offsets, relative to each camp anchor. */
export const CAMP_PROPS: readonly RuinPropPlacement[] = [
  {asset: 'well', dx: -5.5, dz: -3.0, height: 1.4, rotY: 0},
  {asset: 'chest', dx: 5.0, dz: -2.0, height: 0.9, rotY: 0.9},
  {asset: 'bench', dx: -1.0, dz: -5.2, height: 0.8, rotY: 0.35}
];

/**
 * Tents per camp type: 0 = mill/refuge, 1 = crossing, 2 = hamlet (CAMPS cycles mill, crossing,
 * hamlet per region). The baked `camp_tent` scan is ~5.2 m x 4.5 m footprint at ~3 m tall, so
 * offsets keep a scaled half-diagonal (~3.05 m at the largest allowed height variance) clear of the
 * camp house/firepit/cauldron/barrels/brazier, the well/chest/bench from batch 1 and the 3.8 m
 * beacon ring; all >= 6.5 m off roads and >= 6.1 m apart from each other.
 */
export const CAMP_TENTS: readonly (readonly CampTentPlacement[])[] = [
  [
    {dx: 9.0, dz: 0, height: 2.35},
    {dx: 6.79, dz: 6.79, height: 2.1},
    {dx: 0, dz: 9.0, height: 2.5}
  ],
  [
    {dx: 2.23, dz: 8.31, height: 2.4},
    {dx: -4.8, dz: 8.31, height: 2.15},
    {dx: -8.69, dz: 2.33, height: 2.55}
  ],
  [
    {dx: 9.0, dz: 0, height: 2.2},
    {dx: 6.79, dz: 6.79, height: 2.45},
    {dx: -6.56, dz: -7.81, height: 2.05}
  ]
];

/**
 * Ruined stone-wall segments. Six region-0 walls flank the diagonal Castle 1 -> Castle 2 road
 * (five on the north-east flank, one on the keep-side flank); regions 1 and 2 repeat two each.
 * Lengths are the target long-axis size; the baked scan is ~6 m x 0.86 m, so the loader scales by
 * length and keeps its natural low-ruin proportions. Verified (endpoint-sampled): >= 10.6 m from
 * every road centreline, > 13 m Chebyshev from every castle centre (outside wall footprints),
 * off every gate corridor, >= 24 m from camp anchors, >= 12 m apart (centre spacing).
 */
export const STONE_WALL_PLACEMENTS: readonly StoneWallPlacement[] = [
  // Green March: Castle 1 (0,0) -> Castle 2 (42,-67) road.
  {region: 0, x: 24.4, z: 6.7, rotY: 2.6, length: 5.6},
  {region: 0, x: 31.97, z: -3.82, rotY: 2.55, length: 6.6},
  {region: 0, x: 37.03, z: -14.85, rotY: 2.62, length: 6.0},
  {region: 0, x: 45.44, z: -23.92, rotY: 2.57, length: 5.4},
  {region: 0, x: 50.05, z: -35.75, rotY: 2.6, length: 6.2},
  // Keep-side flank, outside the courtyard, between the keep and the chapel ruin.
  {region: 0, x: 5.4, z: -15.6, rotY: 2.55, length: 5.5},
  // Ashen Moor repeats.
  {region: 1, x: 31.97, z: -243.82, rotY: 2.63, length: 6.2},
  {region: 1, x: 37.03, z: -254.85, rotY: 2.56, length: 5.6},
  // Frozen Crown repeats.
  {region: 2, x: 45.44, z: -503.92, rotY: 2.62, length: 5.2},
  {region: 2, x: 50.05, z: -515.75, rotY: 2.57, length: 5.8}
];

const RACK_DX = 5.0;
const RACK_DZ = 4.2;
/** Weapon display yaw: front face (local +z) turned toward the castle centre. */
const RACK_YAW = Math.atan2(-RACK_DX, -RACK_DZ);
const RACK_RADIUS = 1.25;
const PLINTH_TOP = 0.26;
const MAX_LOAD_ATTEMPTS = 3;

interface AssetMetrics {
  size: THREE.Vector3;
}

interface RackItemState {
  holder: THREE.Group;
  phase: number;
}

interface RackState {
  castleId: string;
  group: THREE.Group;
  items: RackItemState[];
}

interface CampPropState {
  campId: string;
  x: number;
  z: number;
  group: THREE.Group;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function measureModel(source: THREE.Object3D): AssetMetrics {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  return {size: bounds.getSize(new THREE.Vector3())};
}

/**
 * Clones a GLTF scene, recentres it on XZ, drops it onto the ground and scales it to `height`.
 * `source` is never added to the scene directly (so the same asset can be placed many times).
 */
function instantiate(
  scene: THREE.Scene,
  source: THREE.Object3D,
  metrics: AssetMetrics,
  height: number,
  x: number,
  z: number,
  rotY: number
): THREE.Group | null {
  const sourceHeight = metrics.size.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight < 0.01) {
    console.warn('[ruins] model has no measurable height, skipping');
    return null;
  }
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const group = new THREE.Group();
  const model = source.clone(true);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) {
    console.warn('[ruins] model has no bounds, skipping');
    return null;
  }
  model.position.x -= (bounds.min.x + bounds.max.x) * 0.5;
  model.position.z -= (bounds.min.z + bounds.max.z) * 0.5;
  model.position.y -= bounds.min.y;
  group.add(model);
  group.scale.setScalar(safeHeight / sourceHeight);
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(group);
  return group;
}

export function addRuins(scene: THREE.Scene): {
  update(game: Game | undefined, me: Actor | undefined, time: number): void;
} {
  const racks: RackState[] = [];
  const campProps: CampPropState[] = [];

  /** loadAsset already caches successes; failures are evicted so a retry can pick the file up. */
  async function loadModel(name: string): Promise<GLTF | null> {
    for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
      try {
        return await loadAsset(name);
      } catch (error) {
        if (attempt === MAX_LOAD_ATTEMPTS - 1) {
          console.warn(`[ruins] ${name} unavailable, skipping`, error);
          return null;
        }
        await wait(2500 + attempt * 2500);
      }
    }
    return null;
  }

  async function placeSetPieces(): Promise<void> {
    await Promise.all(
      RUIN_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const metrics = measureModel(gltf.scene);
        for (const placement of RUIN_PLACEMENTS) {
          if (placement.asset !== asset) continue;
          try {
            instantiate(scene, gltf.scene, metrics, placement.height, placement.x, placement.z, placement.rotY);
          } catch (error) {
            console.warn('[ruins] set piece placement failed', asset, error);
          }
        }
      })
    );
  }

  async function placePropAssets(): Promise<void> {
    await Promise.all(
      PROP_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const metrics = measureModel(gltf.scene);
        const place = (x: number, z: number, height: number, rotY: number): THREE.Group | null => {
          try {
            return instantiate(scene, gltf.scene, metrics, height, x, z, rotY);
          } catch (error) {
            console.warn('[ruins] prop placement failed', asset, error);
            return null;
          }
        };
        // Castle courtyards.
        for (const castle of CASTLES) {
          for (const prop of COURTYARD_PROPS) {
            if (prop.asset !== asset) continue;
            place(castle.x + prop.dx, castle.z + prop.dz, prop.height, prop.rotY);
          }
        }
        // Survivor camps: grouped so `update()` can match the camp's rescued/far visibility.
        for (const camp of CAMPS) {
          for (const prop of CAMP_PROPS) {
            if (prop.asset !== asset) continue;
            const group = place(camp.x + prop.dx, camp.z + prop.dz, prop.height, prop.rotY);
            if (group) campProps.push({campId: camp.id, x: camp.x + prop.dx, z: camp.z + prop.dz, group});
          }
        }
      })
    );
  }

  async function placeCampTents(): Promise<void> {
    const gltf = await loadModel('custom/camp_tent');
    if (!gltf) return;
    const metrics = measureModel(gltf.scene);
    for (let campIndex = 0; campIndex < CAMPS.length; campIndex++) {
      const camp = CAMPS[campIndex];
      const layout = CAMP_TENTS[campIndex % CAMP_TENTS.length];
      for (let tentIndex = 0; tentIndex < layout.length; tentIndex++) {
        const tent = layout[tentIndex];
        // Deterministic per-camp variance: yaw faces the camp fire, scale wobbles a little.
        const yaw = Math.atan2(-tent.dx, -tent.dz) + Math.sin(campIndex * 2.1 + tentIndex * 1.7) * 0.32;
        const height = tent.height * (0.94 + ((campIndex * 5 + tentIndex * 2) % 3) * 0.05);
        const x = camp.x + tent.dx;
        const z = camp.z + tent.dz;
        try {
          const group = instantiate(scene, gltf.scene, metrics, height, x, z, yaw);
          // Tents share the camp rescued/far visibility with the other camp furniture.
          if (group) campProps.push({campId: camp.id, x, z, group});
        } catch (error) {
          console.warn('[ruins] camp tent placement failed', camp.id, error);
        }
      }
    }
  }

  async function placeStoneWalls(): Promise<void> {
    const gltf = await loadModel('custom/stone_wall');
    if (!gltf) return;
    const metrics = measureModel(gltf.scene);
    const longExtent = Math.max(metrics.size.x, metrics.size.z);
    if (!Number.isFinite(longExtent) || longExtent < 0.1 || metrics.size.y < 0.01) {
      console.warn('[ruins] stone_wall model has unusable bounds, skipping');
      return;
    }
    // The exported yaw is the road direction; align whichever horizontal axis is longer to it.
    const longAxisIsZ = metrics.size.z >= metrics.size.x;
    for (const wall of STONE_WALL_PLACEMENTS) {
      try {
        const yaw = longAxisIsZ ? wall.rotY : wall.rotY - Math.PI / 2;
        // Scale by length, not height: the ruined-wall scan is wide and low (~6 m x 0.86 m).
        const height = metrics.size.y * (wall.length / longExtent);
        instantiate(scene, gltf.scene, metrics, height, wall.x, wall.z, yaw);
      } catch (error) {
        console.warn('[ruins] stone wall placement failed', wall.x, wall.z, error);
      }
    }
  }

  function buildRack(castleId: string, x: number, z: number, sources: Map<WeaponId, GLTF>): RackState {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = RACK_YAW;
    group.visible = false;

    const stone = new THREE.MeshStandardMaterial({color: 0x4d5a5c, roughness: 0.94, metalness: 0.04, flatShading: true});
    const bronze = new THREE.MeshStandardMaterial({color: 0x9a7b45, roughness: 0.5, metalness: 0.4});
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.05, 0.24, 24), stone);
    plinth.position.y = 0.12;
    plinth.castShadow = plinth.receiveShadow = true;
    group.add(plinth);
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 2, 32), bronze);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.y = PLINTH_TOP;
    inlay.receiveShadow = true;
    group.add(inlay);

    const available: WeaponId[] = [];
    for (const id of WEAPON_IDS) if (sources.has(id)) available.push(id);

    const items: RackItemState[] = [];
    const total = Math.max(available.length, 1);
    for (let index = 0; index < available.length; index++) {
      const id = available[index];
      const source = sources.get(id);
      if (!source) continue;
      try {
        const model = equipmentModel(source.scene, WEAPONS[id].length, false, id);
        // Lean the weapon back and stand it on the plinth rather than sinking its grip into stone.
        model.rotation.x = -0.05;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        model.position.y += PLINTH_TOP + 0.02 - bounds.min.y;
        const angle = (index / total) * Math.PI * 2;
        const holder = new THREE.Group();
        holder.position.set(Math.cos(angle) * RACK_RADIUS, 0, Math.sin(angle) * RACK_RADIUS);
        holder.rotation.y = -angle + Math.PI / 2;
        holder.add(model);
        holder.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        group.add(holder);
        items.push({holder, phase: index * 1.37});
      } catch (error) {
        console.warn('[ruins] weapon display failed', id, error);
      }
    }

    scene.add(group);
    return {castleId, group, items};
  }

  async function placeWeaponRacks(): Promise<void> {
    const sources = new Map<WeaponId, GLTF>();
    await Promise.all(
      WEAPON_IDS.map(async (id) => {
        const gltf = await loadModel(`custom/${id}`);
        if (gltf) sources.set(id, gltf);
      })
    );
    if (sources.size === 0) return;
    for (const castle of CASTLES) {
      try {
        racks.push(buildRack(castle.id, castle.x + RACK_DX, castle.z + RACK_DZ, sources));
      } catch (error) {
        console.warn('[ruins] courtyard weapon rack failed', castle.id, error);
      }
    }
  }

  void Promise.all([placeSetPieces(), placePropAssets(), placeCampTents(), placeStoneWalls(), placeWeaponRacks()]).catch(
    (error) => console.warn('[ruins] asynchronous placement failed', error)
  );

  return {
    update(game: Game | undefined, me: Actor | undefined, time: number): void {
      // Courtyard weapon displays: only friendly castles show their armory stands.
      for (let index = 0; index < racks.length; index++) {
        const rack = racks[index];
        let friendly = false;
        if (game) {
          const castles = game.castles;
          for (let c = 0; c < castles.length; c++) {
            if (castles[c].id === rack.castleId) {
              friendly = castles[c].friendly;
              break;
            }
          }
        }
        rack.group.visible = friendly;
        if (!friendly) continue;
        const items = rack.items;
        for (let item = 0; item < items.length; item++) {
          // Subtle, allocation-free idle sway.
          items[item].holder.rotation.z = Math.sin(time * 1.15 + items[item].phase) * 0.02;
          items[item].holder.rotation.x = Math.cos(time * 0.9 + items[item].phase) * 0.012;
        }
      }
      // Camp furniture mirrors the camp prop visibility: gone once rescued, culled when far away.
      for (let index = 0; index < campProps.length; index++) {
        const prop = campProps[index];
        let rescued = false;
        if (game) {
          const camps = game.camps;
          for (let c = 0; c < camps.length; c++) {
            if (camps[c].id === prop.campId) {
              rescued = camps[c].rescued;
              break;
            }
          }
        }
        let visible = !rescued;
        if (visible && me) {
          const dx = me.x - prop.x;
          const dz = me.z - prop.z;
          visible = dx * dx + dz * dz < 50 * 50;
        }
        prop.group.visible = visible;
      }
    }
  };
}
