import * as THREE from 'three';
// Measured in the supplied GLBs' scene coordinates: handle center and tip direction.
export const WEAPON_GRIPS:Record<string,{grip:number[];blade:number[]}>= {
 sword:{grip:[.005,0,-.69],blade:[0,0,1]},
 bastard:{grip:[.005,.76,0],blade:[0,-1,0]},
 hammer:{grip:[.005,-.66,0],blade:[0,1,0]},
 poleaxe:{grip:[0,-.35,.48],blade:[0,.58,-.815]},
 zweihander:{grip:[0,-.65,.70],blade:[0,.682,-.731]}
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
