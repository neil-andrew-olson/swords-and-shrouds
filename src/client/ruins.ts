import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {loadAsset} from './assets';
import {equipmentModel} from './equipment';
import {WEAPONS, WEAPON_IDS, type WeaponId} from '../shared/weapons';
import {CAMPS, CASTLES, REGIONS} from '../shared/world';
import type {Actor, Game} from '../shared/types';

/**
 * Ruins, survivor-camp props, courtyard weapon displays and environment dressing (ruins-builder).
 *
 * Everything uses InstancedMeshes. GLTF assets are instanced straight from the loaded scene: each
 * mesh becomes one InstancedMesh and the mesh's own world matrix is folded into a constant local
 * matrix per instance. That matters because cycle-1 assets are KHR_mesh_quantization encoded
 * (Int16 normalised positions + a dequantisation scale on the node) — cloning the geometry and
 * baking the matrix into it corrupts normalised integer attributes, so attributes are never touched.
 *
 * Layer groups:
 *   - 12 ruin set pieces, 27 camp tents, 10 stone walls, 54 castle/camp props (batch 2026-10A/B);
 *   - camp tents/props cull by rescue state + player distance by compacting visible instances;
 *   - weapon racks: 2 instanced shells for all 9 castles, weapon content built lazily (friendly and
 *     within ~45 m) as instanced weapon displays, disposed again when out of range;
 *   - cycle-2 environment dressing (existing shipped assets only): brazier pairs flanking castle
 *     gates, banner posts in captured courtyards, stake lines along the Castle 1 -> Castle 2 road,
 *     barrel/cart clusters beside survivor camps and a grave field around the Fallen Keep. These are
 *     distance-culled by compaction, so only nearby instances are submitted.
 *
 * Placement data for the batch 10A/B set pieces is preserved exactly. update() is allocation-free
 * (transitions only write instance matrices). Missing assets are retried a few times, then skipped.
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

// ---------------------------------------------------------------------------------------------
// Cycle-2 environment dressing placements (existing shipped assets; validated vs shared/world,
// castle walls/gate corridors, road centrelines, camps and all batch 10A/B props).
// ---------------------------------------------------------------------------------------------

export interface DressingPlacement {
  x: number;
  z: number;
  /** Yaw applied to the instance. */
  yaw: number;
}

/**
 * Brazier pairs flanking every castle gate (inside the courtyard, either side of the gate corridor,
 * facing the keep). Lit by the existing pooled torch lights at the gate beacons plus an additive
 * flame cone layer; NO new dynamic lights. Coordinates are per castle because the citadel's approach
 * road crowds its courtyard.
 */
export const GATE_BRAZIERS: readonly DressingPlacement[] = [
  // Green March: keep / border / citadel.
  {x: -5.8, z: 7.0, yaw: 2.2}, {x: 5.8, z: 6.6, yaw: -2.2},
  {x: 36.2, z: -60.0, yaw: 2.2}, {x: 47.8, z: -60.0, yaw: -2.2},
  {x: -29.8, z: -128.0, yaw: 2.2}, {x: -16.6, z: -123.2, yaw: -2.2},
  // Ashen Moor.
  {x: -5.8, z: -233.0, yaw: 2.2}, {x: 5.8, z: -233.4, yaw: -2.2},
  {x: 36.2, z: -300.0, yaw: 2.2}, {x: 47.8, z: -300.0, yaw: -2.2},
  {x: -29.8, z: -368.0, yaw: 2.2}, {x: -16.6, z: -363.2, yaw: -2.2},
  // Frozen Crown.
  {x: -5.8, z: -473.0, yaw: 2.2}, {x: 5.8, z: -473.4, yaw: -2.2},
  {x: 36.2, z: -540.0, yaw: 2.2}, {x: 47.8, z: -540.0, yaw: -2.2},
  {x: -29.8, z: -608.0, yaw: 2.2}, {x: -16.6, z: -603.2, yaw: -2.2}
];

/**
 * Banner posts around the courtyard keep (inside, either side of the central flag). They only
 * appear once the castle is friendly — captured-courtyard heraldry. The citadel has one post only:
 * its approach road crosses the courtyard's east side, so the second post has no legal spot.
 */
export const GATE_BANNERS: readonly {x: number; z: number; castle: number}[] = [
  {x: -3.2, z: 1.4, castle: 0}, {x: 3.5, z: 1.4, castle: 0},
  {x: 38.8, z: -65.6, castle: 1}, {x: 45.5, z: -65.6, castle: 1},
  {x: -27.2, z: -133.6, castle: 2},
  {x: -3.2, z: -238.6, castle: 3}, {x: 3.5, z: -238.6, castle: 3},
  {x: 38.8, z: -305.6, castle: 4}, {x: 45.5, z: -305.6, castle: 4},
  {x: -27.2, z: -373.6, castle: 5},
  {x: -3.2, z: -478.6, castle: 6}, {x: 3.5, z: -478.6, castle: 6},
  {x: 38.8, z: -545.6, castle: 7}, {x: 45.5, z: -545.6, castle: 7},
  {x: -27.2, z: -613.6, castle: 8}
];

const ROAD_YAW = Math.atan2(42, -69);

/** Stake bundles flanking the Castle 1 -> 2 road (6 m off the centreline, deliberate roadside props). */
export const ROADSIDE_STAKES: readonly DressingPlacement[] = [
  // Green March, both flanks of the diagonal keep -> border road.
  {x: 16.0, z: 6.1, yaw: ROAD_YAW - Math.PI / 2 + 0.05},
  {x: 17.67, z: 3.3, yaw: ROAD_YAW - Math.PI / 2 - 0.04},
  {x: 19.35, z: 0.54, yaw: ROAD_YAW - Math.PI / 2 + 0.06},
  {x: 21.03, z: -2.22, yaw: ROAD_YAW - Math.PI / 2 - 0.03},
  {x: 7.53, z: 3.3, yaw: ROAD_YAW - Math.PI / 2 + 0.04},
  {x: 11.73, z: -3.6, yaw: ROAD_YAW - Math.PI / 2 - 0.05},
  {x: 13.41, z: -6.36, yaw: ROAD_YAW - Math.PI / 2 + 0.03},
  {x: 15.09, z: -9.12, yaw: ROAD_YAW - Math.PI / 2 - 0.02},
  // Ashen Moor (translated repeats).
  {x: 16.0, z: -233.94, yaw: ROAD_YAW - Math.PI / 2 + 0.05},
  {x: 17.67, z: -236.7, yaw: ROAD_YAW - Math.PI / 2 - 0.04},
  {x: 19.35, z: -239.46, yaw: ROAD_YAW - Math.PI / 2 + 0.06},
  {x: 21.03, z: -242.22, yaw: ROAD_YAW - Math.PI / 2 - 0.03},
  // Frozen Crown (translated repeats).
  {x: 7.53, z: -476.7, yaw: ROAD_YAW - Math.PI / 2 + 0.04},
  {x: 11.73, z: -483.6, yaw: ROAD_YAW - Math.PI / 2 - 0.05},
  {x: 13.41, z: -486.36, yaw: ROAD_YAW - Math.PI / 2 + 0.03},
  {x: 15.09, z: -489.12, yaw: ROAD_YAW - Math.PI / 2 - 0.02}
];

/** Barrel + cart clusters parked at the edge of every survivor camp (rescue-culled with the camp). */
export const CAMP_BARRELS: readonly DressingPlacement[] = CAMPS.map((camp, index) => ({
  x: camp.x,
  z: camp.z - 11.8,
  yaw: 0.6 + index * 0.7
}));
export const CAMP_CARTS: readonly DressingPlacement[] = CAMPS.map((camp, index) => ({
  x: camp.x + 7.5,
  z: camp.z - 10.5,
  yaw: 0.9 + index * 0.55
}));

/** Small grave field north-west of the Fallen Keep (region 0), outside the walls and off the roads. */
export const KEEP_GRAVES: readonly DressingPlacement[] = [
  {x: -14.5, z: 11.0, yaw: 0.2},
  {x: -17.0, z: 8.5, yaw: 1.1},
  {x: -15.5, z: 5.5, yaw: 2.4},
  {x: -19.0, z: 12.5, yaw: 0.7},
  {x: -20.5, z: 9.0, yaw: 1.8},
  {x: -18.0, z: 5.5, yaw: 2.9},
  {x: -12.8, z: 13.5, yaw: 0.4},
  {x: -21.5, z: 5.0, yaw: 1.5},
  {x: -24.0, z: 12.0, yaw: 2.2},
  {x: -16.0, z: 15.0, yaw: 3.0}
];

/** Counts for the Lead/QA report. */
export const ENVIRONMENT_DRESSING = {
  braziers: GATE_BRAZIERS.length,
  flames: GATE_BRAZIERS.length,
  banners: GATE_BANNERS.length,
  stakes: ROADSIDE_STAKES.length,
  campBarrels: CAMP_BARRELS.length,
  campCarts: CAMP_CARTS.length,
  keepGraves: KEEP_GRAVES.length
} as const;

// ---------------------------------------------------------------------------------------------
// Cycle-3 regional identity: one landmark per region plus region-specific prop dressing. All of it
// goes through the same quantization-safe instanced path; every scatter prop is distance-culled
// through instance-buffer compaction. Coordinates validated against shared/world, scene.ts's
// deterministic cart/grave/rock scatter and every batch 10A-E placement.
// ---------------------------------------------------------------------------------------------

export type LandmarkKey = 'green' | 'ashen' | 'crown';
export type LandmarkAsset = 'village_house_ruin' | 'chapel_ruin' | 'watchtower_ruin';

export interface LandmarkPlacement {
  key: LandmarkKey;
  asset: LandmarkAsset;
  x: number;
  z: number;
  yaw: number;
  /** Target structure height in metres. */
  height: number;
  /** Base height above ground (the Frozen Crown watchtower stands on a rocky outcrop). */
  baseY: number;
}

/**
 * One distinguishable landmark per region, placed near the region road so it is readable while
 * travelling. The Ashen chapel is the Phase-B gothic ruin at 10 m (larger than the batch-10B chapel
 * set pieces); the Frozen Crown watchtower stands on the rocky outcrop below (top ~11.8 m); Green
 * March gets the village-house ruin + standing-stone circle, sited east of the keep so it does not
 * crowd the spawn road/gate view (>=25 m from spawn, >=8 m off every road centreline).
 */
export const REGION_LANDMARKS: readonly LandmarkPlacement[] = [
  {key: 'green', asset: 'village_house_ruin', x: 56, z: -6, yaw: -1.94, height: 6.2, baseY: 0},
  {key: 'ashen', asset: 'chapel_ruin', x: -36, z: -228, yaw: 1.35, height: 10.0, baseY: 0},
  {key: 'crown', asset: 'watchtower_ruin', x: -34, z: -472, yaw: 1.0, height: 9.0, baseY: 2.8}
];

/** Raised rocky outcrop putting the Frozen Crown watchtower on high ground (existing rocks asset). */
export const LANDMARK_ROCKS: readonly {x: number; z: number; yaw: number; height: number}[] = [
  {x: -37.6, z: -474.6, yaw: 0.3, height: 3.2},
  {x: -31.4, z: -469.4, yaw: 1.7, height: 2.4},
  {x: -33.2, z: -477.2, yaw: 2.4, height: 2.8}
];

export interface RegionPropPlacement {
  x: number;
  z: number;
  yaw: number;
  height: number;
}

/** Dead, gnarled trees scattered through the Ashen Moor (region 1), clustered around the chapel. */
export const DEAD_TREES: readonly RegionPropPlacement[] = [
  {x: -30, z: -212, yaw: 0.4, height: 6.2},
  {x: -44, z: -244, yaw: 1.9, height: 5.4},
  {x: -28, z: -262, yaw: 3.1, height: 6.8},
  {x: -50, z: -258, yaw: 4.5, height: 5.8},
  {x: -16, z: -204, yaw: 5.8, height: 6.4},
  {x: -12, z: -258, yaw: 1.1, height: 5.0},
  {x: -40, z: -206, yaw: 2.6, height: 7.0},
  {x: -52, z: -240, yaw: 3.9, height: 5.6},
  {x: -22, z: -250, yaw: 5.2, height: 6.6},
  {x: -38, z: -290, yaw: 0.8, height: 6.0},
  {x: -46, z: -276, yaw: 2.2, height: 6.5},
  {x: -22, z: -282, yaw: 3.6, height: 5.2}
];

/** Ice-shard clusters scattered through the Frozen Crown (region 2). */
export const ICE_SHARDS: readonly RegionPropPlacement[] = [
  {x: -28, z: -452, yaw: 0.3, height: 2.2},
  {x: -40, z: -466, yaw: 1.5, height: 1.8},
  {x: -24, z: -486, yaw: 2.7, height: 2.6},
  {x: -44, z: -494, yaw: 3.9, height: 2.0},
  {x: -18, z: -444, yaw: 5.1, height: 1.6},
  {x: -34, z: -512, yaw: 0.6, height: 2.4},
  {x: -48, z: -478, yaw: 1.8, height: 1.9},
  {x: 14, z: -444, yaw: 3.0, height: 2.8},
  {x: 36, z: -470, yaw: 4.2, height: 2.1},
  {x: -14, z: -556, yaw: 5.4, height: 2.5},
  {x: -30, z: -596, yaw: 0.9, height: 1.7},
  {x: 20, z: -612, yaw: 2.1, height: 2.3}
];

/** Standing stones in the Green March (region 0): ruined 8-stone circle at the village ruin + loose stones. */
export const STANDING_STONES: readonly RegionPropPlacement[] = [
  // Circle around the village-house landmark (56,-6), radius 9.8 m; one slot is missing where the
  // circle collapsed. Sited east of the keep, well clear of the spawn road/gate view.
  {x: 64.35, z: -0.88, yaw: 2.18, height: 3.2},
  {x: 59.12, z: 3.29, yaw: 2.11, height: 2.8},
  {x: 52.42, z: 3.12, yaw: 2.04, height: 3.4},
  {x: 47.41, z: -1.29, yaw: 1.97, height: 3.0},
  {x: 46.4, z: -7.95, yaw: 1.9, height: 2.6},
  {x: 49.83, z: -13.61, yaw: 1.83, height: 3.1},
  {x: 55.83, z: -15.8, yaw: 1.76, height: 2.9},
  {x: 65.69, z: -7.44, yaw: 1.62, height: 3.3},
  // Loose stones along the keep -> crossing road section.
  {x: -24, z: -4, yaw: 0.7, height: 2.5},
  {x: -30, z: 24, yaw: 2.2, height: 3.0},
  {x: -14, z: 2, yaw: 3.7, height: 2.8},
  {x: 34, z: 22, yaw: 5.2, height: 2.6},
  {x: 44, z: 8, yaw: 0.4, height: 3.1}
];

/** Region landmark counts + QA framing poses for the regional landmarks. */
export const REGION_IDENTITY = {
  landmarks: REGION_LANDMARKS.length,
  landmarkRocks: LANDMARK_ROCKS.length,
  deadTrees: DEAD_TREES.length,
  iceShards: ICE_SHARDS.length,
  standingStones: STANDING_STONES.length
} as const;

function landmarkPose(key: LandmarkKey, cx: number, cz: number, height: number, tx: number, tz: number, ty: number) {
  const dx = tx - cx;
  const dz = tz - cz;
  return {
    key,
    x: cx,
    z: cz,
    height,
    yaw: Math.atan2(dx, -dz),
    pitch: Math.atan2(ty - height, Math.max(0.01, Math.hypot(dx, dz))),
    distance: Math.hypot(dx, dz)
  };
}

/** Ready-to-use `__ssQAPose({x,z,yaw,pitch,height})` values framing each landmark from its road. */
export const LANDMARK_QA_POSES = [
  landmarkPose('green', 69.2, -21, 2.8, 56, -6, 3.0),
  landmarkPose('ashen', -36, -190, 3.2, -36, -228, 5.0),
  landmarkPose('crown', -34, -432, 3.2, -34, -472, 7.3)
] as const;

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
/** Courtyard furniture hides a bit before the camera far plane. */
const PROP_RANGE = 75;
/** Environment dressing is distance-culled; compaction keeps far instances out of the draw. */
const DRESSING_RANGE = 85;
/** Destroy the weapon content instanced meshes after this long out of range (seconds). */
const CONTENT_IDLE_DISPOSE = 20;
/** At most a couple of friendly castles can ever be within RACK_CONTENT_RANGE. */
const MAX_VISIBLE_RACKS = 3;
/** GLTF assets are instanced per region so far regions still frustum-cull. */
const REGION_COUNT = REGIONS.length;

const CAMP_INDEX = new Map<string, number>(CAMPS.map((camp, index) => [camp.id, index]));
const CASTLE_INDEX = new Map<string, number>(CASTLES.map((castle, index) => [castle.id, index]));

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _matrixA = new THREE.Matrix4();

// ---------------------------------------------------------------------------------------------
// GLTF instancing: geometry is never modified (KHR_mesh_quantization safe); each mesh's world
// transform becomes a constant local matrix folded into every instance matrix.
// ---------------------------------------------------------------------------------------------

interface PreparedPrimitive {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** normalize * mesh.matrixWorld: ground-centre the asset and include any dequantisation scale. */
  localMatrix: THREE.Matrix4;
}

interface PreparedAsset {
  primitives: PreparedPrimitive[];
  height: number;
  longExtent: number;
  sizeX: number;
  sizeZ: number;
}

function prepareAsset(root: THREE.Object3D): PreparedAsset | null {
  try {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) return null;
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.001) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    const normalize = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
    const primitives: PreparedPrimitive[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return;
      object.geometry.computeBoundingSphere();
      primitives.push({
        geometry: object.geometry,
        material: object.material,
        localMatrix: new THREE.Matrix4().multiplyMatrices(normalize, object.matrixWorld)
      });
    });
    if (primitives.length === 0) return null;
    return {primitives, height: size.y, longExtent: Math.max(size.x, size.z, 0.001), sizeX: size.x, sizeZ: size.z};
  } catch (error) {
    console.warn('[ruins] asset prepare failed', error);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Instanced layer helpers.
// ---------------------------------------------------------------------------------------------

interface PlacementSpec {
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  /** -1 = not a camp placement; otherwise index into CAMPS for rescue/distance culling. */
  campIndex: number;
  /** -1 = not a castle placement; otherwise index into CASTLES for distance/ownership culling. */
  castleIndex: number;
  /** Player-distance cull in metres (0 = no extra distance cull). */
  cullRange: number;
  /** Only visible while the castle in `castleIndex` is friendly (captured-courtyard dressing). */
  requireFriendly: boolean;
}

interface InstanceRecord {
  /** Placement matrix (position / yaw / uniform scale). */
  placement: THREE.Matrix4;
  campIndex: number;
  castleIndex: number;
  cullRange: number;
  requireFriendly: boolean;
}

interface InstancedLayer {
  meshes: THREE.InstancedMesh[];
  /** Per-mesh constant local matrix (normalise * mesh world transform). */
  localMatrices: THREE.Matrix4[];
  records: InstanceRecord[];
  cullable: boolean;
  visibility: Uint8Array;
  initialized: boolean;
  activeCount: number;
}

function placementMatrix(x: number, y: number, z: number, yaw: number, scale: number): THREE.Matrix4 {
  _euler.set(0, yaw, 0);
  _quaternion.setFromEuler(_euler);
  _position.set(x, y, z);
  _scale.setScalar(scale);
  return new THREE.Matrix4().compose(_position, _quaternion, _scale);
}

function wantsCastShadow(name: string): boolean {
  // Match scene.ts trimShadowCasters(): architecture + the 12 ruin set pieces + tents + walls cast.
  return name.startsWith('ruins:') || name.startsWith('walls:') || name.startsWith('tents:');
}

function createLayer(
  scene: THREE.Scene,
  prepared: PreparedAsset,
  specs: readonly PlacementSpec[],
  name: string,
  cullable: boolean,
  architecture = false
): InstancedLayer | null {
  if (specs.length === 0) return null;
  const records: InstanceRecord[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    records.push({
      placement: placementMatrix(spec.x, spec.y, spec.z, spec.yaw, spec.scale),
      campIndex: spec.campIndex,
      castleIndex: spec.castleIndex,
      cullRange: spec.cullRange,
      requireFriendly: spec.requireFriendly
    });
  }
  const meshes: THREE.InstancedMesh[] = [];
  const localMatrices: THREE.Matrix4[] = [];
  for (let p = 0; p < prepared.primitives.length; p++) {
    const primitive = prepared.primitives[p];
    const instanced = new THREE.InstancedMesh(primitive.geometry, primitive.material, specs.length);
    instanced.name = `${name}:${p}`;
    instanced.castShadow = architecture ? true : wantsCastShadow(name);
    instanced.receiveShadow = true;
    if (architecture) instanced.userData.architecture = true;
    if (!cullable) {
      for (let i = 0; i < records.length; i++) {
        _matrixA.multiplyMatrices(records[i].placement, primitive.localMatrix);
        instanced.setMatrixAt(i, _matrixA);
      }
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
    } else {
      instanced.count = 0;
      instanced.visible = false;
    }
    scene.add(instanced);
    meshes.push(instanced);
    localMatrices.push(primitive.localMatrix);
  }
  return {meshes, localMatrices, records, cullable, visibility: new Uint8Array(records.length), initialized: false, activeCount: 0};
}

/** Procedural banner post (pole + hanging cloth, vertex-coloured, one draw for all castles). */
function prepareBanner(): PreparedAsset {
  const paint = (geometry: THREE.BufferGeometry, rgb: [number, number, number]): THREE.BufferGeometry => {
    const g = geometry.toNonIndexed();
    g.deleteAttribute('uv');
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };
  const pole = new THREE.CylinderGeometry(0.055, 0.08, 3.7, 6, 1, false);
  pole.translate(0, 1.85, 0);
  const cloth = new THREE.PlaneGeometry(0.95, 0.72, 1, 1);
  cloth.translate(0.52, 2.95, 0);
  const merged = mergeGeometries([paint(pole, [0.42, 0.33, 0.22]), paint(cloth, [0.82, 0.86, 0.8])], false);
  pole.dispose();
  cloth.dispose();
  const geometry = merged ?? new THREE.BufferGeometry();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({vertexColors: true, color: 0x6f9a80, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide});
  return {primitives: [{geometry, material, localMatrix: new THREE.Matrix4()}], height: 3.7, longExtent: 1.0, sizeX: 1.0, sizeZ: 1.0};
}

/** Procedural ember/flame cone for the gate braziers (emissive look, no dynamic light). */
function prepareFlame(): PreparedAsset {
  const geometry = new THREE.ConeGeometry(0.3, 0.95, 6, 1, false);
  geometry.translate(0, 0.475, 0);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({color: 0xffa04a, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false});
  return {primitives: [{geometry, material, localMatrix: new THREE.Matrix4()}], height: 0.95, longExtent: 0.6, sizeX: 0.6, sizeZ: 0.6};
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
  /** Layers whose instance list depends on player/castle state. */
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

  function baseSpec(x: number, z: number, yaw: number, scale: number): PlacementSpec {
    return {x, z, y: 0, yaw, scale, campIndex: -1, castleIndex: -1, cullRange: 0, requireFriendly: false};
  }

  async function placeSetPieces(): Promise<void> {
    await Promise.all(
      RUIN_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const prepared = prepareAsset(gltf.scene);
        if (!prepared) return;
        // One layer per region so the camera far plane culls the other two regions.
        for (let region = 0; region < REGION_COUNT; region++) {
          const specs: PlacementSpec[] = [];
          for (const placement of RUIN_PLACEMENTS) {
            if (placement.asset !== asset || placement.region !== region) continue;
            specs.push(baseSpec(placement.x, placement.z, placement.rotY, placement.height / prepared.height));
          }
          createLayer(scene, prepared, specs, `ruins:${asset}:r${region}`, false);
        }
      })
    );
  }

  async function placeStoneWalls(): Promise<void> {
    const gltf = await loadModel('custom/stone_wall');
    if (!gltf) return;
    const prepared = prepareAsset(gltf.scene);
    if (!prepared) return;
    const longAxisIsZ = prepared.sizeZ >= prepared.sizeX;
    for (let region = 0; region < REGION_COUNT; region++) {
      const specs: PlacementSpec[] = [];
      for (const wall of STONE_WALL_PLACEMENTS) {
        if (wall.region !== region) continue;
        const yaw = longAxisIsZ ? wall.rotY : wall.rotY - Math.PI / 2;
        specs.push(baseSpec(wall.x, wall.z, yaw, wall.length / prepared.longExtent));
      }
      createLayer(scene, prepared, specs, `walls:r${region}`, false);
    }
  }

  async function placeCampTents(): Promise<void> {
    const gltf = await loadModel('custom/camp_tent');
    if (!gltf) return;
    const prepared = prepareAsset(gltf.scene);
    if (!prepared) return;
    for (let region = 0; region < REGION_COUNT; region++) {
      const specs: PlacementSpec[] = [];
      for (let campIndex = region * 3; campIndex < region * 3 + 3 && campIndex < CAMPS.length; campIndex++) {
        const camp = CAMPS[campIndex];
        const layout = CAMP_TENTS[campIndex % CAMP_TENTS.length];
        for (let tentIndex = 0; tentIndex < layout.length; tentIndex++) {
          const tent = layout[tentIndex];
          const yaw = Math.atan2(-tent.dx, -tent.dz) + Math.sin(campIndex * 2.1 + tentIndex * 1.7) * 0.32;
          const height = tent.height * (0.94 + ((campIndex * 5 + tentIndex * 2) % 3) * 0.05);
          const spec = baseSpec(camp.x + tent.dx, camp.z + tent.dz, yaw, height / prepared.height);
          spec.campIndex = campIndex;
          specs.push(spec);
        }
      }
      addCullableLayer(createLayer(scene, prepared, specs, `tents:r${region}`, true));
    }
  }

  async function placePropAssets(): Promise<void> {
    await Promise.all(
      PROP_ASSETS.map(async (asset) => {
        const gltf = await loadModel(`custom/${asset}`);
        if (!gltf) return;
        const prepared = prepareAsset(gltf.scene);
        if (!prepared) return;
        for (let region = 0; region < REGION_COUNT; region++) {
          const specs: PlacementSpec[] = [];
          // Courtyard furniture: three castles per region, culled by castle distance.
          for (let castleIndex = region * 3; castleIndex < region * 3 + 3 && castleIndex < CASTLES.length; castleIndex++) {
            const castle = CASTLES[castleIndex];
            for (const prop of COURTYARD_PROPS) {
              if (prop.asset !== asset) continue;
              const spec = baseSpec(castle.x + prop.dx, castle.z + prop.dz, prop.rotY, prop.height / prepared.height);
              spec.castleIndex = castleIndex;
              specs.push(spec);
            }
          }
          // Survivor-camp furniture: rescue/distance culling.
          for (let campIndex = region * 3; campIndex < region * 3 + 3 && campIndex < CAMPS.length; campIndex++) {
            const camp = CAMPS[campIndex];
            for (const prop of CAMP_PROPS) {
              if (prop.asset !== asset) continue;
              const spec = baseSpec(camp.x + prop.dx, camp.z + prop.dz, prop.rotY, prop.height / prepared.height);
              spec.campIndex = campIndex;
              specs.push(spec);
            }
          }
          addCullableLayer(createLayer(scene, prepared, specs, `props:${asset}:r${region}`, true));
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
      const matrix = placementMatrix(castle.x + RACK_DX, 0, castle.z + RACK_DZ, RACK_YAW, 1);
      const hidden = placementMatrix(castle.x + RACK_DX, 0, castle.z + RACK_DZ, RACK_YAW, 0);
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
      const placement = records[i].placement;
      for (let m = 0; m < layer.meshes.length; m++) {
        _matrixA.multiplyMatrices(placement, layer.localMatrices[m]);
        layer.meshes[m].setMatrixAt(write, _matrixA);
      }
      write++;
    }
    layer.activeCount = write;
    for (let m = 0; m < layer.meshes.length; m++) {
      const mesh = layer.meshes[m];
      mesh.count = write;
      mesh.visible = write > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (write > 0) mesh.computeBoundingSphere();
    }
  }

  // ---- cycle-2 dressing: existing shipped assets only, one distance-culled layer per asset ----
  async function placeDressingAsset(
    assetName: string,
    placements: readonly DressingPlacement[],
    targetHeight: number,
    layerName: string,
    options: {campIndex?: readonly number[]; castleIndex?: readonly number[]; friendly?: boolean; y?: number; scaleVariance?: boolean} = {}
  ): Promise<void> {
    const gltf = await loadModel(`custom/${assetName}`);
    if (!gltf) return;
    const prepared = prepareAsset(gltf.scene);
    if (!prepared) return;
    const specs: PlacementSpec[] = [];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const variance = options.scaleVariance ? 0.9 + ((i * 7) % 5) * 0.05 : 1;
      const spec = baseSpec(p.x, p.z, p.yaw, (targetHeight / prepared.height) * variance);
      spec.y = options.y ?? 0;
      spec.cullRange = DRESSING_RANGE;
      if (options.campIndex && options.campIndex[i] !== undefined) spec.campIndex = options.campIndex[i];
      if (options.castleIndex && options.castleIndex[i] !== undefined) spec.castleIndex = options.castleIndex[i];
      spec.requireFriendly = options.friendly === true;
      specs.push(spec);
    }
    addCullableLayer(createLayer(scene, prepared, specs, layerName, true));
  }

  // ---- cycle-3 regional identity: one landmark per region + region-specific scatter ----
  async function placeRockOutcrop(): Promise<void> {
    // Raised rocky outcrop putting the Frozen Crown watchtower on high ground (existing rocks asset).
    const rockGltf = await loadModel('rocks-large');
    if (!rockGltf) return;
    const rockPrepared = prepareAsset(rockGltf.scene);
    if (!rockPrepared) return;
    const rockSpecs = LANDMARK_ROCKS.map((rock) => baseSpec(rock.x, rock.z, rock.yaw, rock.height / rockPrepared.height));
    createLayer(scene, rockPrepared, rockSpecs, 'landmark:crown:rocks', false, true);
  }

  async function placeRegionLandmarks(): Promise<void> {
    await Promise.all([
      ...REGION_LANDMARKS.map(async (landmark) => {
        const gltf = await loadModel(`custom/${landmark.asset}`);
        if (!gltf) return;
        const prepared = prepareAsset(gltf.scene);
        if (!prepared) return;
        const spec = baseSpec(landmark.x, landmark.z, landmark.yaw, landmark.height / prepared.height);
        spec.y = landmark.baseY;
        // Large structures: mark as architecture so scene.ts's shadow trim keeps their castShadow.
        createLayer(scene, prepared, [spec], `landmark:${landmark.key}:${landmark.asset}`, false, true);
      }),
      placeRockOutcrop()
    ]);
  }

  async function placeRegionPropAsset(assetName: string, placements: readonly RegionPropPlacement[], layerName: string): Promise<void> {
    const gltf = await loadModel(`custom/${assetName}`);
    if (!gltf) return;
    const prepared = prepareAsset(gltf.scene);
    if (!prepared) return;
    const specs: PlacementSpec[] = [];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const spec = baseSpec(p.x, p.z, p.yaw, p.height / prepared.height);
      spec.cullRange = DRESSING_RANGE;
      specs.push(spec);
    }
    addCullableLayer(createLayer(scene, prepared, specs, layerName, true));
  }

  function buildBanners(): void {
    const prepared = prepareBanner();
    const specs: PlacementSpec[] = [];
    for (const banner of GATE_BANNERS) {
      const castle = CASTLES[banner.castle];
      const spec = baseSpec(banner.x, banner.z, Math.atan2(castle.x - banner.x, castle.z - banner.z), 1);
      spec.castleIndex = banner.castle;
      spec.requireFriendly = true;
      spec.cullRange = DRESSING_RANGE;
      specs.push(spec);
    }
    addCullableLayer(createLayer(scene, prepared, specs, 'dressing:banners', true));
  }

  function buildFlames(): void {
    const prepared = prepareFlame();
    const specs: PlacementSpec[] = [];
    for (let i = 0; i < GATE_BRAZIERS.length; i++) {
      const brazier = GATE_BRAZIERS[i];
      const spec = baseSpec(brazier.x, brazier.z, brazier.yaw, 0.9 + ((i * 3) % 4) * 0.08);
      spec.y = 0.72;
      spec.cullRange = DRESSING_RANGE;
      specs.push(spec);
    }
    addCullableLayer(createLayer(scene, prepared, specs, 'dressing:flames', true));
  }

  buildRackShells();
  void Promise.all([
    placeSetPieces(),
    placeStoneWalls(),
    placeCampTents(),
    placePropAssets(),
    loadWeaponSources(),
    placeDressingAsset('brazier', GATE_BRAZIERS, 1.35, 'dressing:braziers', {scaleVariance: true}),
    placeDressingAsset('stakes', ROADSIDE_STAKES, 1.0, 'dressing:stakes', {scaleVariance: true}),
    placeDressingAsset('barrels', CAMP_BARRELS, 1.45, 'dressing:barrels', {campIndex: CAMP_BARRELS.map((_, i) => i), scaleVariance: true}),
    placeDressingAsset('cart', CAMP_CARTS, 1.05, 'dressing:carts', {campIndex: CAMP_CARTS.map((_, i) => i)}),
    placeDressingAsset('grave', KEEP_GRAVES, 1.13, 'dressing:graves', {scaleVariance: true}),
    placeRegionLandmarks(),
    placeRegionPropAsset('dead_tree', DEAD_TREES, 'regionprops:dead_tree'),
    placeRegionPropAsset('ice_shard', ICE_SHARDS, 'regionprops:ice_shard'),
    placeRegionPropAsset('standing_stone', STANDING_STONES, 'regionprops:standing_stone')
  ]).catch((error) => console.warn('[ruins] asynchronous placement failed', error));
  buildBanners();
  buildFlames();

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
      // Castle ownership flags (rack shells, banners and content streaming).
      for (let i = 0; i < castleFriendly.length; i++) castleFriendly[i] = 0;
      if (game) {
        const castles = game.castles;
        for (let i = 0; i < castles.length; i++) {
          const index = CASTLE_INDEX.get(castles[i].id);
          if (index !== undefined) castleFriendly[index] = castles[i].friendly ? 1 : 0;
        }
      }

      // State-driven instance compaction for tents, furniture and cycle-2 dressing.
      const campRangeSq = CAMP_RANGE * CAMP_RANGE;
      const propRangeSq = PROP_RANGE * PROP_RANGE;
      for (let l = 0; l < cullableLayers.length; l++) {
        const layer = cullableLayers[l];
        const records = layer.records;
        const visibility = layer.visibility;
        let changed = !layer.initialized;
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          let visible = true;
          if (record.requireFriendly) {
            visible = record.castleIndex >= 0 && castleFriendly[record.castleIndex] === 1;
          }
          const px = record.placement.elements[12];
          const pz = record.placement.elements[14];
          if (visible && record.campIndex >= 0) {
            visible = campRescued[record.campIndex] === 0;
            if (visible && hasMe) {
              const dx = meX - px;
              const dz = meZ - pz;
              visible = dx * dx + dz * dz <= campRangeSq;
            }
          } else if (visible && record.castleIndex >= 0 && record.cullRange === 0) {
            if (hasMe) {
              const dx = meX - px;
              const dz = meZ - pz;
              visible = dx * dx + dz * dz <= propRangeSq;
            }
          }
          if (visible && record.cullRange > 0 && hasMe) {
            const dx = meX - px;
            const dz = meZ - pz;
            visible = dx * dx + dz * dz <= record.cullRange * record.cullRange;
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
