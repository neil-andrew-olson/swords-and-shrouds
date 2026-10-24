#!/usr/bin/env node
// Batch 2026-10C asset payload slimmer (asset-forge).
//
// Rewrites every shipped custom GLB with a tighter texture/attribute budget while keeping the
// asset contract intact (glTF 2.0, gzip-9, embedded images w/ bufferView, indexed prims +
// TEXCOORD_0, no Draco/KTX2/meshopt). Geometry is not decimated: tri counts, skins, animations
// and canonical weapon orientation are untouched. The only structural edits are removal of
// unused vertex attributes (extra UV sets, tangents, redundant colour/weights), merging
// compatible primitives of *unskinned* meshes (draw-call win for the 2,070-primitive pine), and
// texture re-encoding / replacing maps with material factors.
//
// Everything is written to temp_sketchlab/optimized/custom/<name>.glb.gz + a manifest, validated
// there, and only then installed into public/assets by install-optimized.mjs.
//
//   node scripts/bake/optimize-assets.mjs [--only name,...] [--force] [--report]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  prune, dedup, join, flatten, quantize,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {
  KHRMaterialsPBRSpecularGlossiness, KHRMaterialsSpecular, KHRMaterialsIOR,
  KHRMaterialsEmissiveStrength, KHRMaterialsClearcoat, KHRMaterialsSheen,
  KHRMaterialsTransmission, KHRMaterialsVolume, KHRMaterialsUnlit, KHRMaterialsIridescence,
  KHRMaterialsAnisotropy, KHRMaterialsDispersion, KHRTextureTransform, KHRMeshQuantization,
} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const CUSTOM = path.join(GAME, 'public/assets/custom');
const SCRATCH = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab';
const STAGE = path.join(SCRATCH, 'optimized');
const STAGE_CUSTOM = path.join(STAGE, 'custom');

const CHARACTERS = ['hero', 'ally', 'fallen', 'berserker', 'ranger', 'templar', 'survivor', 'skeleton-soldier', 'zombie'];
const WEAPONS = ['rapier', 'halberd', 'dane_axe', 'flamberge', 'mace', 'sword', 'bastard', 'hammer', 'poleaxe', 'zweihander', 'shield'];

// Per-asset policy. `base`/`normal` are max texture dimensions; `keepNormal`/`keepMR` false
// replaces the map with material factors (visually negligible at night / distant props).
const DEFAULT = {
  base: 512, baseQ: 80, normal: 256, normalQ: 85,
  keepNormal: true, keepMR: false, keepEmissive: false,
  metallic: 0.0, roughness: 0.8, join: true, dropColor: false, maxKB: 0,
};
const OVERRIDES = Object.fromEntries([
  ...CHARACTERS.map((n) => [n, {base: 512, baseQ: 80, keepNormal: false, keepMR: false, join: false, maxKB: 450}]),
  ...WEAPONS.map((n) => [n, {base: 512, baseQ: 82, normal: 256, normalQ: 85, keepNormal: true, metallic: 0.85, roughness: 0.45, maxKB: 450}]),
  ['dane_axe', {base: 512, baseQ: 82, keepNormal: false, keepMR: false, metallic: 0.8, roughness: 0.5, maxKB: 450}],
  ['shield', {base: 512, baseQ: 82, keepNormal: false, metallic: 0.25, roughness: 0.45, maxKB: 450}],
  // trees / foliage: leaf cards need their alpha, bark needs nothing else
  ['oak', {base: 512, baseQ: 78, keepNormal: false, keepMR: false, keepEmissive: false, metallic: 0, roughness: 0.85, maxKB: 800}],
  ['pine', {base: 256, baseQ: 78, keepNormal: false, keepMR: false, keepEmissive: false, metallic: 0, roughness: 0.85, quantize: true, maxKB: 400}],
  // the only spec/gloss asset: converted to metal/rough, then slimmed
  ['gatehouse', {base: 512, baseQ: 78, normal: 256, normalQ: 85, keepMR: false, metallic: 0, roughness: 0.9, specGloss: true, maxKB: 800}],
  ['fortress_keep', {base: 512, baseQ: 78, keepNormal: false, keepMR: false, metallic: 0, roughness: 0.85}],
  ['camp_tent', {base: 512, baseQ: 78, keepNormal: false, keepMR: false, metallic: 0, roughness: 0.9}],
  ['house', {base: 512, baseQ: 78, keepNormal: false, metallic: 0, roughness: 0.85}],
  ['rock_cluster', {base: 512, baseQ: 78, keepNormal: false, metallic: 0, roughness: 0.9}],
  // ruins / keep / wall: keep a cheap normal map for close-up stone detail
  ...['chapel_ruin', 'aqueduct_ruin', 'bridge_ruin', 'courtyard_ruin', 'well', 'stone_wall', 'castle_tower', 'chest', 'plague', 'supplies', 'trebuchet', 'medicine', 'iron', 'stakes', 'cauldron']
    .map((n) => [n, {base: 512, baseQ: 78, normal: 256, keepNormal: true, keepMR: false, metallic: 0, roughness: 0.9}]),
  ['bench', {base: 256, baseQ: 78, normal: 256, keepNormal: true, metallic: 0, roughness: 0.9}],
  ['grass_tuft', {base: 512, baseQ: 80, keepNormal: false, keepMR: false, metallic: 0, roughness: 1.0}],
  ['barrels', {}], ['cart', {}], ['brazier', {}], ['firepit', {}], ['beacon', {}],
  ['castle_high_citadel', {}], ['high_citadel', {}], ['border_fortress', {}], ['castle_border_fortress', {}],
  ['castle_fallen_keep', {}], ['fallen_keep', {}], ['gate', {}], ['grave', {}], ['mill', {}],
].map(([n, v]) => [n, {...DEFAULT, ...v}]));

const io = new NodeIO().registerExtensions([
  KHRMaterialsPBRSpecularGlossiness, KHRMaterialsSpecular, KHRMaterialsIOR, KHRMaterialsEmissiveStrength,
  KHRMaterialsClearcoat, KHRMaterialsSheen, KHRMaterialsTransmission, KHRMaterialsVolume,
  KHRMaterialsUnlit, KHRMaterialsIridescence, KHRMaterialsAnisotropy, KHRMaterialsDispersion,
  KHRTextureTransform, KHRMeshQuantization,
]);

function gzip9(buf) { return zlib.gzipSync(buf, {level: 9}); }
function kb(v) { return +(v / 1024).toFixed(1); }

function textureSlots(root) {
  const slots = new Map();
  const add = (tex, slot) => {
    if (!tex) return;
    if (!slots.has(tex)) slots.set(tex, new Set());
    slots.get(tex).add(slot);
  };
  for (const m of root.listMaterials()) {
    add(m.getBaseColorTexture(), 'base');
    add(m.getNormalTexture(), 'normal');
    add(m.getMetallicRoughnessTexture(), 'mr');
    add(m.getOcclusionTexture(), 'occlusion');
    add(m.getEmissiveTexture(), 'emissive');
  }
  return slots;
}

function usedTexCoordSets(root) {
  const sets = new Set([0]);
  const note = (info) => { if (info) sets.add(info.getTexCoord()); };
  for (const m of root.listMaterials()) {
    note(m.getBaseColorTextureInfo());
    note(m.getNormalTextureInfo());
    note(m.getMetallicRoughnessTextureInfo());
    note(m.getOcclusionTextureInfo());
    note(m.getEmissiveTextureInfo());
  }
  return sets;
}

/** Replace the spec/gloss extension with a plain metal/rough material wiring the diffuse map. */
function convertSpecGloss(doc) {
  const root = doc.getRoot();
  let converted = 0;
  for (const mat of root.listMaterials()) {
    const sg = mat.getExtension('KHR_materials_pbrSpecularGlossiness');
    if (!sg) continue;
    const diffuse = sg.getDiffuseTexture ? sg.getDiffuseTexture() : null;
    if (diffuse) mat.setBaseColorTexture(diffuse);
    mat.setBaseColorFactor([1, 1, 1, 1]);
    if (sg.getDiffuseFactor) mat.setBaseColorFactor(sg.getDiffuseFactor());
    mat.setMetallicFactor(0.0);
    mat.setRoughnessFactor(0.9);
    mat.setExtension('KHR_materials_pbrSpecularGlossiness', null);
    converted++;
  }
  return converted;
}

function stripAttributes(doc, policy) {
  const texCoordSets = usedTexCoordSets(doc.getRoot());
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (semantic === 'TANGENT') {
          prim.setAttribute(semantic, null); dropped++;
          continue;
        }
        if (policy.dropColor && semantic === 'COLOR_0') { prim.setAttribute(semantic, null); dropped++; continue; }
        if (semantic.startsWith('TEXCOORD_')) {
          const set = Number(semantic.slice('TEXCOORD_'.length));
          if (!texCoordSets.has(set)) { prim.setAttribute(semantic, null); dropped++; }
        }
      }
    }
  }
  return dropped;
}

async function reencodeTexture(tex, {maxDim, quality, alpha, palette}) {
  const src = Buffer.from(tex.getImage());
  const meta = await sharp(src).metadata();
  const biggest = Math.max(meta.width ?? 0, meta.height ?? 0);
  let pipe = sharp(src);
  if (biggest > maxDim) pipe = pipe.resize(maxDim, maxDim, {fit: 'inside', kernel: 'lanczos3'});
  let out, mime;
  if (alpha) {
    out = await pipe.png({compressionLevel: 9, effort: 10, palette: !!palette, colours: palette ? 256 : undefined}).toBuffer();
    mime = 'image/png';
  } else {
    out = await pipe.flatten({background: '#000000'}).jpeg({quality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
    mime = 'image/jpeg';
  }
  tex.setImage(new Uint8Array(out)).setMimeType(mime);
  return {from: `${meta.width}x${meta.height}:${meta.format}=${kb(src.length)}KB`, to: `${mime.split('/')[1]}=${kb(out.length)}KB`};
}

/** Raw-GLB patch: convert the legacy KHR_materials_pbrSpecularGlossiness material to plain
 *  metal/rough before glTF-Transform ever reads the file, so the shipper never declares the
 *  (unsupported) extension as required. */
function prepatchSpecGloss(bytes) {
  const jlen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jlen));
  const bin = bytes.subarray(20 + jlen); // BIN chunk header + data
  let patched = false;
  for (const m of json.materials || []) {
    const sg = m.extensions && m.extensions.KHR_materials_pbrSpecularGlossiness;
    if (!sg) continue;
    m.pbrMetallicRoughness = m.pbrMetallicRoughness || {};
    if (sg.diffuseTexture) m.pbrMetallicRoughness.baseColorTexture = sg.diffuseTexture;
    if (sg.diffuseFactor) m.pbrMetallicRoughness.baseColorFactor = sg.diffuseFactor;
    m.pbrMetallicRoughness.metallicFactor = 0;
    m.pbrMetallicRoughness.roughnessFactor = 0.9;
    delete m.extensions.KHR_materials_pbrSpecularGlossiness;
    if (!Object.keys(m.extensions).length) delete m.extensions;
    patched = true;
  }
  if (!patched) return bytes;
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => e !== 'KHR_materials_pbrSpecularGlossiness');
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  delete json.extensionsRequired;
  let str = JSON.stringify(json);
  str += ' '.repeat((4 - (Buffer.byteLength(str) % 4)) % 4);
  const jb = Buffer.from(str);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jb.length + bin.length, 8);
  header.writeUInt32LE(jb.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jb, bin]);
}

/** Quantisation only supports TEXCOORD_0 in [0,1]; tiling trimsheet UVs outside that range make
 *  glTF-Transform drop the attribute, so those meshes are left unquantised. */
function uvsInRange(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0');
    if (!uv) return false;
    const a = uv.getArray();
    for (let i = 0; i < a.length; i++) if (a[i] < -0.001 || a[i] > 1.001) return false;
  }
  return true;
}

/** All texture samplers wrap with REPEAT? Then UVs can be wrapped into [0,1] without any visual
 *  change (tiling), which in turn lets quantisation run. */
function allSamplersRepeat(root) {
  for (const m of root.listMaterials()) {
    for (const info of [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(),
      m.getMetallicRoughnessTextureInfo(), m.getOcclusionTextureInfo(), m.getEmissiveTextureInfo()]) {
      if (!info) continue;
      if (info.getWrapS() !== 10497 || info.getWrapT() !== 10497) return false;
    }
  }
  return true;
}
function wrapUVs(doc) {
  let wrapped = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    for (const semantic of prim.listSemantics().filter((s) => s.startsWith('TEXCOORD_'))) {
      const uv = prim.getAttribute(semantic);
      const a = uv.getArray();
      let changed = false;
      for (let i = 0; i < a.length; i++) {
        const w = a[i] - Math.floor(a[i]);
        if (w !== a[i]) { a[i] = w; changed = true; }
      }
      if (changed) { uv.setArray(a); wrapped++; }
    }
  }
  return wrapped;
}

async function optimise(name, policyA) {
  const policy = {...DEFAULT, ...(OVERRIDES[name] || {})};
  const file = path.join(CUSTOM, name + '.glb.gz');
  let originalBytes = zlib.gunzipSync(fs.readFileSync(file));
  const originalGz = fs.statSync(file).size;
  if (policy.specGloss) originalBytes = prepatchSpecGloss(originalBytes);
  const doc = await io.readBinary(new Uint8Array(originalBytes));
  const root = doc.getRoot();
  const notes = [];

  // drop subtle specular/ior extension layers (night lighting) so their textures can be pruned
  let strippedExt = 0;
  for (const mat of root.listMaterials()) {
    for (const extName of ['KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat']) {
      if (mat.getExtension(extName)) { mat.setExtension(extName, null); strippedExt++; }
    }
  }
  if (strippedExt) notes.push(`stripped ${strippedExt} extension layer(s)`);

  const droppedAttrs = stripAttributes(doc, policy);
  if (droppedAttrs) notes.push(`dropped ${droppedAttrs} attributes`);

  const hasSkins = root.listSkins().length > 0;
  // Batch-3 draw-call fix: bake node transforms into the vertices and merge every static mesh
  // into as few primitives as the materials allow (pine: 2,070 leaf meshes -> a handful of prims;
  // the town modules similarly). Never on skinned meshes (would break skinning).
  if (policy.flatten !== false && !hasSkins) {
    try {
      await doc.transform(flatten());
      notes.push('flattened node hierarchy');
    } catch (e) { notes.push('flatten skipped: ' + e.message); }
  }
  if (policy.join !== false && !hasSkins) {
    try { await doc.transform(join({keepNamed: false})); } catch (e) { notes.push('join skipped: ' + e.message); }
  }
  // quantise static vertex attributes (plain KHR_mesh_quantization, natively read by
  // GLTFLoader — no decoder); keeps the preload weapons unquantised so grip bboxes stay exact.
  if (policy.quantize !== false && !hasSkins && !WEAPONS.includes(name)) {
    // tiling UVs (trimsheets, castle modules) are wrapped into [0,1] first — under REPEAT
    // samplers this is identical, and it lets quantisation shrink the UV attribute too
    if (!uvsInRange(doc) && allSamplersRepeat(root)) {
      const n = wrapUVs(doc);
      if (n) notes.push(`wrapped tiling UVs on ${n} prim(s)`);
    }
    if (uvsInRange(doc)) {
      try {
        await doc.transform(quantize({pattern: /^(?!JOINTS_|WEIGHTS_).*$/}));
        notes.push('quantized attributes (KHR_mesh_quantization)');
      } catch (e) { notes.push('quantize skipped: ' + e.message); }
    } else {
      notes.push('quantize skipped (UVs outside [0,1] with clamped samplers)');
    }
  }

  // ---- texture policy ----
  const slots = textureSlots(root);
  const alphaMaterials = new Set();
  for (const m of root.listMaterials()) {
    if (m.getAlphaMode() !== 'OPAQUE') {
      if (m.getBaseColorTexture()) alphaMaterials.add(m.getBaseColorTexture());
    }
  }
  const texNotes = [];
  for (const [tex, slotSet] of slots) {
    if (alphaMaterials.has(tex)) {
      texNotes.push(await reencodeTexture(tex, {maxDim: policy.base, alpha: true, palette: true}));
      continue;
    }
    if (slotSet.has('base') || slotSet.has('emissive')) {
      if (slotSet.has('emissive') && !policy.keepEmissive) {
        // handled below by detaching
      }
      texNotes.push(await reencodeTexture(tex, {maxDim: policy.base, quality: policy.baseQ, alpha: false}));
      continue;
    }
    if (slotSet.has('normal')) {
      if (!policy.keepNormal) continue; // detached below
      texNotes.push(await reencodeTexture(tex, {maxDim: policy.normal, quality: policy.normalQ, alpha: false}));
      continue;
    }
    if (slotSet.has('mr') || slotSet.has('occlusion')) {
      if (!policy.keepMR) continue; // detached below
      texNotes.push(await reencodeTexture(tex, {maxDim: 256, quality: 80, alpha: false}));
      continue;
    }
    // orphan texture (not referenced by a slot) -> will be pruned
  }
  // detach maps replaced by factors
  let detached = 0;
  for (const mat of root.listMaterials()) {
    if (!policy.keepNormal && mat.getNormalTexture()) { mat.setNormalTexture(null); detached++; }
    if (!policy.keepMR) {
      if (mat.getMetallicRoughnessTexture()) { mat.setMetallicRoughnessTexture(null); detached++; }
      mat.setMetallicFactor(policy.metallic);
      mat.setRoughnessFactor(policy.roughness);
      if (mat.getOcclusionTexture()) { mat.setOcclusionTexture(null); detached++; }
    }
    if (!policy.keepEmissive && mat.getEmissiveTexture()) {
      mat.setEmissiveTexture(null);
      mat.setEmissiveFactor([0, 0, 0]);
      detached++;
    }
  }
  if (detached) notes.push(`detached ${detached} map(s) -> factors`);

  // drop now-unreferenced textures/images first (e.g. textures of stripped extension layers)
  await doc.transform(dedup(), prune({keepAttributes: true}));
  // catch-all: cap any texture that the slot classifier did not recognise
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const meta = await sharp(Buffer.from(img)).metadata();
    if (Math.max(meta.width ?? 0, meta.height ?? 0) <= policy.base) continue;
    texNotes.push(await reencodeTexture(tex, {maxDim: policy.base, quality: policy.baseQ, alpha: !!meta.hasAlpha}));
  }
  await doc.transform(dedup(), prune({keepAttributes: true}));

  // material factors were normalised above, so previously-distinct materials can now be
  // identical (dedup collapses them) — a second join then merges the remaining primitives.
  // Only run it when primitives still exceed the material count, otherwise joining can
  // re-create accessors and grow the payload for no draw-call gain.
  if (!hasSkins) {
    const before = root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
    const matCount = root.listMaterials().length;
    if (before > matCount) {
      try {
        await doc.transform(join({keepNamed: false}), dedup(), prune({keepAttributes: true}));
        const after = root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
        if (after < before) notes.push(`second join ${before}->${after} prims`);
      } catch (e) { notes.push('second join skipped: ' + e.message); }
    }
  }

  // contract safety: every primitive must stay indexed + TEXCOORD_0
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (!prim.getIndices()) throw new Error(`${name}: lost indices`);
    if (!prim.getAttribute('TEXCOORD_0')) throw new Error(`${name}: lost TEXCOORD_0`);
  }
  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  const tris = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  const imageKB = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength || 0), 0) / 1024;
  const out = {
    name, originalGz, gz: gz.length, tris: Math.round(tris),
    prims: root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
    nodes: root.listNodes().length,
    anims: root.listAnimations().length, skins: root.listSkins().length,
    images: root.listTextures().length, imageKB: +imageKB.toFixed(1),
    notes, tex: texNotes,
  };
  return {out, bytes: gz};
}

// ---- main ----
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const force = args.includes('--force');
fs.mkdirSync(STAGE_CUSTOM, {recursive: true});
const names = fs.readdirSync(CUSTOM).filter((f) => f.endsWith('.glb.gz')).map((f) => f.replace('.glb.gz', '')).sort();
const report = [];
for (const name of names) {
  if (only && !only.includes(name)) continue;
  const originalGz = fs.statSync(path.join(CUSTOM, name + '.glb.gz')).size;
  const stageFile = path.join(STAGE_CUSTOM, name + '.glb.gz');
  // every asset is flattened/merged in this pass (draw-call win); only explicit `copy` entries
  // are passed through untouched
  if ((OVERRIDES[name] || DEFAULT).copy) {
    if (force || !fs.existsSync(stageFile)) fs.copyFileSync(path.join(CUSTOM, name + '.glb.gz'), stageFile);
    report.push({name, originalGz, gz: originalGz, copied: true});
    continue;
  }
  let policy = OVERRIDES[name] || DEFAULT;
  let result;
  try {
    result = await optimise(name, policy);
  } catch (e) {
    console.error(`FAILED ${name}: ${e.stack || e.message}`);
    process.exitCode = 1;
    continue;
  }
  // enforce per-asset cap with an aggressive retry
  if (result.out.maxKB && result.out.gz > result.out.maxKB * 1024) {
    const aggressive = {...(OVERRIDES[name] || {}), base: 256, keepNormal: false, keepMR: false, keepEmissive: false};
    OVERRIDES[name] = {...DEFAULT, ...aggressive};
    const retry = await optimise(name, OVERRIDES[name]);
    retry.out.notes.push('aggressive retry (256 px, no normal/MR)');
    result = retry;
  }
  fs.writeFileSync(stageFile, result.bytes);
  report.push(result.out);
  console.log(`${name.padEnd(16)} ${(originalGz / 1024).toFixed(1).padStart(8)} -> ${(result.out.gz / 1024).toFixed(1).padStart(8)} KB  ` +
    `tris=${result.out.tris} prims=${result.out.prims} imgs=${result.out.images} (${result.out.imageKB}KB) ${result.out.notes.join('; ')}`);
}
const origTotal = report.reduce((s, r) => s + r.originalGz, 0);
const newTotal = report.reduce((s, r) => s + r.gz, 0);
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify({totals: {origTotal, newTotal}, rows: report}, null, 1));
console.log(`\n${report.length} files: ${(origTotal / 1048576).toFixed(2)} MB -> ${(newTotal / 1048576).toFixed(2)} MB`);
