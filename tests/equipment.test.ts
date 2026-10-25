import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {equipmentModel} from '../src/client/equipment';
test('weapon fit handles sideways, flat and upright exports without oversized geometry',()=>{for(const dimensions of [[.01,100,.01],[100,.01,.01],[.01,.01,100]]){const source=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxGeometry(...dimensions as [number,number,number]),new THREE.MeshStandardMaterial());mesh.position.set(4,8,-6);source.add(mesh);const fit=equipmentModel(source,.9);fit.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(fit).getSize(new THREE.Vector3());assert.ok(Math.abs(Math.max(size.x,size.y,size.z)-.9)<1e-5);assert.ok(size.y>.89);}});
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {customCharacter,undeadEliteTier,setCharacterWindQuality,clothWindState,triggerEnemyHit,setHitFeedbackReducedMotion,runTimeScaleFor,slideFactorFor,attackTimingFor,deathVariantFor,idlePhaseFor,landingImpulseFor} from '../src/client/custom-character';import type {Actor} from '../src/shared/types';
async function geometryAsset(name:string){const b=gunzipSync(readFileSync(`public/assets/custom/${name}.glb.gz`));const len=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+len));delete j.images;delete j.textures;delete j.samplers;
 // Keep material names/indices (armour-prim classification) but drop texture references so no image decode is needed.
 j.materials=(j.materials??[{}]).map((m:any)=>({name:m.name||'mat',doubleSided:!!m.doubleSided,pbrMetallicRoughness:{metallicFactor:m.pbrMetallicRoughness?.metallicFactor??1,roughnessFactor:m.pbrMetallicRoughness?.roughnessFactor??1}}));
 for(const m of j.meshes)for(const p of m.primitives)if(p.material===undefined)p.material=0;let str=JSON.stringify(j);str+=' '.repeat((4-Buffer.byteLength(str)%4)%4);const jb=Buffer.from(str),bin=b.subarray(20+len),h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+jb.length+bin.length,8);h.writeUInt32LE(jb.length,12);h.writeUInt32LE(0x4e4f534a,16);const all=Buffer.concat([h,jb,bin]);return new GLTFLoader().parseAsync(all.buffer.slice(all.byteOffset,all.byteOffset+all.byteLength),'');}
test('actual hand-mounted assets stay human-sized through idle, run, block and attacks',async()=>{const equipment=new Map([['sword',await geometryAsset('sword')],['shield',await geometryAsset('shield')]]);for(const name of ['hero','ally','fallen','survivor']){const a={id:'qa',kind:'player',hp:100,maxHp:100,attackSerial:0,armor:'light',block:false} as Actor;const rig=customCharacter(await geometryAsset(name),a,equipment);for(let i=0;i<90;i++){a.block=i>30&&i<45;if(i===50)a.attackSerial=1;rig.update(a,i>10&&i<30,1/30);rig.model.updateMatrixWorld(true);for(const part of ['sword','shield']){const o=rig.model.getObjectByName('equipment-'+part)!;assert.ok(o);const size=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());assert.ok(size.length()<1.5,`${name} ${part} ${size.toArray()}`);}}rig.dispose();}
// Cycle-6 sixth playable appearance (Wandering Survivor): the same equipment pipeline must mount the
// sword/shield on the Mixamo hands and stay grounded through idle, run, attack, block and death.
// Cycle-6: survivor is the sixth selectable appearance and must resolve through the real path.
assert.equal(characterAsset({id:'survivor-select',kind:'player',appearance:'survivor'} as Actor),'survivor','survivor is a selectable appearance');
const survivorSource=await geometryAsset('survivor');
const survivorActor={id:'survivor-player',kind:'player',appearance:'survivor',hp:100,maxHp:100,weapon:'sword',attackSerial:0} as Actor;
const survivorRig=customCharacter(survivorSource,survivorActor,equipment);
const survivorSword=survivorRig.model.getObjectByName('equipment-sword'),survivorShield=survivorRig.model.getObjectByName('equipment-shield');
assert.ok(survivorSword&&survivorShield,'survivor player mounts sword and shield');
assert.match((survivorSword!.parent?.name??'').replace(/^mixamorig:?/i,''),/RightHand/i,'survivor sword parent right hand');
assert.match((survivorShield!.parent?.name??'').replace(/^mixamorig:?/i,''),/LeftHand/i,'survivor shield parent left hand');
for(let i=0;i<90;i++){survivorActor.block=i>20&&i<30;if(i===35)survivorActor.attackSerial=1;if(i===60)survivorActor.hp=0;survivorRig.update(survivorActor,i>5&&i<20,1/30);survivorRig.model.updateMatrixWorld(true);
 const bounds=meshBounds(survivorRig.model);assert.ok(Number.isFinite(bounds.min.y)&&bounds.min.y>-.12&&bounds.min.y<.2,'survivor player ground '+i+' '+bounds.min.y);
 for(const part of ['sword','shield']){const item=survivorRig.model.getObjectByName('equipment-'+part);assert.ok(item,'survivor '+part+' present frame '+i);const size=new THREE.Box3().setFromObject(item!,true).getSize(new THREE.Vector3());assert.ok(size.length()<1.6,'survivor '+part+' size frame '+i);}}
// Cycle-16 animation-depth pure helpers (run playback/slide, class attack timing, death variation, idle phase, landing).
 const matchedScale=runTimeScaleFor(5.925,false);assert.ok(Math.abs(matchedScale-1)<1e-9);assert.ok(Math.abs(slideFactorFor(5.925,matchedScale,false))<1e-9,'steady run has no foot slide');
 assert.ok(runTimeScaleFor(.2,false)>=.6&&runTimeScaleFor(12,false)<=1.6,'run timescale clamps');
 assert.ok(slideFactorFor(8,runTimeScaleFor(8,false),false)<=.06,'in-game full-speed slide <= .06');assert.ok(Math.abs(runTimeScaleFor(8,false)-8/5.925)<1e-9);assert.ok(Math.abs(runTimeScaleFor(8,true)-8/5.08)<1e-9);assert.ok(slideFactorFor(12,runTimeScaleFor(12,false),false)>0,'residual slide only beyond clamp');
 const thrust=attackTimingFor('thrust',.65),cleave=attackTimingFor('cleave',1.1),crush=attackTimingFor('crush',1.15);
 assert.equal(thrust.clip,'attack_1');assert.equal(cleave.clip,'attack_2');assert.equal(crush.clip,'attack_2');
 assert.ok(thrust.windupMs<cleave.windupMs&&cleave.windupMs<crush.windupMs,'windup grows by weapon class');
 assert.ok(thrust.duration<cleave.duration&&cleave.duration<crush.duration,'thrust recovers quickest');
 assert.equal(crush.windupMs,483,'crush windup tied to 1.15 s cooldown');assert.equal(crush.duration,1.15*.95);
 const deathA=deathVariantFor('a1'),deathB=deathVariantFor('b7');assert.equal(deathVariantFor('a1'),deathA,'death variant deterministic');assert.ok(deathA>=-25&&deathA<=25);assert.notEqual(deathA,deathB,'death variants differ per actor');
 assert.equal(idlePhaseFor(0),0);assert.ok(Math.abs(idlePhaseFor(3.2))<1e-9,'idle phase wraps at 3.2 s');assert.ok(idlePhaseFor(1.6)>1);
 assert.equal(landingImpulseFor(4.2,4.2),0);assert.ok(landingImpulseFor(6,.5)>0,'abrupt stop triggers crouch impulse');
survivorRig.dispose();});

import {WEAPON_IDS,WEAPONS} from '../src/shared/weapons';
import {characterAsset} from '../src/shared/characters';
test('every supplied weapon fits the animated hero and two-handed loadouts omit shields',async()=>{const equipment=new Map();for(const id of [...WEAPON_IDS,'shield'])equipment.set(id,await geometryAsset(id));const source=await geometryAsset('hero');for(const weapon of WEAPON_IDS){const a={id:'qa',kind:'player',hp:100,maxHp:100,weapon,attackSerial:0} as Actor;const rig=customCharacter(source,a,equipment);for(let i=0;i<25;i++){if(i===5)a.attackSerial=1;rig.update(a,false,1/30);rig.model.updateMatrixWorld(true);const item=rig.model.getObjectByName('equipment-'+weapon)!;assert.ok(item);const size=new THREE.Box3().setFromObject(item,true).getSize(new THREE.Vector3());assert.ok(size.length()<Math.max(2.2,WEAPONS[weapon].length+.25),weapon+' '+size.toArray());}assert.equal(!!rig.model.getObjectByName('equipment-shield'),WEAPONS[weapon].shield);rig.dispose();}});

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
 // Cycle-4 armour v2: every body prim shares the one skin, keeps skinned bounds inside the body
 // envelope (no floating/offset origins), preserves hand sockets + clips and the ≤16k tri budget.
 for(const name of ['templar','hero','berserker','ranger','ally','survivor','fallen']){
  const source=await geometryAsset(name);
  const actor={id:'armour-'+name,name:'Armour',kind:name==='fallen'?'corrupted':'player',hp:100,maxHp:100,weapon:'sword',attackSerial:0} as Actor;
  const rig=customCharacter(source,actor,new Map());
  rig.update(actor,false,1/30);rig.model.updateMatrixWorld(true);
  const prims:THREE.SkinnedMesh[]=[];rig.model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)prims.push(o);});
  assert.ok(prims.length>=2,name+' has body + armour prims ('+prims.length+')');
  const skeleton=prims[0].skeleton;skeleton.update();
  const trisOf=(prim:THREE.SkinnedMesh)=>{const g=prim.geometry;return (g.index?g.index.count:g.attributes.position.count)/3;};
  const bodyPrim=prims.reduce((best,prim)=>trisOf(prim)>trisOf(best)?prim:best,prims[0]);
  const skinnedBox=(prim:THREE.SkinnedMesh)=>{prim.skeleton.update();const box=new THREE.Box3(),v=new THREE.Vector3(),positions=prim.geometry.attributes.position;for(let i=0;i<positions.count;i++){prim.getVertexPosition(i,v);box.expandByPoint(v.applyMatrix4(prim.matrixWorld));}return box;};
  // World-space triangle size for plate/cloth prims (the v3 "no stretched single quads" gate).
  const triStats=(prim:THREE.SkinnedMesh)=>{const geometry=prim.geometry,index=geometry.index,positions=geometry.attributes.position;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let maxEdge=0,maxArea=0;for(let t=0;t<(index?index.count:positions.count);t+=3){prim.getVertexPosition(index?index.getX(t):t,a);prim.getVertexPosition(index?index.getX(t+1):t+1,b);prim.getVertexPosition(index?index.getX(t+2):t+2,c);a.applyMatrix4(prim.matrixWorld);b.applyMatrix4(prim.matrixWorld);c.applyMatrix4(prim.matrixWorld);maxEdge=Math.max(maxEdge,a.distanceTo(b),b.distanceTo(c),c.distanceTo(a));maxArea=Math.max(maxArea,new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length()/2);}return {maxEdge,maxArea};};
  const bodyBox=skinnedBox(bodyPrim);let totalTris=0,armourHeadWeight=0,plateCount=0,clothPrims=0,clothSample:THREE.MeshStandardMaterial|undefined;
  const materialName=(prim:THREE.SkinnedMesh)=>(Array.isArray(prim.material)?prim.material:[prim.material]).map((material:{name?:string})=>material.name||'').join('|');
  for(const prim of prims){
   totalTris+=trisOf(prim);
   assert.equal(prim.skeleton.bones.length,skeleton.bones.length,name+' armour prims share one skeleton');for(let bone=0;bone<skeleton.bones.length;bone++)assert.equal(prim.skeleton.bones[bone],skeleton.bones[bone],name+' shared joint '+bone);
   const geometry=prim.geometry;
   assert.ok(geometry.attributes.skinIndex&&geometry.attributes.skinWeight,name+' prim JOINTS/WEIGHTS');
   const indices=geometry.attributes.skinIndex as THREE.BufferAttribute,weights=geometry.attributes.skinWeight as THREE.BufferAttribute;
   const step=Math.max(1,Math.floor(indices.count/400));
   for(let i=0;i<indices.count;i+=step){
    assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<2e-2,name+' prim weight sum '+i);
    for(const component of [0,1,2,3])assert.ok(indices.getComponent(i,component)<skeleton.bones.length,name+' prim joint index');
   }
   const box=skinnedBox(prim),centre=box.getCenter(new THREE.Vector3());
   // No floating/offset origins: each prim overlaps the actual body volume (not the union).
   assert.ok(centre.x>bodyBox.min.x-.4&&centre.x<bodyBox.max.x+.4&&centre.z>bodyBox.min.z-.4&&centre.z<bodyBox.max.z+.4,name+' prim centre not floating xz');
   assert.ok(box.min.y>-.08,name+' prim above ground '+box.min.y);
   assert.ok(box.max.y<bodyBox.max.y+.25,name+' prim within body height '+box.max.y);
   if(prim!==bodyPrim){
    const mats=materialName(prim);
    // Armour v2 folds the old small add-ons into these prims (no duplicate addon prims).
    assert.ok(!/_addon/i.test(mats),name+' old add-on folded ('+mats+')');
    assert.ok(box.intersectsBox(bodyBox),name+' '+(mats||'addon')+' overlaps the body');
    if(/_plate/i.test(mats))plateCount++;
    if(/_cloth/i.test(mats)){clothPrims++;for(const material of (Array.isArray(prim.material)?prim.material:[prim.material]) as THREE.MeshStandardMaterial[])if((material.userData as {cloth?:boolean}).cloth)clothSample=material;}
    // Weighted-bone semantics: plates and cloth must ride upper-body/torso anthropomorphic joints.
    let dominant=0,allowed=0;
    for(let i=0;i<indices.count;i+=step){
     let bestComponent=0,bestWeight=0;
     for(const component of [0,1,2,3]){const weight=weights.getComponent(i,component);if(weight>bestWeight){bestWeight=weight;bestComponent=component;}}
     if(bestWeight<.4)continue;
     const bone=prim.skeleton.bones[indices.getComponent(i,bestComponent)];
     const boneName=(bone?.name??'').replace(/^mixamorig:?/i,'').toLowerCase();
     dominant++;
     if(/arm|shoulder|spine|chest|head|neck|clavicle|forearm|hand|hips|pelvis/.test(boneName))allowed++;
     if(/head|neck/.test(boneName))armourHeadWeight+=bestWeight;
    }
    if(/_plate/i.test(mats))assert.ok(dominant>0&&allowed/dominant>.8,name+' plate skinned to armour bones '+allowed+'/'+dominant);
    if(/_cloth/i.test(mats))assert.ok(dominant>0&&allowed/dominant>.8,name+' cloth skinned to torso bones '+allowed+'/'+dominant);
    if(/_plate/i.test(mats)||/_cloth/i.test(mats)){
     // Cycle-5 v3: plate/cloth geometry must not contain stretched single-quad faces (~m units).
     const stats=triStats(prim);
     assert.ok(stats.maxEdge<.5,name+' '+(/_plate/i.test(mats)?'plate':'cloth')+' max triangle edge '+stats.maxEdge.toFixed(3));
     assert.ok(stats.maxArea<.04,name+' '+(/_plate/i.test(mats)?'plate':'cloth')+' max triangle area '+stats.maxArea.toFixed(4));
    }
   }
  }
  assert.ok(plateCount>=1,name+' has an armour plate prim');
  assert.ok(armourHeadWeight>0,name+' armour prim includes head/neck weighting');
  if(name==='survivor'){
   // Cycle-5/6 survivor identity: ragged cloth + plate/pack accents. The walking staff must be
   // torso/back-mounted (Spine2/Hips), NOT hand-rigid, so an armed survivor never swings it.
   const survivorPrims=prims.filter(prim=>prim!==bodyPrim).map(prim=>({prim,mats:materialName(prim)}));
   assert.ok(survivorPrims.some(p=>/_plate/i.test(p.mats)),'survivor has plate accents');
   assert.ok(survivorPrims.some(p=>/_cloth/i.test(p.mats)),'survivor has ragged cloth');
   let torsoRigid=0,handRigid=0;
   for(const {prim} of survivorPrims){const indices=prim.geometry.attributes.skinIndex as THREE.BufferAttribute,weights=prim.geometry.attributes.skinWeight as THREE.BufferAttribute;for(let i=0;i<indices.count;i++){let best=0,bc=0;for(const c of [0,1,2,3]){const w=weights.getComponent(i,c);if(w>best){best=w;bc=c;}}if(best<.99)continue;const bone=(prim.skeleton.bones[indices.getComponent(i,bc)]?.name??'').replace(/^mixamorig:?/i,'').toLowerCase();if(/spine|hips|pelvis|chest/.test(bone))torsoRigid++;if(/hand/.test(bone))handRigid++;}}
   assert.ok(torsoRigid>0,'survivor staff/pack is torso-mounted');
   assert.equal(handRigid,0,'survivor has no hand-rigid gear (no weapon-hand clash)');
  }
  if(name==='fallen')assert.ok(rig.model.getObjectByName('undead-elite-addon') instanceof THREE.SkinnedMesh,name+' elite add-on still present');
  assert.ok(totalTris<=16000,name+' total tri budget '+totalTris);
  for(const socket of ['mixamorigRightHand','mixamorigLeftHand']){
   const found=rig.model.getObjectByName(socket)||rig.model.getObjectByName('mixamorig:'+socket.replace('mixamorig',''));
   assert.ok(found,name+' hand socket '+socket);
  }
  const clips=new Set(source.animations.map((clip:{name:string})=>clip.name));
  for(const clip of ['idle','run','attack_1','attack_2','block_idle','death_forward'])assert.ok(clips.has(clip),name+' clip '+clip);
  rig.dispose();
 }
 // Cycle-7 undead variants: reuse the base rig/clip set, add a rigid add-on prim, stay in budget.
 const undeadVariantCases:[string,string,number,number][]=[['zombie','zombie-bloated',30,11000],['skeleton-soldier','skeleton-armoured',51,8500]];
 for(const [base,variant,joints,budget] of undeadVariantCases){
  const baseSource=await geometryAsset(base),variantSource=await geometryAsset(variant);
  const baseActor={id:'a0',kind:'zombie',hp:52,maxHp:52,weapon:'sword',attackSerial:0} as Actor;
  const variantActor={...baseActor,id:'a2'};
  const baseRig=customCharacter(baseSource,baseActor,new Map()),variantRig=customCharacter(variantSource,variantActor,new Map());
  const prims:THREE.SkinnedMesh[]=[];variantRig.model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)prims.push(o);});
  assert.ok(prims.length>=2,variant+' has body + add-on prims');
  assert.equal(prims[0].skeleton.bones.length,joints,variant+' joint count');
  const primTris=(prim:THREE.SkinnedMesh)=>(prim.geometry.index?prim.geometry.index.count:prim.geometry.attributes.position.count)/3;
  const variantBody=prims.reduce((best,prim)=>primTris(prim)>primTris(best)?prim:best,prims[0]);
  for(const prim of prims){
   if(prim===variantBody)continue;
   const rigidWeights=prim.geometry.attributes.skinWeight as THREE.BufferAttribute;
   for(let i=0;i<rigidWeights.count;i++){
    assert.ok(Math.abs(rigidWeights.getX(i)+rigidWeights.getY(i)+rigidWeights.getZ(i)+rigidWeights.getW(i)-1)<1e-3,variant+' add-on rigid weight sum');
    assert.ok(Math.max(rigidWeights.getX(i),rigidWeights.getY(i),rigidWeights.getZ(i),rigidWeights.getW(i))>.99,variant+' add-on single joint');
   }
  }
  let tris=0;
  for(const prim of prims){tris+=(prim.geometry.index?prim.geometry.index.count:prim.geometry.attributes.position.count)/3;assert.ok(prim.geometry.attributes.skinIndex&&prim.geometry.attributes.skinWeight,variant+' '+prim.name+' JOINTS/WEIGHTS');}
  assert.ok(tris<=budget,variant+' tri budget '+tris);
  const variantClips=(variantSource.animations as {name:string}[]).map(clip=>clip.name),baseClips=(baseSource.animations as {name:string}[]).map(clip=>clip.name);
  assert.equal(variantClips.length,baseClips.length,variant+' clip count matches base');
  assert.ok(variantClips.every(name=>baseClips.includes(name)),variant+' reuses the base clip set');
  for(const clip of ['idle','run','attack_1','attack_2','block_idle','death_forward'])assert.ok(variantClips.includes(clip),variant+' clip '+clip);
  variantRig.update(variantActor,false,1/30);variantRig.model.updateMatrixWorld(true);
  const idleBounds=meshBounds(variantRig.model);assert.ok(Math.abs(idleBounds.min.y)<.07,variant+' grounded idle '+idleBounds.min.y);assert.ok(idleBounds.max.y<2.35&&idleBounds.max.y>.8,variant+' idle height '+idleBounds.max.y);
  variantActor.hp=0;for(let i=0;i<40;i++){variantRig.update(variantActor,false,1/30);const deadBounds=meshBounds(variantRig.model);assert.ok(Number.isFinite(deadBounds.min.y)&&Number.isFinite(deadBounds.max.y),variant+' finite death bounds');}
  baseRig.dispose();variantRig.dispose();
 }
 // Cycle-8 combat hit feedback v2: weapon-scaled flash/stagger, clean restore, reduced-motion path.
 const lightHit=hitFeedbackProfile('rapier'),heavyHit=hitFeedbackProfile('flamberge');
 assert.ok(heavyHit.flashMs>lightHit.flashMs,'heavy hit flashes longer');
 assert.ok(heavyHit.stagger>lightHit.stagger,'heavy hit staggers more');
 assert.ok(lightHit.flashMs>=80&&lightHit.flashMs<=140,'light flash inside 80-140 ms');
 assert.ok(heavyHit.flashMs>=80&&heavyHit.flashMs<=140,'heavy flash inside 80-140 ms');
 const hitActor=(id:string)=>({id,kind:'zombie',hp:52,maxHp:52,weapon:'sword',attackSerial:0} as Actor);
 const flashHex=hitFlashColor(true);
 for(const asset of ['zombie','zombie-bloated','skeleton-armoured']){
  const actor=hitActor('hit-'+asset);
  const rig=customCharacter(await geometryAsset(asset),actor,new Map());
  assert.equal(rig.hitState().flashActive,false,asset+' starts unflashed');
  rig.hit({weight:heavyHit.weight,durationMs:heavyHit.flashMs,stagger:heavyHit.stagger,flashColor:flashHex});
  const hitState=rig.hitState();
  assert.ok(hitState.flashActive,asset+' flash active');
  assert.ok(hitState.flashRemainingMs>=80&&hitState.flashRemainingMs<=140,asset+' flash ttl '+hitState.flashRemainingMs);
  assert.ok(hitState.staggerActive,asset+' stagger active');
  assert.equal(hitState.actorId,'hit-'+asset,asset+' reports actor id');
  let pulsed=0,stashed=0;
  rig.model.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const material of (Array.isArray(o.material)?o.material:[o.material]) as THREE.MeshStandardMaterial[])if(material instanceof THREE.MeshStandardMaterial&&material.emissive){if(material.emissive.getHex()===flashHex)pulsed++;if(material.userData.ssHitEmissive!==undefined)stashed++;}});
  assert.ok(pulsed>0&&stashed>0,asset+' materials pulsed with originals stashed');
  rig.update(actor,false,1/60);assert.ok(Math.abs(meshBounds(rig.model).min.y)<.07,asset+' grounded during stagger');
  assert.equal(triggerEnemyHit(actor.id,{weight:lightHit.weight,durationMs:lightHit.flashMs}),true,asset+' QA trigger resolves the live rig');
  for(let i=0;i<40;i++)rig.update(actor,false,1/60);
  const settled=rig.hitState();assert.equal(settled.flashActive,false,asset+' flash expired');assert.equal(settled.staggerActive,false,asset+' stagger expired');
  let stillFlashed=0,leaked=0;
  rig.model.traverse(o=>{if(!(o instanceof THREE.Mesh))return;for(const material of (Array.isArray(o.material)?o.material:[o.material]) as THREE.MeshStandardMaterial[])if(material instanceof THREE.MeshStandardMaterial&&material.emissive){if(material.emissive.getHex()===flashHex)stillFlashed++;if(material.userData.ssHitEmissive!==undefined)leaked++;}});
  assert.equal(stillFlashed,0,asset+' emissive restored');
  assert.equal(leaked,0,asset+' no material stash leak');
  rig.hit({weight:1.6,reduced:true});
  const reduced=rig.hitState();assert.equal(reduced.flashActive,false,asset+' reduced flash suppressed');assert.equal(reduced.staggerActive,false,asset+' reduced stagger suppressed');assert.equal(reduced.reduced,true,asset+' reduced state reported');
  rig.dispose();
  assert.equal(triggerEnemyHit(actor.id),false,asset+' disposed rig unregistered');
 }
 setHitFeedbackReducedMotion(true);
 const globalReducedRig=customCharacter(await geometryAsset('zombie'),hitActor('hit-global'),new Map());
 globalReducedRig.hit({});assert.equal(globalReducedRig.hitState().flashActive,false,'global reduced-motion suppresses flash');
 setHitFeedbackReducedMotion(false);globalReducedRig.dispose();
});

import {WEAPON_GRIPS,hitFeedbackProfile,hitFlashColor} from '../src/client/equipment';
test('measured weapon grips place the handle at the socket with the blade above it',async()=>{
 for(const id of WEAPON_IDS){const source=await geometryAsset(id);const fit=equipmentModel(source.scene,WEAPONS[id].length,false,id);fit.updateMatrixWorld(true);const wrapper=fit.children[0];const grip=new THREE.Vector3(...WEAPON_GRIPS[id].grip as [number,number,number]).applyMatrix4(wrapper.matrixWorld);assert.ok(grip.length()<1e-6,id+' grip');const direction=new THREE.Vector3(...WEAPON_GRIPS[id].blade as [number,number,number]).transformDirection(wrapper.matrixWorld);assert.ok(direction.y>.999,id+' blade');const bounds=new THREE.Box3().setFromObject(fit,true);assert.ok(bounds.max.y>Math.abs(bounds.min.y),id+' blade extends beyond grip');if(id==='rapier'||id==='halberd'||id==='dane_axe'||id==='flamberge'||id==='mace'){assert.ok(bounds.getSize(new THREE.Vector3()).length()<2.2,id+' fitted diagonal');source.scene.updateMatrixWorld(true);const raw=new THREE.Box3().setFromObject(source.scene,true),height=raw.getSize(new THREE.Vector3()).y;assert.ok(raw.min.y<-.1*height,id+' handle below grip');assert.ok(raw.max.y>.5*height,id+' blade above grip');}}
 // Cycle-9 War Spear: canonical polearm fit keeps the point above the grip at full 2.2 m length.
 const spearFit=equipmentModel((await geometryAsset('spear')).scene,WEAPONS.spear.length,false,'spear');spearFit.updateMatrixWorld(true);
 const spearBounds=new THREE.Box3().setFromObject(spearFit,true),spearSize=spearBounds.getSize(new THREE.Vector3());
 assert.ok(spearSize.y>2.1&&spearSize.y<2.35,'spear fitted height '+spearSize.y);
 assert.ok(spearBounds.max.y>Math.abs(spearBounds.min.y),'spear point above grip');
 assert.equal(WEAPONS.spear.shield,true,'spear allows a shield');
});
