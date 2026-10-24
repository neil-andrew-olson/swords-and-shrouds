import * as THREE from 'three';
import {weaponStats} from '../shared/weapons';
import {meshBounds,grounder} from './grounding';
import {equipmentModel} from './equipment';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {NEST} from '../shared/world';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Actor} from '../shared/types';
/**
 * Elite undead rule (cycle 2026-10F) — deterministic, derived only from authoritative actor state,
 * so the renderer, tests and QA can all identify elites without new assets or net fields:
 *  - corrupted knights are armoured elites (tier 2); HP>=200 bosses are tier 3
 *  - shrouded undead (zombie/skeleton): HP>=150 bosses tier 3; plague-nest guards (<=70 m) and
 *    The Fallen Keep garrison (castle id 'keep') are tier 1
 *  - players and soldiers are never elite
 */
export type UndeadEliteTier=0|1|2|3;
export function undeadEliteTier(a:Actor):UndeadEliteTier{
 if(a.kind==='corrupted')return a.maxHp>=200?3:2;
 if(a.kind!=='zombie')return 0;
 if(a.maxHp>=150)return 3;
 const dx=a.x-NEST.x,dz=a.z-NEST.z;
 if(dx*dx+dz*dz<=70*70)return 1;
 if(a.castle==='keep')return 1;
 return 0;
}
const UP=new THREE.Vector3(0,1,0);
/** Two low-poly eye spheres merged into one geometry (one draw call instead of two). */
function eyePairGeometry(radius:number,dx:number):THREE.BufferGeometry{
 const left=new THREE.SphereGeometry(radius,6,4).translate(-dx,0,0);
 const right=new THREE.SphereGeometry(radius,6,4).translate(dx,0,0);
 return mergeGeometries([left,right])??left;
}
type BoneRef={bone:THREE.Object3D;index:number;name:string};
/** Find a joint by candidate names on the actual skeleton (handles mixamorig:, Bip01_* and UE-style names). */
function skeletonBone(skeleton:THREE.Skeleton,names:string[]):BoneRef|undefined{
 // three sanitises glTF node names for property binding (dots/spaces are stripped: 'neck.x' -> 'neckx').
 const simple=(value:string)=>value.replace(/^mixamorig:?/,'').replace(/[^a-z0-9_]/gi,'').toLowerCase();
 for(const name of names){
  const wanted=simple(name);
  for(let i=0;i<skeleton.bones.length;i++){
   const bone=skeleton.bones[i],bare=simple(bone.name);
   if(bone.name===name||bare===wanted)return {bone,index:i,name:bone.name};
  }
 }
 return undefined;
}
type AddOnPayload={pos:number[];nrm:number[];skinIndex:number[];skinWeight:number[];tris:number};
/** Four triangular sides of a pyramid spike (no base), flat-shaded. */
function pushSpike(payload:AddOnPayload,boneIndex:number,toBind:(v:THREE.Vector3)=>THREE.Vector3,base:THREE.Vector3,dir:THREE.Vector3,length:number,width:number){
 const d=dir.clone().normalize();if(d.lengthSq()<1e-8)return;
 const helper=Math.abs(d.y)>.9?new THREE.Vector3(1,0,0):UP;
 const u=new THREE.Vector3().crossVectors(d,helper).normalize(),v=new THREE.Vector3().crossVectors(d,u).normalize();
 const corners=[
  base.clone().addScaledVector(u,width).addScaledVector(v,width),
  base.clone().addScaledVector(u,-width).addScaledVector(v,width),
  base.clone().addScaledVector(u,-width).addScaledVector(v,-width),
  base.clone().addScaledVector(u,width).addScaledVector(v,-width)
 ];
 const tip=base.clone().addScaledVector(d,length);
 for(let i=0;i<4;i++){
  const a=corners[i],b=corners[(i+1)%4];
  const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),tip.clone().sub(a));
  if(normal.lengthSq()<1e-12)continue;
  normal.normalize();
  for(const p of [a,b,tip]){
   const q=toBind(p);
   payload.pos.push(q.x,q.y,q.z);
   payload.nrm.push(normal.x,normal.y,normal.z);
   payload.skinIndex.push(boneIndex,0,0,0);
   payload.skinWeight.push(1,0,0,0);
  }
  payload.tris++;
 }
}
/**
 * Procedural elite-undead silhouette: one extra rigid-weighted SkinnedMesh sharing the body's
 * skeleton (one skin), attached as a child of the body in bind space. Tier 1 = jagged bone crown;
 * tier 2 = helmet crest + shoulder spikes; tier 3 = taller crown + shoulder spikes. <=64 triangles.
 */
function buildEliteUndeadAddOn(model:THREE.Object3D,a:Actor):THREE.SkinnedMesh|undefined{
 const tier=undeadEliteTier(a);if(!tier)return undefined;
 let body:THREE.SkinnedMesh|undefined;
 model.traverse(o=>{if(!body&&o instanceof THREE.SkinnedMesh)body=o as THREE.SkinnedMesh;});
 if(!body)return undefined;
 const skeleton=body.skeleton;
 const head=skeletonBone(skeleton,['mixamorigHead','Head','Bip01_Head1','head.x','c_subneck_1.x','neck.x','mixamorigNeck','Neck']);
 if(!head)return undefined;
 model.updateMatrixWorld(true);
 const bindInv=body.bindMatrixInverse,bind=body.bindMatrix;
 const invRestCache=new Map<number,THREE.Matrix4>();
 const toBindFor=(boneIndex:number)=>(world:THREE.Vector3)=>{
  let inv=invRestCache.get(boneIndex);
  if(!inv){const bone=skeleton.bones[boneIndex];inv=new THREE.Matrix4().copy(bindInv).multiply(bone.matrixWorld).multiply(skeleton.boneInverses[boneIndex]).multiply(bind).invert();invRestCache.set(boneIndex,inv);}
  return body!.worldToLocal(world.clone()).applyMatrix4(inv);
 };
 const payload:AddOnPayload={pos:[],nrm:[],skinIndex:[],skinWeight:[],tris:0};
 const headPos=head.bone.getWorldPosition(new THREE.Vector3());
 const headName=head.name.toLowerCase();
 const headRise=headName.includes('subneck')?.22:headName.includes('neck')?.26:.10;
 const crownBase=headPos.clone().addScaledVector(UP,headRise);
 const crownCount=tier===3?10:8,crownRadius=tier===3?.088:.075;
 const crownBind=toBindFor(head.index);
 for(let i=0;i<crownCount;i++){
  const angle=(i/crownCount)*Math.PI*2,radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
  const base=crownBase.clone().addScaledVector(radial,crownRadius);
  const dir=radial.clone().multiplyScalar(.45).add(UP).normalize();
  pushSpike(payload,head.index,crownBind,base,dir,tier===3?.115:.09,.02);
 }
 if(tier>=2){
  // Helmet crest ridge running front-to-back over the skull.
  for(let i=0;i<5;i++){
   const offset=(i/4-.5);
   const base=crownBase.clone().addScaledVector(UP,.015).addScaledVector(new THREE.Vector3(0,0,1),offset*.13);
   const dir=new THREE.Vector3(0,1,offset*.25).normalize();
   pushSpike(payload,head.index,crownBind,base,dir,tier===3?.135:.105,.021);
  }
  // Shoulder spikes on the armoured variants.
  const hips=skeletonBone(skeleton,['mixamorigHips','Hips','Bip01_Pelvis','root.x','spine_01.x']);
  const hipsPos=hips?hips.bone.getWorldPosition(new THREE.Vector3()):null;
  for(const [armNames,side] of [[['mixamorigLeftArm','LeftArm','Bip01_L_UpperArm','arm_stretch.l','shoulder.l'],-1],[['mixamorigRightArm','RightArm','Bip01_R_UpperArm','arm_stretch.r','shoulder.r'],1]] as [string[],number][]){
   const arm=skeletonBone(skeleton,armNames);if(!arm)continue;
   const armPos=arm.bone.getWorldPosition(new THREE.Vector3());
   const outward=hipsPos?new THREE.Vector3().subVectors(armPos,hipsPos):new THREE.Vector3(side,0,0);
   outward.y=0;if(outward.lengthSq()<1e-8)outward.set(side,0,0);outward.normalize();
   const armBind=toBindFor(arm.index);
   for(let s=0;s<3;s++){
    const base=armPos.clone().addScaledVector(outward,.05+s*.012).addScaledVector(UP,.02+s*.022).addScaledVector(new THREE.Vector3(0,0,1),(s-1)*.05);
    const dir=new THREE.Vector3().addScaledVector(outward,.55).addScaledVector(UP,1).normalize();
    pushSpike(payload,arm.index,armBind,base,dir,tier===3?.15:.12,.025);
   }
  }
 }
 if(!payload.tris)return undefined;
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(payload.pos,3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(payload.nrm,3));
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(payload.skinIndex,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(payload.skinWeight,4));
 const material=new THREE.MeshStandardMaterial({color:0x4a4152,metalness:.15,roughness:.8,flatShading:true,envMapIntensity:1.6});
 // Same cool dusk rim as the body so the crest/spikes read as silhouette at distance.
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','float ssRim=pow(1.0-clamp(dot(normalize(normal),normalize(vViewPosition)),0.0,1.0),2.5);\noutgoingLight+=vec3(.30,.38,.50)*(ssRim*.3);\n#include <opaque_fragment>');
 };
 material.customProgramCacheKey=()=>RIM_CACHE_KEY+'-addon';
 const mesh=new THREE.SkinnedMesh(geometry,material);
 mesh.name='undead-elite-addon';
 mesh.castShadow=mesh.receiveShadow=true;
 mesh.frustumCulled=false;
 mesh.userData.sharedAsset=false;
 mesh.userData.eliteTier=tier;
 mesh.userData.triangles=payload.tris;
 body.add(mesh);
 mesh.bind(skeleton,bind);
 mesh.updateMatrixWorld(true);
 return mesh;
}

/**
 * Character readability (cycle 2026-10D). All bodies get a sane PBR response plus a cheap
 * scene-independent Fresnel rim so night silhouettes stay readable. A non-destructive fallback
 * replaces the base-colour map only when that map samples near-black over the mesh's own UVs
 * (the batch-3 player/companion atlases are UV-mismatched; once an asset re-bake lands, the
 * sampled mean is healthy and the map path is kept). Detection is cached per texture/geometry and
 * never logs in normal operation.
 */
type TextureStats={imgMean:number;color:THREE.Color};
const textureStats=new WeakMap<THREE.Texture,TextureStats>();
const uvSampleMeans=new WeakMap<THREE.BufferGeometry,WeakMap<THREE.Texture,number>>();
const RIM_CACHE_KEY='ssNightRim1';
function analyseTexture(texture:THREE.Texture):TextureStats|undefined{
 if(textureStats.has(texture))return textureStats.get(texture);
 const image=texture.image as {width?:number;height?:number;videoWidth?:number;videoHeight?:number}|undefined;
 const width=image?.width??image?.videoWidth??0,height=image?.height??image?.videoHeight??0;
 if(typeof document==='undefined'||!width||!height)return undefined;
 try{
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return undefined;
  context.drawImage(image as CanvasImageSource,0,0,32,32);
  const pixels=context.getImageData(0,0,32,32).data;
  let sum=0,count=0,r=0,g=0,b=0,content=0;
  for(let i=0;i<pixels.length;i+=4){const lum=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=lum;count++;if(lum>32){r+=pixels[i];g+=pixels[i+1];b+=pixels[i+2];content++;}}
  const stats:TextureStats={imgMean:count?sum/count:0,color:new THREE.Color().setRGB(content?r/content/255:.5,content?g/content/255:.5,content?b/content/255:.5,THREE.SRGBColorSpace)};
  textureStats.set(texture,stats);return stats;
 }catch{return undefined;}
}
/** Mean luminance of the texture sampled at this geometry's own UVs (cached, <=768 samples). */
function uvSampleMean(geometry:THREE.BufferGeometry,texture:THREE.Texture):number{
 let perGeometry=uvSampleMeans.get(geometry);if(!perGeometry){perGeometry=new WeakMap();uvSampleMeans.set(geometry,perGeometry);}
 const cached=perGeometry.get(texture);if(cached!==undefined)return cached;
 const uv=geometry.attributes.uv as THREE.BufferAttribute|undefined;
 const image=texture.image as {width?:number;height?:number;videoWidth?:number;videoHeight?:number}|undefined;
 const width=image?.width??image?.videoWidth??0,height=image?.height??image?.videoHeight??0;
 if(!uv||typeof document==='undefined'||!width||!height){perGeometry.set(texture,Infinity);return Infinity;}
 try{
  // Sample at (near) full resolution: downscaling the atlas would average the black gutters
  // into the islands and hide the UV/atlas mismatch we need to detect.
  const sampleWidth=Math.min(512,width),sampleHeight=Math.min(512,height);
  const canvas=document.createElement('canvas');canvas.width=sampleWidth;canvas.height=sampleHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return Infinity;
  context.drawImage(image as CanvasImageSource,0,0,sampleWidth,sampleHeight);
  const pixels=context.getImageData(0,0,sampleWidth,sampleHeight).data;
  let sum=0,count=0;const step=Math.max(1,Math.floor(uv.count/768));
  for(let i=0;i<uv.count;i+=step){
   const u=((uv.getX(i)%1)+1)%1,v=((uv.getY(i)%1)+1)%1;
   const x=Math.min(sampleWidth-1,Math.floor(u*sampleWidth)),y=Math.min(sampleHeight-1,Math.floor(v*sampleHeight)),p=(y*sampleWidth+x)*4;
   sum+=.2126*pixels[p]+.7152*pixels[p+1]+.0722*pixels[p+2];count++;
  }
  const mean=count?sum/count:Infinity;perGeometry.set(texture,mean);return mean;
 }catch{return Infinity;}
}
// Armour-vs-cloth classification for cycle-4/5 character armour prims (materials keep their own
// embedded baseColor/normal/ORM maps; only tint/rim/PBR factors differ per class).
const ARMOUR_MATERIAL=/helm|helmet|cuirass|plate|pauldron|armour|armor|chain|mail|bracer|gauntlet|visor|greave|sabaton|gorget|shield|metal|iron|steel/i;
// Cycle-5 cloth prims get a cheap, scene-independent vertex wind (styling follows landscape.ts's
// foliage sway: time-driven sines, gust scale). Cloth only — never plate/skin — and the whole
// shader term is removed at low quality so there is no per-vertex cost there.
const CLOTH_MATERIAL=/cloth|tabard|cloak|hood|robe|skirt|cape|cowl|mantle|sash|banner/i;
let clothWindEnabled=true;
const clothMaterials=new Set<THREE.MeshStandardMaterial>();
const clothWindClock={value:0};
const WIND_CACHE_KEY='ss-cloth-wind';
/** Called by the scene when the quality tier changes; low removes the wind shader entirely. */
export function setCharacterWindQuality(tier:'low'|'medium'|'high'){
 const enabled=tier!=='low';if(enabled===clothWindEnabled)return;clothWindEnabled=enabled;
 for(const material of clothMaterials)material.needsUpdate=true;
}
/** Test/debug visibility into the cloth-wind state (no allocation beyond the small object). */
export function clothWindState(){return {enabled:clothWindEnabled,materials:clothMaterials.size,time:clothWindClock.value};}
function repairCharacterMaterials(root:THREE.Object3D){
 root.traverse(object=>{
  if(!(object instanceof THREE.SkinnedMesh))return;
  const list=(Array.isArray(object.material)?object.material:[object.material]) as THREE.MeshStandardMaterial[];
  for(const material of list){
   if(!material||!material.isMeshStandardMaterial||material.userData.ssReadable)continue;
   material.userData.ssReadable=true;
   const armour=ARMOUR_MATERIAL.test(material.name||''),cloth=!armour&&CLOTH_MATERIAL.test(material.name||'');
   // Sane night-PBR response; armour keeps a touch more env response, cloth stays matte.
   material.metalness=Math.min(material.metalness??0,.35);
   material.roughness=Math.max(material.roughness??1,armour?.6:.65);
   material.envMapIntensity=Math.max(material.envMapIntensity??1,armour?2.3:2);
   // Non-destructive fallback: only when the map is genuinely black over this mesh's UVs while
   // the atlas itself has content. Kept reversible (originals stashed in userData).
   const map=material.map;
   let bypassedMap=false,sampled=Infinity;
   if(map){
    const stats=analyseTexture(map);sampled=uvSampleMean(object.geometry,map);
    // Require a large image-vs-UV gap: a correctly mapped (even intentionally dark/palette) atlas
    // samples close to its own mean, while the mismatched batch-3 charts sample the black gutters.
    if(stats&&sampled<34&&sampled<stats.imgMean*.45&&stats.imgMean>24){
     bypassedMap=true;
     material.userData.ssOriginalMap=map;material.userData.ssOriginalColor=material.color.clone();
     material.userData.ssOriginalMetalness=material.metalness;material.userData.ssOriginalRoughness=material.roughness;
     material.map=null;material.color.copy(stats.color).multiplyScalar(.44);
     material.metalness=.2;material.roughness=.62;
     material.emissive.copy(stats.color).multiplyScalar(.075);material.emissiveIntensity=1;
    }
   }
   // Cycle-4 night tone: cloth/body albedo target 81/255 sRGB (cycle-3 was 84) brings the
   // third-person torso p50 back under 100; armour gets a slightly brighter steel target 85 and
   // a little more env response so plates read as metal next to darker cloth. Map, normal, AO and
   // ORM maps are left untouched.
   if(!bypassedMap){
    const tintSrgb=Math.min(1,Math.max(.62,(armour?85:81)/Math.max(24,sampled)));
    material.color.multiplyScalar(Math.pow(tintSrgb,2.2));
   }
   // Cool dusk Fresnel rim: cloth keeps the stronger silhouette rim, armour a slightly lower one
   // (its env/specular already separates it); both are additive and scene-independent.
   const rimColour=armour?'vec3(.30,.40,.55)':'vec3(.28,.36,.46)',rimWeight=armour?.2:.25;
   // Cloth wind is normalised against the prim's own bind-space bounds (character geometry is
   // authored in ~centimetre units with a node scale, so a fixed metre offset would be invisible).
   if(cloth){
    object.geometry.computeBoundingBox();const bounds=object.geometry.boundingBox!;
    const height=Math.max(.001,bounds.max.y-bounds.min.y);
    material.userData.windMinY=bounds.min.y;material.userData.windHeight=height;material.userData.windAmp=height*.03;
   }
   material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float ssRim=pow(1.0-clamp(dot(normalize(normal),normalize(vViewPosition)),0.0,1.0),2.5);\noutgoingLight+=${rimColour}*(ssRim*${rimWeight});\n#include <opaque_fragment>`);
    if(cloth){
     // Bind-space sway before skinning: hem (norm 0) moves ~3 % of the piece, waist/head stays put.
     shader.uniforms.uWindTime=clothWindClock;
     shader.uniforms.uWindMinY={value:material.userData.windMinY as number};
     shader.uniforms.uWindInvHeight={value:1/Math.max(.001,material.userData.windHeight as number)};
     shader.uniforms.uWindAmp={value:material.userData.windAmp as number};
     shader.vertexShader='uniform float uWindTime;\nuniform float uWindMinY;\nuniform float uWindInvHeight;\nuniform float uWindAmp;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
float ssNorm=clamp((position.y-uWindMinY)*uWindInvHeight,0.0,1.0);
float ssSway=pow(1.0-ssNorm,1.4)*uWindAmp;
float ssPhase=uWindTime*2.2+ssNorm*4.0+(position.x+position.z)*0.05;
transformed.x+=sin(ssPhase)*ssSway;
transformed.z+=cos(ssPhase*0.85)*ssSway*0.65;`);
    }
   };
   material.customProgramCacheKey=()=>RIM_CACHE_KEY+(armour?'a':'c')+(material.map?'m':'n')+(cloth?(clothWindEnabled?'W':'w'):'');
   if(cloth){
    clothMaterials.add(material);material.userData.cloth=true;
    material.onBeforeRender=()=>{clothWindClock.value=performance.now()*.001;};
   }
   material.needsUpdate=true;
  }
 });
}
// ---------------------------------------------------------------------------------------------
// Cycle-8 combat hit feedback v2 (client-only). Weapon-scaled emissive flash + short stagger, driven
// from the posed rig itself: material originals are stashed per material and restored on expiry or
// dispose, so pooled/removed actors cannot leak state. Reduced motion suppresses both effects, and
// only the pivot is offset so grounding/animation are untouched. No per-frame allocations.
export type HitFeedbackOptions={weight?:number;durationMs?:number;stagger?:number;flashColor?:number;reduced?:boolean};
export type HitFeedbackState={hits:number;flashActive:boolean;flashRemainingMs:number;flashDurationMs:number;flashWeight:number;staggerActive:boolean;staggerRemainingMs:number;staggerMagnitude:number;reduced:boolean;lastFlashColor:number;actorId:string};
export type HitFeedbackRig={hit(options?:HitFeedbackOptions):void;hitState():HitFeedbackState};
let combatHitReduced=false;
let combatHitCount=0;
let lastHitFeedback:HitFeedbackState={hits:0,flashActive:false,flashRemainingMs:0,flashDurationMs:0,flashWeight:0,staggerActive:false,staggerRemainingMs:0,staggerMagnitude:0,reduced:false,lastFlashColor:0,actorId:''};
const hitFeedbackRigs=new Map<string,HitFeedbackRig>();
/** Global reduced-motion switch (scene calls this from its prefers-reduced-motion tracking). */
export function setHitFeedbackReducedMotion(reduced:boolean){combatHitReduced=reduced;}
/** Live rig ids for QA hooks (enemy actor ids appear as `a<N>`). */
export function enemyHitRigIds():string[]{return [...hitFeedbackRigs.keys()];}
/** Readable state for QA hooks: aggregates the latest triggered hit across all live rigs. */
export function enemyHitFxState(){return {...lastHitFeedback,hits:combatHitCount};}
/** Deterministic QA/debug trigger: hits a live rig by actor id (or the most recently created rig). */
export function triggerEnemyHit(actorId?:string,options?:HitFeedbackOptions):boolean{
 const rig=actorId?hitFeedbackRigs.get(actorId):[...hitFeedbackRigs.values()].pop();
 if(!rig)return false;rig.hit(options);return true;
}
function installCombatHitHooks(){
 if(typeof window==='undefined')return;
 const hooks=window as unknown as Record<string,unknown>;
 if(hooks.__ssEnemyHitFx)return;
 hooks.__ssEnemyHitFx=()=>enemyHitFxState();
 hooks.__ssTriggerEnemyHit=(actorId?:string,options?:HitFeedbackOptions)=>triggerEnemyHit(actorId,options);
 hooks.__ssHitRigIds=()=>enemyHitRigIds();
 hooks.__ssSetHitFeedbackReducedMotion=(value?:boolean|null)=>{setHitFeedbackReducedMotion(!!value);};
}
export function customCharacter(source:GLTF,a:Actor,equipment:Map<string,GLTF>,unarmed=false){
 const model=clone(source.scene);model.updateMatrixWorld(true);
 const bounds=meshBounds(model),scale=1.85/bounds.getSize(new THREE.Vector3()).y;
 const pivot=new THREE.Group();pivot.add(model);model.scale.multiplyScalar(scale);model.position.y-=bounds.min.y*scale;pivot.rotation.y=Math.PI;
 model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;const list=Array.isArray(o.material)?o.material:[o.material];const copies=list.map(m=>m.clone());o.material=Array.isArray(o.material)?copies:copies[0];}});
 pivot.updateMatrixWorld(true);
 const ground=grounder(model,pivot);
 const getBone=(name:string)=>model.getObjectByName(name)||model.getObjectByName('mixamorig:'+name.replace('mixamorig',''))||(name==='mixamorigHips'?(model.getObjectByName('Bip01_Pelvis')||model.getObjectByName('Bip01')||model.getObjectByName('pelvis')||model.getObjectByName('root')):undefined);
 const hips=getBone('mixamorigHips'),hipPoint=new THREE.Vector3();
 const hipOrigin=hips?pivot.worldToLocal(hips.getWorldPosition(new THREE.Vector3())):new THREE.Vector3();
 const attachments:{bone:THREE.Object3D;grip:THREE.Group}[]=[];
 const w=weaponStats(a.weapon);
 for(const [name,boneName,height] of (unarmed||a.kind==='zombie'?[]:[[w.asset,'mixamorigRightHand',w.length],...(w.shield?[['shield','mixamorigLeftHand',.62]]:[])]) as [string,string,number][]){
  const asset=equipment.get(name),bone=getBone(boneName);if(!asset||!bone)continue;
  const grip=equipmentModel(asset.scene,height,name==='shield',name);grip.name='equipment-'+name;grip.rotation.set(0,0,name==='shield'?Math.PI/2:-Math.PI/2);bone.add(grip);attachments.push({bone,grip});
 }
 // Two-handed support hand: reach the off-hand to the shaft just below the weapon hand.
 const leftUpper=getBone('mixamorigLeftArm'),leftFore=getBone('mixamorigLeftForeArm'),leftHand=getBone('mixamorigLeftHand'),leftClavicle=getBone('mixamorigLeftShoulder'),weaponGrip=attachments[0]?.grip;
 const twoHanded=!w.shield&&!!weaponGrip&&!!leftUpper&&!!leftFore&&!!leftHand;
 const shoulder=new THREE.Vector3(),elbow=new THREE.Vector3(),wrist=new THREE.Vector3(),gripPos=new THREE.Vector3(),clavPos=new THREE.Vector3(),shaft=new THREE.Vector3(),target=new THREE.Vector3(),aimPoint=new THREE.Vector3(),fingersDir=new THREE.Vector3(),elbowGoal=new THREE.Vector3(),upperVec=new THREE.Vector3(),foreVec=new THREE.Vector3(),wantUpper=new THREE.Vector3(),wantFore=new THREE.Vector3(),reachDir=new THREE.Vector3(),bendDir=new THREE.Vector3(),dirFrom=new THREE.Vector3(),dirTo=new THREE.Vector3();
 const worldQuat=new THREE.Quaternion(),aimDelta=new THREE.Quaternion(),localDelta=new THREE.Quaternion();
 // Rotate a bone so its world direction `from` becomes `to` (parents updated; no allocation).
 const turn=(bone:THREE.Object3D,from:THREE.Vector3,to:THREE.Vector3)=>{if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;aimDelta.setFromUnitVectors(dirFrom.copy(from).normalize(),dirTo.copy(to).normalize());bone.parent!.getWorldQuaternion(worldQuat);localDelta.copy(worldQuat).invert().multiply(aimDelta).multiply(worldQuat);bone.quaternion.premultiply(localDelta);bone.updateWorldMatrix(true,false);};
 // Analytic two-bone reach, elbows out/down, so the off-hand wraps the shaft at idle, run and attack.
 const poseSupportHand=()=>{if(!twoHanded)return;
  weaponGrip!.getWorldPosition(gripPos);shaft.set(0,1,0).transformDirection(weaponGrip!.matrixWorld).normalize();
  // Protract the left clavicle part-way toward the weapon so the short arm chain can reach further.
  if(leftClavicle){leftClavicle.getWorldPosition(clavPos);leftUpper!.getWorldPosition(shoulder);wantUpper.subVectors(shoulder,clavPos);bendDir.subVectors(gripPos,clavPos);
   if(wantUpper.lengthSq()>1e-10&&bendDir.lengthSq()>1e-10){wantUpper.normalize();bendDir.normalize();wantFore.copy(wantUpper).multiplyScalar(.6).addScaledVector(bendDir,.4).normalize();turn(leftClavicle,wantUpper,wantFore);}}
  leftUpper!.getWorldPosition(shoulder);leftFore!.getWorldPosition(elbow);leftHand!.getWorldPosition(wrist);
  target.copy(gripPos).addScaledVector(shaft,-THREE.MathUtils.clamp(w.length*.17,.12,.3));aimPoint.copy(target);
  const l1=shoulder.distanceTo(elbow),l2=elbow.distanceTo(wrist);reachDir.subVectors(target,shoulder);
  const dist=reachDir.length();if(l1<1e-4||l2<1e-4||dist<1e-6)return;
  const reach=Math.min(Math.max(dist,Math.abs(l1-l2)+.01),(l1+l2)*.995);reachDir.normalize();target.copy(shoulder).addScaledVector(reachDir,reach);
  bendDir.subVectors(shoulder,gripPos);bendDir.y-=.5;bendDir.addScaledVector(reachDir,-bendDir.dot(reachDir));
  if(bendDir.lengthSq()<1e-8){bendDir.set(0,-1,0).addScaledVector(reachDir,-reachDir.y);if(bendDir.lengthSq()<1e-8)bendDir.set(1,0,0).addScaledVector(reachDir,-reachDir.x);}
  bendDir.normalize();
  const along=(l1*l1-l2*l2+reach*reach)/(2*reach),out=Math.sqrt(Math.max(0,l1*l1-along*along));
  elbowGoal.copy(shoulder).addScaledVector(reachDir,along).addScaledVector(bendDir,out);
  upperVec.subVectors(elbow,shoulder);wantUpper.subVectors(elbowGoal,shoulder);turn(leftUpper!,upperVec,wantUpper);
  leftFore!.getWorldPosition(elbow);leftHand!.getWorldPosition(wrist);foreVec.subVectors(wrist,elbow);wantFore.subVectors(target,elbow);turn(leftFore!,foreVec,wantFore);
  // Fingers (hand bone local +Y) aim at the shaft so the palm reads as closing on it.
  leftHand!.getWorldPosition(wrist);fingersDir.set(0,1,0).transformDirection(leftHand!.matrixWorld);wantFore.subVectors(aimPoint,wrist);turn(leftHand!,fingersDir,wantFore);
 };
 const proceduralGeometries:THREE.BufferGeometry[]=[];
 const skinBody:(THREE.SkinnedMesh|undefined)=(()=>{let found:THREE.SkinnedMesh|undefined;model.traverse(o=>{if(!found&&o instanceof THREE.SkinnedMesh)found=o as THREE.SkinnedMesh;});return found;})();
 const headRef=skinBody?skeletonBone(skinBody.skeleton,['mixamorigHead','Head','Bip01_Head1','head.x','c_subneck_1.x','neck.x','mixamorigNeck','Neck']):undefined;
 const head=headRef?.bone??getBone('mixamorigHead');
 if(head&&(a.kind==='corrupted'||a.kind==='zombie')){
  const tier=undeadEliteTier(a);
  const eyeColor=a.kind==='corrupted'?(tier>=3?0xff3a7a:0xff253a):(tier>0?0xff5533:0x9ae640);
  const eyeMat=new THREE.MeshBasicMaterial({color:eyeColor});
  const eyeGeo=eyePairGeometry(.025,.05);
  const eyes=new THREE.Mesh(eyeGeo,eyeMat);
  eyes.name='undead-eye';eyes.position.set(0,.07,.11);
  head.add(eyes);proceduralGeometries.push(eyeGeo);
  if(tier>0){
   // Subtle additive glow (violet-red) so elites read at range without blowing out the face.
   const haloGeo=new THREE.SphereGeometry(.075,8,4);
   const halo=new THREE.Mesh(haloGeo,new THREE.MeshBasicMaterial({color:a.kind==='corrupted'?0xb46cff:0xff4433,transparent:true,opacity:.3,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));
   halo.name='undead-eye-glow';halo.position.set(0,.07,.13);halo.scale.set(1,.5,.45);
   head.add(halo);proceduralGeometries.push(haloGeo);
  }
 }
 repairCharacterMaterials(model);
 const eliteAddOn=buildEliteUndeadAddOn(model,a);
 if(eliteAddOn)proceduralGeometries.push(eliteAddOn.geometry);
 // Combat hit feedback v2 state (lazy material capture: unhit rigs pay nothing).
 let hitMaterials:THREE.MeshStandardMaterial[]|null=null;
 const isEquipmentMesh=(object:THREE.Object3D)=>{let parent:THREE.Object3D|null=object;while(parent){if(parent.name&&parent.name.startsWith('equipment-'))return true;parent=parent.parent;}return false;};
 const captureHitMaterials=()=>{if(hitMaterials)return hitMaterials;const list:THREE.MeshStandardMaterial[]=[];model.traverse(o=>{if(!(o instanceof THREE.Mesh)||isEquipmentMesh(o))return;for(const material of Array.isArray(o.material)?o.material:[o.material])if(material instanceof THREE.MeshStandardMaterial&&!list.includes(material))list.push(material);});hitMaterials=list;return list;};
 const restoreHitMaterials=()=>{if(!hitMaterials)return;for(const material of hitMaterials){const original=material.userData.ssHitEmissive as number|undefined;if(original===undefined)continue;material.emissive.setHex(original);material.emissiveIntensity=(material.userData.ssHitEmissiveIntensity as number|undefined)??1;delete material.userData.ssHitEmissive;delete material.userData.ssHitEmissiveIntensity;}};
 let hitFlashRemaining=0,hitFlashDuration=0,hitFlashWeight=0,hitFlashColorHex=0,hitStaggerRemaining=0,hitStaggerDuration=0,hitStaggerMagnitude=0,hitClock=0,hitCount=0,hitReduced=false;
 const hit=(options:HitFeedbackOptions={})=>{
  const weight=Math.max(.5,Math.min(2,options.weight??1));
  const reduced=options.reduced??combatHitReduced;hitReduced=reduced;
  hitCount++;combatHitCount++;hitClock=0;
  if(reduced){restoreHitMaterials();hitFlashRemaining=0;hitStaggerRemaining=0;hitFlashDuration=0;hitStaggerMagnitude=0;lastHitFeedback={hits:combatHitCount,flashActive:false,flashRemainingMs:0,flashDurationMs:0,flashWeight:weight,staggerActive:false,staggerRemainingMs:0,staggerMagnitude:0,reduced:true,lastFlashColor:0,actorId:a.id};return;}
  const duration=Math.max(40,Math.min(200,options.durationMs??(80+weight*35)));
  hitFlashColorHex=options.flashColor??(a.kind==='zombie'||a.kind==='corrupted'?0x5a1f22:0x2a3440);
  for(const material of captureHitMaterials()){
   if(material.userData.ssHitEmissive===undefined){material.userData.ssHitEmissive=material.emissive.getHex();material.userData.ssHitEmissiveIntensity=material.emissiveIntensity;}
   material.emissive.setHex(hitFlashColorHex);material.emissiveIntensity=Math.min(2,1.1+weight*.35);
  }
  hitFlashRemaining=duration;hitFlashDuration=duration;hitFlashWeight=weight;
  hitStaggerDuration=Math.max(60,Math.min(240,120+weight*45));
  hitStaggerRemaining=hitStaggerDuration;hitStaggerMagnitude=options.stagger??(.055+weight*.045);
  lastHitFeedback={hits:combatHitCount,flashActive:true,flashRemainingMs:hitFlashRemaining,flashDurationMs:hitFlashDuration,flashWeight:weight,staggerActive:true,staggerRemainingMs:hitStaggerRemaining,staggerMagnitude:hitStaggerMagnitude,reduced:false,lastFlashColor:hitFlashColorHex,actorId:a.id};
 };
 const hitState=():HitFeedbackState=>({hits:hitCount,flashActive:hitFlashRemaining>0,flashRemainingMs:Math.max(0,hitFlashRemaining),flashDurationMs:hitFlashDuration,flashWeight:hitFlashWeight,staggerActive:hitStaggerRemaining>0,staggerRemainingMs:Math.max(0,hitStaggerRemaining),staggerMagnitude:hitStaggerMagnitude,reduced:hitReduced,lastFlashColor:hitFlashColorHex,actorId:a.id});
 const mixer=new THREE.AnimationMixer(model),actions=new Map<string,THREE.AnimationAction>();
 for(const clip of source.animations){
  const c=clip.clone();
  const action=mixer.clipAction(c);if(/attack|slash|death|impact/.test(c.name)){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}actions.set(c.name,action);
 }
 let state='',serial=a.attackSerial??0,attackTime=0;
 const rig:HitFeedbackRig&{model:THREE.Group;fragments:THREE.Mesh[];update:(actor:Actor,moving:boolean,dt:number)=>void;dispose:()=>void}={model:pivot,fragments:[] as THREE.Mesh[],hit,hitState,update:(actor:Actor,moving:boolean,dt:number)=>{
  if((actor.attackSerial??0)!==serial){serial=actor.attackSerial??0;attackTime=weaponStats(actor.weapon).cooldown*.85;}
  attackTime=Math.max(0,attackTime-dt);
  const next=actor.hp<=0?'death_forward':attackTime>0?(serial%2?'attack_1':'attack_2'):actor.block?'block_idle':moving?'run':'idle';
  if(next!==state){actions.get(state)?.fadeOut(.12);const action=actions.get(next)??actions.get(next.startsWith('attack')?'slash_1':'idle');action?.reset().fadeIn(.12).play();if(action&&next.startsWith('attack'))action.setDuration(weaponStats(actor.weapon).cooldown*.85);state=next;}
  const run=actions.get('run');if(run)run.timeScale=actor.armor==='heavy'?.8:1;mixer.update(dt);
  // Imported armatures rotate their local axes. Remove root travel in character space, not guessed bone axes.
  pivot.updateWorldMatrix(true,true);if(hips){pivot.worldToLocal(hips.getWorldPosition(hipPoint));model.position.x-=hipPoint.x-hipOrigin.x;model.position.z-=hipPoint.z-hipOrigin.z;}
  pivot.updateMatrixWorld(true);
  ground(actor.hp<=0);pivot.updateMatrixWorld(true);
  if(actor.hp>0&&next!=='block_idle')poseSupportHand();
  for(const {bone,grip} of attachments){const sc=bone.getWorldScale(new THREE.Vector3());grip.scale.set(1/Math.max(.00001,sc.x),1/Math.max(.00001,sc.y),1/Math.max(.00001,sc.z));}
  // Combat feedback decay; the stagger offsets live on the pivot so grounding/animation are intact.
  hitClock+=dt;
  if(hitFlashRemaining>0){hitFlashRemaining-=dt*1000;if(hitFlashRemaining<=0){hitFlashRemaining=0;restoreHitMaterials();}}
  if(hitStaggerRemaining>0){hitStaggerRemaining-=dt*1000;const k=Math.max(0,hitStaggerRemaining/hitStaggerDuration);pivot.position.x=Math.sin(hitClock*46)*hitStaggerMagnitude*k;pivot.position.z=Math.cos(hitClock*39)*hitStaggerMagnitude*.55*k;pivot.rotation.z=Math.sin(hitClock*52)*hitStaggerMagnitude*.4*k;}
  else if(pivot.position.x!==0||pivot.position.z!==0||pivot.rotation.z!==0){pivot.position.x=0;pivot.position.z=0;pivot.rotation.z=0;}
  lastHitFeedback.flashActive=hitFlashRemaining>0;lastHitFeedback.flashRemainingMs=Math.max(0,hitFlashRemaining);lastHitFeedback.staggerActive=hitStaggerRemaining>0;lastHitFeedback.staggerRemainingMs=Math.max(0,hitStaggerRemaining);
 },dispose:()=>{restoreHitMaterials();hitFeedbackRigs.delete(a.id);mixer.stopAllAction();mixer.uncacheRoot(model);for(const geometry of proceduralGeometries)geometry.dispose();model.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){clothMaterials.delete(m as THREE.MeshStandardMaterial);m.dispose();}});}};
 hitFeedbackRigs.set(a.id,rig);installCombatHitHooks();return rig;
}
