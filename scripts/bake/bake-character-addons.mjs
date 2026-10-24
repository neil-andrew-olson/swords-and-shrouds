#!/usr/bin/env node
// Cycle-2 Phase B: distinct silhouettes as skinned add-ons attached to the EXISTING single skin.
//
// Each body gets ONE additional primitive on the existing skinned mesh. The add-on geometry is
// authored directly in the mesh's bind space (same space as the body POSITION attribute) around the
// centroid of body vertices that are already rigidly weighted to the target Mixamo bone, and every
// add-on vertex is weighted 100 % to that same joint. Result: it lands on the body region in every
// clip, follows the skeleton, and the asset keeps one skin, one mesh node, the six required clips and
// the hand sockets (all untouched). It gets its own small steel/cloth map set so it reads as a real
// armour piece instead of flat colour.
//
//   hero/templar/ally/berserker : steel pauldrons on both upper arms
//   ranger/survivor             : hood + shoulder cape
//   fallen                      : helmet crest fins + corrupted horns
//
//   node scripts/bake/bake-character-addons.mjs [--only hero]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {KHRMeshQuantization} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const LIVE = path.join(GAME, 'public/assets/custom');
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_addons';
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/atlas2';
const BUDGET = 700 * 1024;
const io = new NodeIO();
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});
fs.mkdirSync(WORK, {recursive: true});

const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');
const gzip9 = (b) => zlib.gzipSync(b, {level: 9});

const KINDS = {
  hero: {kind: 'pauldrons', metal: [0.55, 0.56, 0.58], cloth: [0.30, 0.33, 0.40]},
  templar: {kind: 'pauldrons', metal: [0.60, 0.61, 0.63], cloth: [0.74, 0.71, 0.64]},
  ally: {kind: 'pauldrons', metal: [0.40, 0.49, 0.62], cloth: [0.16, 0.20, 0.28]},
  berserker: {kind: 'pauldrons', metal: [0.45, 0.13, 0.13], cloth: [0.18, 0.12, 0.10]},
  ranger: {kind: 'hooded', metal: [0.22, 0.31, 0.18], cloth: [0.19, 0.26, 0.16]},
  survivor: {kind: 'hooded', metal: [0.44, 0.42, 0.38], cloth: [0.42, 0.36, 0.26]},
  fallen: {kind: 'horned', metal: [0.26, 0.18, 0.35], cloth: [0.10, 0.08, 0.14]},
};

/* ---------------------------------------------------------------- vector helpers */
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(o) {
    const off = this.p.length / 3;
    this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv);
    for (const i of o.idx) this.idx.push(i + off);
  }
  get tris() { return this.idx.length / 3; }
}

/** Dome shell around an outward axis (pauldron / hood). */
function capShell(centre, radius, axis, openDeg, rings, segs, elongate = 1) {
  const g = new Geo();
  const zA = norm(axis);
  const helper = Math.abs(zA[1]) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const xA = norm(cross(helper, zA));
  const yA = cross(zA, xA);
  const open = (openDeg * Math.PI) / 180;
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const ang = open * (r / rings);
    const row = [];
    for (let s = 0; s < segs; s++) {
      const phi = (s / segs) * Math.PI * 2;
      const dl = v3(Math.sin(ang) * Math.cos(phi) * elongate, Math.cos(ang), Math.sin(ang) * Math.sin(phi));
      const dir = norm(add(add(mul(xA, dl[0]), mul(zA, dl[1])), mul(yA, dl[2])));
      row.push(g.vert(add(centre, mul(dir, radius)), dir, 0.08 + (s / segs) * 0.84, 0.08 + (1 - r / rings) * 0.84));
    }
    rows.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      g.quad(rows[r][s], rows[r][s2], rows[r + 1][s2], rows[r + 1][s]);
    }
  }
  return g;
}

/** Hanging curved sheet (cape). */
function curvedSheet(topCentre, width, height, rightDir, downDir, backDir, cols, rows, bow) {
  const g = new Geo();
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const row = [];
    for (let c = 0; c <= cols; c++) {
      const u = c / cols - 0.5;
      const flare = 1 + t * 0.3;
      const p = add(add(topCentre, mul(rightDir, u * width * flare)), mul(downDir, -height * t));
      const p2 = add(p, mul(backDir, Math.sin(t * Math.PI) * bow + t * t * 0.6));
      row.push(g.vert(p2, norm(add(backDir, mul(downDir, -0.12 * t))), c / cols, 1 - t));
    }
    grid.push(row);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) g.quad(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]);
  }
  return g;
}

/** Bent tapered horn. */
function horn(base, dir, bendDir, length, radius, segs = 10, rings = 4) {
  const g = new Geo();
  const d = norm(dir);
  const b = norm(sub(bendDir, mul(d, dot(bendDir, d))));
  const side = norm(cross(d, b));
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const c = add(add(base, mul(d, length * t)), mul(b, length * 0.32 * t * t));
    const rad = radius * (1 - 0.9 * t);
    const row = [];
    for (let s = 0; s < segs; s++) {
      const phi = (s / segs) * Math.PI * 2;
      const radial = norm(add(mul(side, Math.cos(phi)), mul(b, Math.sin(phi))));
      row.push(g.vert(add(c, mul(radial, rad)), radial, (s / segs) * 0.9 + 0.05, t * 0.9 + 0.05));
    }
    rows.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      g.quad(rows[r][s], rows[r][s2], rows[r + 1][s2], rows[r + 1][s]);
    }
  }
  const tip = g.vert(add(add(base, mul(d, length)), mul(b, length * 0.32)), d, 0.5, 0.97);
  for (let s = 0; s < segs; s++) g.tri(rows[rings][s], rows[rings][(s + 1) % segs], tip);
  return g;
}

/** Thin sagittal crest fin (both faces + rim). */
function crestFin(base, up, forward, length, height, thickness) {
  const g = new Geo();
  const side = norm(cross(up, forward));
  const A = add(base, mul(forward, -length * 0.5));
  const B = add(base, mul(forward, length * 0.5));
  const T = add(add(base, mul(up, height)), mul(forward, -length * 0.12));
  const hs = thickness * 0.5;
  for (const sgn of [1, -1]) {
    const o = mul(side, hs * sgn);
    const n = mul(side, sgn);
    const vA = g.vert(add(A, o), n, 0.15, 0.08);
    const vB = g.vert(add(B, o), n, 0.85, 0.08);
    const vT = g.vert(add(T, o), n, 0.5, 0.94);
    g.tri(vA, vB, vT);
  }
  const rim = [[A, T], [T, B], [A, B]];
  for (const [p0, p1] of rim) {
    const nrm = norm(cross(sub(p1, p0), side));
    const v0 = g.vert(add(p0, mul(side, hs)), nrm, 0.1, 0.5);
    const v1 = g.vert(add(p1, mul(side, hs)), nrm, 0.9, 0.5);
    const v2 = g.vert(add(p1, mul(side, -hs)), mul(nrm, -1), 0.9, 0.5);
    const v3 = g.vert(add(p0, mul(side, -hs)), mul(nrm, -1), 0.1, 0.5);
    g.quad(v0, v1, v2, v3);
  }
  return g;
}

/* ---------------------------------------------------------------- accessors */
function decodeAccessor(acc) {
  const arr = acc.getArray();
  const ncomp = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[acc.getType()];
  if (!acc.getNormalized()) return {data: arr, ncomp, scale: 1, count: arr.length / ncomp};
  const ct = acc.getComponentType();
  const scale = ct === 5120 ? 1 / 127 : ct === 5121 ? 1 / 255 : ct === 5122 ? 1 / 32767 : ct === 5123 ? 1 / 65535 : 1;
  return {data: arr, ncomp, scale, count: arr.length / ncomp};
}
const val = (d, i, c) => d.data[i * d.ncomp + c] * d.scale;

function jointRegion(pos, nor, joints, weights, jointIndex) {
  let count = 0;
  const c = [0, 0, 0];
  const n = [0, 0, 0];
  const pts = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (Math.round(val(joints, i, k)) === jointIndex) w += val(weights, i, k);
    if (w < 0.5) continue;
    const p = [val(pos, i, 0), val(pos, i, 1), val(pos, i, 2)];
    pts.push(p);
    c[0] += p[0]; c[1] += p[1]; c[2] += p[2];
    n[0] += val(nor, i, 0); n[1] += val(nor, i, 1); n[2] += val(nor, i, 2);
    count++;
  }
  if (!count) return null;
  c[0] /= count; c[1] /= count; c[2] /= count;
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, len(sub(p, c)));
  return {centre: c, normal: norm(n), radius, count};
}

/* ---------------------------------------------------------------- add-on maps (128²) */
function smoothNoise(w, h, seed) {
  // cheap value noise: random lattice + bilinear + two octaves
  const rnd = (x, y) => {
    let v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const out = new Float32Array(w * h);
  const octaves = [[6, 1.0], [14, 0.5]];
  for (const [cells, amp] of octaves) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cells, fy = (y / h) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const s = (t) => t * t * (3 - 2 * t);
        const a = rnd(x0, y0), b = rnd(x0 + 1, y0), c = rnd(x0, y0 + 1), d = rnd(x0 + 1, y0 + 1);
        out[y * w + x] += amp * ((a * (1 - s(tx)) + b * s(tx)) * (1 - s(ty)) + (c * (1 - s(tx)) + d * s(tx)) * s(ty));
      }
    }
  }
  return out;
}

async function makeAddonMaps(name, cfg, kind) {
  const W = 128;
  const isMetal = kind !== 'hooded';
  const base = isMetal ? cfg.metal : cfg.cloth;
  const noise = smoothNoise(W, W, name.length * 7 + 3);
  const albedo = Buffer.alloc(W * W * 3);
  const height = new Float32Array(W * W);
  // plate seams (horizontal bands) + rivets for metal; soft weave for cloth
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nz = noise[i];
      let h = nz * 0.35;
      let seam = 0;
      if (isMetal) {
        const band = Math.abs(((y / W) * 3) % 1 - 0.5);
        seam = band > 0.46 ? 1 : 0;
        const rx = Math.abs(((x / W) * 4) % 1 - 0.5);
        const ry = Math.abs(((y / W) * 3) % 1 - 0.5);
        if (rx > 0.44 && ry > 0.42) h += 0.5; // rivet bumps
        h -= seam * 0.8;
      } else {
        h += Math.sin(x * 0.9) * Math.cos(y * 0.7) * 0.08;
        const band = Math.abs(((y / W) * 6) % 1 - 0.5);
        seam = band > 0.47 ? 0.5 : 0;
        h -= seam * 0.3;
      }
      height[i] = h;
      const k = 0.98 + nz * 0.30 - seam * 0.45;
      albedo[i * 3] = Math.max(0, Math.min(255, Math.round(base[0] * 255 * k)));
      albedo[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(base[1] * 255 * k)));
      albedo[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(base[2] * 255 * k)));
    }
  }
  // normal from height (tangent space, +Y up in UV space)
  const normal = Buffer.alloc(W * W * 3);
  const S = 3.0;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hx = height[y * W + Math.min(W - 1, x + 1)] - height[y * W + Math.max(0, x - 1)];
      const hy = height[Math.min(W - 1, y + 1) * W + x] - height[Math.max(0, y - 1) * W + x];
      let nx = -hx * S, ny = hy * S, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      normal[i * 3] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  const orm = Buffer.alloc(W * W * 3);
  for (let i = 0; i < W * W; i++) {
    orm[i * 3] = 235;                              // AO (nearly open)
    orm[i * 3 + 1] = isMetal ? 165 : 215;          // roughness
    orm[i * 3 + 2] = isMetal ? 45 : 6;            // metalness
  }
  const meta = {width: W, height: W, channels: 3};
  const [albedoJpeg, normalJpeg, ormJpeg] = await Promise.all([
    sharp(albedo, {raw: meta}).jpeg({quality: 86, mozjpeg: true}).toBuffer(),
    sharp(normal, {raw: meta}).jpeg({quality: 88, mozjpeg: true}).toBuffer(),
    sharp(orm, {raw: meta}).jpeg({quality: 86, mozjpeg: true}).toBuffer(),
  ]);
  return {albedoJpeg, normalJpeg, ormJpeg};
}

/* ---------------------------------------------------------------- bind-space joint pivots */
/** Exact joint origin in mesh bind space: inverseBindMatrix maps bind -> joint local, so the joint
 *  origin (0,0,0 in joint space) is invBind^{-1} * 0. The matrices carry the rig's uniform scale,
 *  so solve the 3x3 system properly instead of assuming an orthonormal rotation. */
function jointBindPositions(skin) {
  const out = new Map();
  const mats = skin.getInverseBindMatrices();
  if (!mats) return out;
  const arr = mats.getArray();
  const joints = skin.listJoints();
  for (let j = 0; j < joints.length; j++) {
    const o = j * 16;
    // column-major: c0 = [0,1,2], c1 = [4,5,6], c2 = [8,9,10], t = [12,13,14]
    const a = [arr[o], arr[o + 1], arr[o + 2]];
    const b = [arr[o + 4], arr[o + 5], arr[o + 6]];
    const c = [arr[o + 8], arr[o + 9], arr[o + 10]];
    const t = [arr[o + 12], arr[o + 13], arr[o + 14]];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    if (Math.abs(det) < 1e-12) { out.set(joints[j].getName() || '', [0, 0, 0]); continue; }
    const rhs = [-t[0], -t[1], -t[2]];
    // Cramer's rule: x = det(M_i)/det
    const inv = (x) => [x[0] / det, x[1] / det, x[2] / det];
    const m0 = [[rhs[0], b[0], c[0]], [rhs[1], b[1], c[1]], [rhs[2], b[2], c[2]]];
    const m1 = [[a[0], rhs[0], c[0]], [a[1], rhs[1], c[1]], [a[2], rhs[2], c[2]]];
    const m2 = [[a[0], b[0], rhs[0]], [a[1], b[1], rhs[1]], [a[2], b[2], rhs[2]]];
    const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    out.set(joints[j].getName() || '', [det3(m0) / det, det3(m1) / det, det3(m2) / det]);
  }
  return out;
}

/* ---------------------------------------------------------------- build one body */
async function processCharacter(name) {
  const cfg = KINDS[name];
  console.log(`\n== ${name} (${cfg.kind})`);
  const liveGz = fs.readFileSync(path.join(LIVE, name + '.glb.gz'));
  // always build on top of the Phase-A (map) asset, never on an already-add-on'd live file
  const baseGz = path.join('C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_atlas2/custom', name + '.glb.gz');
  const srcGlb = path.join(WORK, name + '_addons_src.glb');
  fs.writeFileSync(srcGlb, zlib.gunzipSync(fs.existsSync(baseGz) ? fs.readFileSync(baseGz) : liveGz));
  const doc = await io.read(srcGlb);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const bodyPrim = mesh.listPrimitives()[0];
  const skin = root.listSkins()[0];
  const jointNames = skin.listJoints().map((j) => j.getName() || '');
  const jointIndex = (suffix) => jointNames.findIndex((n) => n.endsWith(suffix));

  const pos = decodeAccessor(bodyPrim.getAttribute('POSITION'));
  const nor = decodeAccessor(bodyPrim.getAttribute('NORMAL'));
  const joints = decodeAccessor(bodyPrim.getAttribute('JOINTS_0'));
  const weights = decodeAccessor(bodyPrim.getAttribute('WEIGHTS_0'));
  const bodyIndexHash = sha(Buffer.from(bodyPrim.getIndices().getArray().buffer));
  const bodyPosHash = sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer));
  const animHash = (r) => r.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)])))).join('|');
  const animBefore = animHash(root);

  const bind = jointBindPositions(skin);
  const pivot = (suffix) => {
    const key = jointNames.find((n) => n.endsWith(suffix));
    return (key && bind.get(key)) || [0, 0, 0];
  };
  // bind-space body axes: up from hips->head, forward = +Z projected perpendicular to up
  const hipsP = pivot('Hips'), headP = pivot('Head');
  const up = norm(sub(headP, hipsP));
  const forward = norm(sub(v3(0, 0, 1), mul(up, dot(up, v3(0, 0, 1)))));
  const sideDir = norm(cross(forward, up));
  const spine2P = pivot('Spine2');
  const neckP = pivot('Neck');
  const headCentre = neckP ? add(headP, mul(up, len(sub(headP, neckP)) * 0.35)) : headP;

  const merged = new Geo();
  const pieces = [];
  const push = (geo, bone) => { pieces.push({geo, bone}); merged.merge(geo); };

  if (cfg.kind === 'pauldrons') {
    for (const side of ['LeftArm', 'RightArm']) {
      if (jointIndex(side) < 0) throw new Error(`${name}: missing joint ${side}`);
      const shoulderName = side === 'LeftArm' ? 'LeftShoulder' : 'RightShoulder';
      const shoulder = pivot(shoulderName);
      const arm = pivot(side);
      const outward = norm(sub(shoulder, spine2P));
      const armDir = norm(sub(arm, shoulder));
      const rad = cfg.kind === 'pauldrons' ? 1.55 : 1.25;
      const domeAxis = norm(add(mul(outward, 0.86), mul(up, 0.34)));
      const capCentre = add(add(shoulder, mul(domeAxis, rad * 0.12)), mul(armDir, rad * 0.25));
      push(capShell(capCentre, rad, domeAxis, 108, 5, 14, 1.18), shoulderName);
      // small top ridge plate for a layered silhouette
      push(capShell(add(capCentre, mul(domeAxis, rad * 0.35)), rad * 0.62, domeAxis, 80, 3, 12, 1.1), shoulderName);
    }
  } else if (cfg.kind === 'hooded') {
    const rad = 1.32;
    // hood sits on the crown and covers top + back of the head, open toward the face
    push(capShell(add(add(headCentre, mul(up, rad * 0.22)), mul(forward, -0.10)), rad, up, 116, 5, 16, 1.04), 'Head');
    // hood back drape down to the shoulder line
    const drape = curvedSheet(add(add(headCentre, mul(up, -rad * 0.45)), mul(forward, -0.95)),
      2.6, 2.8, sideDir, up, mul(forward, -1), 6, 5, 0.3);
    push(drape, 'Head');
    // cape from the shoulder line, hanging behind the body
    const shoulderSpan = Math.max(4.6, len(sub(pivot('LeftShoulder'), pivot('RightShoulder'))) * 2.1);
    const capeTop = add(add(spine2P, mul(up, 0.9)), mul(forward, -1.15));
    push(curvedSheet(capeTop, shoulderSpan, 9.2, sideDir, up, mul(forward, -1), 9, 9, 1.15), 'Spine2');
  } else {
    const rad = 1.45;
    const top = add(headCentre, mul(up, rad * 0.45));
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 0.45;
      push(crestFin(add(add(top, mul(up, -Math.abs(off) * 0.2)), mul(forward, off)),
        up, forward, 1.35, 2.1 - Math.abs(off) * 0.4, 0.12), 'Head');
    }
    for (const sign of [1, -1]) {
      const base = add(add(headCentre, mul(up, rad * 0.18)), mul(sideDir, rad * 0.72 * sign));
      push(horn(base, norm(add(mul(up, 0.86), mul(sideDir, 0.62 * sign))), mul(forward, -0.25),
        rad * 1.35, rad * 0.32, 10, 4), 'Head');
    }
  }

  // rigid joints per vertex (in merge order)
  const vCount = merged.p.length / 3;
  const jointPerVert = new Uint16Array(vCount);
  let vOff = 0;
  for (const piece of pieces) {
    const n = piece.geo.p.length / 3;
    const ji = jointIndex(piece.bone);
    if (ji < 0) throw new Error(`${name}: missing joint ${piece.bone}`);
    for (let i = 0; i < n; i++) jointPerVert[vOff + i] = ji;
    vOff += n;
  }

  // add-on maps + material
  const {albedoJpeg, normalJpeg, ormJpeg} = await makeAddonMaps(name, cfg, cfg.kind);
  const mapTex = (bytes, n) => doc.createTexture(n).setImage(new Uint8Array(bytes)).setMimeType('image/jpeg');
  const addMat = doc.createMaterial(name + '_addon')
    .setBaseColorTexture(mapTex(albedoJpeg, name + '_addon_albedo'))
    .setNormalTexture(mapTex(normalJpeg, name + '_addon_normal')).setNormalScale(1.0)
    .setMetallicRoughnessTexture(mapTex(ormJpeg, name + '_addon_orm'))
    .setOcclusionTexture(root.listMaterials()[0].getOcclusionTexture() || null);
  addMat.setMetallicFactor(1.0).setRoughnessFactor(1.0).setDoubleSided(true);
  // occlusion must come from the add-on ORM map (same R channel convention)
  addMat.setOcclusionTexture(addMat.getMetallicRoughnessTexture()).setOcclusionStrength(1.0);

  // new primitive on the same skinned mesh
  const buffer = root.listBuffers()[0];
  const addPrim = doc.createPrimitive();
  const positions = new Float32Array(merged.p);
  const normals = new Int8Array(merged.n.map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))));
  const uvs = new Uint16Array(merged.uv.map((v) => Math.max(0, Math.min(65535, Math.round(v * 65535)))));
  const indices = new Uint16Array(merged.idx);
  const jointsArr = new Uint16Array(vCount * 4);
  const weightsArr = new Uint8Array(vCount * 4);
  for (let i = 0; i < vCount; i++) {
    jointsArr[i * 4] = jointPerVert[i]; jointsArr[i * 4 + 1] = jointPerVert[i];
    jointsArr[i * 4 + 2] = jointPerVert[i]; jointsArr[i * 4 + 3] = jointPerVert[i];
    weightsArr[i * 4] = 255;
  }
  addPrim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer));
  addPrim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setNormalized(true).setBuffer(buffer));
  addPrim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setNormalized(true).setBuffer(buffer));
  addPrim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointsArr).setBuffer(buffer));
  addPrim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weightsArr).setNormalized(true).setBuffer(buffer));
  addPrim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  addPrim.setMaterial(addMat);
  mesh.addPrimitive(addPrim);
  doc.createExtension(KHRMeshQuantization).setRequired(true);

  // verification: body untouched, single skin, clips + sockets intact
  const same = bodyIndexHash === sha(Buffer.from(bodyPrim.getIndices().getArray().buffer)) &&
    bodyPosHash === sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer)) &&
    animBefore === animHash(root) && root.listSkins().length === 1;

  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);
  const prims = mesh.listPrimitives().length;
  const totalTris = mesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  const clips = root.listAnimations().map((a) => a.getName());
  const sockets = ['mixamorigLeftHand', 'mixamorigRightHand'].every((s) =>
    root.listNodes().some((n) => (n.getName() || '').replace(/:/g, '').endsWith(s.replace('mixamorig', ''))));
  console.log(`   ${cfg.kind}: +${merged.tris} tris / ${vCount} verts (${pieces.map((p) => p.bone).join('+')}) | ` +
    `prims ${prims}, total tris ${totalTris}, clips ${clips.length}, sockets ${sockets}, ` +
    `${(gz.length / 1024).toFixed(1)} KB, body/anim unchanged=${same}`);
  return {name, kind: cfg.kind, gz: gz.length, addTris: merged.tris, totalTris, verts: vCount, prims, same, sockets};
}

const rows = [];
for (const name of Object.keys(KINDS)) {
  if (only && !only.includes(name)) continue;
  rows.push(await processCharacter(name));
}
fs.writeFileSync(path.join(STAGE, 'manifest-addons.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${(r.gz / 1024).toFixed(1)}KB +${r.addTris}tri`).join(', '));
