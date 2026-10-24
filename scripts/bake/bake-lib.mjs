// Shared bake helpers for Swords & Shrouds custom GLB pipeline (asset-forge).
// Tooling modules live under scripts/custom-assets/node_modules; import them by relative
// file path (no npm install in the game repo). Bare imports *inside* those packages
// resolve up the tree to scripts/custom-assets/node_modules automatically.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab';
export const WAREHOUSE = 'C:/Users/neil/Desktop/AIprojects/swords/sketchlab';
export const OUT_DIR = path.join(GAME, 'public/assets/custom');
export const MODULES = path.join(GAME, 'scripts/custom-assets/node_modules');

// ---- mat4 (column-major, gl-matrix layout) -------------------------------------------
export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mat4RotateX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
export function mat4RotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
export function mat4RotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
export function mat4Translate(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
export function mat4Scale(x, y, z) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}
export function mat4Mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      o[i * 4 + j] = a[0 * 4 + j] * b[i * 4 + 0] + a[1 * 4 + j] * b[i * 4 + 1] + a[2 * 4 + j] * b[i * 4 + 2] + a[3 * 4 + j] * b[i * 4 + 3];
  return o;
}
export function mat4RotateAxis(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}
/** Rotation taking unit vector `from` onto +Y. */
export function mat4AlignToY(from) {
  const [fx, fy, fz] = from;
  const len = Math.hypot(fx, fy, fz) || 1;
  const u = [fx / len, fy / len, fz / len];
  if (u[1] > 0.999999) return [...IDENTITY];
  if (u[1] < -0.999999) return mat4RotateX(Math.PI);
  // rotation axis = u x Y = (-u_z, 0, u_x)
  const axis = [-u[2], 0, u[0]];
  const al = Math.hypot(...axis);
  const angle = Math.acos(Math.max(-1, Math.min(1, u[1])));
  return mat4RotateAxis([axis[0] / al, 0, axis[2] / al], angle);
}

// ---- file helpers ---------------------------------------------------------------------
export function gzip9(buf) {
  return zlib.gzipSync(buf, {level: 9});
}
export function gzSize(p) {
  return fs.statSync(p).size;
}
export function ensureDir(p) {
  fs.mkdirSync(p, {recursive: true});
}

// ---- document helpers -----------------------------------------------------------------
export function triangleCount(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  return tris;
}

export function primitiveCounts(doc) {
  let tris = 0, prims = 0, missingUv = 0, unindexed = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      prims++;
      const idx = prim.getIndices();
      if (!idx) unindexed++;
      else tris += idx.getCount() / 3;
      if (!prim.getAttribute('TEXCOORD_0')) missingUv++;
    }
  return {tris, prims, missingUv, unindexed};
}
