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
