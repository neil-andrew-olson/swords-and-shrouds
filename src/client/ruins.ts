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
 * Batch 2026-10C converted this whole layer to InstancedMeshes:
 *   - 12 ruin set pieces, 27 camp tents, 10 stone walls and 54 castle/camp props are baked into
 *     InstancedMeshes (one per asset per region so the camera far plane still frustum-culls whole
 *     regions), instead of ~100 individually cloned GLTF meshes;
 *   - camp tents/props are culled by rescue state and player distance by *compacting* the visible
 *     instances to the front of the instance buffer and shrinking `count` (transition-only writes,
 *     allocation-free per frame), so hidden tents/props are not submitted for rasterisation either;
 *   - weapon racks keep two instanced shells (plinth + bronze ring, always 2 draws for all 9
 *     castles) and build their weapon content lazily as instanced weapon displays only when a
 *     castle is friendly AND the player is within ~45 m; content is disposed again after it has
 *     been out of range for a while.
 *
 * Placement data is preserved exactly from batch 2026-10A/10B (coordinates, yaws, target heights,
 * ground-centre origin). Everything remains defensive: asset-forge re-bakes GLBs in parallel, so a
 * missing `custom/<name>` is retried a few times, then skipped without throwing.
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
/** Rack contents stream in/out around this distance (metres) from the player. */
const RACK_CONTENT_RANGE = 45;
/** Camp props/tents hide beyond this distance (same feel as batch 2026-10B). */
const CAMP_RANGE = 50;
/** Courtyard props hide a bit before the camera far plane so far castles disgorge no instances. */
const PROP_RANGE = 75;
/** Destroy the weapon content instanced meshes after this long out of range (seconds). */
const CONTENT_IDLE_DISPOSE = 20;
/** At most a couple of friendly castles can ever be within RACK_CONTENT_RANGE. */
const MAX_VISIBLE_RACKS = 3;
/** GLTF assets are baked into one instance layer per region so far regions still cull. */
const REGION_COUNT = REGIONS.length;

const CAMP_INDEX = new Map<string, number>(CAMPS.map((camp, index) => [camp.id, index]));
const CASTLE_INDEX = new Map<string, number>(CASTLES.map((castle, index) => [castle.id, index]));

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _matrixA = new THREE.Matrix4();

// ---------------------------------------------------------------------------------------------
// Baked asset geometry: GLTF scene flattened to world space, recentred on XZ and dropped onto y=0.
// ---------------------------------------------------------------------------------------------

interface BakedMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

interface BakedAsset {
  meshes: BakedMesh[];
  height: number;
  longExtent: number;
  sizeX: number;
  sizeZ: number;
}

function bakeAsset(gltf: GLTF): BakedAsset | null {
  try {
    gltf.scene.updateMatrixWorld(true);
    const meshes: BakedMesh[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      meshes.push({geometry, material: object.material});
    });
    if (meshes.length === 0) return null;
    const bounds = new THREE.Box3();
    for (let i = 0; i < meshes.length; i++) {
      const box = meshes[i].geometry.boundingBox;
      if (box) bounds.union(box);
    }
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) return null;
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.001) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].geometry.translate(-center.x, -bounds.min.y, -center.z);
    }
    return {meshes, height: size.y, longExtent: Math.max(size.x, size.z, 0.001), sizeX: size.x, sizeZ: size.z};
  } catch (error) {
    console.warn('[ruins] asset bake failed', error);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Instanced layer helpers.
// ---------------------------------------------------------------------------------------------

interface PlacementSpec {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  /** -1 = not a camp placement; otherwise index into CAMPS for rescue/distance culling. */
  campIndex: number;
  /** -1 = not a courtyard placement; otherwise index into CASTLES for distance culling. */
  castleIndex: number;
}

interface InstanceRecord {
  base: THREE.Matrix4;
  campIndex: number;
  castleIndex: number;
}

interface InstancedLayer {
  meshes: THREE.InstancedMesh[];
  records: InstanceRecord[];
  /** Compaction state used by the rescue/distance culling pass. */
  cullable: boolean;
  visibility: Uint8Array;
  initialized: boolean;
  activeCount: number;
}

function placementMatrix(x: number, z: number, yaw: number, scale: number): THREE.Matrix4 {
  _euler.set(0, yaw, 0);
  _quaternion.setFromEuler(_euler);
  _position.set(x, 0, z);
  _scale.setScalar(scale);
  return new THREE.Matrix4().compose(_position, _quaternion, _scale);
}

/**
 * One InstancedMesh per baked mesh, with every placement as an instance.
 * Static layers upload all matrices once; cullable layers start empty and are compacted by update().
 */
function createLayer(
  scene: THREE.Scene,
  baked: BakedAsset,
  specs: readonly PlacementSpec[],
  name: string,
  cullable: boolean
): InstancedLayer | null {
  if (specs.length === 0) return null;
  const records: InstanceRecord[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    records.push({base: placementMatrix(spec.x, spec.z, spec.yaw, spec.scale), campIndex: spec.campIndex, castleIndex: spec.castleIndex});
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (let m = 0; m < baked.meshes.length; m++) {
    const bakedMesh = baked.meshes[m];
    const instanced = new THREE.InstancedMesh(bakedMesh.geometry, bakedMesh.material, specs.length);
    instanced.name = name;
    if (!cullable) {
      for (let i = 0; i < records.length; i++) instanced.setMatrixAt(i, records[i].base);
      instanced.instanceMatrix.needsUpdate = true;
    } else {
      instanced.count = 0;
    }
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.computeBoundingSphere();
    scene.add(instanced);
    meshes.push(instanced);
  }
  return {meshes, records, cullable, visibility: new Uint8Array(records.length), initialized: false, activeCount: 0};
}

// ---------------------------------------------------------------------------------------------
// addRuins
// ---------------------------------------------------------------------------------------------

interface RackShell {
  matrix: THREE.Matrix4;
  hidden: THREE.Matrix4;
}

interface ContentWeapon {
  meshes: THREE.InstancedMesh[];
  slotMatrices: THREE.Matrix4[];
  materials: THREE.Material[];
}

export function addRuins(scene: THREE.Scene): {
  update(game: Game | undefined, me: Actor | undefined, time: number): void;
} {
  /** Racks (plinth/ring) for all nine castles; two instanced draws in total. */
  const rackShells: RackShell[] = [];
  let plinthMesh: THREE.InstancedMesh | null = null;
  let ringMesh: THREE.InstancedMesh | null = null;
  /** Tents + furniture layers that react to rescue state, castle distance or player distance. */
  const cullableLayers: InstancedLayer[] = [];
  const campRescued = new Uint8Array(CAMPS.length);
  const castleFriendly = new Uint8Array(CASTLES.length);
  let lastShellMask = -1;
  let contentAppliedMask = -1;
  let contentIdleSince = -1;
  let weaponContent: Map<WeaponId, ContentWeapon> | null = null;
  const weaponSources = new Map<WeaponId, GLTF>();
  const visibleRacks = new Int32Array(MAX_VISIBLE_RACKS);

  const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

  function addCullableLayer(layer: InstancedLayer | null): void {
    if (!layer) return;
    cullableLayers.push(layer);
  }

  async function placeSetPieces(): Promise<void> {
    await Promise.all(
      RUIN_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const baked = bakeAsset(gltf);
        if (!baked) return;
        // One layer per region so the camera far plane culls the other two regions.
        for (let region = 0; region < REGION_COUNT; region++) {
          const specs: PlacementSpec[] = [];
          for (const placement of RUIN_PLACEMENTS) {
            if (placement.asset !== asset || placement.region !== region) continue;
            specs.push({x: placement.x, z: placement.z, yaw: placement.rotY, scale: placement.height / baked.height, campIndex: -1, castleIndex: -1});
          }
          createLayer(scene, baked, specs, `ruins:${asset}:r${region}`, false);
        }
      })
    );
  }

  async function placeStoneWalls(): Promise<void> {
    const gltf = await loadModel('custom/stone_wall');
    if (!gltf) return;
    const baked = bakeAsset(gltf);
    if (!baked) return;
    const longAxisIsZ = baked.sizeZ >= baked.sizeX;
    for (let region = 0; region < REGION_COUNT; region++) {
      const specs: PlacementSpec[] = [];
      for (const wall of STONE_WALL_PLACEMENTS) {
        if (wall.region !== region) continue;
        const yaw = longAxisIsZ ? wall.rotY : wall.rotY - Math.PI / 2;
        specs.push({x: wall.x, z: wall.z, yaw, scale: wall.length / baked.longExtent, campIndex: -1, castleIndex: -1});
      }
      createLayer(scene, baked, specs, `walls:r${region}`, false);
    }
  }

  async function placeCampTents(): Promise<void> {
    const gltf = await loadModel('custom/camp_tent');
    if (!gltf) return;
    const baked = bakeAsset(gltf);
    if (!baked) return;
    for (let region = 0; region < REGION_COUNT; region++) {
      const specs: PlacementSpec[] = [];
      for (let campIndex = region * 3; campIndex < region * 3 + 3 && campIndex < CAMPS.length; campIndex++) {
        const camp = CAMPS[campIndex];
        const layout = CAMP_TENTS[campIndex % CAMP_TENTS.length];
        for (let tentIndex = 0; tentIndex < layout.length; tentIndex++) {
          const tent = layout[tentIndex];
          const yaw = Math.atan2(-tent.dx, -tent.dz) + Math.sin(campIndex * 2.1 + tentIndex * 1.7) * 0.32;
          const height = tent.height * (0.94 + ((campIndex * 5 + tentIndex * 2) % 3) * 0.05);
          specs.push({x: camp.x + tent.dx, z: camp.z + tent.dz, yaw, scale: height / baked.height, campIndex, castleIndex: -1});
        }
      }
      addCullableLayer(createLayer(scene, baked, specs, `tents:r${region}`, true));
    }
  }

  async function placePropAssets(): Promise<void> {
    await Promise.all(
      PROP_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const baked = bakeAsset(gltf);
        if (!baked) return;
        for (let region = 0; region < REGION_COUNT; region++) {
          const specs: PlacementSpec[] = [];
          // Courtyard furniture: three castles per region, culled by castle distance.
          for (let castleIndex = region * 3; castleIndex < region * 3 + 3 && castleIndex < CASTLES.length; castleIndex++) {
            const castle = CASTLES[castleIndex];
            for (const prop of COURTYARD_PROPS) {
              if (prop.asset !== asset) continue;
              specs.push({x: castle.x + prop.dx, z: castle.z + prop.dz, yaw: prop.rotY, scale: prop.height / baked.height, campIndex: -1, castleIndex});
            }
          }
          // Survivor-camp furniture: rescue/distance culling.
          for (let campIndex = region * 3; campIndex < region * 3 + 3 && campIndex < CAMPS.length; campIndex++) {
            const camp = CAMPS[campIndex];
            for (const prop of CAMP_PROPS) {
              if (prop.asset !== asset) continue;
              specs.push({x: camp.x + prop.dx, z: camp.z + prop.dz, yaw: prop.rotY, scale: prop.height / baked.height, campIndex, castleIndex: -1});
            }
          }
          addCullableLayer(createLayer(scene, baked, specs, `props:${asset}:r${region}`, true));
        }
      })
    );
  }

  function buildRackShells(): void {
    if (rackShells.length > 0) return;
    const stone = new THREE.MeshStandardMaterial({color: 0x4d5a5c, roughness: 0.94, metalness: 0.04, flatShading: true});
    const bronze = new THREE.MeshStandardMaterial({color: 0x9a7b45, roughness: 0.5, metalness: 0.4});
    const plinthGeometry = new THREE.CylinderGeometry(1.9, 2.05, 0.24, 24);
    plinthGeometry.translate(0, 0.12, 0);
    const ringGeometry = new THREE.TorusGeometry(1.5, 0.05, 2, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    ringGeometry.translate(0, PLINTH_TOP, 0);
    plinthMesh = new THREE.InstancedMesh(plinthGeometry, stone, CASTLES.length);
    plinthMesh.name = 'racks:plinth';
    ringMesh = new THREE.InstancedMesh(ringGeometry, bronze, CASTLES.length);
    ringMesh.name = 'racks:ring';
    for (let i = 0; i < CASTLES.length; i++) {
      const castle = CASTLES[i];
      const matrix = placementMatrix(castle.x + RACK_DX, castle.z + RACK_DZ, RACK_YAW, 1);
      const hidden = placementMatrix(castle.x + RACK_DX, castle.z + RACK_DZ, RACK_YAW, 0);
      rackShells.push({matrix, hidden});
      plinthMesh.setMatrixAt(i, hidden);
      ringMesh.setMatrixAt(i, hidden);
    }
    for (const mesh of [plinthMesh, ringMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
  }

  async function loadWeaponSources(): Promise<void> {
    await Promise.all(
      WEAPON_IDS.map(async (id) => {
        const gltf = await loadModel(`custom/${id}`);
        if (gltf) weaponSources.set(id, gltf);
      })
    );
  }

  /** Lazily builds one InstancedMesh set per weapon model; only called when a rack is near. */
  function buildWeaponContent(): void {
    if (weaponContent || weaponSources.size === 0) return;
    const content = new Map<WeaponId, ContentWeapon>();
    const available: WeaponId[] = [];
    for (const id of WEAPON_IDS) if (weaponSources.has(id)) available.push(id);
    const total = Math.max(available.length, 1);
    for (let index = 0; index < available.length; index++) {
      const id = available[index];
      const source = weaponSources.get(id);
      if (!source) continue;
      try {
        const model = equipmentModel(source.scene, WEAPONS[id].length, false, id);
        // Same display pose as batch 2026-10A: slight lean, stood on the plinth.
        model.rotation.x = -0.05;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        model.position.y += PLINTH_TOP + 0.02 - bounds.min.y;
        model.updateMatrixWorld(true);
        const angle = (index / total) * Math.PI * 2;
        const holder = new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(angle) * RACK_RADIUS, 0, Math.sin(angle) * RACK_RADIUS),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle + Math.PI / 2, 0)),
          new THREE.Vector3(1, 1, 1)
        );
        const parts: {geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; slot: THREE.Matrix4}[] = [];
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.geometry) return;
          parts.push({
            geometry: object.geometry,
            material: object.material,
            slot: new THREE.Matrix4().multiplyMatrices(holder, object.matrixWorld)
          });
        });
        if (parts.length === 0) continue;
        const meshes: THREE.InstancedMesh[] = [];
        const slotMatrices: THREE.Matrix4[] = [];
        const materials: THREE.Material[] = [];
        for (const part of parts) {
          const instanced = new THREE.InstancedMesh(part.geometry, part.material, MAX_VISIBLE_RACKS);
          instanced.name = `rack-content:${id}`;
          instanced.count = 0;
          instanced.visible = false;
          instanced.frustumCulled = false;
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          scene.add(instanced);
          meshes.push(instanced);
          slotMatrices.push(part.slot);
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) materials.push(material);
        }
        content.set(id, {meshes, slotMatrices, materials});
      } catch (error) {
        console.warn('[ruins] weapon display build failed', id, error);
      }
    }
    weaponContent = content.size > 0 ? content : null;
  }

  /** Uploads instance matrices for the friendly+in-range racks; transition-only work. */
  function applyWeaponContent(mask: number): void {
    if (!weaponContent) return;
    let visibleCount = 0;
    for (let i = 0; i < CASTLES.length && visibleCount < MAX_VISIBLE_RACKS; i++) {
      if ((mask & (1 << i)) !== 0) visibleRacks[visibleCount++] = i;
    }
    for (const weapon of weaponContent.values()) {
      for (let m = 0; m < weapon.meshes.length; m++) {
        const instanced = weapon.meshes[m];
        const slot = weapon.slotMatrices[m];
        for (let v = 0; v < visibleCount; v++) {
          const rack = rackShells[visibleRacks[v]];
          _matrixA.multiplyMatrices(rack.matrix, slot);
          instanced.setMatrixAt(v, _matrixA);
        }
        instanced.count = visibleCount;
        instanced.instanceMatrix.needsUpdate = true;
        instanced.visible = visibleCount > 0;
      }
    }
  }

  function disposeWeaponContent(): void {
    if (!weaponContent) return;
    for (const weapon of weaponContent.values()) {
      for (const material of weapon.materials) material.dispose();
      for (const instanced of weapon.meshes) {
        scene.remove(instanced);
        instanced.dispose();
      }
    }
    weaponContent = null;
    contentAppliedMask = -1;
  }

  function applyShellVisibility(mask: number): void {
    if (!plinthMesh || !ringMesh) return;
    for (let i = 0; i < rackShells.length; i++) {
      const shell = rackShells[i];
      const matrix = (mask & (1 << i)) !== 0 ? shell.matrix : shell.hidden;
      plinthMesh.setMatrixAt(i, matrix);
      ringMesh.setMatrixAt(i, matrix);
    }
    plinthMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
  }

  /** Writes the currently visible instances compacted to the front of the buffer. */
  function rebuildLayer(layer: InstancedLayer): void {
    const records = layer.records;
    const visibility = layer.visibility;
    let write = 0;
    for (let i = 0; i < records.length; i++) {
      if (!visibility[i]) continue;
      for (let m = 0; m < layer.meshes.length; m++) layer.meshes[m].setMatrixAt(write, records[i].base);
      write++;
    }
    layer.activeCount = write;
    for (let m = 0; m < layer.meshes.length; m++) {
      const mesh = layer.meshes[m];
      mesh.count = write;
      mesh.visible = write > 0;
      mesh.instanceMatrix.needsUpdate = true;
      // Instance bounds must follow the compacted count or frustum culling would use a stale sphere.
      if (write > 0) mesh.computeBoundingSphere();
    }
  }

  buildRackShells();
  void Promise.all([placeSetPieces(), placeStoneWalls(), placeCampTents(), placePropAssets(), loadWeaponSources()]).catch(
    (error) => console.warn('[ruins] asynchronous placement failed', error)
  );

  return {
    update(game: Game | undefined, me: Actor | undefined, time: number): void {
      let meX = 0;
      let meZ = 0;
      let hasMe = false;
      if (me) {
        meX = me.x;
        meZ = me.z;
        hasMe = true;
      }
      // Camp rescue flags (allocation-free; CAMP_INDEX lookup only).
      for (let i = 0; i < campRescued.length; i++) campRescued[i] = 0;
      if (game) {
        const camps = game.camps;
        for (let i = 0; i < camps.length; i++) {
          const index = CAMP_INDEX.get(camps[i].id);
          if (index !== undefined) campRescued[index] = camps[i].rescued ? 1 : 0;
        }
      }

      // Rescue/distance culling for tents + camp/courtyard furniture: transition-only compaction.
      const campRangeSq = CAMP_RANGE * CAMP_RANGE;
      const propRangeSq = PROP_RANGE * PROP_RANGE;
      for (let l = 0; l < cullableLayers.length; l++) {
        const layer = cullableLayers[l];
        const records = layer.records;
        const visibility = layer.visibility;
        let changed = !layer.initialized;
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          let visible: boolean;
          if (record.campIndex >= 0) {
            visible = campRescued[record.campIndex] === 0;
            if (visible && hasMe) {
              const dx = meX - record.base.elements[12];
              const dz = meZ - record.base.elements[14];
              visible = dx * dx + dz * dz <= campRangeSq;
            }
          } else if (record.castleIndex >= 0) {
            visible = true;
            if (hasMe) {
              const dx = meX - record.base.elements[12];
              const dz = meZ - record.base.elements[14];
              visible = dx * dx + dz * dz <= propRangeSq;
            }
          } else {
            visible = true;
          }
          if (visible !== (visibility[i] === 1)) {
            visibility[i] = visible ? 1 : 0;
            changed = true;
          }
        }
        if (changed) {
          rebuildLayer(layer);
          layer.initialized = true;
        }
      }

      // Castle ownership for the instanced rack shells (empty rack still reads as a display).
      for (let i = 0; i < castleFriendly.length; i++) castleFriendly[i] = 0;
      if (game) {
        const castles = game.castles;
        for (let i = 0; i < castles.length; i++) {
          const index = CASTLE_INDEX.get(castles[i].id);
          if (index !== undefined) castleFriendly[index] = castles[i].friendly ? 1 : 0;
        }
      }
      let shellMask = 0;
      for (let i = 0; i < castleFriendly.length; i++) if (castleFriendly[i]) shellMask |= 1 << i;
      if (shellMask !== lastShellMask) {
        applyShellVisibility(shellMask);
        lastShellMask = shellMask;
      }

      // Rack contents: only friendly castles within ~45 m get real weapon models.
      let contentMask = 0;
      if (game && hasMe) {
        const contentRangeSq = RACK_CONTENT_RANGE * RACK_CONTENT_RANGE;
        for (let i = 0; i < CASTLES.length; i++) {
          if (!castleFriendly[i]) continue;
          const dx = meX - (CASTLES[i].x + RACK_DX);
          const dz = meZ - (CASTLES[i].z + RACK_DZ);
          if (dx * dx + dz * dz <= contentRangeSq) contentMask |= 1 << i;
        }
      }
      if (contentMask !== 0 && weaponContent === null && weaponSources.size > 0) buildWeaponContent();
      if (weaponContent) {
        if (contentMask !== contentAppliedMask) {
          applyWeaponContent(contentMask);
          contentAppliedMask = contentMask;
          contentIdleSince = contentMask === 0 ? time : -1;
        } else if (contentMask === 0) {
          if (contentIdleSince < 0) contentIdleSince = time;
          else if (time - contentIdleSince > CONTENT_IDLE_DISPOSE) disposeWeaponContent();
        }
      } else {
        contentIdleSince = -1;
      }
    }
  };
}
