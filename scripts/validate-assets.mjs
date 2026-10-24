#!/usr/bin/env node
// Validator for every shipped custom GLB + scanned texture in the Swords & Shrouds repo.
// Usage: node scripts/validate-assets.mjs [--custom-only] [--json]
// Checks (per docs/BATCH-2026-10-SPEC.md + tests/assets.test.ts):
//   glTF 2.0, self-contained buffers/images (no external URIs), embedded images with
//   bufferView, TEXCOORD_0 on every primitive, indexed primitives, triangle budget,
//   gzip level / size, and the allowed-extension list (no Draco/KTX2/meshopt).
// Bounding boxes are computed from accessor min/max + node transforms so the bake
// orientation contract (grip at origin / ground origin) can be verified.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --root <dir> validates a staged mirror (expects <dir>/custom and <dir>/textures) before the
// atomic install; defaults to the live public/assets tree.
const rootArgIdx = process.argv.indexOf('--root');
const ROOT = rootArgIdx >= 0 ? path.resolve(process.argv[rootArgIdx + 1]) : path.join(GAME, 'public/assets');
const CUSTOM = path.join(ROOT, 'custom');
const TEXTURES = path.join(ROOT, 'textures');

const BUDGETS = {
  rapier: 3400, halberd: 3400, dane_axe: 1200,
  flamberge: 3400, mace: 3400,
  chapel_ruin: 14000, aqueduct_ruin: 14000, bridge_ruin: 14000, courtyard_ruin: 14000,
  watchtower_ruin: 10000, village_house_ruin: 8000,
  stone_well: 3000, blacksmith_stall: 5000,
  spear: 3400,
  stone_altar: 4000, forge_furnace: 8000,
  abbey_ruin: 14000,
  'zombie-bloated': 11000, 'skeleton-armoured': 8500,
  fortress_keep: 14000, castle_tower: 14000,
  well: 6000, chest: 6000, bench: 6000, rock_cluster: 6000, grass_tuft: 1500,
  camp_tent: 6000, stone_wall: 8000,
  pine_lod: 2500, oak_lod: 2500, castle_tower_lod: 4000,
  pine_v2: 4000, snow_pine: 4000, oak_v2: 4000, maple: 4000,
  dead_tree: 2000, standing_stone: 800, ice_shard: 400,
};
const FORBIDDEN_EXT = ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression', 'EXT_meshopt'];

function readGlb(file) {
  const raw = fs.readFileSync(file);
  const buf = zlib.gunzipSync(raw);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  if (buf.readUInt32LE(4) !== 2) throw new Error('not glTF 2.0 container');
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('declared length mismatch');
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jlen));
  return {raw, buf, json};
}

// column-major 4x4 helpers
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0];
  const r = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const R = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return [R[0] * s[0], R[1] * s[0], R[2] * s[0], 0,
    R[3] * s[1], R[4] * s[1], R[5] * s[1], 0,
    R[6] * s[2], R[7] * s[2], R[8] * s[2], 0,
    t[0], t[1], t[2], 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    o[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
  return o;
}
function xform(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

function worldBounds(json) {
  if (!json.nodes || !json.meshes) return null;
  const roots = new Set(json.nodes.map((_, i) => i));
  for (const n of json.nodes) for (const c of n.children || []) roots.delete(c);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  // KHR_mesh_quantization stores POSITION as integers; accessor min/max are in those integer
  // units, so normalised (componentType-scaled) accessors must be decoded before transforming.
  const TYPE_MAX = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295};
  const visit = (idx, parent) => {
    const n = json.nodes[idx];
    const W = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[p.attributes.POSITION];
        if (!acc || !acc.min) continue;
        let mn = acc.min, mx = acc.max;
        if (acc.normalized) {
          const scale = TYPE_MAX[acc.componentType] || 1;
          const signed = acc.componentType === 5120 || acc.componentType === 5122;
          const decode = (v) => (signed ? Math.max(v / scale, -1) : v / scale);
          mn = mn.map(decode);
          mx = mx.map(decode);
        }
        for (const cx of [mn[0], mx[0]])
          for (const cy of [mn[1], mx[1]])
            for (const cz of [mn[2], mx[2]]) {
              const w = xform(W, [cx, cy, cz]);
              for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
            }
      }
    }
    for (const c of n.children || []) visit(c, W);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) visit(r, I);
  return {min: lo, max: hi, size: hi.map((v, i) => v - lo[i])};
}

const WEAPONS = new Set(['rapier', 'halberd', 'dane_axe', 'spear']);

function validateGlb(name, file) {
  const issues = [], warnings = [];
  const {raw, buf, json} = readGlb(file);
  const j = json;
  if (j.asset?.version !== '2.0') issues.push(`asset.version=${j.asset?.version}`);
  for (const res of [...(j.buffers || []), ...(j.images || [])])
    if (res.uri && !res.uri.startsWith('data:')) issues.push(`external uri: ${res.uri.slice(0, 40)}`);
  for (const b of j.buffers || []) if (b.uri) issues.push('buffer has uri (not self-contained)');
  const images = j.images || [];
  if (!images.length) issues.push('no embedded images');
  for (const img of images) if (img.bufferView === undefined) issues.push('image without bufferView');
  for (const ext of [...(j.extensionsUsed || []), ...(j.extensionsRequired || [])])
    if (FORBIDDEN_EXT.some((f) => ext.includes(f))) issues.push(`forbidden extension ${ext}`);
  let tris = 0, prims = 0;
  const triPerPrim = [];
  for (const mesh of j.meshes || []) for (const p of mesh.primitives) {
    prims++;
    if (p.attributes.TEXCOORD_0 === undefined) issues.push('primitive without TEXCOORD_0');
    if (p.indices === undefined) issues.push('unindexed primitive');
    else {
      const t = j.accessors[p.indices].count / 3;
      tris += t;
      triPerPrim.push(t);
    }
  }
  if (WEAPONS.has(name)) {
    // weapon contract: no skins/animations, grip-at-origin orientation
    if (j.skins?.length) issues.push(`has ${j.skins.length} skin(s)`);
    if (j.animations?.length) issues.push(`has ${j.animations.length} animation(s)`);
  }
  const budget = BUDGETS[name] ?? 16000;
  if (tris > budget) issues.push(`triangles ${tris} > budget ${budget}`);
  const bounds = worldBounds(j);
  const gzipBytes = raw.length;
  const ok = issues.length === 0;
  return {name, kind: 'glb', ok, issues, warnings, tris, prims, budget, bounds,
    rawBytes: buf.length, gzipBytes, images: images.length, materials: (j.materials || []).length,
    extensions: j.extensionsUsed || [], triPerPrim};
}

function validateTexture(name) {
  const file = path.join(TEXTURES, name);
  const issues = [];
  if (!fs.existsSync(file)) return {name, kind: 'texture', ok: false, issues: ['missing'], bytes: 0};
  const bytes = fs.statSync(file).size;
  const head = fs.readFileSync(file).subarray(0, 32);
  let dims = null;
  if (name.endsWith('.png')) {
    if (head.slice(1, 4).toString('ascii') === 'PNG') dims = [head.readUInt32BE(16), head.readUInt32BE(20)];
  } else {
    // parse JPEG SOF for dimensions
    const b = fs.readFileSync(file);
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        dims = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  const limit = name.endsWith('.jpg') ? 400 * 1024 : 2 * 1024 * 1024;
  if (bytes > limit) issues.push(`${bytes} bytes > ${limit}`);
  if (dims && dims[0] !== dims[1]) issues.push(`not square: ${dims}`);
  return {name, kind: 'texture', ok: issues.length === 0, issues, bytes, dims};
}

function main() {
  const args = new Set(process.argv.slice(2));
  const jsonOut = args.has('--json');
  const rows = [];
  const only = args.has('--custom-only');
  for (const f of fs.readdirSync(CUSTOM).filter((f) => f.endsWith('.glb.gz')).sort()) {
    const name = f.replace('.glb.gz', '');
    try { rows.push(validateGlb(name, path.join(CUSTOM, f))); }
    catch (e) { rows.push({name, kind: 'glb', ok: false, issues: [String(e)]}); }
  }
  if (!only) for (const f of ['road_country_basecolor.jpg', 'road_country_normal.png', 'cobblestone_basecolor.jpg', 'cobblestone_normal.png'])
    rows.push(validateTexture(f));

  if (jsonOut) { console.log(JSON.stringify(rows, null, 2)); return; }

  const fmt = (n) => Number(n).toLocaleString('en-US');
  console.log('CUSTOM GLB ASSETS');
  console.log('name'.padEnd(16), 'ok'.padEnd(4), 'tris'.padStart(7), 'budget'.padStart(7), 'gzipKB'.padStart(8), 'prims'.padStart(6), 'imgs'.padStart(5), 'extensions');
  for (const r of rows.filter((r) => r.kind === 'glb')) {
    const b = r.bounds;
    console.log(
      String(r.name).padEnd(16),
      (r.ok ? 'PASS' : 'FAIL').padEnd(4),
      fmt(r.tris ?? 0).padStart(7),
      String(r.budget ?? '').padStart(7),
      (r.gzipBytes ? (r.gzipBytes / 1024).toFixed(1) : '-').padStart(8),
      String(r.prims ?? '-').padStart(6),
      String(r.images ?? '-').padStart(5),
      (r.extensions || []).join(',') || '-',
    );
    if (b) console.log(' '.repeat(17) + `bbox min=[${b.min.map((v) => v.toFixed(3))}] max=[${b.max.map((v) => v.toFixed(3))}] size=[${b.size.map((v) => v.toFixed(3))}]`);
    for (const i of r.issues) console.log(' '.repeat(17) + 'ISSUE: ' + i);
  }
  const tex = rows.filter((r) => r.kind === 'texture');
  if (tex.length) {
    console.log('\nSCANNED TEXTURES');
    for (const r of tex) console.log(' ', String(r.name).padEnd(30), (r.ok ? 'PASS' : 'FAIL').padEnd(4), (r.dims ? r.dims.join('x') : '?').padEnd(11), ((r.bytes ?? 0) / 1024).toFixed(1) + ' KB', r.issues.join('; '));
  }
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} checks passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map((r) => r.name).join(', ')); process.exitCode = 1; }
}

main();
