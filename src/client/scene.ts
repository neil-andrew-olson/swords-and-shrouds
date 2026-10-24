import {characterAsset} from '../shared/characters';
import * as THREE from 'three';
import {customCharacter} from './custom-character';
import {equipmentModel,weaponCombatProfile,blockSparkColor,hitFeedbackProfile,hitFlashColor} from './equipment';
import {undeadEliteTier,setCharacterWindQuality,setHitFeedbackReducedMotion} from './custom-character';
import {weaponStats,WEAPONS,type WeaponId} from '../shared/weapons';
import {addLandscape} from './landscape';
import {CharacterAssets,loadAsset} from './assets';
import {CASTLES,CAMPS,REGIONS,NEST,START,walls,dist} from '../shared/world';
import type {Game,Actor} from '../shared/types';
import {createPostFX,type PostFX} from './postfx';
import {CombatEffects} from './effects';
import {addRuins} from './ruins';
import {applySurfaceTextures} from './terrain-surfaces';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const palette={stone:0x56646a,dark:0x303f47,wood:0x70533e,iron:0xa0a9ad,gold:0xd1a05b,undead:0x768274};
/** Constant point-light count: shader programs never recompile as we roam the map.
 *  13 pooled torch lights + 1 camera-following fill light = 14 active point lights max. */
const MAX_TORCH_LIGHTS=13;
type TorchSource={x:number;y:number;z:number;color:number;intensity:number;distance:number;seed:number};
type TowerSlot={decor:THREE.Group;x:number;z:number;castleId:string};
function smoothstep(edge0:number,edge1:number,value:number){const t=Math.min(1,Math.max(0,(value-edge0)/(edge1-edge0)));return t*t*(3-2*t);}
function texture(base:string,seed:number){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle=base;ctx.fillRect(0,0,128,128);for(let i=0;i<2500;i++){seed=(seed*16807)%2147483647;ctx.fillStyle=i%2?'#ffffff0c':'#0000001a';ctx.fillRect(seed%128,(seed>>7)%128,1,2);}const t=new THREE.CanvasTexture(canvas);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}
const mats=new Map<string,THREE.MeshStandardMaterial>();
function mat(color:number,tex=false){const key=color+':'+tex;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true,...(tex?{map:texture('#b8b8b8',color)}:{})}));return mats.get(key)!;}
const boxGeometries=new Map<string,THREE.BoxGeometry>();
function boxGeometry(w:number,h:number,d:number){const key=w+':'+h+':'+d;let geo=boxGeometries.get(key);if(!geo){geo=new THREE.BoxGeometry(w,h,d);boxGeometries.set(key,geo);}return geo;}
function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number,tex=false){const mesh=new THREE.Mesh(boxGeometry(w,h,d),mat(color,tex));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function safeAttribute(attr:THREE.BufferAttribute|THREE.InterleavedBufferAttribute):THREE.BufferAttribute{
 const maybe=attr as unknown as {isInterleavedBufferAttribute?:boolean;toNonInterleaved?:()=>THREE.BufferAttribute};
 if(maybe.isInterleavedBufferAttribute&&typeof maybe.toNonInterleaved==='function')return maybe.toNonInterleaved();
 return attr as THREE.BufferAttribute;
}
function toFloat32(attr:THREE.BufferAttribute|THREE.InterleavedBufferAttribute):THREE.BufferAttribute{
 const base=safeAttribute(attr);const src=base.array as ArrayLike<number>;const dst=new Float32Array(src.length);
 if(base.normalized){let max=1;if(src instanceof Uint16Array)max=65535;else if(src instanceof Uint8Array)max=255;else if(src instanceof Int16Array)max=32767;else if(src instanceof Int8Array)max=127;for(let i=0;i<src.length;i++)dst[i]=src[i]/max;}
 else for(let i=0;i<src.length;i++)dst[i]=src[i];
 return new THREE.BufferAttribute(dst,base.itemSize,false);
}
/** Normalise a geometry so mixed GLB primitives can be merged without BufferGeometryUtils errors. */
function sanitizeGeometry(source:THREE.BufferGeometry):THREE.BufferGeometry|null{
 const position=source.getAttribute('position');if(!position)return null;
 const out=new THREE.BufferGeometry();
 out.setAttribute('position',toFloat32(position));
 const normal=source.getAttribute('normal');if(normal)out.setAttribute('normal',toFloat32(normal));
 const uv=source.getAttribute('uv');if(uv)out.setAttribute('uv',toFloat32(uv));
 const index=source.getIndex();if(index){const src=index.array as ArrayLike<number>;const dst=new Uint32Array(src.length);for(let i=0;i<src.length;i++)dst[i]=src[i];out.setIndex(new THREE.BufferAttribute(dst,1));}
 return out;
}
/** Merge key: guarantees only attribute-compatible geometries share a merged mesh. */
function geometrySignature(geo:THREE.BufferGeometry):string{
 const parts:string[]=[];
 for(const name of ['position','normal','uv']){const attr=geo.getAttribute(name) as THREE.BufferAttribute|undefined;parts.push(attr?name+attr.itemSize+':'+attr.array.constructor.name:'-');}
 parts.push(geo.getIndex()?'idx':'noidx');
 return parts.join('|');
}
function tagSurface(mesh:THREE.Mesh,surface:'ground'|'road'|'cobble'){mesh.userData.surface=surface;return mesh;}
type SwingStyle='thrust'|'cleave'|'crush'|'sweep';
/** Weapon id -> first-person motion style (new ids degrade to a sensible default). */
const SWING_STYLES:Record<string,SwingStyle>={sword:'thrust',rapier:'thrust',flamberge:'cleave',dane_axe:'cleave',zweihander:'cleave',mace:'crush',hammer:'crush',bastard:'crush',poleaxe:'sweep',halberd:'sweep'};
const swingStyle=(id:string):SwingStyle=>SWING_STYLES[id]??'thrust';
/** Additive HDR colour per style so third-person trails read in the dark. */
const TRAIL_COLORS:Record<SwingStyle,[number,number,number]>={
 thrust:[1.1,1.5,1.8],
 cleave:[1.8,1.0,0.38],
 crush:[1.35,1.35,1.55],
 sweep:[0.75,1.55,1.15]
};
/** Characters catch the night IBL more strongly so distant actors don't go pure black. */
const ACTOR_ENV_INTENSITY=2.2;
// Cycle-4 regional weather phases: 3–6 min dwell, smooth intensity transitions. Low quality uses
// a tiny fraction of the particle budget; high intensity is the QA "storm" capture state.
type WeatherRegion='march'|'moor'|'crown';
const WEATHER_PHASES:{[K in WeatherRegion]:{name:string;target:number}[]}={
 march:[{name:'clear',target:0.12},{name:'light-rain',target:0.62},{name:'downpour',target:1.0}],
 moor:[{name:'calm',target:0.2},{name:'ashfall',target:0.62},{name:'haze',target:1.0}],
 crown:[{name:'clear',target:0.18},{name:'snow',target:0.62},{name:'snowstorm',target:1.0}]
};
type QualityTier='low'|'medium'|'high';
/** Graphics tiers (batch 3): pixel ratio, bloom, shadow map, pooled torch lights, particle scale. */
const QUALITY_TIERS:Record<QualityTier,{dpr:number;bloom:boolean;shadow:number;lights:number;particles:number}> = {
 low:{dpr:1.0,bloom:false,shadow:0,lights:6,particles:0.5},
 medium:{dpr:1.25,bloom:true,shadow:1024,lights:9,particles:0.75},
 high:{dpr:1.75,bloom:true,shadow:2048,lights:10,particles:1}
};
function boostActorMaterials(root:THREE.Object3D){root.traverse(o=>{if(o instanceof THREE.Mesh)for(const material of Array.isArray(o.material)?o.material:[o.material]){const standard=material as THREE.MeshStandardMaterial;if(standard.isMeshStandardMaterial)standard.envMapIntensity=ACTOR_ENV_INTENSITY;}});}
function createSkyAndMoon(scene:THREE.Scene){ const c=document.createElement('canvas');c.width=2;c.height=256;
 const ctx=c.getContext('2d')!;
 const grad=ctx.createLinearGradient(0,0,0,256);
 grad.addColorStop(0,'#060a12');grad.addColorStop(.35,'#0d1722');grad.addColorStop(.75,'#152329');grad.addColorStop(1,'#1c2a2e');
 ctx.fillStyle=grad;ctx.fillRect(0,0,2,256);
 const skyTex=new THREE.CanvasTexture(c);skyTex.colorSpace=THREE.SRGBColorSpace;skyTex.wrapS=skyTex.wrapT=THREE.ClampToEdgeWrapping;
 // A camera-following celestial group (dome/stars/moon): visible now that far=320, and
 // fog:false so the world haze does not swallow the night sky.
 const sky=new THREE.Group();
 const dome=new THREE.Mesh(new THREE.SphereGeometry(260,24,14,0,Math.PI*2,0,Math.PI*.5),new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,depthWrite:false,fog:false}));
 dome.position.y=-15;sky.add(dome);
 const starCount=340,starPos=new Float32Array(starCount*3);let s=0;
 // phi is measured from the pole: extend down to ~66 deg so a rich star field sits low
 // enough to be visible in the default third-person framing.
 for(let i=0;i<starCount;i++){const th=Math.random()*Math.PI*2,phi=0.28+Math.random()*1.0,r=252;starPos[s++]=r*Math.sin(phi)*Math.cos(th);starPos[s++]=r*Math.cos(phi)-15;starPos[s++]=r*Math.sin(phi)*Math.sin(th);}
 const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(starPos,3));
 const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xdfe8f7,size:1.6,transparent:true,opacity:.9,sizeAttenuation:false,fog:false}));sky.add(stars);
 // Low moon (≈26 deg elevation) so the disc + halo are inside the default camera frame.
 const moonDir=new THREE.Vector3(-12,16,-42).normalize(),moonGroup=new THREE.Group();
 moonGroup.position.copy(moonDir.multiplyScalar(225));moonGroup.lookAt(0,0,0);
 const hc=document.createElement('canvas');hc.width=hc.height=128;const hctx=hc.getContext('2d')!;const hgrad=hctx.createRadialGradient(64,64,0,64,64,64);hgrad.addColorStop(0,'rgba(190,215,240,0.30)');hgrad.addColorStop(.32,'rgba(130,165,205,0.10)');hgrad.addColorStop(1,'rgba(90,120,160,0)');hctx.fillStyle=hgrad;hctx.fillRect(0,0,128,128);const haloTex=new THREE.CanvasTexture(hc);haloTex.colorSpace=THREE.SRGBColorSpace;
 const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));halo.scale.set(78,78,1);halo.position.z=-.02;moonGroup.add(halo);
 const disc=new THREE.Mesh(new THREE.CircleGeometry(8.5,32),new THREE.MeshBasicMaterial({color:0xf2f6ff,depthWrite:false,fog:false}));
 disc.position.z=.08;moonGroup.add(disc);sky.add(moonGroup);
 sky.userData.parts={dome,halo,outerHalo:halo,stars,moonDisc:disc};
 scene.add(sky);
 return sky;
}
/**
 * Night-sky IBL: a dark gradient dome (plus a faint moon glint) baked once with PMREM.
 * Deliberately much darker than RoomEnvironment — it gives metal armour something to
 * reflect without washing out the moonlit ground/fog, which a bright studio env does.
 */
function createNightEnvironment(renderer:THREE.WebGLRenderer):THREE.Texture|undefined{
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=256;
 const ctx=canvas.getContext('2d')!;
 const gradient=ctx.createLinearGradient(0,0,0,256);
 gradient.addColorStop(0,'#04070d');gradient.addColorStop(.42,'#0a141d');gradient.addColorStop(.7,'#16262f');gradient.addColorStop(.84,'#274049');gradient.addColorStop(.9,'#16232a');gradient.addColorStop(1,'#05090b');
 ctx.fillStyle=gradient;ctx.fillRect(0,0,64,256);
 const sky=new THREE.CanvasTexture(canvas);sky.colorSpace=THREE.SRGBColorSpace;sky.mapping=THREE.EquirectangularReflectionMapping;
 const envScene=new THREE.Scene();
 const dome=new THREE.Mesh(new THREE.SphereGeometry(10,24,16),new THREE.MeshBasicMaterial({map:sky,side:THREE.BackSide}));
 envScene.add(dome);
 // A dim moon disc so metal edges catch a cold highlight instead of reading pure black.
 const moon=new THREE.Mesh(new THREE.CircleGeometry(1.1,16),new THREE.MeshBasicMaterial({color:0x8fb4d8,side:THREE.DoubleSide}));
 const dir=new THREE.Vector3(-40,70,-30).normalize().multiplyScalar(8.6);moon.position.copy(dir);moon.lookAt(0,0,0);envScene.add(moon);
 const pmrem=new THREE.PMREMGenerator(renderer);
 const target=pmrem.fromScene(envScene,0.06);
 pmrem.dispose();
 dome.geometry.dispose();(dome.material as THREE.Material).dispose();sky.dispose();
 moon.geometry.dispose();(moon.material as THREE.Material).dispose();
 return target.texture;
}
export class WorldView{
 shake=0;previousNestHp=500;landscapeUpdate:((t:number,fx?:number,fz?:number)=>void)|null=null;
 campRigs:{rig:ReturnType<typeof customCharacter>;actor:Actor;camp:THREE.Group}[]=[];
 weaponRacks=new Map<string,THREE.Group>();
 activeWeapon?:WeaponId;
 fpSerial=-1;fpAttack=0;fpDuration=.6;trailSerial=-1;
 customProps=new Map<string,THREE.Group>();
 characterAssets=new CharacterAssets();animated=new Map<string,NonNullable<ReturnType<CharacterAssets['create']>>>();
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(68,1,.1,320);actors=new Map<string,THREE.Group>();flags=new Map<string,THREE.Mesh>();gates=new Map<string,THREE.Mesh>();barriers=new Map<string,THREE.Group>();keeps=new Map<string,THREE.Group>();campMeshes=new Map<string,THREE.Group>();cacheMeshes=new Map<string,THREE.Group>();nest=new THREE.Group();weapon=new THREE.Group();shield=new THREE.Group();solid:THREE.Object3D[]=[];flames:{x:number;z:number;isCamp:boolean;seed:number}[]=[];flagMeshes:{mesh:THREE.Mesh;seed:number}[]=[];upgrades=new Map<string,THREE.Group[]>();previousHp=new Map<string,number>();effects:{mesh:THREE.Sprite;life:number;pooled?:boolean}[]=[];projectiles=new Map<number,THREE.Mesh>();debris:{mesh:THREE.Mesh;life:number;velocity:THREE.Vector3}[]=[];artillery=new Map<string,THREE.Object3D>();
 /** New systems (batch 2026-10). */
 fx:CombatEffects;postfx:PostFX|null=null;
 ruinsUpdate:((game:Game|undefined,me:Actor|undefined,time:number)=>void)|null=null;
 fog!:THREE.FogExp2;moon!:THREE.DirectionalLight;hemi!:THREE.HemisphereLight;fill!:THREE.DirectionalLight;sky!:THREE.Group;
  /** Smooth region weights (0..1) computed from player Z + nest distance; read by grading/particles. */
  regionWeights:{march:number;moor:number;crown:number;corruption:number}={march:1,moor:0,crown:0,corruption:0};
  ambient!:THREE.AmbientLight;
  private exposureTarget=1.5;
  private lastSkyTint=new THREE.Color(0xffffff);private lastMoonTint=new THREE.Color(0xffffff);
  // ---- cycle-4 weather state (pooled particles, region phase machine) ----
  private weatherStates:{march:{phase:number;name:string;target:number;intensity:number;t:number;next:number};moor:{phase:number;name:string;target:number;intensity:number;t:number;next:number};crown:{phase:number;name:string;target:number;intensity:number;t:number;next:number}}={march:{phase:0,name:'clear',target:.12,intensity:.12,t:0,next:215},moor:{phase:0,name:'calm',target:.2,intensity:.2,t:0,next:240},crown:{phase:0,name:'clear',target:.18,intensity:.18,t:0,next:225}};
  private weatherRegion:WeatherRegion='march';
  private weatherForce:{region:WeatherRegion;phase:string;intensity:number}|null=null;
  private weatherFlash=0;private weatherFogAdd=0;private weatherAnnouncedAt=0;
  private rainMesh:THREE.InstancedMesh|null=null;private splashMesh:THREE.InstancedMesh|null=null;private hazeMesh:THREE.InstancedMesh|null=null;
  private rainData:Float32Array|null=null;private splashData:Float32Array|null=null;private hazeData:Float32Array|null=null;
  private readonly rainDummy=new THREE.Object3D();private readonly rainQuat=new THREE.Quaternion();
  private landscapeWindSet:((gust:number)=>void)|null=null;
  private roadWet={roughness:0.85,envMapIntensity:1,metalness:0}as{roughness:number;envMapIntensity:number;metalness:number};
  private qaBody:THREE.Group|null=null;private qaBodyRig:ReturnType<typeof customCharacter>|null=null;private qaBodyActor:Actor|null=null;private qaBodyDistance=10;
  private softwareRenderer=false;private weatherFlashCount=0;
  // Cycle-8 device-aware quality profile (touch/tablet/small-screen defaults + DPR clamp).
  private deviceProfile={touch:false,coarse:false,smallScreen:false,memory:null as number|null,cores:0,suggestedQuality:'high' as QualityTier,maxDpr:2};
  private firstGameFrameMarked=false;
  // ---- cycle-5: storm snow, frost, combat feel ----
  private stormSnow:THREE.InstancedMesh|null=null;private stormData:Float32Array|null=null;private readonly stormCap=800;
  private gustValue=1;private gustCount=0;private lastGustPeakAt=-99;
  private groundFrost:{m:THREE.MeshStandardMaterial;base:THREE.Color}[]=[];
  private vignetteEl:HTMLDivElement|null=null;private vignetteLife=0;private vignetteOpacity=0;private vignetteDirX=0;private vignetteDirY=0;
  private reducedMotion=false;private reducedMotionOverride:boolean|null=null;private hitStop=0;private kickPitch=0;private kickRoll=0;private fovPunch=0;private lastHeavyAt=0;private lastHitAt=0;private lastHeavySerial=-1;private visualScale=1;
  private characterClothWind=true;private lastHitStopMs=0;private lastKickAt=0;private lastKickMag=0;private lastVignetteAt=0;private lastVignetteMag=0;private heavyCount=0;private damageCount=0;
  private lastAmbientTint=new THREE.Color(0xffffff);private lastSaturation=1;
  /** Landmark coordinates per region for the QA landmark views (ruins-builder placements). */
  private landmarkCoords:{green:{x:number;z:number};ashen:{x:number;z:number};crown:{x:number;z:number}}={
   green:{x:56,z:-6},ashen:{x:-36,z:-228},crown:{x:-34,z:-472}
  };
 torchSources:TorchSource[]=[];lightPool:THREE.PointLight[]=[];
 towerSlots:TowerSlot[]=[];legacyTowerTops:THREE.Object3D[]=[];modernTowers=false;newKeepsApplied=false;
 private nestTorch=-1;
  /** Batch-3 perf instrumentation + quality tier state. */
  quality:QualityTier='high';private torchLightCount=13;
  private readonly frameTimes=new Float32Array(60);private frameIdx=0;private frameCount=0;
  private slowQualityAccum=0;private explicitQualityAt=0;private shadowTrimAt=0;
  /** Batch-3 static batching + pooled flame/label state. */
  private readonly staticBatches=new Map<string,{material:THREE.Material;castShadow:boolean;geos:THREE.BufferGeometry[];target:THREE.Group|null}>();
  private readonly courtyardGeos:THREE.BufferGeometry[]=[];
  private readonly legacyTowerGroup=new THREE.Group();
  /** True only after the modern tower/keep loaders failed: legacy art is hidden until then. */
  private legacyFortressRevealed=false;
  private readonly flameDummy=new THREE.Object3D();private readonly camQuat=new THREE.Quaternion();
  private corruptionDecals:THREE.InstancedMesh|null=null;private corruptionMat:THREE.MeshBasicMaterial|null=null;
  private flameCore!:THREE.InstancedMesh;private flameOuter!:THREE.InstancedMesh;private flameEmber!:THREE.InstancedMesh;
  private readonly damageLabels:{sprite:THREE.Sprite;ctx:CanvasRenderingContext2D;texture:THREE.CanvasTexture}[]=[];
  private damageLabelIndex=0;
  /** Merged road network mesh (one draw; UVs pre-tiled per segment). */
  private roadMesh:THREE.Mesh|null=null;
  /** Debug character-preview camera override (window.__ssCharacterPreview). */
  private previewActorId:string|null=null;
  private lastMeId:string|null=null;
  /** Named QA camera override (window.__ssQAView) for visual audits. */
  private qaView:{name:string;x:number;z:number;yaw:number;pitch:number;height:number}|null=null;
  private landscapeTreeline:{x:number;z:number;lookX:number;lookZ:number}|null=null;
  private lastGame:Game|undefined;
 private readonly fogTarget=new THREE.Color();private readonly fogCurrent=new THREE.Color(0x1c2a2e);
 private readonly tmpV=new THREE.Vector3();private readonly tmpV2=new THREE.Vector3();
 private readonly tmpColor=new THREE.Color();private readonly tmpColor2=new THREE.Color();private readonly tmpColor3=new THREE.Color();
 private readonly nearestIdx=new Int32Array(MAX_TORCH_LIGHTS);private readonly nearestD2=new Float32Array(MAX_TORCH_LIGHTS);
 private readonly camTarget=new THREE.Vector3();private readonly camForward=new THREE.Vector3();private readonly camDesired=new THREE.Vector3();private readonly camDelta=new THREE.Vector3();
 private readonly camRay=new THREE.Raycaster();private readonly shieldTarget=new THREE.Vector3();
 constructor(canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
try{const gl=this.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');const unmasked=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):'';this.softwareRenderer=/swiftshader|llvmpipe|software|basic render|virtualbox/i.test(unmasked);}catch{}this.renderer.info.autoReset=false;this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.5;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0x1a2629);
  this.fog=new THREE.FogExp2(0x1c2a2e,0.015);this.scene.fog=this.fog;
  this.hemi=new THREE.HemisphereLight(0xc2d6ee,0x2e3a44,4.4);this.scene.add(this.hemi);this.ambient=new THREE.AmbientLight(0x243442,0.5);this.scene.add(this.ambient);
  this.moon=new THREE.DirectionalLight(0xcadff5,2.4);this.moon.position.set(-40,64,-30);this.moon.castShadow=true;this.moon.shadow.mapSize.set(2048,2048);this.moon.shadow.camera.left=-34;this.moon.shadow.camera.right=34;this.moon.shadow.camera.top=34;this.moon.shadow.camera.bottom=-34;this.moon.shadow.camera.near=1;this.moon.shadow.camera.far=150;this.moon.shadow.bias=-0.001;this.moon.shadow.normalBias=0.06;this.moon.shadow.radius=1.5;this.scene.add(this.moon);this.scene.add(this.moon.target);this.moon.name="sun";this.sky=createSkyAndMoon(this.scene);
  // Dark night-sky IBL so the PBR armour/metal has something to reflect (single PMREM bake).
  try{const environment=createNightEnvironment(this.renderer);if(environment){this.scene.environment=environment;this.scene.environmentIntensity=1.0;}}
  catch(error){console.warn('Environment map unavailable',error);}
  // Local readable pool of light around the player (does not cast shadows).
  this.fill=new THREE.DirectionalLight(0xaec6e0,1.0);this.fill.castShadow=false;this.scene.add(this.fill);this.scene.add(this.fill.target);
  // Fixed pool of torch lights; sources are re-assigned to the nearest flames every frame.
  for(let i=0;i<MAX_TORCH_LIGHTS;i++){const light=new THREE.PointLight(0xff9d42,0,12,1.8);light.castShadow=false;this.scene.add(light);this.lightPool.push(light);}
  this.fx=new CombatEffects(this.scene);this.scene.add(this.legacyTowerGroup);this.legacyTowerGroup.visible=false;this.initFlameInstances();this.initDamageLabels();
   this.initWeather();try{performance.mark('ss:sceneConstructStart');}catch{}
  for(const region of REGIONS){const ground=box(this.scene,5,-.3,region.offset-80,175,.6,250,region.color,true);ground.castShadow=false;const m=(ground.material as THREE.MeshStandardMaterial).clone();m.map=m.map!.clone();m.map.repeat.set(38,55);ground.material=m;tagSurface(ground,'ground');}
  const route=[START,...REGIONS.flatMap(r=>[{x:0,z:r.offset+12},{x:0,z:r.offset+24},{x:42,z:r.offset-45},{x:42,z:r.offset-55},{x:42,z:r.offset-43},{x:-24,z:r.offset-113},{x:-24,z:r.offset-123},{x:-24,z:r.offset-112},{x:0,z:r.offset-200}]),NEST];
  {
   const roadGeos:THREE.BufferGeometry[]=[];
   const roadMatrix=new THREE.Matrix4(),roadQ=new THREE.Quaternion(),roadPos=new THREE.Vector3(),roadScale=new THREE.Vector3(1,1,1),roadEuler=new THREE.Euler();
   for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],length=dist(a,b);
    const geo=boxGeometry(4,.04,Math.max(.01,length)).clone();
    // Pre-tile the road UVs per segment (1 tile across, length/4 along) so the merged mesh can use repeat 1.
    const uv=geo.getAttribute('uv');if(uv)for(let u=0;u<uv.count;u++)uv.setY(u,uv.getY(u)*(length/4));
    roadEuler.set(0,Math.atan2(b.x-a.x,b.z-a.z),0);roadQ.setFromEuler(roadEuler);
    roadPos.set((a.x+b.x)/2,.005,(a.z+b.z)/2);
    roadMatrix.compose(roadPos,roadQ,roadScale);
    geo.applyMatrix4(roadMatrix);
    roadGeos.push(geo);
   }
   const merged=mergeGeometries(roadGeos,false);
   if(merged){this.roadMesh=new THREE.Mesh(merged,mat(0x706c56,true));this.roadMesh.castShadow=false;this.roadMesh.receiveShadow=true;tagSurface(this.roadMesh,'road');this.scene.add(this.roadMesh);}
   for(const geo of roadGeos)geo.dispose();
  }
  for(const c of CASTLES)this.castle(c);this.flushCourtyard();this.flushStaticBatches();
  CAMPS.forEach(c=>{const group=new THREE.Group();group.position.set(c.x,0,c.z);this.scene.add(group);this.campMeshes.set(c.id,group);const fBox=box(group,-2,1,1,2.7,2,2.8,0x5b5441,true);fBox.name='camp-fbox';const roof=new THREE.Mesh(new THREE.ConeGeometry(2.8,1.5,4),mat(0x3e4443));roof.name='camp-froof';roof.position.set(-2,2.6,1);roof.rotation.y=Math.PI/4;group.add(roof);this.fire(c.x+2,c.z+3,true);const label=this.label("SURVIVORS · "+c.name,"#ffe2a3");label.position.set(0,5,0);group.add(label);const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.22,.65,16,8),new THREE.MeshBasicMaterial({color:0xffce72,transparent:true,opacity:.18,depthWrite:false}));beacon.position.y=8;group.add(beacon);const ring=new THREE.Mesh(new THREE.RingGeometry(3.5,3.7,40),new THREE.MeshBasicMaterial({color:0xffce72,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.08;group.add(ring);});
  this.nest.position.set(NEST.x,0,NEST.z);this.scene.add(this.nest);for(let i=0;i<8;i++){const angle=i*Math.PI/4;const pillar=box(this.nest,Math.cos(angle)*3,1.2+Math.sin(i)*.5,Math.sin(angle)*3,.8,3,1,0x423b50);pillar.rotation.z=Math.sin(i)*.2;}const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(2),new THREE.MeshStandardMaterial({color:0x9a496f,emissive:0x76284d,emissiveIntensity:.9,flatShading:true}));crystal.position.y=2.3;this.nest.add(crystal);
   // Cycle-8 nest ground decals: feathered corruption patches so the ritual area blends into terrain.
   try{
    const decalGeo=new THREE.PlaneGeometry(1,1);const decalMat=new THREE.MeshBasicMaterial({color:0x8a2f55,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    this.corruptionMat=decalMat;
    new THREE.TextureLoader().load(import.meta.env.BASE_URL+'assets/textures/corruption_feather.png',(t:THREE.Texture)=>{t.colorSpace=THREE.SRGBColorSpace;decalMat.map=t;decalMat.needsUpdate=true;},undefined,()=>undefined);
    const inst=new THREE.InstancedMesh(decalGeo,decalMat,44);inst.castShadow=false;inst.receiveShadow=false;inst.frustumCulled=false;inst.renderOrder=2;
    let sv=4242;const rv=()=>{sv=(sv*16807)%2147483647;return sv/2147483647;};
    const d=new THREE.Object3D();
    for(let di=0;di<44;di++){const a=rv()*Math.PI*2,r=4+rv()*27,sc=3.5+rv()*5;d.position.set(NEST.x+Math.cos(a)*r,.03,NEST.z+Math.sin(a)*r);d.rotation.set(-Math.PI/2,0,rv()*Math.PI*2);d.scale.set(sc,sc,1);d.updateMatrix();inst.setMatrixAt(di,d.matrix);}
    inst.instanceMatrix.needsUpdate=true;this.scene.add(inst);this.corruptionDecals=inst;
   }catch(error){console.warn('Nest decals unavailable',error);}
  // Plague glow joins the pooled lights instead of being a permanent extra point light.
  this.nestTorch=this.torchSources.length;this.torchSources.push({x:NEST.x,y:3,z:NEST.z,color:0xd15b92,intensity:22,distance:16,seed:11.3});
  const ls=addLandscape(this.scene);this.landscapeUpdate=ls?.update??null;this.landscapeTreeline=(ls as {treeline?:{x:number;z:number;lookX:number;lookZ:number}}|undefined)?.treeline??null;
   this.landscapeWindSet=(ls as {setWindStrength?:(g:number)=>void}|undefined)?.setWindStrength??null;
  const ruins=addRuins(this.scene);this.ruinsUpdate=ruins?.update??null;
  // Mountains stay outside the navigable map.
  const mountainGeo=new THREE.ConeGeometry(1,1,5),mountainMat=mat(0x263941),mountainDummy=new THREE.Object3D();
  const mountains=new THREE.InstancedMesh(mountainGeo,mountainMat,18);mountains.castShadow=false;mountains.receiveShadow=false;mountains.frustumCulled=false;mountains.name="no-shadow:mountains";
  for(let i=0;i<18;i++){mountainDummy.position.set(-130+i*17,10,-720-i%3*5);mountainDummy.scale.set(22+i%3*8,28+i%5*6,22+i%3*8);mountainDummy.updateMatrix();mountains.setMatrixAt(i,mountainDummy.matrix);}
  this.scene.add(mountains);
  this.scene.add(this.camera);box(this.weapon,0,0,0,.08,.95,.12,palette.iron);box(this.weapon,0,-.5,0,.45,.08,.15,palette.gold);box(this.weapon,0,-.67,0,.1,.3,.1,palette.wood);this.camera.add(this.weapon);box(this.shield,0,0,0,.55,.7,.1,0x576b73);box(this.shield,0,0,-.06,.06,.65,.03,palette.gold);this.camera.add(this.shield);this.weapon.visible=this.shield.visible=false;
  this.postfx=createPostFX(this.renderer,this.scene,this.camera);this.installPerfHooks();
  window.addEventListener('resize',()=>this.resize());this.resize();
  void this.survivorAssets();
   // Early shader warmup while assets stream (overlaps compile with loading).
   setTimeout(()=>{const compile=(this.renderer as unknown as {compileAsync?:(sc:THREE.Scene,cam:THREE.Camera)=>Promise<unknown>}).compileAsync;if(!compile)return;const parallel=!!(this.renderer.getContext().getExtension('KHR_parallel_shader_compile'));if(!parallel){try{performance.mark('ss:earlyCompileSkipped');}catch{}return;}try{performance.mark('ss:earlyCompileStart');}catch{}try{void compile.call(this.renderer,this.scene,this.camera).then(()=>{try{performance.mark('ss:earlyCompileEnd');}catch{}}).catch(()=>{});}catch{}},600);
  // Time-to-HUD: nothing world-size starts before the join-critical core player set is resident.
  // Fortress/terrain/surfaces/props/landmark streaming then runs in one ordered background queue.
  void this.characterAssets.coreReady.then(()=>{
   try{performance.mark('ss:coreReady');}catch{}
   void this.startEnvironment();
   void this.applySurfaces();
   void this.environmentAssets();
   // Shader warmup off the critical path: compile the post-streaming scene in the background.
   setTimeout(()=>{
    const compile=(this.renderer as unknown as {compileAsync?:(sc:THREE.Scene,cam:THREE.Camera)=>Promise<unknown>}).compileAsync;
    if(!compile)return;
    const parallel=!!(this.renderer.getContext().getExtension('KHR_parallel_shader_compile'));
    if(!parallel){try{performance.mark('ss:compileSkipped');}catch{}return;}
    try{performance.mark('ss:compileStart');}catch{}
    try{void compile.call(this.renderer,this.scene,this.camera).then(()=>{try{performance.mark('ss:compileEnd');}catch{}}).catch(()=>{});}catch{}
   },1200);
  });
 }
 /** Scanned road/cobblestone/dirt maps owned by terrain-surfaces.ts; never throws. */
 private async applySurfaces(){
  try{await applySurfaceTextures(this.scene,this.renderer.capabilities.getMaxAnisotropy());}
  catch(error){console.warn('Surface textures unavailable',error);return;}
  // The scanned country-road/cobble albedo is naturally light; under moon+hemi it reads
  // near-white. Tint the material colour down (texture detail intact) so streets stay
  // readable but don't compete with the night mood. Terrain-surfaces owns the textures;
  // this only touches the material instances it cloned onto our tagged meshes.
  this.scene.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   const surface=object.userData.surface;
   if(surface!=='road'&&surface!=='cobble')return;
   const materials=Array.isArray(object.material)?object.material:[object.material];
   for(const material of materials){const standard=material as THREE.MeshStandardMaterial;if(standard.isMeshStandardMaterial&&standard.color)standard.color.multiplyScalar(surface==='road'?0.42:0.48);}
  });
  // The merged road mesh carries per-segment UV tiling already: keep its maps at repeat 1.
  if(this.roadMesh){const mats=Array.isArray(this.roadMesh.material)?this.roadMesh.material:[this.roadMesh.material];for(const material of mats){const standard=material as THREE.MeshStandardMaterial;for(const map of [standard.map,standard.normalMap]){if(map){map.repeat.set(1,1);map.needsUpdate=true;}}}}
 }
 async survivorAssets(){
  await this.characterAssets.coreReady;const source=this.characterAssets.custom.get('survivor');if(!source)return;
  for(const camp of this.campMeshes.values())for(let i=0;i<2;i++){
   const actor={id:'survivor-'+i,kind:'soldier',hp:100,maxHp:100,attackSerial:0} as Actor;
   const rig=customCharacter(source,actor,new Map(),true);rig.model.userData.actorRig=false;rig.model.position.set(.7+i*1.15,0,i%2?1.1:0);rig.model.rotation.y=Math.PI+(i-1)*.45;boostActorMaterials(rig.model);camp.add(rig.model);this.campRigs.push({rig,actor,camp});rig.update(actor,false,i*.3);
  }
 }
 private async startEnvironment(){
  // Load the modular fortress art in parallel with the legacy prop pass; otherwise the
  // sequential prop queue delays the keeps/towers until after the first QA screenshots.
  const legacy=this.customEnvironment().catch(error=>console.warn('Custom environment failed',error));
  const fortress=this.modernFortress().catch(error=>{console.warn('Fortress upgrade failed',error);this.revealLegacyFortress();});
  await Promise.all([legacy,fortress]);
  this.trimShadowCasters();
 }
 async customEnvironment(){
  // Batch 2026-10C: the old per-instance tree clones lived here; landscape.ts already
  // instances 540 varied pines/oaks, so duplicating them created ~90k meshes.
  for(const name of ['sword','shield','stakes','supplies','plague','trebuchet','iron','medicine','cauldron','gatehouse','gate','beacon','firepit','mill','fallen_keep','border_fortress','high_citadel','cart','brazier','barrels','grave','house'])try{
   const asset=await loadAsset('custom/'+name);const model=asset.scene.clone(true);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
   const normalized=new THREE.Group();model.position.x-=center.x;model.position.z-=center.z;model.position.y-=bounds.min.y;normalized.add(model);normalized.userData.height=size.y;this.customProps.set(name,normalized);
   const fit=(height:number)=>{const o=normalized.clone(true);o.scale.setScalar(height/size.y);o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});return o;};
   if(name==='cauldron')for(const camp of this.campMeshes.values()){const kettle=fit(.9);kettle.position.set(1.8,0,2.8);camp.add(kettle);}
   if(name==='shield'){const parent=this.shield;parent.clear();const o=equipmentModel(asset.scene,.56,true);o.rotation.y=Math.PI;parent.add(o);parent.traverse(o=>{o.castShadow=false;});}
   if(name==='stakes')for(const barrier of this.barriers.values()){barrier.clear();const o=fit(1.7);const b=new THREE.Box3().setFromObject(o),w=b.getSize(new THREE.Vector3()).x;o.scale.x*=5/Math.max(.01,w);barrier.add(o);}
   if(name==='plague'){for(const child of this.nest.children)if(!(child instanceof THREE.Light))child.visible=false;this.nest.add(fit(4.5));}
   if(name==='trebuchet'){const mats:THREE.Matrix4[]=[];for(const c of CASTLES){mats.push(this.propMatrix(c.x+6,0,c.z-6,0,3/size.y));const old=this.artillery.get(c.id);if(old)this.scene.remove(old);this.artillery.set(c.id,new THREE.Object3D());}this.addPropInstances(asset,mats,true);}
   if(name==='gatehouse'){const mats:THREE.Matrix4[]=[];for(const c of CASTLES)for(const dx of [-3.8,3.8]){mats.push(this.propMatrix(c.x+dx,0,c.z+10,dx>0?-Math.PI/2:Math.PI/2,6.5/size.y));const collider=new THREE.Mesh(boxGeometry(2,6.5,2),mat(palette.dark));collider.position.set(c.x+dx,3.25,c.z+10);collider.visible=false;this.scene.add(collider);this.solid.push(collider);}this.addPropInstances(asset,mats,true,true);}
   if(name==='gate')for(const c of CASTLES){const gateGroup=this.gates.get(c.id);if(gateGroup){gateGroup.clear();const o=fit(4.4);o.position.y=-2.2;gateGroup.add(o);}}
   if(name==='beacon'){const mats:THREE.Matrix4[]=[];for(const c of CASTLES)for(const dx of [-3.6,3.6])mats.push(this.propMatrix(c.x+dx,0,c.z+11,0,2.1/size.y));this.addPropInstances(asset,mats,false);}
   if(name==='firepit'){const mats:THREE.Matrix4[]=[];for(const c of CAMPS)mats.push(this.propMatrix(c.x+2,0,c.z+3,0,.9/size.y));this.addPropInstances(asset,mats,false);}
   if(name==='cart'){let sv=777;const rv=()=>{sv=(sv*16807)%2147483647;return sv/2147483647;};const mats:THREE.Matrix4[]=[];for(let i=0;i<14;i++)mats.push(this.propMatrix(rv()*145-62,0,35-rv()*695,rv()*Math.PI*2,(.9+rv()*.4)/size.y));this.addPropInstances(asset,mats,false);}
   if(name==='brazier'){const mats:THREE.Matrix4[]=[];for(const c of CASTLES){mats.push(this.propMatrix(c.x-8,0,c.z-8,0,1.5/size.y));this.fire(c.x-8,c.z-8);}for(const camp of CAMPS){mats.push(this.propMatrix(camp.x-3,0,camp.z+4,0,1.2/size.y));this.fire(camp.x-3,camp.z+4,true);}this.addPropInstances(asset,mats,false);}
   if(name==='barrels'){const mats:THREE.Matrix4[]=[];for(const c of CASTLES)for(const [bx,bz] of [[7,-8],[-8,7],[5,9]] as const)mats.push(this.propMatrix(c.x+bx,0,c.z+bz,0,.85/size.y));for(const camp of CAMPS)mats.push(this.propMatrix(camp.x+3,0,camp.z+2,0,.7/size.y));this.addPropInstances(asset,mats,false);}
   if(name==='house')for(const camp of this.campMeshes.values()){const o=fit(3.2);o.position.set(-2,0,1);camp.add(o);camp.getObjectByName('camp-fbox')!.visible=false;camp.getObjectByName('camp-froof')!.visible=false;}
   if(name==='grave'){let sv2=1337;const rv2=()=>{sv2=(sv2*16807)%2147483647;return sv2/2147483647;};const mats:THREE.Matrix4[]=[];for(let i=0;i<20;i++)mats.push(this.propMatrix(rv2()*148-64,0,35-rv2()*698,rv2()*Math.PI*2,(.7+rv2()*.4)/size.y));this.addPropInstances(asset,mats,false);}
  }catch(e){console.warn('Custom prop unavailable',name,e);}
   for(const c of CASTLES){
    const group=this.keeps.get(c.id);if(!group)continue;
    if(this.newKeepsApplied)continue;
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
   this.flushStaticBatches();
 }
 /** Batch 2026-10: modular fortress_keep / castle_tower with region styling. */
 private castleTint(c:{id:string;region:string}){
  const region=REGIONS.find(r=>r.id===c.region)??REGIONS[0];
  const accent=c.id.includes('citadel')?0x2d6e75:c.id.includes('border')?0x526070:0x3d2d3a;
  return new THREE.Color(region.color).lerp(new THREE.Color(accent),0.45);
 }
 /** Show the box/cone legacy fortress art - only used when the modern assets fail to load. */
 private revealLegacyFortress(){
  this.legacyFortressRevealed=true;this.legacyTowerGroup.visible=true;
  for(const top of this.legacyTowerTops)top.visible=true;
 }
 private async modernFortress(){
  let keepApplied=false;
  try{
   const keepAsset=await loadAsset('custom/fortress_keep');
   const keepRoot=new THREE.Group();keepRoot.add(keepAsset.scene.clone(true));keepRoot.updateMatrixWorld(true);
   const keepBounds=new THREE.Box3().setFromObject(keepRoot),keepSize=keepBounds.getSize(new THREE.Vector3()),keepCenter=keepBounds.getCenter(new THREE.Vector3());
   const keepNormalize=new THREE.Matrix4().makeTranslation(-keepCenter.x,-keepBounds.min.y,-keepCenter.z);
   const keepParts:THREE.Mesh[]=[];keepRoot.traverse(o=>{if(o instanceof THREE.Mesh)keepParts.push(o as THREE.Mesh);});
   const keepLocal=new THREE.Matrix4(),keepWorld=new THREE.Matrix4(),keepPlacement=new THREE.Matrix4(),keepQ=new THREE.Quaternion(),keepQuat=new THREE.Quaternion();
   for(const part of keepParts){
    const material=(Array.isArray(part.material)?part.material[0]:part.material).clone() as THREE.MeshStandardMaterial;
    for(const region of REGIONS){
     const regionCastles=CASTLES.filter(c=>c.region===region.id);
     if(!regionCastles.length)continue;
     const instanced=new THREE.InstancedMesh(part.geometry,material.clone(),regionCastles.length);
     keepLocal.multiplyMatrices(keepNormalize,part.matrixWorld);
     for(let i=0;i<regionCastles.length;i++){
      const c=regionCastles[i];const group=this.keeps.get(c.id);if(group)group.clear();
      const scale=(c.id.includes('citadel')?9.4:c.id.includes('border')?8.2:7.4)/Math.max(0.01,keepSize.y);
      keepPlacement.compose(new THREE.Vector3(c.x-5,0,c.z-6),keepQuat.identity(),new THREE.Vector3(scale,scale,scale));
      keepWorld.multiplyMatrices(keepPlacement,keepLocal);
      instanced.setMatrixAt(i,keepWorld);
      instanced.setColorAt(i,this.castleTint(c).lerp(new THREE.Color(0xffffff),0.3));
     }
     instanced.castShadow=true;instanced.receiveShadow=true;instanced.frustumCulled=false;instanced.userData.architecture=true;
     instanced.instanceMatrix.needsUpdate=true;if(instanced.instanceColor)instanced.instanceColor.needsUpdate=true;
     this.scene.add(instanced);
    }
   }
   keepApplied=true;
   this.newKeepsApplied=true;
   console.info('fortress_keep applied to',CASTLES.length,'castles');
  }catch(error){console.warn('fortress_keep unavailable — keeping simplified keeps',error);}
  if(!keepApplied){this.revealLegacyFortress();return;}
  try{
const towerLod=await loadAsset('custom/castle_tower_lod').catch(()=>null);
   const towerAsset=towerLod??await loadAsset('custom/castle_tower');
   const slots=this.towerSlots;if(!slots.length){this.revealLegacyFortress();return;}
   towerAsset.scene.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(towerAsset.scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
   if(size.y<=0.01){this.revealLegacyFortress();return;}
   const parts:THREE.Mesh[]=[];towerAsset.scene.traverse(o=>{if(o instanceof THREE.Mesh)parts.push(o);});
   if(!parts.length){this.revealLegacyFortress();return;}
   let triangles=0;for(const part of parts){const g=part.geometry;triangles+=(g.index?g.index.count:g.attributes.position.count)/3;}
   // SwiftShader / low-end guard: if the tower mesh is heavy, use two corners per castle.
   const useSlots=towerLod?slots.filter((_,i)=>i%4===0):slots.filter((_,i)=>i%8===0);
   const dummy=new THREE.Object3D();
   for(const part of parts){
    const geometry=part.geometry.clone();geometry.applyMatrix4(part.matrixWorld);geometry.translate(-center.x,-bounds.min.y,-center.z);
    const sourceMaterial=(Array.isArray(part.material)?part.material:[part.material])[0] as THREE.MeshStandardMaterial;
    const material=sourceMaterial.clone();
    if(material.color)material.color.lerp(new THREE.Color(0xffffff),0.55);
    const instanced=new THREE.InstancedMesh(geometry,material,useSlots.length);
    instanced.castShadow=(towerLod!==null)||triangles*useSlots.length<120000;instanced.userData.architecture=true;instanced.receiveShadow=true;instanced.frustumCulled=false;
    for(let i=0;i<useSlots.length;i++){
     const slot=useSlots[i];const c=CASTLES.find(cc=>cc.id===slot.castleId);if(!c)continue;
     const height=c.id.includes('citadel')?8.4:c.id.includes('border')?7.6:6.8;
     dummy.position.set(slot.x,0,slot.z);dummy.rotation.set(0,Math.atan2(slot.x-c.x,slot.z-c.z),0);dummy.scale.setScalar(height/size.y);dummy.updateMatrix();
     instanced.setMatrixAt(i,dummy.matrix);
     instanced.setColorAt(i,this.castleTint(c).lerp(new THREE.Color(0xffffff),0.35));
    }
    instanced.instanceMatrix.needsUpdate=true;if(instanced.instanceColor)instanced.instanceColor.needsUpdate=true;
    this.scene.add(instanced);
   }
   this.modernTowers=true;
   console.info('castle_tower instanced at',useSlots.length,'wall corners');
   for(const slot of slots)slot.decor.visible=false;this.legacyTowerGroup.visible=false;
   for(const top of this.legacyTowerTops)top.visible=false;
  }catch(error){console.warn('castle_tower unavailable — keeping box towers',error);this.revealLegacyFortress();}
 }
 async environmentAssets(){
  for(const name of ['tower-square-top-roof-high','siege-catapult','rocks-large'])try{const asset=await loadAsset(name);const bounds=new THREE.Box3().setFromObject(asset.scene),size=bounds.getSize(new THREE.Vector3());const place=(x:number,z:number,height:number,y=0)=>{const o=asset.scene.clone(true);const scale=height/size.y;o.scale.multiplyScalar(scale);o.position.set(x,y-bounds.min.y*scale,z);o.traverse(n=>{if(n instanceof THREE.Mesh)n.castShadow=n.receiveShadow=true;});this.scene.add(o);return o;};
   if(name==='tower-square-top-roof-high'&&!this.modernTowers)for(const c of CASTLES)for(const dx of [-10,10])for(const dz of [-10,10]){const top=place(c.x+dx,c.z+dz,3,6);top.visible=this.legacyFortressRevealed;this.legacyTowerTops.push(top);}
   if(name==='siege-catapult'&&!this.customProps.has('trebuchet'))for(const c of CASTLES)this.artillery.set(c.id,place(c.x+6,c.z-6,2));
   if(name==='rocks-large'){
    let rockMesh:THREE.Mesh|undefined;asset.scene.traverse(n=>{if(!rockMesh&&n instanceof THREE.Mesh)rockMesh=n;});
    if(rockMesh){const geo=rockMesh.geometry,material=(Array.isArray(rockMesh.material)?rockMesh.material[0]:rockMesh.material) as THREE.Material;const inst=new THREE.InstancedMesh(geo,material,54);inst.castShadow=true;inst.receiveShadow=true;inst.frustumCulled=false;
     const dummy=new THREE.Object3D();for(let i=0;i<54;i++){const x=(i%2?1:-1)*(25+i%5*7),z=24-i*12,h=1+i%3*.4,scale=h/size.y;dummy.position.set(x,-bounds.min.y*scale,z);dummy.scale.setScalar(scale);dummy.rotation.set(0,i*.7,0);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);}
     this.scene.add(inst);}
   }
  }catch(error){console.warn('Environment asset unavailable',name,error);}this.trimShadowCasters();}
  label(text:string,color='#fff3cb',backdrop='#132226dd'){const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d')!;ctx.fillStyle=backdrop;ctx.fillRect(0,0,512,96);ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,256,58);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthTest:false}));sprite.scale.set(7,1.3,1);return sprite;}
  /** Queue a static geometry instance for later per-material merging. */
  private queueStatic(geometry:THREE.BufferGeometry,material:THREE.Material,matrix:THREE.Matrix4,castShadow:boolean,target:THREE.Group|null=null){
   const geo=sanitizeGeometry(geometry);if(!geo)return;geo.applyMatrix4(matrix);
   const key=material.uuid+':'+(castShadow?1:0)+':'+(target?target.uuid:'s')+':'+geometrySignature(geo);
   const entry=this.staticBatches.get(key);
   if(entry)entry.geos.push(geo);else this.staticBatches.set(key,{material,castShadow,geos:[geo],target});
  }
  private queueBox(x:number,y:number,z:number,w:number,h:number,d:number,color:number,castShadow=true,target:THREE.Group|null=null){
   const matrix=new THREE.Matrix4().makeTranslation(x,y,z);this.queueStatic(boxGeometry(w,h,d),mat(color,true),matrix,castShadow,target);
  }
  /** Merge every queued static batch into one mesh per material (targeted groups keep visibility). */
  private flushStaticBatches(){
   for(const batch of this.staticBatches.values()){
    if(!batch.geos.length)continue;
    const merged=mergeGeometries(batch.geos,false);
    if(merged){const mesh=new THREE.Mesh(merged,batch.material);mesh.castShadow=batch.castShadow;mesh.receiveShadow=true;mesh.userData.architecture=true;(batch.target??this.scene).add(mesh);}
    for(const geo of batch.geos)geo.dispose();
   }
   this.staticBatches.clear();
  }
  /** Merge an existing group's meshes per material in place (used for keeps, stages, barriers). */
  private mergeGroupStatic(group:THREE.Group,castShadow=true,receiveShadow=true){
   group.updateWorldMatrix(true,true);
   const inv=new THREE.Matrix4().copy(group.matrixWorld).invert();
   const buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();const remove:THREE.Object3D[]=[];
   for(const child of group.children){
    child.updateWorldMatrix(true,false);
    child.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const geo=sanitizeGeometry(o.geometry);if(!geo)return;geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld));const material=o.material as THREE.Material;const list=buckets.get(material);if(list)list.push(geo);else buckets.set(material,[geo]);remove.push(o);});
   }
   for(const o of remove){o.parent?.remove(o);if(o instanceof THREE.Mesh&&!o.userData.sharedAsset)o.geometry.dispose();}
   for(const [material,geos] of buckets){const merged=mergeGeometries(geos,false);if(merged){const mesh=new THREE.Mesh(merged,material);mesh.castShadow=castShadow;mesh.receiveShadow=receiveShadow;mesh.userData.architecture=true;group.add(mesh);}for(const geo of geos)geo.dispose();}
  }
  /** Placement matrix for instanced props (position + yaw + uniform scale). */
  private propMatrix(x:number,y:number,z:number,rotY:number,scale:number):THREE.Matrix4{
   const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,rotY,0));
   return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),quaternion,new THREE.Vector3(scale,scale,scale));
  }
  /** One InstancedMesh per asset primitive: all placements of a static prop in a few draws. */
  private addPropInstances(asset:{scene:THREE.Object3D},placements:THREE.Matrix4[],castShadow:boolean,architecture=false){
   const root=new THREE.Group();root.add(asset.scene.clone(true));root.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3());
   const normalize=new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z);
   const meshes:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh)meshes.push(o as THREE.Mesh);});
   const local=new THREE.Matrix4(),world=new THREE.Matrix4();
   for(const mesh of meshes){
    const material=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material) as THREE.Material;
    const instanced=new THREE.InstancedMesh(mesh.geometry,material,placements.length);
    local.multiplyMatrices(normalize,mesh.matrixWorld);
    for(let i=0;i<placements.length;i++){world.multiplyMatrices(placements[i],local);instanced.setMatrixAt(i,world);}
    instanced.castShadow=castShadow;instanced.receiveShadow=true;instanced.frustumCulled=false;instanced.userData.architecture=architecture;
    instanced.instanceMatrix.needsUpdate=true;
    this.scene.add(instanced);
   }
  }
  /** Merge one cloned prop into the per-material static batches (no per-placement meshes). */
  /** Static props are kept as cloned scene graphs (merged GLB primitives proved fragile with
   *  quantised/interleaved attributes, and the draw count is irrelevant next to castles/trees). */
  private batchProp(root:THREE.Object3D,castShadow=true,target:THREE.Group|null=null){
   root.updateMatrixWorld(true);
   root.traverse(o=>{if(o instanceof THREE.Mesh){(o as THREE.Mesh).castShadow=castShadow;(o as THREE.Mesh).receiveShadow=true;}});
   (target??this.scene).add(root);
  }
  /** Merge the nine 20x20 courtyard slabs into one cobble-tagged mesh. */
  private flushCourtyard(){
   if(!this.courtyardGeos.length)return;
   const merged=mergeGeometries(this.courtyardGeos,false);
   if(merged){const mesh=new THREE.Mesh(merged,mat(0x384145,true));mesh.castShadow=false;mesh.receiveShadow=true;tagSurface(mesh,'cobble');this.scene.add(mesh);}
   for(const geo of this.courtyardGeos)geo.dispose();this.courtyardGeos.length=0;
  }
  /** Pooled damage-number labels (no per-hit canvas/texture churn). */
  private spawnDamageLabel(text:string,color:string,x:number,y:number,z:number,scaleX:number,scaleY:number,life:number){
   const slot=this.damageLabels[this.damageLabelIndex%this.damageLabels.length];this.damageLabelIndex++;
   const {ctx,texture,sprite}=slot;
   ctx.clearRect(0,0,256,64);ctx.fillStyle='#0d1114cc';ctx.fillRect(0,0,256,64);ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,128,46);
   texture.needsUpdate=true;sprite.position.set(x,y,z);sprite.scale.set(scaleX,scaleY,1);sprite.visible=true;
   this.effects.push({mesh:sprite,life,pooled:true});
  }
  /** Cycle-3 fire: three additive/normal sprite-card InstancedMeshes (soft tongue, hot core, puff). */
  private initFlameInstances(){
   const card=new THREE.PlaneGeometry(1,1,1,1);card.translate(0,.5,0);
   const base={transparent:true,depthWrite:false,side:THREE.DoubleSide};
   this.flameCore=new THREE.InstancedMesh(card,new THREE.MeshBasicMaterial({...base,color:0xfff2c0,blending:THREE.AdditiveBlending,opacity:1}),96);
   this.flameOuter=new THREE.InstancedMesh(card,new THREE.MeshBasicMaterial({...base,color:0xff8a3c,blending:THREE.AdditiveBlending,opacity:.8}),96);
   this.flameEmber=new THREE.InstancedMesh(card,new THREE.MeshBasicMaterial({...base,color:0x8f9aa8,blending:THREE.AdditiveBlending,opacity:.22}),96);
   for(const mesh of [this.flameCore,this.flameOuter,this.flameEmber]){mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.renderOrder=3;this.scene.add(mesh);}
   // Texture cards stream in without blocking construction (flat-colour fallback until they arrive).
   const loader=new THREE.TextureLoader();const baseUrl=import.meta.env.BASE_URL;
   loader.load(baseUrl+'assets/textures/flame_soft.png',(t:THREE.Texture)=>{t.colorSpace=THREE.SRGBColorSpace;const m=this.flameOuter.material as THREE.MeshBasicMaterial;m.map=t;m.needsUpdate=true;},undefined,()=>undefined);
   loader.load(baseUrl+'assets/textures/flame_core.png',(t:THREE.Texture)=>{t.colorSpace=THREE.SRGBColorSpace;const m=this.flameCore.material as THREE.MeshBasicMaterial;m.map=t;m.needsUpdate=true;},undefined,()=>undefined);
   loader.load(baseUrl+'assets/textures/smoke_puff.png',(t:THREE.Texture)=>{t.colorSpace=THREE.SRGBColorSpace;const m=this.flameEmber.material as THREE.MeshBasicMaterial;m.map=t;m.needsUpdate=true;},undefined,()=>undefined);
  }
  private initDamageLabels(){
   for(let i=0;i<10;i++){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const ctx=canvas.getContext('2d')!;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));sprite.visible=false;this.scene.add(sprite);
    this.damageLabels.push({sprite,ctx,texture});
   }
  }
  /** Which region a world Z falls into (used by QA region views/info). */
  private regionAt(z:number):'march'|'moor'|'crown'{return z<-405?'crown':z<-165?'moor':'march';}
  /** window.__ssEliteUndeadIds(): ids whose cycle-3 undead silhouette tier is > 0.
   *  Mirrors weapons-armory's `undeadEliteTier` rule exactly (kind/maxHp/castle/NEST distance). */
  eliteUndeadIds(){
   const g=this.lastGame;if(!g)return [];
   return g.actors.filter(a=>undeadEliteTier(a)>0).map(a=>a.id);
  }
  eliteUndeadInfo(){const g=this.lastGame;if(!g)return [];return g.actors.map(a=>({id:a.id,name:a.name??'',tier:undeadEliteTier(a)})).filter(x=>x.tier>0);}
  /** window.__ssRegionInfo(): numeric regional-identity snapshot for QA (read-only). */
  regionInfo(){
   const w=this.regionWeights;
   const qa=this.qaView;
   const region=w.crown>=w.moor&&w.crown>=w.march?'crown':w.moor>=w.march?'moor':'march';
   return {region,weights:{march:+w.march.toFixed(3),moor:+w.moor.toFixed(3),crown:+w.crown.toFixed(3),corruption:+w.corruption.toFixed(3)},
    fog:{color:'#'+this.fog.color.getHexString(),density:+this.fog.density.toFixed(5)},
    skyTint:'#'+this.lastSkyTint.getHexString(),ambientTint:'#'+this.lastAmbientTint.getHexString(),
    moonTint:'#'+this.lastMoonTint.getHexString(),moonIntensity:+this.moon.intensity.toFixed(2),
    hemiIntensity:+this.hemi.intensity.toFixed(2),exposure:+this.renderer.toneMappingExposure.toFixed(3),
    saturation:+this.lastSaturation.toFixed(3),landmark:this.landmarkCoords[region==='march'?'green':region==='moor'?'ashen':'crown']??null,qa:!!qa,at:{x:+(qa?qa.x:0).toFixed(2),z:+(qa?qa.z:0).toFixed(2)}};
  }
  /** Landmark coordinates hook so other owners (ruins) don't need to edit scene.ts. */
  setLandmarkCoords(region:'green'|'ashen'|'crown',x:number|null,z?:number){const defaults:{green:{x:number;z:number};ashen:{x:number;z:number};crown:{x:number;z:number}}={green:{x:56,z:-6},ashen:{x:-36,z:-228},crown:{x:-34,z:-472}};this.landmarkCoords[region]=x===null?defaults[region]:{x,z:z??0};return this.landmarkCoords[region];}
  /** Named read-only QA camera viewpoints (cycle-2/3 visual audit); null restores normal play. */
  qaViewpoint(name:string|null, custom?:{x:number;z:number;yaw:number;pitch:number;height:number}){
   if(name===null){this.qaView=null;return {ok:true,name:null,pose:null};}
   const look=(x:number,y:number,z:number,tx:number,ty:number,tz:number)=>{const dx=tx-x,dz=tz-z,dy=ty-y;return {x,z,yaw:Math.atan2(dx,-dz),pitch:Math.atan2(dy,Math.max(.01,Math.hypot(dx,dz))),height:y};};
   let pose:{x:number;z:number;yaw:number;pitch:number;height:number}|null=null;
   if(name==='custom'&&custom)pose={...custom};
   else if(name==='treeline'){
    // Verified dense grove north-west of the Green March border fortress: 9 full-res trees inside
    // 22 m and 12 LOD instances out to 54 m in one frame (solved against the deterministic tree
    // layout and checked by re-rendering this exact pose via __ssQAPose on the cycle-2 dist).
    pose={x:-62.48,z:-41.69,yaw:0.9509,pitch:-0.0855,height:2.4};
   }else if(name==='fire'){
    const camp=CAMPS[0];pose=look(camp.x-5,1.7,camp.z+8,camp.x+2,1.0,camp.z+3);
   }else if(name==='camp'){
    const camp=CAMPS[0];pose=look(camp.x+11,2.4,camp.z+15,camp.x,1.1,camp.z+2);
   }else if(name==='courtyard'){
    const keep=CASTLES[0];pose=look(keep.x,2.5,keep.z+22,keep.x,1.4,keep.z-1);
   }else if(name==='region-green'){
    const c=CASTLES[0];pose=look(c.x+14,3.2,c.z+34,c.x,2,c.z);
   }else if(name==='region-ashen'){
    const c=CASTLES.find(x=>x.region==='moor')??CASTLES[3];pose=look(c.x+14,3.2,c.z+34,c.x,2,c.z);
   }else if(name==='region-crown'){
    // Fully inside Frozen Crown (z < -455 so __ssRegionInfo reports crown, not the blend).
    const c=CASTLES.find(x=>x.region==='crown')??CASTLES[6];pose=look(c.x+28,3.6,c.z+18,c.x,2.4,c.z);
   }
   else if(name==='foliage'){
    pose=look(-58.4,2.1,-40.2,-57.3,1.6,-46.7);
   }else if(name==='corruption'){
    pose=look(NEST.x,2.2,NEST.z+7,NEST.x,1.6,NEST.z);
   }else if(name==='wind'){
    pose=look(10,2.1,20,0,.7,5);
   }else if(name==='landmark-green'){
    // ruins-builder/QA verified clear pose for village_house_ruin (56,-6), h≈6.2 + 8-stone circle r9.8.
    const c=this.landmarkCoords.green;pose=look(c.x+13.2,2.8,c.z-15,c.x,3.0,c.z);
   }else if(name==='landmark-ashen'){
    // Straight-on over the region road to chapel_ruin (-36,-228), h≈10.
    const c=this.landmarkCoords.ashen;pose=look(c.x,3.2,c.z+38,c.x,5.0,c.z);
   }else if(name==='content-plague'){
    // Plague nest ritual area (nest at NEST); feather decals + dressing blend the ground.
    pose=look(NEST.x+14,2.8,NEST.z+20,NEST.x,2.0,NEST.z);
   }else if(name==='content-altar'){
    pose=look(-16,2.8,-224,-31,2.4,-226.5);
   }else if(name==='content-furnace-village'){
    pose=look(48,2.8,18,50,1.5,5);
   }else if(name==='content-furnace-camp'){
    pose=look(40,2.6,-44,32,1.5,-41);
   }else if(name==='landmark-crown'){
    // Fully inside Frozen Crown (cam z≈c.z+10 → crown weight dominates), looking up at the
    // watchtower_ruin (-34,-472) on its outcrop (top ≈11.8 m).
    const c=this.landmarkCoords.crown;pose=look(c.x+8,3.2,c.z+10,c.x,7.3,c.z);
   }
   if(!pose)return {ok:false,name:null,pose:null};
   this.qaView={name,x:pose.x,z:pose.z,yaw:pose.yaw,pitch:pose.pitch,height:pose.height};
   return {ok:true,name,region:this.regionAt(pose.z),pose:{x:pose.x,z:pose.z,yaw:pose.yaw,pitch:pose.pitch,height:pose.height}};
  }
  /** Frame the nearest/selected actor close-up for subsequent renders (debug/QA only). */
  characterPreview(actorId?:string|null){
   if(actorId===null){this.previewActorId=null;return {ok:true,actorId:null,name:null};}
   const game=this.lastGame;if(!game)return {ok:false,actorId:null,name:null};
   let actor=actorId?game.actors.find(a=>a.id===actorId):undefined;
   if(!actor&&!actorId&&this.lastMeId)actor=game.actors.find(a=>a.id===this.lastMeId);
   if(!actor){
    let best=Infinity;
    for(const a of game.actors){
     const d=(a.x-this.camera.position.x)*(a.x-this.camera.position.x)+(a.z-this.camera.position.z)*(a.z-this.camera.position.z);
     if(d<best){best=d;actor=a;}
    }
   }
   if(!actor)return {ok:false,actorId:null,name:null};
   this.previewActorId=actor.id;
   return {ok:true,actorId:actor.id,name:actor.name??actor.id};
  }
  /** Apply a graphics tier at runtime (persisted in localStorage 'ss-quality'). */
  setQuality(tier:string,explicit=false){
   const next=tier as QualityTier;if(!(next in QUALITY_TIERS))return false;
   if(explicit)this.explicitQualityAt=performance.now();
   this.quality=next;this.characterClothWind=next!=='low';try{setCharacterWindQuality(next);}catch{}
   try{localStorage.setItem('ss-quality',next);}catch{}
   const cap=QUALITY_TIERS[next];
   const dprCap=Math.min(cap.dpr,this.deviceProfile.maxDpr);
   this.renderer.setPixelRatio(Math.min(devicePixelRatio,dprCap));
   this.postfx?.setQuality(dprCap,cap.bloom);
   this.torchLightCount=cap.lights;
   for(let i=0;i<this.lightPool.length;i++){const light=this.lightPool[i];light.visible=i<cap.lights;if(!light.visible)light.intensity=0;}
   this.fx.setQuality(cap.particles);
   this.renderer.shadowMap.enabled=cap.shadow>0;
   if(cap.shadow>0&&this.moon.shadow.mapSize.x!==cap.shadow){this.moon.shadow.mapSize.set(cap.shadow,cap.shadow);this.moon.shadow.map?.dispose();this.moon.shadow.map=null;}
   this.renderer.shadowMap.needsUpdate=true;
   this.resize();
   return true;
  }
  /** Batch 10D: keep shadows only where they read at night (actors + merged architecture). */
  private trimShadowCasters(){
   // AAA cycle 1: curated shadows. Casters: merged architecture (castles/keeps/walls/towers/
   // gatehouses), player/enemy actors, and the 12 ruin set pieces. Foliage, tents, stone walls,
   // grass, flames, particles and small furniture are receive-only to stay inside the triangle budget.
   const ruinLayer = /(ruin|tent|wall)/i;
   this.scene.traverse(o=>{
    if(o instanceof THREE.Mesh&&/^tents:/i.test(o.name)){
     const mats=Array.isArray(o.material)?o.material:[o.material];
     for(const m of mats){const std=m as THREE.MeshStandardMaterial;if(std.isMeshStandardMaterial&&!std.userData.ssTentTone){std.userData.ssTentTone=true;std.color.multiplyScalar(.78);std.roughness=Math.min(1,std.roughness+.15);std.envMapIntensity=Math.min(std.envMapIntensity??1,.35);}}
    }
    if(o instanceof THREE.SkinnedMesh){
     let root:THREE.Object3D|null=o.parent,isActor=false;
     while(root){if(root.userData.actorRig===true){isActor=true;break;}root=root.parent;}
     o.castShadow=isActor;o.receiveShadow=true;return;
    }
    if(o instanceof THREE.Mesh||o instanceof THREE.InstancedMesh){
     const name=o.name||'';
     const isRuin=ruinLayer.test(name)&&!name.startsWith('rack');
     o.castShadow=o.userData.architecture===true||isRuin;
     o.receiveShadow=true;
    }
   });
   this.renderer.shadowMap.needsUpdate=true;
  }
  /** window.__ssPerf(): renderer info + scene counts + rolling frame pacing + quality tier. */
  perfStats(){
   const info=this.renderer.info;let objects=0,meshes=0,lights=0,skinned=0;const materials=new Set<THREE.Material>();
   this.scene.traverse(o=>{objects++;if(o instanceof THREE.Mesh){meshes++;if(o instanceof THREE.SkinnedMesh)skinned++;for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}else if(o instanceof THREE.Light)lights++;else if(o instanceof THREE.Points||o instanceof THREE.Sprite||o instanceof THREE.Line)meshes++;});
   let sum=0;for(let i=0;i<this.frameCount;i++)sum+=this.frameTimes[i];const frameMs=this.frameCount?sum/this.frameCount:0;
   return {calls:info.render.calls,triangles:info.render.triangles,software:this.softwareRenderer,weather:{region:this.weatherRegion,phase:this.weatherStates[this.weatherRegion].name,intensity:+this.weatherStates[this.weatherRegion].intensity.toFixed(3)},contentFocus:this.qaView?{name:this.qaView.name,x:this.qaView.x,z:this.qaView.z}:null,points:info.render.points,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length??0,objects,meshes,materials:materials.size,lights,skinned,landscape:this.scene.userData.landscapeDebug??null,quality:this.quality,pixelRatio:this.postfx?.pixelRatio??1,fps:frameMs>0?1000/frameMs:0,frameMs};
  }
  private installPerfHooks(){
   const view=this;const win=window as unknown as {__ssPerf?:()=>unknown;__ssCharacterPreview?:(actorId?:string|null)=>{ok:boolean;actorId:string|null;name:string|null};__ssQAView?:(name?:string|null)=>{ok:boolean;name:string|null;pose:unknown};__ssRegionInfo?:()=>unknown;__ssSetLandmark?:(region:'green'|'ashen'|'crown',x:number|null,z?:number)=>unknown;__ssWeather?:()=>unknown;__ssSetWeather?:(region?:'march'|'moor'|'crown'|null,phase?:string|null,intensity?:number|null)=>unknown;__ssWeatherForce?:(region?:'march'|'moor'|'crown'|null,phase?:string|null,intensity?:number|null)=>unknown;__ssLoadTimings?:()=>unknown;__ssPreviewBody?:(name?:string|null,distance?:number|{distance?:number})=>unknown;__ssCombatFx?:()=>unknown;__ssCharacterFx?:()=>({quality:string;clothWind:boolean});__ssEnemyVariants?:()=>unknown;__ssClearWeather?:()=>unknown;__ssSetReducedMotion?:(value?:boolean|null)=>unknown;__ssSurfaceAt?:(x:number,z:number)=>unknown;__ssDeviceProfile?:()=>unknown;__ssPreviewEnemy?:(appearance?:string|null,distance?:number|{distance?:number})=>unknown;__ssEliteUndeadIds?:()=>string[];__ssEliteUndeadInfo?:()=>{id:string;name:string;tier:number}[];__ssQAPose?:(pose?:{x:number;z:number;yaw:number;pitch:number;height:number}|null)=>{ok:boolean;name:string|null;pose:unknown};__ssQuality?:(tier?:string)=>{tier:string;applied?:boolean}};
   win.__ssPerf=()=>view.perfStats();
   win.__ssCharacterPreview=(actorId?:string|null)=>{return view.characterPreview(actorId===undefined?undefined:actorId);};
   win.__ssQAView=(name?:string|null)=>{return view.qaViewpoint(name===undefined?null:name);};
   win.__ssQAPose=(pose?:{x:number;z:number;yaw:number;pitch:number;height:number}|null)=>{return view.qaViewpoint(pose?'custom':null,pose??undefined);};
   win.__ssRegionInfo=()=>view.regionInfo();
   win.__ssEliteUndeadIds=()=>view.eliteUndeadIds();
   win.__ssWeather=()=>view.weatherInfo();
   win.__ssSetWeather=(region?:'march'|'moor'|'crown'|null,phase?:string|null,intensity?:number|null)=>view.setWeatherForce(region===undefined?null:region,phase,intensity);
   win.__ssWeatherForce=(region?:'march'|'moor'|'crown'|null,phase?:string|null,intensity?:number|null)=>view.setWeatherForce(region===undefined?null:region,phase,intensity);
   win.__ssLoadTimings=()=>view.loadTimings();
   win.__ssPreviewBody=(name?:string|null,distance?:number|{distance?:number})=>{const d=typeof distance==='number'?distance:(distance?.distance??10);return view.previewBody(name===undefined?null:name,d);};
   win.__ssCombatFx=()=>view.combatFx();
   win.__ssCharacterFx=()=>({quality:view.quality,clothWind:view.characterClothWind});
   win.__ssEnemyVariants=()=>view.enemyVariants();
   win.__ssClearWeather=()=>view.clearWeather();
   win.__ssSetReducedMotion=(value?:boolean|null)=>view.setReducedMotion(value===undefined?null:value);
   win.__ssSurfaceAt=(x:number,z:number)=>view.surfaceAt(x,z);
   win.__ssDeviceProfile=()=>view.deviceInfo();
   win.__ssPreviewEnemy=(appearance?:string|null,distance?:number|{distance?:number})=>{const d=typeof distance==='number'?distance:(distance?.distance??10);return view.previewEnemy(appearance===undefined?null:appearance,d);};
   win.__ssEliteUndeadInfo=()=>view.eliteUndeadInfo();
   win.__ssSetLandmark=(region:'green'|'ashen'|'crown',x:number|null,z?:number)=>view.setLandmarkCoords(region,x,z);
   win.__ssQuality=(tier?:string)=>{if(typeof tier==='string'&&tier)return {tier:view.quality,applied:view.setQuality(tier,true)};return {tier:view.quality};};
   // Device-aware quality: touch/tablet defaults medium, small screens/low-memory default low.
   // An explicit saved ss-quality always wins (never overridden); DPR is clamped on touch/small.
   const coarse=typeof matchMedia!=='undefined'&&matchMedia('(pointer: coarse)').matches;
   const touch=(navigator.maxTouchPoints??0)>0||('ontouchstart' in window)||coarse;
   const smallScreen=innerWidth<820||(touch&&Math.min(innerWidth,innerHeight)<820);
   const memory=(navigator as unknown as {deviceMemory?:number}).deviceMemory??null;
   const cores=navigator.hardwareConcurrency??0;
   const lowMemory=(memory!==null&&memory<=2)||(cores>0&&cores<=2);
   const suggested:QualityTier=this.softwareRenderer?'low':smallScreen||lowMemory?'low':touch?'medium':'high';
   const saved=(()=>{try{const v=localStorage.getItem('ss-quality');return v==='low'||v==='medium'||v==='high'?v as QualityTier:null;}catch{return null;}})();
   const initial:QualityTier=saved??suggested;
   this.deviceProfile={touch,coarse,smallScreen,memory,cores,suggestedQuality:suggested,maxDpr:touch||smallScreen?(initial==='low'?1.25:1.5):2};
   this.setQuality(initial);
   this.setQuality(initial);
  }
  resize(){this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.postfx?.setSize(innerWidth,innerHeight);}
  /** Pooled weather particles: rain streaks, ground splashes and moor haze banks. */
  private initWeather(){
   const rainGeo=new THREE.PlaneGeometry(.035,.7);
   this.rainMesh=new THREE.InstancedMesh(rainGeo,new THREE.MeshBasicMaterial({color:0xbfd6e8,transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending}),460);
   this.rainMesh.frustumCulled=false;this.rainMesh.castShadow=false;this.rainMesh.count=0;this.scene.add(this.rainMesh);
   this.rainData=new Float32Array(460*4);
   for(let i=0;i<460;i++){this.rainData[i*4]=Math.random()*36-18;this.rainData[i*4+1]=Math.random()*16;this.rainData[i*4+2]=Math.random()*36-18;this.rainData[i*4+3]=14+Math.random()*8;}
   const splashGeo=new THREE.RingGeometry(.16,.26,12);splashGeo.rotateX(-Math.PI/2);
   this.splashMesh=new THREE.InstancedMesh(splashGeo,new THREE.MeshBasicMaterial({color:0xa9c4d6,transparent:true,opacity:.4,depthWrite:false,blending:THREE.AdditiveBlending}),90);
   this.splashMesh.frustumCulled=false;this.splashMesh.castShadow=false;this.splashMesh.count=0;this.scene.add(this.splashMesh);
   this.splashData=new Float32Array(90*3);
   // Soft radial haze card for moor smoke banks.
   const hc=document.createElement('canvas');hc.width=hc.height=128;const hctx=hc.getContext('2d')!;const hg=hctx.createRadialGradient(64,64,4,64,64,64);hg.addColorStop(0,'rgba(190,185,175,0.5)');hg.addColorStop(.55,'rgba(150,145,135,0.18)');hg.addColorStop(1,'rgba(120,115,110,0)');hctx.fillStyle=hg;hctx.fillRect(0,0,128,128);
   const hazeTex=new THREE.CanvasTexture(hc);hazeTex.colorSpace=THREE.SRGBColorSpace;
   this.hazeMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:hazeTex,transparent:true,opacity:.14,depthWrite:false,blending:THREE.AdditiveBlending}),14);
   this.hazeMesh.frustumCulled=false;this.hazeMesh.castShadow=false;this.hazeMesh.count=0;this.scene.add(this.hazeMesh);
   this.hazeData=new Float32Array(14*3);
   for(let i=0;i<14;i++){this.hazeData[i*3]=Math.random()*40-20;this.hazeData[i*3+1]=.6+Math.random()*1.6;this.hazeData[i*3+2]=90+Math.random()*40;}
   if(this.roadMesh){const m=this.roadMesh.material as THREE.MeshStandardMaterial;if(m.isMeshStandardMaterial)this.roadWet={roughness:m.roughness,envMapIntensity:m.envMapIntensity??1,metalness:m.metalness??0};}
   // Dense snowstorm flakes (separate from the sparse snow pool): larger, gust-driven billboards.
   const sc=document.createElement('canvas');sc.width=sc.height=64;const sctx=sc.getContext('2d')!;const sg=sctx.createRadialGradient(32,32,2,32,32,32);sg.addColorStop(0,'rgba(255,255,255,1)');sg.addColorStop(.45,'rgba(235,245,255,0.65)');sg.addColorStop(1,'rgba(210,230,255,0)');sctx.fillStyle=sg;sctx.fillRect(0,0,64,64);
   const snowTex=new THREE.CanvasTexture(sc);snowTex.colorSpace=THREE.SRGBColorSpace;
   this.stormSnow=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:snowTex,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending,color:0xe8f2ff}),this.stormCap);
   this.stormSnow.frustumCulled=false;this.stormSnow.castShadow=false;this.stormSnow.count=0;this.scene.add(this.stormSnow);
   this.stormData=new Float32Array(this.stormCap*4);
   for(let i=0;i<this.stormCap;i++){this.stormData[i*4]=Math.random()*60-30;this.stormData[i*4+1]=Math.random()*18;this.stormData[i*4+2]=Math.random()*60-30;this.stormData[i*4+3]=1.1+Math.random()*1.9;}
   // Directional damage vignette (CSS only; one DOM node, no per-frame allocations).
   try{const el=document.createElement('div');el.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9998;opacity:0;transition:none;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 42%, rgba(168,26,38,0.55) 100%);';document.body.appendChild(el);this.vignetteEl=el;}catch{}
   try{const mq=window.matchMedia('(prefers-reduced-motion: reduce)');this.reducedMotion=mq.matches;const onChange=(e:MediaQueryListEvent)=>{this.reducedMotion=e.matches;};if(mq.addEventListener)mq.addEventListener('change',onChange);else (mq as unknown as {addListener?:(f:(e:MediaQueryListEvent)=>void)=>void}).addListener?.(onChange);}catch{}
  }
  private weatherScale(){return this.quality==='low'?0:this.quality==='medium'?0.55:1;}
  /** Advance regional weather phases, drive pooled particles + wet sheen + lightning. */
  private updateWeather(dt:number,time:number,focusX:number,focusZ:number){
   const region:WeatherRegion=focusZ<-405?'crown':focusZ<-165?'moor':'march';
   if(region!==this.weatherRegion){this.weatherRegion=region;this.announceWeather();}
   const force=this.weatherForce;
   for(const id of ['march','moor','crown'] as WeatherRegion[]){
    const st=this.weatherStates[id];
    if(force&&force.region===id){st.name=force.phase;st.intensity=force.intensity;st.target=force.intensity;st.t=0;st.next=999999;continue;}
    st.t+=dt;
    if(st.t>=st.next){const list=WEATHER_PHASES[id];st.phase=(st.phase+1)%list.length;st.name=list[st.phase].name;st.target=list[st.phase].target;st.t=0;st.next=180+Math.random()*150;if(id===this.weatherRegion)this.announceWeather();}
    st.intensity+=(st.target-st.intensity)*(1-Math.exp(-dt*0.55));
   }
   const st=this.weatherStates[region];
   const intensity=st.intensity, scale=this.weatherScale();
   // Lightning (Green March rain phases): meter a flash counter + delayed thunder cue.
   if(region==='march'&&/rain|shower|downpour/i.test(st.name)&&intensity>.45&&!force&&Math.random()<dt*0.022){
    this.weatherFlash=1;this.weatherFlashCount++;
    window.dispatchEvent(new CustomEvent('ss-lightning',{detail:{region,intensity,count:this.weatherFlashCount}}));
    const delay=1200+Math.random()*1400;
    setTimeout(()=>{window.dispatchEvent(new CustomEvent('ss-thunder',{detail:{region,intensity,delay}}));},delay);
   }
   this.weatherFlash=Math.max(0,this.weatherFlash-dt*2.2);
   // Fog density contribution by region/weather (crown storm closes visibility).
   // Whiteout: whiteout scales harder than light snow in the crown (density feeds region fog).
   this.weatherFogAdd=(region==='crown'?0.0018+0.0125*intensity:region==='moor'?0.0022*intensity:0.0012*intensity);
   const gustTarget=region==='moor'?1+intensity*1.45:region==='crown'?1+intensity*1.25:1+intensity*0.45;
   this.gustValue+=(gustTarget-this.gustValue)*(1-Math.exp(-dt*0.8));
   if(this.gustValue>1.55&&time-this.lastGustPeakAt>4){this.lastGustPeakAt=time;this.gustCount++;}
   this.landscapeWindSet?.(this.gustValue);
   const q=this.camera.getWorldQuaternion(this.rainQuat);
   // Rain streaks (march only; low tier almost none).
   if(this.rainMesh&&this.rainData){
    const cap=this.rainData.length/4, active=region==='march'?Math.min(cap,Math.floor(cap*intensity*scale)):0;
    if(active>0){
     const d=this.rainData;this.rainQuat.copy(q);
     for(let i=0;i<cap;i++){const b=i*4;d[b+1]-=d[b+3]*dt;d[b]+=dt*1.4;if(d[b+1]<0){d[b]=focusX+Math.random()*44-22;d[b+1]=14+Math.random()*5;d[b+2]=focusZ+Math.random()*44-22;}if(Math.abs(d[b]-focusX)>26||Math.abs(d[b+2]-focusZ)>26){d[b]=focusX+Math.random()*44-22;d[b+2]=focusZ+Math.random()*44-22;}if(i<active){this.rainDummy.position.set(d[b],d[b+1],d[b+2]);this.rainDummy.quaternion.copy(this.rainQuat);this.rainDummy.rotation.z=-.12;this.rainDummy.scale.set(1,1,1);this.rainDummy.updateMatrix();this.rainMesh.setMatrixAt(i,this.rainDummy.matrix);}}
     this.rainMesh.count=active;this.rainMesh.instanceMatrix.needsUpdate=true;
    }else this.rainMesh.count=0;
   }
   // Road splashes (spawn at ground near player; short additively-fading rings).
   if(this.splashMesh&&this.splashData&&region==='march'&&intensity>.28){
    const d=this.splashData,cap=d.length/3,rate=dt*(6+20*intensity)*Math.max(scale,.05);
    for(let n=0;n<rate;n++){let slot=-1;for(let i=0;i<cap;i++)if(d[i*3+2]<=0){slot=i;break;}if(slot<0)break;d[slot*3]=focusX+Math.random()*34-17;d[slot*3+1]=0.03;d[slot*3+2]=.32+Math.random()*.2;}
    for(let i=0;i<cap;i++){const life=d[i*3+2];if(life<=0)continue;d[i*3+2]=life-dt;const s=Math.max(0.01,(.32-life)*2.2);this.rainDummy.position.set(d[i*3],d[i*3+1],d[i*3]);this.rainDummy.quaternion.identity();this.rainDummy.scale.set(s,s,s);this.rainDummy.updateMatrix();this.splashMesh.setMatrixAt(i,this.rainDummy.matrix);}
    this.splashMesh.count=cap;this.splashMesh.instanceMatrix.needsUpdate=true;
   }else if(this.splashMesh)this.splashMesh.count=0;
   // Moor smoke haze banks + ash / crown snowstorm particles via the pooled flake system.
   if(this.hazeMesh&&this.hazeData){
    const active=region==='moor'?Math.min(14,Math.floor(14*intensity*scale)):0;
    if(active>0){const d=this.hazeData;for(let i=0;i<active;i++){const b=i*3;d[b]+=dt*.35;if(d[b]>24)d[b]-=48;this.rainDummy.position.set(focusX+d[b],d[b+1],focusZ+d[b+2]);this.rainDummy.position.z=focusZ+((d[b+2]+time*2)%48)-24;this.rainDummy.quaternion.copy(this.rainQuat);this.rainDummy.scale.set(9+d[b]*.15,3.2,1);this.rainDummy.updateMatrix();this.hazeMesh.setMatrixAt(i,this.rainDummy.matrix);}this.hazeMesh.count=active;this.hazeMesh.instanceMatrix.needsUpdate=true;}
    else this.hazeMesh.count=0;
   }
   if(region==='moor'&&intensity>.25){
    if(this.weatherScale()>0&&Math.random()<dt*(3+8*intensity)*this.weatherScale()){this.tmpV.set(focusX+Math.random()*36-18,2+Math.random()*3,focusZ+Math.random()*36-18);this.fx.flake(this.tmpV,.62,.58,.55,1.1);}
    if(this.weatherScale()>0&&Math.random()<dt*(1.2+2*intensity)*this.weatherScale()){this.tmpV.set(focusX+Math.random()*20-10,.6+Math.random()*1.2,focusZ+Math.random()*20-10);this.fx.embers(this.tmpV,1);}
   }
   // Frozen Crown: dense billboard snow (snow vs snowstorm differ in count + flake size + drift).
   if(region==='crown'&&this.stormSnow&&this.stormData){
    const cap=this.stormData.length/4,active=Math.min(cap,Math.floor(cap*intensity*scale));
    if(active>0){
     const d=this.stormData,flake=.10+.10*intensity,drift=(this.gustValue-1)*2.2*intensity;
     for(let i=0;i<cap;i++){const b=i*4;d[b+1]-=d[b+3]*dt;d[b]+=(drift+Math.sin(time*1.7+i*.37)*.25)*dt;d[b+2]+=Math.cos(time*1.1+i*.53)*.2*dt;
      if(d[b+1]<0){d[b]=focusX+Math.random()*44-22;d[b+1]=16+Math.random()*4;d[b+2]=focusZ+Math.random()*44-22;}
      if(Math.abs(d[b]-focusX)>26||Math.abs(d[b+2]-focusZ)>26){d[b]=focusX+Math.random()*44-22;d[b+2]=focusZ+Math.random()*44-22;}
      if(i<active){this.rainDummy.position.set(d[b],d[b+1],d[b+2]);this.rainDummy.quaternion.copy(this.rainQuat);this.rainDummy.scale.set(flake*(.7+((i%7)/10)),flake*(.7+((i%5)/10)),1);this.rainDummy.updateMatrix();this.stormSnow.setMatrixAt(i,this.rainDummy.matrix);}}
     this.stormSnow.count=active;this.stormSnow.instanceMatrix.needsUpdate=true;
    }else this.stormSnow.count=0;
   }else if(this.stormSnow)this.stormSnow.count=0;
   // Ground frost tint on the region slabs (cheap material colour lerp, no extra draws).
   if(!this.groundFrost.length){this.scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.surface==='ground'){const m=o.material as THREE.MeshStandardMaterial;if(m.isMeshStandardMaterial)this.groundFrost.push({m,base:m.color.clone()});}});}
   if(this.groundFrost.length){const k=1-Math.exp(-dt*1.4);const frost=region==='crown'?intensity*.55:0;this.tmpColor.setHex(0xcfe0ea);for(const g of this.groundFrost){g.m.color.lerp(this.tmpColor2.copy(g.base).lerp(this.tmpColor,frost),k);}}
   // Wet-road sheen: rain lowers roughness / lifts reflections, then dries out.
   if(this.roadMesh){const m=this.roadMesh.material as THREE.MeshStandardMaterial;if(m.isMeshStandardMaterial){const wet=region==='march'?intensity:0;const k=1-Math.exp(-dt*1.2);m.roughness+=(this.roadWet.roughness-wet*.42-m.roughness)*k;m.envMapIntensity+=((this.roadWet.envMapIntensity??1)+wet*.7-m.envMapIntensity)*k;m.metalness+=((this.roadWet.metalness??0)+wet*.06-m.metalness)*k;}}
  }
  private announceWeather(){
   const st=this.weatherStates[this.weatherRegion];
   try{window.dispatchEvent(new CustomEvent('ss-weather',{detail:this.weatherInfo()}));}catch{}
   void st;
  }
  /** window.__ssWeather(): current region weather state for audio/QA. */
  weatherInfo(){
   const st=this.weatherStates[this.weatherRegion];
   return {region:this.weatherRegion,phase:st.name,intensity:+st.intensity.toFixed(3),nextChangeAt:Date.now()+Math.max(0,(st.next-st.t))*1000,nextChangeIn:+Math.max(0,st.next-st.t).toFixed(1),flash:this.weatherFlashCount,flashing:this.weatherFlash>0.01,activeParticles:{rain:this.rainMesh?.count??0,splash:this.splashMesh?.count??0,haze:this.hazeMesh?.count??0,snow:this.stormSnow?.count??0},gust:+this.gustValue.toFixed(3),gusts:this.gustCount,qualityScale:this.weatherScale()};
  }
  /** window.__ssSetWeather(region, phase, intensity): deterministic QA forcing; null restores. */
  setWeatherForce(region:WeatherRegion|null,phase?:string|null,intensity?:number|null){
   if(region===null||region===undefined){this.weatherForce=null;return {ok:true,cleared:true,weather:this.weatherInfo()};}
   const list=WEATHER_PHASES[region];const target=(phase&&list.find(p=>p.name===phase))||list[list.length-1];
   const value=typeof intensity==='number'?Math.max(0,Math.min(1,intensity)):target.target;
   this.weatherForce={region,phase:target.name,intensity:value};
   this.weatherRegion=region;this.announceWeather();
   return {ok:true,weather:this.weatherInfo()};
  }
  /** window.__ssSurfaceAt(x,z): walkable surface id for footstep/audio heuristics. */
  surfaceAt(x:number,z:number):'stone'|'grass'|'snow'|'ash'|'wood'{
   for(const c of CASTLES){if(Math.hypot(x-c.x,z-c.z)<9.6)return 'stone';}
   for(const c of CAMPS){if(Math.hypot(x-c.x,z-c.z)<7)return 'wood';}
   for(const s of [[48,4],[32,-37]] as const){if(Math.hypot(x-s[0],z-s[1])<6)return 'wood';}
   // Same route polyline as the merged road mesh.
   const route=[START,...REGIONS.flatMap(r=>[{x:0,z:r.offset+12},{x:0,z:r.offset+24},{x:42,z:r.offset-45},{x:42,z:r.offset-55},{x:42,z:r.offset-43},{x:-24,z:r.offset-113},{x:-24,z:r.offset-123},{x:-24,z:r.offset-112},{x:0,z:r.offset-200}]),NEST];
   for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];const dx=b.x-a.x,dz=b.z-a.z;const len2=dx*dx+dz*dz||1;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2));const px=a.x+dx*t,pz=a.z+dz*t;if(Math.hypot(x-px,z-pz)<2.4)return 'stone';}
   return z<-405?'snow':z<-165?'ash':'grass';
  }
  /** window.__ssEnemyVariants(): undead variant mapping + asset availability for QA. */
  enemyVariants(){
   const mapping:{[variant:string]:string}={'zombie-bloated':'zombie','skeleton-armoured':'skeleton-soldier'};
   const variants:{[name:string]:{asset:string;available:boolean;fallback:string}}={};
   for(const [variant,fallback] of Object.entries(mapping)){
    variants[variant]={asset:variant,available:this.characterAssets.custom.has(variant),fallback};
   }
   return {mapping,rule:'undead id%4: 0 zombie, 1 skeleton-soldier, 2 zombie-bloated, 3 skeleton-armoured',variants,base:{zombie:this.characterAssets.custom.has('zombie'),'skeleton-soldier':this.characterAssets.custom.has('skeleton-soldier')}};
  }
  /** window.__ssDeviceProfile(): detected device class + quality defaults for QA/mobile checks. */
  deviceInfo(){
   return {touch:this.deviceProfile.touch,coarse:this.deviceProfile.coarse,smallScreen:this.deviceProfile.smallScreen,dpr:+devicePixelRatio.toFixed(3),maxDpr:this.deviceProfile.maxDpr,memory:this.deviceProfile.memory,cores:this.deviceProfile.cores,suggestedQuality:this.deviceProfile.suggestedQuality,appliedQuality:this.quality,software:this.softwareRenderer};
  }
  /** window.__ssPreviewEnemy(appearance,distance): frame an undead rig in an open spot in front of camera. */
  async previewEnemy(appearance:string|null,distance=10){
   const allowed=['zombie','skeleton-soldier','zombie-bloated','skeleton-armoured'];
   if(appearance!==null&&!allowed.includes(appearance))return {ok:false,appearance,distance,ready:false,reason:'unsupported-appearance',allowed};
   if(this.qaBody){this.scene.remove(this.qaBody);this.qaBody.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.sharedAsset)o.geometry.dispose();});this.qaBody=null;this.qaBodyRig=null;this.qaBodyActor=null;}
   if(appearance===null)return {ok:true,appearance:null,distance:0,ready:true,actorId:null};
   let source=this.characterAssets.custom.get(appearance);
   if(!source){try{source=await loadAsset('custom/'+appearance);this.characterAssets.custom.set(appearance,source);}catch{}}
   const fallback={'zombie-bloated':'zombie','skeleton-armoured':'skeleton-soldier'}[appearance];
   if(!source&&fallback)source=this.characterAssets.custom.get(fallback);
   if(!source)return {ok:false,appearance,distance,ready:false,reason:'asset-unavailable',actorId:null};
   // Encode the variant index in the id (undeadVariant uses id%4) and route through CharacterAssets so
   // the rig registers with the character rig registry (QA can then __ssTriggerEnemyHit(actorId)).
   const idx={'zombie':0,'skeleton-soldier':1,'zombie-bloated':2,'skeleton-armoured':3}[appearance]??0;
   const actor={id:'qa-preview-'+idx,kind:'zombie',hp:100,maxHp:100,attackSerial:0,weapon:'sword',appearance} as unknown as Actor;
   const created=this.characterAssets.create(actor);
   const rig=created??customCharacter(source,actor,this.characterAssets.custom);
   const group=new THREE.Group();group.add(rig.model);this.scene.add(group);
   group.traverse(o=>{if(o instanceof THREE.Mesh){o.frustumCulled=false;o.visible=true;}});
   group.updateMatrixWorld(true);
   this.qaBody=group;this.qaBodyRig=rig;this.qaBodyActor=actor;this.qaBodyDistance=Math.max(2,Math.min(30,distance));
   return {ok:true,appearance,distance:this.qaBodyDistance,ready:true,actorId:actor.id};
  }
  /** window.__ssClearWeather(): deterministic clear-weather state for QA night captures. */
  clearWeather(){
   const region=this.weatherRegion;const list=WEATHER_PHASES[region];const target=list[0];
   this.weatherForce={region,phase:target.name,intensity:0};
   const st=this.weatherStates[region];st.name=target.name;st.intensity=0;st.target=0;st.t=0;st.next=999999;
   this.weatherFogAdd=0;this.weatherFlash=0;
   // Zero pooled particles immediately so a forced-clear capture is deterministic on the next frame.
   if(this.rainMesh)this.rainMesh.count=0;if(this.splashMesh)this.splashMesh.count=0;if(this.hazeMesh)this.hazeMesh.count=0;if(this.stormSnow)this.stormSnow.count=0;
   this.announceWeather();
   return {ok:true,weather:this.weatherInfo()};
  }
  /** window.__ssLoadTimings(): performance marks for HUD/state attribution. */
  loadTimings(){
   let marks:{name:string;at:number;ms:number}[]=[];
   try{marks=performance.getEntriesByType('mark').filter(e=>e.name.startsWith('ss:')).map(e=>({name:e.name,at:+e.startTime.toFixed(1),ms:+e.startTime.toFixed(1)}));}catch{}
   const get=(n:string)=>marks.find(m=>m.name===n)?.ms??null;
   return {marks,summary:{sceneConstruct:get('ss:sceneConstructStart'),coreReady:get('ss:coreReady')??get('ss:coreReady'),firstGameFrame:get('ss:firstGameFrame'),earlyCompileEnd:get('ss:earlyCompileEnd'),compileEnd:get('ss:compileEnd')},software:this.softwareRenderer,quality:this.quality};
  }
  /** window.__ssPreviewBody(name,distance): build an armour-v2 rig for QA close-ups/silhouettes. */
  async previewBody(name:string|null,distance=10){
   if(this.qaBody){this.scene.remove(this.qaBody);this.qaBody.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.sharedAsset){o.geometry.dispose();}});this.qaBody=null;this.qaBodyRig=null;this.qaBodyActor=null;}
   if(name===null)return {ok:true,character:null,distance:0};
   let source=this.characterAssets.custom.get(name);
   if(!source){try{source=await loadAsset('custom/'+name);this.characterAssets.custom.set(name,source);}catch{}}
   if(!source)return {ok:false,character:name,distance,reason:'asset-unavailable'};
   const actor={id:'qa-preview-body',kind:'soldier',hp:100,maxHp:100,attackSerial:0,weapon:'sword',appearance:name} as unknown as Actor;
   const rig=customCharacter(source,actor,this.characterAssets.custom);
   const group=new THREE.Group();group.add(rig.model);this.scene.add(group);
   // Preview meshes must never be frustum-culled by stale skinned bounds; force visible.
   group.traverse(o=>{if(o instanceof THREE.Mesh){o.frustumCulled=false;o.visible=true;}});
   group.updateMatrixWorld(true);
   this.qaBody=group;this.qaBodyRig=rig;this.qaBodyActor=actor;this.qaBodyDistance=Math.max(2,Math.min(30,distance));
   return {ok:true,character:name,distance:this.qaBodyDistance,ready:true};
  }
  /** Heavy attack feedback: brief hit-stop, camera kick and a subtle FOV punch. */
  private onHeavyAttack(profile:{weight:number}){
   const now=performance.now();this.lastHeavyAt=now;this.heavyCount++;
   const w=Math.max(0.8,Math.min(1.6,profile.weight));
   const reduced=this.reducedMotionOverride??this.reducedMotion;
   // Persistent last-event magnitudes so QA can sample after the 20-60ms transient has decayed.
   if(reduced){this.lastHitStopMs=0;this.lastKickMag=0;this.lastVignetteMag=0;this.lastKickAt=0;this.lastVignetteAt=0;return;}
   this.hitStop=Math.max(this.hitStop,0.045+w*0.016);this.lastHitStopMs=this.hitStop*1000;
   this.kickPitch=Math.min(.12,(0.035+w*.028));
   this.kickRoll=(Math.random()-.5)*.05*w;
   this.fovPunch=-1.1*w;
   this.lastKickAt=now;this.lastKickMag=Math.hypot(this.kickPitch,this.kickRoll);
   // Subtle forward swing vignette so heavy attacks read even without taking a hit.
   this.vignetteDirX=0;this.vignetteDirY=0;this.vignetteLife=.16;this.vignetteOpacity=.32;
   this.lastVignetteAt=now;this.lastVignetteMag=.32;
   if(this.vignetteEl){this.vignetteEl.style.background='radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 55%, rgba(175,28,40,0.32) 100%)';}
  }
  /** Damage feedback: directional red vignette + stronger kick/shake + hit-stop. */
  private onPlayerDamaged(g:Game,me:Actor){
   const now=performance.now();this.lastHitAt=now;this.damageCount++;
   const reduced=this.reducedMotionOverride??this.reducedMotion;
   if(reduced){this.lastHitStopMs=0;this.lastKickMag=0;this.lastVignetteMag=0;this.lastKickAt=0;this.lastVignetteAt=0;return;}
   this.hitStop=Math.max(this.hitStop,0.06);this.lastHitStopMs=this.hitStop*1000;
   this.shake=Math.min(.9,this.shake+.32);
   this.kickPitch=Math.min(.16,.07);
   this.kickRoll=(Math.random()-.5)*.09;
   this.fovPunch=-1.8;
   // Direction to the nearest hostile in camera space -> vignette hot edge on the hit side.
   let best:number=Infinity,bx=0,bz=0;
   for(const a of g.actors){if(a.hp<=0)continue;if(a.kind==='player'||a.kind==='soldier')continue;const dx=a.x-me.x,dz=a.z-me.z,d2=dx*dx+dz*dz;if(d2<best){best=d2;bx=dx;bz=dz;}}
   const len=Math.hypot(bx,bz)||1;const camYaw=this.camera.rotation.y;
   const wx=bx/len,wz=bz/len;const cos=Math.cos(-camYaw),sin=Math.sin(-camYaw);
   const sx=wx*cos-wz*sin,sz=wx*sin+wz*cos;
   this.vignetteDirX=sx;this.vignetteDirY=-sz;
   this.vignetteLife=.42;this.vignetteOpacity=.85;this.lastVignetteAt=now;this.lastVignetteMag=.85;this.lastKickAt=now;this.lastKickMag=Math.hypot(this.kickPitch,this.kickRoll);
   if(this.vignetteEl)this.vignetteEl.style.background=`radial-gradient(circle at ${(50+sx*46).toFixed(1)}% ${(50-sz*46).toFixed(1)}%, rgba(0,0,0,0) 38%, rgba(175,28,40,0.62) 100%)`;
  }
  /** Per-frame camera fx (decayed); allocation-free. */
  private applyCombatCamera(dt:number){
   const reduced=this.reducedMotionOverride??this.reducedMotion;
   if(reduced){
    // Reduced motion: no residual vignette/kick/hit-stop, even if the preference flips mid-effect.
    this.hitStop=0;this.visualScale=1;this.kickPitch=0;this.kickRoll=0;this.fovPunch=0;
    this.vignetteLife=0;this.vignetteOpacity=0;
    if(this.vignetteEl){this.vignetteEl.style.opacity='0';}
    if(Math.abs(this.camera.fov-68)>.02){this.camera.fov=68;this.camera.updateProjectionMatrix();}
    return;
   }
   if(this.hitStop>0)this.hitStop=Math.max(0,this.hitStop-dt);
   this.visualScale=this.hitStop>0?0.22:1;
   if(!reduced){
    this.camera.rotation.x+=this.kickPitch;
    this.camera.rotation.z+=this.kickRoll;
   }
   const k=1-Math.exp(-dt*8.5);
   this.kickPitch+=(0-this.kickPitch)*k;this.kickRoll+=(0-this.kickRoll)*k;
   this.fovPunch+=(0-this.fovPunch)*k*1.15;
   const targetFov=68+this.fovPunch;
   if(Math.abs(this.camera.fov-targetFov)>.02){this.camera.fov=targetFov;this.camera.updateProjectionMatrix();}
   if(this.vignetteLife>0){this.vignetteLife=Math.max(0,this.vignetteLife-dt);this.vignetteOpacity=Math.max(0,this.vignetteLife/.42)*.85;if(this.vignetteEl)this.vignetteEl.style.opacity=String(this.vignetteOpacity);}
  }
  /** window.__ssCombatFx(): QA-readable combat-feel state (read-only). */
  combatFx(){
   const now=performance.now();
   const recentHeavy=now-this.lastHeavyAt<1000,recentHit=now-this.lastHitAt<1000;
   const hitStopMs=this.hitStop>0?this.hitStop*1000:(recentHeavy||recentHit?this.lastHitStopMs:0);
   const kickMag=this.hitStop>0||recentHeavy||recentHit?this.lastKickMag:0;
   const vig=this.vignetteOpacity>0?this.vignetteOpacity:(recentHeavy||recentHit?this.lastVignetteMag:0);
   return {reducedMotion:this.reducedMotionOverride??this.reducedMotion,hitStopMs:+hitStopMs.toFixed(1),hitStopActive:this.hitStop>0,kick:{x:+this.kickPitch.toFixed(4),y:+this.kickRoll.toFixed(4),magnitude:+kickMag.toFixed(4)},shake:+this.shake.toFixed(3),fov:+this.camera.fov.toFixed(2),vignette:{opacity:+vig.toFixed(3),direction:{x:+this.vignetteDirX.toFixed(3),y:+this.vignetteDirY.toFixed(3)}},lastHeavyAt:+this.lastHeavyAt.toFixed(0),lastHitAt:+this.lastHitAt.toFixed(0),heavyCount:this.heavyCount,damageCount:this.damageCount,lastHitStopMs:+this.lastHitStopMs.toFixed(1)};
  }
  /** window.__ssSetReducedMotion(bool|null): QA override for the reduced-motion path. */
  setReducedMotion(value:boolean|null){this.reducedMotionOverride=value;const reduced=this.reducedMotionOverride??this.reducedMotion;try{setHitFeedbackReducedMotion(reduced);}catch{}if(reduced){this.hitStop=0;this.visualScale=1;this.kickPitch=0;this.kickRoll=0;this.fovPunch=0;this.vignetteLife=0;this.vignetteOpacity=0;if(this.vignetteEl)this.vignetteEl.style.opacity='0';}return {reducedMotion:reduced};}
  fire(x:number,z:number,isCamp=false){
   // Flames are drawn from 3 instanced cone meshes; only the data + pooled torch source are kept.
   this.flames.push({x,z,isCamp,seed:Math.random()*20});
   this.torchSources.push({x,y:isCamp?1.2:2.2,z,color:0xff9d42,intensity:isCamp?8:12,distance:isCamp?10:14,seed:Math.random()*20});
  }
  private updateTorchLights(focusX:number,focusZ:number,time:number){
   const sources=this.torchSources,pool=this.lightPool;if(!pool.length||!sources.length)return;
   const max=Math.min(pool.length,sources.length),idx=this.nearestIdx,d2s=this.nearestD2;
   for(let i=0;i<max;i++){idx[i]=-1;d2s[i]=Infinity;}
   for(let s=0;s<sources.length;s++){
    if(s===this.nestTorch&&!this.nest.visible)continue;
    const src=sources[s],dx=src.x-focusX,dz=src.z-focusZ,d2=dx*dx+dz*dz;
    if(d2>=d2s[max-1])continue;
    let j=max-1;while(j>0&&d2s[j-1]>d2){d2s[j]=d2s[j-1];idx[j]=idx[j-1];j--;}
    d2s[j]=d2;idx[j]=s;
   }
   for(let i=0;i<pool.length;i++){
    const light=pool[i];
    const source=i<max&&idx[i]>=0?sources[idx[i]]:undefined;
    if(!source){light.intensity=0;continue;}
    const flicker=0.86+Math.sin(time*10+source.seed)*0.14+Math.sin(time*24+source.seed*2.7)*0.07;
    light.position.set(source.x,source.y,source.z);light.color.setHex(source.color);light.distance=source.distance;light.intensity=source.intensity*Math.max(0.2,flicker);
   }
  }
  /** Region fog/light grading, moonlight follow + pooled torch flicker. */
  private atmosphere(me:Actor|undefined,time:number,dt:number){
   const qa=this.qaView;
   const focusX=qa?qa.x:(me?.x??this.camera.position.x),focusZ=qa?qa.z:(me?.z??this.camera.position.z);
   if(this.landscapeUpdate)this.landscapeUpdate(time,this.qaView?this.qaView.x:focusX,this.qaView?this.qaView.z:focusZ);
   const march=smoothstep(-245,-165,focusZ),crown=1-smoothstep(-485,-405,focusZ),moor=Math.max(0,1-march-crown);
   const corruption=1-smoothstep(20,95,dist({x:focusX,z:focusZ},NEST));
   this.regionWeights.march=march;this.regionWeights.moor=moor;this.regionWeights.crown=crown;this.regionWeights.corruption=corruption;
   // Regional identity: Green March = deep green-teal clear night, Ashen Moor = grey-violet ash
   // haze, Frozen Crown = cold blue-white clarity. All targets blend smoothly by the weights above.
   this.fogTarget.setHex(0x162126);
   this.fogTarget.lerp(this.tmpColor.setHex(0x1e4038),march);
   this.fogTarget.lerp(this.tmpColor.setHex(0x342d42),moor);
   this.fogTarget.lerp(this.tmpColor.setHex(0x6f93b0),crown);
   this.fogTarget.lerp(this.tmpColor.setHex(0x3a1a2e),corruption*0.45);
   const targetDensity=0.0122*march+0.0208*moor+0.0172*crown+corruption*0.003+this.weatherFogAdd;
   const colorBlend=1-Math.exp(-Math.max(0,dt)*1.6);
   this.fogCurrent.lerp(this.fogTarget,colorBlend);this.fog.color.copy(this.fogCurrent);
   this.fog.density+=(targetDensity-this.fog.density)*(1-Math.exp(-Math.max(0,dt)*1.1));
   // Moon tint + strength and hemisphere sky/ground tint per region.
   this.tmpColor2.setHex(0xd2ecdf).lerp(this.tmpColor3.setHex(0xd9cde9),moor).lerp(this.tmpColor3.setHex(0xcfe6ff),crown);
   this.moon.color.lerp(this.tmpColor2,1-Math.exp(-Math.max(0,dt)*1.4));
   this.moon.intensity=2.7*march+2.1*moor+2.55*crown+0.0001;
   this.tmpColor2.setHex(0xa9d6c6).lerp(this.tmpColor3.setHex(0xaaa2c8),moor).lerp(this.tmpColor3.setHex(0xc3dcf2),crown);
   this.hemi.color.lerp(this.tmpColor2,1-Math.exp(-Math.max(0,dt)*1.2));
   this.tmpColor2.setHex(0x2b3b34).lerp(this.tmpColor3.setHex(0x38323f),moor).lerp(this.tmpColor3.setHex(0x2c3a46),crown);
   this.hemi.groundColor.lerp(this.tmpColor2,1-Math.exp(-Math.max(0,dt)*1.2));
   this.hemi.intensity=(4.7*march+4.0*moor+4.5*crown)+this.weatherFlash*1.9;
   this.tmpColor2.setHex(0x2a4b40).lerp(this.tmpColor3.setHex(0x3a3446),moor).lerp(this.tmpColor3.setHex(0x334a5c),crown);
   this.ambient.color.lerp(this.tmpColor2,1-Math.exp(-Math.max(0,dt)*1.2));
   this.ambient.intensity=0.55*march+0.5*moor+0.6*crown;
   // Exposure + saturation grade (one cheap postfx pass): crisp March, flatter/desaturated Moor,
   // cooler high-contrast Crown.
   // Keep Night night at every tier: low tier loses bloom/shadow contrast on software renderers,
   // so pull exposure down slightly instead of letting the whole frame read daylight-flat.
   const tierExposureBias=this.quality==='low'?-0.09:this.quality==='medium'?-0.03:0;
   this.exposureTarget=1.55*march+1.37*moor+1.62*crown+tierExposureBias;
   this.renderer.toneMappingExposure+=(this.exposureTarget-this.renderer.toneMappingExposure)*(1-Math.exp(-Math.max(0,dt)*1.0));
   if(this.weatherFlash>0)this.renderer.toneMappingExposure+=this.weatherFlash*.16;
   const grade=1-Math.exp(-Math.max(0,dt)*1.2);
   this.tmpColor2.setRGB(1.03,1.05,1.0);this.tmpColor3.setRGB(0.94,0.9,1.05);
   const tintR=1.03*march+0.94*moor+0.97*crown, tintG=1.05*march+0.9*moor+1.0*crown, tintB=1.0*march+1.05*moor+1.08*crown;
   this.tmpColor.setRGB(tintR,tintG,tintB);
   this.lastSaturation=1.05*march+0.82*moor+1.12*crown;
   this.lastSkyTint.copy(this.tmpColor2);
   this.lastMoonTint.copy(this.moon.color);this.lastAmbientTint.copy(this.ambient.color);
   this.tmpV2.set(this.tmpColor.r,this.tmpColor.g,this.tmpColor.b);
   this.postfx?.setGrade(1.05*march+0.82*moor+1.12*crown, this.tmpV2);
   // Sky tint: dome/stars/moon disc follow the region palette (kept close to white so stars stay).
   const parts=this.sky.userData.parts as {dome?:THREE.Mesh;halo?:THREE.Mesh;outerHalo?:THREE.Mesh;stars?:THREE.Points;moonDisc?:THREE.Mesh}|undefined;
   if(parts){
    this.tmpColor2.setRGB(0.82,1.0,0.9).lerp(this.tmpColor3.setRGB(0.9,0.84,1.0),moor).lerp(this.tmpColor3.setRGB(0.82,0.92,1.08),crown);
    if(parts.dome){const m=parts.dome.material as THREE.MeshBasicMaterial;m.color.lerp(this.tmpColor2,grade);}
    if(parts.stars){const m=parts.stars.material as THREE.PointsMaterial;m.color.lerp(this.tmpColor2,grade);}
    if(parts.halo){const m=parts.halo.material as THREE.MeshBasicMaterial;m.color.lerp(this.tmpColor2,grade);}
    if(parts.outerHalo){const m=parts.outerHalo.material as THREE.MeshBasicMaterial;m.color.lerp(this.tmpColor2,grade);}
    if(parts.moonDisc){const m=parts.moonDisc.material as THREE.MeshBasicMaterial;m.color.lerp(this.tmpColor2,grade);}
    this.lastSkyTint.copy(this.tmpColor2);
   }
   this.sky.position.set(this.camera.position.x,0,this.camera.position.z);
   // Soft viewer-side directional fill: same direction for the whole scene, so no local
   // ground hotspot, but actors/edges facing the camera catch the light at any distance.
   this.camera.getWorldDirection(this.tmpV);
   this.fill.position.set(this.camera.position.x,this.camera.position.y+2.5,this.camera.position.z);
   this.fill.target.position.set(this.camera.position.x+this.tmpV.x*24,this.camera.position.y+this.tmpV.y*24,this.camera.position.z+this.tmpV.z*24);
   this.fill.intensity=0.7+moor*0.15+crown*0.25;
   this.moon.position.set(focusX-42,64,focusZ-30);this.moon.target.position.set(focusX,0,focusZ);
   this.updateTorchLights(focusX,focusZ,time);
  }
  /** Embers drift off nearby fires; pooled particles must keep streaming. */
  private updateEffects(dt:number,time:number,me:Actor|undefined){
   this.fx.update(dt);
   const focusX=me?.x??this.camera.position.x,focusZ=me?.z??this.camera.position.z;
   // Atmosphere: torch smoke wisps + drifting ash close to fires, moon-dust motes around the camera.
   const localDt=Math.max(0,dt);
   for(let i=0;i<this.torchSources.length;i++){
    if(i===this.nestTorch)continue;
    const src=this.torchSources[i],dx=src.x-focusX,dz=src.z-focusZ;
    if(dx*dx+dz*dz>400)continue;
    if(Math.random()<localDt*1.05){this.tmpV.set(src.x+(Math.random()-.5)*.3,src.y+0.85,src.z+(Math.random()-.5)*.3);this.fx.smoke(this.tmpV);}
    if(Math.random()<localDt*0.4){this.tmpV.set(src.x+(Math.random()-.5)*.6,src.y+0.4,src.z+(Math.random()-.5)*.6);this.fx.ash(this.tmpV);}
   }
   if(Math.random()<localDt*2.4){
    const angle=Math.random()*Math.PI*2,radius=4+Math.random()*10;
    this.tmpV.set(focusX+Math.cos(angle)*radius,0.6+Math.random()*2.6,focusZ+Math.sin(angle)*radius);
    this.fx.motes(this.tmpV);
   }
   // Frozen Crown snow + Ashen Moor ash drift (pooled, tier-scaled).
   const crownRate=this.regionWeights.crown;
   if(crownRate>0.02&&Math.random()<localDt*(2.2+crownRate*6)){
    this.tmpV.set(focusX,2.5+Math.random()*2,focusZ);
    this.fx.flake(this.tmpV,0.86,0.92,1.0,1.0+crownRate*0.5);
   }
   if(this.regionWeights.moor>0.05&&Math.random()<localDt*1.6){
    this.tmpV.set(focusX,1.6+Math.random()*1.6,focusZ);
    this.fx.flake(this.tmpV,0.62,0.58,0.56,0.8);
   }
   let budget=4;
   for(let i=0;i<this.torchSources.length&&budget>0;i++){
    if(i===this.nestTorch)continue;
    const src=this.torchSources[i],dx=src.x-focusX,dz=src.z-focusZ;
    if(dx*dx+dz*dz>484)continue;
    if(Math.random()<Math.max(0,dt)*1.6){this.tmpV.set(src.x,src.y,src.z);this.fx.embers(this.tmpV,1);budget--;}
   }
  }
  castle(c:{id:string;x:number;z:number;region:string}){
   // Courtyard slabs merge into one cobble-tagged mesh after all nine castles are built.
   const courtGeo=boxGeometry(20,.08,20).clone();courtGeo.translate(c.x,.035,c.z);this.courtyardGeos.push(courtGeo);
   for(const w of walls(c)){
    this.queueBox(w.x,2,w.z,w.w,4,w.d,palette.dark,true);
    const collider=new THREE.Mesh(boxGeometry(w.w,4,w.d),mat(palette.dark));collider.position.set(w.x,2,w.z);collider.visible=false;this.scene.add(collider);this.solid.push(collider);
    const count=Math.floor(Math.max(w.w,w.d)/1.5);
    for(let n=0;n<count;n++)this.queueBox(w.x+(w.w>w.d?(n-(count-1)/2)*1.5:0),4.5,w.z+(w.d>w.w?(n-(count-1)/2)*1.5:0),w.w>w.d?.7:1.5,1,w.d>w.w?.7:1.5,palette.dark,false);
   }
   for(const dx of [-10,10])for(const dz of [-10,10]){
    const tColor=c.id.includes('citadel')?0x3a5862:c.id.includes('border')?0x384550:0x2c2235;
    this.queueBox(c.x+dx,3,c.z+dz,3.5,6,3.5,tColor,false,this.legacyTowerGroup);
    const capColor=c.id.includes('citadel')?0x2d7080:c.id.includes('border')?palette.iron:0x3d2a45;
    for(const sx of [-1,1])for(const sz of [-1,1])this.queueBox(c.x+dx+sx*1.2,6.5,c.z+dz+sz*1.2,.8,1,.8,capColor,false,this.legacyTowerGroup);
    const collider=new THREE.Mesh(boxGeometry(3.5,7.5,3.5),mat(palette.dark));collider.position.set(c.x+dx,3.75,c.z+dz);collider.visible=false;this.scene.add(collider);this.solid.push(collider);
    this.towerSlots.push({decor:new THREE.Group(),x:c.x+dx,z:c.z+dz,castleId:c.id});
   }
   const stages:THREE.Group[]=[];
   for(let tier=0;tier<2;tier++){
    const detail=new THREE.Group();detail.position.set(c.x,0,c.z);detail.visible=false;this.scene.add(detail);stages.push(detail);
    for(const side of [-1,1]){box(detail,side*7,1.5,-5+tier*5,2,3,2,tier?0x466e75:palette.wood,true);box(detail,side*7,3.2,-5+tier*5,2.5,.4,2.5,palette.gold);box(detail,side*9,4.1,0,.15,1.8,4,tier?palette.gold:0x468f87);}
    const crest=this.label(tier?'CITADEL':'BASTION');crest.position.set(0,6+tier*1.4,-1);detail.add(crest);
    this.mergeGroupStatic(detail,true,true);
   }
   this.upgrades.set(c.id,stages);
   // Banner is the functional keep/capture point; rear architecture stays behind it.
   this.queueBox(c.x,.2,c.z,3,.4,3,0x858a7b,true);this.queueBox(c.x,2.6,c.z,.16,5.2,.16,palette.wood,true);
   const flagGeo=new THREE.PlaneGeometry(1.8,1.4,8,4);flagGeo.translate(.9,0,0);
   const flag=new THREE.Mesh(flagGeo,new THREE.MeshStandardMaterial({color:0x9a4d47,side:THREE.DoubleSide,roughness:.8}));flag.position.set(c.x,4.3,c.z);flag.castShadow=true;this.scene.add(flag);this.flags.set(c.id,flag);this.flagMeshes.push({mesh:flag,seed:this.flagMeshes.length*1.7});
   const keep=new THREE.Group();keep.position.set(c.x-5,0,c.z-6);const isCitadel=c.id.includes('citadel'),isBorder=c.id.includes('border');const kWall=isCitadel?0x3d5560:isBorder?0x404d57:0x2d2433;const kAccent=isCitadel?0x2d6e75:isBorder?0x526070:0x3d2d3a;box(keep,0,2.2,0,4,4.4,4,kWall,true);box(keep,0,4.7,0,4.6,.6,4.6,kAccent);if(isCitadel){box(keep,0,5.5,0,2,.5,2,0x4a8a95);box(keep,0,6.2,0,.3,1.2,.3,palette.gold);}if(isBorder){box(keep,2.2,4.3,0,.3,2.5,.3,palette.iron);box(keep,-2.2,4.3,0,.3,2.5,.3,palette.iron);}if(!isCitadel&&!isBorder){box(keep,0,5,0,4.5,.15,4.5,0x2a1f30);box(keep,0,3,1.5,.3,1.5,.3,0x4a3a55);}this.scene.add(keep);this.keeps.set(c.id,keep);this.mergeGroupStatic(keep,true,true);
   this.fire(c.x-3.6,c.z+11);this.fire(c.x+3.6,c.z+11);
   const gateParent=new THREE.Group();gateParent.position.set(c.x,2,c.z+10);box(gateParent,0,0,0,5.5,4,.35,palette.wood,true);this.scene.add(gateParent);this.gates.set(c.id,gateParent as unknown as THREE.Mesh);gateParent.visible=false;
   const barrier=new THREE.Group();barrier.position.set(c.x,0,c.z+13);for(let i=-2;i<=2;i++){const b=box(barrier,i,.7,0,.25,1.7,.3,palette.wood);b.rotation.x=-.35;}box(barrier,0,.8,0,5,.2,.2,palette.wood);this.scene.add(barrier);this.barriers.set(c.id,barrier);barrier.visible=false;this.mergeGroupStatic(barrier,false,true);
  }
  knight(a:Actor){const root=new THREE.Group();const evil=a.kind==='zombie'||a.kind==='corrupted';const color=a.kind==='zombie'?0x849077:a.kind==='corrupted'?0x403e51:a.kind==='soldier'?0x7f8a78:0x98a9b4;
   const tell=new THREE.Mesh(new THREE.RingGeometry(.65,.78,24),new THREE.MeshBasicMaterial({color:0xff7553,side:THREE.DoubleSide,transparent:true,opacity:.8}));tell.rotation.x=-Math.PI/2;tell.position.y=.06;tell.name='tell';root.add(tell);
   const marker=new THREE.Mesh(new THREE.OctahedronGeometry(.13),new THREE.MeshBasicMaterial({color:evil?0xe05750:0x83d4a5}));marker.position.y=2.45;marker.name='marker';root.add(marker);
   const hp=box(root,0,2.1,0,.9,.065,.06,evil?0xd78067:0xb8c18b);hp.name='hp';root.position.set(a.x,0,a.z);this.scene.add(root);this.actors.set(a.id,root);return root;
  }
  draw(g:Game|undefined,me:Actor|undefined,yaw:number,pitch:number,first:boolean,dt:number,time:number){
   this.lastGame=g;this.lastMeId=me?.id??this.lastMeId;
   // Batch-3 perf: rolling frame pacing + adaptive tier downgrade on sustained low fps.
   this.frameTimes[this.frameIdx]=Math.max(0,Math.min(2000,dt*1000));this.frameIdx=(this.frameIdx+1)%60;if(this.frameCount<60)this.frameCount++;
   if(dt>0.028)this.slowQualityAccum+=dt;else this.slowQualityAccum=Math.max(0,this.slowQualityAccum-dt*0.5);
   if(this.slowQualityAccum>8&&this.quality!=='low'&&performance.now()-this.explicitQualityAt>30000){this.slowQualityAccum=0;this.setQuality(this.quality==='high'?'medium':'low');}
   this.renderer.info.reset();
   // Heavy-hit hit-stop: briefly slow visual simulation (input/network time untouched).
   this.visualScale=this.hitStop>0?0.22:1;
   if(time-this.shadowTrimAt>1.5&&time<40){this.shadowTrimAt=time;this.trimShadowCasters();}
   for(const {rig,actor,camp} of this.campRigs)if(camp.visible)rig.update(actor,false,dt*this.visualScale);
   const focusX=this.qaView?this.qaView.x:(me?.x??this.camera.position.x),focusZ=this.qaView?this.qaView.z:(me?.z??this.camera.position.z);
   this.updateWeather(dt,time,focusX,focusZ);
   this.atmosphere(me,time,dt);
   // Billboarded additive flame cards (soft tongue + hot core) + a soft smoke puff card above;
   // per-fire variation, same three draw calls as the old flat cones.
   let flameCount=0;
   this.camera.getWorldQuaternion(this.camQuat);
   for(let fi=0;fi<this.flames.length;fi++){
    const f=this.flames[fi];const fdx=f.x-focusX,fdz=f.z-focusZ;if(fdx*fdx+fdz*fdz>=3600)continue;
    const wobble=Math.sin(time*11+f.seed)*.14+Math.sin(time*27+f.seed*2)*.07;
    const variation=.85+Math.sin(f.seed*3.1)*.18;
    const by=f.isCamp?.25:1.15;
    this.flameDummy.quaternion.copy(this.camQuat);
    this.flameDummy.position.set(f.x,by,f.z);this.flameDummy.scale.set((.85+wobble*.6)*variation,1.35*((.85+wobble*.4)*variation),1);this.flameDummy.updateMatrix();this.flameOuter.setMatrixAt(flameCount,this.flameDummy.matrix);
    this.flameDummy.position.set(f.x,by+.18+Math.sin(time*9+f.seed)*.05,f.z);this.flameDummy.scale.set(.36,.72,1);this.flameDummy.updateMatrix();this.flameCore.setMatrixAt(flameCount,this.flameDummy.matrix);
    this.flameDummy.position.set(f.x,by+.95+Math.sin(time*2.2+f.seed)*.12,f.z);this.flameDummy.scale.set(1.15,1.6,1);this.flameDummy.updateMatrix();this.flameEmber.setMatrixAt(flameCount,this.flameDummy.matrix);
    flameCount++;
   }
   this.flameCore.count=flameCount;this.flameOuter.count=flameCount;this.flameEmber.count=flameCount;if(flameCount){this.flameCore.instanceMatrix.needsUpdate=true;this.flameOuter.instanceMatrix.needsUpdate=true;this.flameEmber.instanceMatrix.needsUpdate=true;}
   if(this.corruptionMat)this.corruptionMat.opacity=.42+Math.sin(time*.8)*.07;
   if(this.corruptionDecals){const fx=this.qaView?this.qaView.x:(me?.x??this.camera.position.x),fz=this.qaView?this.qaView.z:(me?.z??this.camera.position.z);this.corruptionDecals.visible=dist({x:fx,z:fz},NEST)<160;}
   for(const f of this.flagMeshes){const pos=f.mesh.geometry.attributes.position;for(let i=0;i<pos.count;i++){const px=pos.getX(i);pos.setZ(i,Math.sin(time*5.5+px*3+f.seed)*(px/1.8)*.22);}pos.needsUpdate=true;}
   this.updateEffects(dt*this.visualScale,time,me);
   if(this.ruinsUpdate){
    // Content QA views: dressing/ruins are culled around the player distance (85 m) in normal play,
    // so a synthetic focus at the QA camera is needed for altar/furnace/well captures. Allocation is
    // debug-only (only while window.__ssQAView is active).
    let ruinsFocus=me;
    if(this.qaView){const base=(me??{}) as Record<string,unknown>;ruinsFocus={...base,id:(base.id as string|undefined)??'qa-focus',x:this.qaView.x,z:this.qaView.z} as Actor;}
    this.ruinsUpdate(g,ruinsFocus,time);
   }
   if(!g){const t=time*.025;this.camera.position.set(31+Math.sin(t)*4,15,32);this.camera.lookAt(0,2,0);if(this.shake>0){
    this.camera.position.x+=(Math.random()-.5)*this.shake;
    this.camera.position.y+=(Math.random()-.5)*this.shake;
    this.camera.position.z+=(Math.random()-.5)*this.shake;
    this.shake=Math.max(0,this.shake-dt*2.5);
   }
   if(this.postfx)this.postfx.render();else this.renderer.render(this.scene,this.camera);return;}
   const alive=new Set(g.actors.map(a=>a.id));for(const [id,mesh] of this.actors)if(!alive.has(id)){this.animated.get(id)?.dispose();this.animated.delete(id);this.previousHp.delete(id);this.scene.remove(mesh);mesh.traverse(o=>{if(o instanceof THREE.Mesh&&!o.userData.sharedAsset)o.geometry.dispose();});this.actors.delete(id);}
   for(const a of g.actors){if(me&&a.id!==this.previewActorId&&dist(a,me)>55){const far=this.actors.get(a.id);if(far)far.visible=false;this.previousHp.set(a.id,a.hp);continue;}const mesh=this.actors.get(a.id)||this.knight(a);let rig=this.animated.get(a.id);if(rig&&(mesh.userData.weapon!==(a.weapon??'sword')||mesh.userData.appearance!==characterAsset(a))){mesh.remove(rig.model);rig.dispose();this.animated.delete(a.id);rig=undefined;}if(!rig){rig=this.characterAssets.create(a);if(rig){for(const child of mesh.children)if(!['hp','tell','marker'].includes(child.name))child.visible=false;rig.model.traverse(o=>o.userData.sharedAsset=true);boostActorMaterials(rig.model);rig.model.userData.actorRig=true;mesh.add(rig.model);this.animated.set(a.id,rig);mesh.userData.weapon=a.weapon??'sword';mesh.userData.appearance=characterAsset(a);}}
    const oldX=mesh.position.x,oldZ=mesh.position.z;
    if(a.id===me?.id){if(Math.hypot(oldX-a.x,oldZ-a.z)>10)mesh.position.set(a.x,0,a.z);else mesh.position.lerp(this.tmpV.set(a.x,0,a.z),1-Math.exp(-dt*16));}
    else{
     // 10 Hz authoritative snapshots -> interpolate remote actors ~120 ms in the past.
     let buf=mesh.userData.netBuf as {px:number;pz:number;pt:number;nx:number;nz:number;nt:number}|undefined;
     if(!buf){buf={px:a.x,pz:a.z,pt:time,nx:a.x,nz:a.z,nt:time};mesh.userData.netBuf=buf;}
     if(buf.nx!==a.x||buf.nz!==a.z){buf.px=buf.nx;buf.pz=buf.nz;buf.pt=buf.nt;buf.nx=a.x;buf.nz=a.z;buf.nt=time;}
     if(time-buf.nt>0.6)mesh.position.lerp(this.tmpV.set(a.x,0,a.z),1-Math.exp(-dt*8));
     else{const span=buf.nt-buf.pt;const t=span>0.001?Math.min(1,Math.max(0,(time-0.12-buf.pt)/span)):1;const rx=buf.px+(buf.nx-buf.px)*t,rz=buf.pz+(buf.nz-buf.pz)*t;if(Math.hypot(mesh.position.x-rx,mesh.position.z-rz)>10)mesh.position.set(rx,0,rz);else mesh.position.lerp(this.tmpV.set(rx,0,rz),1-Math.exp(-dt*25));}
    }
    mesh.rotation.y=-a.yaw;mesh.visible=a.id===this.previewActorId||(!(a.id===me?.id&&first)&&(!me||dist(a,me)<46));mesh.rotation.z=a.hp<=0&&!rig?Math.PI/2:0;
    mesh.getObjectByName('tell')!.visible=a.windup>0&&a.hp>0;mesh.getObjectByName('tell')!.scale.setScalar(1+a.windup);const moving=Math.abs(oldX-a.x)+Math.abs(oldZ-a.z)>.03;
    if(moving&&!me||moving&&dist(a,me!)<26){const speed=Math.hypot(oldX-a.x,oldZ-a.z)/Math.max(0.0001,dt);if(speed>4.2){const next=(mesh.userData.dustAt??0) as number;if(time>=next){mesh.userData.dustAt=time+0.18+Math.random()*0.14;this.fx.dust(this.tmpV2.set(a.x,0.05,a.z),Math.min(1,(speed-4)/5));}}}
    rig?.update(a,moving,dt*this.visualScale);if(rig)for(const fragment of rig.fragments.splice(0)){this.scene.add(fragment);this.debris.push({mesh:fragment,life:4,velocity:new THREE.Vector3(a.id.length%2?2:-2,3,1.2)});}mesh.position.y=0;const previous=this.previousHp.get(a.id);if(previous!==undefined&&a.hp<previous){this.spawnDamageLabel(String(Math.ceil(previous-a.hp)),a.kind==='player'?'#ff8d78':'#ffe1a0',a.x,2.6,a.z,1.5,.6,.8);
     const evil=a.kind==='zombie'||a.kind==='corrupted';
     this.tmpV.set(a.x,1.35,a.z);
      const feedback=hitFeedbackProfile(me?.weapon);const hotSpark=a.block?blockSparkColor():feedback.spark;const victimRig=this.animated.get(a.id);const reducedFx=this.reducedMotionOverride??this.reducedMotion;
      victimRig?.hit?.({weight:feedback.weight,durationMs:feedback.flashMs,stagger:feedback.stagger,flashColor:hitFlashColor(evil),reduced:reducedFx});
      this.fx.sparks(this.tmpV,evil?'undead':'metal',hotSpark);
     this.fx.blood(this.tmpV,evil,a.maxHp>=200?1.6:1);this.fx.splatter(this.tmpV2.set(a.x,0,a.z),evil,Math.min(2,0.6+(previous-a.hp)/40));
     if(previous>0&&a.hp<=0){
      const isBoss=a.name?.includes('Champion')||a.name?.includes('Fallen')||a.id==='boss-plague'||a.maxHp>=200;
      this.tmpV.set(a.x,1.1,a.z);
      this.fx.blood(this.tmpV,evil,isBoss?2:1.15);
      this.fx.dust(this.tmpV2.set(a.x,.08,a.z),isBoss?1:0.55);
      if(isBoss){
       const ring=new THREE.Mesh(new THREE.RingGeometry(.8,1.6,32),new THREE.MeshBasicMaterial({color:0xdf2055,side:THREE.DoubleSide}));
       ring.rotation.x=-Math.PI/2;ring.position.set(a.x,.25,a.z);this.scene.add(ring);
       this.debris.push({mesh:ring,life:.75,velocity:new THREE.Vector3(0,.5,0)});
       if(me&&dist(me,a)<40)this.shake=Math.min(1,this.shake+.45);
      }
     }
      if(a.id===me?.id){this.shake=Math.min(.35,this.shake+.2);this.onPlayerDamaged(g,me);}}
    mesh.getObjectByName('marker')!.visible=a.hp>0||!!a.downed;this.previousHp.set(a.id,a.hp);const bar=mesh.getObjectByName('hp')!;bar.scale.x=Math.max(.001,a.hp/a.maxHp);bar.visible=a.hp<a.maxHp&&a.hp>0;mesh.scale.setScalar(a.kind==='corrupted'?(a.maxHp>=200?1.4:1.15):1);
   }
   for(const effect of this.effects){effect.life-=dt;effect.mesh.position.y+=dt*1.5;effect.mesh.material.opacity=Math.max(0,effect.life/.8);if(effect.life<=0){if(effect.pooled){effect.mesh.visible=false;}else{this.scene.remove(effect.mesh);effect.mesh.material.map?.dispose();effect.mesh.material.dispose();}}}this.effects=this.effects.filter(e=>e.life>0);
   for(const item of this.debris){item.life-=dt;item.velocity.y-=9*dt;item.mesh.position.addScaledVector(item.velocity,dt);item.mesh.rotation.x+=dt*3;if(item.mesh.position.y<.12){item.mesh.position.y=.12;item.velocity.set(0,0,0);}if(item.life<=0){this.scene.remove(item.mesh);item.mesh.geometry.dispose();for(const m of Array.isArray(item.mesh.material)?item.mesh.material:[item.mesh.material])m.dispose();}}this.debris=this.debris.filter(d=>d.life>0);while(this.debris.length>48){const d=this.debris.shift()!;this.scene.remove(d.mesh);d.mesh.geometry.dispose();for(const m of Array.isArray(d.mesh.material)?d.mesh.material:[d.mesh.material])m.dispose();}
   const shots=new Set(g.shots.map(s=>s.id));for(const [id,m] of this.projectiles)if(!shots.has(id)){this.scene.remove(m);m.geometry.dispose();this.projectiles.delete(id);}for(const shot of g.shots){let m=this.projectiles.get(shot.id);if(!m){m=new THREE.Mesh(new THREE.SphereGeometry(.23,8,6),mat(0xe6bb79));this.scene.add(m);this.projectiles.set(shot.id,m);}const t=Math.max(0,Math.min(1,1-(shot.lands-g.time)/.7));m.position.set(shot.x+(shot.tx-shot.x)*t,2+Math.sin(t*Math.PI)*6,shot.z+(shot.tz-shot.z)*t);const gun=this.artillery.get(shot.castle);if(gun)gun.rotation.y=Math.atan2(shot.tx-shot.x,shot.tz-shot.z);}
   for(const c of g.castles){this.upgrades.get(c.id)!.forEach((group,i)=>group.visible=c.friendly&&c.level>i);(this.flags.get(c.id)!.material as THREE.MeshStandardMaterial).color.setHex(c.friendly?0x4ea88c:0x9a4d47);const gate=this.gates.get(c.id)!;gate.visible=c.friendly&&c.gate>0;const nearFriendly=g.actors.some(a=>(a.kind==='player'||a.kind==='soldier')&&a.hp>0&&dist(a,{x:c.x,z:c.z+10})<4);gate.scale.y=nearFriendly?.15:1;gate.position.y=nearFriendly?3.9:2;this.barriers.get(c.id)!.visible=c.barrier>0;}
   for(const c of g.camps){const mesh=this.campMeshes.get(c.id)!;mesh.visible=!c.rescued&&(!me||dist(c,me)<45);}
   for(const drop of g.weaponDrops){let rack=this.weaponRacks.get(drop.id);if(!rack){rack=new THREE.Group();rack.position.set(drop.x,0,drop.z);for(const x of [-.6,.6])box(rack,x,.7,0,.12,1.4,.12,palette.wood);box(rack,0,1,0,1.5,.1,.12,palette.wood);const sign=this.label(WEAPONS[drop.weapon].name.toUpperCase(),'#b8e1f0','#0d1a1e88');sign.position.set(0,2.2,0);sign.name='sign';sign.scale.set(1.8,.4,1);rack.add(sign);const ring=new THREE.Mesh(new THREE.RingGeometry(.8,.9,24),new THREE.MeshBasicMaterial({color:0x8ed2e5,side:THREE.DoubleSide,transparent:true,opacity:.7}));ring.rotation.x=-Math.PI/2;ring.position.y=.05;rack.add(ring);this.weaponRacks.set(drop.id,rack);this.scene.add(rack);}const source=this.characterAssets.custom.get(drop.weapon);if(source&&!rack.userData.loaded){const item=equipmentModel(source.scene,WEAPONS[drop.weapon].length,false,drop.weapon);item.position.y=.65;rack.add(item);rack.userData.loaded=true;}rack.visible=!drop.taken&&(!me||dist(drop,me)<35);const sign=rack.getObjectByName('sign') as THREE.Sprite|undefined;if(sign){const camDist=this.camera.position.distanceTo(rack.position);sign.visible=camDist>6;const signMaterial=sign.material as THREE.SpriteMaterial;signMaterial.opacity=Math.max(0,Math.min(1,(camDist-6)/4));}}
   for(const c of g.caches){let mesh=this.cacheMeshes.get(c.id);if(!mesh){mesh=new THREE.Group();mesh.position.set(c.x,0,c.z);box(mesh,0,.4,0,.8,.8,.7,0xb59151,true);box(mesh,0,.42,0,.85,.1,.75,0xd7b16e);this.cacheMeshes.set(c.id,mesh);this.scene.add(mesh);}if(this.customProps.has('supplies')&&!mesh.userData.custom){mesh.clear();const source=this.customProps.get('supplies')!;const o=source.clone(true);o.scale.setScalar(1/source.userData.height);mesh.add(o);mesh.userData.custom=true;}for(const [name,x] of [['iron',-.8],['medicine',.8]] as const){const source=this.customProps.get(name);if(source&&!mesh.getObjectByName('resource-'+name)){const o=source.clone(true);const b=new THREE.Box3().setFromObject(o),size=b.getSize(new THREE.Vector3());o.scale.setScalar(.45/Math.max(size.x,size.y,size.z));o.position.x=x;o.name='resource-'+name;mesh.add(o);}}mesh.visible=!c.taken&&(!me||dist(c,me)<46);}
   this.nest.visible=g.nest.hp>0;
   if(this.nest.children[8])this.nest.children[8].rotation.y=time*.5;
   if(g.nest.hp<this.previousNestHp){
    const loss=this.previousNestHp-g.nest.hp;
    this.previousNestHp=g.nest.hp;
    this.spawnDamageLabel(String(Math.ceil(loss)),'#ff4d88',NEST.x,4.2,NEST.z,2.2,.85,1.2);
    if(me&&dist(me,NEST)<35)this.shake=Math.min(.8,this.shake+.35);
    this.tmpV.set(NEST.x,2.2,NEST.z);this.fx.sparks(this.tmpV,'undead');this.fx.blood(this.tmpV,true,1.4);this.tmpV2.set(NEST.x,.1,NEST.z);this.fx.dust(this.tmpV2,0.8);
    const ring=new THREE.Mesh(new THREE.RingGeometry(1,1.5,32),new THREE.MeshBasicMaterial({color:0xd15b92,side:THREE.DoubleSide,transparent:true,opacity:.85}));
    ring.rotation.x=-Math.PI/2;ring.position.set(NEST.x,.3,NEST.z);
    this.scene.add(ring);this.debris.push({mesh:ring,life:.6,velocity:new THREE.Vector3(0,.4,0)});
   }
   if(me){const model=this.actors.get(me.id);const pos=model?.position??this.tmpV2.set(me.x,0,me.z);const target=this.camTarget.set(pos.x,1.55,pos.z);const forward=this.camForward.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
    if(first){this.camera.position.copy(target);this.camera.rotation.set(pitch,-yaw,0,'YXZ');}
    else{const desired=this.camDesired.copy(target).addScaledVector(forward,-6);desired.y+=2;const delta=this.camDelta.copy(desired).sub(target);this.camRay.set(target,delta.clone().normalize());this.camRay.far=delta.length();const hits=this.camRay.intersectObjects(this.solid,false);if(hits.length)desired.copy(target).addScaledVector(delta.normalize(),Math.max(.45,hits[0].distance-.3));this.camera.position.copy(desired);this.camera.lookAt(this.tmpV.copy(target).addScaledVector(forward,4));}
    const selected=me.weapon??'sword',stats=weaponStats(selected),source=this.characterAssets.custom.get(selected);const combatProfile=weaponCombatProfile(selected);if(this.lastHeavySerial!==(me.attackSerial??0)){this.lastHeavySerial=me.attackSerial??0;if(combatProfile.weight>0)this.onHeavyAttack(combatProfile);}if(source&&this.activeWeapon!==selected){this.weapon.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(this.activeWeapon)m.dispose();});this.weapon.clear();this.weapon.add(equipmentModel(source.scene,stats.length*.78,false,selected));this.weapon.traverse(o=>{o.castShadow=false;});this.activeWeapon=selected;if(this.trailSerial!==(me.attackSerial??0)){if(this.trailSerial>=0&&!first&&me.hp>0){const trailColor=weaponCombatProfile(selected).trail;this.tmpV2.set(me.x,0,me.z);this.fx.trail(this.tmpV2,me.yaw??yaw,stats.reach,trailColor[0],trailColor[1],trailColor[2]);}this.trailSerial=me.attackSerial??0;}}
    this.weapon.visible=first&&me.hp>0;this.shield.visible=first&&me.hp>0&&stats.shield;this.weapon.position.set(.32,-.4,-.78);this.weapon.rotation.set(me.block&&!stats.shield?-.5:.1,0,me.block&&!stats.shield?-1.1:-.2);if(this.fpSerial!==(me.attackSerial??0)){if(this.fpSerial>=0){this.fpDuration=stats.cooldown*.85;this.fpAttack=this.fpDuration;}this.fpSerial=me.attackSerial??0;}this.fpAttack=Math.max(0,this.fpAttack-dt);if(this.fpAttack>0){const t=1-this.fpAttack/this.fpDuration,arc=Math.sin(Math.PI*t),strike=Math.sin(Math.PI*Math.min(1,t*1.6)),style=swingStyle(selected);if(style==='thrust'){this.weapon.position.z-=strike*.6;this.weapon.position.y+=strike*.05;this.weapon.rotation.x-=strike*.18;this.weapon.rotation.z-=arc*.05;this.weapon.position.x+=arc*.05;}else if(style==='cleave'){this.weapon.rotation.z-=arc*1.9;this.weapon.rotation.x-=strike*.65;this.weapon.rotation.y+=arc*.35;this.weapon.position.x-=arc*.45;this.weapon.position.z-=strike*.18;}else if(style==='crush'){this.weapon.rotation.x-=strike*1.7;this.weapon.rotation.z+=arc*.35;this.weapon.position.y+=arc*.22-strike*.18;this.weapon.position.z-=strike*.24;this.weapon.position.x-=arc*.12;}else{this.weapon.rotation.z-=arc*2;this.weapon.rotation.y-=arc*.5;this.weapon.position.x-=arc*.5;this.weapon.position.z-=arc*.22;this.weapon.position.y+=strike*.08;}}this.shield.position.lerp(this.shieldTarget.set(me.block?-.12:-.38,me.block?-.12:-.38,-.82),1-Math.exp(-dt*16));
   }
   if(this.previewActorId){
    const previewMesh=this.actors.get(this.previewActorId);
    const previewActor=g?.actors.find(a=>a.id===this.previewActorId);
    if(previewMesh&&previewActor){
     const previewYaw=previewActor.yaw??0;
     let previewDist=2.8;
     this.camRay.set(this.camTarget.set(previewMesh.position.x,1.35,previewMesh.position.z),this.tmpV.set(Math.sin(previewYaw),0,-Math.cos(previewYaw)).normalize());
     this.camRay.far=2.8;
     const previewHits=this.camRay.intersectObjects(this.solid,false);
     if(previewHits.length)previewDist=Math.max(1.2,Math.min(2.8,previewHits[0].distance-0.3));
     this.camera.position.set(previewMesh.position.x+Math.sin(previewYaw)*previewDist,1.55,previewMesh.position.z-Math.cos(previewYaw)*previewDist);
     this.camera.lookAt(previewMesh.position.x,1.3,previewMesh.position.z);
     this.weapon.visible=false;this.shield.visible=false;
    }
   }
   if(this.qaView){
    this.camera.position.set(this.qaView.x,this.qaView.height,this.qaView.z);
    this.camera.rotation.set(this.qaView.pitch,-this.qaView.yaw,0,'YXZ');
    this.weapon.visible=false;this.shield.visible=false;
   }
   this.applyCombatCamera(dt);
   if(this.qaBody&&this.qaBodyActor){this.camera.getWorldQuaternion(this.rainQuat);this.tmpV2.set(0,0,-1).applyQuaternion(this.rainQuat);this.tmpV2.y=0;const flen=Math.hypot(this.tmpV2.x,this.tmpV2.z)||1;this.tmpV2.x/=flen;this.tmpV2.z/=flen;this.qaBody.position.set(this.camera.position.x+this.tmpV2.x*this.qaBodyDistance,0,this.camera.position.z+this.tmpV2.z*this.qaBodyDistance);this.qaBody.visible=true;this.qaBody.rotation.y=Math.atan2(this.camera.position.x-this.qaBody.position.x,this.camera.position.z-this.qaBody.position.z);this.qaBody.updateMatrixWorld(true);this.qaBodyRig?.update(this.qaBodyActor,false,dt*this.visualScale);}
   if(g&&!this.firstGameFrameMarked){this.firstGameFrameMarked=true;try{performance.mark('ss:firstGameFrame');}catch{}}
   if(this.postfx)this.postfx.render();else this.renderer.render(this.scene,this.camera);
  }
}