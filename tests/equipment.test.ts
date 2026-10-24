import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {equipmentModel} from '../src/client/equipment';
test('weapon fit handles sideways, flat and upright exports without oversized geometry',()=>{for(const dimensions of [[.01,100,.01],[100,.01,.01],[.01,.01,100]]){const source=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxGeometry(...dimensions as [number,number,number]),new THREE.MeshStandardMaterial());mesh.position.set(4,8,-6);source.add(mesh);const fit=equipmentModel(source,.9);fit.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(fit).getSize(new THREE.Vector3());assert.ok(Math.abs(Math.max(size.x,size.y,size.z)-.9)<1e-5);assert.ok(size.y>.89);}});
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {customCharacter,undeadEliteTier} from '../src/client/custom-character';import type {Actor} from '../src/shared/types';
async function geometryAsset(name:string){const b=gunzipSync(readFileSync(`public/assets/custom/${name}.glb.gz`));const len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));delete j.images;delete j.textures;delete j.samplers;j.materials=[{}];for(const m of j.meshes)for(const p of m.primitives)p.material=0;let str=JSON.stringify(j);str+=' '.repeat((4-Buffer.byteLength(str)%4)%4);const jb=Buffer.from(str),bin=b.subarray(20+len),h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+jb.length+bin.length,8);h.writeUInt32LE(jb.length,12);h.writeUInt32LE(0x4e4f534a,16);const all=Buffer.concat([h,jb,bin]);return new GLTFLoader().parseAsync(all.buffer.slice(all.byteOffset,all.byteOffset+all.byteLength),'');}
test('actual hand-mounted assets stay human-sized through idle, run, block and attacks',async()=>{const equipment=new Map([['sword',await geometryAsset('sword')],['shield',await geometryAsset('shield')]]);for(const name of ['hero','ally','fallen']){const a={id:'qa',kind:'player',hp:100,maxHp:100,attackSerial:0,armor:'light',block:false} as Actor;const rig=customCharacter(await geometryAsset(name),a,equipment);for(let i=0;i<90;i++){a.block=i>30&&i<45;if(i===50)a.attackSerial=1;rig.update(a,i>10&&i<30,1/30);rig.model.updateMatrixWorld(true);for(const part of ['sword','shield']){const o=rig.model.getObjectByName('equipment-'+part)!;assert.ok(o);const size=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());assert.ok(size.length()<1.5,`${name} ${part} ${size.toArray()}`);}}rig.dispose();}});

import {WEAPON_IDS,WEAPONS} from '../src/shared/weapons';
test('every supplied weapon fits the animated hero and two-handed loadouts omit shields',async()=>{const equipment=new Map();for(const id of [...WEAPON_IDS,'shield'])equipment.set(id,await geometryAsset(id));const source=await geometryAsset('hero');for(const weapon of WEAPON_IDS){const a={id:'qa',kind:'player',hp:100,maxHp:100,weapon,attackSerial:0} as Actor;const rig=customCharacter(source,a,equipment);for(let i=0;i<25;i++){if(i===5)a.attackSerial=1;rig.update(a,false,1/30);rig.model.updateMatrixWorld(true);const item=rig.model.getObjectByName('equipment-'+weapon)!;assert.ok(item);const size=new THREE.Box3().setFromObject(item,true).getSize(new THREE.Vector3());assert.ok(size.length()<2.2,weapon+' '+size.toArray());}assert.equal(!!rig.model.getObjectByName('equipment-shield'),WEAPONS[weapon].shield);rig.dispose();}});

import {meshBounds} from '../src/client/grounding';
test('all nine animated bodies stay grounded through idle, movement, block and attacks',async()=>{
 for(const name of ['hero','ally','fallen','berserker','ranger','templar','survivor','skeleton-soldier','zombie']){
  const a={id:'ground',kind:'player',hp:100,maxHp:100,attackSerial:0} as Actor;
  const rig=customCharacter(await geometryAsset(name),a,new Map());
  for(let i=0;i<60;i++){if(i===30)a.attackSerial=1;a.block=i>20&&i<30;rig.update(a,i>5&&i<20,1/20);const b=meshBounds(rig.model);assert.ok(Math.abs(b.min.y)<.07,`${name} frame ${i} ground=${b.min.y}`);assert.ok(Math.abs(b.getCenter(new THREE.Vector3()).x)<1&&Math.abs(b.getCenter(new THREE.Vector3()).z)<1,`${name} frame ${i} root motion escaped actor`);assert.ok(b.max.y<2.35&&b.max.y>.8,`${name} height=${b.max.y}`);}
  rig.dispose();
 }
 // Cycle-3 elite undead: deterministic rule + one rigid, skin-attached procedural primitive.
 const eliteActor=(extra:Partial<Actor>)=>({id:'elite',name:'Elite',kind:'zombie',hp:52,maxHp:52,x:0,z:0,weapon:'sword',attackSerial:0,...extra}) as Actor;
 assert.equal(undeadEliteTier(eliteActor({z:-659})),1,'plague-nest guard is tier 1');
 assert.equal(undeadEliteTier(eliteActor({x:0,z:-5,castle:'keep'})),1,'Fallen Keep garrison is tier 1');
 assert.equal(undeadEliteTier(eliteActor({kind:'corrupted',maxHp:125})),2,'corrupted knight is tier 2');
 assert.equal(undeadEliteTier(eliteActor({kind:'corrupted',maxHp:200})),3,'boss is tier 3');
 assert.equal(undeadEliteTier(eliteActor({x:400,z:400,maxHp:52})),0,'ordinary undead is tier 0');
 assert.equal(undeadEliteTier(eliteActor({kind:'player'})),0,'players are never elite');
 const eliteCases:[string,Actor,number][]=[
  ['zombie',eliteActor({id:'z1',kind:'zombie',z:-659}),1],
  ['skeleton-soldier',eliteActor({id:'s1',kind:'zombie',z:-5,castle:'keep'}),1],
  ['fallen',eliteActor({id:'f1',kind:'corrupted',maxHp:125}),2],
  ['fallen',eliteActor({id:'b1',kind:'corrupted',maxHp:200}),3]
 ];
 for(const [asset,actor,tier] of eliteCases){
  const rig=customCharacter(await geometryAsset(asset),actor,new Map());
  let body:THREE.SkinnedMesh|undefined;rig.model.traverse(o=>{if(!body&&o instanceof THREE.SkinnedMesh)body=o as THREE.SkinnedMesh;});
  assert.ok(body,asset+' skinned body');
  const addon=rig.model.getObjectByName('undead-elite-addon') as THREE.SkinnedMesh|undefined;
  assert.ok(addon,asset+' tier '+tier+' elite add-on');
  assert.ok(addon instanceof THREE.SkinnedMesh,asset+' add-on is skinned');
  assert.equal(addon.skeleton,body!.skeleton,asset+' add-on shares the one skin');
  assert.equal((addon.userData as {eliteTier:number}).eliteTier,tier,asset+' tier tag');
  assert.ok(addon.geometry.attributes.skinIndex&&addon.geometry.attributes.skinWeight,asset+' JOINTS/WEIGHTS present');
  const tris=addon.geometry.attributes.position.count/3;
  assert.ok(tris>0&&tris<=96,asset+' elite tri budget '+tris);
  const weights=addon.geometry.attributes.skinWeight as THREE.BufferAttribute,jointsIndex=addon.geometry.attributes.skinIndex as THREE.BufferAttribute,joints=body!.skeleton.bones.length;
  for(let i=0;i<weights.count;i++){
   assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-5,asset+' rigid weight '+i);
   for(const c of ['X','Y','Z','W'] as const)assert.ok(jointsIndex.getComponent(i,['X','Y','Z','W'].indexOf(c))<joints,asset+' joint index');
  }
  for(let i=0;i<20;i++){rig.update(actor,i>6&&i<12,1/30);const b=meshBounds(rig.model);assert.ok(Math.abs(b.min.y)<.07,asset+' elite ground '+i+' '+b.min.y);assert.ok(b.max.y<2.35,asset+' elite height '+b.max.y);}
  rig.dispose();
  if(asset!=='fallen'){const normal=customCharacter(await geometryAsset(asset),{...actor,id:'plain',x:400,z:400,castle:undefined,maxHp:52},new Map());assert.equal(normal.model.getObjectByName('undead-elite-addon'),undefined,asset+' normal has no add-on');normal.dispose();}
 }
});

import {WEAPON_GRIPS} from '../src/client/equipment';
test('measured weapon grips place the handle at the socket with the blade above it',async()=>{
 for(const id of WEAPON_IDS){const source=await geometryAsset(id);const fit=equipmentModel(source.scene,WEAPONS[id].length,false,id);fit.updateMatrixWorld(true);const wrapper=fit.children[0];const grip=new THREE.Vector3(...WEAPON_GRIPS[id].grip as [number,number,number]).applyMatrix4(wrapper.matrixWorld);assert.ok(grip.length()<1e-6,id+' grip');const direction=new THREE.Vector3(...WEAPON_GRIPS[id].blade as [number,number,number]).transformDirection(wrapper.matrixWorld);assert.ok(direction.y>.999,id+' blade');const bounds=new THREE.Box3().setFromObject(fit,true);assert.ok(bounds.max.y>Math.abs(bounds.min.y),id+' blade extends beyond grip');if(id==='rapier'||id==='halberd'||id==='dane_axe'||id==='flamberge'||id==='mace'){assert.ok(bounds.getSize(new THREE.Vector3()).length()<2.2,id+' fitted diagonal');source.scene.updateMatrixWorld(true);const raw=new THREE.Box3().setFromObject(source.scene,true),height=raw.getSize(new THREE.Vector3()).y;assert.ok(raw.min.y<-.1*height,id+' handle below grip');assert.ok(raw.max.y>.5*height,id+' blade above grip');}}
});
