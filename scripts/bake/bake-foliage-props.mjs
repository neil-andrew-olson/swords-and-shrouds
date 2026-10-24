#!/usr/bin/env node
// Cycle-3 Phase A foliage v2 + region props.
//
// New tree assets (pine_v2, snow_pine, oak_v2, maple) are built procedurally with proper alpha-cut
// needle/leaf cards and a night palette, plus dead_tree / standing_stone / ice_shard region props.
// Convention: identity node transforms, geometry directly in world units, ground at y = 0, trunk
// centred on x = z = 0, height ~9 units (world-scene instances them with its existing per-tree
// matrix/scale path). Materials are named so landscape.ts' foliage regex picks up wind/shading:
// "pine_needles"/"oak_leaves"/"maple_leaves"/"snow_needles" (alpha MASK, doubleSided) and "bark".
//
//   node scripts/bake/bake-foliage-props.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Document, NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const TEX = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/cycle3_tex';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_cycle3';
const io = new NodeIO();
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});
const gzip9 = (b) => zlib.gzipSync(b, {level: 9});

/* ---------------------------------------------------------------- geometry helpers */
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) { this.p.push(...p); this.n.push(...n); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get tris() { return this.idx.length / 3; }
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rng = (() => { let s = 1234567; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();

/** tapered cylinder from a to b */
function frustum(geo, a, b, r0, r1, sides = 7, uScale = 2) {
  const axis = norm(sub(b, a));
  const helper = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const xA = norm(cross(helper, axis));
  const yA = cross(axis, xA);
  const ring = (c, r, v) => {
    const row = [];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const dir = add(mul(xA, Math.cos(ang)), mul(yA, Math.sin(ang)));
      row.push(geo.vert(add(c, mul(dir, r)), dir, (s / sides) * uScale, v));
    }
    return row;
  };
  const r0row = ring(a, r0, 0), r1row = ring(b, r1, 0.5);
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    geo.quad(r0row[s], r0row[s2], r1row[s2], r1row[s]);
  }
  return geo;
}

/** foliage card: quad centred at c, facing dir, size w x h, tilted up */
function card(geo, c, dir, upHint, w, h, tilt = 0.35, u0 = 0) {
  const f = norm(dir);
  const r = norm(cross(upHint, f));
  const u = cross(f, r);
  const halfW = mul(r, w * 0.5);
  const halfH = mul(u, h * 0.5 * (1 - tilt * 0.4));
  const fwd = mul(add(norm(add(u, mul(f, tilt))), mul(u, tilt)), h * 0.12);
  const p00 = add(add(c, mul(halfW, -1)), mul(halfH, -1));
  const p10 = add(add(c, halfW), mul(halfH, -1));
  const p11 = add(add(c, halfW), halfH);
  const p01 = add(add(c, mul(halfW, -1)), halfH);
  // normal points mostly outward (+dir) and up
  const n = norm(add(norm(add(f, mul(u, 0.55))), mul(u, 0.15)));
  const a = geo.vert(p00, n, u0 + 0.06, 0.06);
  const b = geo.vert(p10, n, u0 + 0.94, 0.06);
  const c2 = geo.vert(p11, n, u0 + 0.94, 0.94);
  const d = geo.vert(p01, n, u0 + 0.06, 0.94);
  geo.quad(a, b, c2, d);
  void fwd;
}

function bbox(geo) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geo.p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], geo.p[i + k]); hi[k] = Math.max(hi[k], geo.p[i + k]);
  }
  return {lo: lo.map((v) => +v.toFixed(2)), hi: hi.map((v) => +v.toFixed(2))};
}

/* ---------------------------------------------------------------- tree builders */
function conifer(seed) {
  const bark = new Geo(), leaves = new Geo();
  const H = 8.8 + seed * 0.1;
  const trunkSegs = 4;
  for (let i = 0; i < trunkSegs; i++) {
    const t0 = i / trunkSegs, t1 = (i + 1) / trunkSegs;
    frustum(bark, [0, H * 0.06 * t0, 0], [0, H * (0.06 + 0.5 * t1), 0],
      0.20 * (1 - t0 * 0.7), 0.20 * (1 - t1 * 0.7), 7, 2);
  }
  const branches = 26;
  for (let b = 0; b < branches; b++) {
    const t = 0.12 + (b / branches) * 0.78;
    const ang = b * 2.399 + seed;
    const dir = [Math.cos(ang), 0, Math.sin(ang)];
    const y = H * t;
    const outLen = (1.75 * (1 - t * 0.72) + 0.35) * (0.85 + rng() * 0.3);
    const tip = add([0, y, 0], add(mul(dir, outLen), [0, outLen * 0.35, 0]));
    frustum(bark, [0, y, 0], tip, 0.055 * (1 - t * 0.5) + 0.015, 0.012, 5, 1.5);
    const cardCount = 10 + Math.round(rng() * 5);
    for (let k = 0; k < cardCount; k++) {
      const u = 0.25 + (k / cardCount) * 0.85;
      const c = add([0, y, 0], mul(sub(tip, [0, y, 0]), u));
      const spread = (rng() - 0.5) * 1.2;
      const face = norm([dir[0] + Math.cos(spread) * 0.4, 0.25 + rng() * 0.4, dir[2] + Math.sin(spread) * 0.4]);
      card(leaves, add(c, [0, rng() * 0.2, 0]), face, [0, 1, 0],
        0.6 + rng() * 0.4, 0.7 + rng() * 0.4, 0.45, 0, rng() * Math.PI * 2);
    }
  }
  const layers = 10;
  for (let L = 0; L < layers; L++) {
    const t = L / (layers - 1);
    const y = H * (0.2 + 0.78 * t);
    const rad = 1.85 * (1 - t * 0.75) + 0.22;
    const count = 12 + Math.round(rng() * 5);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + L * 0.9 + rng() * 0.5;
      const dir = [Math.cos(ang), 0, Math.sin(ang)];
      const c = add([0, y, 0], mul(dir, rad * (0.45 + rng() * 0.55)));
      card(leaves, c, dir, [0, 1, 0], 0.6 + rng() * 0.4, 0.75 + rng() * 0.4, 0.5, 0, rng() * Math.PI * 2);
    }
  }
  return {bark, leaves, H};
}

function broadleaf(palette) {
  const bark = new Geo(), leaves = new Geo();
  const H = 8.4;
  for (let i = 0; i < 3; i++) {
    frustum(bark, [0, i * H * 0.14, 0], [0, H * (0.16 + i * 0.14), 0],
      0.26 - i * 0.05, 0.24 - i * 0.05, 7, 2);
  }
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    const dir = [Math.cos(ang), 0, Math.sin(ang)];
    const elbow = add([0, H * 0.44, 0], add(mul(dir, H * 0.16), [0, H * 0.14, 0]));
    frustum(bark, [0, H * 0.42, 0], elbow, 0.12, 0.06, 6, 1.5);
    for (let k = 0; k < 3; k++) {
      const dir2 = norm(add(dir, [Math.cos(k * 2.1) * 0.6, 0.55, Math.sin(k * 2.1) * 0.6]));
      const tip = add(elbow, mul(dir2, H * 0.16));
      frustum(bark, elbow, tip, 0.05, 0.02, 5, 1);
      for (let q = 0; q < 5; q++) {
        const u = 0.3 + q * 0.16;
        const c = add(elbow, mul(sub(tip, elbow), u));
        card(leaves, c, norm(add(dir2, [rng() - 0.5, rng() * 0.3, rng() - 0.5])), [0, 1, 0],
          1.0 + rng() * 0.5, 1.0 + rng() * 0.5, 0.45, 0, rng() * Math.PI * 2);
      }
    }
  }
  const crownY = H * 0.64;
  const R = 2.9;
  for (let i = 0; i < 26; i++) {
    const ang = rng() * Math.PI * 2, rr = rng();
    const dir = [Math.cos(ang), 0, Math.sin(ang)];
    const c = add([rng() * 1.2 - 0.6, crownY + (rng() - 0.5) * 2.0, rng() * 1.2 - 0.6], mul(dir, R * 0.35 * rr));
    card(leaves, c, dir, [0, 1, 0], 1.15 + rng() * 0.5, 1.1 + rng() * 0.5, 0.5, 0, rng() * Math.PI * 2);
  }
  for (let ring = 0; ring < 3; ring++) {
    const count = 34;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + ring * 0.6 + rng() * 0.3;
      const dir = [Math.cos(ang), 0, Math.sin(ang)];
      const y = crownY + (ring - 1) * 1.0 + (rng() - 0.5) * 0.5;
      const c = add([0, y, 0], mul(dir, R * (0.55 + ring * 0.16) * (0.8 + rng() * 0.4)));
      card(leaves, c, dir, [0, 1, 0], 1.25 + rng() * 0.6, 1.2 + rng() * 0.55, 0.45, 0, rng() * Math.PI * 2);
    }
  }
  void palette;
  return {bark, leaves, H};
}
function deadTree() {
  const bark = new Geo();
  const H = 7.5;
  frustum(bark, [0, 0, 0], [0, H * 0.45, 0], 0.24, 0.12, 7, 3);
  const branches = (start, dir, length, radius, depth) => {
    if (depth <= 0 || length < 0.35) return;
    const end = add(start, mul(norm(dir), length));
    frustum(bark, start, end, radius, radius * 0.55, 5, 2);
    const kids = depth === 2 ? 3 : 2;
    for (let i = 0; i < kids; i++) {
      const twist = (i - (kids - 1) / 2) * 0.9 + rng() * 0.4;
      const nd = norm(add(mul(norm(dir), 0.9), [Math.cos(twist) * 0.7, 0.35, Math.sin(twist) * 0.7]));
      branches(end, nd, length * (0.62 + rng() * 0.12), radius * 0.55, depth - 1);
    }
  };
  // a few main gnarled limbs from the trunk top
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.2;
    const dir = [Math.cos(ang) * 0.8, 1.0, Math.sin(ang) * 0.8];
    branches([0, H * (0.42 + (i % 2) * 0.05), 0], dir, 2.0 + rng() * 0.6, 0.13, 3);
  }
  return {bark, leaves: null, H};
}

function standingStone() {
  const geo = new Geo();
  const sides = 7;
  const H = 3.2;
  const levels = [[0.0, 0.62], [0.32, 0.52], [0.66, 0.44], [0.93, 0.30], [1.0, 0.16]];
  const tilt = 0.10;
  const centre = (t) => [tilt * t * 0.9 + Math.sin(t * 2.1) * 0.06, t * H, 0];
  const rings = levels.map(([t, r]) => {
    const c = centre(t);
    const row = [];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const jitter = 1 + Math.sin(ang * 3 + t * 5) * 0.12;
      const dir = [Math.cos(ang), 0, Math.sin(ang)];
      const p = add(c, mul(dir, r * jitter * 2.4));
      row.push(geo.vert(p, norm([dir[0], 0.25, dir[2]]), (s / sides), t));
    }
    return row;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      geo.quad(rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]);
    }
  }
  // top cap
  const top = geo.vert(add(centre(1), [0, 0.05, 0]), [0, 1, 0], 0.5, 1);
  for (let s = 0; s < sides; s++) geo.tri(rings[rings.length - 1][s], rings[rings.length - 1][(s + 1) % sides], top);
  return geo;
}

function iceShard() {
  const geo = new Geo();
  const shards = [
    {p: [0, 0, 0], h: 1.9, r: 0.26, tilt: 0.05},
    {p: [0.42, 0, 0.18], h: 1.25, r: 0.17, tilt: 0.22},
    {p: [-0.38, 0, 0.24], h: 1.05, r: 0.15, tilt: -0.18},
    {p: [0.12, 0, -0.42], h: 0.9, r: 0.13, tilt: 0.3},
    {p: [-0.22, 0, -0.3], h: 0.72, r: 0.11, tilt: -0.28},
    {p: [0.52, 0, -0.12], h: 0.6, r: 0.10, tilt: 0.4},
  ];
  for (const s of shards) {
    const sides = 6;
    const base = [s.p[0], 0, s.p[2]];
    const axis = norm([s.tilt, 1, s.tilt * 0.5]);
    const helper = [0, 0, 1];
    const xA = norm(cross(helper, axis));
    const yA = cross(axis, xA);
    const ringAt = (t, rad) => {
      const c = add(base, mul(axis, s.h * t));
      const row = [];
      for (let i = 0; i < sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const dir = add(mul(xA, Math.cos(ang)), mul(yA, Math.sin(ang)));
        row.push(geo.vert(add(c, mul(dir, rad * (1 + 0.08 * Math.sin(ang * 3)))), norm(add(dir, mul(axis, 0.2))), i / sides, t));
      }
      return row;
    };
    const r0 = ringAt(0, s.r), r1 = ringAt(0.62, s.r * 0.85);
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides;
      geo.quad(r0[i], r0[i2], r1[i2], r1[i]);
    }
    const tip = geo.vert(add(add(base, mul(axis, s.h)), [0.03, 0, 0]), axis, 0.5, 1);
    for (let i = 0; i < sides; i++) geo.tri(r1[i], r1[(i + 1) % sides], tip);
  }
  return geo;
}

/* ---------------------------------------------------------------- GLB writer */
async function textures() {
  const bark = await sharp(path.join(TEX, 'bark.png')).resize(256, 256).jpeg({quality: 82, mozjpeg: true}).toBuffer();
  const leaf = {};
  for (const k of ['pine', 'snow_pine', 'oak', 'maple']) {
    // needles are thin: a smaller alpha atlas keeps the gz budget (the snow atlas is the noisiest,
    // so it gets 160 px; broadleaf clusters keep 256 px)
    const dim = k === 'snow_pine' ? 160 : k === 'pine' ? 192 : 256;
    leaf[k] = await sharp(path.join(TEX, `leaf_${k}.png`)).resize(dim, dim).png({compressionLevel: 9}).toBuffer();
  }
  const stone = await sharp(path.join(TEX, 'stone.png')).resize(256, 256).jpeg({quality: 82, mozjpeg: true}).toBuffer();
  const ice = await sharp(path.join(TEX, 'ice.png')).resize(128, 128).jpeg({quality: 82, mozjpeg: true}).toBuffer();
  return {bark, leaf, stone, ice};
}

async function writeTree(name, geoBark, geoLeaf, leafKey, tex, extra = {}) {
  const doc = new Document();
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const matBark = doc.createMaterial('bark').setBaseColorTexture(
    doc.createTexture('bark_tex').setImage(new Uint8Array(tex.bark)).setMimeType('image/jpeg'));
  matBark.setRoughnessFactor(0.92).setMetallicFactor(0).setDoubleSided(true);
  // leaf material + atlas only exist when the asset actually has foliage (dead_tree / stones are
  // bark-only: 1 primitive, 1 material, no unused alpha texture)
  const hasLeaf = !!(geoLeaf && geoLeaf.tris);
  let matLeaf = null;
  if (hasLeaf) {
    matLeaf = doc.createMaterial(`${leafKey}_leaves`).setBaseColorTexture(
      doc.createTexture(`${leafKey}_tex`).setImage(new Uint8Array(tex.leaf[leafKey])).setMimeType('image/png'));
    matLeaf.setRoughnessFactor(0.95).setMetallicFactor(0).setDoubleSided(true)
      .setAlphaMode('MASK').setAlphaCutoff(0.42);
  }
  const mesh = doc.createMesh(name);
  const addPrim = (geo, mat) => {
    const prim = doc.createPrimitive();
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.p)).setBuffer(buffer));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.n)).setBuffer(buffer));
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(geo.uv)).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(geo.idx)).setBuffer(buffer));
    prim.setMaterial(mat);
    mesh.addPrimitive(prim);
    return prim;
  };
  addPrim(geoBark, matBark);
  if (hasLeaf) addPrim(geoLeaf, matLeaf);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene(name).addChild(node);
  const bytes = await new NodeIO().writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);
  const all = hasLeaf ? {p: [...geoBark.p, ...geoLeaf.p]} : geoBark;
  const b = bbox(all);
  const tris = geoBark.tris + (hasLeaf ? geoLeaf.tris : 0);
  const prims = hasLeaf ? 2 : 1;
  const mats = root.listMaterials().length;
  const fits = tris <= (extra.triBudget ?? 4000) && gz.length <= 150 * 1024;
  console.log(`${name.padEnd(14)} tris ${String(tris).padStart(5)} prims ${prims} mats ${mats} ` +
    `${(gz.length / 1024).toFixed(1).padStart(6)} KB  bbox ${JSON.stringify(b)} fits=${fits}`);
  return {name, tris, prims, mats, bytes: gz.length, bbox: b, fits};
}

async function main() {
  const tex = await textures();
  const rows = [];
  const pine = conifer(0), snow = conifer(1), oak = broadleaf('oak'), maple = broadleaf('maple');
  rows.push(await writeTree('pine_v2', pine.bark, pine.leaves, 'pine', tex, {triBudget: 4000}));
  rows.push(await writeTree('snow_pine', snow.bark, snow.leaves, 'snow_pine', tex, {triBudget: 4000}));
  rows.push(await writeTree('oak_v2', oak.bark, oak.leaves, 'oak', tex, {triBudget: 4000}));
  rows.push(await writeTree('maple', maple.bark, maple.leaves, 'maple', tex, {triBudget: 4000}));
  rows.push(await writeTree('dead_tree', deadTree().bark, null, 'pine', tex, {triBudget: 2000}));
  // stone + ice props use the bark slot as their opaque texture
  const stone = standingStone();
  rows.push(await writeTree('standing_stone', stone, null, 'pine', {...tex, bark: tex.stone}, {triBudget: 800}));
  const ice = iceShard();
  for (let i = 1; i < ice.p.length; i += 3) ice.p[i] += 0.05; // sit exactly on the ground plane
  rows.push(await writeTree('ice_shard', ice, null, 'pine', {...tex, bark: tex.ice}, {triBudget: 400}));
  fs.writeFileSync(path.join(STAGE, 'manifest-foliage.json'), JSON.stringify(rows, null, 1));
  const bad = rows.filter((r) => !r.fits);
  if (bad.length) console.error('BUDGET MISSES:', bad.map((b) => `${b.name} tris=${b.tris} size=${(b.bytes / 1024).toFixed(0)}KB`));
}

main().catch((e) => { console.error(e); process.exit(1); });
