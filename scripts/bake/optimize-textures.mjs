#!/usr/bin/env node
// Batch 2026-10C — slim the scanned terrain textures (asset-forge).
// Keeps filenames identical (terrain-surfaces.ts contract): normals -> 512 PNG, the 1024 ground
// detail PNGs -> 512 PNG. Base colour JPEGs are already inside budget and are left untouched.
// Staged in temp_sketchlab/optimized/textures for the atomic install.
import fs from 'node:fs';
import path from 'node:path';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const TEX = path.join(GAME, 'public/assets/textures');
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized/textures';
fs.mkdirSync(STAGE, {recursive: true});

const JOBS = [
  // name, max dimension, output format
  ['road_country_normal.png', 512, 'png'],
  ['cobblestone_normal.png', 512, 'png'],
  ['texture_ground_mud_grass.png', 512, 'png'],
  ['texture_ground_cobblestone.png', 512, 'png'],
];

const rows = [];
for (const [name, maxDim, format] of JOBS) {
  const src = path.join(TEX, name);
  const before = fs.statSync(src).size;
  const meta = await sharp(src).metadata();
  let pipe = sharp(src);
  if (Math.max(meta.width, meta.height) > maxDim) pipe = pipe.resize(maxDim, maxDim, {fit: 'inside', kernel: 'lanczos3'});
  // normals / detail maps: PNG (lossless gradients, no JPEG ringing); base colour: keep JPEG
  const out = format === 'png'
    ? await pipe.png({compressionLevel: 9, effort: 10, adaptiveFiltering: true}).toBuffer()
    : await pipe.jpeg({quality: 88, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  fs.writeFileSync(path.join(STAGE, name), out);
  const after = out.length;
  rows.push({name, before, after, dims: `${meta.width}x${meta.height} -> ${maxDim}`});
  console.log(`${name.padEnd(32)} ${(before / 1024).toFixed(1).padStart(8)} KB -> ${(after / 1024).toFixed(1).padStart(8)} KB  (${meta.width}x${meta.height} -> ${maxDim})`);
}
const before = rows.reduce((s, r) => s + r.before, 0);
const after = rows.reduce((s, r) => s + r.after, 0);
fs.writeFileSync(path.join(STAGE, '..', 'textures-manifest.json'), JSON.stringify({before, after, rows}, null, 1));
console.log(`\ntextures: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB`);
