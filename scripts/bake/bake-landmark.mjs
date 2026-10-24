#!/usr/bin/env node
// Phase B landmark bake: take the full-res GLB exported by Blender (bake-landmark.py), merge every
// primitive into one (baking node transforms into the vertices), simplify with meshoptimizer to the
// tri budget, quantise, ground-centre, uniform-scale to a game height, swap in the prepared
// night-toned 1024 base-colour texture and gzip-9 the result.
//
//   node scripts/bake/bake-landmark.mjs --name chapel_ruin --src <full.glb> --tex <jpg> \
//        --budget 14000 --height 7.0
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  dequantize, simplify, prune, dedup, quantize,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {MeshoptSimplifier} from '../custom-assets/node_modules/meshoptimizer/index.js';
import {
  KHRMeshQuantization, KHRMaterialsUnlit, KHRMaterialsSpecular, KHRMaterialsIOR,
} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_landmarks';
const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRMaterialsUnlit, KHRMaterialsSpecular, KHRMaterialsIOR]);
fs.mkdirSync(path.join(STAGE, 'custom'), { recursive: true });

const getArg = (f, d = null) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const NAME = getArg('--name');
const SRC = getArg('--src');
const TEX = getArg('--tex');
const BUDGET = Number(getArg('--budget', '10000'));
const HEIGHT = getArg('--height') ? Number(getArg('--height')) : null;
const gzip9 = (b) => zlib.gzipSync(b, { level: 9 });
const trisOf = (root) => root.listMeshes().reduce((s, m) => s + m.listPrimitives()
  .reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0), 0);

function xform(m, v) {
  const x = v[0], y = v[1], z = v[2];
  return [m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function xformDir(m, v) {
  const x = v[0], y = v[1], z = v[2];
  const nx = m[0] * x + m[4] * y + m[8] * z;
  const ny = m[1] * x + m[5] * y + m[9] * z;
  const nz = m[2] * x + m[6] * y + m[10] * z;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

async function main() {
  await MeshoptSimplifier.ready;
  const simplifier = {
    ...MeshoptSimplifier,
    simplify: (indices, positions, stride, target, error, flags) =>
      MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']),
  };
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  await doc.transform(dequantize());

  // ---- merge every primitive of every mesh node into one primitive ----
  const groups = new Map();
  const idxAll = [];
  let vOff = 0;
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const world = n.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pAcc = prim.getAttribute('POSITION');
      const nAcc = prim.getAttribute('NORMAL');
      const uvAcc = prim.getAttribute('TEXCOORD_0');
      const iAcc = prim.getIndices();
      if (!pAcc || !iAcc) continue;
      const count = pAcc.getCount();
      const pRaw = pAcc.getArray(); const nRaw = nAcc ? nAcc.getArray() : null; const uvRaw = uvAcc ? uvAcc.getArray() : null;
      const pArr = new Float32Array(count * 3);
      const nArr = new Float32Array(count * 3);
      const uvArr = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const p = xform(world, [pRaw[i * 3], pRaw[i * 3 + 1], pRaw[i * 3 + 2]]);
        pArr[i * 3] = p[0]; pArr[i * 3 + 1] = p[1]; pArr[i * 3 + 2] = p[2];
        if (nAcc) {
          const nn = xformDir(world, [nRaw[i * 3], nRaw[i * 3 + 1], nRaw[i * 3 + 2]]);
          nArr[i * 3] = nn[0]; nArr[i * 3 + 1] = nn[1]; nArr[i * 3 + 2] = nn[2];
        }
        if (uvRaw) { uvArr[i * 2] = uvRaw[i * 2]; uvArr[i * 2 + 1] = uvRaw[i * 2 + 1]; }
      }
      if (!groups.has('POSITION')) {
        groups.set('POSITION', { arrays: [], n: 3 });
        groups.set('NORMAL', { arrays: [], n: 3 });
        groups.set('TEXCOORD_0', { arrays: [], n: 2 });
      }
      groups.get('POSITION').arrays.push(pArr);
      groups.get('NORMAL').arrays.push(nArr);
      groups.get('TEXCOORD_0').arrays.push(uvArr);
      const arr = iAcc.getArray();
      for (let i = 0; i < arr.length; i++) idxAll.push(arr[i] + vOff);
      vOff += count;
    }
  }
  if (!groups.has('POSITION')) throw new Error('no primitives with POSITION/indices');
  const cat = (sem) => {
    const g = groups.get(sem);
    const total = g.arrays.reduce((s, arr) => s + arr.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const arr of g.arrays) { out.set(arr, o); o += arr.length; }
    return out;
  };
  for (const m of [...root.listMeshes()]) m.dispose();
  const mesh = doc.createMesh(NAME + '_mesh');
  const buffer = root.listBuffers()[0] || doc.createBuffer();
  const prim = doc.createPrimitive();
  for (const [sem, g] of groups) {
    prim.setAttribute(sem, doc.createAccessor().setType(g.n === 2 ? 'VEC2' : 'VEC3').setArray(cat(sem)).setBuffer(buffer));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idxAll)).setBuffer(buffer));
  mesh.addPrimitive(prim);
  const newNode = doc.createNode(NAME).setMesh(mesh);
  const scenes0 = root.listScenes();
  const mainScene = scenes0[0] || doc.createScene('Scene');
  mainScene.addChild(newNode);
  for (const s of scenes0.slice(1)) s.dispose();
  if (typeof root.setDefaultScene === 'function') root.setDefaultScene(mainScene);
  for (const n of [...root.listNodes()]) if (n !== newNode) n.dispose();
  for (const m of [...root.listMaterials()]) m.dispose();

  // ---- simplify to budget ----
  let tris = trisOf(root);
  console.log(`   ${NAME}: merged ${Math.round(tris)} tris`);
  let guard = 0;
  while (tris > BUDGET * 1.02 && guard < 10) {
    const ratio = Math.max(0.0005, Math.min(1, (BUDGET / tris) * 0.99));
    await doc.transform(simplify({ simplifier, ratio, error: 0.01 + 0.01 * guard, lockBorder: false }));
    const next = trisOf(root);
    console.log(`   simplify ${Math.round(tris)} -> ${Math.round(next)} (ratio ${ratio.toFixed(3)})`);
    if (next >= tris) break;
    tris = next;
    guard++;
  }

  // ---- ground-centre + optional uniform scale to a game height ----
  const pos = prim.getAttribute('POSITION');
  const a = pos.getArray();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxYv = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < a.length; i += 3) {
    minX = Math.min(minX, a[i]); maxX = Math.max(maxX, a[i]);
    minY = Math.min(minY, a[i + 1]); maxYv = Math.max(maxYv, a[i + 1]);
    minZ = Math.min(minZ, a[i + 2]); maxZ = Math.max(maxZ, a[i + 2]);
  }
  const rawHeight = maxYv - minY;
  const scale = HEIGHT ? HEIGHT / rawHeight : 1;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < a.length; i += 3) {
    a[i] = (a[i] - cx) * scale;
    a[i + 1] = (a[i + 1] - minY) * scale;
    a[i + 2] = (a[i + 2] - cz) * scale;
  }

  // ---- night-toned base colour material ----
  const jpeg = await sharp(TEX).resize(1024, 1024, { kernel: 'lanczos3' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const mat = doc.createMaterial(NAME + '_mat')
    .setBaseColorTexture(doc.createTexture(NAME + '_basecolor').setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'))
    .setRoughnessFactor(0.92).setMetallicFactor(0.0).setDoubleSided(true);
  prim.setMaterial(mat);

  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  await doc.transform(dedup(), prune({ keepAttributes: true }));

  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', NAME + '.glb.gz'), gz);
  const tris2 = Math.round(trisOf(root));
  const w = (maxX - minX) * scale, h = rawHeight * scale, d = (maxZ - minZ) * scale;
  console.log(`${NAME}: ${tris2} tris, 1 prim, ${(gz.length / 1024).toFixed(1)} KB gz ` +
    `(texture ${(jpeg.length / 1024).toFixed(0)} KB), size ${w.toFixed(2)} x ${h.toFixed(2)} x ${d.toFixed(2)}`);
  fs.writeFileSync(path.join(STAGE, NAME + '.json'), JSON.stringify({
    name: NAME, tris: tris2, bytes: gz.length, size: [+w.toFixed(2), +h.toFixed(2), +d.toFixed(2)],
  }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
