#!/usr/bin/env node
// Generic gltf-transform baker for single-GLB sources: weld + meshopt simplify to a
// triangle budget, then uniform-scale to a real-world height and move the origin to the
// ground centre (glTF Y-up: min.y = 0, bbox centre x/z = 0). Written for castle_tower,
// where Blender's Decimate stalls above the budget on a 1M-tri photogrammetry soup.
//   node scripts/bake/bake-simple-glb.mjs --name castle_tower --src <glb> --tris 14000 --height 9
import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  flatten, weld, simplify, prune, dedup, getBounds, transformMesh, join,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {MeshoptSimplifier} from '../custom-assets/node_modules/meshoptimizer/index.js';
import {SCRATCH, ensureDir, gzip9, triangleCount, mat4Scale, mat4Translate, mat4Mul, IDENTITY} from './bake-lib.mjs';

await MeshoptSimplifier.ready;
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const name = arg('--name');
const src = arg('--src');
const budget = Number(arg('--tris', '14000'));
const height = Number(arg('--height', '0'));
const texScale = Number(arg('--tex', '0')); // optional: extra uniform scale on x/z

const io = new NodeIO();
const doc = await io.read(src);
await doc.transform(flatten());
const scene = doc.getRoot().listScenes()[0];
const mats = new Set();
for (const node of doc.getRoot().listNodes()) {
  const m = node.getMesh();
  if (!m) continue;
  const matrix = node.getWorldMatrix();
  if (!matrix.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9)) transformMesh(m, matrix);
  node.setMatrix([...IDENTITY]);
}
const tris0 = triangleCount(doc);
// merge the source's split primitives FIRST (16-bit index chunks from the exporter), so that
// meshopt can simplify across the chunk borders instead of leaving cracks between them
await doc.transform(join({keepNamed: false}), weld(), prune());
const simplifier = {
  ...MeshoptSimplifier,
  simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']),
};
let tris = triangleCount(doc);
let guard = 0;
while (tris > budget && guard++ < 6) {
  const ratio = Math.max(0.001, Math.min(1, (budget / tris) * 0.99));
  await doc.transform(simplify({simplifier, ratio, error: 0.01 * guard, lockBorder: false}));
  const next = triangleCount(doc);
  console.log(`  simplify ${tris} -> ${next} (ratio ${ratio.toFixed(4)}, error ${0.01 * guard})`);
  if (next >= tris) break;
  tris = next;
}
// merge compatible primitives so the shipped asset is not 13 draw calls
await doc.transform(join({keepNamed: false}), weld(), dedup(), prune());
// scale + origin (glTF Y-up)
let b = getBounds(scene);
let scale = height > 0 ? height / (b.max[1] - b.min[1]) : 1;
if (texScale > 0) scale *= texScale;
const S = mat4Scale(scale, scale, scale);
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) transformMesh(node.getMesh(), S);
b = getBounds(scene);
const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
const T = mat4Translate(-cx, -b.min[1], -cz);
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) transformMesh(node.getMesh(), T);
b = getBounds(scene);
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  if (!p.getIndices()) throw new Error(name + ': unindexed primitive');
  if (!p.getAttribute('TEXCOORD_0')) throw new Error(name + ': primitive missing TEXCOORD_0');
}
for (const material of doc.getRoot().listMaterials()) mats.add(material.getName());
await doc.transform(dedup(), prune());
const bytes = await io.writeBinary(doc);
const out = path.join(SCRATCH, 'bake', name + '.glb');
ensureDir(path.dirname(out));
fs.writeFileSync(out, bytes);
console.log(JSON.stringify({
  name, sourceTris: tris0, tris: triangleCount(doc), bbox: {
    min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)),
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(3)),
  },
  images: doc.getRoot().listTextures().length, materials: [...mats].length,
  rawKB: +(bytes.length / 1024).toFixed(1), stage: out,
}));
