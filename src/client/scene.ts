import {characterAsset} from '../shared/characters';
import * as THREE from 'three';
import {customCharacter} from './custom-character';
import {equipmentModel} from './equipment';
import {weaponStats,WEAPONS,type WeaponId} from '../shared/weapons';
import {addLandscape} from './landscape';
import {CharacterAssets,loadAsset} from './assets';
import {CASTLES,CAMPS,REGIONS,NEST,START,walls,dist} from '../shared/world';
import type {Game,Actor} from '../shared/types';
const palette={stone:0x56646a,dark:0x303f47,wood:0x70533e,iron:0xa0a9ad,gold:0xd1a05b,undead:0x768274};
function texture(base:string,seed:number){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle=base;ctx.fillRect(0,0,128,128);for(let i=0;i<2500;i++){seed=(seed*16807)%2147483647;ctx.fillStyle=i%2?'#ffffff0c':'#0000001a';ctx.fillRect(seed%128,(seed>>7)%128,1,2);}const t=new THREE.CanvasTexture(canvas);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
const mats=new Map<string,THREE.MeshStandardMaterial>();
function mat(color:number,tex=false){const key=color+':'+tex;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true,...(tex?{map:texture('#b8b8b8',color)}:{})}));return mats.get(key)!;}
function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number,tex=false){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color,tex));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function createSkyAndMoon(scene:THREE.Scene){
 const c=document.createElement('canvas');c.width=2;c.height=256;
 const ctx=c.getContext('2d')!;
 const grad=ctx.createLinearGradient(0,0,0,256);
 grad.addColorStop(0,'#060a12');grad.addColorStop(.35,'#0d1722');grad.addColorStop(.75,'#152329');grad.addColorStop(1,'#1c2a2e');
 ctx.fillStyle=grad;ctx.fillRect(0,0,2,256);
 const skyTex=new THREE.CanvasTexture(c);skyTex.wrapS=skyTex.wrapT=THREE.ClampToEdgeWrapping;
 const dome=new THREE.Mesh(new THREE.SphereGeometry(260,24,14,0,Math.PI*2,0,Math.PI*.5),new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,depthWrite:false}));
 dome.position.y=-15;scene.add(dome);
 const starCount=140,starPos=new Float32Array(starCount*3);let s=0;
 for(let i=0;i<starCount;i++){const th=Math.random()*Math.PI*2,phi=Math.random()*.52+.12,r=252;starPos[s++]=r*Math.sin(phi)*Math.cos(th);starPos[s++]=r*Math.cos(phi)-15;starPos[s++]=r*Math.sin(phi)*Math.sin(th);}
 const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
 scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xdfe8f7,size:1.1,transparent:true,opacity:.65,sizeAttenuation:false})));
 const moonDir=new THREE.Vector3(-40,70,-30).normalize(),moonGroup=new THREE.Group();
 moonGroup.position.copy(moonDir.multiplyScalar(225));moonGroup.lookAt(0,0,0);
 const halo=new THREE.Mesh(new THREE.CircleGeometry(26,32),new THREE.MeshBasicMaterial({color:0x345672,transparent:true,opacity:.35,blending:THREE.AdditiveBlending,depthWrite:false}));
 moonGroup.add(halo);
 const outerHalo=new THREE.Mesh(new THREE.CircleGeometry(52,32),new THREE.MeshBasicMaterial({color:0x162c3e,transparent:true,opacity:.2,blending:THREE.AdditiveBlending,depthWrite:false}));
 moonGroup.add(outerHalo);
 const disc=new THREE.Mesh(new THREE.CircleGeometry(8.5,32),new THREE.MeshBasicMaterial({color:0xf2f6ff,depthWrite:false}));
 disc.position.z=.08;moonGroup.add(disc);scene.add(moonGroup);
}
export class WorldView{
 shake=0;previousNestHp=500;landscapeUpdate:((t:number)=>void)|null=null;
 campRigs:{rig:ReturnType<typeof customCharacter>;actor:Actor;camp:THREE.Group}[]=[];
 weaponRacks=new Map<string,THREE.Group>();
 activeWeapon?:WeaponId;
 fpSerial=-1;fpAttack=0;fpDuration=.6;
 customProps=new Map<string,THREE.Group>();
 characterAssets=new CharacterAssets();animated=new Map<string,NonNullable<ReturnType<CharacterAssets['create']>>>();
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(68,1,.08,80);actors=new Map<string,THREE.Group>();flags=new Map<string,THREE.Mesh>();gates=new Map<string,THREE.Mesh>();barriers=new Map<string,THREE.Group>();keeps=new Map<string,THREE.Group>();campMeshes=new Map<string,THREE.Group>();cacheMeshes=new Map<string,THREE.Group>();nest=new THREE.Group();weapon=new THREE.Group();shield=new THREE.Group();solid:THREE.Object3D[]=[];torchlights:THREE.PointLight[]=[];flames:{group:THREE.Group;seed:number}[]=[];flagMeshes:{mesh:THREE.Mesh;seed:number}[]=[];upgrades=new Map<string,THREE.Group[]>();previousHp=new Map<string,number>();effects:{mesh:THREE.Sprite;life:number}[]=[];projectiles=new Map<number,THREE.Mesh>();debris:{mesh:THREE.Mesh;life:number;velocity:THREE.Vector3}[]=[];artillery=new Map<string,THREE.Object3D>();
 constructor(canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.65;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0x1a2629);this.scene.fog=new THREE.FogExp2(0x1c2a2e,0.015);this.scene.add(new THREE.HemisphereLight(0xd0e0f0,0x2a3820,3.2));const moon=new THREE.DirectionalLight(0xcadff5,3.5);moon.position.set(-40,70,-30);moon.castShadow=true;moon.shadow.mapSize.set(2048,2048);moon.shadow.camera.left=-52;moon.shadow.camera.right=52;moon.shadow.camera.top=52;moon.shadow.camera.bottom=-52;moon.shadow.normalBias=.04;this.scene.add(moon);this.scene.add(moon.target);moon.name="sun";createSkyAndMoon(this.scene);
  for(const region of REGIONS){const ground=box(this.scene,5,-.3,region.offset-80,175,.6,250,region.color,true);const m=(ground.material as THREE.MeshStandardMaterial).clone();m.map=m.map!.clone();m.map.repeat.set(38,55);ground.material=m;}
  const route=[START,...REGIONS.flatMap(r=>[{x:0,z:r.offset+12},{x:0,z:r.offset+24},{x:42,z:r.offset-45},{x:42,z:r.offset-55},{x:42,z:r.offset-43},{x:-24,z:r.offset-113},{x:-24,z:r.offset-123},{x:-24,z:r.offset-112},{x:0,z:r.offset-200}]),NEST];
  for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];const road=box(this.scene,(a.x+b.x)/2,.005,(a.z+b.z)/2,4,.04,dist(a,b),0x706c56,true);road.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}
  for(const c of CASTLES)this.castle(c);
  CAMPS.forEach(c=>{const group=new THREE.Group();group.position.set(c.x,0,c.z);this.scene.add(group);this.campMeshes.set(c.id,group);box(group,-2,1,1,2.7,2,2.8,0x5b5441,true);const roof=new THREE.Mesh(new THREE.ConeGeometry(2.8,1.5,4),mat(0x3e4443));roof.position.set(-2,2.6,1);roof.rotation.y=Math.PI/4;group.add(roof);this.fire(c.x+2,c.z+3,true);const label=this.label("SURVIVORS · "+c.name,"#ffe2a3");label.position.set(0,5,0);group.add(label);const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.22,.65,16,8),new THREE.MeshBasicMaterial({color:0xffce72,transparent:true,opacity:.18,depthWrite:false}));beacon.position.y=8;group.add(beacon);const ring=new THREE.Mesh(new THREE.RingGeometry(3.5,3.7,40),new THREE.MeshBasicMaterial({color:0xffce72,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.08;group.add(ring);});
  this.nest.position.set(NEST.x,0,NEST.z);this.scene.add(this.nest);for(let i=0;i<8;i++){const angle=i*Math.PI/4;const pillar=box(this.nest,Math.cos(angle)*3,1.2+Math.sin(i)*.5,Math.sin(angle)*3,.8,3,1,0x423b50);pillar.rotation.z=Math.sin(i)*.2;}const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(2),new THREE.MeshStandardMaterial({color:0x9a496f,emissive:0x76284d,emissiveIntensity:.9,flatShading:true}));crystal.position.y=2.3;this.nest.add(crystal);
  const glow=new THREE.PointLight(0xd15b92,22,16);glow.position.set(0,3,0);this.nest.add(glow);
  const ls=addLandscape(this.scene);this.landscapeUpdate=ls?.update??null;
  // Mountains stay outside the navigable map.
  for(let i=0;i<18;i++){const mountain=new THREE.Mesh(new THREE.ConeGeometry(22+i%3*8,28+i%5*6,5),mat(0x263941));mountain.position.set(-130+i*17,10,-720-i%3*5);this.scene.add(mountain);}
  this.scene.add(this.camera);box(this.weapon,0,0,0,.08,.95,.12,palette.iron);box(this.weapon,0,-.5,0,.45,.08,.15,palette.gold);box(this.weapon,0,-.67,0,.1,.3,.1,palette.wood);this.camera.add(this.weapon);box(this.shield,0,0,0,.55,.7,.1,0x576b73);box(this.shield,0,0,-.06,.06,.65,.03,palette.gold);this.camera.add(this.shield);this.weapon.visible=this.shield.visible=false;
  window.addEventListener('resize',()=>this.resize());this.resize();void this.environmentAssets();void this.customEnvironment();void this.survivorAssets();
 }
 async survivorAssets(){
  await this.characterAssets.customReady;const source=this.characterAssets.custom.get('survivor');if(!source)return;
  for(const camp of this.campMeshes.values())for(let i=0;i<3;i++){
   const actor={id:'survivor-'+i,kind:'soldier',hp:100,maxHp:100,attackSerial:0} as Actor;
   const rig=customCharacter(source,actor,new Map(),true);rig.model.position.set(.7+i*1.15,0,i%2?1.1:0);rig.model.rotation.y=Math.PI+(i-1)*.45;camp.add(rig.model);this.campRigs.push({rig,actor,camp});rig.update(actor,false,i*.3);
  }
 }
 async customEnvironment(){
  for(const name of ['sword','shield','stakes','supplies','plague','trebuchet','iron','medicine','cauldron','gatehouse','gate','beacon','firepit','mill','fallen_keep','border_fortress','high_citadel','cart','brazier','barrels','grave'])try{
   const asset=await loadAsset('custom/'+name);const model=asset.scene.clone(true);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
   const normalized=new THREE.Group();model.position.x-=center.x;model.position.z-=center.z;model.position.y-=bounds.min.y;normalized.add(model);normalized.userData.height=size.y;this.customProps.set(name,normalized);
   const fit=(height:number)=>{const o=normalized.clone(true);o.scale.setScalar(height/size.y);o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});return o;};
   if(name==='cauldron')for(const camp of this.campMeshes.values()){const kettle=fit(.9);kettle.position.set(1.8,0,2.8);camp.add(kettle);}
   if(name==='shield'){const parent=this.shield;parent.clear();const o=equipmentModel(asset.scene,.56,true);if(name==='shield'){o.rotation.y=Math.PI;}parent.add(o);parent.traverse(o=>{o.castShadow=false;});}
   if(name==='stakes')for(const barrier of this.barriers.values()){barrier.clear();const o=fit(1.7);const b=new THREE.Box3().setFromObject(o),w=b.getSize(new THREE.Vector3()).x;o.scale.x*=5/Math.max(.01,w);barrier.add(o);}
   if(name==='plague'){for(const child of this.nest.children)if(!(child instanceof THREE.Light))child.visible=false;this.nest.add(fit(4.5));}
   if(name==='trebuchet')for(const c of CASTLES){const old=this.artillery.get(c.id);if(old)this.scene.remove(old);const o=fit(3);o.position.set(c.x+6,0,c.z-6);this.scene.add(o);this.artillery.set(c.id,o);}
   if(name==='gatehouse')for(const c of CASTLES)for(const dx of [-3.8,3.8]){const o=fit(6.5);o.position.set(c.x+dx,0,c.z+10);o.rotation.y=dx>0?-Math.PI/2:Math.PI/2;this.scene.add(o);this.solid.push(o);}
   if(name==='gate')for(const c of CASTLES){const gateGroup=this.gates.get(c.id);if(gateGroup){gateGroup.clear();const o=fit(4.4);o.position.y=-2.2;gateGroup.add(o);}}
   if(name==='beacon')for(const c of CASTLES)for(const dx of [-3.6,3.6]){const o=fit(2.1);o.position.set(c.x+dx,0,c.z+11);this.scene.add(o);}
   if(name==='firepit')for(const c of CAMPS){const o=fit(.9);o.position.set(c.x+2,0,c.z+3);this.scene.add(o);}
    if(name==='cart'){let sv=777;const rv=()=>{sv=(sv*16807)%2147483647;return sv/2147483647;};for(let i=0;i<14;i++){const o=fit(.9+rv()*.4);o.position.set(rv()*145-62,0,35-rv()*695);o.rotation.y=rv()*Math.PI*2;o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});this.scene.add(o);}}
    if(name==='brazier'){for(const c of CASTLES){const o=fit(1.5);o.position.set(c.x-8,0,c.z-8);this.scene.add(o);this.fire(c.x-8,c.z-8);}for(const camp of CAMPS){const o=fit(1.2);o.position.set(camp.x-3,0,camp.z+4);this.scene.add(o);this.fire(camp.x-3,camp.z+4,true);}}
    if(name==='barrels'){for(const c of CASTLES)for(const [bx,bz] of [[7,-8],[-8,7],[5,9]] as const){const o=fit(.85);o.position.set(c.x+bx,0,c.z+bz);this.scene.add(o);}for(const camp of CAMPS){const o=fit(.7);o.position.set(camp.x+3,0,camp.z+2);this.scene.add(o);}}
    if(name==='grave'){let sv2=1337;const rv2=()=>{sv2=(sv2*16807)%2147483647;return sv2/2147483647;};for(let i=0;i<20;i++){const o=fit(.7+rv2()*.4);o.position.set(rv2()*148-64,0,35-rv2()*698);o.rotation.y=rv2()*Math.PI*2;o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});this.scene.add(o);}}
  }catch(e){console.warn('Custom prop unavailable',name,e);}
   for(const c of CASTLES){
    const group=this.keeps.get(c.id);if(!group)continue;
    const kName=c.id.includes('citadel')?'high_citadel':c.id.includes('border')?'border_fortress':'fallen_keep';
    const source=this.customProps.get(kName);
    if(source){
     group.clear();
     const h=c.id.includes('citadel')?8.2:c.id.includes('border')?7.2:6.4;
     const o=source.clone(true);o.scale.setScalar(h/source.userData.height);
     o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});
     group.add(o);
    }
   }
 }
 async environmentAssets(){
  for(const name of ['tower-square-top-roof-high','siege-catapult','rocks-large']){try{const asset=await loadAsset(name);const bounds=new THREE.Box3().setFromObject(asset.scene),size=bounds.getSize(new THREE.Vector3());const place=(x:number,z:number,height:number,y=0)=>{const o=asset.scene.clone(true);const scale=height/size.y;o.scale.multiplyScalar(scale);o.position.set(x,y-bounds.min.y*scale,z);o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});this.scene.add(o);return o;};
   if(name==='tower-square-top-roof-high')for(const c of CASTLES)for(const dx of [-10,10])for(const dz of [-10,10])place(c.x+dx,c.z+dz,3,6);
   if(name==='siege-catapult'&&!this.customProps.has('trebuchet'))for(const c of CASTLES)this.artillery.set(c.id,place(c.x+6,c.z-6,2));
   if(name==='rocks-large')for(let i=0;i<54;i++)place((i%2?1:-1)*(25+i%5*7),24-i*12,1+i%3*.4);
  }catch(error){console.warn('Environment asset unavailable',name,error);}}
 }
 label(text:string,color='#fff3cb'){const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d')!;ctx.fillStyle='#132226dd';ctx.fillRect(0,0,512,96);ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,256,58);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthTest:false}));sprite.scale.set(7,1.3,1);return sprite;}
 resize(){this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();}
 fire(x:number,z:number,isCamp=false){
  const flameGroup=new THREE.Group();flameGroup.position.set(x,isCamp?.3:1.2,z);
  const core=new THREE.Mesh(new THREE.ConeGeometry(.22,.85,5),new THREE.MeshBasicMaterial({color:0xfff0aa}));core.position.y=.42;flameGroup.add(core);
  const outer=new THREE.Mesh(new THREE.ConeGeometry(.35,1.1,6),new THREE.MeshBasicMaterial({color:0xff7528,transparent:true,opacity:.85}));outer.position.y=.55;flameGroup.add(outer);
  const ember=new THREE.Mesh(new THREE.ConeGeometry(.45,1.35,6),new THREE.MeshBasicMaterial({color:0xe63914,transparent:true,opacity:.5}));ember.position.y=.65;flameGroup.add(ember);
  this.scene.add(flameGroup);
  const light=new THREE.PointLight(0xff9d42,isCamp?8:12,isCamp?10:14,1.8);light.position.set(x,isCamp?1.2:2.2,z);
  this.scene.add(light);this.torchlights.push(light);this.flames.push({group:flameGroup,seed:Math.random()*20});
 }
 castle(c:{id:string;x:number;z:number}){
  box(this.scene,c.x,.035,c.z,20,.08,20,0x384145,true);
  for(const w of walls(c)){const wall=box(this.scene,w.x,2,w.z,w.w,4,w.d,palette.dark,true);this.solid.push(wall);const count=Math.floor(Math.max(w.w,w.d)/1.5);for(let n=0;n<count;n++)box(this.scene,w.x+(w.w>w.d?(n-(count-1)/2)*1.5:0),4.5,w.z+(w.d>w.w?(n-(count-1)/2)*1.5:0),w.w>w.d?.7:1.5,1,w.d>w.w?.7:1.5,palette.dark,true);}
  for(const dx of [-10,10])for(const dz of [-10,10]){this.solid.push(box(this.scene,c.x+dx,3,c.z+dz,3.5,6,3.5,palette.dark,true));for(const sx of [-1,1])for(const sz of [-1,1])box(this.scene,c.x+dx+sx*1.2,6.5,c.z+dz+sz*1.2,.8,1,.8,palette.stone);}
  const stages:THREE.Group[]=[];for(let tier=0;tier<2;tier++){const detail=new THREE.Group();detail.position.set(c.x,0,c.z);detail.visible=false;this.scene.add(detail);stages.push(detail);for(const side of [-1,1]){box(detail,side*7,1.5,-5+tier*5,2,3,2,tier?0x466e75:palette.wood,true);box(detail,side*7,3.2,-5+tier*5,2.5,.4,2.5,palette.gold);box(detail,side*9,4.1,0, .15,1.8,4,tier?palette.gold:0x468f87);}const crest=this.label(tier?'CITADEL':'BASTION');crest.position.set(0,6+tier*1.4,-1);detail.add(crest);}this.upgrades.set(c.id,stages);
  // Banner is the functional keep/capture point; rear architecture stays behind it.
  box(this.scene,c.x,.2,c.z,3,.4,3,0x858a7b,true);box(this.scene,c.x,2.6,c.z,.16,5.2,.16,palette.wood);const flagGeo=new THREE.PlaneGeometry(1.8,1.4,8,4);flagGeo.translate(.9,0,0);const flag=new THREE.Mesh(flagGeo,new THREE.MeshStandardMaterial({color:0x9a4d47,side:THREE.DoubleSide,roughness:.8}));flag.position.set(c.x,4.3,c.z);flag.castShadow=true;this.scene.add(flag);this.flags.set(c.id,flag);this.flagMeshes.push({mesh:flag,seed:this.flagMeshes.length*1.7});
  const keep=new THREE.Group();keep.position.set(c.x-5,0,c.z-6);box(keep,0,2.2,0,4,4.4,4,palette.dark,true);box(keep,0,4.7,0,4.6,.6,4.6,palette.stone);this.scene.add(keep);this.keeps.set(c.id,keep);
  this.fire(c.x-3.6,c.z+11);this.fire(c.x+3.6,c.z+11);
  const gateParent=new THREE.Group();gateParent.position.set(c.x,2,c.z+10);box(gateParent,0,0,0,5.5,4,.35,palette.wood,true);this.scene.add(gateParent);this.gates.set(c.id,gateParent as unknown as THREE.Mesh);gateParent.visible=false;
  const barrier=new THREE.Group();barrier.position.set(c.x,0,c.z+13);for(let i=-2;i<=2;i++){const b=box(barrier,i,.7,0,.25,1.7,.3,palette.wood);b.rotation.x=-.35;}box(barrier,0,.8,0,5,.2,.2,palette.wood);this.scene.add(barrier);this.barriers.set(c.id,barrier);barrier.visible=false;
 }
 knight(a:Actor){const root=new THREE.Group();const evil=a.kind==='zombie'||a.kind==='corrupted';const color=a.kind==='zombie'?0x849077:a.kind==='corrupted'?0x403e51:a.kind==='soldier'?0x7f8a78:0x98a9b4;
  const tell=new THREE.Mesh(new THREE.RingGeometry(.65,.78,24),new THREE.MeshBasicMaterial({color:0xff7553,side:THREE.DoubleSide,transparent:true,opacity:.8}));tell.rotation.x=-Math.PI/2;tell.position.y=.06;tell.name='tell';root.add(tell);
  const marker=new THREE.Mesh(new THREE.OctahedronGeometry(.13),new THREE.MeshBasicMaterial({color:evil?0xe05750:0x83d4a5}));marker.position.y=2.45;marker.name='marker';root.add(marker);
  const hp=box(root,0,2.1,0,.9,.065,.06,evil?0xd78067:0xb8c18b);hp.name='hp';root.position.set(a.x,0,a.z);this.scene.add(root);this.actors.set(a.id,root);return root;
 }
 draw(g:Game|undefined,me:Actor|undefined,yaw:number,pitch:number,first:boolean,dt:number,time:number){
  for(const {rig,actor,camp} of this.campRigs)if(camp.visible)rig.update(actor,false,dt);
  for(let i=0;i<this.torchlights.length;i++){const l=this.torchlights[i];l.intensity=9.5+Math.sin(time*10+i*2.7)*2.2+Math.sin(time*24+i*4.9)*1.1;l.visible=!me||dist({x:l.position.x,z:l.position.z},me)<35;}
   for(let i=0;i<this.flames.length;i++){const f=this.flames[i],wobble=Math.sin(time*11+f.seed)*.14+Math.sin(time*27+f.seed*2)*.07;f.group.scale.set(1+wobble*.5,1+wobble,1+wobble*.5);f.group.rotation.y=time*2.2+f.seed;}
   for(const f of this.flagMeshes){const pos=f.mesh.geometry.attributes.position;for(let i=0;i<pos.count;i++){const px=pos.getX(i);pos.setZ(i,Math.sin(time*5.5+px*3+f.seed)*(px/1.8)*.22);}pos.needsUpdate=true;}
  if(!g){const t=time*.025;this.camera.position.set(31+Math.sin(t)*4,15,32);this.camera.lookAt(0,2,0);if(this.shake>0){
   this.camera.position.x+=(Math.random()-.5)*this.shake;
   this.camera.position.y+=(Math.random()-.5)*this.shake;
   this.camera.position.z+=(Math.random()-.5)*this.shake;
   this.shake=Math.max(0,this.shake-dt*2.5);
  }
  this.renderer.render(this.scene,this.camera);return;}
  const alive=new Set(g.actors.map(a=>a.id));for(const [id,mesh] of this.actors)if(!alive.has(id)){this.animated.get(id)?.dispose();this.animated.delete(id);this.previousHp.delete(id);this.scene.remove(mesh);mesh.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.sharedAsset)o.geometry.dispose();});this.actors.delete(id);}
  for(const a of g.actors){if(me&&dist(a,me)>55){const far=this.actors.get(a.id);if(far)far.visible=false;this.previousHp.set(a.id,a.hp);continue;}const mesh=this.actors.get(a.id)||this.knight(a);let rig=this.animated.get(a.id);if(rig&&(mesh.userData.weapon!==(a.weapon??'sword')||mesh.userData.appearance!==characterAsset(a))){mesh.remove(rig.model);rig.dispose();this.animated.delete(a.id);rig=undefined;}if(!rig){rig=this.characterAssets.create(a);if(rig){for(const child of mesh.children)if(!['hp','tell','marker'].includes(child.name))child.visible=false;rig.model.traverse(o=>o.userData.sharedAsset=true);mesh.add(rig.model);this.animated.set(a.id,rig);mesh.userData.weapon=a.weapon??'sword';mesh.userData.appearance=characterAsset(a);}}const old=mesh.position.clone();if(dist({x:old.x,z:old.z},a)>10)mesh.position.set(a.x,0,a.z);else mesh.position.lerp(new THREE.Vector3(a.x,0,a.z),1-Math.exp(-dt*16));mesh.rotation.y=-a.yaw;mesh.visible=!(a.id===me?.id&&first)&&(!me||dist(a,me)<46);mesh.rotation.z=a.hp<=0&&!rig?Math.PI/2:0;
   mesh.getObjectByName('tell')!.visible=a.windup>0&&a.hp>0;mesh.getObjectByName('tell')!.scale.setScalar(1+a.windup);const moving=Math.abs(old.x-a.x)+Math.abs(old.z-a.z)>.03;
   rig?.update(a,moving,dt);if(rig)for(const fragment of rig.fragments.splice(0)){this.scene.add(fragment);this.debris.push({mesh:fragment,life:4,velocity:new THREE.Vector3(a.id.length%2?2:-2,3,1.2)});}mesh.position.y=0;const previous=this.previousHp.get(a.id);if(previous!==undefined&&a.hp<previous){const damage=this.label(String(Math.ceil(previous-a.hp)),a.kind==='player'?'#ff8d78':'#ffe1a0');damage.scale.set(1.5,.6,1);damage.position.set(a.x,2.6,a.z);this.scene.add(damage);this.effects.push({mesh:damage,life:.8});
    for(let k=0;k<6;k++){
      const spark=new THREE.Mesh(new THREE.BoxGeometry(.04,.04,.04),new THREE.MeshBasicMaterial({color:0xffd060}));
      spark.position.set(a.x+(Math.random()-.5)*.4,1.4+(Math.random()-.5)*.4,a.z+(Math.random()-.5)*.4);
      this.scene.add(spark);
      this.debris.push({mesh:spark,life:.35,velocity:new THREE.Vector3((Math.random()-.5)*4,2+Math.random()*3,(Math.random()-.5)*4)});
    }if(previous>0&&a.hp<=0){
     const evil=a.kind==='zombie'||a.kind==='corrupted';
     const isBoss=a.name?.includes('Champion')||a.name?.includes('Fallen')||a.id==='boss-plague'||a.maxHp>=200;
     const count=isBoss?24:(evil?14:8);
     for(let k=0;k<count;k++){
      const col=evil?(isBoss?(k%2?0x9e1239:0x4a0a1f):(k%2?0x2e3d30:0x7a2240)):0xf0c850;
      const p=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,.06),new THREE.MeshBasicMaterial({color:col}));
      p.position.set(a.x+(Math.random()-.5)*.5,1.2+(Math.random()-.5)*.6,a.z+(Math.random()-.5)*.5);
      this.scene.add(p);
      const spd=isBoss?4:2.4;
      this.debris.push({mesh:p,life:isBoss?.9:.6,velocity:new THREE.Vector3((Math.random()-.5)*spd,2+Math.random()*spd,(Math.random()-.5)*spd)});
     }
     if(isBoss){
      const ring=new THREE.Mesh(new THREE.RingGeometry(.8,1.6,32),new THREE.MeshBasicMaterial({color:0xdf2055,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2;ring.position.set(a.x,.25,a.z);this.scene.add(ring);
      this.debris.push({mesh:ring,life:.75,velocity:new THREE.Vector3(0,.5,0)});
      if(me&&dist(me,a)<40)this.shake=Math.min(1,this.shake+.45);
     }
    }mesh.userData.flashUntil=time+.08;mesh.userData.recoilUntil=time+.16;if(a.id===me?.id)this.shake=Math.min(.35,this.shake+.2);}if(rig)rig.model.position.z=Math.max(0,(mesh.userData.recoilUntil??0)-time)*1.1;const flashing=(mesh.userData.flashUntil??0)>time;if(rig)rig.model.traverse(o=>{if(o instanceof THREE.Mesh)for(const material of Array.isArray(o.material)?o.material:[o.material]){const m=material as THREE.MeshStandardMaterial;if(m.emissive)m.emissive.setHex(flashing?0xffffff:0x000000);}});mesh.getObjectByName('marker')!.visible=a.hp>0||!!a.downed;this.previousHp.set(a.id,a.hp);const bar=mesh.getObjectByName('hp')!;bar.scale.x=Math.max(.001,a.hp/a.maxHp);bar.visible=a.hp<a.maxHp&&a.hp>0;mesh.scale.setScalar(a.kind==='corrupted'?(a.maxHp>=200?1.4:1.15):1);
  }
  for(const effect of this.effects){effect.life-=dt;effect.mesh.position.y+=dt*1.5;effect.mesh.material.opacity=Math.max(0,effect.life/.8);if(effect.life<=0){this.scene.remove(effect.mesh);effect.mesh.material.map?.dispose();effect.mesh.material.dispose();}}this.effects=this.effects.filter(e=>e.life>0);
  for(const item of this.debris){item.life-=dt;item.velocity.y-=9*dt;item.mesh.position.addScaledVector(item.velocity,dt);item.mesh.rotation.x+=dt*3;if(item.mesh.position.y<.12){item.mesh.position.y=.12;item.velocity.set(0,0,0);}if(item.life<=0){this.scene.remove(item.mesh);item.mesh.geometry.dispose();for(const m of Array.isArray(item.mesh.material)?item.mesh.material:[item.mesh.material])m.dispose();}}this.debris=this.debris.filter(d=>d.life>0);while(this.debris.length>48){const d=this.debris.shift()!;this.scene.remove(d.mesh);d.mesh.geometry.dispose();for(const m of Array.isArray(d.mesh.material)?d.mesh.material:[d.mesh.material])m.dispose();}
  const shots=new Set(g.shots.map(s=>s.id));for(const [id,m] of this.projectiles)if(!shots.has(id)){this.scene.remove(m);m.geometry.dispose();this.projectiles.delete(id);}for(const shot of g.shots){let m=this.projectiles.get(shot.id);if(!m){m=new THREE.Mesh(new THREE.SphereGeometry(.23,8,6),mat(0xe6bb79));this.scene.add(m);this.projectiles.set(shot.id,m);}const t=Math.max(0,Math.min(1,1-(shot.lands-g.time)/.7));m.position.set(shot.x+(shot.tx-shot.x)*t,2+Math.sin(t*Math.PI)*6,shot.z+(shot.tz-shot.z)*t);const gun=this.artillery.get(shot.castle);if(gun)gun.rotation.y=Math.atan2(shot.tx-shot.x,shot.tz-shot.z);}
  for(const c of g.castles){this.upgrades.get(c.id)!.forEach((group,i)=>group.visible=c.friendly&&c.level>i);(this.flags.get(c.id)!.material as THREE.MeshStandardMaterial).color.setHex(c.friendly?0x4ea88c:0x9a4d47);const gate=this.gates.get(c.id)!;gate.visible=c.friendly&&c.gate>0;const nearFriendly=g.actors.some(a=>(a.kind==='player'||a.kind==='soldier')&&a.hp>0&&dist(a,{x:c.x,z:c.z+10})<4);gate.scale.y=nearFriendly?.15:1;gate.position.y=nearFriendly?3.9:2;this.barriers.get(c.id)!.visible=c.barrier>0;}
  for(const c of g.camps){const mesh=this.campMeshes.get(c.id)!;mesh.visible=!c.rescued&&(!me||dist(c,me)<45);}
  for(const drop of g.weaponDrops){let rack=this.weaponRacks.get(drop.id);if(!rack){rack=new THREE.Group();rack.position.set(drop.x,0,drop.z);for(const x of [-.6,.6])box(rack,x,.7,0,.12,1.4,.12,palette.wood);box(rack,0,1,0,1.5,.1,.12,palette.wood);const sign=this.label(WEAPONS[drop.weapon].name.toUpperCase(),'#b8e1f0');sign.position.set(0,2.4,0);sign.name='sign';rack.add(sign);const ring=new THREE.Mesh(new THREE.RingGeometry(.8,.9,24),new THREE.MeshBasicMaterial({color:0x8ed2e5,side:THREE.DoubleSide,transparent:true,opacity:.7}));ring.rotation.x=-Math.PI/2;ring.position.y=.05;rack.add(ring);this.weaponRacks.set(drop.id,rack);this.scene.add(rack);}const source=this.characterAssets.custom.get(drop.weapon);if(source&&!rack.userData.loaded){const item=equipmentModel(source.scene,WEAPONS[drop.weapon].length,false,drop.weapon);item.position.y=.65;rack.add(item);rack.userData.loaded=true;}rack.visible=!drop.taken&&(!me||dist(drop,me)<35);}
  for(const c of g.caches){let mesh=this.cacheMeshes.get(c.id);if(!mesh){mesh=new THREE.Group();mesh.position.set(c.x,0,c.z);box(mesh,0,.4,0,.8,.8,.7,0xb59151,true);box(mesh,0,.42,0,.85,.1,.75,0xd7b16e);this.cacheMeshes.set(c.id,mesh);this.scene.add(mesh);}if(this.customProps.has('supplies')&&!mesh.userData.custom){mesh.clear();const source=this.customProps.get('supplies')!;const o=source.clone(true);o.scale.setScalar(1/source.userData.height);mesh.add(o);mesh.userData.custom=true;}for(const [name,x] of [['iron',-.8],['medicine',.8]] as const){const source=this.customProps.get(name);if(source&&!mesh.getObjectByName('resource-'+name)){const o=source.clone(true);const b=new THREE.Box3().setFromObject(o),size=b.getSize(new THREE.Vector3());o.scale.setScalar(.45/Math.max(size.x,size.y,size.z));o.position.x=x;o.name='resource-'+name;mesh.add(o);}}mesh.visible=!c.taken&&(!me||dist(c,me)<46);}
  this.nest.visible=g.nest.hp>0;
   if(this.nest.children[8])this.nest.children[8].rotation.y=time*.5;
   if(g.nest.hp<this.previousNestHp){
    const loss=this.previousNestHp-g.nest.hp;
    this.previousNestHp=g.nest.hp;
    const damage=this.label(String(Math.ceil(loss)),'#ff4d88');
    damage.scale.set(2.2,.85,1);damage.position.set(NEST.x,4.2,NEST.z);
    this.scene.add(damage);this.effects.push({mesh:damage,life:1.2});
    if(me&&dist(me,NEST)<35)this.shake=Math.min(.8,this.shake+.35);
    const ring=new THREE.Mesh(new THREE.RingGeometry(1,1.5,32),new THREE.MeshBasicMaterial({color:0xd15b92,side:THREE.DoubleSide,transparent:true,opacity:.85}));
    ring.rotation.x=-Math.PI/2;ring.position.set(NEST.x,.3,NEST.z);
    this.scene.add(ring);this.debris.push({mesh:ring,life:.6,velocity:new THREE.Vector3(0,.4,0)});
   }
  if(me){const sun=this.scene.getObjectByName('sun') as THREE.DirectionalLight;sun.position.set(me.x-25,60,me.z-20);sun.target.position.set(me.x,0,me.z);const model=this.actors.get(me.id);const pos=model?.position??new THREE.Vector3(me.x,0,me.z);const target=new THREE.Vector3(pos.x,1.55,pos.z);const forward=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
   if(first){this.camera.position.copy(target);this.camera.rotation.set(pitch,-yaw,0,'YXZ');}
   else{const desired=target.clone().addScaledVector(forward,-6);desired.y+=2;const delta=desired.clone().sub(target);const ray=new THREE.Raycaster(target,delta.clone().normalize(),0,delta.length());const hits=ray.intersectObjects(this.solid,false);if(hits.length)desired.copy(target).addScaledVector(delta.normalize(),Math.max(.45,hits[0].distance-.3));this.camera.position.copy(desired);this.camera.lookAt(target.clone().addScaledVector(forward,4));}
   const selected=me.weapon??'sword',stats=weaponStats(selected),source=this.characterAssets.custom.get(selected);if(source&&this.activeWeapon!==selected){this.weapon.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(this.activeWeapon)m.dispose();});this.weapon.clear();this.weapon.add(equipmentModel(source.scene,stats.length*.78,false,selected));this.weapon.traverse(o=>{o.castShadow=false;});this.activeWeapon=selected;}
   this.weapon.visible=first&&me.hp>0;this.shield.visible=first&&me.hp>0&&stats.shield;this.weapon.position.set(.32,-.4,-.78);this.weapon.rotation.set(me.block&&!stats.shield?-.5:.1,0,me.block&&!stats.shield?-1.1:-.2);if(this.fpSerial!==(me.attackSerial??0)){if(this.fpSerial>=0){this.fpDuration=stats.cooldown*.85;this.fpAttack=this.fpDuration;}this.fpSerial=me.attackSerial??0;}this.fpAttack=Math.max(0,this.fpAttack-dt);if(this.fpAttack>0){const t=1-this.fpAttack/this.fpDuration,arc=Math.sin(Math.PI*t),strike=Math.sin(Math.PI*Math.min(1,t*1.6));this.weapon.rotation.z-=arc*(selected==='hammer'?1.1:1.65);this.weapon.rotation.x-=strike*(selected==='hammer'?1.3:.55);this.weapon.position.x-=arc*.3;this.weapon.position.z-=strike*.14;}const shieldTarget=new THREE.Vector3(me.block?-.12:-.38,me.block?-.12:-.38,-.82);this.shield.position.lerp(shieldTarget,1-Math.exp(-dt*16));
  }
  if(this.landscapeUpdate)this.landscapeUpdate(time);
  this.renderer.render(this.scene,this.camera);
 }
}
