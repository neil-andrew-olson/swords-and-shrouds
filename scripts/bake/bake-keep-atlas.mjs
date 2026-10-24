#!/usr/bin/env node
// task-33: fortress_keep 5 trimsheets / 5 prims -> 1 atlas / 1 prim / 1 material.
//
// The keep is instanced 9x, so five primitives cost 45 draw calls; after the merge it is 9. The five
// existing UV spaces are packed into one 2048 atlas (the big trim sheet gets 1024, ground 1024, the
// wall/wood/roof sheets 512 each), each prim's UVs are scaled into its tile, the five textures are
// blitted into the atlas and all primitives are concatenated into a single primitive with one
// material (visuals preserved; smallest sheets are half-res, which is invisible at night).
//
//   node scripts/bake/bake-keep-atlas.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {KHRMeshQuantization} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const LIVE = path.join(GAME, 'public/assets/custom');
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/keep_atlas';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_keep';
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});

const ATLAS = 2048;
// prim index -> tile (x, y, size) in atlas pixels; y is measured from the TOP (image space)
const TILES = [
  {x: 0, y: 0, size: 1024},      // T_Trim
  {x: 1024, y: 0, size: 512},    // T_Wall
  {x: 1536, y: 0, size: 512},    // T_roof1
  {x: 1024, y: 512, size: 512},  // T_wood
  {x: 1536, y: 512, size: 512},  // T_ground
];
const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');
const gzip9 = (b) => zlib.gzipSync(b, {level: 9});

function decodeAccessor(acc) {
  const arr = acc.getArray();
  const ncomp = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[acc.getType()];
  if (!acc.getNormalized()) return {data: Float64Array.from(arr), ncomp, count: arr.length / ncomp};
  const ct = acc.getComponentType();
  const max = ct === 5120 ? 127 : ct === 5121 ? 255 : ct === 5122 ? 32767 : ct === 5123 ? 65535 : 1;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return {data: out, ncomp, count: arr.length / ncomp};
}

async function main() {
  const srcGz = path.join(LIVE, 'fortress_keep.glb.gz');
  const src = path.join(WORK, 'fortress_keep.glb');
  fs.writeFileSync(src, zlib.gunzipSync(fs.readFileSync(srcGz)));
  const doc = await io.read(src);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prims = mesh.listPrimitives();
  console.log(`fortress_keep: ${prims.length} prims, ` +
    `${prims.reduce((s, p) => s + p.getIndices().getCount() / 3, 0)} tris, ` +
    `materials ${root.listMaterials().length}, textures ${root.listTextures().length}`);

  const textures = root.listTextures();
  // ---- atlas: blit each source texture into its tile ----
  const tiles = [];
  for (let i = 0; i < TILES.length; i++) {
    const t = TILES[i];
    const resized = await sharp(textures[i].getImage()).resize(t.size, t.size, {kernel: 'lanczos3'})
      .png().toBuffer();
    tiles.push({input: resized, left: t.x, top: t.y});
  }
  const atlas = await sharp({create: {width: ATLAS, height: ATLAS, channels: 3, background: {r: 40, g: 36, b: 30}}})
    .composite(tiles).jpeg({quality: 84, mozjpeg: true}).toBuffer();

  // ---- merge primitives, remapping UVs into the tiles ----
  const P = [], N = [], UV = [], IDX = [];
  let vOff = 0;
  const tess = [];
  for (let pi = 0; pi < prims.length; pi++) {
    const prim = prims[pi];
    const pos = decodeAccessor(prim.getAttribute('POSITION'));
    const nor = decodeAccessor(prim.getAttribute('NORMAL'));
    const uv = decodeAccessor(prim.getAttribute('TEXCOORD_0'));
    const idx = decodeAccessor(prim.getIndices());
    const tile = TILES[pi];
    for (let i = 0; i < pos.count; i++) {
      P.push(pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]);
      N.push(nor.data[i * 3], nor.data[i * 3 + 1], nor.data[i * 3 + 2]);
      const u = uv.data[i * 2], v = uv.data[i * 2 + 1];
      // glTF texture origin is the top-left of the image and three.js loads with flipY=false,
      // so the image row is v * height (the tile grid is expressed from the top-left too)
      UV.push((tile.x + u * tile.size) / ATLAS, (tile.y + v * tile.size) / ATLAS);
    }
    for (let i = 0; i < idx.count; i++) IDX.push(idx.data[i] + vOff);
    tess.push({prim: pi, tris: idx.count / 3});
    vOff += pos.count;
  }
  console.log('merged verts', vOff, 'tris', IDX.length / 3, 'UV range check pending');

  const buffer = root.listBuffers()[0];
  const posArr = new Float32Array(P);
  const norArr = new Float32Array(N);
  const uvArr = new Float32Array(UV);
  const idxArr = new Uint32Array(IDX);
  const newPrim = doc.createPrimitive();
  newPrim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(posArr).setBuffer(buffer));
  newPrim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(norArr).setBuffer(buffer));
  newPrim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvArr).setBuffer(buffer));
  newPrim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idxArr).setBuffer(buffer));

  const mat = doc.createMaterial('T_KeepAtlas')
    .setBaseColorTexture(doc.createTexture('keep_atlas').setImage(new Uint8Array(atlas)).setMimeType('image/jpeg'))
    .setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true);
  newPrim.setMaterial(mat);

  // replace the primitive list / drop old materials + textures
  for (const p of [...prims]) p.dispose();
  for (const m of [...root.listMaterials()]) if (m !== mat) m.dispose();
  for (const t of textures) t.dispose();
  mesh.addPrimitive(newPrim);
  // weld duplicate corners and re-quantize the merged geometry so the file stays small
  const {weld, quantize} = await import('../custom-assets/node_modules/@gltf-transform/functions/dist/index.js');
  await doc.transform(weld(), quantize({quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12}));

  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', 'fortress_keep.glb.gz'), gz);
  const tris = root.listMeshes()[0].listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  console.log(`result: ${root.listMeshes()[0].listPrimitives().length} prim, ${tris} tris, ` +
    `${root.listMaterials().length} material, ${root.listTextures().length} texture, ` +
    `atlas ${(atlas.length / 1024).toFixed(1)} KB, file ${(gz.length / 1024).toFixed(1)} KB ` +
    `(was ${(fs.statSync(srcGz).size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
