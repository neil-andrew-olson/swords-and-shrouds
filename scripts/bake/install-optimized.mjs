#!/usr/bin/env node
// Atomically install the staged optimised assets into public/assets.
// Phase 1: copy every staged file to `<dest>.tmp` next to its destination (live files untouched).
// Phase 2: one tight rename loop replaces all destinations. If anything fails in phase 1 the
// live tree is untouched; phase 2 is a few milliseconds of renames so other owners never see a
// half-installed set.
//   node scripts/bake/install-optimized.mjs [--dry-run] [--stage <dir>]
import fs from 'node:fs';
import path from 'node:path';

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '../..');
const stageArg = process.argv.includes('--stage') ? process.argv[process.argv.indexOf('--stage') + 1] : null;
const STAGE = stageArg || 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized';
const PUBLIC = path.join(GAME, 'public/assets');

const swaps = [];
for (const dir of ['custom', 'textures']) {
  const srcDir = path.join(STAGE, dir);
  if (!fs.existsSync(srcDir)) continue;
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.json')) continue;
    swaps.push({from: path.join(srcDir, f), to: path.join(PUBLIC, dir, f)});
  }
}
const dry = process.argv.includes('--dry-run');
let replaced = 0, added = 0;
for (const s of swaps) {
  if (!fs.existsSync(s.to)) added++;
  if (dry) { console.log(`would install ${path.relative(PUBLIC, s.to)} (${(fs.statSync(s.from).size / 1024).toFixed(1)} KB)`); continue; }
  fs.copyFileSync(s.from, s.to + '.tmp');
}
if (!dry) {
  for (const s of swaps) {
    fs.renameSync(s.to + '.tmp', s.to);
    replaced++;
  }
  console.log(`installed ${swaps.length} files (${added} new, ${swaps.length - added} replaced) atomically`);
}
