import * as THREE from 'three';
import {weaponStats} from '../shared/weapons';
import {meshBounds,grounder} from './grounding';
import {equipmentModel} from './equipment';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Actor} from '../shared/types';
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
function repairCharacterMaterials(root:THREE.Object3D){
 root.traverse(object=>{
  if(!(object instanceof THREE.SkinnedMesh))return;
  const list=(Array.isArray(object.material)?object.material:[object.material]) as THREE.MeshStandardMaterial[];
  for(const material of list){
   if(!material||!material.isMeshStandardMaterial||material.userData.ssReadable)continue;
   material.userData.ssReadable=true;
   // Sane night-PBR response for the character body (authored values were metal 0 / rough .8).
   material.metalness=Math.min(material.metalness??0,.35);
   material.roughness=Math.max(material.roughness??1,.5);
   material.envMapIntensity=Math.max(material.envMapIntensity??1,2);
   // Non-destructive fallback: only when the map is genuinely black over this mesh's UVs while
   // the atlas itself has content. Kept reversible (originals stashed in userData).
   const map=material.map;
   if(map){
    const stats=analyseTexture(map),sampled=uvSampleMean(object.geometry,map);
    // Require a large image-vs-UV gap: a correctly mapped (even intentionally dark/palette) atlas
    // samples close to its own mean, while the mismatched batch-3 charts sample the black gutters.
    if(stats&&sampled<34&&sampled<stats.imgMean*.45&&stats.imgMean>24){
     material.userData.ssOriginalMap=map;material.userData.ssOriginalColor=material.color.clone();
     material.userData.ssOriginalMetalness=material.metalness;material.userData.ssOriginalRoughness=material.roughness;
     material.map=null;material.color.copy(stats.color).multiplyScalar(.44);
     material.metalness=.2;material.roughness=.62;
     material.emissive.copy(stats.color).multiplyScalar(.075);material.emissiveIntensity=1;
    }
   }
   // Cool dusk Fresnel rim, added to outgoing light in the standard material's fragment stage.
   material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','float ssRim=pow(1.0-clamp(dot(normalize(normal),normalize(vViewPosition)),0.0,1.0),2.5);\noutgoingLight+=vec3(.30,.40,.52)*(ssRim*.5);\n#include <opaque_fragment>');
   };
   material.customProgramCacheKey=()=>RIM_CACHE_KEY+(material.map?'m':'n');
   material.needsUpdate=true;
  }
 });
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
 const head=getBone('mixamorigHead');
 if(head&&(a.kind==='corrupted'||a.kind==='zombie')){
  const eyeColor=a.kind==='corrupted'?0xff253a:0x9ae640;
  const eyeMat=new THREE.MeshBasicMaterial({color:eyeColor});
  const eyeGeo=new THREE.SphereGeometry(.025,6,6);
  for(const dx of [-.05,.05]){
   const eye=new THREE.Mesh(eyeGeo,eyeMat);
   eye.position.set(dx,.07,.11);
   eye.name='undead-eye';
   head.add(eye);
  }
 }
 repairCharacterMaterials(model);
 const mixer=new THREE.AnimationMixer(model),actions=new Map<string,THREE.AnimationAction>();
 for(const clip of source.animations){
  const c=clip.clone();
  const action=mixer.clipAction(c);if(/attack|slash|death|impact/.test(c.name)){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}actions.set(c.name,action);
 }
 let state='',serial=a.attackSerial??0,attackTime=0;
 return {model:pivot,fragments:[] as THREE.Mesh[],update:(actor:Actor,moving:boolean,dt:number)=>{
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
 },dispose:()=>{mixer.stopAllAction();mixer.uncacheRoot(model);model.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}};
}
