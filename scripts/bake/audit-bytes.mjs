#!/usr/bin/env node
// Detailed byte breakdown for selected GLBs: geometry attributes / indices / animation data /
// image bytes, so the batch-3 slimming pass can target the real payload drivers.
//   node scripts/bake/audit-bytes.mjs <name> [name...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const CUSTOM = path.join(GAME, 'public/assets/custom');
const io = new NodeIO();
for (const name of process.argv.slice(2)) {
  const file = path.join(CUSTOM, name + '.glb.gz');
  const bytes = zlib.gunzipSync(fs.readFileSync(file));
  const gz = fs.statSync(file).size;
  let doc;
  try {
    doc = await io.readBinary(new Uint8Array(bytes));
  } catch (e) {
    console.log(`${name}: READ FAILED ${e.message}`);
    continue;
  }
  const root = doc.getRoot();
  const byAccessor = new Map();
  for (const a of root.listAccessors()) {
    const n = a.getCount();
    const comp = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16}[a.getType()] || 1;
    const bytesPer = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a.getComponentType()] || 4;
    byAccessor.set(a, n * comp * bytesPer);
  }
  const attrBytes = {};
  let idxBytes = 0, animBytes = 0, imageBytes = 0, morphBytes = 0;
  const attrs = new Set();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    for (const sem of p.listSemantics()) {
      attrs.add(sem);
      const a = p.getAttribute(sem);
      if (a) attrBytes[sem] = (attrBytes[sem] || 0) + (byAccessor.get(a) || 0);
    }
    if (p.getIndices()) idxBytes += byAccessor.get(p.getIndices()) || 0;
  }
  for (const anim of root.listAnimations()) for (const s of anim.listSamplers()) {
    if (s.getInput()) animBytes += byAccessor.get(s.getInput()) || 0;
    if (s.getOutput()) animBytes += byAccessor.get(s.getOutput()) || 0;
  }
  for (const t of root.listTextures()) imageBytes += t.getImage()?.byteLength || 0;
  const kb = (v) => +(v / 1024).toFixed(1);
  console.log(`\n${name}: gz=${kb(gz)}KB raw=${kb(bytes.length)}KB prims=${root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0)} ` +
    `anims=${root.listAnimations().length} skins=${root.listSkins().length} nodes=${root.listNodes().length}`);
  console.log(`  attrs: ${[...attrs].join(',')}`);
  console.log(`  geometry: ${Object.entries(attrBytes).map(([k, v]) => `${k}=${kb(v)}`).join(' ')} indices=${kb(idxBytes)}`);
  console.log(`  animation=${kb(animBytes)}KB image=${kb(imageBytes)}KB`);
  const materials = root.listMaterials().map((m) => ({
    name: m.getName(),
    base: m.getBaseColorTexture() ? 'tex' : m.getBaseColorFactor().map((v) => v.toFixed(2)).join('/'),
    normal: m.getNormalTexture() ? 'tex' : '-',
    mr: m.getMetallicRoughnessTexture() ? 'tex' : `${m.getMetallicFactor().toFixed(2)}/${m.getRoughnessFactor().toFixed(2)}`,
    occlusion: m.getOcclusionTexture() ? 'tex' : '-',
    emissive: m.getEmissiveTexture() ? 'tex' : m.getEmissiveFactor().join('/'),
  }));
  console.log('  materials:', JSON.stringify(materials));
}
