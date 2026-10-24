/**
 * Gamepad → action mapping plus the pure settings/accessibility helpers used by main.ts.
 * Kept dependency-free and deterministic so the tests can cover the mapping math directly.
 */

/** Deadzone presets for controller sticks (larger = ignores more stick drift). */
export const DEADZONE_PRESETS = {tight:0.1,normal:0.18,wide:0.28} as const;
export type DeadzonePreset = keyof typeof DEADZONE_PRESETS;
/** Resolve a persisted preset name to its threshold, falling back to the normal default. */
export function deadzoneValue(preset?:string|null):number{
 return preset && Object.hasOwn(DEADZONE_PRESETS,preset) ? DEADZONE_PRESETS[preset as DeadzonePreset] : DEADZONE_PRESETS.normal;
}
export function deadzone(n:number,threshold:number=DEADZONE_PRESETS.normal){return Math.abs(n)<threshold?0:Math.sign(n)*(Math.abs(n)-threshold)/(1-threshold);}
/**
 * Deterministic standard-mapping read. `deadzoneThreshold` defaults to the historical 0.18 so the
 * mapping is byte-identical unless the player picks a different deadzone preset.
 */
export function readPad(p:Pick<Gamepad,'axes'|'buttons'>,previous:boolean[]=[],deadzoneThreshold:number=DEADZONE_PRESETS.normal){
 const dz=(n:number)=>deadzone(n,deadzoneThreshold);
 const down=(i:number)=>!!p.buttons[i]?.pressed||((p.buttons[i]?.value??0)>.5);
 const pressed=(i:number)=>down(i)&&!previous[i];
 return {mx:dz(p.axes[0]??0),forward:-dz(p.axes[1]??0),lookX:dz(p.axes[2]??0),lookY:dz(p.axes[3]??0),attack:down(7)||down(5),block:down(6),interact:down(0),toggle:pressed(3),sweep:pressed(1),heal:pressed(2),menu:pressed(9),commands:[pressed(4)?'nextWeapon':'',pressed(12)?'follow':'',pressed(13)?'hold':'',pressed(15)?'attack':'',pressed(14)?'guard':''].filter(Boolean),previous:Array.from({length:17},(_,i)=>down(i))};
}

/* ---------------------------------------------------------------------------------------------
 * Touch controls: pure analog-stick mapping (radial deadzone + analog magnitude) and persisted
 * touch look-sensitivity parsing, unit-testable without a DOM.
 * ------------------------------------------------------------------------------------------- */
export const TOUCH_STICK_RADIUS=35;
export function touchStickVector(dx:number,dy:number,radius:number=TOUCH_STICK_RADIUS,deadzoneThreshold:number=DEADZONE_PRESETS.normal){
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(radius)||radius<=0)return {mx:0,forward:0,magnitude:0};
 const nx=dx/radius,ny=dy/radius,raw=Math.hypot(nx,ny),threshold=Math.max(0,Math.min(.9,deadzoneThreshold));
 if(raw<=threshold||raw<1e-9)return {mx:0,forward:0,magnitude:0};
 const magnitude=Math.min(1,(raw-threshold)/(1-threshold));
 return {mx:(nx/raw)*magnitude,forward:-(ny/raw)*magnitude,magnitude};
}
/** Clamp a persisted touch look-sensitivity value (0.4–2.0), falling back to 1. */
export function touchSensitivityValue(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>=.4&&n<=2?n:1;}

/* ---------------------------------------------------------------------------------------------
 * Accessibility captions (CC): pure text formatter + rate limiter. main.ts owns the HUD element,
 * persistence and gating; these helpers keep the behaviour unit-testable.
 * ------------------------------------------------------------------------------------------- */
export type CaptionCue='thunder'|'undead'|'siege-start'|'siege-end'|'low-health'|'castle-captured';
export const CAPTION_RATE_LIMIT_MS=2200;
export const CAPTION_MAX_CHARS=96;
/** Higher-priority cues may replace a different lower-priority cue after half the rate window. */
export const CAPTION_PRIORITY:Record<CaptionCue,number>={undead:1,thunder:3,'siege-end':3,'siege-start':4,'low-health':4,'castle-captured':5};
export function captionText(cue:CaptionCue,detail?:string):string{
 const base:Record<CaptionCue,string>={
  thunder:'Lightning. Thunder rolls in the distance.',
  undead:'Undead moan nearby.',
  'siege-start':'Siege warning. A castle is under attack.',
  'siege-end':'The siege is over.',
  'low-health':'Low health. Find cover or heal.',
  'castle-captured':'Castle captured.'
 };
 const text=detail&&(cue==='siege-start'||cue==='castle-captured')?`${base[cue]} ${detail}`:base[cue];
 return text.slice(0,CAPTION_MAX_CHARS);
}
/** Rate limit: one cue per window; a different higher-priority cue can interrupt after half. */
export function captionAllowed(now:number,lastAt:number,lastCue:CaptionCue|undefined,cue:CaptionCue,minInterval:number=CAPTION_RATE_LIMIT_MS):boolean{
 if(!Number.isFinite(now)||!Number.isFinite(lastAt)||now<0||lastAt<0)return true;
 const elapsed=now-lastAt;
 if(elapsed>=minInterval)return true;
 if(cue===lastCue)return false;
 return elapsed>=minInterval*.5&&CAPTION_PRIORITY[cue]>CAPTION_PRIORITY[lastCue??cue];
}

/* ---------------------------------------------------------------------------------------------
 * Campaign journal + next-objective derivation: pure helpers (main.ts renders; tests cover the
 * state→text logic). Inputs are minimal projections of the authoritative Game snapshot.
 * ------------------------------------------------------------------------------------------- */
export type ObjectivePoint={x:number;z:number};
export type ObjectiveKind='siege'|'reclaim'|'rescue'|'nest'|'none';
export type ObjectiveLine={kind:ObjectiveKind;text:string;detail:string;distance:number|null;bearing:string|null;target:ObjectivePoint|null};
export type JournalWeapon={id:string;name:string;damage:number;reach:number;cooldown:number;stamina:number;shield:boolean};
export type JournalInput={
 player:ObjectivePoint;
 time:number;
 castles:{id:string;name:string;x:number;z:number;region:string;friendly:boolean}[];
 regions:{id:string;name:string}[];
 camps:{id:string;name:string;x:number;z:number;region?:string;rescued:boolean}[];
 nest:{x:number;z:number;hp:number;maxHp:number};
 siege:{castle:string;starts:number;active:boolean}|null;
 nextSiege:number;
 stats:{captures:number;rescues:number;sieges:number};
 weapon?:JournalWeapon|null;
};
export type JournalSummary={
 castles:{held:number;total:number};
 regions:{id:string;name:string;held:boolean;castlesHeld:number;castlesTotal:number}[];
 survivors:{rescued:number;total:number};
 camps:{rescued:number;total:number};
 nest:{protected:boolean;hp:number;maxHp:number};
 sieges:{survived:number;active:boolean;nextIn:number|null;castleName:string|null};
 weapon:JournalWeapon|null;
};
/** 8-way compass label for a world-space delta; north = -z (matches the game's compass). */
export function compassBearing(dx:number,dz:number):string{
 const angle=Math.atan2(dx,-dz);
 const sectors=['N','NE','E','SE','S','SW','W','NW'];
 return sectors[Math.round(((angle+Math.PI*2)%(Math.PI*2))/(Math.PI/4))%8];
}
function objectiveTarget(player:ObjectivePoint,point:ObjectivePoint):{distance:number;bearing:string;target:ObjectivePoint}{
 const dx=point.x-player.x,dz=point.z-player.z;
 return {distance:Math.round(Math.hypot(dx,dz)),bearing:compassBearing(dx,dz),target:{x:point.x,z:point.z}};
}
/** Derive the single next objective (priority: active siege → imminent siege → nearest hostile
 * castle → survivors → plague nest → all-clear). Deterministic, no DOM, rounds distance to metres. */
export function deriveObjectiveLine(input:JournalInput):ObjectiveLine{
 const player=input.player;
 const hostile=input.castles.filter(c=>!c.friendly);
 const campsLeft=input.camps.filter(c=>!c.rescued);
 const allCastles=input.castles.length>0&&hostile.length===0;
 const allCamps=input.camps.length>0&&campsLeft.length===0;
 const siegeCastle=input.siege?input.castles.find(c=>c.id===input.siege!.castle):undefined;
 const siegeAt=input.siege?.starts??input.nextSiege;
 const nextIn=Math.max(0,Math.round(siegeAt-input.time));
 if(input.siege?.active){
  const name=siegeCastle?.name??'the keep';
  const t=siegeCastle?objectiveTarget(player,siegeCastle):{distance:null,bearing:null,target:null};
  return {kind:'siege',text:`Hold ${name} — siege underway`,detail:name,...t};
 }
 if(input.siege&&input.siege.active===false&&nextIn<=120){
  const name=siegeCastle?.name??'the keep';
  const t=siegeCastle?objectiveTarget(player,siegeCastle):{distance:null,bearing:null,target:null};
  return {kind:'siege',text:`Siege in ${nextIn} s — hold ${name}`,detail:name,...t};
 }
 if(hostile.length){
  let best=hostile[0]!;
  for(const castle of hostile)if(Math.hypot(castle.x-player.x,castle.z-player.z)<Math.hypot(best.x-player.x,best.z-player.z))best=castle;
  const t=objectiveTarget(player,best);
  return {kind:'reclaim',text:`Free ${best.name} · ${t.distance} m`,detail:best.name,...t};
 }
 if(allCastles&&!allCamps){
  const byRegion=new Map<string,typeof campsLeft>();
  for(const camp of campsLeft){
   const region=camp.region??'wilds';
   const list=byRegion.get(region);if(list)list.push(camp);else byRegion.set(region,[camp]);
  }
  const regionNames=new Map(input.regions.map(r=>[r.id,r.name]));
  let best=campsLeft[0]!,bestRegion=best.region??'wilds',bestCount=0;
  for(const [region,list] of byRegion)if(list.length>bestCount){bestCount=list.length;best=list[0];bestRegion=region;}
  const t=objectiveTarget(player,best);
  return {kind:'rescue',text:`Rescue survivors in ${regionNames.get(bestRegion)??bestRegion} · ${campsLeft.length} left`,detail:best.name,...t};
 }
 if(allCastles&&allCamps){
  const t=objectiveTarget(player,input.nest);
  return {kind:'nest',text:`Destroy the plague nest · ${t.distance} m`,detail:'plague nest',...t};
 }
 return {kind:'none',text:'The kingdom is yours — hold it.',detail:'',distance:null,bearing:null,target:null};
}
/** Journal section state derived from the same authoritative projection (counts/totals/status). */
export function deriveJournalSummary(input:JournalInput):JournalSummary{
 const held=input.castles.filter(c=>c.friendly).length;
 const regions=input.regions.map(region=>{
  const castles=input.castles.filter(c=>c.region===region.id);
  return {id:region.id,name:region.name,held:castles.length>0&&castles.every(c=>c.friendly),castlesHeld:castles.filter(c=>c.friendly).length,castlesTotal:castles.length};
 });
 const rescued=input.camps.filter(c=>c.rescued).length;
 const allCastles=input.castles.length>0&&held===input.castles.length;
 const allCamps=input.camps.length>0&&rescued===input.camps.length;
 const siegeCastle=input.siege?input.castles.find(c=>c.id===input.siege!.castle):undefined;
 return {
  castles:{held,total:input.castles.length},
  regions,
  survivors:{rescued,total:input.camps.length},
  camps:{rescued,total:input.camps.length},
  nest:{protected:!(allCastles&&allCamps),hp:input.nest.hp,maxHp:input.nest.maxHp},
  sieges:{survived:input.stats.sieges,active:!!input.siege?.active,nextIn:input.siege?.active?0:Math.max(0,Math.round((input.siege?.starts??input.nextSiege)-input.time)),castleName:siegeCastle?.name??null},
  weapon:input.weapon??null
 };
}


