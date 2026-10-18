import * as THREE from 'three';
import {CASTLES,CAMPS,dist} from '../shared/world';
/** Shared geometry and instancing keep the richer vegetation inexpensive. */
export function addLandscape(scene:THREE.Scene){
 let seed=9821;const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const clear=(x:number,z:number)=>CASTLES.some(c=>Math.abs(x-c.x)<16&&Math.abs(z-c.z)<18)||CAMPS.some(c=>dist(c,{x,z})<8)||Math.abs(x)<5;
 const treePositions:{x:number;z:number;h:number}[]=[];
 for(let i=0;i<400;i++){const x=rand()*152-65,z=35-rand()*710;if(!clear(x,z))treePositions.push({x,z,h:4+rand()*5});}
 const bark=new THREE.MeshStandardMaterial({color:0x484038,roughness:1});const leaves=new THREE.MeshStandardMaterial({color:0x566447,roughness:1});
 const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.11,.32,1,9),bark,treePositions.length*4);
 const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,2),leaves,treePositions.length*5);const dummy=new THREE.Object3D();let ti=0,ci=0;
 for(const {x,z,h}of treePositions){
  dummy.position.set(x,h*.35,z);dummy.rotation.set(.03,rand()*6,.04);dummy.scale.set(1,h*.7,1);dummy.updateMatrix();trunks.setMatrixAt(ti++,dummy.matrix);
  for(let n=0;n<3;n++){const angle=n*2.094+rand()*.4;dummy.position.set(x+Math.sin(angle)*.55,h*(.45+n*.08),z+Math.cos(angle)*.55);dummy.rotation.set(Math.cos(angle)*.65,angle,Math.sin(angle)*.65);dummy.scale.set(.45,h*.32,.45);dummy.updateMatrix();trunks.setMatrixAt(ti++,dummy.matrix);}
  for(let n=0;n<5;n++){const angle=n*2.4;dummy.position.set(x+Math.sin(angle)*1.1,h*.68+n*.24,z+Math.cos(angle)*1.1);dummy.rotation.set(rand(),rand()*6,rand());dummy.scale.set(1.35+rand()*.6,1.1+rand()*.6,1.3+rand()*.6);dummy.updateMatrix();crowns.setMatrixAt(ci,dummy.matrix);crowns.setColorAt(ci++,new THREE.Color().setHSL(z< -400?.26:.22+rand()*.08,.14+rand()*.15,.23+rand()*.1));}
 }
 trunks.castShadow=trunks.receiveShadow=true;crowns.castShadow=crowns.receiveShadow=true;trunks.computeBoundingSphere();crowns.computeBoundingSphere();scene.add(trunks,crowns);
 // Crossed, tapered blades with a dark-to-light vertex gradient.
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute([-.14,0,0,.14,0,0,.03,.58,0,0,0,-.14,0,0,.14,0,.48,.04],3));geom.setAttribute('color',new THREE.Float32BufferAttribute([.36,.42,.25,.36,.42,.25,.68,.72,.44,.36,.42,.25,.36,.42,.25,.62,.69,.4],3));geom.computeVertexNormals();
 const grass=new THREE.InstancedMesh(geom,new THREE.MeshStandardMaterial({color:0x9ba57a,vertexColors:true,roughness:1,side:THREE.DoubleSide}),6500);let count=0;
 for(let i=0;i<8500&&count<6500;i++){const x=rand()*152-65,z=35-rand()*710;if(clear(x,z))continue;dummy.position.set(x,.015,z);dummy.rotation.set(0,rand()*Math.PI,0);const s=.5+rand();dummy.scale.set(s,s,s);dummy.updateMatrix();grass.setMatrixAt(count++,dummy.matrix);}
 grass.count=count;grass.receiveShadow=true;grass.computeBoundingSphere();scene.add(grass);
 const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0x697067,roughness:1}),75);let ri=0;
 for(let i=0;i<100&&ri<75;i++){const x=rand()*150-65,z=35-rand()*710;if(clear(x,z))continue;dummy.position.set(x,.3,z);dummy.rotation.set(rand(),rand()*6,rand());dummy.scale.set(.6+rand(),.4+rand()*.4,.6+rand());dummy.updateMatrix();rocks.setMatrixAt(ri++,dummy.matrix);}rocks.count=ri;rocks.castShadow=rocks.receiveShadow=true;rocks.computeBoundingSphere();scene.add(rocks);
}
