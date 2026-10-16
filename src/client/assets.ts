import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {Actor} from '../shared/types';
const loader=new GLTFLoader();
export async function loadAsset(name:string):Promise<GLTF>{
 const response=await fetch(`/assets/${name}.glb.gz`);if(!response.ok)throw Error(`Asset ${name}: ${response.status}`);
 const bytes=await new Response(response.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 return loader.parseAsync(bytes,'/assets/');
}
export class CharacterAssets{
 knight?:GLTF;skeleton?:GLTF;skeletonClips:THREE.AnimationClip[]=[];
 ready=Promise.all([loadAsset('knight'),loadAsset('skeleton'),loadAsset('skeleton-general'),loadAsset('skeleton-movement'),loadAsset('skeleton-combat')]).then(([knight,skeleton,general,movement,combat])=>{this.knight=knight;this.skeleton=skeleton;this.skeletonClips=[...general.animations,...movement.animations,...combat.animations];}).catch(error=>console.warn('Character assets unavailable; using fallback models.',error));
 create(a:Actor){const undead=a.kind==='zombie';const source=undead?this.skeleton:this.knight;if(!source)return;
  const model=clone(source.scene);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());const scale=1.85/size.y;
  const pivot=new THREE.Group();pivot.add(model);model.scale.multiplyScalar(scale);model.position.y-=bounds.min.y*scale;pivot.rotation.y=Math.PI;
  model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;const materials=Array.isArray(o.material)?o.material:[o.material];const tinted=materials.map(m=>{const n=m.clone() as THREE.MeshStandardMaterial;if(n.isMeshStandardMaterial){n.roughness=undead?.85:.46;n.metalness=undead?0:.6;if(a.kind==='corrupted')n.color.multiply(new THREE.Color(.55,.35,.55));if(a.kind==='soldier')n.color.multiply(new THREE.Color(.75,.9,.8));}return n;});o.material=Array.isArray(o.material)?tinted:tinted[0];}});
  if(!undead){const hand=model.getObjectByName('PalmR');if(hand){const sword=new THREE.Group();const steel=new THREE.MeshStandardMaterial({color:0xbac6cf,metalness:.85,roughness:.28});const blade=new THREE.Mesh(new THREE.BoxGeometry(.12,2.3,.18),steel);blade.position.y=1.25;sword.add(blade);const cross=new THREE.Mesh(new THREE.BoxGeometry(.85,.15,.22),new THREE.MeshStandardMaterial({color:0xae8c4c,metalness:.65,roughness:.4}));sword.add(cross);sword.rotation.x=Math.PI/2;hand.add(sword);}}
  const mixer=new THREE.AnimationMixer(model),clips=undead?this.skeletonClips:source.animations;
  const names=undead?{idle:'Idle_A',walk:'Walking_A',attack:'Melee_Unarmed_Attack_Punch_A',death:'Death_A'}:{idle:'Idle',walk:'Run',attack:'Run_swordAttack',death:'Death'};
  const actions=new Map<string,THREE.AnimationAction>();for(const [key,name] of Object.entries(names)){const clip=clips.find(c=>c.name.split('|').pop()===name);if(clip){const action=mixer.clipAction(clip);if(key==='death'||key==='attack'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}actions.set(key,action);}}
  let current='',attackUntil=0,wasSwing=false;
  return {model:pivot,update:(actor:Actor,moving:boolean,dt:number)=>{const swing=actor.swing>0;if(swing&&!wasSwing)attackUntil=.55;wasSwing=swing;attackUntil=Math.max(0,attackUntil-dt);const state=actor.hp<=0?'death':attackUntil>0||actor.windup>0?'attack':moving?'walk':'idle';if(state!==current){const old=actions.get(current),next=actions.get(state);if(next){next.reset().fadeIn(.12).play();old?.fadeOut(.12);}current=state;}mixer.update(dt);},dispose:()=>{mixer.stopAllAction();mixer.uncacheRoot(model);model.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}};
 }
}
