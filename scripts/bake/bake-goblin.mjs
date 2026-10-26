#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const LIVE = path.join(GAME, 'public/assets/custom');
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/goblin';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_goblin/custom';
const io = new NodeIO();
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(STAGE, {recursive: true});
const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) { this.p.push(...p); this.n.push(...n); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(other) {
    const offset = this.p.length / 3;
    this.p.push(...other.p); this.n.push(...other.n); this.uv.push(...other.uv);
    for (const index of other.idx) this.idx.push(index + offset);
  }
  get tris() { return this.idx.length / 3; }
}

function basisFrom(axis) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(helper, a));
  return {axis: a, x, y: cross(a, x)};
}

function ellipsoid(geo, centre, up, rx, ry, rz, segs = 12, rings = 5) {
  const basis = basisFrom(up), rows = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, angle = t * Math.PI, cosA = Math.cos(angle), sinA = Math.sin(angle), row = [];
    for (let s = 0; s < segs; s++) {
      const phi = (s / segs) * Math.PI * 2, cx = Math.cos(phi) * sinA, cy = Math.sin(phi) * sinA;
      const p = add(centre, add(mul(basis.x, cx * rx), add(mul(basis.y, cy * rz), mul(up, cosA * ry))));
      const n = norm(add(mul(basis.x, cx / Math.max(rx, 1e-4)), add(mul(basis.y, cy / Math.max(rz, 1e-4)), mul(up, cosA / Math.max(ry, 1e-4)))));
      row.push(geo.vert(p, n, 0.04 + s / segs * 0.92, 0.04 + t * 0.92));
    }
    rows.push(row);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const next = (s + 1) % segs;
    if (r === 0) geo.tri(rows[0][0], rows[1][next], rows[1][s]);
    else if (r === rings - 1) geo.tri(rows[r][s], rows[r][next], rows[rings][0]);
    else geo.quad(rows[r][s], rows[r][next], rows[r + 1][next], rows[r + 1][s]);
  }
}

function frustum(geo, a, b, r0, r1, sides = 8) {
  const axis = norm(sub(b, a)), basis = basisFrom(axis);
  const ring = (centre, radius) => {
    const row = [];
    for (let s = 0; s < sides; s++) {
      const angle = s / sides * Math.PI * 2;
      const dir = add(mul(basis.x, Math.cos(angle)), mul(basis.y, Math.sin(angle)));
      row.push(geo.vert(add(centre, mul(dir, radius)), dir, s / sides, 0));
    }
    return row;
  };
  const first = ring(a, r0), second = ring(b, r1);
  for (let s = 0; s < sides; s++) {
    const next = (s + 1) % sides;
    geo.quad(first[s], first[next], second[next], second[s]);
  }
}

function box(geo, centre, right, up, forward, sx, sy, sz) {
  const half = [sx / 2, sy / 2, sz / 2];
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vertices = corners.map(([x, y, z]) => geo.vert(
    add(centre, add(add(mul(right, x * half[0]), mul(up, y * half[1])), mul(forward, z * half[2]))),
    norm(add(add(mul(right, x), mul(up, y)), mul(forward, z))), 0.5, 0.5));
  for (const q of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) {
    geo.quad(vertices[q[0]], vertices[q[1]], vertices[q[2]], vertices[q[3]]);
  }
}

function jointPivots(skin) {
  const map = new Map(), array = skin.getInverseBindMatrices().getArray();
  skin.listJoints().forEach((joint, index) => {
    const offset = index * 16;
    const a = [array[offset], array[offset + 1], array[offset + 2]];
    const b = [array[offset + 4], array[offset + 5], array[offset + 6]];
    const c = [array[offset + 8], array[offset + 9], array[offset + 10]];
    const t = [array[offset + 12], array[offset + 13], array[offset + 14]];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    const solve = (m) => (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det;
    const rhs = [-t[0], -t[1], -t[2]];
    map.set(joint.getName() || '', [solve([[rhs[0], b[0], c[0]], [rhs[1], b[1], c[1]], [rhs[2], b[2], c[2]]]),
      solve([[a[0], rhs[0], c[0]], [a[1], rhs[1], c[1]], [a[2], rhs[2], c[2]]]),
      solve([[a[0], b[0], rhs[0]], [a[1], b[1], rhs[1]], [a[2], b[2], rhs[2]]])]);
  });
  return map;
}

function buildPieces(piv) {
  const skin = [], gear = [];
  const {up, forward: fwd, side} = piv;
  const head = piv.p('c_subneck_1.x'), spine4 = piv.p('spine_04.x');
  const headCentre = add(head, [0, 0.065, 0]);
  const headMesh = new Geo();
  ellipsoid(headMesh, headCentre, [0, 1, 0], 0.087, 0.125, 0.10, 16, 8);
  skin.push({geo: headMesh, bone: 'c_subneck_1.x'});
  const shoulderL = piv.p('shoulder.l'), shoulderR = piv.p('shoulder.r');
  const hips = piv.p('root.x'), foreL = piv.p('forearm_stretch.l'), foreR = piv.p('forearm_stretch.r');
  for (const sign of [1, -1]) {
    const base = add(headCentre, add(mul(side, sign * 0.065), [0, 0.015, 0]));
    const earDirection = norm(add(mul(side, sign), [0, 0.65, -0.04]));
    const tip = add(base, mul(earDirection, 0.18));
    const ear = new Geo();
    frustum(ear, base, tip, 0.034, 0.003, 6);
    skin.push({geo: ear, bone: 'c_subneck_1.x'});
    const brow = new Geo();
    box(brow, add(add(headCentre, mul(side, sign * 0.038)), add(mul(fwd, 0.089), [0, 0.025, 0])), side, [0, 1, 0], fwd, 0.063, 0.018, 0.022);
    skin.push({geo: brow, bone: 'c_subneck_1.x'});
    const shoulder = new Geo();
    ellipsoid(shoulder, add(sign < 0 ? shoulderL : shoulderR, add(mul(fwd, -0.035), [0, 0.025, 0])), [0, 1, 0], 0.105, 0.11, 0.09, 10, 4);
    skin.push({geo: shoulder, bone: sign < 0 ? 'shoulder.l' : 'shoulder.r'});
    const wrap = new Geo();
    const arm = sign < 0 ? foreL : foreR;
    frustum(wrap, add(arm, mul(up, -0.035)), add(arm, mul(up, 0.035)), 0.058, 0.058, 8);
    gear.push({geo: wrap, bone: sign < 0 ? 'forearm_stretch.l' : 'forearm_stretch.r'});
  }
  const nose = new Geo();
  frustum(nose, add(headCentre, add(mul(fwd, 0.083), [0, -0.015, 0])), add(headCentre, add(mul(fwd, 0.18), [0, -0.05, 0])), 0.029, 0.004, 8);
  skin.push({geo: nose, bone: 'c_subneck_1.x'});
  const hump = new Geo();
  ellipsoid(hump, add(spine4, [0, -0.005, -0.085]), [0, 1, 0], 0.14, 0.095, 0.105, 12, 5);
  gear.push({geo: hump, bone: 'spine_04.x'});
  const belt = new Geo();
  frustum(belt, add(hips, mul(up, 0.045)), add(hips, mul(up, 0.105)), 0.205, 0.205, 12);
  gear.push({geo: belt, bone: 'root.x'});
  const pouch = new Geo();
  box(pouch, add(add(hips, mul(side, 0.19)), add(mul(fwd, 0.025), mul(up, -0.03))), side, up, fwd, 0.10, 0.15, 0.075);
  gear.push({geo: pouch, bone: 'root.x'});
  const loin = new Geo();
  box(loin, add(hips, add(mul(fwd, 0.14), mul(up, -0.16))), side, up, fwd, 0.19, 0.26, 0.025);
  gear.push({geo: loin, bone: 'root.x'});
  return {skin, gear};
}

async function makeTextures(kind) {
  const size = 256, albedo = Buffer.alloc(size * size * 3), normal = Buffer.alloc(size * size * 3), orm = Buffer.alloc(size * size * 3);
  const hash = (x, y) => { const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return value - Math.floor(value); };
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x, rgb = index * 3;
    const n = hash(Math.floor(x / 3), Math.floor(y / 3)), large = hash(Math.floor(x / 19), Math.floor(y / 19));
    const scar = (x % 53 < 2 && y % 97 < 5) || (x % 71 < 3 && y % 43 < 2);
    height[index] = 0.5 + n * 0.16 + large * 0.12 - (scar ? 0.16 : 0);
    if (kind === 'skin') {
      const base = 0.19 + n * 0.065 + large * 0.045;
      albedo[rgb] = Math.round(255 * base * 0.78);
      albedo[rgb + 1] = Math.round(255 * base * 1.16);
      albedo[rgb + 2] = Math.round(255 * base * 0.56);
      if (scar) { albedo[rgb] *= 0.48; albedo[rgb + 1] *= 0.56; albedo[rgb + 2] *= 0.52; }
      orm[rgb] = 255; orm[rgb + 1] = 220; orm[rgb + 2] = 0;
    } else {
      const base = 0.12 + n * 0.05 + large * 0.04;
      const stitch = x % 47 < 2 || y % 47 < 2;
      albedo[rgb] = Math.round(255 * base * 1.12 * (stitch ? 0.68 : 1));
      albedo[rgb + 1] = Math.round(255 * base * 0.79 * (stitch ? 0.68 : 1));
      albedo[rgb + 2] = Math.round(255 * base * 0.49 * (stitch ? 0.68 : 1));
      orm[rgb] = 255; orm[rgb + 1] = 205; orm[rgb + 2] = 38;
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * size + x, rgb = index * 3;
    const dx = (height[y * size + ((x + 1) % size)] - height[y * size + ((x + size - 1) % size)]) * 1.4;
    const dy = (height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]) * 1.4;
    const vector = norm([-dx, -dy, 1]);
    normal[rgb] = Math.round((vector[0] * 0.5 + 0.5) * 255);
    normal[rgb + 1] = Math.round((vector[1] * 0.5 + 0.5) * 255);
    normal[rgb + 2] = Math.round((vector[2] * 0.5 + 0.5) * 255);
  }
  const encode = (data) => sharp(data, {raw: {width: size, height: size, channels: 3}}).jpeg({quality: 87, mozjpeg: true}).toBuffer();
  return {albedo: await encode(albedo), normal: await encode(normal), orm: await encode(orm)};
}

async function main() {
  const srcGlb = path.join(WORK, 'zombie_base.glb');
  fs.writeFileSync(srcGlb, zlib.gunzipSync(fs.readFileSync(path.join(LIVE, 'zombie.glb.gz'))));
  const doc = await io.read(srcGlb), root = doc.getRoot(), mesh = root.listMeshes()[0];
  const body = mesh.listPrimitives()[0], skin = root.listSkins()[0];
  const bodyHash = sha(Buffer.from(body.getAttribute('POSITION').getArray().buffer));
  const indexHash = sha(Buffer.from(body.getIndices().getArray().buffer));
  const animHash = () => root.listAnimations().map((animation) => sha(Buffer.concat(animation.listSamplers().flatMap((sampler) => [
    Buffer.from(sampler.getInput().getArray().buffer), Buffer.from(sampler.getOutput().getArray().buffer)])))).join('|');
  const animationBefore = animHash(), clipCount = root.listAnimations().length;
  const bodyMaterial = body.getMaterial();
  bodyMaterial.setName('GoblinSkinMat').setRoughnessFactor(0.9).setMetallicFactor(0);
  const bodyTexture = bodyMaterial.getBaseColorTexture();
  const tinted = await sharp(Buffer.from(bodyTexture.getImage())).modulate({hue: 58, saturation: 0.68, brightness: 0.86}).jpeg({quality: 88, mozjpeg: true}).toBuffer();
  bodyTexture.setImage(new Uint8Array(tinted)).setMimeType('image/jpeg');
  const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
  meshNode.setName('GoblinBody');
  root.listScenes()[0].setExtras({characterHeight: 1.45});

  const bind = jointPivots(skin);
  const p = (suffix) => {
    const key = [...bind.keys()].find((name) => name === suffix) || [...bind.keys()].find((name) => name.endsWith(suffix));
    if (!key) throw new Error(`missing joint ${suffix}`);
    return bind.get(key);
  };
  const hips = bind.get('root.x'), head = bind.get('c_subneck_1.x');
  const up = norm(sub(head, hips));
  const forward = norm(sub([0, 0, 1], mul(up, dot(up, [0, 0, 1]))));
  const side = norm(cross(forward, up));
  const pieces = buildPieces({up, forward, side, p});
  const buffer = root.listBuffers()[0];
  for (const [kind, list] of Object.entries(pieces)) {
    const merged = new Geo(), bones = [];
    for (const piece of list) {
      const start = merged.p.length / 3;
      merged.merge(piece.geo);
      for (let i = start; i < merged.p.length / 3; i++) bones.push(piece.bone);
    }
    const textures = await makeTextures(kind);
    const albedo = doc.createTexture(`goblin_${kind}_albedo`).setImage(new Uint8Array(textures.albedo)).setMimeType('image/jpeg');
    const normal = doc.createTexture(`goblin_${kind}_normal`).setImage(new Uint8Array(textures.normal)).setMimeType('image/jpeg');
    const orm = doc.createTexture(`goblin_${kind}_orm`).setImage(new Uint8Array(textures.orm)).setMimeType('image/jpeg');
    const material = doc.createMaterial(`goblin_${kind}`)
      .setBaseColorTexture(albedo).setNormalTexture(normal).setMetallicRoughnessTexture(orm)
      .setRoughnessFactor(1).setMetallicFactor(1).setDoubleSided(true);
    const count = merged.p.length / 3, joints = new Uint16Array(count * 4), weights = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      const jointName = bones[i], jointIndex = skin.listJoints().findIndex((joint) => joint.getName() === jointName);
      if (jointIndex < 0) throw new Error(`missing skin joint ${jointName}`);
      for (let k = 0; k < 4; k++) { joints[i * 4 + k] = jointIndex; weights[i * 4 + k] = k === 0 ? 255 : 0; }
    }
    const primitive = doc.createPrimitive();
    primitive.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(merged.p)).setBuffer(buffer));
    primitive.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(merged.n)).setBuffer(buffer));
    primitive.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(merged.uv)).setBuffer(buffer));
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
    primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setNormalized(true).setBuffer(buffer));
    primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(merged.idx)).setBuffer(buffer));
    primitive.setMaterial(material);
    mesh.addPrimitive(primitive);
  }
  const same = bodyHash === sha(Buffer.from(body.getAttribute('POSITION').getArray().buffer)) &&
    indexHash === sha(Buffer.from(body.getIndices().getArray().buffer)) && animationBefore === animHash() &&
    root.listSkins().length === 1 && root.listAnimations().length === clipCount;
  if (!same) throw new Error('goblin base rig or animation integrity failed');
  const bytes = await io.writeBinary(doc), gz = zlib.gzipSync(bytes, {level: 9});
  fs.writeFileSync(path.join(STAGE, 'goblin.glb.gz'), gz);
  const tris = mesh.listPrimitives().reduce((sum, primitive) => sum + primitive.getIndices().getCount() / 3, 0);
  console.log(JSON.stringify({asset: 'goblin', tris, prims: mesh.listPrimitives().length, joints: skin.listJoints().length, clips: clipCount, gzipBytes: gz.length, rigAndAnimationsUnchanged: same}, null, 2));
  if (tris > 12000) throw new Error(`goblin exceeds triangle budget: ${tris}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
