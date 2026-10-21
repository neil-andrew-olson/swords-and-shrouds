import * as THREE from 'three';
// Bounds from rendered vertices only; armature helpers do not affect body size.
export function meshBounds(root:THREE.Object3D){
 root.updateWorldMatrix(true,true);const bounds=new THREE.Box3(),v=new THREE.Vector3();
 root.traverse(o=>{if(o instanceof THREE.Mesh){if(o instanceof THREE.SkinnedMesh)o.skeleton.update();for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);bounds.expandByPoint(v.applyMatrix4(o.matrixWorld));}}});return bounds;
}
export function grounder(model:THREE.Object3D,pivot:THREE.Object3D){
 // Capture body meshes before equipment. Sample the body and retain all sole vertices.
 const meshes:{mesh:THREE.Mesh;feet:number[]}[]=[],v=new THREE.Vector3(),inverse=new THREE.Matrix4();
 const bounds=meshBounds(model),cutoff=bounds.min.y+bounds.getSize(v).y*.12;
 model.traverse(o=>{if(o instanceof THREE.Mesh){const feet:number[]=[];for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);if(v.applyMatrix4(o.matrixWorld).y<=cutoff||i%Math.max(1,Math.floor(o.geometry.attributes.position.count/1500))===0)feet.push(i);}meshes.push({mesh:o,feet});}});
 return (fallen=false)=>{pivot.updateWorldMatrix(true,true);inverse.copy(pivot.matrixWorld).invert();let min=Infinity;
  for(const {mesh,feet} of meshes){if(mesh instanceof THREE.SkinnedMesh)mesh.skeleton.update();const count=fallen?mesh.geometry.attributes.position.count:feet.length;for(let n=0;n<count;n++){mesh.getVertexPosition(fallen?n:feet[n],v);v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);min=Math.min(min,v.y);}}
  if(Number.isFinite(min))model.position.y-=min;
 };
}
