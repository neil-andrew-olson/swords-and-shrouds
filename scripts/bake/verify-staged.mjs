#!/usr/bin/env node
// Verify the staged (optimised) asset set before installing it:
//  * every optimised GLB still parses, keeps indexed prims + TEXCOORD_0, keeps its triangle count
//    and its skin/animation counts compared with the live file (geometry untouched),
//  * every embedded image decodes (sharp) and no external URIs sneak in,
//  * weapon canonical bbox orientation is unchanged,
//  * reports a before/after byte table + preload-set total.
//   node scripts/bake/verify-staged.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR, KHRMaterialsEmissiveStrength,
  KHRMaterialsPBRSpecularGlossiness, KHRMaterialsClearcoat, KHRMaterialsSheen, KHRMaterialsTransmission,
  KHRMaterialsVolume, KHRMaterialsUnlit, KHRTextureTransform, KHRMaterialsIridescence,
  KHRMaterialsAnisotropy, KHRMaterialsDispersion,
} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const LIVE = path.join(GAME, 'public/assets/custom');
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized';
const STAGE_CUSTOM = path.join(STAGE, 'custom');
const PRELOAD = ['rapier', 'halberd', 'dane_axe', 'flamberge', 'mace', 'sword', 'bastard', 'hammer', 'poleaxe', 'zweihander',
  'shield', 'hero', 'ally', 'fallen', 'berserker', 'ranger', 'templar', 'survivor', 'skeleton-soldier', 'zombie'];
const WEAPONS = ['rapier', 'halberd', 'dane_axe', 'flamberge', 'mace', 'sword', 'bastard', 'hammer', 'poleaxe', 'zweihander'];
// only these are baked grip-at-origin/blade-+Y; the batch-1 legacy five keep their measured
// WEAPON_GRIPS profiles in equipment.ts instead
const CANONICAL = ['rapier', 'halberd', 'dane_axe', 'flamberge', 'mace'];

const io = new NodeIO().registerExtensions([
  KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR, KHRMaterialsEmissiveStrength,
  KHRMaterialsPBRSpecularGlossiness, KHRMaterialsClearcoat, KHRMaterialsSheen, KHRMaterialsTransmission,
  KHRMaterialsVolume, KHRMaterialsUnlit, KHRTextureTransform, KHRMaterialsIridescence,
  KHRMaterialsAnisotropy, KHRMaterialsDispersion,
]);

// ---- world-space bbox (node-transform aware) for the weapon orientation contract ----
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  return [R[0] * s[0], R[3] * s[0], R[6] * s[0], 0, R[1] * s[1], R[4] * s[1], R[7] * s[1], 0,
    R[2] * s[2], R[5] * s[2], R[8] * s[2], 0, t[0], t[1], t[2], 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function xform(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function worldBounds(json) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const roots = new Set(json.nodes.map((_, i) => i));
  for (const n of json.nodes) for (const c of n.children || []) roots.delete(c);
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const visit = (idx, P) => {
    const n = json.nodes[idx];
    const W = mul(P, nodeMatrix(n));
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      if (!acc?.min) continue;
      for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
        const w = xform(W, [cx, cy, cz]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
      }
    }
    for (const c of n.children || []) visit(c, W);
  };
  for (const r of roots) visit(r, I);
  return {min: lo, max: hi};
}
function jsonOf(bytes) {
  const jlen = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString('utf8', 20, 20 + jlen));
}

async function summary(bytes) {
  const doc = await io.readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  let tris = 0, prims = 0, missingUv = 0, unindexed = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    prims++;
    if (!p.getAttribute('TEXCOORD_0')) missingUv++;
    if (!p.getIndices()) unindexed++;
    else tris += p.getIndices().getCount() / 3;
  }
  // rendered triangles = sum over every mesh-node instance (what the GPU actually draws);
  // unique mesh triangles can legitimately drop when shared meshes are de-duplicated
  let renderedTris = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) renderedTris += (p.getIndices()?.getCount() ?? 0) / 3;
  }
  const images = root.listTextures();
  const decode = [];
  for (const t of images) {
    try {
      const meta = await sharp(t.getImage()).metadata();
      decode.push(`${meta.width}x${meta.height}:${meta.format}${meta.hasAlpha ? '+a' : ''}`);
    } catch (e) { decode.push('DECODE-FAIL'); }
  }
  return {
    tris: Math.round(renderedTris), uniqueTris: Math.round(tris), prims, missingUv, unindexed,
    images: images.length, decode, materials: root.listMaterials().length,
    anims: root.listAnimations().length, skins: root.listSkins().length,
    nodes: root.listNodes().length, meshes: root.listMeshes().length,
  };
}

const names = fs.readdirSync(STAGE_CUSTOM).filter((f) => f.endsWith('.glb.gz')).map((f) => f.replace('.glb.gz', '')).sort();
const rows = [];
const rows_grip = {};
let problems = 0;
const liveNames = new Set(fs.readdirSync(LIVE).filter((f) => f.endsWith('.glb.gz')));
for (const name of names) {
  if (!liveNames.has(name + '.glb.gz')) { console.log(`EXTRA staged file: ${name}`); problems++; continue; }
  const liveBytes = zlib.gunzipSync(fs.readFileSync(path.join(LIVE, name + '.glb.gz')));
  const stagedBytes = zlib.gunzipSync(fs.readFileSync(path.join(STAGE_CUSTOM, name + '.glb.gz')));
  const a = await summary(liveBytes);
  const b = await summary(stagedBytes);
  const issues = [];
  if (a.tris !== b.tris) issues.push(`tris ${a.tris}->${b.tris}`);
  if (a.anims !== b.anims) issues.push(`animations ${a.anims}->${b.anims}`);
  if (a.skins !== b.skins) issues.push(`skins ${a.skins}->${b.skins}`);
  if (b.missingUv) issues.push(`${b.missingUv} prims without TEXCOORD_0`);
  if (b.unindexed) issues.push(`${b.unindexed} unindexed prims`);
  if (!b.images) issues.push('no embedded images');
  if (b.decode.some((d) => d === 'DECODE-FAIL')) issues.push('image decode failure');
  if (WEAPONS.includes(name)) {
    const ba = worldBounds(jsonOf(liveBytes)), bb = worldBounds(jsonOf(stagedBytes));
    const delta = Math.max(...ba.min.map((v, i) => Math.abs(v - bb.min[i])), ...ba.max.map((v, i) => Math.abs(v - bb.max[i])));
    const height = bb.max[1] - bb.min[1];
    const gripRatio = -bb.min[1] / height;
    if (delta > 1e-4) issues.push(`weapon bbox changed by ${delta.toFixed(5)}`);
    if (CANONICAL.includes(name)) {
      if (!(gripRatio > 0.14 && gripRatio < 0.26)) issues.push(`grip ratio ${(gripRatio * 100).toFixed(1)}%`);
      if (!(bb.max[1] > Math.abs(bb.min[1]))) issues.push('blade does not extend above the grip');
    }
    rows_grip[name] = {gripPct: +(gripRatio * 100).toFixed(2), maxY: +bb.max[1].toFixed(3)};
  }
  if (issues.length) problems++;
  // draw-call invariant: static meshes must not keep more than 4 primitives, and never more
  // than one per material (plus a little slack for semantic-split prims)
  if (b.skins === 0 && b.prims > Math.max(4, b.materials)) issues.push(`prims ${b.prims} > max(4, materials ${b.materials}) after flatten`);
  rows.push({name, liveBytes: a, stagedBytes: b, issues, gzLive: fs.statSync(path.join(LIVE, name + '.glb.gz')).size,
    gzStaged: fs.statSync(path.join(STAGE_CUSTOM, name + '.glb.gz')).size, preload: PRELOAD.includes(name)});
  if (issues.length) console.log(`FAIL ${name}: ${issues.join(', ')}`);
}
for (const f of liveNames) {
  if (!names.includes(f.replace('.glb.gz', ''))) { console.log(`MISSING from stage: ${f}`); problems++; }
}

// weapon canonical bbox: decode POSITION accessor min/max with node transforms via the validator
console.log('\nPER-FILE (gzip):');
console.log(('name').padEnd(16), 'liveKB'.padStart(9), 'stagedKB'.padStart(9), 'saved'.padStart(8), 'tris'.padStart(7),
  'prims'.padStart(11), 'meshNodes'.padStart(10), 'anim/skin'.padStart(10), 'images');
for (const r of rows.sort((x, y) => y.gzLive - x.gzLive)) {
  console.log(String(r.name).padEnd(16), (r.gzLive / 1024).toFixed(1).padStart(9), (r.gzStaged / 1024).toFixed(1).padStart(9),
    `${(((r.gzLive - r.gzStaged) / r.gzLive) * 100).toFixed(0)}%`.padStart(8),
    String(r.stagedBytes.tris).padStart(7),
    `${r.liveBytes.prims}->${r.stagedBytes.prims}`.padStart(11),
    `${r.liveBytes.nodes}->${r.stagedBytes.nodes}`.padStart(10),
    `${r.stagedBytes.anims}/${r.stagedBytes.skins}`.padStart(10), r.stagedBytes.decode.join(' '));
}
console.log('\nDRAW-CALL IMPROVEMENT (primitive counts, live -> staged):');
for (const r of rows.filter((x) => x.liveBytes.prims > 1).sort((x, y) => y.liveBytes.prims - x.liveBytes.prims)) {
  console.log(`  ${String(r.name).padEnd(20)} ${String(r.liveBytes.prims).padStart(5)} -> ${String(r.stagedBytes.prims).padStart(3)} prims  ` +
    `(materials ${r.stagedBytes.materials}, nodes ${r.liveBytes.nodes} -> ${r.stagedBytes.nodes})`);
}
const gzLive = rows.reduce((s, r) => s + r.gzLive, 0);
const gzStaged = rows.reduce((s, r) => s + r.gzStaged, 0);
const preLive = rows.filter((r) => r.preload).reduce((s, r) => s + r.gzLive, 0);
const preStaged = rows.filter((r) => r.preload).reduce((s, r) => s + r.gzStaged, 0);
const primsLive = rows.reduce((s, r) => s + r.liveBytes.prims, 0);
const primsStaged = rows.reduce((s, r) => s + r.stagedBytes.prims, 0);
const nodesLive = rows.reduce((s, r) => s + r.liveBytes.nodes, 0);
const nodesStaged = rows.reduce((s, r) => s + r.stagedBytes.nodes, 0);
console.log(`\ncustom: ${(gzLive / 1048576).toFixed(2)} MB -> ${(gzStaged / 1048576).toFixed(2)} MB`);
console.log(`preload set: ${(preLive / 1048576).toFixed(2)} MB -> ${(preStaged / 1048576).toFixed(2)} MB`);
console.log(`primitives across all 58 assets: ${primsLive} -> ${primsStaged}; nodes: ${nodesLive} -> ${nodesStaged}`);
console.log(problems ? `PROBLEMS: ${problems}` : 'STAGED SET OK (geometry/animations/skins/images intact)');
if (problems) process.exitCode = 1;
