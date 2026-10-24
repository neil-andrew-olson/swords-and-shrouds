#!/usr/bin/env node
// Bake castle_tower_lod.glb.gz (AAA cycle 1 follow-up): decimate the current shipped
// castle_tower (13,854 tris, 1 prim, 512 px texture) to <=4,000 tris for the 18 castle-corner
// tower instances. Geometry is the only thing touched — the 512 px base-colour texture and the
// material are carried over byte-identically, and no re-origin/re-scale happens, so a distance
// swap at the same instance matrix cannot move the tower.
//   node scripts/bake/bake-castle-tower-lod.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  dequantize, simplify, prune, dedup, quantize,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {MeshoptSimplifier} from '../custom-assets/node_modules/meshoptimizer/index.js';
import {
  KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR,
} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const LIVE = path.join(GAME, 'public/assets/custom');
const SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab';
const STAGE = path.join(SCRATCH, 'optimized_lod');
const STAGE_CUSTOM = path.join(STAGE, 'custom');
const NAME = 'castle_tower_lod';
const SRC = path.join(LIVE, 'castle_tower.glb.gz');
const MAX_TRIS = 4000;
const MAX_GZ = 200 * 1024;

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions([KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR]);
const simplifier = {
  ...MeshoptSimplifier,
  simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']),
};

function renderedTris(root) {
  let tris = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? 0) / 3;
  }
  return tris;
}

const originalGz = fs.statSync(SRC).size;
const doc = await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(SRC))));
const root = doc.getRoot();
const notes = [];
for (const mat of root.listMaterials()) {
  for (const ext of ['KHR_materials_ior', 'KHR_materials_specular']) if (mat.getExtension(ext)) mat.setExtension(ext, null);
}

await doc.transform(dequantize());
const before = renderedTris(root);
let tris = before;
let guard = 0;
while (tris > MAX_TRIS && guard++ < 6) {
  const ratio = Math.max(0.001, Math.min(1, (MAX_TRIS / tris) * 0.99));
  await doc.transform(simplify({simplifier, ratio, error: 0.01 + 0.01 * guard, lockBorder: false}));
  const next = renderedTris(root);
  notes.push(`simplify ${Math.round(tris)}->${Math.round(next)} (ratio ${ratio.toFixed(3)})`);
  if (next >= tris) break;
  tris = next;
}
// re-quantise exactly like the full asset (KHR_mesh_quantization) to keep geometry bytes low
try {
  await doc.transform(quantize({pattern: /^(?!JOINTS_|WEIGHTS_).*$/}));
  notes.push('quantized attributes (KHR_mesh_quantization)');
} catch (e) { notes.push('quantize skipped: ' + e.message); }
await doc.transform(dedup(), prune({keepAttributes: true}));

for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  if (!prim.getIndices()) throw new Error(NAME + ': unindexed primitive');
  if (!prim.getAttribute('TEXCOORD_0')) throw new Error(NAME + ': primitive missing TEXCOORD_0');
}
const bytes = await io.writeBinary(doc);
const gz = zlib.gzipSync(bytes, {level: 9});
fs.mkdirSync(STAGE_CUSTOM, {recursive: true});
fs.writeFileSync(path.join(STAGE_CUSTOM, NAME + '.glb.gz'), gz);
const prims = root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
const imageKB = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength || 0), 0) / 1024;
console.log(`${NAME.padEnd(17)} ${(originalGz / 1024).toFixed(1).padStart(7)} KB full -> ${(gz.length / 1024).toFixed(1).padStart(6)} KB LOD  ` +
  `tris=${Math.round(renderedTris(root))} prims=${prims} materials=${root.listMaterials().length} images=${root.listTextures().length}(${imageKB.toFixed(1)}KB)`);
console.log('notes:', notes.join('; '));
console.log('extensionsUsed:', root.listExtensionsUsed().map((e) => e.extensionName));
if (gz.length > MAX_GZ) { console.error(`OVER 200 KB BUDGET: ${(gz.length / 1024).toFixed(1)} KB`); process.exitCode = 1; }
fs.writeFileSync(path.join(STAGE, 'manifest-castle-tower-lod.json'), JSON.stringify({name: NAME, originalGz, gz: gz.length, tris: Math.round(renderedTris(root)), prims, notes}, null, 1));
