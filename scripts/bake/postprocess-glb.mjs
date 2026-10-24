#!/usr/bin/env node
// Post-process a staged GLB from temp_sketchlab/bake into a shippable .glb.gz:
//   resize/re-encode embedded textures (sharp), enforce indexed primitives + TEXCOORD_0,
//   drop skins/animations, gzip level 9, then optionally install into public/assets/custom.
//   node scripts/bake/postprocess-glb.mjs [--only rapier,halberd] [--no-install] [--tex 1024]
import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  textureCompress, prune, dedup, getBounds,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';
import {SCRATCH, OUT_DIR, gzip9, ensureDir, triangleCount, primitiveCounts} from './bake-lib.mjs';

// per-asset texture settings; everything ships as embedded JPEG except alpha-tested foliage
const CONFIG = {
  rapier: {tex: 1024},
  halberd: {tex: 1024},
  dane_axe: {tex: 1024},
  chapel_ruin: {tex: 1024},
  aqueduct_ruin: {tex: 1024},
  bridge_ruin: {tex: 1024},
  courtyard_ruin: {tex: 1024},
  fortress_keep: {tex: 1024},
  castle_tower: {tex: 1024},
  well: {tex: 1024},
  chest: {tex: 1024},
  bench: {tex: 512},
  grass_tuft: {tex: 512, alpha: true},
  rock_cluster: {tex: 1024},
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const install = !args.includes('--no-install');
const texOverride = args.includes('--tex') ? Number(args[args.indexOf('--tex') + 1]) : null;

const io = new NodeIO();
ensureDir(OUT_DIR);
ensureDir(path.join(SCRATCH, 'bake'));

for (const [name, cfg] of Object.entries(CONFIG)) {
  if (only && !only.includes(name)) continue;
  const stage = path.join(SCRATCH, 'bake', name + '.glb');
  if (!fs.existsSync(stage)) { console.log(`SKIP ${name}: no staged GLB`); continue; }
  const doc = await io.read(stage);
  const tex = texOverride ?? cfg.tex;
  const size = [tex, tex];

  // Non-alpha assets are opaque solids/ruins: force OPAQUE so colour maps can become JPEG
  // (a leftover BLEND/MASK flag from an FBX import otherwise blocks conversion).
  if (!cfg.alpha) {
    for (const mat of doc.getRoot().listMaterials()) mat.setAlphaMode('OPAQUE').setAlphaCutoff(null);
  } else {
    for (const mat of doc.getRoot().listMaterials()) mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  }

  // colour: JPEG (or PNG when alpha is needed for alpha-tested foliage)
  await doc.transform(textureCompress({
    encoder: sharp, targetFormat: cfg.alpha ? 'png' : 'jpeg', resize: size,
    slots: /baseColorTexture|emissiveTexture/, quality: 88,
  }));
  // normals: JPEG q92 (visually lossless for these flat stone/steel surfaces)
  await doc.transform(textureCompress({
    encoder: sharp, targetFormat: 'jpeg', resize: size, slots: /normalTexture/, quality: 92,
  }));
  // metallicRoughness / occlusion: JPEG q85
  await doc.transform(textureCompress({
    encoder: sharp, targetFormat: 'jpeg', resize: size,
    slots: /metallicRoughnessTexture|occlusionTexture/, quality: 85,
  }));
  await doc.transform(dedup(), prune());

  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const s of doc.getRoot().listSkins()) s.dispose();
  let fixed = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (!prim.getAttribute('TEXCOORD_0')) throw new Error(`${name}: primitive lost TEXCOORD_0`);
    if (!prim.getIndices()) throw new Error(`${name}: primitive lost indices`);
    fixed++;
  }
  const counts = primitiveCounts(doc);
  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  if (install) fs.writeFileSync(path.join(OUT_DIR, name + '.glb.gz'), gz);
  const b = getBounds(doc.getRoot().listScenes()[0] ?? doc.getRoot().listNodes()[0]);
  const size3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  console.log(JSON.stringify({
    name, tris: counts.tris, prims: counts.prims, images: doc.getRoot().listTextures().length,
    rawKB: +(bytes.length / 1024).toFixed(1), gzipKB: +(gz.length / 1024).toFixed(1),
    bbox: {min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)), size: size3.map((v) => +v.toFixed(3))},
    installed: install,
  }));
}
