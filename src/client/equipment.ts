import * as THREE from 'three';
/** Imports may lie along any axis. Fit by longest extent, never thin Y thickness. */
export function equipmentModel(source:THREE.Object3D,length:number,shield=false){
 const item=source.clone(true),root=new THREE.Group();root.add(item);item.updateMatrixWorld(true);
 let bounds=new THREE.Box3().setFromObject(item),size=bounds.getSize(new THREE.Vector3());
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
