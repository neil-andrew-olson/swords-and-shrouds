#!/usr/bin/env node
// Bake the three weapon GLBs for Swords & Shrouds (task-1).
//   node scripts/bake/bake-weapons.mjs [--inspect] [--only rapier,halberd]
// Contract: grip point at local origin, blade/head points +Y, handle extends ~20% of the
// total height below the origin, no skins/animations, embedded JPEG textures, indexed
// primitives with TEXCOORD_0, plain glTF (no Draco/KTX2/meshopt).
import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {
  flatten, weld, simplify, prune, dedup, textureCompress, getBounds, transformMesh,
} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import {MeshoptSimplifier} from '../custom-assets/node_modules/meshoptimizer/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';
import {
  WAREHOUSE, SCRATCH, OUT_DIR, ensureDir, gzip9, triangleCount, primitiveCounts,
  mat4AlignToY, mat4Translate, mat4Mul, mat4RotateX, IDENTITY,
} from './bake-lib.mjs';

const WEAPONS = [
  {
    name: 'rapier', src: 'spanish_rapier.glb', budget: 3400, texSize: 1024,
    // Spanish part names: hoja (blade), pomo (pommel), mango (handle), guarda (guard)
    tipHints: ['hoja'], buttHints: ['pomo', 'mango'],
  },
  {
    name: 'halberd', src: 'halabardy.glb', budget: 3400, texSize: 1024,
    // Single mesh polearm: decide the head end from cross-section girth.
    girth: true,
  },
  {
    name: 'dane_axe', src: 'great_dane_axe.glb', budget: 1200, texSize: 1024,
    tipHints: ['head'], buttHints: ['handle'],
  },
  {
    // cycle-9 War Spear: single variant picked from the low-poly-spear-set warehouse pack
    // (scripts/bake/bake-spear-source.py exports the joined variant as spear_source.glb).
    // Vertical shaft along +Y after the glTF Y-up conversion; girth heuristic finds the head.
    name: 'spear', src: 'spear_source.glb', budget: 3400, texSize: 512, nightTone: true, girthMax: true, normalizeHeight: 2.2, dropNormal: true,
  },
];

const args = process.argv.slice(2);
const inspectOnly = args.includes('--inspect');
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const outArg = args.includes('--outdir') ? args[args.indexOf('--outdir') + 1] : null;

const io = new NodeIO();
await MeshoptSimplifier.ready;

function meshNodes(doc) {
  return doc.getRoot().listNodes().filter((n) => n.getMesh());
}
function nodeLabel(n) {
  const names = [];
  let cur = n;
  for (let i = 0; i < 4 && cur; i++) { names.push(cur.getName()); cur = cur.getParentNode(); }
  return names.join('/');
}
function partBounds(doc) {
  const out = [];
  for (const node of meshNodes(doc)) {
    const b = getBounds(node);
    out.push({label: nodeLabel(node), min: [...b.min], max: [...b.max],
      center: b.min.map((v, i) => (v + b.max[i]) / 2)});
  }
  return out;
}
function sceneBounds(doc) {
  const b = getBounds(doc.getRoot().listScenes()[0]);
  return {min: [...b.min], max: [...b.max], size: b.max.map((v, i) => v - b.min[i])};
}
function vertices(doc) {
  // returns {positions:Float64Array-like arrays per primitive}
  const prims = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) prims.push(p);
  return prims;
}
function transformAll(doc, matrix) {
  const done = new Set();
  for (const node of meshNodes(doc)) {
    const mesh = node.getMesh();
    if (done.has(mesh)) continue;
    done.add(mesh);
    transformMesh(mesh, matrix);
  }
}
async function loadFlat(file) {
  const doc = await io.read(file);
  await doc.transform(flatten());
  // Bake any residual node transforms into the meshes so local == world.
  for (const node of meshNodes(doc)) {
    const matrix = node.getWorldMatrix();
    const isIdentity = matrix.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
    if (!isIdentity) transformMesh(node.getMesh(), matrix);
    node.setMatrix([...IDENTITY]);
  }
  return doc;
}

async function bake(def) {
  const input = path.join(WAREHOUSE, def.src);
  if (!fs.existsSync(input)) throw new Error('missing source ' + input);
  const doc = await loadFlat(input);
  const before = triangleCount(doc);
  const parts = partBounds(doc);
  let bounds = sceneBounds(doc);
  const longAxis = bounds.size.indexOf(Math.max(...bounds.size));
  console.log(`\n== ${def.name}: ${before} tris, bbox size=${bounds.size.map((v) => v.toFixed(2))} longAxis=${'xyz'[longAxis]}`);
  for (const p of parts) console.log(`   part ${p.label.padEnd(38)} center=[${p.center.map((v) => v.toFixed(2))}]`);

  // 1) Direction the head/blade points, in source space.
  let dir = [0, 0, 0];
  if (def.tipHints) {
    const centroid = (hints) => {
      const hits = parts.filter((p) => hints.some((h) => p.label.toLowerCase().includes(h)));
      if (!hits.length) return null;
      const c = [0, 0, 0];
      for (const h of hits) for (let i = 0; i < 3; i++) c[i] += h.center[i];
      return c.map((v) => v / hits.length);
    };
    const tip = centroid(def.tipHints), butt = centroid(def.buttHints);
    if (tip && butt) {
      dir = tip.map((v, i) => v - butt[i]);
      console.log(`   orientation from named parts: tip=${tip.map((v) => v.toFixed(2))} butt=${butt.map((v) => v.toFixed(2))}`);
    }
  }
  if (def.girthMax) {
    // spear-style: the head end has the LARGEST cross-section (blade), the butt is a thin cap
    const prims = vertices(doc);
    const axis = longAxis;
    const lo = bounds.min[axis], hi = bounds.max[axis], span = hi - lo || 1;
    let rLo = 0, rHi = 0;
    for (const p of prims) {
      const arr = p.getAttribute('POSITION').getArray();
      for (let i = 0; i < arr.length; i += 3) {
        const t = (arr[i + axis] - lo) / span;
        const others = [0, 1, 2].filter((k) => k !== axis);
        const r = Math.hypot(arr[i + others[0]], arr[i + others[1]]);
        if (t < 0.10) rLo = Math.max(rLo, r); else if (t > 0.90) rHi = Math.max(rHi, r);
      }
    }
    dir = [0, 0, 0]; dir[axis] = rHi >= rLo ? 1 : -1;
    console.log(`   max-radius heuristic: rLo=${rLo.toFixed(3)} rHi=${rHi.toFixed(3)} -> ${dir[axis] > 0 ? '+' : '-'}${'xyz'[axis]}`);
  }
  if (def.girth || dir.every((v) => Math.abs(v) < 1e-6)) {
    // girth heuristic: the head end has much larger cross-section
    const prims = vertices(doc);
    const axis = longAxis;
    const lo = bounds.min[axis], hi = bounds.max[axis], span = hi - lo || 1;
    let gLo = 0, nLo = 0, gHi = 0, nHi = 0;
    for (const p of prims) {
      const pos = p.getAttribute('POSITION');
      const arr = pos.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        const t = (arr[i + axis] - lo) / span;
        const others = [0, 1, 2].filter((k) => k !== axis);
        const r = Math.hypot(arr[i + others[0]], arr[i + others[1]]);
        if (t < 0.12) { gLo += r; nLo++; } else if (t > 0.88) { gHi += r; nHi++; }
      }
    }
    const meanLo = gLo / Math.max(1, nLo), meanHi = gHi / Math.max(1, nHi);
    const sign = meanHi >= meanLo ? 1 : -1;
    dir = [0, 0, 0]; dir[axis] = sign;
    console.log(`   girth heuristic: meanR lo=${meanLo.toFixed(3)} hi=${meanHi.toFixed(3)} -> ${sign > 0 ? '+' : '-'}${'xyz'[axis]}`);
  }
  // 2) Rotate so dir -> +Y
  const dirLen = Math.hypot(...dir) || 1;
  const unit = dir.map((v) => v / dirLen);
  const R = mat4AlignToY(unit);
  transformAll(doc, R);
  if (inspectOnly) {
    const b = sceneBounds(doc);
    console.log(`   after align: min=${b.min.map((v) => v.toFixed(3))} max=${b.max.map((v) => v.toFixed(3))}`);
    return;
  }
  // 2b) optional real-world normalisation (spear source is in centimetres)
  if (def.normalizeHeight) {
    let bb = sceneBounds(doc);
    const k = def.normalizeHeight / Math.max(1e-6, bb.size[1]);
    const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
    transformAll(doc, S);
    bb = sceneBounds(doc);
    console.log(`   normalised height ${bb.size[1].toFixed(3)} (scale ${k.toFixed(4)})`);
  }
  // 3) Translate: min.y = -0.20 * height, x/z centred on the handle (bottom quarter centroid)
  let b = sceneBounds(doc);
  const H = b.size[1];
  const yCut = b.min[1] + 0.25 * H;
  let sx = 0, sz = 0, n = 0;
  for (const p of vertices(doc)) {
    const arr = p.getAttribute('POSITION').getArray();
    const step = Math.max(1, Math.floor(arr.length / 3 / 40000)) * 3; // subsample huge meshes
    for (let i = 0; i < arr.length; i += step) {
      if (arr[i + 1] <= yCut) { sx += arr[i]; sz += arr[i + 2]; n++; }
    }
  }
  const cx = n ? sx / n : (b.min[0] + b.max[0]) / 2;
  const cz = n ? sz / n : (b.min[2] + b.max[2]) / 2;
  const gripY = -0.20 * H;
  const T = mat4Translate(-cx, gripY - b.min[1], -cz);
  transformAll(doc, T);
  b = sceneBounds(doc);
  console.log(`   grip offset: height=${H.toFixed(3)} handle-centre=(${cx.toFixed(3)},${cz.toFixed(3)})`);
  console.log(`   oriented bbox min=[${b.min.map((v) => v.toFixed(3))}] max=[${b.max.map((v) => v.toFixed(3))}]`);

  // 4) Decimate to budget
  const triAt = () => triangleCount(doc);
  await doc.transform(weld(), prune());
  let guard = 0;
  while (triAt() > def.budget && guard++ < 6) {
    const cur = triAt();
    const ratio = Math.max(0.01, Math.min(1, (def.budget / cur) * 0.985));
    const error = 0.01 + guard * 0.02;
    console.log(`   simplify pass ${guard}: ${cur} -> target ${def.budget} (ratio ${ratio.toFixed(3)}, error ${error})`);
    try {
      await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio, error, lockBorder: false}));
    } catch (e) {
      console.log('   simplify failed: ' + e.message + ' — relaxing error');
      await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio, error: 1, lockBorder: false}));
    }
    if (triAt() >= cur) { console.log('   no further reduction possible'); break; }
  }
  console.log(`   final tris=${triAt()}`);

  // 4b) optional: drop normal maps (thin weapon silhouette, normal detail is not worth the payload)
  if (def.dropNormal) {
    for (const mat of doc.getRoot().listMaterials()) mat.setNormalTexture(null);
  }
  // 5) Textures: one pass for colour, one for normals (JPEG, capped resolution)
  const size = [def.texSize, def.texSize];
  await doc.transform(
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: size, slots: /baseColorTexture|emissiveTexture/, quality: 88}),
  );
  await doc.transform(
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: size, slots: /normalTexture/, quality: 92}),
  );
  // 5b) night tone: darken + cool-shift the albedo so the weapon sits in the night palette
  if (def.nightTone) {
    const seen = new Set();
    for (const mat of doc.getRoot().listMaterials()) {
      const tex = mat.getBaseColorTexture();
      if (!tex || seen.has(tex)) continue;
      seen.add(tex);
      const img = tex.getImage();
      if (!img) continue;
      const toned = await sharp(Buffer.from(img)).linear(0.84, 0).modulate({brightness: 1.0, saturation: 0.9})
        .tint({r: 214, g: 226, b: 246}).jpeg({quality: 88, mozjpeg: true}).toBuffer();
      tex.setImage(new Uint8Array(toned)).setMimeType('image/jpeg');
    }
    console.log('   night-toned albedo textures: ' + seen.size);
  }
  await doc.transform(dedup(), prune());
  // 6) Safety: force indexed + UV presence, drop skins/animations
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  for (const s of doc.getRoot().listSkins()) s.dispose();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (!prim.getAttribute('TEXCOORD_0')) throw new Error(def.name + ': primitive lost TEXCOORD_0');
    if (!prim.getIndices()) throw new Error(def.name + ': primitive lost indices');
  }
  const counts = primitiveCounts(doc);
  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  ensureDir(SCRATCH + '/bake');
  const stage = path.join(SCRATCH, 'bake', def.name + '.glb');
  fs.writeFileSync(stage, bytes);
  console.log(`   staged ${stage}  raw=${(bytes.length / 1024).toFixed(1)}KB gzip=${(gz.length / 1024).toFixed(1)}KB prims=${counts.prims} images=${doc.getRoot().listTextures().length}`);
  return {def, bytes, gz, counts};
}

const results = [];
for (const def of WEAPONS) {
  if (onlyArg && !onlyArg.includes(def.name)) continue;
  if (inspectOnly) { await bake(def); continue; }
  results.push(await bake(def));
}
if (!inspectOnly) {
  const dir = outArg ? path.resolve(outArg) : OUT_DIR;
  ensureDir(dir);
  for (const r of results) fs.writeFileSync(path.join(dir, r.def.name + '.glb.gz'), r.gz);
  console.log('\nwrote: ' + results.map((r) => `${r.def.name}.glb.gz (${(r.gz.length / 1024).toFixed(1)}KB)`).join(', ') + ' -> ' + dir);
}
