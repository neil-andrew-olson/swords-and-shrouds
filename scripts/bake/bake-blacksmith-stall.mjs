#!/usr/bin/env node
// Phase B: procedural blacksmith_stall (forge hearth + anvil + canopy + tool rack), ground-centred,
// embedded 512 atlas. The warehouse "medieval-props low-poly" candidate turned out to be a chest, so
// the stall is built procedurally (cheap, ~600 tris) in the same night palette as the other props.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_props';
const io = new NodeIO();
fs.mkdirSync(path.join(STAGE, 'custom'), { recursive: true });

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) { this.p.push(...p); this.n.push(...n); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(o) { const off = this.p.length / 3; this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv); for (const i of o.idx) this.idx.push(i + off); }
  get tris() { return this.idx.length / 3; }
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function box(g, c, sx, sy, sz, band) {
  const hs = [sx / 2, sy / 2, sz / 2];
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vs = corners.map(([x, y, z]) => g.vert([c[0] + x * hs[0], c[1] + y * hs[1], c[2] + z * hs[2]],
    [x, y, z], 0.05 + band * 0.3, 0.1));
  const faces = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const q of faces) g.quad(vs[q[0]], vs[q[1]], vs[q[2]], vs[q[3]]);
  void band;
}

async function atlas() {
  const W = 512, H = 512;
  const buf = Buffer.alloc(W * H * 3);
  // bands: v 0..0.4 stone, 0.4..0.7 wood, 0.7..1 iron/anvil
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let r, g, b;
      const n = Math.sin(x * 0.07 + y * 0.11) * 0.5 + 0.5;
      const n2 = Math.sin(x * 0.31 + y * 0.17) * 0.5 + 0.5;
      if (v < 0.4) { const t = 0.26 + 0.16 * n + 0.05 * n2; r = t; g = t * 0.99; b = t * 0.95; }
      else if (v < 0.7) { const t = 0.16 + 0.09 * n + 0.03 * n2; r = t * 1.25; g = t; b = t * 0.7; }
      else { const t = 0.22 + 0.12 * n; r = t; g = t; b = t * 1.05; }
      buf[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      buf[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      buf[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function main() {
  const g = new Geo();
  // stone hearth base + fire bowl
  box(g, [0, 0.45, 0], 1.7, 0.9, 1.4, 0);
  box(g, [0, 0.95, 0], 1.3, 0.25, 1.0, 0);
  box(g, [0, 1.15, 0], 0.8, 0.18, 0.6, 2);         // anvil block base (iron band)
  box(g, [0, 1.32, 0], 1.1, 0.16, 0.45, 2);        // anvil
  // back wall with chimney
  box(g, [0, 1.75, -0.75], 1.9, 1.4, 0.3, 0);
  box(g, [0.55, 2.6, -0.75], 0.55, 0.9, 0.55, 0);
  // canopy posts + sloped roof
  const post = (x, z) => box(g, [x, 1.35, z], 0.16, 2.7, 0.16, 1);
  post(-1.5, 1.1); post(1.5, 1.1); post(-1.5, -0.4); post(1.5, -0.4);
  const roof = new Geo();
  const top = [[-1.9, 2.75, -0.9], [1.9, 2.75, -0.9], [1.9, 2.55, 1.35], [-1.9, 2.55, 1.35]];
  const vs = top.map((p) => roof.vert(p, [0, 1, 0.2], 0.2, 0.75));
  roof.quad(vs[0], vs[1], vs[2], vs[3]);
  // thatch underside
  const vs2 = top.map((p) => roof.vert([p[0], p[1] - 0.12, p[2]], [0, -1, 0], 0.2, 0.6));
  roof.quad(vs2[3], vs2[2], vs2[1], vs2[0]);
  g.merge(roof);
  // tool rack: two posts + crossbar + three tools
  box(g, [1.05, 1.1, 0.95], 0.1, 2.2, 0.1, 1);
  box(g, [1.75, 1.1, 0.95], 0.1, 2.2, 0.1, 1);
  box(g, [1.4, 2.1, 0.95], 0.9, 0.1, 0.1, 1);
  for (let i = 0; i < 3; i++) box(g, [1.15 + i * 0.25, 1.8, 0.95], 0.06, 0.6, 0.06, 2);

  const jpeg = await atlas();
  const doc = new NodeIO().createDocument ? new NodeIO().createDocument() : null;
  void doc;
  const { Document } = await import('../custom-assets/node_modules/@gltf-transform/core/dist/index.js');
  const d = new Document();
  const root = d.getRoot();
  const buffer = d.createBuffer();
  const mat = d.createMaterial('blacksmith_stall_mat')
    .setBaseColorTexture(d.createTexture('blacksmith_stall_tex').setImage(new Uint8Array(jpeg)).setMimeType('image/jpeg'))
    .setRoughnessFactor(0.85).setMetallicFactor(0.1).setDoubleSided(true);
  const mesh = d.createMesh('blacksmith_stall');
  const prim = d.createPrimitive();
  prim.setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(new Float32Array(g.p)).setBuffer(buffer));
  prim.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(new Float32Array(g.n)).setBuffer(buffer));
  prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer));
  prim.setIndices(d.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.idx)).setBuffer(buffer));
  prim.setMaterial(mat);
  mesh.addPrimitive(prim);
  const node = d.createNode('blacksmith_stall').setMesh(mesh);
  d.createScene('Scene').addChild(node);
  const bytes = await new NodeIO().writeBinary(d);
  const gz = zlib.gzipSync(bytes, { level: 9 });
  fs.writeFileSync(path.join(STAGE, 'custom', 'blacksmith_stall.glb.gz'), gz);
  const xs = []; const ys = []; const zs = [];
  for (let i = 0; i < g.p.length; i += 3) { xs.push(g.p[i]); ys.push(g.p[i + 1]); zs.push(g.p[i + 2]); }
  const size = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)];
  console.log(`blacksmith_stall: ${g.tris} tris, 1 prim, ${(gz.length / 1024).toFixed(1)} KB, size ${size.map((v) => v.toFixed(2)).join(' x ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
