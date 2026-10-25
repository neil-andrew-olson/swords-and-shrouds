#!/usr/bin/env node
// Cycle 16: body-scan BASE-atlas tone pass. Tones only the body primitive's basecolour atlas
// (arms / legs / torso skin + underlayer) — warm + desaturate + slight value floor and a gentle
// overall value reduction so the pale limbs stop fighting the v5.1 steel/leather armour atlas.
//
// The armour atlas textures are left byte-identical (verified by hashing every other texture), and
// geometry / skin / clips are not touched (indices, positions and animation hashes verified).
//
//   node scripts/bake/tone-body-atlas.mjs [--only hero,templar] [--desat 0.78] [--warm 1.06]
//        [--value 0.93] [--floor 0.035]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {KHRMeshQuantization} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const LIVE = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build/public/assets/custom';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_bodytone';
const BODIES = ['templar', 'hero', 'ally', 'berserker', 'ranger', 'survivor', 'fallen'];
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const DESAT = arg('--desat', 0.78);
const WARM = arg('--warm', 1.06);
const WARM_B = arg('--warmB', 0.88);
const VALUE = arg('--value', 0.93);
const FLOOR = arg('--floor', 0.035);

const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');

async function toneImage(buf) {
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // desaturate toward luminance
    r = lum + (r - lum) * DESAT;
    g = lum + (g - lum) * DESAT;
    b = lum + (b - lum) * DESAT;
    // warm shift (skin / leather undertone instead of cold stone)
    r *= WARM; g *= 1.0; b *= WARM_B;
    // slight value floor (keeps folds/detail in shadows) then a gentle overall value reduction
    const apply = (c) => Math.max(0, Math.min(1, FLOOR + (1 - FLOOR) * c * VALUE));
    out[i] = Math.round(apply(r) * 255);
    out[i + 1] = Math.round(apply(g) * 255);
    out[i + 2] = Math.round(apply(b) * 255);
  }
  return sharp(out, {raw: {width: info.width, height: info.height, channels: 3}})
    .jpeg({quality: 88, mozjpeg: true}).toBuffer();
}

async function toneBody(name) {
  const src = path.join(LIVE, name + '.glb.gz');
  const raw = zlib.gunzipSync(fs.readFileSync(src));
  const doc = await io.readBinary(new Uint8Array(raw));
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const bodyPrim = mesh.listPrimitives()[0];
  const bodyMat = bodyPrim.getMaterial();
  const bodyTex = bodyMat.getBaseColorTexture();
  if (!bodyTex) throw new Error(name + ': body material has no baseColor texture');

  // fingerprint everything that must not change
  const idxHash = sha(bodyPrim.getIndices().getArray().buffer);
  const posHash = sha(bodyPrim.getAttribute('POSITION').getArray().buffer);
  const animHash = sha(Buffer.concat(root.listAnimations().flatMap((a) => a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)]))));
  const otherTexHashes = root.listTextures().filter((t) => t !== bodyTex).map((t) => sha(t.getImage()));
  const primCount = mesh.listPrimitives().length;
  const skinCount = root.listSkins().length;
  const bodyImage = Buffer.from(bodyTex.getImage());

  const toned = await toneImage(bodyImage);
  bodyTex.setImage(new Uint8Array(toned)).setMimeType('image/jpeg');

  const bytes = await io.writeBinary(doc);
  const gz = zlib.gzipSync(Buffer.from(bytes), {level: 9});
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);

  // re-read the written file and verify integrity
  const doc2 = await io.readBinary(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(STAGE, 'custom', name + '.glb.gz')))));
  const root2 = doc2.getRoot();
  const mesh2 = root2.listMeshes()[0];
  const bp2 = mesh2.listPrimitives()[0];
  const idx2 = sha(bp2.getIndices().getArray().buffer);
  const pos2 = sha(bp2.getAttribute('POSITION').getArray().buffer);
  const anim2 = sha(Buffer.concat(root2.listAnimations().flatMap((a) => a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)]))));
  const otherTex2 = root2.listTextures().filter((t) => t !== bp2.getMaterial().getBaseColorTexture()).map((t) => sha(t.getImage()));
  const ok = idxHash === idx2 && posHash === pos2 && animHash === anim2 &&
    root2.listSkins().length === skinCount && mesh2.listPrimitives().length === primCount &&
    JSON.stringify(otherTexHashes) === JSON.stringify(otherTex2);

  const size = gz.length;
  const kb = (size / 1024).toFixed(1);
  console.log(`${name.padEnd(10)} body atlas ${bodyImage.length / 1024 | 0} KB -> ${toned.length / 1024 | 0} KB | ` +
    `file ${kb} KB | prims ${primCount} skins ${skinCount} | armour tex untouched=${ok}`);
  return {name, kb: size, ok, primCount, skinCount};
}

const rows = [];
for (const name of BODIES) {
  if (only && !only.includes(name)) continue;
  rows.push(await toneBody(name));
}
fs.writeFileSync(path.join(STAGE, 'manifest-bodytone.json'), JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => !r.ok);
if (bad.length) { console.error('INTEGRITY FAILURES:', bad); process.exitCode = 1; }
console.log('staged:', rows.map((r) => `${r.name} ${(r.kb / 1024).toFixed(1)}KB`).join(', '));
