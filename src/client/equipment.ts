import * as THREE from 'three';
import {weaponStats,type WeaponId} from '../shared/weapons';
// Measured in the supplied GLBs' scene coordinates: handle center and tip direction.
// rapier/halberd/dane_axe/flamberge/mace are baked canonically (grip at origin, blade +Y), so no re-fit.
export const WEAPON_GRIPS:Record<string,{grip:number[];blade:number[]}>= {
 sword:{grip:[.005,0,-.69],blade:[0,0,1]},
 bastard:{grip:[.005,.76,0],blade:[0,-1,0]},
 hammer:{grip:[.005,-.66,0],blade:[0,1,0]},
 poleaxe:{grip:[0,-.35,.48],blade:[0,.58,-.815]},
 zweihander:{grip:[0,-.65,.70],blade:[0,.682,-.731]},
 rapier:{grip:[0,0,0],blade:[0,1,0]},
 halberd:{grip:[0,0,0],blade:[0,1,0]},
 spear:{grip:[0,0,0],blade:[0,1,0]},
 dane_axe:{grip:[0,0,0],blade:[0,1,0]},
 flamberge:{grip:[0,0,0],blade:[0,1,0]},
 mace:{grip:[0,0,0],blade:[0,1,0]}
};
/** Imports may lie along any axis. Fit by longest extent, never thin Y thickness. */
export function equipmentModel(source:THREE.Object3D,length:number,shield=false,asset?:string){
 const item=source.clone(true),root=new THREE.Group();root.add(item);item.updateMatrixWorld(true);
 let bounds=new THREE.Box3().setFromObject(item),size=bounds.getSize(new THREE.Vector3());
 const profile=asset?WEAPON_GRIPS[asset]:undefined;
 if(profile){
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...profile.blade as [number,number,number]).normalize(),new THREE.Vector3(0,1,0));
  const wrapper=new THREE.Group();root.remove(item);wrapper.add(item);root.add(wrapper);wrapper.quaternion.copy(rotation);root.updateMatrixWorld(true);
  const height=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3()).y,scale=length/height;
  wrapper.scale.setScalar(scale);wrapper.position.copy(new THREE.Vector3(...profile.grip as [number,number,number]).applyQuaternion(rotation).multiplyScalar(-scale));
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();}});
  return root;
 }
 const longest=size.x>=size.y&&size.x>=size.z?'x':size.z>size.y?'z':'y';
 if(longest==='x')item.rotation.z+=Math.PI/2;else if(longest==='z')item.rotation.x-=Math.PI/2;
 item.updateMatrixWorld(true);bounds.setFromObject(item);size=bounds.getSize(new THREE.Vector3());
 if(shield&&size.x<size.z){item.rotation.y+=Math.PI/2;item.updateMatrixWorld(true);bounds.setFromObject(item);}
 const center=bounds.getCenter(new THREE.Vector3());item.position.sub(center);
 const scale=length/Math.max(...bounds.getSize(new THREE.Vector3()).toArray());item.scale.multiplyScalar(scale);item.position.multiplyScalar(scale);
 // Blade extends above the grip; shield is centered about the forearm.
 if(!shield)item.position.y+=length*.34;
 root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;const ms=Array.isArray(o.material)?o.material:[o.material];o.material=Array.isArray(o.material)?ms.map(m=>m.clone()):ms[0].clone();}});
 return root;
}
/** A true wearer-facing back, rather than a repeated front-projected crest. */
export function shieldBacking(parent:THREE.Object3D){
 const shape=new THREE.Shape();shape.moveTo(-.23,.27);shape.lineTo(.23,.27);shape.lineTo(.2,-.12);shape.lineTo(0,-.34);shape.lineTo(-.2,-.12);shape.closePath();
 const back=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:0x49372a,roughness:.95,side:THREE.DoubleSide}));back.position.z=.075;parent.add(back);
 for(const y of [-.08,.13]){const strap=new THREE.Mesh(new THREE.TorusGeometry(.085,.018,6,16,Math.PI),new THREE.MeshStandardMaterial({color:0x21170f,roughness:.85}));strap.rotation.x=Math.PI/2;strap.position.set(0,y,.09);parent.add(strap);}
}
/**
 * Combat-feedback palette (cycle 2026-10F): weapon type + tier data for third-person swing trails
 * and impact/block sparks. Data only — the pooled particle/ribbon systems in scene.ts/effects.ts
 * consume it (owned by world-scene), so no allocation or per-frame work happens here.
 * `trail` is HDR-ish additive RGB scaled by weapon weight; `impact` is the spark colour.
 */
export type CombatSwingStyle='thrust'|'cleave'|'crush'|'sweep';
export type WeaponCombatProfile={style:CombatSwingStyle;weight:number;trail:[number,number,number];impact:[number,number,number]};
const SWING_BY_ASSET:Record<string,CombatSwingStyle>={sword:'thrust',rapier:'thrust',spear:'thrust',flamberge:'cleave',dane_axe:'cleave',zweihander:'cleave',mace:'crush',hammer:'crush',bastard:'crush',poleaxe:'sweep',halberd:'sweep'};
const TRAIL_BASE:Record<CombatSwingStyle,[number,number,number]>={thrust:[1.1,1.5,1.8],cleave:[1.8,1.0,.38],crush:[1.35,1.35,1.55],sweep:[.75,1.55,1.15]};
const IMPACT_BASE:Record<CombatSwingStyle,[number,number,number]>={thrust:[.9,1.4,1.9],cleave:[1.9,.9,.35],crush:[1.6,1.4,1.1],sweep:[.8,1.6,1.2]};
/** Deterministic per-weapon combat profile: type from the asset, weight from damage (0.8–1.6). */
export function weaponCombatProfile(id?:WeaponId):WeaponCombatProfile{
 const weapon=weaponStats(id),style=SWING_BY_ASSET[weapon.asset]??'thrust';
 const weight=Math.max(.8,Math.min(1.6,weapon.damage/45));
 const scale=(base:[number,number,number]):[number,number,number]=>[+(base[0]*weight).toFixed(3),+(base[1]*weight).toFixed(3),+(base[2]*weight).toFixed(3)];
 return {style,weight,trail:scale(TRAIL_BASE[style]),impact:scale(IMPACT_BASE[style])};
}
/** Cold steel spark for a successful block (kept brighter/additive than a flesh hit). */
export function blockSparkColor():[number,number,number]{return [1.5,1.7,2.1];}
/**
 * Cycle-8 enemy hit feedback: one deterministic profile per weapon so the rig flash duration /
 * stagger amplitude / impact spark all scale with the same combat weight. `flashMs` stays inside
 * the 80–140 ms design band; `spark` is the additive impact colour for the existing particle pool.
 */
export type HitFeedbackProfile={weight:number;flashMs:number;flashIntensity:number;stagger:number;spark:[number,number,number]};
export function hitFeedbackProfile(id?:WeaponId):HitFeedbackProfile{
 const combat=weaponCombatProfile(id),weight=combat.weight;
 return {weight,flashMs:Math.round(80+(weight-.8)*(140-80)/(1.6-.8)),flashIntensity:Math.min(2,1.1+weight*.35),stagger:+(.055+weight*.045).toFixed(3),spark:combat.impact};
}
/** Emissive pulse colour for a struck enemy (undead flesh vs armoured/other). */
export function hitFlashColor(undead:boolean):number{return undead?0x5a1f22:0x2a3440;}

