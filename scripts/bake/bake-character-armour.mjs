#!/usr/bin/env node
// Cycle-4 Phase A: full armour silhouettes per player/companion body.
//
// Every appearance gets ONE extra skinned primitive (all armour pieces merged) rigid-weighted to the
// appropriate Mixamo joints, fitted procedurally in the mesh's bind space around the exact joint
// pivots (solved from the inverse-bind matrices). Body geometry/weights/clips/skin are untouched;
// the small cycle-2 add-ons are replaced by this richer set (no duplicates). Each body gets its own
// 512 procedural armour atlas (metal / cloth / accent bands).
//
//   node scripts/bake/bake-character-armour.mjs [--only templar,hero] [--force]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import {KHRMeshQuantization} from '../custom-assets/node_modules/@gltf-transform/extensions/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';

const GAME = 'C:/Users/neil/Desktop/AIprojects/neilandrew.dev/.game-build';
const WORK = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/armour';
const BASE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_atlas2/custom';
const STAGE = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_armour';
const BUDGET_TRIS = 15500;
const BUDGET_BYTES = 900 * 1024;
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
fs.mkdirSync(WORK, {recursive: true});
fs.mkdirSync(path.join(STAGE, 'custom'), {recursive: true});
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const sha = (b) => createHash('sha1').update(Buffer.from(b)).digest('hex');
const gzip9 = (b) => zlib.gzipSync(b, {level: 9});

/* ---------------------------------------------------------------- vector helpers */
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
let seed = 987654321;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }
  vert(p, n, u, v) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  merge(o) {
    const off = this.p.length / 3;
    this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv);
    for (const i of o.idx) this.idx.push(i + off);
  }
  get tris() { return this.idx.length / 3; }
}

/* ---------------------------------------------------------------- geometry builders */
function basisFrom(axis) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(helper, a));
  const y = cross(a, x);
  return {axis: a, x, y};
}

/** revolved profile around an axis: profile = [{t, r}] from top (t=0) to bottom (t=1) */
function lathe(geo, centre, basis, profile, segs = 12, half = false) {
  const rings = profile.map(({t, r}) => {
    const c = add(centre, mul(basis.axis, t));
    const row = [];
    const n = half ? Math.floor(segs / 2) + 1 : segs;
    for (let s = 0; s < n; s++) {
      const ang = (s / segs) * Math.PI * 2 + (half ? Math.PI * 0.5 : 0);
      const dir = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
      const rr = r * (0.92 + 0.16 * Math.sin(ang * 3 + t * 4));
      row.push(geo.vert(add(c, mul(dir, rr)), norm(add(dir, mul(basis.axis, 0.1))), s / segs, t));
    }
    return row;
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const n = half ? Math.floor(segs / 2) : segs - 1;
    for (let s = 0; s < n; s++) geo.quad(rings[i][s], rings[i][s + 1], rings[i + 1][s + 1], rings[i + 1][s]);
  }
  return rings;
}

/** dome / bell cap around a centre */
function dome(geo, centre, basis, radius, height, segs = 12, rows = 5) {
  const profile = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    profile.push({t: -height * Math.cos(t * Math.PI * 0.5), r: radius * Math.sin(t * Math.PI * 0.5)});
  }
  lathe(geo, centre, basis, profile, segs);
}

function frustum(geo, a, b, r0, r1, sides = 8) {
  const axis = norm(sub(b, a));
  const basis = basisFrom(axis);
  const ring = (c, r) => {
    const row = [];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const dir = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
      row.push(geo.vert(add(c, mul(dir, r)), dir, s / sides, 0));
    }
    return row;
  };
  const r0row = ring(a, r0), r1row = ring(b, r1);
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    geo.quad(r0row[s], r0row[s2], r1row[s2], r1row[s]);
  }
}

/** draped sheet from top edge hanging down (cloak / tabard) */
function sheet(geo, top, width, height, right, down, back, cols = 8, rows = 8, bow = 0.6, flare = 0.35) {
  const grid = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const row = [];
    for (let c = 0; c <= cols; c++) {
      const u = c / cols - 0.5;
      const p = add(add(top, mul(right, u * width * (1 + flare * t))), mul(down, -height * t));
      const p2 = add(p, mul(back, Math.sin(t * Math.PI) * bow + t * t * 0.8));
      row.push(geo.vert(p2, norm(add(back, mul(down, -0.15 * t))), c / cols, 1 - t));
    }
    grid.push(row);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) geo.quad(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]);
}

function box(geo, centre, basis, sx, sy, sz) {
  const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vs = c.map(([x, y, z]) => geo.vert(
    add(centre, add(add(mul(basis.x, x * sx * 0.5), mul(basis.y, y * sy * 0.5)), mul(basis.axis, z * sz * 0.5))),
    norm(add(add(mul(basis.x, x), mul(basis.y, y)), mul(basis.axis, z))), 0.5, 0.5));
  const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  for (const q of f) geo.quad(vs[q[0]], vs[q[1]], vs[q[2]], vs[q[3]]);
}

function spike(geo, base, dir, length, radius, sides = 6) {
  const basis = basisFrom(dir);
  const ring = [];
  for (let s = 0; s < sides; s++) {
    const ang = (s / sides) * Math.PI * 2;
    const d = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
    ring.push(geo.vert(add(base, mul(d, radius)), d, s / sides, 0));
  }
  const tip = geo.vert(add(base, mul(norm(dir), length)), norm(dir), 0.5, 1);
  for (let s = 0; s < sides; s++) geo.tri(ring[s], ring[(s + 1) % sides], tip);
}

/* ---------------------------------------------------------------- per-body armour sets */
const ARMOUR = {
  templar: {
    palette: {metal: [0.72, 0.70, 0.65], cloth: [0.84, 0.82, 0.74], accent: [0.82, 0.62, 0.22]},
    pieces: ['greathelm', 'cuirass', 'tabard', 'largePauldrons', 'bracers', 'belt'],
  },
  hero: {
    palette: {metal: [0.68, 0.70, 0.74], cloth: [0.32, 0.35, 0.42], accent: [0.62, 0.54, 0.36]},
    pieces: ['visoredHelm', 'knightCuirass', 'layeredPauldrons', 'bracers', 'belt'],
  },
  ally: {
    palette: {metal: [0.52, 0.60, 0.74], cloth: [0.22, 0.28, 0.40], accent: [0.60, 0.68, 0.84]},
    pieces: ['plainHelm', 'cuirass', 'tabard', 'largePauldrons', 'bracers'],
  },
  berserker: {
    palette: {metal: [0.48, 0.17, 0.17], cloth: [0.26, 0.18, 0.12], accent: [0.50, 0.46, 0.44]},
    pieces: ['hornedHelm', 'bracers', 'furShoulder', 'belt'],
  },
  ranger: {
    palette: {metal: [0.30, 0.38, 0.20], cloth: [0.16, 0.22, 0.13], accent: [0.52, 0.38, 0.18]},
    pieces: ['hood', 'longCloak', 'leatherCuirass', 'quiver', 'bracers'],
  },
  survivor: {
    // ragged camp survivor: no plate at all, patched cloth layers, bedroll/pack, walking staff,
    // rope belt ??? faded browns/tans with orange-red patch accents (distinct from the soldier bodies)
    palette: {metal: [0.34, 0.30, 0.24], cloth: [0.42, 0.36, 0.27], accent: [0.60, 0.30, 0.14]},
    pieces: ['tatteredHood', 'tatteredCloak', 'survivorPack', 'ropeBelt', 'walkingStaff'],
  },
  fallen: {
    palette: {metal: [0.34, 0.25, 0.44], cloth: [0.12, 0.10, 0.16], accent: [0.40, 0.34, 0.42]},
    pieces: ['crestHelm', 'backPlate', 'spikedPauldrons', 'bracers'],
  },
};

/* ---------------------------------------------------------------- armour atlas (hue-rich albedo + normal/ORM) */
function hsv(h, s, v) {
  // h,s,v in 0..1 -> rgb 0..1
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
function hueShift(rgb, dh, ds, dv) {
  // approximate: convert to HSV then shift
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = ((h / 6) + dh + 1) % 1;
  const s = Math.min(1, Math.max(0, (max ? d / max : 0) + ds));
  const v = Math.min(1, Math.max(0, max + dv));
  return hsv(h, s, v);
}

async function makeAtlas(palette, dim = 1024) {
  const W = dim, H = dim;
  const NW = 256, NH = 256;
  const hash = (x, y) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const smooth = (x, y, s) => {
    const fx = x * s, fy = y * s;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
  const metal = palette.metal, cloth = palette.cloth, accent = palette.accent;
  const metalDark = metal.map((c) => c * 0.55);
  const metalLight = metal.map((c) => Math.min(1, c * 1.3));
  // hue-separated patina / rust / oxide / trim colours
  const patina = hueShift(metal, 0.42, 0.35, -0.12);     // teal-green patina
  const rust = hueShift(metal, 0.06, 0.55, -0.18);       // warm rust
  const oxide = hueShift(metal, -0.05, 0.18, -0.22);     // dark blue oxide
  const rustLight = hueShift(metal, 0.08, 0.75, 0.15);   // bright rust flakes
  const rivetGold = hueShift(accent, 0.02, 0.55, 0.28);
  const clothDark = cloth.map((c) => c * 0.6);
  const clothLight = cloth.map((c) => Math.min(1, c * 1.28));
  const stainBrown = hueShift(cloth, 0.05, 0.45, -0.14);
  const stainOlive = hueShift(cloth, 0.20, 0.40, -0.06);
  const stainPurple = hueShift(cloth, 0.72, 0.35, -0.10);
  const accentDark = accent.map((c) => c * 0.5);
  const accentLight = accent.map((c) => Math.min(1, c * 1.35));
  const accentAlt = hueShift(accent, 0.45, 0.55, 0.05);  // contrasting heraldic hue
  const accentCream = [0.78, 0.74, 0.64];
  const height = new Float32Array(NW * NH);
  const albedo = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const u = x / W;
      const grain = (hash(x, y) - 0.5) * 0.03;
      const mott1 = smooth(u, v, 7);
      const mott2 = smooth(u, v, 19);
      const mott3 = smooth(u, v, 41);
      const hi = (Math.min(NH - 1, Math.floor(y * NH / H)) * NW) + Math.min(NW - 1, Math.floor(x * NW / W));
      let col;
      if (v < 0.42) {
        // ---------------- plate: steel tones + patina/rust/oxide patches + gold rivets/trim
        const mix = mott1;
        let base = [
          metalDark[0] + (metalLight[0] - metalDark[0]) * mix,
          metalDark[1] + (metalLight[1] - metalDark[1]) * mix,
          metalDark[2] + (metalLight[2] - metalDark[2]) * mix,
        ];
        const seam = 1.0;
        const rivet = 0;
        const trim = false;
        let k = (0.92 + grain) * seam;
        base = [base[0] * k, base[1] * k, base[2] * k];
        if (mott2 > 0.72) { const t = Math.min(1, (mott2 - 0.72) * 3.2); base = base.map((c, ci) => c * (1 - t) + patina[ci] * t); }
        if (mott3 > 0.78) { const t = Math.min(1, (mott3 - 0.78) * 3.0); base = base.map((c, ci) => c * (1 - t) + rust[ci] * t); }
        if (mott2 < 0.16) { const t = Math.min(1, (0.16 - mott2) * 3.0); base = base.map((c, ci) => c * (1 - t) + oxide[ci] * t); }
        if (grain > 0.055) { base = base.map((c, ci) => c * 0.9 + rustLight[ci] * 0.12); }
        if (rivet) base = base.map((c, ci) => c * 0.55 + rivetGold[ci] * 0.42);
        if (trim) base = base.map((c, ci) => c * 0.78 + accentLight[ci] * 0.22);
        col = base;
        height[hi] = 0.5 + smooth(u, v, 6) * 0.18;
      } else if (v < 0.80) {
        // ---------------- cloth: two-tone drift + hue-separated stains + patchwork + stitch lines
        const mix = smooth(u, v, 11);
        const weave = 0.9 + 0.16 * ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) + 0.06 * smooth(u, v, 60);
        const fold = 0.86 + 0.18 * Math.sin(x * 0.021 + mott1 * 4.5);
        let base = [
          clothDark[0] + (clothLight[0] - clothDark[0]) * mix,
          clothDark[1] + (clothLight[1] - clothDark[1]) * mix,
          clothDark[2] + (clothLight[2] - clothDark[2]) * mix,
        ];
        if (mott2 > 0.74) { const t = Math.min(1, (mott2 - 0.74) * 2.4); base = base.map((c, ci) => c * (1 - t) + stainBrown[ci] * t); }
        if (mott3 > 0.80) { const t = Math.min(1, (mott3 - 0.80) * 2.6); base = base.map((c, ci) => c * (1 - t) + stainOlive[ci] * t); }
        if (mott2 < 0.12) { const t = Math.min(1, (0.12 - mott2) * 2.6); base = base.map((c, ci) => c * (1 - t) + stainPurple[ci] * t); }
        // patchwork panels + stitch lines + hue-jittered weave: big smooth cloth surfaces (ranger
        // hood/cloak) otherwise shade into very few quantised colours at 2.8 m
        const panelId = Math.floor(u * 5) * 7 + Math.floor(v * 5) * 13;
        const panelHue = (hash(panelId, 3) - 0.5) * 0.9;
        const panelVal = 0.86 + hash(panelId, 9) * 0.3;
        const stitchU = Math.abs((u * 5) % 1 - 0.5) > 0.475;
        const stitchV = Math.abs((v * 5) % 1 - 0.5) > 0.478;
        const weaveHue = (hash(Math.floor(x / 2), Math.floor(y / 2)) - 0.5) * 0.5;
        base = hueShift(base, panelHue, 0.06, panelVal - 1.0);
        base = hueShift(base, weaveHue, 0.04, 0);
        if (stitchU || stitchV) base = base.map((c, ci) => c * 0.62 + accentDark[ci] * 0.45);
        col = [base[0] * weave * fold, base[1] * weave * fold, base[2] * weave * fold];
        height[hi] = 0.5 + smooth(u, v, 5) * 0.22 + ((stitchU || stitchV) ? 0.16 : 0);
      } else {
        // ---------------- heraldry: three hue families + cross/chevron + trim lines
        const chev = Math.abs(((x / W) * 4) % 1 - 0.5);
        const uu = (u - 0.5) / 0.5;
        const crossBand = Math.abs(uu) < 0.09;
        const bandLine = (Math.abs(v - 0.86) < 0.02 || Math.abs(v - 0.94) < 0.012);
        let base;
        if (crossBand) base = accentAlt;
        else if (bandLine) base = accentCream;
        else {
          base = [
            accentDark[0] + (accentLight[0] - accentDark[0]) * (1 - chev),
            accentDark[1] + (accentLight[1] - accentDark[1]) * (1 - chev),
            accentDark[2] + (accentLight[2] - accentDark[2]) * (1 - chev),
          ];
          if (mott2 > 0.7) base = base.map((c, ci) => c * 0.35 + accentCream[ci] * 0.65);
        }
        const stripe = ((Math.floor(x / 20) % 2) === 0) ? 1.05 : 0.78;
        const k = (0.9 + grain) * stripe;
        col = [base[0] * k, base[1] * k, base[2] * k];
        height[hi] = 0.5 + smooth(u, v, 4) * 0.2;
      }
      albedo[i] = Math.max(0, Math.min(255, Math.round(col[0] * 255)));
      albedo[i + 1] = Math.max(0, Math.min(255, Math.round(col[1] * 255)));
      albedo[i + 2] = Math.max(0, Math.min(255, Math.round(col[2] * 255)));
    }
  }
  const normal = Buffer.alloc(NW * NH * 3);
  const S = 1.3;
  for (let y = 0; y < NH; y++) {
    for (let x = 0; x < NW; x++) {
      const i = y * NW + x;
      const hx = height[y * NW + Math.min(NW - 1, x + 1)] - height[y * NW + Math.max(0, x - 1)];
      const hy = height[Math.min(NH - 1, y + 1) * NW + x] - height[Math.max(0, y - 1) * NW + x];
      let nx = -hx * S, ny = hy * S, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      normal[i * 3] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  const orm = Buffer.alloc(NW * NH * 3);
  for (let y = 0; y < NH; y++) {
    const v = y / NH;
    for (let x = 0; x < NW; x++) {
      const i = (y * NW + x) * 3;
      const n = smooth(x / NW, v, 30);
      if (v < 0.42) { orm[i] = 205 + n * 40; orm[i + 1] = 95 + n * 45; orm[i + 2] = 150 + n * 40; }
      else if (v < 0.80) { orm[i] = 215 + n * 30; orm[i + 1] = 205 + n * 35; orm[i + 2] = 0; }
      else { orm[i] = 220 + n * 25; orm[i + 1] = 150 + n * 40; orm[i + 2] = 90 + n * 30; }
    }
  }
  const [albedoJpeg, normalJpeg, ormJpeg] = await Promise.all([
    sharp(albedo, {raw: {width: W, height: H, channels: 3}}).jpeg({quality: 88, mozjpeg: true}).toBuffer(),
    sharp(normal, {raw: {width: NW, height: NH, channels: 3}}).jpeg({quality: 88, mozjpeg: true}).toBuffer(),
    sharp(orm, {raw: {width: NW, height: NH, channels: 3}}).jpeg({quality: 86, mozjpeg: true}).toBuffer(),
  ]);
  return {albedoJpeg, normalJpeg, ormJpeg};
}
/* ---------------------------------------------------------------- piece assembly */
function buildPieces(name, cfg, piv) {
  const pieces = [];   // {geo, bone, band}  band: metal|cloth|accent
  const push = (geo, bone, band) => pieces.push({geo, bone, band});
  const {up, forward, side, head, headC, spine2, spine1, hips, neck} = piv;
  const P = cfg.palette;

  // bucket-helm base: a correctly-oriented lathe around the vertical axis (reliable silhouette)
  const bucket = (g, centre, baseR, height, segs) => {
    const basis = basisFrom(up);
    const prof = [
      {t: height, r: baseR * 0.42},
      {t: height * 0.86, r: baseR * 0.86},
      {t: height * 0.55, r: baseR},
      {t: height * 0.12, r: baseR * 0.98},
    ];
    lathe(g, centre, basis, prof, segs);
    // crown cap
    const crownC = add(centre, mul(up, height * 0.87));
    const ring = [];
    for (let s = 0; s < segs; s++) {
      const ang = (s / segs) * Math.PI * 2;
      const dir = add(mul(basis.x, Math.cos(ang)), mul(basis.y, Math.sin(ang)));
      ring.push(g.vert(add(crownC, mul(dir, baseR * 0.62)), norm(add(dir, mul(up, 0.8))), s / segs, 0.9));
    }
    const apex = g.vert(add(centre, mul(up, height)), up, 0.5, 1.0);
    for (let s = 0; s < segs; s++) g.tri(ring[s], ring[(s + 1) % segs], apex);
  };
  const addHelm = (kind) => {
    const g = new Geo();
    const r = kind === "greathelm" ? 1.28 : kind === "hornedHelm" ? 1.20 : 1.22;
    const h = kind === 'greathelm' ? 1.75 : 1.65;
    const hb = add(head, mul(up, -0.55));
    bucket(g, hb, Math.min(r, 1.22), h, 14);
    if (kind === 'greathelm') {
      spike(g, add(add(headC, mul(up, h * 0.5)), mul(forward, -0.2)), norm(add(mul(up, 0.9), mul(forward, -0.3))), 0.9, 0.18, 5);
    } else if (kind === 'visoredHelm') {
      spike(g, add(headC, mul(up, h * 0.5)), norm(add(mul(up, 1.0), mul(forward, -0.15))), 0.8, 0.16, 5);
      box(g, add(add(headC, mul(up, 0.15)), mul(forward, r * 0.92)), basisFrom(up), 0.6, r * 0.9, 0.12);
    } else if (kind === 'hornedHelm') {
      for (const sgn of [1, -1]) {
        const base = add(add(headC, mul(up, h * 0.12)), mul(side, r * 0.85 * sgn));
        const g2 = new Geo();
        spike(g2, base, norm(add(mul(up, 0.85), mul(side, 0.7 * sgn))), r * 1.15, r * 0.26, 7);
        g.merge(g2);
      }
    } else if (kind === 'crestHelm') {
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.4;
        const g2 = new Geo();
        spike(g2, add(add(add(headC, mul(up, h * 0.5)), mul(forward, off)), mul(up, -0.1)),
          norm(add(mul(up, 1.0), mul(forward, -0.25))), 1.15 - Math.abs(off) * 0.3, 0.15, 5);
        g.merge(g2);
      }
      for (const sgn of [1, -1]) {
        const g2 = new Geo();
        spike(g2, add(add(headC, mul(up, 0.1)), mul(side, r * 0.85 * sgn)),
          norm(add(mul(up, 0.75), mul(side, 0.7 * sgn))), r * 1.0, r * 0.2, 6);
        g.merge(g2);
      }
    } else { // plainHelm
      box(g, add(add(headC, mul(up, 0.1)), mul(forward, r * 0.9)), basisFrom(up), 0.16, r * 0.8, 0.12);
    }
    push(g, 'Head', 'metal');
  };
  const addCuirass = (kind) => {
    const g = new Geo();
    const basis = basisFrom(up);
    const top = add(spine2, mul(up, 1.35));
    const bot = add(spine1, mul(up, -0.65));
    const H = len(sub(bot, top));
    const rings = 5;
    const profile = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = (kind === 'knightCuirass' ? 2.15 : kind === 'leatherCuirass' ? 1.95 : 2.05) * (1.0 - 0.14 * t * t);
      profile.push({t: t * H, r: rad});
    }
    lathe(g, top, basis, profile, 12);
    // chest ridge / trim
    if (kind !== 'leatherCuirass') {
      const g2 = new Geo();
      box(g2, add(add(spine2, mul(up, 0.55)), mul(forward, 1.75)), basisFrom(forward), 0.18, 1.7, 0.10);
      g.merge(g2);
    }
    push(g, 'Spine2', kind === 'leatherCuirass' ? 'cloth' : 'metal');
  };

  const addTabard = (long) => {
    const g = new Geo();
    const top = add(hips, mul(up, 0.9));
    const h = long ? 5.4 : 4.4;
    sheet(g, add(top, mul(forward, 1.15)), 2.7, h, side, up, mul(forward, -0.16), 4, 6, 0.14, 0.35);
    sheet(g, add(top, mul(forward, -1.15)), 2.7, h, side, up, mul(forward, 0.16), 4, 6, 0.14, 0.35);
    push(g, 'Hips', 'cloth');
    const g2 = new Geo();
    // hem trim
    box(g2, add(top, mul(up, -h * 0.97)), basisFrom(up), 2.8, 0.12, 0.1);
    push(g2, 'Hips', 'accent');
  };

  const addPauldrons = (layers, scale) => {
    for (const [sideName, sgn] of [['LeftShoulder', 1], ['RightShoulder', -1]]) {
      const shoulder = piv.pivot(sideName);
      const arm = piv.pivot(sgn > 0 ? 'LeftArm' : 'RightArm');
      const outward = norm(add(norm(sub(shoulder, spine2)), mul(up, 0.25)));
      const rad = (1.9 + 0.35 * scale);
      for (let L = 0; L < layers; L++) {
        const g = new Geo();
        const basis = basisFrom(outward);
        const rr = rad * (1 - L * 0.18);
        const c = add(add(shoulder, mul(outward, 0.25 + L * 0.3)), mul(up, 0.3 - L * 0.18));
        dome(g, c, basis, rr, rr * (0.85 - L * 0.1), 14, 4);
        push(g, sideName, L === 0 ? 'metal' : 'accent');
      }
      void arm;
    }
  };

  const addBracers = () => {
    for (const sgn of [1, -1]) {
      const fore = piv.pivot(sgn > 0 ? 'LeftForeArm' : 'RightForeArm');
      const hand = piv.pivot(sgn > 0 ? 'LeftHand' : 'RightHand');
      const dir = norm(sub(hand, fore));
      const g = new Geo();
      frustum(g, add(fore, mul(dir, 0.2)), add(fore, mul(dir, len(sub(hand, fore)) * 0.8)), 0.46, 0.36, 8);
      push(g, sgn > 0 ? 'LeftForeArm' : 'RightForeArm', 'metal');
    }
  };

  const addBelt = () => {
    const g = new Geo();
    lathe(g, add(hips, mul(up, 0.45)), basisFrom(up), [{t: 0, r: 1.92}, {t: 0.2, r: 1.98}, {t: 0.32, r: 1.9}], 14);
    push(g, 'Hips', 'accent');
  };

  const addFurShoulder = () => {
    for (const [sideName, sgn] of [['LeftShoulder', 1], ['RightShoulder', -1]]) {
      const shoulder = piv.pivot(sideName);
      const arm = piv.pivot(sgn > 0 ? 'LeftArm' : 'RightArm');
      void arm;
      const outward = norm(sub(shoulder, spine2));
      const g = new Geo();
      for (let i = 0; i < 11; i++) {
        const ang = (i / 11) * Math.PI * 2;
        const dir = norm(add(mul(outward, Math.cos(ang) * 0.9), add(mul(side, Math.sin(ang)), mul(up, 0.35))));
        const c = add(add(shoulder, mul(outward, 0.55)), mul(up, 0.1));
        const g2 = new Geo();
        spike(g2, add(c, mul(dir, 0.3)), dir, 1.05 + rng() * 0.4, 0.36, 5);
        g.merge(g2);
      }
      push(g, sideName, 'cloth');
    }
  };

  const addHood = () => {
    const g = new Geo();
    const basis = basisFrom(up);
    dome(g, add(add(headC, mul(up, 0.3)), mul(forward, -0.1)), basis, 1.62, 1.55, 14, 5);
    sheet(g, add(add(headC, mul(up, -0.7)), mul(forward, -1.2)), 3.0, 4.0, side, up, mul(forward, -1), 6, 5, 0.3, 0.4);
    push(g, 'Head', 'cloth');
  };

  const addCloak = (ragged) => {
    const g = new Geo();
    const top = add(spine2, mul(up, 1.5));
    const h = ragged ? 8.2 : 9.2;
    sheet(g, add(top, mul(forward, -1.35)), 5.4, h, side, up, mul(forward, -1), 9, 9, 1.1, ragged ? 0.25 : 0.45);
    push(g, 'Spine2', 'cloth');
    if (!ragged) {
      const g2 = new Geo();
      box(g2, add(add(spine2, mul(up, 1.55)), mul(forward, -0.7)), basisFrom(up), 2.9, 0.24, 0.26);
      push(g2, 'Spine2', 'accent');
    }
  };

  const addQuiver = () => {
    const g = new Geo();
    const c = add(add(spine2, mul(forward, -1.25)), mul(up, 0.3));
    const axis = norm(add(mul(up, 0.85), mul(side, 0.45)));
    const basis = basisFrom(axis);
    const top = add(c, mul(axis, 1.15)), bot = add(c, mul(axis, -0.85));
    frustum(g, bot, top, 0.36, 0.44, 8);
    for (let i = 0; i < 5; i++) {
      const off = add(mul(basis.x, (rng() - 0.5) * 0.34), mul(basis.y, (rng() - 0.5) * 0.34));
      const g2 = new Geo();
      frustum(g2, add(top, off), add(add(top, off), mul(axis, 0.7)), 0.06, 0.04, 5);
      g.merge(g2);
    }
    push(g, 'Spine2', 'metal');
  };

  const addPack = () => {
    const g = new Geo();
    const c = add(add(spine2, mul(forward, -1.5)), mul(up, -0.3));
    box(g, c, basisFrom(up), 2.5, 2.9, 1.3);
    push(g, 'Spine2', 'cloth');
    const g2 = new Geo();
    box(g2, add(c, mul(up, 1.4)), basisFrom(up), 2.0, 0.34, 1.1);
    push(g2, 'Spine2', 'accent');
  };

  /* ---------------- survivor identity: ragged camp survivor (no plate, patched cloth, staff) ---------------- */
  const raggedSheet = (top, width, height, right, down, back, cols, rows, bow, flare, tearAmount) => {
    const g = new Geo();
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const u = c / cols - 0.5;
        // jagged hem: the lowest row gets a per-column irregular length + sideways wander
        const tear = r === rows ? (rng() - 0.5) * tearAmount : (r / rows) * tearAmount * 0.25;
        const p = add(add(top, mul(right, u * width * (1 + flare * t))), mul(down, -height * (t + tear)));
        const p2 = add(p, mul(back, Math.sin(t * Math.PI) * bow + t * t * 0.7));
        row.push(g.vert(p2, norm(add(back, mul(down, -0.15 * t))), c / cols, 1 - t));
      }
      grid.push(row);
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g.quad(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]);
    return g;
  };
  const addTatteredHood = () => {
    const g = new Geo();
    const basis = basisFrom(up);
    dome(g, add(add(headC, mul(up, 0.28)), mul(forward, -0.12)), basis, 1.58, 1.5, 14, 5);
    g.merge(raggedSheet(add(add(headC, mul(up, -0.65)), mul(forward, -1.1)), 3.1, 3.4, side, up, mul(forward, -1), 6, 5, 0.3, 0.45, 0.45));
    push(g, 'Head', 'cloth');
  };
  const addTatteredCloak = () => {
    const g = new Geo();
    const top = add(spine2, mul(up, 1.35));
    g.merge(raggedSheet(add(top, mul(forward, -1.25)), 4.6, 7.4, side, up, mul(forward, -1), 9, 8, 0.9, 0.35, 0.6));
    push(g, 'Spine2', 'cloth');
    // patchwork patches (accent) stitched onto the cloak
    for (let i = 0; i < 4; i++) {
      const g2 = new Geo();
      const off = add(mul(side, (rng() - 0.5) * 3.2), mul(up, -1.2 - rng() * 3.4));
      box(g2, add(add(top, mul(forward, -1.35)), off), basisFrom(up), 0.7, 0.7, 0.06);
      push(g2, 'Spine2', 'accent');
    }
  };
  const addSurvivorPack = () => {
    // bedroll across the shoulders + satchel + straps
    const g = new Geo();
    const axis = norm(add(mul(side, 0.9), mul(up, 0.35)));
    const c = add(add(spine2, mul(up, 1.55)), mul(forward, -0.95));
    frustum(g, add(c, mul(axis, -1.5)), add(c, mul(axis, 1.5)), 0.34, 0.34, 8);
    push(g, 'Spine2', 'cloth');
    const g2 = new Geo();
    box(g2, add(add(spine2, mul(up, -0.4)), mul(forward, -1.35)), basisFrom(up), 1.5, 1.2, 0.7);
    push(g2, 'Spine2', 'cloth');
    const g3 = new Geo();
    box(g3, add(add(spine2, mul(up, 1.58)), mul(forward, -0.95)), basisFrom(up), 3.2, 0.16, 0.14);
    push(g3, 'Spine2', 'accent');
  };
  const addRopeBelt = () => {
    const g = new Geo();
    lathe(g, add(hips, mul(up, 0.42)), basisFrom(up), [{t: 0, r: 1.86}, {t: 0.14, r: 1.92}, {t: 0.24, r: 1.86}], 14);
    push(g, 'Hips', 'accent');
    const g2 = new Geo();
    box(g2, add(add(hips, mul(up, 0.2)), mul(forward, 1.55)), basisFrom(up), 0.5, 0.7, 0.12);
    push(g2, 'Hips', 'metal');
  };
  const addWalkingStaff = () => {
    const g = new Geo();
    const hand = piv.pivot('RightHand');
    const axis = norm(add(mul(up, 1.0), mul(forward, 0.18)));
    const base = add(add(hand, mul(up, -1.6)), mul(forward, 0.55));
    frustum(g, base, add(base, mul(axis, 4.4)), 0.11, 0.085, 6);
    push(g, 'RightHand', 'metal');
  };

  const addBackPlate = () => {
    const g = new Geo();
    const c = add(spine2, mul(forward, -1.15));
    box(g, c, basisFrom(up), 2.3, 2.8, 0.6);
    for (let i = 0; i < 4; i++) {
      const g2 = new Geo();
      spike(g2, add(add(c, mul(side, (i - 1.5) * 0.55)), mul(up, 0.9)),
        norm(add(mul(forward, -0.75), mul(up, 0.55))), 0.9 + rng() * 0.4, 0.20, 5);
      g.merge(g2);
    }
    push(g, 'Spine2', 'metal');
  };

  const addSpikedPauldrons = () => {
    for (const [sideName, sgn] of [['LeftShoulder', 1], ['RightShoulder', -1]]) {
      const shoulder = piv.pivot(sideName);
      const outward = norm(sub(shoulder, spine2));
      const g = new Geo();
      const basis = basisFrom(outward);
      dome(g, add(shoulder, mul(up, 0.1)), basis, 1.55, 1.3, 12, 4);
      for (let i = 0; i < 3; i++) {
        const g2 = new Geo();
        spike(g2, add(add(shoulder, mul(outward, 1.05)), mul(side, (i - 1) * 0.5)),
          norm(add(mul(outward, 0.5), mul(up, 0.85))), 1.1 + rng() * 0.3, 0.2, 5);
        g.merge(g2);
      }
      push(g, sideName, 'metal');
    }
  };

  for (const piece of cfg.pieces) {
    switch (piece) {
      case 'greathelm': case 'visoredHelm': case 'plainHelm': case 'hornedHelm': case 'crestHelm':
        addHelm(piece); break;
      case 'cuirass': case 'knightCuirass': case 'leatherCuirass':
        addCuirass(piece); break;
      case 'tabard': addTabard(true); break;
      case 'largePauldrons': addPauldrons(2, 1.0); break;
      case 'layeredPauldrons': addPauldrons(3, 1.15); break;
      case 'spikedPauldrons': addSpikedPauldrons(); break;
      case 'bracers': addBracers(); break;
      case 'belt': addBelt(); break;
      case 'furShoulder': addFurShoulder(); break;
      case 'hood': addHood(); break;
      case 'tatteredHood': addTatteredHood(); break;
      case 'tatteredCloak': addTatteredCloak(); break;
      case 'survivorPack': addSurvivorPack(); break;
      case 'ropeBelt': addRopeBelt(); break;
      case 'walkingStaff': addWalkingStaff(); break;
      case 'longCloak': addCloak(false); break;
      case 'raggedCloak': addCloak(true); break;
      case 'quiver': addQuiver(); break;
      case 'pack': addPack(); break;
      case 'backPlate': addBackPlate(); break;
      default: throw new Error('unknown armour piece ' + piece);
    }
  }
  void neck; void P;
  return pieces;
}

/* ---------------------------------------------------------------- pivots + assembly */
function decodeAccessor(acc) {
  const arr = acc.getArray();
  const n = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[acc.getType()];
  if (!acc.getNormalized()) return {data: Float64Array.from(arr), n, count: arr.length / n};
  const ct = acc.getComponentType();
  const max = ct === 5120 ? 127 : ct === 5121 ? 255 : ct === 5122 ? 32767 : 5123 ? 65535 : 1;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return {data: out, n, count: arr.length / n};
}
const val = (d, i, c) => d.data[i * d.n + c];

function jointPivots(skin) {
  const map = new Map();
  const mats = skin.getInverseBindMatrices();
  const arr = mats.getArray();
  skin.listJoints().forEach((joint, j) => {
    const o = j * 16;
    const a = [arr[o], arr[o + 1], arr[o + 2]];
    const b = [arr[o + 4], arr[o + 5], arr[o + 6]];
    const c = [arr[o + 8], arr[o + 9], arr[o + 10]];
    const t = [arr[o + 12], arr[o + 13], arr[o + 14]];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    const solve = (m) => (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det;
    const rhs = [-t[0], -t[1], -t[2]];
    map.set(joint.getName() || '', [solve([[rhs[0], b[0], c[0]], [rhs[1], b[1], c[1]], [rhs[2], b[2], c[2]]]),
      solve([[a[0], rhs[0], c[0]], [a[1], rhs[1], c[1]], [a[2], rhs[2], c[2]]]),
      solve([[a[0], b[0], rhs[0]], [a[1], b[1], rhs[1]], [a[2], b[2], rhs[2]]])]);
  });
  return map;
}

async function processBody(name, cfg, opts = {}) {
  console.log(`\n== ${name}`);
  const src = path.join(BASE, name + '.glb.gz');
  if (!fs.existsSync(src)) throw new Error('missing base ' + src);
  const srcGlb = path.join(WORK, name + '_base.glb');
  fs.writeFileSync(srcGlb, zlib.gunzipSync(fs.readFileSync(src)));
  const doc = await io.read(srcGlb);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const bodyPrim = mesh.listPrimitives()[0];
  const skin = root.listSkins()[0];
  const joints = decodeAccessor(bodyPrim.getAttribute('JOINTS_0'));
  const weights = decodeAccessor(bodyPrim.getAttribute('WEIGHTS_0'));
  const bodyIndexHash = sha(Buffer.from(bodyPrim.getIndices().getArray().buffer));
  const bodyPosHash = sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer));
  const animHash = () => root.listAnimations().map((a) => sha(Buffer.concat(a.listSamplers().flatMap((s) => [
    Buffer.from(s.getInput().getArray().buffer), Buffer.from(s.getOutput().getArray().buffer)])))).join('|');
  const animBefore = animHash();

  const bind = jointPivots(skin);
  const pivot = (suffix) => {
    const key = [...bind.keys()].find((k) => k.endsWith(suffix));
    return (key && bind.get(key)) || [0, 0, 0];
  };
  const hips = pivot('Hips'), head = pivot('Head'), spine1 = pivot('Spine1'), spine2 = pivot('Spine2');
  const up = norm(sub(head, hips));
  const forward = norm(sub(v3(0, 0, 1), mul(up, dot(up, v3(0, 0, 1)))));
  const side = norm(cross(forward, up));
  const headC = add(head, mul(up, 0.55));
  const piv = {up, forward, side, headC, head, hips, spine1, spine2, pivot};

  const TILE_UNITS = 2.6; // world units per armour-atlas tile (uniform texel density)
  const pieces = buildPieces(name, cfg, piv);
  // world-scale UVs + large-triangle subdivision happen on each PIECE before merging, so the
  // per-vertex bone map below stays aligned with the final geometry.
  for (const piece of pieces) {
    scalePieceUVs(piece);
    subdivideLargeTris(piece.geo, 0.5);
  }
  // split into two primitives so the runtime can tint hard armour vs soft cloth differently:
  //   <name>_plate = metal + accent pieces, <name>_cloth = cloth pieces
  const groups = {plate: new Geo(), cloth: new Geo()};
  const bonesOf = {plate: [], cloth: []};
  for (const piece of pieces) {
    const g = piece.band === 'cloth' ? groups.cloth : groups.plate;
    const start = g.p.length / 3;
    g.merge(piece.geo);
    for (let i = start; i < g.p.length / 3; i++) bonesOf[piece.band === 'cloth' ? 'cloth' : 'plate'].push(piece.bone);
  }
  // ---- world-scale UVs: scale each piece's own parametrisation by its real size so the texel
  // density is uniform, without per-face triplanar axis jumps.
  function scalePieceUVs(piece) {
    const p = piece.geo.p;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
    }
    const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
    const uv = piece.geo.uv;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      uMin = Math.min(uMin, uv[i]); uMax = Math.max(uMax, uv[i]);
      vMin = Math.min(vMin, uv[i + 1]); vMax = Math.max(vMax, uv[i + 1]);
    }
    const constUV = (uMax - uMin) < 1e-5 && (vMax - vMin) < 1e-5;
    if (constUV) {
      // boxes / spikes with degenerate UVs: planar world-scale mapping on the two smaller axes
      for (let i = 0; i < uv.length; i += 2) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        uv[i] = ((x / TILE_UNITS) % 1 + 1) % 1;
        uv[i + 1] = (((y + z * 0.5) / TILE_UNITS) % 1 + 1) % 1;
      }
      return;
    }
    // revolved pieces (helm/cuirass/bracer/belt): u is the angle, v the height
    const radius = Math.max(sx, sz) * 0.5;
    const ku = (2 * Math.PI * radius) / TILE_UNITS;
    const kv = sy / TILE_UNITS;
    const uSpan = Math.max(1e-6, uMax - uMin), vSpan = Math.max(1e-6, vMax - vMin);
    // sheets already integrate their real width/height into uv, so normalise to their span then scale
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = ((uv[i] - uMin) / uSpan) * ku;
      uv[i + 1] = ((uv[i + 1] - vMin) / vSpan) * kv;
    }
  };
  // split oversized triangles so no plate face reads as a single big quad at close range
  // (bind units: 1 unit ~ 0.109 m, so 0.5 unit^2 ~ 0.006 m^2)
  function subdivideLargeTris(g, maxArea) {
    const idx = g.idx;
    const out = [];
    const mid = (i0, i1) => {
      const ax = g.p[i0 * 3], ay = g.p[i0 * 3 + 1], az = g.p[i0 * 3 + 2];
      const bx = g.p[i1 * 3], by = g.p[i1 * 3 + 1], bz = g.p[i1 * 3 + 2];
      const nx0 = g.n[i0 * 3], ny0 = g.n[i0 * 3 + 1], nz0 = g.n[i0 * 3 + 2];
      const nx1 = g.n[i1 * 3], ny1 = g.n[i1 * 3 + 1], nz1 = g.n[i1 * 3 + 2];
      const n = norm([(nx0 + nx1) * 0.5, (ny0 + ny1) * 0.5, (nz0 + nz1) * 0.5]);
      return g.vert([(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5], n,
        (g.uv[i0 * 2] + g.uv[i1 * 2]) * 0.5, (g.uv[i0 * 2 + 1] + g.uv[i1 * 2 + 1]) * 0.5);
    };
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      const ax = g.p, uv = g.uv;
      const e1 = [ax[i1 * 3] - ax[i0 * 3], ax[i1 * 3 + 1] - ax[i0 * 3 + 1], ax[i1 * 3 + 2] - ax[i0 * 3 + 2]];
      const e2 = [ax[i2 * 3] - ax[i0 * 3], ax[i2 * 3 + 1] - ax[i0 * 3 + 1], ax[i2 * 3 + 2] - ax[i0 * 3 + 2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1];
      const cy = e1[2] * e2[0] - e1[0] * e2[2];
      const cz = e1[0] * e2[1] - e1[1] * e2[0];
      const area = 0.5 * Math.hypot(cx, cy, cz);
      if (area <= maxArea) { out.push(i0, i1, i2); continue; }
      const m01 = mid(i0, i1), m12 = mid(i1, i2), m20 = mid(i2, i0);
      out.push(i0, m01, m20, m01, i1, m12, m20, m12, i2, m01, m12, m20);
      void uv;
    }
    g.idx = out;
  };
  const jointIndex = (suffix) => {
    const k = [...bind.keys()].find((k) => k.endsWith(suffix));
    if (!k) throw new Error(`${name}: missing joint ${suffix}`);
    return skin.listJoints().findIndex((j) => (j.getName() || '') === k);
  };
  const buffer = root.listBuffers()[0];
  const {albedoJpeg, normalJpeg, ormJpeg} = await makeAtlas(cfg.palette, opts.albedoDim || 1024);
  const tex = doc.createTexture(name + '_armour_alb').setImage(new Uint8Array(albedoJpeg)).setMimeType('image/jpeg');
  const nrmTex = doc.createTexture(name + '_armour_nrm').setImage(new Uint8Array(normalJpeg)).setMimeType('image/jpeg');
  const ormTex = doc.createTexture(name + '_armour_orm').setImage(new Uint8Array(ormJpeg)).setMimeType('image/jpeg');
  let addedTris = 0;
  for (const [kind, g] of Object.entries(groups)) {
    if (!g.tris) continue;
    // UV band remap: metal v<0.42, cloth 0.42..0.80, accent 0.80..1.0 (triplanar UVs from above)
    let idx = 0;
    for (const piece of pieces) {
      const inGroup = (kind === 'cloth') === (piece.band === 'cloth');
      if (!inGroup) continue;
      const n = piece.geo.p.length / 3;
      let v0 = 0, vh = 0.42;
      if (piece.band === 'cloth') { v0 = 0.42; vh = 0.38; }
      else if (piece.band === 'accent') { v0 = 0.80; vh = 0.20; }
      for (let i = 0; i < n; i++) {
        const k = (idx + i) * 2;
        const lu = g.uv[k], lv = g.uv[k + 1];
        // world-scale UVs repeat (tile) inside the band; wrap u and v with fract so no band crossing
        const uu = lu - Math.floor(lu);
        const vv = lv - Math.floor(lv);
        g.uv[k] = uu;
        g.uv[k + 1] = v0 + vh * 0.03 + vv * vh * 0.94;
      }
      idx += n;
    }
    const vCount = g.p.length / 3;
    const jointArr = new Uint16Array(vCount * 4);
    const weightArr = new Uint8Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
      const ji = jointIndex(bonesOf[kind][i]);
      for (let k = 0; k < 4; k++) { jointArr[i * 4 + k] = ji; weightArr[i * 4 + k] = k === 0 ? 255 : 0; }
    }
    const mat = doc.createMaterial(name + '_' + kind)
      .setBaseColorTexture(tex)
      .setNormalTexture(nrmTex).setNormalScale(0.8)
      .setMetallicRoughnessTexture(ormTex)
      .setOcclusionTexture(ormTex).setOcclusionStrength(1.0)
      .setRoughnessFactor(1.0)
      .setMetallicFactor(1.0)
      .setDoubleSided(true);
    const prim = doc.createPrimitive();
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.p)).setBuffer(buffer));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Int8Array(g.n.map((v) => Math.max(-127, Math.min(127, Math.round(v * 127)))))).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Uint16Array(g.uv.map((v) => Math.max(0, Math.min(65535, Math.round(v * 65535)))))).setNormalized(true).setBuffer(buffer));
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointArr).setBuffer(buffer));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weightArr).setNormalized(true).setBuffer(buffer));
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.idx)).setBuffer(buffer));
    prim.setMaterial(mat);
    mesh.addPrimitive(prim);
    addedTris += g.tris;
  }
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const same = bodyIndexHash === sha(Buffer.from(bodyPrim.getIndices().getArray().buffer)) &&
    bodyPosHash === sha(Buffer.from(bodyPrim.getAttribute('POSITION').getArray().buffer)) &&
    animBefore === animHash() && root.listSkins().length === 1;
  const bytes = await io.writeBinary(doc);
  const gz = gzip9(bytes);
  fs.writeFileSync(path.join(STAGE, 'custom', name + '.glb.gz'), gz);
  const totalTris = mesh.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
  const clips = root.listAnimations().length;
  const fits = totalTris <= BUDGET_TRIS && gz.length <= BUDGET_BYTES;
  console.log(`${name.padEnd(10)} armour +${addedTris} tris | prims ${mesh.listPrimitives().length}, ` +
    `total tris ${totalTris}, clips ${clips}, ${(gz.length / 1024).toFixed(1)} KB, body/anim unchanged=${same} fits=${fits}`);
  return {name, addTris: addedTris, totalTris, prims: mesh.listPrimitives().length, gz: gz.length, same, fits, clips};
}

const rows = [];
for (const name of Object.keys(ARMOUR)) {
  if (only && !only.includes(name)) continue;
  // try the 1024 px armour atlas first; fall back to 512 only for bodies that would break the
  // 900 KB per-file budget (cycle-5 rule: 1024 only where it fits)
  let result = await processBody(name, ARMOUR[name], {albedoDim: 1024});
  if (result.gz > BUDGET_BYTES) {
    console.log(`${name}: 1024 atlas -> ${(result.gz / 1024).toFixed(1)} KB over budget, rebuilding at 512`);
    result = await processBody(name, ARMOUR[name], {albedoDim: 512});
    result.albedoDim = 512;
  } else {
    result.albedoDim = 1024;
  }
  rows.push(result);
}
fs.writeFileSync(path.join(STAGE, 'manifest-armour.json'), JSON.stringify(rows, null, 1));
console.log('\nstaged:', rows.map((r) => `${r.name} ${(r.gz / 1024).toFixed(0)}KB ${r.totalTris}t`).join(', '));
