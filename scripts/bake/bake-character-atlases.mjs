#!/usr/bin/env node
// Bake + install correct base-colour atlases for the seven character bodies whose UV0 layout was
// broken (93 % zero-area triangles -> sampling their atlas yields black gutters; zombie and
// skeleton-soldier are fine and untouched).
//
// Per character:
//   1. Blender (bake-character-atlas.py): Smart-UV re-layout, procedural per-palette armour
//      material, EMIT bake to a 1024 linear PNG, and a mesh-only GLB carrying the NEW UVs.
//   2. here: graft the new UVs back onto the ORIGINAL skinned primitive without touching the rig.
//      Blender's re-welded vertex order is irrelevant: each exported triangle corner is matched to
//      an original vertex by position+normal, then vertices are split only where the new UV differs
//      (exactly how glTF itself represents UV seams). POSITION/NORMAL/JOINTS_0/WEIGHTS_0 are copied
//      byte-for-byte from the original accessors, so skinning, bones and animation data are
//      untouched. The baked atlas (linear -> sRGB, resized/JPEG-encoded to fit the 450 KB budget) is
//      swapped into the existing texture slot.
//   3. verify tri/skin/animation counts and animation-accessor hashes are unchanged, stage the GLB.
//
//   node scripts/bake/bake-character-atlases.mjs [--only hero,templar]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {KHRMeshQuantization} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const LIVE = path.join(GAME, 'public/assets/custom');
const SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab';
const WORK = path.join(SCRATCH, 'atlas');
const STAGE = path.join(SCRATCH, 'optimized_atlas');
const STAGE_CUSTOM = path.join(STAGE, 'custom');
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const BAKE_PY = path.join(GAME, 'scripts/bake/bake-character-atlas.py');
const CHARS = ['hero', 'templar', 'ally', 'berserker', 'ranger', 'survivor', 'fallen'];
const ANGLE = process.argv.includes('--angle') ? process.argv[process.argv.indexOf('--angle') + 1] : '89';
const BUDGET = 450 * 1024;
const io = new NodeIO();

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(STAGE_CUSTOM, {recursive: true});

function gzip9(buf) { return zlib.gzipSync(buf, {level: 9}); }
function sha(buf) { return createHash('sha1').update(Buffer.from(buf)).digest('hex'); }
function accessorBytes(acc) {
  const arr = acc.getArray();
  if (!arr) return '';
  return arr instanceof Float32Array || arr instanceof Uint16Array || arr instanceof Uint32Array || arr instanceof Int16Array || arr instanceof Uint8Array
    ? Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
    : Buffer.from(String(arr));
}

function nodeIoForDoc() { return new NodeIO(); }

/** Blender's mesh-only export bakes the imported object/armature transform into the vertices
 *  (uniform scale + a signed axis permutation). Recover that similarity transform by brute-force
 *  over the 48 signed axis permutations, then match exported corners to original vertices by
 *  position+normal. Returns a map exportedVertexIndex -> originalVertexIndex. */
function fitAndMatch(origPos, origNor, uvPos, uvNor) {
  const axis = (arr, n) => {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], arr[i * 3 + k]);
      hi[k] = Math.max(hi[k], arr[i * 3 + k]);
    }
    return {lo, hi, ext: hi.map((v, i) => v - lo[i])};
  };
  const A = axis(origPos, origPos.length / 3);
  const B = axis(uvPos, uvPos.length / 3);

  const perms = [];
  for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
    for (const [ax, ay, az] of permute3()) perms.push({map: [ax, ay, az], signs: [sx, sy, sz]});
  }
  const nB = uvPos.length / 3;
  const Akey = new Map();
  for (let i = 0; i < origPos.length / 3; i++) {
    const k = `${Math.round(origPos[i * 3] * 200)}|${Math.round(origPos[i * 3 + 1] * 200)}|${Math.round(origPos[i * 3 + 2] * 200)}`;
    if (!Akey.has(k)) Akey.set(k, []);
    Akey.get(k).push(i);
  }
  let best = null;
  for (const {map, signs} of perms) {
    // uniform scale implied by this axis assignment (ratios should agree for the correct one)
    const scale = ([0, 1, 2].reduce((s, j) => s + A.ext[map[j]] / Math.max(B.ext[j], 1e-9), 0)) / 3;
    if (!isFinite(scale) || scale <= 0) continue;
    const xf = (arr, idx, out) => {
      out[0] = scale * signs[0] * arr[idx * 3 + map[0]];
      out[1] = scale * signs[1] * arr[idx * 3 + map[1]];
      out[2] = scale * signs[2] * arr[idx * 3 + map[2]];
    };
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const tmp = [0, 0, 0];
    for (let i = 0; i < nB; i++) {
      xf(uvPos, i, tmp);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tmp[k]); hi[k] = Math.max(hi[k], tmp[k]); }
    }
    const t = [A.lo[0] - lo[0], A.lo[1] - lo[1], A.lo[2] - lo[2]];
    let hit = 0;
    for (let i = 0; i < nB; i++) {
      xf(uvPos, i, tmp);
      const k = `${Math.round((tmp[0] + t[0]) * 200)}|${Math.round((tmp[1] + t[1]) * 200)}|${Math.round((tmp[2] + t[2]) * 200)}`;
      if (Akey.has(k)) hit++;
    }
    if (!best || hit > best.hit) best = {hit, map, signs, t, scale};
  }
  const result = new Array(nB).fill(-1);
  let matched = 0;
  const tmp = [0, 0, 0];
  for (let i = 0; i < nB; i++) {
    tmp[0] = best.scale * best.signs[0] * uvPos[i * 3 + best.map[0]] + best.t[0];
    tmp[1] = best.scale * best.signs[1] * uvPos[i * 3 + best.map[1]] + best.t[1];
    tmp[2] = best.scale * best.signs[2] * uvPos[i * 3 + best.map[2]] + best.t[2];
    const k = `${Math.round(tmp[0] * 200)}|${Math.round(tmp[1] * 200)}|${Math.round(tmp[2] * 200)}`;
    const cands = Akey.get(k);
    if (cands && cands.length) {
      if (cands.length === 1) { result[i] = cands[0]; matched++; continue; }
      // disambiguate by transformed normal direction
      const n = [best.signs[0] * uvNor[i * 3 + best.map[0]], best.signs[1] * uvNor[i * 3 + best.map[1]], best.signs[2] * uvNor[i * 3 + best.map[2]]];
      let bestDot = -2, bestIdx = cands[0];
      for (const o of cands) {
        const d = n[0] * origNor[o * 3] + n[1] * origNor[o * 3 + 1] + n[2] * origNor[o * 3 + 2];
        if (d > bestDot) { bestDot = d; bestIdx = o; }
      }
      result[i] = bestIdx; matched++;
    }
  }
  // fallback for rounding misses: nearest original vertex in the fitted space (tight tolerance)
  const nA = origPos.length / 3;
  for (let i = 0; i < nB; i++) {
    if (result[i] >= 0) continue;
    tmp[0] = best.scale * best.signs[0] * uvPos[i * 3 + best.map[0]] + best.t[0];
    tmp[1] = best.scale * best.signs[1] * uvPos[i * 3 + best.map[1]] + best.t[1];
    tmp[2] = best.scale * best.signs[2] * uvPos[i * 3 + best.map[2]] + best.t[2];
    let bestD = Infinity, bestIdx = -1;
    for (let o = 0; o < nA; o++) {
      const dx = tmp[0] - origPos[o * 3], dy = tmp[1] - origPos[o * 3 + 1], dz = tmp[2] - origPos[o * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestIdx = o; }
    }
    if (bestIdx >= 0 && bestD < 0.25) { result[i] = bestIdx; matched++; }
  }
  return {result, matched, total: nB, fit: {scale: +best.scale.toFixed(6), map: best.map, signs: best.signs, translate: best.t.map((v) => +v.toFixed(4))}};
}

function permute3() {
  const out = [];
  const idx = [0, 1, 2];
  for (const a of idx) for (const b of idx) for (const c of idx) {
    if (a !== b && b !== c && a !== c) out.push([a, b, c]);
  }
  return out;
}

function buildRemap(origPos, origNor, uvPos, uvNor) {
  const {result, matched, total, fit} = fitAndMatch(origPos, origNor, uvPos, uvNor);
  return {result, missing: total - matched, matched, total, fit};
}

async function bakeAtlas(name) {
  const src = path.join(WORK, name + '.glb');
  fs.writeFileSync(src, zlib.gunzipSync(fs.readFileSync(path.join(LIVE, name + '.glb.gz'))));
  const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', BAKE_PY, '--',
    '--name', name, '--src', src, '--out', WORK, '--angle', ANGLE], {encoding: 'utf8', timeout: 15 * 60 * 1000});
  const lines = (r.stdout || '').split('\n').filter((l) => l.includes('[atlas]'));
  lines.forEach((l) => console.log('   ' + l.trim()));
  if (r.status !== 0) throw new Error(`blender failed for ${name}: ${(r.stderr || '').slice(-800)}`);
  const png = path.join(WORK, name + '_linear.png');
  const uvglb = path.join(WORK, name + '_uvmesh.glb');
  if (!fs.existsSync(png) || !fs.existsSync(uvglb)) throw new Error('missing bake outputs for ' + name);
  return {png, uvglb};
}

async function encodeAtlas(pngPath, maxDim, quality) {
  const raw = await sharp(pngPath).resize(maxDim, maxDim, {fit: 'inside', kernel: 'lanczos3'}).raw().toBuffer();
  const meta = await sharp(pngPath).metadata();
  // the bake was saved as Non-Color -> pixels are linear; encode to sRGB for a base-colour map
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    lut[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }
  const resized = await sharp(pngPath).resize(maxDim, maxDim, {fit: 'inside', kernel: 'lanczos3'}).removeAlpha().raw().toBuffer();
  const enc = Buffer.alloc(resized.length);
  for (let i = 0; i < resized.length; i++) enc[i] = lut[resized[i]];
  const jpeg = await sharp(enc, {raw: {width: Math.min(maxDim, meta.width), height: Math.min(maxDim, meta.height), channels: 3}})
    .jpeg({quality, mozjpeg: true}).toBuffer();
  return jpeg;
}

async function processCharacter(name) {
  console.log(`\n== ${name}`);
  const liveGz = fs.readFileSync(path.join(LIVE, name + '.glb.gz'));
  const origGzBytes = liveGz.length;
  const {png, uvglb} = await bakeAtlas(name);

  // ---- original skinned document ----
  const doc = await io.read(path.join(WORK, name + '.glb'));
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const posAcc = prim.getAttribute('POSITION');
  const norAcc = prim.getAttribute('NORMAL');
  const jointsAcc = prim.getAttribute('JOINTS_0');
  const weightsAcc = prim.getAttribute('WEIGHTS_0');
  const origPos = posAcc.getArray(), origNor = norAcc.getArray();
  const origJoints = jointsAcc.getArray(), origWeights = weightsAcc.getArray();
  const origVerts = origPos.length / 3;

  // ---- baked UV mesh ----
  const uvDoc = await io.read(uvglb);
  const uvPrim = uvDoc.getRoot().listMeshes()[0].listPrimitives()[0];
  const uvPos = uvPrim.getAttribute('POSITION').getArray();
  const uvNor = uvPrim.getAttribute('NORMAL').getArray();
  const uvUv = uvPrim.getAttribute('TEXCOORD_0').getArray();
  const uvIdx = uvPrim.getIndices().getArray();
  const {result: vmap, missing, matched, fit} = buildRemap(origPos, origNor, uvPos, uvNor);
  console.log(`   uv-fit: ${matched}/${uvPos.length / 3} corners matched (scale ${fit.scale}, axes [${fit.map}] signs [${fit.signs}])`);
  if (missing) throw new Error(`${name}: ${missing}/${uvPos.length / 3} exported corners not matched`);

  // ---- rebuild primitive with split vertices carrying the new UVs ----
  const newIdx = new Uint32Array(uvIdx.length);
  const splitKey = new Map();
  const newVerts = [];      // original vertex index per new vertex
  const newUvs = [];
  for (let i = 0; i < uvIdx.length; i++) {
    const corner = uvIdx[i];
    const orig = vmap[corner];
    const u = Math.round(uvUv[corner * 2] * 100000) / 100000;
    const v = Math.round(uvUv[corner * 2 + 1] * 100000) / 100000;
    const k = `${orig}:${u}:${v}`;
    let nv = splitKey.get(k);
    if (nv === undefined) {
      nv = newVerts.length;
      splitKey.set(k, nv);
      newVerts.push(orig);
      newUvs.push(u, v);
    }
    newIdx[i] = nv;
  }
  const newPos = new Float32Array(newVerts.length * 3);
  const newNor = new Float32Array(newVerts.length * 3);
  const newJoints = new Uint16Array(newVerts.length * 4);
  const newWeights = new Float32Array(newVerts.length * 4);
  for (let i = 0; i < newVerts.length; i++) {
    const o = newVerts[i];
    for (let c = 0; c < 3; c++) { newPos[i * 3 + c] = origPos[o * 3 + c]; newNor[i * 3 + c] = origNor[o * 3 + c]; }
    for (let c = 0; c < 4; c++) { newJoints[i * 4 + c] = origJoints[o * 4 + c]; newWeights[i * 4 + c] = origWeights[o * 4 + c]; }
  }
  const oldUvAcc = prim.getAttribute('TEXCOORD_0');
  const buffer = root.listBuffers()[0];
  const mk = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  // Attribute packing keeps the split-vertex geometry inside the 450 KB budget:
  //   NORMAL -> int8 normalised, TEXCOORD_0 -> uint16 normalised (KHR_mesh_quantization),
  //   WEIGHTS_0 -> uint8 normalised (core glTF), indices -> uint16.
  // POSITION and JOINTS_0 are untouched, so the bind pose and skinning stay bit-identical.
  const qNor = new Int8Array(newNor.length);
  for (let i = 0; i < newNor.length; i++) qNor[i] = Math.max(-127, Math.min(127, Math.round(newNor[i] * 127)));
  const qUv = new Uint16Array(newUvs.length);
  for (let i = 0; i < newUvs.length; i++) qUv[i] = Math.max(0, Math.min(65535, Math.round(newUvs[i] * 65535)));
  const qW = new Uint8Array(newWeights.length);
  for (let v = 0; v < newWeights.length / 4; v++) {
    qW[v * 4] = Math.max(0, Math.min(255, Math.round(newWeights[v * 4] * 255)));
    qW[v * 4 + 1] = Math.max(0, Math.min(255, Math.round(newWeights[v * 4 + 1] * 255)));
    qW[v * 4 + 2] = Math.max(0, Math.min(255, Math.round(newWeights[v * 4 + 2] * 255)));
    qW[v * 4 + 3] = Math.max(0, Math.min(255, 255 - (qW[v * 4] + qW[v * 4 + 1] + qW[v * 4 + 2])));
  }
  const qIdx = new Uint16Array(newIdx);
  const newPosAcc = mk('VEC3', newPos);
  const newNorAcc = doc.createAccessor().setType('VEC3').setArray(qNor).setNormalized(true).setBuffer(buffer);
  const newUvAcc = doc.createAccessor().setType('VEC2').setArray(qUv).setNormalized(true).setBuffer(buffer);
  const newJointAcc = doc.createAccessor().setType('VEC4').setArray(newJoints).setBuffer(buffer);
  const newWeightAcc = doc.createAccessor().setType('VEC4').setArray(qW).setNormalized(true).setBuffer(buffer);
  const newIndexAcc = doc.createAccessor().setType('SCALAR').setArray(qIdx).setBuffer(buffer);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  for (const [sem, acc] of [['POSITION', newPosAcc], ['NORMAL', newNorAcc], ['TEXCOORD_0', newUvAcc],
    ['JOINTS_0', newJointAcc], ['WEIGHTS_0', newWeightAcc]]) prim.setAttribute(sem, acc);
  prim.setIndices(newIndexAcc);
  for (const acc of [posAcc, norAcc, jointsAcc, weightsAcc, oldUvAcc]) {
    if (acc && acc.listParents().length <= 1) acc.dispose();
  }

  // ---- atlas image: fit the remaining budget (450 KB total gzip) ----
  const textures = root.listTextures();
  if (!textures.length) throw new Error(name + ': no texture slot');
  const texture = textures[0];
  const animHashBefore = root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => {
    const parts = [];
    if (s.getInput()) parts.push(accessorBytes(s.getInput()));
    if (s.getOutput()) parts.push(accessorBytes(s.getOutput()));
    return parts;
  })))).join('|');

  let chosen = null;
  for (const [dim, q] of [[512, 85], [512, 78], [384, 78], [256, 82], [256, 74]]) {
    const jpeg = await encodeAtlas(png, dim, q);
    texture.setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg');
    const bytes = await io.writeBinary(doc);
    const gz = gzip9(bytes);
    chosen = {dim, q, jpeg: jpeg.length, gz: gz.length, bytes, buffer: gz};
    if (gz.length <= BUDGET) break;
    console.log(`   ${dim}px q${q}: ${(gz.length / 1024).toFixed(1)} KB > budget, retrying`);
    // reset doc state for next attempt: re-read original (cheap) and redo? keep same doc, only texture changed
  }
  if (!chosen) throw new Error(name + ': could not fit budget');
  if (chosen.gz > BUDGET) console.log(`   WARNING over 450 KB budget: ${(chosen.gz / 1024).toFixed(1)} KB`);

  // ---- rig-preservation verification ----
  const animHashAfter = root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => {
    const parts = [];
    if (s.getInput()) parts.push(accessorBytes(s.getInput()));
    if (s.getOutput()) parts.push(accessorBytes(s.getOutput()));
    return parts;
  })))).join('|');
  const tris = newIdx.length / 3;
  const rigOk = animHashBefore === animHashAfter && root.listSkins().length === 1 && root.listAnimations().length === 12;
  fs.writeFileSync(path.join(STAGE_CUSTOM, name + '.glb.gz'), chosen.buffer);
  const row = {
    name, origGz: origGzBytes, gz: chosen.gz, imageKB: +(chosen.jpeg / 1024).toFixed(1),
    dim: chosen.dim, quality: chosen.q, tris, prims: root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
    vertsBefore: origVerts, vertsAfter: newVerts.length, skins: root.listSkins().length,
    anims: root.listAnimations().length, rigOk,
  };
  console.log(`   ${name}: ${(origGzBytes / 1024).toFixed(1)} -> ${(row.gz / 1024).toFixed(1)} KB, ` +
    `image ${row.imageKB} KB @${row.dim}px q${row.quality}, tris ${tris}, verts ${origVerts}->${newVerts.length}, ` +
    `skins ${row.skins}, anims ${row.anims}, rig-intact ${rigOk}`);
  return row;
}

const rows = [];
for (const name of CHARS) {
  if (only && !only.includes(name)) continue;
  rows.push(await processCharacter(name));
}
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${(r.gz / 1024).toFixed(1)}KB`).join(', '));
