#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';

const INPUT = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/cursed_base/custom';
const OUTPUT = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/optimized_cursed/custom';
const NAMES = ['templar', 'hero', 'ally', 'berserker', 'ranger', 'survivor', 'fallen'];
const io = new NodeIO();
fs.mkdirSync(OUTPUT, {recursive: true});

for (const name of NAMES) {
  const doc = await io.read(path.join(INPUT, `${name}.glb`));
  doc.getRoot().listScenes()[0].setExtras({pbrCharacter: true});
  const bytes = await io.writeBinary(doc), compressed = zlib.gzipSync(bytes, {level: 9});
  fs.writeFileSync(path.join(OUTPUT, `${name}.glb.gz`), compressed);
  const root = doc.getRoot();
  const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives()
    .reduce((count, primitive) => count + primitive.getIndices().getCount() / 3, 0), 0);
  console.log(JSON.stringify({name, triangles, prims: root.listMeshes().length,
    clips: root.listAnimations().map((animation) => animation.getName()),
    images: root.listTextures().length, gzipBytes: compressed.length}));
}
