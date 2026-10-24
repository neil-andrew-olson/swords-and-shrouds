#!/usr/bin/env node
// Audit every shipped custom GLB: gzip size, triangles, primitives, embedded image
// dimensions/formats/bytes, texture slots, skins/animations. Used to plan the batch-3
// payload slimming pass and to produce before/after tables.
//   node scripts/bake/audit-assets.mjs [--json] [--dir <custom dir>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {listTextureSlots} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const CUSTOM = dirArg ? path.resolve(dirArg) : path.join(GAME, 'public/assets/custom');

// the client's initial preload set: WEAPON_IDS + shield + the nine character assets
const PRELOAD = ['rapier', 'halberd', 'dane_axe', 'flamberge', 'mace', 'sword', 'bastard', 'hammer', 'poleaxe', 'zweihander',
  'shield', 'hero', 'ally', 'fallen', 'berserker', 'ranger', 'templar', 'survivor', 'skeleton-soldier', 'zombie'];

const io = new NodeIO();
const rows = [];
for (const file of fs.readdirSync(CUSTOM).filter((f) => f.endsWith('.glb.gz')).sort()) {
  const name = file.replace('.glb.gz', '');
  const gz = fs.statSync(path.join(CUSTOM, file)).size;
  let row = {name, gz, preload: PRELOAD.includes(name)};
  try {
    const bytes = zlib.gunzipSync(fs.readFileSync(path.join(CUSTOM, file)));
    const doc = await io.readBinary(new Uint8Array(bytes));
    const root = doc.getRoot();
    let tris = 0, prims = 0;
    const attrs = new Set();
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      prims++;
      if (p.getIndices()) tris += p.getIndices().getCount() / 3;
      for (const sem of p.listSemantics()) attrs.add(sem);
    }
    const slots = listTextureSlots(doc);
    const images = [];
    let imageBytes = 0;
    for (const texture of root.listTextures()) {
      const b = texture.getImage();
      imageBytes += b ? b.byteLength : 0;
      let dims = '?';
      try {
        const meta = await sharp(b).metadata();
        dims = `${meta.width}x${meta.height}:${meta.format}`;
      } catch { /* ignore */ }
      images.push({dims, kb: +((b?.byteLength ?? 0) / 1024).toFixed(1)});
    }
    row = {
      ...row, rawKB: +(bytes.length / 1024).toFixed(1), tris: Math.round(tris), prims,
      nodes: root.listNodes().length, anims: root.listAnimations().length,
      skins: root.listSkins().length, imageCount: images.length, imageKB: +(imageBytes / 1024).toFixed(1),
      images, slots: slots.map((s) => s.split(':')[0]).slice(0, 8), attrs: [...attrs].sort().join(','),
    };
  } catch (e) {
    row.error = String(e);
  }
  rows.push(row);
}
const totalGz = rows.reduce((s, r) => s + r.gz, 0);
const preloadGz = rows.filter((r) => r.preload).reduce((s, r) => s + r.gz, 0);
const restGz = totalGz - preloadGz;
if (args.includes('--json')) {
  console.log(JSON.stringify({totals: {totalGz, preloadGz, restGz}, rows}, null, 1));
} else {
  console.log('name'.padEnd(16), 'gzKB'.padStart(8), 'tris'.padStart(7), 'prims'.padStart(6), 'anims'.padStart(5),
    'skins'.padStart(5), 'imgs'.padStart(5), 'imgKB'.padStart(8), 'preload', 'image detail');
  for (const r of rows.sort((a, b) => b.gz - a.gz)) {
    console.log(String(r.name).padEnd(16), (r.gz / 1024).toFixed(1).padStart(8), String(r.tris ?? '').padStart(7),
      String(r.prims ?? '').padStart(6), String(r.anims ?? '').padStart(5), String(r.skins ?? '').padStart(5),
      String(r.imageCount ?? '').padStart(5), String(r.imageKB ?? '').padStart(8),
      (r.preload ? 'YES' : '').padEnd(7),
      (r.images || []).map((i) => `${i.dims}@${i.kb}KB`).join(' '));
  }
  console.log('');
  console.log(`files=${rows.length} total=${(totalGz / 1048576).toFixed(2)} MB  preload=${(preloadGz / 1048576).toFixed(2)} MB  ` +
    `streamed=${(restGz / 1048576).toFixed(2)} MB`);
}
