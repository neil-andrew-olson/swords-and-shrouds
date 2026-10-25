#!/usr/bin/env node
// Cycle 14: procedural windmill tower + animated sail assembly in the night palette.
//   node scripts/bake/bake-windmill.mjs [--only windmill,windmill_sails]
//
// Conventions:
//   windmill        ground-centred (min y = 0, x/z centred), front (door) faces +Z, ~9.6 m tall
//   windmill_sails  hub pivot at local origin (0,0,0), 4 blades in the XY plane (thin in Z),
//                   so the client animates a single rotation about the LOCAL Z AXIS and mounts the
//                   group at the tower front (z ~ +2.3) at hub height y ~ 7.2
// Both: one primitive, 512^2 embedded night-palette atlas, gzip-9, KHR_mesh_quantization only, no lights.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Document, NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {dedup, prune, quantize} from '../custom-assets/node_modules/@gltf-transform/functions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_windmill';
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
const TAU = Math.PI * 2;
// atlas bands (v): 0.00-0.34 stone, 0.34-0.58 wood, 0.58-0.76 canvas/thatch, 0.76-0.90 iron, 0.90-1.00 dark
const BAND = {stone: [0.03, 0.28], wood: [0.37, 0.18], canvas: [0.61, 0.12], iron: [0.79, 0.08], dark: [0.93, 0.05]};

/** UV helper: place a quad's uv inside a band with a small repeat */
function bandUV(band, u0, u1, v0, v1) {
  const [b, h] = BAND[band];
  return [u0, u1, b + h * v0, b + h * v1];
}

/** tapered n-sided prism between two rings (ground r0 -> top r1); closed top/bottom */
function prism(g, y0, y1, r0, r1, sides, band, cx = 0, cz = 0) {
  const [b, h] = BAND[band];
  const low = [], high = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const uvS = 0.05 + 0.9 * (s / sides);
    low.push(g.vert([cx + ca * r0, y0, cz + sa * r0], [ca, 0, sa], uvS, b + 0.02));
    high.push(g.vert([cx + ca * r1, y1, cz + sa * r1], [ca, 0, sa], uvS, b + h * 0.9));
  }
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    g.quad(low[s], low[s2], high[s2], high[s]);
  }
  void h;
  return {low, high};
}

/** flat n-sided ring (e.g. gallery deck) with inner/outer radius at a given height */
function ring(g, y, rIn, rOut, sides, band, height = 0.16) {
  const [b, h] = BAND[band];
  const inTop = [], outTop = [], outBot = [], inBot = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const uvS = 0.05 + 0.9 * (s / sides);
    inTop.push(g.vert([ca * rIn, y + height, sa * rIn], [0, 1, 0], uvS, b + 0.02));
    outTop.push(g.vert([ca * rOut, y + height, sa * rOut], [0, 1, 0], uvS, b + h * 0.45));
    outBot.push(g.vert([ca * rOut, y, sa * rOut], [ca, 0, sa], uvS, b + h * 0.6));
    inBot.push(g.vert([ca * rIn, y, sa * rIn], [-ca, 0, -sa], uvS, b + h * 0.8));
  }
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    g.quad(inTop[s], outTop[s], outTop[s2], inTop[s2]);   // deck top
    g.quad(outTop[s], outTop[s2], outBot[s2], outBot[s]); // outer edge
    g.quad(outBot[s], outBot[s2], inBot[s2], inBot[s]);   // underside
  }
}

/** axis-aligned box with per-face band uv (front = +Z) */
function box(g, c, sx, sy, sz, band) {
  const [b0, bh] = BAND[band];
  const hs = [sx / 2, sy / 2, sz / 2];
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vs = corners.map(([x, y, z]) => g.vert([c[0] + x * hs[0], c[1] + y * hs[1], c[2] + z * hs[2]], [x, y, z], 0, 0));
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  const uvOf = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
  for (const q of faces) {
    const ids = q.map((ci, k) => {
      const v = vs[ci];
      g.uv[v * 2] = uvOf[k][0];
      g.uv[v * 2 + 1] = b0 + 0.02 + uvOf[k][1] * (bh - 0.04);
      return v;
    });
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

/** box rotated about the Z axis (used by the sails) */
function rotBox(g, angle, u0, u1, v0, v1, z0, z1, band) {
  const [b0, bh] = BAND[band];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const P = (u, v, z) => [u * ca - v * sa, u * sa + v * ca, z];
  const corners = [[u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0],
    [u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]];
  const vs = corners.map(([u, v, z]) => g.vert(P(u, v, z), P(u, v, 0), 0, 0));
  const uvOf = [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const q of faces) {
    const ids = q.map((ci, k) => {
      const v = vs[ci];
      g.uv[v * 2] = uvOf[k][0];
      g.uv[v * 2 + 1] = b0 + 0.02 + uvOf[k][1] * (bh - 0.04);
      return v;
    });
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

/** thin quad in the plane z=const (sail cloth) */
function quadZ(g, angle, u0, u1, v0, v1, z, band) {
  const [b0, bh] = BAND[band];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const P = (u, v) => [u * ca - v * sa, u * sa + v * ca, z];
  const a = g.vert(P(u0, v0), [0, 0, 1], 0.08, b0 + 0.05);
  const b = g.vert(P(u1, v0), [0, 0, 1], 0.9, b0 + 0.05);
  const c = g.vert(P(u1, v1), [0, 0, 1], 0.9, b0 + bh - 0.05);
  const d = g.vert(P(u0, v1), [0, 0, 1], 0.08, b0 + bh - 0.05);
  g.quad(a, b, c, d);
  const a2 = g.vert(P(u0, v0), [0, 0, -1], 0.08, b0 + 0.05);
  const b2 = g.vert(P(u0, v1), [0, 0, -1], 0.08, b0 + bh - 0.05);
  const c2 = g.vert(P(u1, v1), [0, 0, -1], 0.9, b0 + bh - 0.05);
  const d2 = g.vert(P(u1, v0), [0, 0, -1], 0.9, b0 + 0.05);
  g.quad(a2, b2, c2, d2);
}

async function atlas() {
  const W = 512, H = 512;
  const buf = Buffer.alloc(W * H * 3);
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const grain = hash(Math.floor(x / 2), Math.floor(y / 2)) * 0.5 + hash(Math.floor(x / 9), Math.floor(y / 9)) * 0.5;
      let r, g, b;
      if (v < 0.34) {
        // weathered stone: cool grey with mortar-ish mottling
        const t = 0.20 + 0.11 * grain + 0.03 * Math.sin(y * 0.6 + x * 0.05);
        r = t; g = t * 0.99; b = t * 1.03;
      } else if (v < 0.58) {
        // timber: brown planks with grain
        const t = 0.15 + 0.08 * grain + 0.035 * Math.sin(y * 0.3 + x * 0.02);
        r = t * 1.34; g = t; b = t * 0.62;
      } else if (v < 0.76) {
        // canvas/thatch: pale warm grey
        const t = 0.36 + 0.09 * grain;
        r = t; g = t * 0.92; b = t * 0.72;
      } else if (v < 0.90) {
        // iron: dark blue-grey with rust
        const t = 0.14 + 0.07 * grain;
        r = t * 1.05; g = t * 1.02; b = t * 1.1;
        if (grain > 0.9) { r *= 1.5; g *= 0.95; b *= 0.8; }
      } else {
        // dark recess (windows / door depth)
        const t = 0.045 + 0.03 * grain;
        r = t; g = t; b = t * 1.1;
      }
      buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
  }
  return sharp(buf, {raw: {width: W, height: H, channels: 3}}).jpeg({quality: 86, mozjpeg: true}).toBuffer();
}

/* ---------------------------------------------------------------- windmill tower */
function buildTower() {
  const g = new Geo();
  const H = 9.6;
  // stone plinth + tapered tower shaft (12-sided)
  prism(g, 0, 0.55, 2.95, 2.85, 12, 'stone');
  prism(g, 0.55, 6.95, 2.8, 2.15, 12, 'stone');
  // timber banding rings around the shaft
  for (const y of [2.4, 4.4]) {
    ring(g, y, 2.3, 2.62, 12, 'wood', 0.14);
  }
  // door (front +Z), iron frame + hinges + step
  box(g, [0, 1.15, 2.72], 1.25, 2.3, 0.18, 'dark');
  box(g, [0, 1.15, 2.78], 1.45, 2.5, 0.1, 'wood');
  box(g, [0, 0.12, 2.9], 1.8, 0.24, 0.7, 'stone');
  for (const y of [0.75, 1.55]) box(g, [0, y, 2.84], 1.1, 0.09, 0.06, 'iron');
  // windows: dark recesses on the four sides
  const windows = [
    [0, 3.3, 2.35], [0, 5.1, 2.2], [1.9, 4.0, 0.55], [-1.7, 5.9, -1.1], [0.1, 6.2, 1.95],
  ];
  for (const [x, y, z] of windows) {
    box(g, [x, y, z], 0.52, 0.7, 0.12, 'dark');
    box(g, [x, y - 0.42, z + 0.02], 0.64, 0.1, 0.16, 'wood');
  }
  // timber cross-bracing on the visible front faces
  for (const sgn of [1, -1]) {
    box(g, [sgn * 1.5, 3.3, 1.55], 0.12, 2.6, 0.12, 'wood');
  }
  // gallery deck + railing around the top of the shaft
  ring(g, 6.9, 1.95, 3.05, 16, 'wood', 0.2);
  for (let s = 0; s < 16; s++) {
    const a = (s / 16) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    box(g, [ca * 2.95, 7.62, sa * 2.95], 0.12, 1.0, 0.12, 'wood');
  }
  ring(g, 7.95, 2.86, 3.05, 16, 'wood', 0.1);
  ring(g, 7.35, 2.86, 3.05, 16, 'wood', 0.08);
  // cap: conical roof with overhang + finial
  prism(g, 7.05, 7.25, 2.45, 2.9, 16, 'wood');
  prism(g, 7.25, 8.95, 2.55, 0.18, 16, 'canvas');
  box(g, [0, 9.25, 0], 0.16, 1.1, 0.16, 'wood');
  box(g, [0, 9.85, 0], 0.3, 0.12, 0.3, 'iron');
  // small front porch roof over the door
  box(g, [0, 2.5, 2.95], 2.2, 0.12, 0.9, 'wood');
  for (const sgn of [1, -1]) box(g, [sgn * 0.95, 1.9, 2.85], 0.12, 1.25, 0.12, 'wood');
  return g;
}

/* ---------------------------------------------------------------- sail assembly */
function buildSails() {
  const g = new Geo();
  // hub: 12-sided drum + iron cap + square boss
  prism(g, -0.16, 0.16, 0.34, 0.34, 12, 'iron');
  box(g, [0, 0, 0.2], 0.62, 0.62, 0.12, 'iron');
  box(g, [0, 0, 0], 0.9, 0.18, 0.18, 'wood');
  box(g, [0, 0, 0], 0.18, 0.9, 0.18, 'wood');
  const R0 = 0.4, R1 = 4.6;
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + (i / 4) * TAU;   // X-shaped: 45, 135, 225, 315 degrees
    // main spar (wood) + iron tip
    rotBox(g, ang, R0, R1, -0.09, 0.09, -0.07, 0.07, 'wood');
    rotBox(g, ang, R1 - 0.12, R1 + 0.12, -0.1, 0.1, -0.08, 0.08, 'iron');
    // two long sail rails outboard of the spar
    for (const side of [-1, 1]) {
      rotBox(g, ang, R0 + 0.3, R1 - 0.2, side * 0.62 - 0.05, side * 0.62 + 0.05, -0.05, 0.05, 'wood');
    }
    // cross ribs between rails + canvas panels
    const ribs = [R0 + 0.55, R0 + 1.15, R0 + 1.75, R0 + 2.35, R0 + 2.95, R1 - 0.3];
    for (const r of ribs) {
      rotBox(g, ang, r - 0.045, r + 0.045, -0.66, 0.66, -0.05, 0.05, 'wood');
    }
    for (let k = 0; k < ribs.length - 1; k++) {
      const a0 = ribs[k] + 0.06, a1 = ribs[k + 1] - 0.06;
      quadZ(g, ang, a0, a1, -0.58, 0.58, 0.0, 'canvas');
    }
    // brace from spar to rail (leading edge)
    rotBox(g, ang, R0 + 0.35, R0 + 0.8, -0.6, 0.6, -0.04, 0.04, 'wood');
  }
  return g;
}

async function bakeOne(name, geo, pivotMode) {
  // pivotMode: 'ground' -> min y = 0 and x/z centred; 'hub' -> bbox centred on the local origin
  {
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < geo.p.length; i += 3) { xs.push(geo.p[i]); ys.push(geo.p[i + 1]); zs.push(geo.p[i + 2]); }
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const cy = pivotMode === 'ground' ? Math.min(...ys) : (Math.min(...ys) + Math.max(...ys)) / 2;
    for (let i = 0; i < geo.p.length; i += 3) { geo.p[i] -= cx; geo.p[i + 1] -= cy; geo.p[i + 2] -= cz; }
  }
  const jpeg = await atlas();
  const d = new Document();
  const root = d.getRoot();
  const buffer = d.createBuffer();
  const mat = d.createMaterial(name + '_mat')
    .setBaseColorTexture(d.createTexture(name + '_tex').setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'))
    .setRoughnessFactor(0.9).setMetallicFactor(0.05).setDoubleSided(true);
  const mesh = d.createMesh(name);
  const prim = d.createPrimitive();
  prim.setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array(geo.p)).setBuffer(buffer));
  prim.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(new Float32Array(geo.n)).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(new Float32Array(geo.uv)).setBuffer(buffer));
  prim.setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint16Array(geo.idx)).setBuffer(buffer));
  prim.setMaterial(mat);
  mesh.addPrimitive(prim);
  d.createScene('Scene').addChild(d.createNode(name).setMesh(mesh));
  await d.transform(quantize({quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12}));
  await d.transform(dedup(), prune({keepAttributes: true}));
  const gz = zlib.gzipSync(await io.writeBinary(d), {level: 9});
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);

  const xs = [], ys = [], zs = [];
  for (let i = 0; i < geo.p.length; i += 3) { xs.push(geo.p[i]); ys.push(geo.p[i + 1]); zs.push(geo.p[i + 2]); }
  const bbox = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
  const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)];
  console.log(`${name.padEnd(15)} tris ${geo.tris}  1 prim  ${(gz.length / 1024).toFixed(1)} KB  ` +
    `bbox ${bbox.map((v) => v.toFixed(2)).join(' x ')}  min ${min.map((v) => v.toFixed(2)).join(',')}`);
  return {name, tris: geo.tris, bytes: gz.length, bbox, min};
}

const rows = [];
if (!only || only.includes('windmill')) rows.push(await bakeOne('windmill', buildTower(), 'ground'));
if (!only || only.includes('windmill_sails')) rows.push(await bakeOne('windmill_sails', buildSails(), 'hub'));
fs.writeFileSync(path.join(STAGE, 'manifest-windmill.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${r.tris}t ${(r.bytes / 1024).toFixed(1)}KB`).join(', '));
