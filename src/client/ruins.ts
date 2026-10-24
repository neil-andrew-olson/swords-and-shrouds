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

  void Promise.all([placeSetPieces(), placePropAssets(), placeWeaponRacks()]).catch((error) =>
    console.warn('[ruins] asynchronous placement failed', error)
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
