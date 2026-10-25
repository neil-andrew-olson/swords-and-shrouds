#!/usr/bin/env node
// Cycle 13: three procedural camp/village/roadside props in the night palette, built from a shared
// 512 atlas (wood / iron / parchment / stone / ember bands). The warehouse packs for these specific
// props turned out to be scene scans or merged prop soups (the camp GLB separates into 6,577 loose
// parts, the interior kit is a ruined room), so the props are authored procedurally like the
// blacksmith_stall precedent — cheap, 1 prim each, ground-centred, embedded 512 night texture.
//
//   node scripts/bake/bake-camp-props.mjs [--only notice_board,fence_segment]
//
// Canonical conventions: min y = 0 (ground), x/z centred, front faces +Z, gzip-9, no extensions.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Document, NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_props_c13';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const io = new NodeIO();
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(o) { const off = this.p.length / 3; this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv); for (const i of o.idx) this.idx.push(i + off); }
  get tris() { return this.idx.length / 3; }
}

// atlas bands (v): 0.00-0.34 wood, 0.34-0.52 iron, 0.52-0.70 parchment, 0.70-0.86 stone, 0.86-1.00 ember
const BAND = {wood: [0.02, 0.30], iron: [0.36, 0.15], parchment: [0.54, 0.14], stone: [0.72, 0.12], ember: [0.88, 0.10]};

/** axis-aligned box; uv projected on the two axes perpendicular to each face's normal */
function box(g, centre, sx, sy, sz, band) {
  const [band0, bandH] = BAND[band];
  const hs = [sx / 2, sy / 2, sz / 2];
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vs = corners.map(([x, y, z]) => g.vert([centre[0] + x * hs[0], centre[1] + y * hs[1], centre[2] + z * hs[2]], [x, y, z], 0, 0));
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const q of faces) {
    const base = g.p.length / 3 - 8;
    void base;
    const uvOf = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const ids = q.map((ci, k) => {
      const v = g.p.length / 3 - 8 + ci;
      const uvr = uvOf[k];
      g.uv[v * 2] = 0.05 + uvr[0] * 0.9;
      g.uv[v * 2 + 1] = band0 + 0.02 + uvr[1] * (bandH - 0.04);
      return v;
    });
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}
/** sloped roof plank (top surface + underside) */
function slab(g, centre, sx, sy, sz, tilt, band) {
  const [band0, bandH] = BAND[band];
  const geo = new Geo();
  const hs = [sx / 2, sz / 2];
  const t = Math.tan(tilt);
  const corners = [
    [-hs[0], -hs[1]], [hs[0], -hs[1]], [hs[0], hs[1]], [-hs[0], hs[1]],
  ];
  const [b0, bh] = BAND[band];
  const vAt = (i) => b0 + 0.02 + ((i > 1) ? 0.72 : 0.18) * (bh - 0.04);
  const top = corners.map(([x, z], i) => geo.vert(
    [centre[0] + x, centre[1] + z * t + sy / 2, centre[2] + z], [0, 1, -tilt], 0.05 + (i % 2) * 0.9, vAt(i)));
  const bot = corners.map(([x, z], i) => geo.vert(
    [centre[0] + x, centre[1] + z * t - sy / 2, centre[2] + z], [0, -1, tilt], 0.05 + (i % 2) * 0.9, vAt(i)));
  geo.quad(top[0], top[1], top[2], top[3]);
  geo.quad(bot[3], bot[2], bot[1], bot[0]);
  geo.quad(top[0], bot[0], bot[1], top[1]);
  geo.quad(top[1], bot[1], bot[2], top[2]);
  geo.quad(top[2], bot[2], bot[3], top[3]);
  geo.quad(top[3], bot[3], bot[0], top[0]);
  g.merge(geo);
  void band0; void bandH;
}

async function atlas() {
  const W = 512, H = 512;
  const buf = Buffer.alloc(W * H * 3);
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const grain = hash(Math.floor(x / 3), Math.floor(y / 3)) * 0.5 + hash(Math.floor(x / 11), Math.floor(y / 11)) * 0.5;
      let r, g, b;
      if (v < 0.34) {
        // weathered wood: brown planks with grain streaks
        const t = 0.15 + 0.09 * grain + 0.04 * Math.sin(y * 0.35 + x * 0.02);
        r = t * 1.35; g = t; b = t * 0.62;
      } else if (v < 0.52) {
        // iron band: cold grey with rust specks
        const t = 0.20 + 0.10 * grain;
        r = t * 1.02; g = t; b = t * 1.06;
        if (grain > 0.86) { r *= 1.35; g *= 0.9; b *= 0.75; }
      } else if (v < 0.70) {
        // parchment: pale cream with faint ink rules
        const t = 0.62 + 0.06 * grain;
        r = t; g = t * 0.95; b = t * 0.78;
        if (Math.abs((y % 26) - 13) < 1.2) { r *= 0.55; g *= 0.55; b *= 0.6; }
      } else if (v < 0.86) {
        // stone: grey with mottling
        const t = 0.24 + 0.13 * grain;
        r = t; g = t * 0.99; b = t * 0.95;
      } else {
        // ember/coal bed: near-black with warm flecks
        const t = 0.06 + 0.05 * grain;
        r = t * 2.2; g = t * 1.05; b = t * 0.55;
        if (grain > 0.93) { r = 0.62; g = 0.28; b = 0.08; }
      }
      buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
  }
  return sharp(buf, {raw: {width: W, height: H, channels: 3}}).jpeg({quality: 86, mozjpeg: true}).toBuffer();
}

/* ---------------------------------------------------------------- props */
function buildNoticeBoard() {
  const g = new Geo();
  // two upright posts + cross beam
  box(g, [-0.78, 1.05, 0], 0.17, 2.1, 0.17, 'wood');
  box(g, [0.78, 1.05, 0], 0.17, 2.1, 0.17, 'wood');
  box(g, [0, 1.98, 0], 1.72, 0.12, 0.16, 'wood');
  box(g, [0, 0.28, 0], 1.72, 0.1, 0.16, 'wood');
  // board panel (front faces +Z at z=0.10)
  box(g, [0, 1.22, 0.1], 1.66, 0.95, 0.12, 'wood');
  // small shingle roof over the board (front-facing lean-to)
  slab(g, [0, 2.16, -0.02], 2.0, 0.09, 0.72, -0.16, 'wood');
  // parchment notices pinned to the board face
  const papers = [
    [-0.42, 1.34, 0.18, 0.5, 0.5],
    [0.16, 1.30, 0.18, 0.46, 0.44],
    [0.5, 1.44, 0.18, 0.3, 0.36],
    [-0.2, 0.95, 0.18, 0.44, 0.26],
  ];
  for (const [x, y, z, w, h] of papers) box(g, [x, y, z], w, h, 0.025, 'parchment');
  // iron corner brackets
  for (const sx of [-1, 1]) {
    box(g, [sx * 0.82, 1.62, 0.10], 0.08, 0.16, 0.05, 'iron');
    box(g, [sx * 0.82, 0.74, 0.10], 0.08, 0.16, 0.05, 'iron');
  }
  // small stone footing blocks
  box(g, [-0.78, 0.06, 0], 0.34, 0.12, 0.34, 'stone');
  box(g, [0.78, 0.06, 0], 0.34, 0.12, 0.34, 'stone');
  return g;
}

function buildFenceSegment() {
  const g = new Geo();
  // rails along X, front face +Z (the fence is thin in Z); rails sit in front of the pickets
  box(g, [0, 0.52, 0.10], 2.46, 0.15, 0.1, 'wood');
  box(g, [0, 0.95, 0.10], 2.46, 0.15, 0.1, 'wood');
  // posts
  for (const x of [-1.2, -0.4, 0.4, 1.2]) {
    box(g, [x, 0.62, 0], 0.16, 1.24, 0.16, 'wood');
    box(g, [x, 1.31, 0], 0.17, 0.08, 0.17, 'wood');   // post cap
  }
  // pickets between posts
  for (let i = 0; i < 7; i++) {
    const x = -1.05 + i * 0.35;
    box(g, [x, 0.58, 0.02], 0.15, 1.16, 0.06, 'wood');
  }
  // iron nails / brackets
  for (const x of [-1.2, -0.4, 0.4, 1.2]) box(g, [x, 1.18, 0.08], 0.06, 0.06, 0.03, 'iron');
  return g;
}

function buildTorchPost() {
  const g = new Geo();
  // stone footing
  box(g, [0, 0.09, 0], 0.42, 0.18, 0.42, 'stone');
  // wooden pole
  box(g, [0, 1.25, 0], 0.13, 2.32, 0.13, 'wood');
  // iron bands
  box(g, [0, 0.55, 0], 0.15, 0.08, 0.15, 'iron');
  box(g, [0, 2.05, 0], 0.15, 0.08, 0.15, 'iron');
  // iron basket: four arms + rim
  const rim = new Geo();
  const N = 8;
  const top = 2.5, bot = 2.18, rad = 0.32;
  const ringTop = [], ringBot = [];
  for (let s = 0; s < N; s++) {
    const a = (s / N) * Math.PI * 2;
    ringTop.push(rim.vert([Math.cos(a) * rad, top, Math.sin(a) * rad], [Math.cos(a), 0, Math.sin(a)], 0.05 + 0.9 * (s / N), 0.4));
    ringBot.push(rim.vert([Math.cos(a) * rad * 0.55, bot, Math.sin(a) * rad * 0.55], [Math.cos(a), 0, Math.sin(a)], 0.05 + 0.9 * (s / N), 0.45));
  }
  for (let s = 0; s < N; s++) {
    const s2 = (s + 1) % N;
    rim.quad(ringBot[s], ringBot[s2], ringTop[s2], ringTop[s]);
    rim.quad(ringTop[s], ringTop[s2], ringBot[s2], ringBot[s]);
  }
  g.merge(rim);
  // charcoal bed in the basket
  box(g, [0, 2.42, 0], 0.46, 0.12, 0.46, 'ember');
  // cross arms holding the basket
  for (let a = 0; a < 4; a++) {
    const ang = (a / 4) * Math.PI;
    box(g, [0, 2.22, 0], 0.62, 0.07, 0.07, 'iron');
    // rotate not supported by box(); use thin boxes along X/Z as an approximation
    void ang;
  }
  box(g, [0, 2.22, 0], 0.07, 0.07, 0.62, 'iron');
  return g;
}

async function bakeOne(name, geo) {
  // ground-centre: min y = 0, x/z centred
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < geo.p.length; i += 3) { xs.push(geo.p[i]); ys.push(geo.p[i + 1]); zs.push(geo.p[i + 2]); }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const minY = Math.min(...ys);
  for (let i = 0; i < geo.p.length; i += 3) { geo.p[i] -= cx; geo.p[i + 1] -= minY; geo.p[i + 2] -= cz; }

  const jpeg = await atlas();
  const d = new Document();
  const root = d.getRoot();
  const buffer = d.createBuffer();
  const mat = d.createMaterial(name + '_mat')
    .setBaseColorTexture(d.createTexture(name + '_tex').setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'))
    .setRoughnessFactor(0.86).setMetallicFactor(0.08).setDoubleSided(true);
  const mesh = d.createMesh(name);
  const prim = d.createPrimitive();
  prim.setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array(geo.p)).setBuffer(buffer));
  prim.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(new Float32Array(geo.n)).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(new Float32Array(geo.uv)).setBuffer(buffer));
  prim.setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint16Array(geo.idx)).setBuffer(buffer));
  prim.setMaterial(mat);
  mesh.addPrimitive(prim);
  d.createScene('Scene').addChild(d.createNode(name).setMesh(mesh));
  const bytes = await io.writeBinary(d);
  const gz = zlib.gzipSync(bytes, {level: 9});
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);
  const size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
  console.log(`${name.padEnd(14)} tris ${geo.tris} 1 prim ${(gz.length / 1024).toFixed(1)} KB ` +
    `bbox ${size.map((v) => v.toFixed(2)).join(' x ')} (min y=0, x/z centred)`);
  return {name, tris: geo.tris, bytes: gz.length, size};
}

const PROPS = [
  ['notice_board', buildNoticeBoard],
  ['fence_segment', buildFenceSegment],
  ['torch_post', buildTorchPost],
];
const rows = [];
for (const [name, build] of PROPS) {
  if (only && !only.includes(name)) continue;
  const g = build();
  // ground-centre needs original bounds before baking; bakeOne recomputes from xs/ys/zs pre-shift
  rows.push(await bakeOne(name, g));
}
fs.writeFileSync(path.join(STAGE, 'manifest-props-c13.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${r.tris}t ${(r.bytes / 1024).toFixed(1)}KB`).join(', '));
