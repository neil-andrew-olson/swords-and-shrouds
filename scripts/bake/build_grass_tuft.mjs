#!/usr/bin/env node
// Build the grass_tuft scatter asset (task-2). The warehouse's GrassPatch_Circle.fbx is a
// 204 k-tri circular grass patch — far over the 1,500-tri scatter budget, and decimating
// alpha-card foliage collapses the cards into mush. Instead this builds a classic
// alpha-tested tuft: five crossed quads at slightly different scales/angles using the
// FBX's own SF_Grass_Dif texture (RGBA) so world-scene can instance it cheaply.
//   node scripts/bake/build_grass_tuft.mjs  ->  temp_sketchlab/bake/grass_tuft.glb
import fs from 'node:fs';
import path from 'node:path';
import {Document, NodeIO} from '../custom-assets/node_modules/@gltf-transform/core/dist/index.js';
import sharp from '../custom-assets/node_modules/sharp/dist/index.mjs';
import {SCRATCH, ensureDir} from './bake-lib.mjs';

const TEX = 'C:/Users/neil/Desktop/AIprojects/swords/temp_sketchlab/grass-patches-circle/textures/SF_Grass_Dif.png';
const OUT = path.join(SCRATCH, 'bake', 'grass_tuft.glb');
const TEX_SIZE = 512;

const io = new NodeIO();
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('grass_tuft');

// ---- texture: resize the RGBA diffuse, keep the alpha for alpha-test masking ----
const texPng = await sharp(fs.readFileSync(TEX))
  .resize(TEX_SIZE, TEX_SIZE, {kernel: 'lanczos3'})
  .png({compressionLevel: 9})
  .toBuffer();
const texture = doc.createTexture('SF_Grass_Dif').setImage(texPng).setMimeType('image/png');
const material = doc
  .createMaterial('grass')
  .setBaseColorTexture(texture)
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(0)
  .setRoughnessFactor(1)
  .setAlphaMode('MASK')
  .setAlphaCutoff(0.5)
  .setDoubleSided(true);
material.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);

// ---- crossed quads ----
const planes = [
  {angle: 0, width: 0.78, height: 0.66, u0: 0.04},
  {angle: 60, width: 0.74, height: 0.62, u0: 0.22},
  {angle: 120, width: 0.70, height: 0.70, u0: 0.40},
  {angle: 30, width: 0.56, height: 0.48, u0: 0.58},
  {angle: 90, width: 0.52, height: 0.52, u0: 0.74},
];
const U_SPAN = 0.24; // slice of the blade strip each card samples
const positions = [];
const normals = [];
const uvs = [];
const indices = [];
for (const p of planes) {
  const a = (p.angle * Math.PI) / 180;
  const dx = Math.cos(a) * p.width * 0.5;
  const dz = Math.sin(a) * p.width * 0.5;
  const base = positions.length / 3;
  // counter-clockwise when seen from the card front
  positions.push(-dx, 0, -dz, dx, 0, dz, dx, p.height, dz, -dx, p.height, -dz);
  // glTF UVs have (0,0) at the top-left of the image: bottom edge gets v = 1
  uvs.push(p.u0, 1, p.u0 + U_SPAN, 1, p.u0 + U_SPAN, 0, p.u0, 0);
  const nx = -Math.sin(a), nz = Math.cos(a);
  for (let i = 0; i < 4; i++) normals.push(nx, 0, nz);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const geo = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
  .setMaterial(material);
const mesh = doc.createMesh('grass_tuft').addPrimitive(geo);
const node = doc.createNode('grass_tuft').setMesh(mesh);
scene.addChild(node);

ensureDir(path.dirname(OUT));
fs.writeFileSync(OUT, await io.writeBinary(doc));
console.log(JSON.stringify({out: OUT, tris: indices.length / 3, quads: planes.length, textureKB: +(texPng.length / 1024).toFixed(1)}));
