import * as THREE from 'three';
import {weaponStats} from '../shared/weapons';
import {meshBounds,grounder} from './grounding';
import {equipmentModel} from './equipment';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Actor} from '../shared/types';
export function customCharacter(source:GLTF,a:Actor,equipment:Map<string,GLTF>,unarmed=false){
 const model=clone(source.scene);model.updateMatrixWorld(true);
 const bounds=meshBounds(model),scale=1.85/bounds.getSize(new THREE.Vector3()).y;
 const pivot=new THREE.Group();pivot.add(model);model.scale.multiplyScalar(scale);model.position.y-=bounds.min.y*scale;pivot.rotation.y=Math.PI;
 model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;const list=Array.isArray(o.material)?o.material:[o.material];const copies=list.map(m=>m.clone());o.material=Array.isArray(o.material)?copies:copies[0];}});
 pivot.updateMatrixWorld(true);
 const ground=grounder(model,pivot);
 const hips=model.getObjectByName('mixamorigHips'),hipPoint=new THREE.Vector3();
 const hipOrigin=hips?pivot.worldToLocal(hips.getWorldPosition(new THREE.Vector3())):new THREE.Vector3();
 const attachments:{bone:THREE.Object3D;grip:THREE.Group}[]=[];
 const w=weaponStats(a.weapon);
 for(const [name,boneName,height] of (unarmed||a.kind==='zombie'?[]:[[w.asset,'mixamorigRightHand',w.length],...(w.shield?[['shield','mixamorigLeftHand',.62]]:[])]) as [string,string,number][]){
  const asset=equipment.get(name),bone=model.getObjectByName(boneName);if(!asset||!bone)continue;
  const grip=equipmentModel(asset.scene,height,name==='shield',name);grip.name='equipment-'+name;grip.rotation.set(0,0,name==='shield'?Math.PI/2:-Math.PI/2);bone.add(grip);attachments.push({bone,grip});
 }
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
  if(!w.shield&&actor.hp>0&&next!=='block_idle'){
   const la=model.getObjectByName('mixamorigLeftArm'),lfa=model.getObjectByName('mixamorigLeftForeArm');
   if(la&&lfa){la.rotation.x+=.25;la.rotation.z-=.35;lfa.rotation.y-=.5;}
  }
  // Imported armatures rotate their local axes. Remove root travel in character space, not guessed bone axes.
  pivot.updateWorldMatrix(true,true);if(hips){pivot.worldToLocal(hips.getWorldPosition(hipPoint));model.position.x-=hipPoint.x-hipOrigin.x;model.position.z-=hipPoint.z-hipOrigin.z;}
  ground(actor.hp<=0);pivot.updateMatrixWorld(true);for(const {bone,grip} of attachments){const sc=bone.getWorldScale(new THREE.Vector3());grip.scale.set(1/Math.max(.00001,sc.x),1/Math.max(.00001,sc.y),1/Math.max(.00001,sc.z));}
 },dispose:()=>{mixer.stopAllAction();mixer.uncacheRoot(model);model.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}};
}
