#!/usr/bin/env node
// Cycle-2 Phase A: replace the 7 character materials with a richer map set (albedo + normal +
// packed ORM/roughness/metalness/AO). Geometry, skins, clips and UVs are NOT touched: the live
// cycle-1 GLBs already carry the repaired UV layout, so this only adds textures and rewrites the
// material block (hash-verified below).
//
//   node scripts/bake/bake-character-maps.mjs [--only hero,templar]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const LIVE = path.join(GAME, 'public/assets/custom');
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/atlas2';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_atlas2';
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const SCRIPT = path.join(GAME, 'scripts/bake/bake-character-maps.py');
const CHARS = ['hero', 'templar', 'ally', 'berserker', 'ranger', 'survivor', 'fallen'];
const BUDGET = 700 * 1024;
const io = new NodeIO();

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const FORCE = process.argv.includes('--force');
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});

const sha = (buf) => createHash('sha1').update(Buffer.from(buf)).digest('hex');
const gzip9 = (buf) => zlib.gzipSync(buf, {level: 9});

function accessorHash(acc) {
  const arr = acc.getArray();
  if (!arr) return 'none';
  return sha(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)) + ':' + arr.length;
}

/** linear 0..1 -> sRGB 0..1 LUT */
const SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  SRGB[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
}

async function readRaw(png) {
  const meta = await sharp(png).metadata();
  const raw = await sharp(png).removeAlpha().raw().toBuffer();
  return {width: meta.width, height: meta.height, channels: 3, data: raw};
}

async function composeTextures(name, opts) {
  const {albedoDim, albedoQ, normalDim, normalQ, ormDim, ormQ, tone = 0.82} = opts;
  const alb = await readRaw(path.join(WORK, `${name}_albedo_linear.png`));
  // ---- albedo: linear -> sRGB, night tone multiplier, downscale ----
  const lin = alb.data;
  const srgb = Buffer.alloc(lin.length);
  for (let i = 0; i < lin.length; i++) srgb[i] = Math.max(0, Math.min(255, Math.round(SRGB[lin[i]] * tone)));
  const albedoJpeg = await sharp(srgb, {raw: {width: alb.width, height: alb.height, channels: 3}})
    .resize(albedoDim, albedoDim, {kernel: 'lanczos3'}).jpeg({quality: albedoQ, mozjpeg: true}).toBuffer();
  // ---- normal (attenuate the baked relief so close-ups read as armour, not hammered clay) ----
  const nrm = await readRaw(path.join(WORK, `${name}_normal.png`));
  const strength = opts.normalStrength ?? 0.62;
  const nd = Buffer.alloc(nrm.data.length);
  for (let i = 0; i < nrm.data.length; i += 3) {
    const x = (nrm.data[i] / 255 - 0.5) * strength + 0.5;
    const y = (nrm.data[i + 1] / 255 - 0.5) * strength + 0.5;
    nd[i] = Math.max(0, Math.min(255, Math.round(x * 255)));
    nd[i + 1] = Math.max(0, Math.min(255, Math.round(y * 255)));
    nd[i + 2] = nrm.data[i + 2];
  }
  const normalJpeg = await sharp(nd, {raw: {width: nrm.width, height: nrm.height, channels: 3}})
    .resize(normalDim, normalDim, {kernel: 'lanczos3'}).jpeg({quality: normalQ, mozjpeg: true}).toBuffer();
  // ---- ORM: R = softened AO, G = roughness, B = metallic ----
  const ao = await readRaw(path.join(WORK, `${name}_ao.png`));
  const rough = await readRaw(path.join(WORK, `${name}_roughness.png`));
  const metal = await readRaw(path.join(WORK, `${name}_metallic.png`));
  const orm = Buffer.alloc(ao.data.length);
  for (let i = 0; i < ao.data.length; i += 3) {
    // soften AO so the indirect term never crushes the body to black at night
    const aoSoft = Math.round(255 * (0.50 + 0.50 * (ao.data[i] / 255)));
    orm[i] = Math.max(0, Math.min(255, aoSoft));
    orm[i + 1] = rough.data[i];
    orm[i + 2] = metal.data[i];
  }
  const ormJpeg = await sharp(orm, {raw: {width: ao.width, height: ao.height, channels: 3}})
    .resize(ormDim, ormDim, {kernel: 'lanczos3'}).jpeg({quality: ormQ, mozjpeg: true}).toBuffer();
  return {albedoJpeg, normalJpeg, ormJpeg};
}

async function processCharacter(name) {
  console.log(`\n== ${name}`);
  const liveGz = fs.readFileSync(path.join(LIVE, name + '.glb.gz'));
  const src = path.join(WORK, name + '.glb');
  fs.writeFileSync(src, zlib.gunzipSync(liveGz));

  if (FORCE || !fs.existsSync(path.join(WORK, `${name}_ao.png`))) {
    const r = spawnSync(BLENDER, ['--background', '--factory-startup', '--python', SCRIPT, '--',
      '--name', name, '--src', src, '--out', WORK], {encoding: 'utf8', timeout: 20 * 60 * 1000});
    (r.stdout || '').split('\n').filter((l) => l.includes('[maps]')).forEach((l) => console.log('   ' + l.trim()));
    if (r.status !== 0) throw new Error(`blender failed for ${name}: ${(r.stderr || '').slice(-900)}`);
  }

  const doc = await io.read(src);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  // hash the geometry we must not touch
  const geometryBefore = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']
    .map((sem) => sem + '=' + (prim.getAttribute(sem) ? accessorHash(prim.getAttribute(sem)) : 'none')).join('|');
  const indexBefore = prim.getIndices() ? accessorHash(prim.getIndices()) : 'none';
  const skinBefore = root.listSkins().length;
  const animBefore = root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)])))).join('|');
  const material = root.listMaterials()[0];
  const skin = root.listSkins()[0];
  const skinsBefore = sha(Buffer.concat(skin.listJoints().map((j) => Buffer.from(j.getName() || ''))));

  let chosen = null;
  for (const opts of [
    {albedoDim: 512, albedoQ: 82, normalDim: 512, normalQ: 85, ormDim: 512, ormQ: 85, tone: 0.82},
    {albedoDim: 512, albedoQ: 78, normalDim: 512, normalQ: 85, ormDim: 512, ormQ: 80, tone: 0.82},
    {albedoDim: 512, albedoQ: 75, normalDim: 384, normalQ: 85, ormDim: 384, ormQ: 80, tone: 0.82},
    {albedoDim: 384, albedoQ: 75, normalDim: 384, normalQ: 82, ormDim: 256, ormQ: 80, tone: 0.82},
  ]) {
    const {albedoJpeg, normalJpeg, ormJpeg} = await composeTextures(name, opts);
    // replace the existing base-colour image and add normal + ORM textures
    const textures = root.listTextures();
    const baseTex = textures[0];
    baseTex.setImage(new Uint8Array(albedoJpeg)).setMimeType('image/jpeg');
    // drop any stale normal / ORM textures (idempotent re-runs)
    for (const t of textures.slice(1)) t.dispose();
    const normalTex = doc.createTexture('normal').setImage(new Uint8Array(normalJpeg)).setMimeType('image/jpeg');
    const ormTex = doc.createTexture('orm').setImage(new Uint8Array(ormJpeg)).setMimeType('image/jpeg');
    material.setBaseColorTexture(baseTex);
    material.setNormalTexture(normalTex).setNormalScale(1.0);
    material.setMetallicRoughnessTexture(ormTex);
    material.setOcclusionTexture(ormTex).setOcclusionStrength(1.0);
    material.setMetallicFactor(1.0).setRoughnessFactor(1.0);
    const bytes = await io.writeBinary(doc);
    const gz = gzip9(bytes);
    chosen = {opts, gz, bytes, imageSizes: [albedoJpeg.length, normalJpeg.length, ormJpeg.length]};
    if (gz.length <= BUDGET) break;
    console.log(`   ${opts.albedoDim}px set: ${(gz.length / 1024).toFixed(1)} KB > ${BUDGET / 1024} KB, retrying`);
  }
  if (chosen.gz.length > BUDGET) console.log(`   WARNING over budget: ${(chosen.gz.length / 1024).toFixed(1)} KB`);

  // ---- verify nothing but the material changed ----
  const geometryAfter = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']
    .map((sem) => sem + '=' + (prim.getAttribute(sem) ? accessorHash(prim.getAttribute(sem)) : 'none')).join('|');
  const indexAfter = prim.getIndices() ? accessorHash(prim.getIndices()) : 'none';
  const animAfter = root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)])))).join('|');
  const skinAfter = sha(Buffer.concat(root.listSkins()[0].listJoints().map((j) => Buffer.from(j.getName() || ''))));
  const same = geometryBefore === geometryAfter && indexBefore === indexAfter && animBefore === animAfter &&
    skinBefore === root.listSkins().length && skinsBefore === skinAfter;

  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), chosen.gz);
  const row = {
    name, gz: chosen.gz.length, bytes: chosen.bytes.length,
    albedoKB: +(chosen.imageSizes[0] / 1024).toFixed(1), normalKB: +(chosen.imageSizes[1] / 1024).toFixed(1),
    ormKB: +(chosen.imageSizes[2] / 1024).toFixed(1), dims: chosen.opts, tris: prim.getIndices().getCount() / 3,
    verts: prim.getAttribute('POSITION').getCount(), same,
  };
  console.log(`   ${name}: ${(chosen.gz.length / 1024).toFixed(1)} KB (albedo ${row.albedoKB} + normal ${row.normalKB} + orm ${row.ormKB}) ` +
    `${row.dims.albedoDim}px albedo / ${row.dims.normalDim}px normal / ${row.dims.ormDim}px ORM; ` +
    `geometry/anim/skin unchanged=${same}`);
  return row;
}

const rows = [];
for (const name of CHARS) {
  if (only && !only.includes(name)) continue;
  rows.push(await processCharacter(name));
}
fs.writeFileSync(path.join(STAGE, 'manifest-maps.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${(r.gz / 1024).toFixed(1)}KB`).join(', '));
