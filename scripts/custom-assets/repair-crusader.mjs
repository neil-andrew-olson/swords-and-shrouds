import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {weld,simplify,prune,dedup,resample} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {Matrix4,Vector3} from 'three';
// Targeted repair for the supplied ORIGINAL animated Crusader. Output is a
// separate preview GLB. Do not run prepare.mjs on the repaired output.
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/custom-assets/repair-crusader.mjs ORIGINAL.glb REPAIRED.glb');
if(path.resolve(input)===path.resolve(output)||fs.existsSync(output))throw Error('Choose a new output filename; originals are never overwritten.');
if(!path.basename(input).includes('player_templar_crusader_animated'))throw Error('Select the original player_templar_crusader_animated.glb');
const io=new NodeIO(),doc=await io.read(input),skin=doc.getRoot().listSkins()[0];
if(!skin)throw Error('No skeleton found');
const joints=skin.listJoints(),ibm=skin.getInverseBindMatrices();
if(!ibm)throw Error('Missing inverse bind matrices');
const names=joints.map(j=>j.getName().replace('mixamorig:','').replace('mixamorig',''));
const heads=joints.map((j,i)=>new Vector3().setFromMatrixPosition(new Matrix4().fromArray(ibm.getArray(),i*16).invert()));
const index=name=>{const i=names.indexOf(name);if(i<0)throw Error('Missing joint '+name);return i;};
const segments=[['Hips','Spine'],['Spine','Spine1'],['Spine1','Spine2'],['Spine2','Neck'],['Neck','Head'],['Head','HeadTop_End']];
for(const side of ['Left','Right'])segments.push([side+'Shoulder',side+'Arm'],[side+'Arm',side+'ForeArm'],[side+'ForeArm',side+'Hand'],[side+'Hand',side+'HandIndex2'],[side+'UpLeg',side+'Leg'],[side+'Leg',side+'Foot'],[side+'Foot',side+'ToeBase'],[side+'ToeBase',side+'Toe_End']);
const bones=segments.map(([a,b])=>({name:a,joint:index(a),a:heads[index(a)],b:heads[index(b)]}));
const primitives=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
let lo=Infinity,hi=-Infinity;
for(const p of primitives){const a=p.getAttribute('POSITION').getArray();for(let i=2;i<a.length;i+=3){lo=Math.min(lo,a[i]);hi=Math.max(hi,a[i]);}}
if(!(hi-lo>0.00015&&hi-lo<0.00025))throw Error('Unexpected mesh scale: this is not the supplied original Crusader.');
const top=heads[index('HeadTop_End')].y,bottom=Math.min(heads[index('LeftToe_End')].y,heads[index('RightToe_End')].y);
const unit=(top-bottom)/(hi-lo),offset=bottom-lo*unit;
if(!(unit>90&&unit<110))throw Error('Unexpected skeleton scale; no output written.');
function dist2(p,a,b){const x=b.x-a.x,y=b.y-a.y,z=b.z-a.z;const t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y+(p.z-a.z)*z)/(x*x+y*y+z*z)));return (p.x-a.x-t*x)**2+(p.y-a.y-t*y)**2+(p.z-a.z-t*z)**2;}
const dominant={};
for(const p of primitives){
 const pos=p.getAttribute('POSITION'),v=pos.getArray(),normal=p.getAttribute('NORMAL'),n=normal?.getArray();
 const indices=new Uint16Array(pos.getCount()*4),weights=new Float32Array(pos.getCount()*4);
 for(let k=0;k<pos.getCount();k++){
  const i=k*3,x=v[i]*unit,y=v[i+2]*unit+offset,z=-v[i+1]*unit;
  v[i]=x;v[i+1]=y;v[i+2]=z;
  if(n){const ny=n[i+1];n[i+1]=n[i+2];n[i+2]=-ny;}
  const point={x,y,z};
  // Blend nearby anatomical segments; preserve the original skeleton and clips.
  const nearest=bones.map(b=>({b,d:dist2(point,b.a,b.b)})).sort((a,b)=>a.d-b.d).slice(0,4);
  const scores=nearest.map(o=>1/Math.pow(o.d+0.0000002,3)),sum=scores.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(sum)||sum<=0)throw Error('Invalid weights');
  nearest.forEach((o,j)=>{indices[k*4+j]=o.b.joint;weights[k*4+j]=scores[j]/sum;});
  const key=nearest[0].b.name;dominant[key]=(dominant[key]??0)+1;
 }
 pos.setArray(v);if(n)normal.setArray(n);
 const buffer=pos.getBuffer();
 p.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(indices).setBuffer(buffer));
 p.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
 p.setAttribute('TANGENT',null);
}
for(const name of ['LeftForeArm','RightForeArm','LeftHand','RightHand'])if(!dominant[name])throw Error('No vertices assigned to '+name);
const keep=new Set(['idle','run','walk','attack_1','attack_2','slash_1','block_idle','impact_light','death_forward']);
for(const clip of doc.getRoot().listAnimations())if(!keep.has(clip.getName()))clip.dispose();
await MeshoptSimplifier.ready;
const count=()=>doc.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
const before=count();
await doc.transform(weld(),simplify({simplifier:{...MeshoptSimplifier,simplify:(i,p,s,t,e,f)=>MeshoptSimplifier.simplify(i,p,s,t,e,[...f,'Permissive'])},ratio:Math.min(1,80000/before),error:.001,lockBorder:false}),resample(),prune(),dedup());
await io.write(output,doc);
console.log(JSON.stringify({output,trianglesBefore:before,trianglesAfter:count(),meshScaleCorrection:unit,meshOffset:offset,dominantVertices:dominant},null,2));
console.log('Rear texture is unchanged. Preview this file before installing.');
