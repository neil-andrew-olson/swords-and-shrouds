import * as THREE from 'three';
import {weaponStats} from '../shared/weapons';
import {equipmentModel} from './equipment';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {Actor} from '../shared/types';
export function customCharacter(source:GLTF,a:Actor,equipment:Map<string,GLTF>){
 const model=clone(source.scene);model.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model),scale=1.85/bounds.getSize(new THREE.Vector3()).y;
 const pivot=new THREE.Group();pivot.add(model);model.scale.multiplyScalar(scale);model.position.y-=bounds.min.y*scale;pivot.rotation.y=Math.PI;
 model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;const list=Array.isArray(o.material)?o.material:[o.material];const copies=list.map(m=>m.clone());o.material=Array.isArray(o.material)?copies:copies[0];}});
 pivot.updateMatrixWorld(true);
 const attachments:{bone:THREE.Object3D;grip:THREE.Group}[]=[];
 const w=weaponStats(a.weapon);
 for(const [name,boneName,height] of [[w.asset,'mixamorigRightHand',w.length],...(w.shield?[['shield','mixamorigLeftHand',.62]]:[])] as [string,string,number][]){
  const asset=equipment.get(name),bone=model.getObjectByName(boneName);if(!asset||!bone)continue;
  const grip=equipmentModel(asset.scene,height,name==='shield');grip.name='equipment-'+name;grip.rotation.x=Math.PI/2;bone.add(grip);attachments.push({bone,grip});
 }
 const mixer=new THREE.AnimationMixer(model),actions=new Map<string,THREE.AnimationAction>();
 for(const clip of source.animations){
  const c=clip.clone();for(const track of c.tracks)if(/Hips\.position$/.test(track.name))for(let i=0;i<track.values.length;i+=3){track.values[i]=track.values[0];track.values[i+2]=track.values[2];}
  const action=mixer.clipAction(c);if(/attack|slash|death|impact/.test(c.name)){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}actions.set(c.name,action);
 }
 let state='',serial=a.attackSerial??0,attackTime=0;
 return {model:pivot,fragments:[] as THREE.Mesh[],update:(actor:Actor,moving:boolean,dt:number)=>{
  if((actor.attackSerial??0)!==serial){serial=actor.attackSerial??0;attackTime=weaponStats(actor.weapon).cooldown*.85;}
  attackTime=Math.max(0,attackTime-dt);
  const next=actor.hp<=0?'death_forward':attackTime>0?(serial%2?'attack_1':'attack_2'):actor.block?'block_idle':moving?'run':'idle';
  if(next!==state){actions.get(state)?.fadeOut(.12);const action=actions.get(next);action?.reset().fadeIn(.12).play();if(action&&next.startsWith('attack'))action.setDuration(weaponStats(actor.weapon).cooldown*.85);state=next;}
  const run=actions.get('run');if(run)run.timeScale=actor.armor==='heavy'?.8:1;mixer.update(dt);pivot.updateMatrixWorld(true);for(const {bone,grip} of attachments){const sc=bone.getWorldScale(new THREE.Vector3());grip.scale.set(1/Math.max(.00001,sc.x),1/Math.max(.00001,sc.y),1/Math.max(.00001,sc.z));}
 },dispose:()=>{mixer.stopAllAction();mixer.uncacheRoot(model);model.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}};
}
