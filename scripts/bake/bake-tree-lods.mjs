#!/usr/bin/env node
// Bake the tree LOD assets for AAA cycle 1 (task-29):
//   pine_lod.glb.gz / oak_lod.glb.gz  <= 2,500 rendered tris, 1-2 prims, 256 px textures,
//   same coordinates + scale + origin convention as the full pine/oak assets (so world-scene can
//   swap them at distance without moving the instance), alpha-tested foliage preserved.
//
// Source = the current shipped pine.glb.gz / oak.glb.gz (batch-3 flattened + quantised assets);
// the LOD is dequantised, trimmed to foliage+bark (pine's ground-cover disc + grass cards are
// dropped — invisible at 60-90 m), meshopt-simplified, texture-shrunk to 256, then written to
// temp_sketchlab/optimized_lod/custom for the validate -> atomic-install step.
//
//   node scripts/bake/bake-tree-lods.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  dequantize, simplify, join, prune, dedup,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {MeshoptSimplifier} from '../custom-assets/node_modules/meshoptimizer/index.js';
import {
  KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR, KHRMaterialsEmissiveStrength,
} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const LIVE = path.join(GAME, 'public/assets/custom');
const SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab';
const STAGE = path.join(SCRATCH, 'optimized_lod');
const STAGE_CUSTOM = path.join(STAGE, 'custom');
const MAX_TRIS = 2500;
const MAX_GZ = 150 * 1024;

// Only KHR_mesh_quantization is registered: the full oak asset's optional specular/ior layers are
// dropped on read (glTF-Transform warns and discards unregistered optional extensions), so the LOD
// ships as plain metal/rough with no stale extension declarations.
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const simplifier = {
  ...MeshoptSimplifier,
  simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']),
};

function countTris(root) {
  let rendered = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) rendered += (prim.getIndices()?.getCount() ?? 0) / 3;
  }
  return rendered;
}

async function resizeTexture(tex, maxDim, quality, alpha) {
  const src = Buffer.from(tex.getImage());
  const meta = await sharp(src).metadata();
  let pipe = sharp(src);
  if (Math.max(meta.width ?? 0, meta.height ?? 0) > maxDim) {
    pipe = pipe.resize(maxDim, maxDim, {fit: 'inside', kernel: 'lanczos3'});
  }
  const out = alpha
    ? await pipe.png({compressionLevel: 9, effort: 10, palette: true, colours: 256}).toBuffer()
    : await pipe.flatten({background: '#000000'}).jpeg({quality, mozjpeg: true}).toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType(alpha ? 'image/png' : 'image/jpeg');
  return `${meta.width}x${meta.height} -> ${alpha ? 'png' : 'jpeg'} ${(out.length / 1024).toFixed(1)}KB`;
}

const CONFIG = {
  pine_lod: {
    src: path.join(LIVE, 'pine.glb.gz'),
    dropMaterials: ['Groundcover_Wood_Mix', 'grass'],
    base: 256, quality: 80,
    alphaFor: [],                      // pine leaf cards are opaque in the source (JPEG, no alpha)
    forceMask: [],                     // keep the same OPAQUE cards as the full asset
    jpegFor: [],                       // all base colour maps -> jpeg
    doubleSided: [],
  },
  oak_lod: {
    src: path.join(LIVE, 'oak.glb.gz'),
    dropMaterials: [],
    base: 256, quality: 80,
    alphaFor: ['branches_projection'], // oak leaf atlas has real alpha -> keep PNG + MASK
    forceMask: ['branches_projection'],// BLEND -> MASK (alpha-tested, cheaper + no sort pops)
    jpegFor: [],
    doubleSided: ['branches_projection', 'bark'],
  },
};

const report = [];
for (const [name, cfg] of Object.entries(CONFIG)) {
  const originalGz = fs.statSync(cfg.src).size;
  const doc = await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(cfg.src))));
  const root = doc.getRoot();
  const notes = [];

  await doc.transform(dequantize());
  // strip subtle extension layers inherited from the full asset
  for (const mat of root.listMaterials()) {
    for (const ext of ['KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_emissive_strength']) {
      if (mat.getExtension(ext)) mat.setExtension(ext, null);
    }
  }

  // drop helper prims (pine ground-cover disc + grass cards are invisible at LOD distance)
  const droppedMats = new Set();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat && cfg.dropMaterials.includes(mat.getName())) droppedMats.add(mat.getName());
    }
    const keep = mesh.listPrimitives().filter((p) => !(p.getMaterial() && cfg.dropMaterials.includes(p.getMaterial().getName())));
    // dispose dropped prims by removing the mesh's unused primitives
    for (const prim of mesh.listPrimitives()) {
      if (!keep.includes(prim)) prim.dispose();
    }
  }
  for (const m of [...root.listMeshes()]) if (!m.listPrimitives().length) m.dispose();
  for (const n of [...root.listNodes()]) if (!n.getMesh() && !n.listChildren().length) n.dispose();
  if (droppedMats.size) notes.push(`dropped ${[...droppedMats].join('/')} prim(s)`);

  await doc.transform(join({keepNamed: false}), prune({keepAttributes: true}));
  const before = countTris(root);
  let tris = before;
  let guard = 0;
  while (tris > MAX_TRIS && guard++ < 6) {
    const ratio = Math.max(0.001, Math.min(1, (MAX_TRIS / tris) * 0.99));
    await doc.transform(simplify({simplifier, ratio, error: 0.01 + 0.01 * guard, lockBorder: false}));
    const next = countTris(root);
    notes.push(`simplify ${Math.round(tris)}->${Math.round(next)} (ratio ${ratio.toFixed(3)})`);
    if (next >= tris) break;
    tris = next;
  }

  // material / texture pass: 256 px, alpha-tested foliage preserved
  for (const mat of root.listMaterials()) {
    const isAlpha = cfg.alphaFor.includes(mat.getName());
    if (isAlpha) { mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.5); }
    if (cfg.doubleSided.includes(mat.getName())) mat.setDoubleSided(true);
    const tex = mat.getBaseColorTexture();
    if (tex) notes.push(`tex ${mat.getName()}: ${await resizeTexture(tex, cfg.base, cfg.quality, isAlpha)}`);
    // LODs are viewed at distance: flat-ish matte response matches the night look
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(0.85);
  }
  await doc.transform(dedup(), prune({keepAttributes: true}));

  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (!prim.getIndices()) throw new Error(name + ': unindexed primitive');
    if (!prim.getAttribute('TEXCOORD_0')) throw new Error(name + ': primitive missing TEXCOORD_0');
  }
  const bytes = await io.writeBinary(doc);
  const gz = zlib.gzipSync(bytes, {level: 9});
  fs.mkdirSync(STAGE_CUSTOM, {recursive: true});
  fs.writeFileSync(path.join(STAGE_CUSTOM, name + '.glb.gz'), gz);
  const prims = root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
  const imageKB = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength || 0), 0) / 1024;
  report.push({
    name, originalGz, gz: gz.length, tris: Math.round(countTris(root)),
    prims, images: root.listTextures().length, imageKB: +imageKB.toFixed(1),
    materials: root.listMaterials().map((m) => `${m.getName()}:${m.getAlphaMode()}`),
    notes,
  });
  console.log(`${name.padEnd(10)} ${(originalGz / 1024).toFixed(1).padStart(7)} KB full -> ${(gz.length / 1024).toFixed(1).padStart(6)} KB LOD  ` +
    `tris=${Math.round(countTris(root))} prims=${prims} images=${root.listTextures().length}(${imageKB.toFixed(1)}KB) ${notes.join('; ')}`);
  if (gz.length > MAX_GZ) console.error(`  OVER 150 KB BUDGET: ${(gz.length / 1024).toFixed(1)} KB`);
}
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(report, null, 1));
console.log(`\nstaged ${report.length} LODs -> ${STAGE_CUSTOM}`);
