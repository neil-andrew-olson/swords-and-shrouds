#!/usr/bin/env node
// Cycle-7 Phase A: undead variants that REUSE the existing enemy rigs/clips and add distinct
// silhouettes as extra skinned primitives (base assets untouched; variants are additional files).
//
//   zombie-bloated      : zombie 30-joint rig + 10 clips; plague-bloated belly, back hump, tumours
//                         rigid-weighted to the existing spine/shoulder/arm joints (+1 prim)
//   skeleton-armoured   : skeleton-soldier 51-joint rig + 9 clips; iron helm, pauldrons and a kite
//                         shield rigid-weighted to Head/Clavicle/UpperArm/Forearm (+1 prim)
//
//   node scripts/bake/bake-enemy-variants.mjs [--only zombie] [--force]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const LIVE = path.join(GAME, 'public/assets/custom');
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/enemy_variants';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_enemies';
const io = new NodeIO();
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');
const gzip9 = (b) => zlib.gzipSync(b, {level: 9});

/* ---------------------------------------------------------------- vector/geometry helpers */
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
  vert(p, n, u, v) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(o) {
    const off = this.p.length / 3;
    this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv);
    for (const i of o.idx) this.idx.push(i + off);
  }
  get tris() { return this.idx.length / 3; }
}
function basisFrom(axis) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(helper, a));
  return {axis: a, x, y: cross(a, x)};
}
/** ellipsoid with explicit radii: rx (side), ry (vertical), rz (forward) */
function ellipsoid(geo, centre, up, rx, ry, rz, segs = 12, rings = 6) {
  const basis = basisFrom(up);
  const rows = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const ang = t * Math.PI;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const row = [];
    for (let s = 0; s < segs; s++) {
      const phi = (s / segs) * Math.PI * 2;
      const cx = Math.cos(phi) * sinA, cy = Math.sin(phi) * sinA;
      const p = add(centre, add(mul(basis.x, cx * rx), add(mul(basis.y, cy * rz), mul(up, cosA * ry))));
      const nrm = norm(add(mul(basis.x, cx / Math.max(rx, 1e-4)), add(mul(basis.y, cy / Math.max(rz, 1e-4)), mul(up, cosA / Math.max(ry, 1e-4)))));
      row.push(geo.vert(p, nrm, 0.04 + (s / segs) * 0.92, 0.04 + t * 0.92));
    }
    rows.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      if (r === 0) geo.tri(rows[0][0], rows[1][s2], rows[1][s]);
      else if (r === rings - 1) geo.tri(rows[r][s], rows[r][s2], rows[rings][0]);
      else geo.quad(rows[r][s], rows[r][s2], rows[r + 1][s2], rows[r + 1][s]);
    }
  }
}function frustum(geo, a, b, r0, r1, sides = 8) {
  const axis = norm(sub(b, a));
  const basis = basisFrom(axis);
  const ring = (c, r) => {
    const row = [];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const dir = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
      row.push(geo.vert(add(c, mul(dir, r)), dir, s / sides, 0));
    }
    return row;
  };
  const r0row = ring(a, r0), r1row = ring(b, r1);
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    geo.quad(r0row[s], r0row[s2], r1row[s2], r1row[s]);
  }
}
function dome(geo, centre, up, radius, height, segs = 12, rows = 4) {
  const basis = basisFrom(up);
  const rings = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const ang = t * Math.PI * 0.5;
    const row = [];
    for (let s = 0; s < segs; s++) {
      const phi = (s / segs) * Math.PI * 2;
      const dir = norm(add(mul(basis.x, Math.cos(phi)), mul(basis.y, Math.sin(phi))));
      const p = add(centre, add(mul(dir, Math.sin(ang) * radius), mul(up, Math.cos(ang) * height)));
      row.push(geo.vert(p, norm(add(dir, mul(up, 0.4))), s / segs, 1 - t));
    }
    rings.push(row);
  }
  for (let r = 0; r < rows; r++) for (let s = 0; s < segs; s++) {
    const s2 = (s + 1) % segs;
    geo.quad(rings[r][s], rings[r][s2], rings[r + 1][s2], rings[r + 1][s]);
  }
}
function box(geo, centre, right, upF, fwd, sx, sy, sz) {
  const hs = [sx / 2, sy / 2, sz / 2];
  const cs = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vs = cs.map(([x, y, z]) => geo.vert(
    add(centre, add(add(mul(right, x * hs[0]), mul(upF, y * hs[1])), mul(fwd, z * hs[2]))),
    norm(add(add(mul(right, x), mul(upF, y)), mul(fwd, z))), 0.5, 0.5));
  for (const q of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) {
    geo.quad(vs[q[0]], vs[q[1]], vs[q[2]], vs[q[3]]);
  }
}
function kiteShield(geo, centre, right, upF, fwd, w, h, depth) {
  const front = [
    [0, h * 0.62], [w * 0.5, h * 0.28], [w * 0.44, -h * 0.28], [0, -h * 0.62], [-w * 0.44, -h * 0.28], [-w * 0.5, h * 0.28],
  ];
  const ringF = front.map(([x, y], i) => geo.vert(
    add(centre, add(add(mul(right, x), mul(upF, y)), mul(fwd, depth * 0.5))), fwd, 0.06 + (i / 6) * 0.9, 0.06));
  const ringB = front.map(([x, y], i) => geo.vert(
    add(centre, add(add(mul(right, x * 0.92), mul(upF, y * 0.92)), mul(fwd, -depth * 0.5))), mul(fwd, -1), 0.06 + (i / 6) * 0.9, 0.94));
  for (let i = 1; i < front.length - 1; i++) geo.tri(ringF[0], ringF[i], ringF[i + 1]);
  for (let i = 0; i < front.length; i++) {
    const i2 = (i + 1) % front.length;
    geo.quad(ringF[i], ringF[i2], ringB[i2], ringB[i]);
  }
}
function bbox(geo) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < geo.p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], geo.p[i + k]); hi[k] = Math.max(hi[k], geo.p[i + k]);
  }
  return {lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]};
}

/* ---------------------------------------------------------------- accessors / pivots */
function decodeAccessor(acc) {
  const arr = acc.getArray();
  const n = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[acc.getType()];
  if (!acc.getNormalized()) return {data: Float64Array.from(arr), n, count: arr.length / n};
  const ct = acc.getComponentType();
  const max = ct === 5120 ? 127 : ct === 5121 ? 255 : ct === 5122 ? 32767 : 5123 ? 65535 : 1;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return {data: out, n, count: arr.length / n};
}
function jointPivots(skin) {
  const map = new Map();
  const arr = skin.getInverseBindMatrices().getArray();
  skin.listJoints().forEach((joint, j) => {
    const o = j * 16;
    const a = [arr[o], arr[o + 1], arr[o + 2]];
    const b = [arr[o + 4], arr[o + 5], arr[o + 6]];
    const c = [arr[o + 8], arr[o + 9], arr[o + 10]];
    const t = [arr[o + 12], arr[o + 13], arr[o + 14]];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    const solve = (m) => (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det;
    const rhs = [-t[0], -t[1], -t[2]];
    map.set(joint.getName() || '', [solve([[rhs[0], b[0], c[0]], [rhs[1], b[1], c[1]], [rhs[2], b[2], c[2]]]),
      solve([[a[0], rhs[0], c[0]], [a[1], rhs[1], c[1]], [a[2], rhs[2], c[2]]]),
      solve([[a[0], b[0], rhs[0]], [a[1], b[1], rhs[1]], [a[2], b[2], rhs[2]]])]);
  });
  return map;
}
function regionRadius(pos, joints, weights, jointIndex) {
  let n = 0, maxR = 0;
  const c = [0, 0, 0];
  const val = (d, i, k) => d.data[i * d.n + k] * 1;
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (Math.round(val(joints, i, k)) === jointIndex) w += val(weights, i, k);
    if (w < 0.5) continue;
    n++; for (let k = 0; k < 3; k++) c[k] += val(pos, i, k);
  }
  if (!n) return null;
  for (let k = 0; k < 3; k++) c[k] /= n;
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (Math.round(val(joints, i, k)) === jointIndex) w += val(weights, i, k);
    if (w < 0.5) continue;
    const dx = val(pos, i, 0) - c[0], dy = val(pos, i, 1) - c[1], dz = val(pos, i, 2) - c[2];
    maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
  }
  return {centre: c, radius: maxR, count: n};
}

/* ---------------------------------------------------------------- variant textures */
async function makeTexture(kind) {
  const W = 256;
  const buf = Buffer.alloc(W * W * 3);
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const n = hash(Math.floor(x / 4), Math.floor(y / 4));
      const n2 = hash(Math.floor(x / 16), Math.floor(y / 16));
      if (kind === 'plague') {
        // swollen plague skin, night-matched to the base zombie (body mean ~83/255): darker olive
        // green base with yellow-green pustules, finer mottle and dark veins
        const n3 = hash(Math.floor(x / 2), Math.floor(y / 2));
        const n4 = hash(Math.floor(x / 8), Math.floor(y / 8));
        const base = 0.175 + 0.07 * n + 0.05 * n3 + 0.05 * n4;
        let r = base * 0.92, g = base * 1.16, b = base * 0.66;
        if (n2 > 0.84) { r = 0.40; g = 0.44; b = 0.20; }           // pustule (night-toned)
        if (n > 0.94 || n3 > 0.97) { r *= 0.55; g *= 0.55; b *= 0.6; }  // dark speck / vein
        buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
        buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      } else {
        // aged iron + bone: grey-blue iron plates with bone-coloured rivets/straps
        const base = 0.34 + 0.12 * n;
        let r = base * 0.95, g = base * 0.98, b = base * 1.08;
        if (n2 < 0.14) { r = 0.62; g = 0.58; b = 0.46; }           // bone patch
        if (n > 0.94) { r *= 0.55; g *= 0.55; b *= 0.6; }          // pitting
        buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
        buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      }
    }
  }
  return sharp(buf, {raw: {width: W, height: W, channels: 3}}).jpeg({quality: 84, mozjpeg: true}).toBuffer();
}

/* ---------------------------------------------------------------- builders */
function buildZombieBloated(piv) {
  const pieces = [];
  const push = (geo, bone) => pieces.push({geo, bone});
  const up = piv.up, fwd = piv.forward, side = piv.side;
  const spine3 = piv.p('spine_03.x'), spine4 = piv.p('spine_04.x'), spine2 = piv.p('spine_02.x');
  const shoulderL = piv.p('shoulder.l'), shoulderR = piv.p('shoulder.r');
  const armL = piv.p('arm_stretch.l'), armR = piv.p('arm_stretch.r');
  const neck = piv.p('neck.x');
  // bind units are metres (zombie is 1.39 tall) so all radii below are in metres
  const gBelly = new Geo();
  ellipsoid(gBelly, add(add(spine3, mul(fwd, 0.10)), mul(up, -0.06)), up, 0.34, 0.38, 0.30, 14, 6);
  push(gBelly, 'spine_03.x');
  const gChest = new Geo();
  ellipsoid(gChest, add(add(spine2, mul(fwd, 0.08)), mul(up, 0.05)), up, 0.26, 0.24, 0.22, 12, 5);
  push(gChest, 'spine_02.x');
  const gHump = new Geo();
  ellipsoid(gHump, add(add(spine4, mul(fwd, -0.16)), mul(up, 0.08)), up, 0.22, 0.24, 0.18, 12, 5);
  push(gHump, 'spine_04.x');
  const lumps = [
    [shoulderL, 'shoulder.l', 0.11], [shoulderR, 'shoulder.r', 0.12],
    [armL, 'arm_stretch.l', 0.09], [armR, 'arm_stretch.r', 0.09],
    [add(neck, mul(up, 0.04)), 'neck.x', 0.08],
  ];
  for (const [c, bone, rad] of lumps) {
    const g = new Geo();
    ellipsoid(g, c, up, rad, rad * 0.85, rad * 0.9, 9, 3);
    push(g, bone);
  }
  for (const sgn of [1, -1]) {
    const g = new Geo();
    const c = add(add(add(spine3, mul(up, -0.45)), mul(fwd, 0.14)), mul(side, sgn * 0.10));
    ellipsoid(g, c, up, 0.14, 0.15, 0.12, 9, 4);
    push(g, 'spine_03.x');
  }
  return pieces;
}

function buildSkeletonArmoured(piv) {
  const pieces = [];
  const push = (geo, bone) => pieces.push({geo, bone});
  const up = piv.up, fwd = piv.forward;
  const head = piv.p('Bip01_Head1');
  const armL = piv.p('Bip01_L_UpperArm');
  const armR = piv.p('Bip01_R_UpperArm');
  const foreL = piv.p('Bip01_L_Forearm');
  const spine2 = piv.p('Bip01_Spine2');
  // skeleton is 1.85 tall in bind units (metres)
  const gHelm = new Geo();
  const hb = add(head, mul(up, -0.07));
  dome(gHelm, hb, up, 0.155, 0.21, 12, 4);
  const basis = basisFrom(up);
  const ring0 = [], ring1 = [];
  for (let s = 0; s < 12; s++) {
    const ang = (s / 12) * Math.PI * 2;
    const dir = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
    ring0.push(gHelm.vert(add(hb, mul(dir, 0.162)), dir, s / 12, 0));
    ring1.push(gHelm.vert(add(add(hb, mul(dir, 0.172)), mul(up, -0.035)), dir, s / 12, 1));
  }
  for (let s = 0; s < 12; s++) gHelm.quad(ring0[s], ring0[(s + 1) % 12], ring1[(s + 1) % 12], ring1[s]);
  const gCrest = new Geo();
  box(gCrest, add(hb, mul(up, 0.20)), piv.side, up, fwd, 0.03, 0.09, 0.16);
  gHelm.merge(gCrest);
  push(gHelm, 'Bip01_Head1');
  for (const [arm, bone] of [[armL, 'Bip01_L_UpperArm'], [armR, 'Bip01_R_UpperArm']]) {
    const outDir = norm(add(norm(sub(arm, spine2)), mul(up, 0.25)));
    const g = new Geo();
    dome(g, add(arm, mul(up, 0.04)), outDir, 0.16, 0.14, 10, 3);
    push(g, bone);
  }
  const gShield = new Geo();
  const outShield = norm(add(mul(norm(sub(foreL, spine2)), 0.9), mul(fwd, 0.25)));
  kiteShield(gShield, add(foreL, mul(outShield, 0.16)), norm(add(mul(norm(sub(foreL, spine2)), 0.2), mul(fwd, 0.1))),
    up, outShield, 0.42, 0.64, 0.05);
  push(gShield, 'Bip01_L_Forearm');
  return pieces;
}

/* ---------------------------------------------------------------- variant assembly */
async function buildVariant(name, baseName, textureKind, builder, opts) {
  console.log(`\n== ${name} (from ${baseName})`);
  const baseGz = path.join(LIVE, baseName + '.glb.gz');
  const srcGlb = path.join(WORK, name + '_base.glb');
  fs.writeFileSync(srcGlb, zlib.gunzipSync(fs.readFileSync(baseGz)));
  const doc = await io.read(srcGlb);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const bodyPrim = mesh.listPrimitives()[0];
  const skin = root.listSkins()[0];
  const bodyIdxHash = sha(Buffer.from(bodyPrim.getIndices().getArray().buffer));
  const bodyPosHash = sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer));
  const animHash = () => root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)])))).join('|');
  const animBefore = animHash();
  const clipCount = root.listAnimations().length;

  const bind = jointPivots(skin);
  const p = (suffix) => {
    const key = [...bind.keys()].find((k) => k === suffix) || [...bind.keys()].find((k) => k.endsWith(suffix));
    if (!key) throw new Error(`${name}: missing joint ${suffix}`);
    return bind.get(key);
  };
  // body axes from the hips -> head line (zombie: root/spine; skeleton: Bip01_Pelvis/Spine chain)
  const hipsKey = [...bind.keys()].find((k) => /root|Pelvis/i.test(k)) || [...bind.keys()][0];
  const headKey = [...bind.keys()].find((k) => /neck|head/i.test(k)) || [...bind.keys()][1];
  const hips = bind.get(hipsKey), headJ = bind.get(headKey);
  const up = norm(sub(headJ, hips));
  const forward = norm(sub(v3(0, 0, 1), mul(up, dot(up, v3(0, 0, 1)))));
  const side = norm(cross(forward, up));
  const piv = {up, forward, side, p};

  const pieces = builder(piv);
  const merged = new Geo();
  const boneOf = [];
  for (const piece of pieces) {
    const start = merged.p.length / 3;
    merged.merge(piece.geo);
    for (let i = start; i < merged.p.length / 3; i++) boneOf.push(piece.bone);
  }
  const jointIndex = (suffix) => {
    const k = [...bind.keys()].find((x) => x === suffix) || [...bind.keys()].find((x) => x.endsWith(suffix));
    if (!k) throw new Error(`${name}: missing joint ${suffix}`);
    return skin.listJoints().findIndex((j) => (j.getName() || '') === k);
  };

  const texJpeg = await makeTexture(textureKind);
  const buffer = root.listBuffers()[0];
  const mat = doc.createMaterial(name + '_mat')
    .setBaseColorTexture(doc.createTexture(name + '_tex').setImage(new Uint8Array(texJpeg)).setMimeType('image/jpeg'))
    .setRoughnessFactor(textureKind === 'plague' ? 0.85 : 0.7)
    .setMetallicFactor(textureKind === 'plague' ? 0.0 : 0.45)
    .setDoubleSided(true);
  const vCount = merged.p.length / 3;
  const jointsArr = new Uint16Array(vCount * 4);
  const weightsArr = new Uint8Array(vCount * 4);
  for (let i = 0; i < vCount; i++) {
    const ji = jointIndex(boneOf[i]);
    for (let k = 0; k < 4; k++) { jointsArr[i * 4 + k] = ji; weightsArr[i * 4 + k] = k === 0 ? 255 : 0; }
  }
  const prim = doc.createPrimitive();
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(merged.p)).setBuffer(buffer));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(merged.n)).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(merged.uv)).setBuffer(buffer));
  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointsArr).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weightsArr).setNormalized(true).setBuffer(buffer));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(merged.idx)).setBuffer(buffer));
  prim.setMaterial(mat);
  mesh.addPrimitive(prim);

  const same = bodyIdxHash === sha(Buffer.from(bodyPrim.getIndices().getArray().buffer)) &&
    bodyPosHash === sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer)) &&
    animBefore === animHash() && root.listSkins().length === 1 &&
    root.listAnimations().length === clipCount;
  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);
  const tris = mesh.listPrimitives().reduce((s, pr) => s + pr.getIndices().getCount() / 3, 0);
  const prims = mesh.listPrimitives().length;
  const joints = skin.listJoints().length;
  const fits = tris <= opts.triBudget && gz.length <= opts.byteBudget;
  console.log(`${name.padEnd(16)} tris ${String(tris).padStart(5)}/${opts.triBudget} prims ${prims} joints ${joints} ` +
    `clips ${clipCount} ${(gz.length / 1024).toFixed(1)} KB/${(opts.byteBudget / 1024).toFixed(0)} KB ` +
    `add-on +${merged.tris}t unch=${same} fits=${fits}`);
  return {name, tris, prims, joints, clips: clipCount, bytes: gz.length, same, fits, addTris: merged.tris};
}

async function main() {
  const rows = [];
  if (!only || only.includes('zombie')) {
    rows.push(await buildVariant('zombie-bloated', 'zombie', 'plague', buildZombieBloated,
      {triBudget: 11000, byteBudget: 400 * 1024}));
  }
  if (!only || only.includes('skeleton')) {
    rows.push(await buildVariant('skeleton-armoured', 'skeleton-soldier', 'iron', buildSkeletonArmoured,
      {triBudget: 8500, byteBudget: 350 * 1024}));
  }
  fs.writeFileSync(path.join(STAGE, 'manifest-enemies.json'), JSON.stringify(rows, null, 1));
  const bad = rows.filter((r) => !r.fits || !r.same);
  if (bad.length) { console.error('BUDGET/INTEGRITY ISSUES:', bad); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(1); });
