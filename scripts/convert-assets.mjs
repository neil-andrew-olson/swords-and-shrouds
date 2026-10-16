import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs';import zlib from 'node:zlib';
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:application/octet-stream;base64,'+Buffer.from(v).toString('base64');this.onloadend?.();});}};
const b=fs.readFileSync(process.argv[2] || '/tmp/knight/FBX/KnightCharacter.fbx');const o=new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const keep=['Idle','Death','Run','Walking','Run_swordAttack'];const animations=o.animations.filter(a=>keep.includes(a.name.split('|')[1]));for(const a of animations)a.optimize();
const data=await new GLTFExporter().parseAsync(o,{binary:true,animations});fs.writeFileSync('public/assets/knight.glb.gz',zlib.gzipSync(Buffer.from(data)));console.log('Knight compressed',fs.statSync('public/assets/knight.glb.gz').size);
