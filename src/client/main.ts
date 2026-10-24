import {PLAYER_CHARACTERS,isPlayerCharacter} from '../shared/characters';
import './style.css';
import {CombatAudio,combatCues,eventCues} from './combat-feedback';
import {Ambience} from './ambience';
import {WEAPON_IDS,WEAPONS,weaponStats} from '../shared/weapons';
import {WorldView} from './scene';
import {weaponCombatProfile} from './equipment';
import {readPad,deadzoneValue,DEADZONE_PRESETS,type DeadzonePreset,captionText,captionAllowed,CAPTION_RATE_LIMIT_MS,type CaptionCue,touchStickVector,touchSensitivityValue} from './controller';
import {dist,clamp,BOUNDS,REGIONS} from '../shared/world';
import type {Game,Actor} from '../shared/types';
type PerfSnapshot={fps?:number;frameMs?:number;calls?:number;triangles?:number;points?:number;geometries?:number;textures?:number;programs?:number;quality?:string;tier?:string};
type PerfHooks={__ssPerf?:()=>PerfSnapshot|undefined;__ssQuality?:(tier:'low'|'medium'|'high')=>void};
const perfHooks=window as unknown as PerfHooks;
/** Subset of CharacterAssets used for progressive loading; the new assets.ts fields are optional so
 * this still works if the loading hook has not landed yet (falls back to customReady). */
type AssetsLoading={progress?:{loaded:number;total:number};coreReady?:Promise<unknown>;customReady:Promise<unknown>;customLoaded:boolean;loadError?:unknown};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world');let view:WorldView;try{view=new WorldView(canvas);}catch(e){$('connection').textContent='WebGL could not start. Try a browser with hardware acceleration enabled.';throw e;}
let game:Game|undefined,id='',code='',host='',token='',ws:WebSocket|undefined,seq=0,yaw=0,pitch=-.13,first=localStorage.getItem('ss-camera')==='first',sensitivity=Number(localStorage.getItem('ss-sensitivity'))||1,invert=localStorage.getItem('ss-invert')==='true';
let attempts=0,everJoined=false,lastSend=0,lastHud=0,lastFrame=performance.now(),lastEvent=0,toastUntil=0,stopped=false;
let padPrev:boolean[]=[],menuPrev:boolean[]=[],padIndex=-1,padName='',padWasConnected=false,menuIndex=0;
const storedDeadzone=localStorage.getItem('ss-deadzone');
let deadzonePreset:DeadzonePreset=storedDeadzone&&Object.hasOwn(DEADZONE_PRESETS,storedDeadzone)?storedDeadzone as DeadzonePreset:'normal';
let deadzoneAmount=deadzoneValue(deadzonePreset);
let padSensitivity=Number(localStorage.getItem('ss-pad-sensitivity'))||1;
let captionsEnabled=localStorage.getItem('ss-captions')==='1';
let touchLookSensitivity=touchSensitivityValue(localStorage.getItem('ss-touch-sensitivity'));
const coarseMedia=typeof matchMedia==='function'?matchMedia('(pointer:coarse)'):undefined;
type DeviceProfileHook={__ssDeviceProfile?:()=>{touch?:boolean;coarse?:boolean;smallScreen?:boolean;suggestedQuality?:string;appliedQuality?:string;dpr?:number;maxDpr?:number}};
function deviceProfile(){const hook=(window as unknown as DeviceProfileHook).__ssDeviceProfile;try{return hook?.();}catch{return undefined;}}
let touchDevice=false,smallScreen=false;
function refreshDeviceProfile(){
 const profile=deviceProfile();
 touchDevice=!!(profile?.touch??(coarseMedia?.matches||(navigator.maxTouchPoints??0)>0));
 smallScreen=!!(profile?.smallScreen??(innerWidth<=820));
 document.body.classList.toggle('touch-device',touchDevice);
 document.body.classList.toggle('small-screen',smallScreen);
 applyInputHints();
}
const touchPointers=new Set<number>();
let lastLookDx=0,lastLookDy=0;
const keys=new Set<string>(),mouse={attack:false,block:false},touch={mx:0,forward:0,attack:false,block:false,interact:false};
const guide=$<HTMLDialogElement>('guide'),result=$<HTMLDialogElement>('result');
const me=()=>game?.actors.find(a=>a.id===id);
const send=(value:unknown)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
let sound:AudioContext|undefined;function tone(freq=180){if(audioPaused||!$<HTMLInputElement>('sound').checked)return;try{sound??=new AudioContext();void sound.resume();const o=sound.createOscillator(),gain=sound.createGain();o.type='triangle';o.frequency.setValueAtTime(freq,sound.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.5,sound.currentTime+.13);gain.gain.setValueAtTime(.04,sound.currentTime);gain.gain.exponentialRampToValueAtTime(.001,sound.currentTime+.15);o.connect(gain);gain.connect(sound.destination);o.start();o.stop(sound.currentTime+.16);}catch{}}
const soundEnabled=()=>$<HTMLInputElement>('sound').checked;
const combatAudio=new CombatAudio(soundEnabled);const ambience=new Ambience(soundEnabled);
const unlockAudio=()=>{combatAudio.unlock();ambience.unlock();};
window.addEventListener('pointerdown',unlockAudio);window.addEventListener('keydown',unlockAudio);
// Audio CPU: suspend synthesis while the tab is hidden or a dialog pauses the game, resume on return.
// The Sound checkbox stays authoritative (unchecking it also suspends the contexts).
let audioPaused=false;
function updateAudioPause(){
 const paused=!soundEnabled()||document.hidden||guide.open||result.open;
 if(paused===audioPaused)return;
 audioPaused=paused;
 combatAudio.setPaused(paused);ambience.setPaused(paused);
 const context=sound;
 if(context){try{if(paused)void context.suspend().catch(()=>{});else void context.resume().catch(()=>{});}catch{}}
}
$('sound').onchange=()=>{if(soundEnabled())unlockAudio();updateAudioPause();};

// ---- Controller polish: rumble + glyph hints (Gamepad API already drives movement/actions) ----
type RumbleActuator={playEffect?:(type:string,params:{duration:number;startDelay:number;strongMagnitude:number;weakMagnitude:number})=>Promise<unknown>;reset?:()=>Promise<unknown>};
type RumblePad=Gamepad&{vibrationActuator?:RumbleActuator};
const reducedMotionQuery=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):undefined;
let rumblePad:RumblePad|null=null;
let lastRumbleAt=0;
const padHints=document.createElement('div');
padHints.id='padHints';padHints.hidden=true;padHints.setAttribute('aria-label','Controller controls');
for(const label of ['RT Attack','LT Block','B Sweep','X Heal','A Interact','Y View']){
 const hint=document.createElement('span');hint.textContent=label;padHints.append(hint);
}
$('hud')?.append(padHints);
function setPadHints(visible:boolean){
 padHints.hidden=!visible;
 document.body.classList.toggle('pad-connected',visible);
}
function stopRumble(){
 const actuator=rumblePad?.vibrationActuator;
 try{void actuator?.reset?.().catch(()=>{});}catch{}
}
/** Short dual-rumble pulse: guarded by reduced-motion, menu/pause and pad connectivity. */
function rumble(strength:number,duration=110){
 if(reducedMotionQuery?.matches||guide.open||result.open||document.hidden)return;
 const actuator=rumblePad?.vibrationActuator;
 if(!actuator?.playEffect)return;
 const now=performance.now();
 if(now-lastRumbleAt<55)return;
 lastRumbleAt=now;
 const strong=clamp(strength,0,1),weak=clamp(strength*.6,0,1);
 try{void actuator.playEffect('dual-rumble',{duration,startDelay:0,strongMagnitude:strong,weakMagnitude:weak}).catch(()=>{});}catch{}
}
window.addEventListener('gamepaddisconnected',()=>{rumblePad=null;stopRumble();setPadHints(false);applyInputHints();});

// ---- F3 performance overlay (DOM-only, pointer-events:none, persisted in localStorage 'ss-perf') ----
const perfBox=document.createElement('pre');
perfBox.id='perf';perfBox.hidden=localStorage.getItem('ss-perf')!=='1';perfBox.setAttribute('aria-hidden','true');
document.body.append(perfBox);
let lastPerfPaint=0;
function togglePerf(){perfBox.hidden=!perfBox.hidden;localStorage.setItem('ss-perf',perfBox.hidden?'0':'1');lastPerfPaint=0;}
const shortCount=(n:number|undefined)=>n===undefined?'?':n>=10000?(n/1000).toFixed(0)+'k':n>=1000?(n/1000).toFixed(1)+'k':String(n);
function paintPerf(now:number){
 if(perfBox.hidden||now-lastPerfPaint<250)return;
 lastPerfPaint=now;
 const perf=perfHooks.__ssPerf?.();
 if(!perf){perfBox.textContent='PERF · waiting for renderer';return;}
 const fps=perf.fps??(perf.frameMs&&perf.frameMs>0?1000/perf.frameMs:0),ms=perf.frameMs??(fps>0?1000/fps:0);
 perfBox.textContent=`PERF ${fps.toFixed(0)} fps · ${ms.toFixed(1)} ms\nCALLS ${perf.calls??'?'} · TRIS ${shortCount(perf.triangles)}\nQUALITY ${String(perf.quality??perf.tier??localStorage.getItem('ss-quality')??'high').toUpperCase()}`;
}
window.addEventListener('keydown',e=>{
 if(e.code!=='F3'||e.repeat)return;
 const target=e.target;
 if(target instanceof HTMLInputElement||target instanceof HTMLSelectElement||target instanceof HTMLTextAreaElement)return;
 e.preventDefault();togglePerf();
});

// ---- Graphics quality selector, created into the Guide's settings row (no index.html edit) ----
const QUALITY_TIERS=['low','medium','high'] as const;type QualityTier=(typeof QUALITY_TIERS)[number];
const storedQuality=localStorage.getItem('ss-quality');
let qualityTier:QualityTier=QUALITY_TIERS.find(t=>t===storedQuality)??'high';
const qualitySelect=document.createElement('select');
qualitySelect.id='qualityChoice';qualitySelect.setAttribute('aria-label','Graphics quality');
for(const tier of QUALITY_TIERS){const option=document.createElement('option');option.value=tier;option.textContent=tier[0].toUpperCase()+tier.slice(1);qualitySelect.append(option);}
qualitySelect.value=qualityTier;
qualitySelect.onchange=()=>{
 qualityTier=qualitySelect.value as QualityTier;
 localStorage.setItem('ss-quality',qualityTier);
 try{perfHooks.__ssQuality?.(qualityTier);}catch{}
};
const qualityLabel=document.createElement('label');
qualityLabel.append('Graphics quality ',qualitySelect);
document.querySelector('#guide .settings')?.append(qualityLabel);

// ---- Controller settings (deadzone preset + look sensitivity) in the existing Guide/Settings row ----
const guideSettings=document.querySelector('#guide .settings');
const padDeadzoneSelect=document.createElement('select');
padDeadzoneSelect.id='padDeadzone';padDeadzoneSelect.setAttribute('aria-label','Controller deadzone preset');
for(const preset of Object.keys(DEADZONE_PRESETS) as DeadzonePreset[]){
 const option=document.createElement('option');option.value=preset;option.textContent=preset[0].toUpperCase()+preset.slice(1);padDeadzoneSelect.append(option);
}
padDeadzoneSelect.value=deadzonePreset;
padDeadzoneSelect.onchange=()=>{
 deadzonePreset=padDeadzoneSelect.value as DeadzonePreset;
 deadzoneAmount=deadzoneValue(deadzonePreset);
 localStorage.setItem('ss-deadzone',deadzonePreset);
};
const padDeadzoneLabel=document.createElement('label');
padDeadzoneLabel.append('Deadzone ',padDeadzoneSelect);
guideSettings?.append(padDeadzoneLabel);
const padSensitivityInput=document.createElement('input');
padSensitivityInput.id='padSensitivity';padSensitivityInput.type='range';padSensitivityInput.min='0.4';padSensitivityInput.max='2';padSensitivityInput.step='0.1';
padSensitivityInput.value=String(padSensitivity);padSensitivityInput.setAttribute('aria-label','Controller look sensitivity');
padSensitivityInput.oninput=()=>{
 padSensitivity=Number(padSensitivityInput.value)||1;
 localStorage.setItem('ss-pad-sensitivity',String(padSensitivity));
};
const padSensitivityLabel=document.createElement('label');
padSensitivityLabel.append('Controller look ',padSensitivityInput);
guideSettings?.append(padSensitivityLabel);
const touchSensitivityInput=document.createElement('input');
touchSensitivityInput.id='touchSensitivity';touchSensitivityInput.type='range';touchSensitivityInput.min='0.4';touchSensitivityInput.max='2';touchSensitivityInput.step='0.1';
touchSensitivityInput.value=String(touchLookSensitivity);touchSensitivityInput.setAttribute('aria-label','Touch look sensitivity');
touchSensitivityInput.oninput=()=>{
 touchLookSensitivity=touchSensitivityValue(touchSensitivityInput.value);
 localStorage.setItem('ss-touch-sensitivity',String(touchLookSensitivity));
};
const touchSensitivityLabel=document.createElement('label');
touchSensitivityLabel.append('Touch look ',touchSensitivityInput);
guideSettings?.append(touchSensitivityLabel);
const captionsToggle=document.createElement('input');
captionsToggle.id='captionsToggle';captionsToggle.type='checkbox';captionsToggle.checked=captionsEnabled;
captionsToggle.onchange=()=>{
 captionsEnabled=captionsToggle.checked;
 localStorage.setItem('ss-captions',captionsEnabled?'1':'0');
 if(!captionsEnabled)hideCaption();
};
const captionsLabel=document.createElement('label');
captionsLabel.append(captionsToggle,' Captions (non-visual cues)');
guideSettings?.append(captionsLabel);

// ---- Accessibility captions: one subtle HUD line, off by default, rate-limited ----
const captionLine=document.createElement('div');
captionLine.id='captions';captionLine.hidden=true;captionLine.setAttribute('role','status');captionLine.setAttribute('aria-live','polite');
$('hud')?.append(captionLine);
let captionAt=0;
let captionCue:CaptionCue|undefined;
let captionDisplayedUntil=0;
let captionWeatherTimer=0,captionFlash=0,captionFlashSeen=false,captionUndeadTimer=6,captionLowHealthLatched=false;
function hideCaption(){captionLine.hidden=true;captionLine.textContent='';captionCue=undefined;captionAt=0;}
/** True when a caption must be suppressed (disabled, paused/menu/hidden, or rate-limited). */
function captionGated(cue:CaptionCue,force=false){
 if(!captionsEnabled)return true;
 if(guide.open||result.open||document.hidden)return true;
 if(!force&&(!game||game.status!=='playing'))return true;
 return !captionAllowed(performance.now(),captionAt,captionCue,cue);
}
function showCaption(cue:CaptionCue,detail?:string,force=false){
 if(captionGated(cue,force))return;
 captionCue=cue;captionAt=performance.now();captionDisplayedUntil=captionAt+3800;
 captionLine.textContent=captionText(cue,detail);captionLine.hidden=false;
}
function updateCaptions(now:number){if(!captionLine.hidden&&now>=captionDisplayedUntil)hideCaption();}
/** Thunder/lightning captions come from world-scene's weather flash counter (polled at 4 Hz). */
function pollCaptionWeather(dt:number){
 if(!captionsEnabled)return;
 captionWeatherTimer+=dt;if(captionWeatherTimer<.25)return;captionWeatherTimer=0;
 const hook=(window as unknown as {__ssWeather?:()=>{flash?:number;intensity?:number}}).__ssWeather;
 if(typeof hook!=='function')return;
 let weather;try{weather=hook();}catch{return;}
 const flash=typeof weather?.flash==='number'?weather.flash:0;
 if(!captionFlashSeen){captionFlashSeen=true;captionFlash=flash;}
 else if(flash>captionFlash){captionFlash=flash;if((weather?.intensity??0)>.05)showCaption('thunder');}
}
/** Low-health and nearby-undead captions (rate-limited like the audio beds they describe). */
function pollCaptionActors(p:Actor|undefined,dt:number){
 if(!captionsEnabled||!p||!game)return;
 if(p.hp>0&&p.hp/p.maxHp<.3&&!captionLowHealthLatched){captionLowHealthLatched=true;showCaption('low-health');}
 else if(p.hp/p.maxHp>=.45)captionLowHealthLatched=false;
 captionUndeadTimer-=dt;if(captionUndeadTimer>0)return;
 captionUndeadTimer=7+Math.random()*6;
 for(const a of game.actors)if(a.hp>0&&(a.kind==='zombie'||a.kind==='corrupted')&&dist(a,p)<34){showCaption('undead');return;}
}
function toast(text:string){$('toast').textContent=text;toastUntil=performance.now()+5000;}
function cmd(action:string){send({type:'command',action});}
function cameraToggle(){first=!first;localStorage.setItem('ss-camera',first?'first':'third');$('cameraBtn').textContent=`${first?'First':'Third'} person · V / Y`;}
$('cameraBtn').textContent=`${first?'First':'Third'} person · V / Y`;
function release(){stopRumble();keys.clear();mouse.attack=mouse.block=false;touch.mx=touch.forward=0;touch.attack=touch.block=touch.interact=false;send({type:'input',input:{mx:0,mz:0,yaw,attack:false,block:false,interact:false,seq:seq++}});}
function openGuide(){stopRumble();release();document.exitPointerLock?.();guide.showModal();menuIndex=0;}
$('armoryBtn').onclick=()=>{openGuide();$('armoryPanel').scrollIntoView({block:'center'});};
$('manageCastle').onclick=()=>{openGuide();$('campMenu').scrollIntoView({block:'center'});};$('openRules').onclick=openGuide;$('guideBtn').onclick=openGuide;$('closeGuide').onclick=()=>guide.close();$('cameraBtn').onclick=cameraToggle;
$('name').setAttribute('value',localStorage.getItem('ss-name')||'');$<HTMLInputElement>('sensitivity').value=String(sensitivity);$<HTMLInputElement>('invert').checked=invert;
$('sensitivity').oninput=()=>{sensitivity=Number($<HTMLInputElement>('sensitivity').value);localStorage.setItem('ss-sensitivity',String(sensitivity));};$('invert').onchange=()=>{invert=$<HTMLInputElement>('invert').checked;localStorage.setItem('ss-invert',String(invert));};
const queryCode=new URLSearchParams(location.search).get('room');if(queryCode)$<HTMLInputElement>('code').value=queryCode.slice(0,6).toUpperCase();

const savedCharacter=localStorage.getItem('ss-character')??'templar';
let selectedCharacter=isPlayerCharacter(savedCharacter)?savedCharacter:'templar';
const characterSelectors:HTMLSelectElement[]=[];
for(const location of ['landing','armory']){
  const label=document.createElement('label');
  label.textContent='Your character';
  const select=document.createElement('select');
  select.id=location==='landing'?'characterChoice':'characterChoiceInGame';
  select.setAttribute('aria-label','Your character');
  for(const [value,name] of Object.entries(PLAYER_CHARACTERS)){
    const option=document.createElement('option');
    option.value=value;option.textContent=name;select.append(option);
  }
  select.value=selectedCharacter;
  label.append(select);
  if(location==='landing') $('create').before(label);
  else $('armoryPanel').prepend(label);
  characterSelectors.push(select);
  select.onchange=()=>{
    if(!isPlayerCharacter(select.value)) return;
    selectedCharacter=select.value;
    localStorage.setItem('ss-character',selectedCharacter);
    for(const other of characterSelectors) other.value=selectedCharacter;
    if(game) cmd('character:'+selectedCharacter);
  };
}

// ---- Read-only QA hooks: character selector state + controller/pad state (no gameplay effect) ----
const qaHooks=window as unknown as {__ssCharacterSelect?:()=>unknown;__ssPad?:()=>unknown;__ssControllerSettings?:()=>unknown;__ssCaptions?:()=>unknown;__ssCaptionDemo?:(cue?:string)=>unknown;__ssAudioState?:()=>unknown;__ssAudioFocus?:(x?:number|null,z?:number|null)=>unknown};
qaHooks.__ssCharacterSelect=()=>({
 appearanceField:'appearance',
 landingSelectId:characterSelectors[0]?.id??null,
 inGameSelectId:characterSelectors[1]?.id??null,
 value:characterSelectors[0]?.value??null,
 inGameValue:characterSelectors[1]?.value??null,
 options:characterSelectors[0]?Array.from(characterSelectors[0].options).map(option=>({value:option.value,label:option.textContent})):[]
});
qaHooks.__ssPad=()=>({
 connected:padWasConnected,
 id:padName||null,
 mapping:padWasConnected?'standard':null,
 hintsVisible:!padHints.hidden,
 hints:['RT Attack','LT Block','B Sweep','X Heal','A Interact','Y View'],
 rumbleSupported:!!rumblePad?.vibrationActuator,
 reducedMotion:!!reducedMotionQuery?.matches,
 rumbleGuarded:!!reducedMotionQuery?.matches||guide.open||result.open||document.hidden,
 deadzone:deadzonePreset,
 deadzoneValue:deadzoneAmount,
 padSensitivity,
 captionsEnabled
});
qaHooks.__ssControllerSettings=()=>({
 deadzonePreset,
 deadzoneValue:deadzoneAmount,
 presets:{...DEADZONE_PRESETS},
 padSensitivity,
 captionsEnabled,
 deadzoneSelectId:'padDeadzone',
 sensitivityInputId:'padSensitivity',
 captionsToggleId:'captionsToggle',
 storageKeys:{deadzone:'ss-deadzone',padSensitivity:'ss-pad-sensitivity',captions:'ss-captions'}
});
qaHooks.__ssCaptions=()=>({
 enabled:captionsEnabled,
 lineId:'captions',
 visible:!captionLine.hidden,
 text:captionLine.textContent||'',
 lastCue:captionCue??null,
 lastAt:+captionAt.toFixed(1),
 rateLimitMs:CAPTION_RATE_LIMIT_MS,
 displayMs:3800,
 gated:!captionsEnabled||guide.open||result.open||document.hidden,
 paused:guide.open||result.open||document.hidden
});
/** QA-only deterministic caption trigger (respects the enabled/pause gates; no gameplay effect). */
qaHooks.__ssCaptionDemo=(cue?:string)=>{
 const cues:CaptionCue[]=['thunder','undead','siege-start','siege-end','low-health','castle-captured'];
 const target=cues.includes(cue as CaptionCue)?cue as CaptionCue:'thunder';
 showCaption(target,'Demo Keep',true);
 return qaHooks.__ssCaptions?.();
};
/** Read-only audio soundscape diagnostic: current beds/layers + weather/music/duck state, built on
 * demand from the live Ambience graph (no hot-path work, no logging, no audio behaviour changes). */
qaHooks.__ssAudioState=()=>{
 const state=ambience.audioState();
 return {
  enabled:soundEnabled(),
  paused:document.hidden||guide.open||result.open,
  contextState:state.contextState,
  weather:state.weather,
  regionBeds:state.regionBeds,
  music:state.music,
  weatherBeds:state.weatherBeds,
  landmarkBeds:state.landmarkBeds,
  captionsEnabled,
  masterMuted:!soundEnabled(),
  focus:state.focus
 };
};
/** QA-only diagnostic focus for landmark beds: pass furnace/altar x,z to hear the forge/chapel bed
 * without walking the player; call with null/undefined to restore normal player proximity. */
qaHooks.__ssAudioFocus=(x?:number|null,z?:number|null)=>{
 const pos=typeof x==='number'&&typeof z==='number'&&Number.isFinite(x)&&Number.isFinite(z)?{x,z}:null;
 ambience.setDiagnosticFocus(pos);
 return qaHooks.__ssAudioState?.();
};

// ---- Progressive world loading: show real asset counts, gate joining on the core set only ----
const defaultConnectionText=$('connection').textContent;
let loadingTimer:number|undefined;
function showWorldLoading(assets:AssetsLoading){
 const paint=()=>{
  const loaded=assets.progress?.loaded??0,total=assets.progress?.total??0;
  $('connection').textContent=total>0?`Loading world… ${loaded}/${total}`:`Loading world… ${loaded>0?`${loaded} assets`:'starting engines'}`;
 };
 paint();
 if(loadingTimer!==undefined)clearInterval(loadingTimer);
 loadingTimer=window.setInterval(paint,120);
}
function hideWorldLoading(){if(loadingTimer!==undefined){clearInterval(loadingTimer);loadingTimer=undefined;}}
let worldCorePromise:Promise<boolean>|undefined;
function worldCore(){return worldCorePromise??=awaitWorldCore();}
async function awaitWorldCore():Promise<boolean>{
 const assets=view.characterAssets as unknown as AssetsLoading;
 if(assets.customLoaded)return true;
 $<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=true;
 showWorldLoading(assets);
 let failed=false;
 try{await (assets.coreReady??assets.customReady);}catch{failed=true;}
 finally{hideWorldLoading();}
 if(failed||assets.loadError)return false;
 // coreReady only covers the join-critical set; if the hook is not present yet fall back to the
 // old full-preload contract (customLoaded) so behaviour is unchanged.
 if(!assets.coreReady&&!assets.customLoaded)return false;
 return true;
}
void worldCore().then(ok=>{
 if(!ok){$('connection').textContent='Character files failed to load. Refresh to retry; check the browser console for the filename.';return;}
 if(!ws&&!everJoined){$<HTMLButtonElement>('create').disabled=false;$<HTMLButtonElement>('join').disabled=false;$('connection').textContent=defaultConnectionText;}
});
async function connect(mode:'create'|'join'|'resume'){
 if(!await worldCore()){
   $('connection').textContent='Character files failed to load. Refresh to retry; check the browser console for the filename.';
   return;
 }

 if(ws&&ws.readyState<2)return;stopped=false;$('connection').textContent=mode==='resume'?'Reconnecting…':'Connecting to the kingdom…';$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=true;
 const protocol=location.protocol==='https:'?'wss:':'ws:';const routeCode=mode==='create'?Array.from(crypto.getRandomValues(new Uint8Array(3)),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase():mode==='resume'?code:$<HTMLInputElement>('code').value.trim().toUpperCase();ws=new WebSocket(`${protocol}//${location.host}${import.meta.env.BASE_URL}ws?room=${encodeURIComponent(routeCode)}`);
 ws.onopen=()=>{const name=$<HTMLInputElement>('name').value.trim()||'Knight';localStorage.setItem('ss-name',name);send({type:mode,name,code:mode==='resume'?code:$<HTMLInputElement>('code').value.trim().toUpperCase(),...(mode==='resume'?{token}:{})});};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
  if(m.type==='welcome'){cmd('character:'+selectedCharacter);id=m.id;code=m.code;token=m.token;everJoined=true;attempts=0;seq=0;sessionStorage.setItem('ss-session',JSON.stringify({code,token}));$('landing').hidden=true;$('hud').hidden=false;$('roomCode').textContent=code;toast('Campaign started. Clear the Fallen Keep, then hold E / A at its banner.');}
  else if(m.type==='state'){if(!document.hidden){for(const cue of combatCues(game,m.game,id)){combatAudio.play(cue);if(cue.kind==='impact'||cue.kind==='hurt')ambience.duck(1);else if(cue.kind==='swing'||cue.kind==='block')ambience.duck(.55);if(cue.kind==='hurt'){const hudActor=m.game.actors.find((a:Actor)=>a.id===id);const weight=weaponCombatProfile(hudActor?.weapon).weight;rumble(clamp(.16+.24*weight,.2,.55),150);$('hud').classList.remove('hurt-flash');void $('hud').offsetWidth;$('hud').classList.add('hurt-flash');view.shake=Math.max(view.shake,.24);}else if(cue.kind==='block')rumble(.3,90);}for(const event of eventCues(game,m.game)){combatAudio.playEvent(event);if(event==='capture'){rumble(.22,170);const captured=m.game.castles.find((c:{id:string;name:string;friendly:boolean})=>c.friendly&&!game?.castles.find(o=>o.id===c.id)?.friendly);if(captured)showCaption('castle-captured',captured.name);}}
   if(game?.status==='playing'){const wasSiege=!!game.siege?.active,nowSiege=!!m.game.siege?.active;if(nowSiege&&!wasSiege){const target=m.game.castles.find((c:{id:string;name:string})=>c.id===m.game.siege?.castle);showCaption('siege-start',target?.name);}else if(!nowSiege&&wasSiege)showCaption('siege-end');}
  }game=m.game;host=m.host;const p=me();if(p&&lastEvent===0)yaw=p.yaw;for(const ev of game!.events)if(ev.id>lastEvent){lastEvent=ev.id;toast(ev.text);tone(260);}if(game!.status!=='playing'&&!result.open){document.exitPointerLock?.();stopRumble();$('resultTitle').textContent=game!.status==='victory'?'The kingdom lives.':'The last fire fades.';$('resultCopy').textContent=game!.status==='victory'?'Nine castles reclaimed across three regions. Every survivor saved. The plague is ended.':'Every stronghold has fallen. Gather your fellowship and try again.';$('stats').textContent=`${game!.stats.captures} captures · ${game!.stats.rescues} rescues · ${game!.stats.sieges} sieges repelled · ${game!.stats.kills} undead defeated`;$('restart').hidden=host!==id;result.showModal();}else if(game!.status==='playing'&&result.open){result.close();lastEvent=0;cmd('character:'+selectedCharacter);}}
  else if(m.type==='error'){if(!everJoined){sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;stopped=true;ws?.close();$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}else{toast(m.text);if(/expired|not found/.test(m.text)){stopped=true;sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;setTimeout(()=>location.reload(),2000);}}}
 };
 ws.onclose=e=>{release();if(stopped)return;if(e.code===4000||e.code===4001){stopped=true;sessionStorage.removeItem('ss-session');toast(e.reason);$('connection').textContent=e.reason;setTimeout(()=>location.reload(),2500);return;}if(everJoined&&attempts<8){toast('Connection lost. Reconnecting…');setTimeout(()=>connect('resume'),Math.min(8000,500*2**attempts++));}else{$('connection').textContent='Unable to connect. Try again shortly.';$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}};
 ws.onerror=()=>{$('connection').textContent='The server is unavailable or waking up. Please wait, then try again.';};
}
$('create').onclick=()=>connect('create');$('join').onclick=()=>connect('join');$('restart').onclick=()=>send({type:'restart'});$('leave').onclick=()=>{stopped=true;sessionStorage.removeItem('ss-session');ws?.close();location.href=location.pathname;};
$('invite').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Invitation link copied. Send it to your fellowship.');}catch{toast(`Room code: ${code}. Friends can enter it on this site.`);}};
for(const id of WEAPON_IDS){const w=WEAPONS[id],b=document.createElement('button');b.id='equip-'+id;b.dataset.command='equip:'+id;b.innerHTML=`<strong>${w.name}</strong><span>${w.style}</span><span>${w.damage} damage · ${w.reach} m reach · ${w.stamina} stamina · ${w.cooldown}s recovery</span><small>Join a campaign to equip</small>`;b.disabled=true;$('weaponCards').append(b);}
document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b=>b.onclick=()=>cmd(b.dataset.command!));
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||guide.open||result.open)return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyR')cmd('nextWeapon');if(e.code==='KeyI')$('armoryBtn').click();if(e.code==='KeyV')cameraToggle();if(e.code==='KeyH')cmd('heal');if(e.code==='KeyQ')cmd('sweep');if(e.code==='Digit1')cmd('follow');if(e.code==='Digit2')cmd('hold');if(e.code==='Digit3')cmd('attack');if(e.code==='KeyG')openGuide();if(e.code==='KeyB'){$('manageCastle').click();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden){release();stopRumble();}updateAudioPause();});
canvas.addEventListener('click',()=>{if(game&&!guide.open&&!result.open&&matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();});canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('mousedown',e=>{if(document.pointerLockElement===canvas){if(e.button===0){mouse.attack=true;}if(e.button===2)mouse.block=true;}});window.addEventListener('mouseup',e=>{if(e.button===0)mouse.attack=false;if(e.button===2)mouse.block=false;});document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas)release();});document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){yaw+=e.movementX*.0025*sensitivity;pitch=clamp(pitch-e.movementY*.0025*sensitivity*(invert?-1:1),-1.05,1.05);}});
const stick=$('stick');let stickId=-1;function stickMove(e:PointerEvent){const rect=stick.getBoundingClientRect();const vector=touchStickVector(e.clientX-(rect.left+rect.width/2),e.clientY-(rect.top+rect.height/2),35,deadzoneAmount);touch.mx=vector.mx;touch.forward=vector.forward;const knob=stick.firstElementChild as HTMLElement;if(knob)knob.style.transform=`translate(${(vector.mx*25).toFixed(1)}px,${(-vector.forward*25).toFixed(1)}px)`;}
stick.onpointerdown=e=>{stickId=e.pointerId;stick.setPointerCapture(stickId);stickMove(e);};stick.onpointermove=e=>{if(e.pointerId===stickId)stickMove(e);};const stopStick=()=>{stickId=-1;touch.mx=touch.forward=0;(stick.firstElementChild as HTMLElement).style.transform='';};stick.onpointerup=stopStick;stick.onpointercancel=stopStick;
let lookId=-1,lookX=0,lookY=0;const look=$('lookpad');look.onpointerdown=e=>{lookId=e.pointerId;lookX=e.clientX;lookY=e.clientY;look.setPointerCapture(lookId);};look.onpointermove=e=>{if(e.pointerId!==lookId)return;lastLookDx=e.clientX-lookX;lastLookDy=e.clientY-lookY;yaw+=lastLookDx*.006*touchLookSensitivity;pitch=clamp(pitch-lastLookDy*.006*touchLookSensitivity*(invert?-1:1),-1.05,1.05);lookX=e.clientX;lookY=e.clientY;};look.onpointerup=look.onpointercancel=()=>{lookId=-1;lastLookDx=0;lastLookDy=0;};
document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b=>{const action=b.dataset.hold as 'attack'|'block'|'interact';b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);touch[action]=true;};b.onpointerup=b.onpointercancel=()=>{touch[action]=false;};});
// Per-control pointer capture keeps move + look + held actions usable simultaneously. Track active
// touch pointers for the QA hook, block browser gestures on the play surface, and adapt hint copy to
// the input device (keyboard hints disappear on touch; pad hints stay via #padHints).
const touchRoot=$('touch');
touchRoot.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')touchPointers.add(e.pointerId);});
const releaseTouchPointer=(e:PointerEvent)=>{touchPointers.delete(e.pointerId);};
touchRoot.addEventListener('pointerup',releaseTouchPointer);touchRoot.addEventListener('pointercancel',releaseTouchPointer);touchRoot.addEventListener('pointerleave',releaseTouchPointer);
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>{if(document.body.classList.contains('touch-device'))e.preventDefault();});
const touchHintLabels:[string,string,string][]=[['follow','1 Follow','Follow'],['hold','2 Hold','Hold'],['attack','3 Attack','Attack'],['heal','H Heal','Heal']];
function applyInputHints(){
 const usingPad=padWasConnected;
 $('cameraBtn').textContent=`${first?'First':'Third'} person${usingPad?' · Y':touchDevice?'':' · V'}`;
 $('armoryBtn').textContent=touchDevice?'Armory':'Armory · I';
 $('guideBtn').textContent=touchDevice?'Guide':'Guide / Menu';
 for(const [action,keyboard,touchLabel] of touchHintLabels){
  const button=document.querySelector<HTMLButtonElement>(`[data-command="${action}"]`);
  if(button)button.textContent=touchDevice?touchLabel:keyboard;
 }
}
(window as unknown as {__ssTouch?:()=>unknown}).__ssTouch=()=>({
 active:touchPointers.size>0,
 device:{touch:touchDevice,coarse:!!coarseMedia?.matches,smallScreen},
 stick:{x:+touch.mx.toFixed(3),y:+touch.forward.toFixed(3)},
 look:{dx:+lastLookDx.toFixed(1),dy:+lastLookDy.toFixed(1)},
 held:{attack:touch.attack,block:touch.block,interact:touch.interact},
 pointers:{count:touchPointers.size,stick:stickId,look:lookId},
 multiTouch:touchPointers.size>=2,
 touchLookSensitivity,
 deadzone:deadzonePreset,
 deadzoneValue:deadzoneAmount,
 deviceProfile:deviceProfile()??null
});
refreshDeviceProfile();
window.addEventListener('resize',()=>refreshDeviceProfile());
window.addEventListener('orientationchange',()=>refreshDeviceProfile());
function menuGamepad(p:Gamepad){const d=readPad(p,padPrev,deadzoneAmount);menuPrev=d.previous;const root=guide.open?guide:result.open?result:$('landing');const buttons=[...root.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.hidden&&!b.disabled&&b.offsetParent!==null);if(!buttons.length)return;const up=(p.buttons[12]?.pressed&&!padPrev[12]),down=(p.buttons[13]?.pressed&&!padPrev[13]);if(up)menuIndex=(menuIndex+buttons.length-1)%buttons.length;if(down)menuIndex=(menuIndex+1)%buttons.length;menuIndex%=buttons.length;if(up||down)buttons[menuIndex].focus();if(p.buttons[0]?.pressed&&!padPrev[0])buttons[menuIndex].click();if(d.menu&&guide.open)guide.close();}
function updateCompass(p:Actor){
 const track=$('compassTrack');if(!track||!game)return;
 track.replaceChildren();
 const addMark=(angle:number,label:string,className:string)=>{
  let diff=Math.atan2(Math.sin(angle-yaw),Math.cos(angle-yaw));
  if(Math.abs(diff)>Math.PI*.45)return;
  const pct=50+(diff/(Math.PI*.45))*50;
  const el=document.createElement('div');
  el.className='compass-marker '+className;
  el.textContent=label;
  el.style.left=`${pct}%`;
  track.append(el);
 };
 addMark(0,'N','compass-cardinal');
 addMark(Math.PI/2,'E','compass-cardinal');
 addMark(Math.PI,'S','compass-cardinal');
 addMark(-Math.PI/2,'W','compass-cardinal');
 for(const c of game.castles){
  const d=dist(p,c);
  if(d<120){
   const a=Math.atan2(c.x-p.x,-(c.z-p.z));
   addMark(a,c.friendly?'◆':'◇',`compass-castle ${c.friendly?'friendly':''}`);
  }
 }
 for(const c of game.camps){
  if(!c.rescued&&dist(p,c)<95){
   const a=Math.atan2(c.x-p.x,-(c.z-p.z));
   addMark(a,'⛺','compass-survivor');
  }
 }
 if(dist(p,game.nest)<180){
  const a=Math.atan2(game.nest.x-p.x,-(game.nest.z-p.z));
  addMark(a,'💀','compass-nest');
 }
}

function updateHud(p:Actor){
 const weapon=weaponStats(p.weapon);$('equippedWeapon').textContent=`${weapon.name} · ${p.cd>0?'Recovering '+p.cd.toFixed(1)+'s':(p.stamina??100)<weapon.stamina?'Low stamina':p.block?(weapon.shield?'Shield raised':'Parrying'):'Ready'}${padName?' · LB':touchDevice?'':' · R / LB'}`;
 for(const id of WEAPON_IDS){const b=$<HTMLButtonElement>('equip-'+id),w=WEAPONS[id],owned=game!.armory.includes(id);b.disabled=!owned||p.hp<=0||p.cd>0||p.weapon===id;b.classList.toggle('equipped',p.weapon===id);b.setAttribute('aria-pressed',String(p.weapon===id));b.querySelector('small')!.textContent=owned?(p.weapon===id?'EQUIPPED':'Equip'):'Find a blue weapon rack';}
 const nearestRack=game!.weaponDrops.filter(d=>!d.taken&&!game!.armory.includes(d.weapon)).sort((a,b)=>dist(a,p)-dist(b,p))[0];$('armoryHint').textContent=nearestRack?`Nearest new weapon: ${WEAPONS[nearestRack.weapon].name} · ${Math.round(dist(p,nearestRack))} m. Blue rings mark weapon racks. Recovering one unlocks it for everyone, including late joiners.`:`All ${WEAPON_IDS.length} weapons recovered. Everyone can equip their own choice.`;
$('playerName').textContent=p.name;$('hud').classList.toggle('low-health',p.hp>0&&p.hp/p.maxHp<=.3);updateCompass(p);
 $('health').style.width=`${p.hp/p.maxHp*100}%`;$('healthText').textContent=p.hp>0?`${Math.ceil(p.hp)} / ${p.maxHp} HEALTH`:`${p.downed?'CORRUPTION':'Returning'} in ${Math.max(0,Math.ceil(p.deadUntil-game!.time))}s`;$('device').textContent=padName?'XBOX / GAMEPAD CONNECTED':touchDevice?'':'WASD · MOUSE · V VIEW · G GUIDE';
 $('castleList').replaceChildren(...game!.castles.filter(c=>c.region===REGIONS.reduce((a,b)=>Math.abs(p.z-(a.offset-80))<Math.abs(p.z-(b.offset-80))?a:b).id).map(c=>{const row=document.createElement('div');row.className=c.friendly?'owned':'enemy';const a=document.createElement('span');a.textContent=(c.friendly?'◆ ':'◇ ')+c.name.replace('The ','');const b=document.createElement('span');b.textContent=c.friendly?['KEEP','BASTION','CITADEL'][c.level]:c.capture>0?`${Math.round(c.capture/5*100)}%`:'LOST';row.append(a,b);return row;}));$('rescueCount').textContent=`Survivors rescued  ${game!.camps.filter(c=>c.rescued).length} / ${game!.camps.length}`;$('nestStatus').textContent=game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)?`Plague nest exposed · ${game!.nest.hp} HP`:'Plague nest · protected';const r=game!.resources;$('resources').textContent=`WOOD ${r.wood}   IRON ${r.iron}\nHEAL ${r.medicine}   RECRUITS ${r.recruits}`;$('resources').style.whiteSpace='pre';
 $('regions').textContent=game!.regions.map(r=>`${r.held?'◆':'◇'} ${r.name} ${game!.castles.filter(c=>c.region===r.id&&c.friendly).length}/3${r.held?' · supply income':''}`).join(' | ');
 $('stamina').style.width=`${p.stamina??100}%`;$('staminaText').textContent=`${Math.ceil(p.stamina??100)} STAMINA · ${(p.armor??'light').toUpperCase()} ARMOR`;$('sweepBtn').textContent=touchDevice?((p.abilityCd??0)>0?`Sweep · ${Math.ceil(p.abilityCd!)}s`:'Sweep'):((p.abilityCd??0)>0?`Sweep · ${Math.ceil(p.abilityCd!)}s`:'Q / B · Sweep');$<HTMLButtonElement>('sweepBtn').disabled=p.hp<=0||(p.stamina??100)<40||(p.abilityCd??0)>0;
 const siege=game!.siege;$('siege').hidden=!game!.everCaptured;if(!siege)$('siege').textContent=`RECOVERY · ${Math.max(0,Math.ceil(game!.nextSiege-game!.time))}s until next warning · loot, heal and fortify`;if(siege)$('siege').textContent=`${siege.active?'SIEGE UNDERWAY':'SIEGE IN '+Math.max(0,Math.ceil(siege.starts-game!.time))+'s'} · ${game!.castles.find(c=>c.id===siege.castle)?.name}`;
 const base=game!.castles.find(c=>c.friendly&&dist(p,c)<15);$('baseActions').hidden=!base;document.querySelectorAll<HTMLButtonElement>('[data-base]').forEach(b=>b.disabled=!base);let prompt='';if(base)prompt=`${base.name} · Gate ${Math.ceil(base.gate)}/${180+base.level*120} · Barricade ${base.barrier}/${120+base.level*60} · B / Guide to build`;
 const travelReady=!!base&&dist(p,base)<8;const travelSignature=game!.castles.filter(c=>c.friendly).map(c=>c.id).join(',')+travelReady+!!game!.siege;if($('travelMenu').dataset.signature!==travelSignature){$('travelMenu').dataset.signature=travelSignature;$('travelMenu').replaceChildren(...game!.castles.filter(c=>c.friendly).map(c=>{const b=document.createElement('button');b.textContent=`Travel: ${c.name}`;b.disabled=!travelReady||!!game!.siege;b.onclick=()=>{cmd('travel:'+c.id);guide.close();};return b;}));}
 $('castleDetails').textContent=base?`${base.name} · ${['Keep','Bastion','Citadel'][base.level]} · Gate ${Math.ceil(base.gate)}/${180+base.level*120}`:'Approach a friendly castle to unlock construction.';
 document.querySelectorAll<HTMLButtonElement>('[data-command="upgrade"]').forEach(b=>{b.textContent=base?.level===2?'Fully upgraded':`Build ${base?.level===1?'Citadel':'Bastion'} · ${24+(base?.level??0)*16}W ${10+(base?.level??0)*8}I`;b.disabled=!base||base.level===2;});
 const destinations=[...game!.weaponDrops.filter(d=>!d.taken&&!game!.armory.includes(d.weapon)).map(d=>({...d,name:WEAPONS[d.weapon].name,label:'WEAPON'})),...game!.camps.filter(c=>!c.rescued).map(c=>({...c,label:'SURVIVORS'})),...game!.castles.filter(c=>!c.friendly).map(c=>({...c,label:'RECLAIM'}))].sort((a,b)=>dist(p,a)-dist(p,b));
 const destination=destinations[0]??{...game!.nest,name:'Plague nest',label:'DESTROY'};const angle=Math.atan2(destination.x-p.x,-(destination.z-p.z))-yaw;const bearing=Math.atan2(Math.sin(angle),Math.cos(angle));
 $('wayfinder').textContent=`${Math.abs(bearing)<.35?'↑':bearing>0?'→':'←'} ${destination.label} · ${destination.name} · ${Math.round(dist(p,destination))}m`;
 const enemy=game!.castles.find(c=>!c.friendly&&dist(p,c)<4);if(enemy)prompt=game!.actors.some(a=>(a.kind==='zombie'||a.kind==='corrupted')&&a.hp>0&&(a.castle===enemy.id||dist(a,enemy)<10))?'Defeat the castle defenders before capturing.':`Hold E / A / Interact to reclaim · ${Math.floor(enemy.capture/5*100)}%`;
 if(game!.camps.some(c=>!c.rescued&&dist(p,c)<4))prompt='Clear nearby undead, then hold E / A / Interact to rescue.';if(game!.caches.some(c=>!c.taken&&dist(p,c)<3))prompt='E / A / Interact · Collect wood, iron and healing supplies.';const rack=game!.weaponDrops.find(d=>!d.taken&&dist(p,d)<3);if(rack)prompt=`E / A / Interact · Recover ${WEAPONS[rack.weapon].name} for the fellowship`;if(dist(p,game!.nest)<8)prompt=game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)?'Destroy the plague nest. Keep every castle under friendly control.':'The nest is protected. Hold all castles and rescue all groups.';const fallen=game!.actors.find(a=>a.downed&&dist(p,a)<3&&a.id!==p.id);if(fallen)prompt=`Hold E / A / Interact to revive ${fallen.name} · ${Math.floor((fallen.revive??0)/3*100)}% · ${Math.max(0,Math.ceil(fallen.deadUntil-game!.time))}s left`;if(p.hp<=0)prompt=p.downed?`CALL FOR HELP · Rescue ${Math.floor((p.revive??0)/3*100)}% · Corruption in ${Math.max(0,Math.ceil(p.deadUntil-game!.time))}s`:'Your corrupted knight remains. Your spirit is returning.';$('prompt').textContent=prompt;
 const map=$<HTMLCanvasElement>('minimap'),ctx=map.getContext('2d')!;ctx.clearRect(0,0,map.width,map.height);const pos=(v:{x:number;z:number})=>({x:(v.x-BOUNDS.minX)/(BOUNDS.maxX-BOUNDS.minX)*180,y:(v.z-BOUNDS.minZ)/(BOUNDS.maxZ-BOUNDS.minZ)*230});for(const r of REGIONS){const top=pos({x:0,z:r.offset-205}).y;ctx.fillStyle=r.id==='march'?'#34564055':r.id==='moor'?'#72544055':'#71899a55';ctx.fillRect(0,top,180,230*240/(BOUNDS.maxZ-BOUNDS.minZ));}ctx.strokeStyle='#a19d6e55';ctx.beginPath();for(const c of game!.castles){const v=pos(c);ctx.lineTo(v.x,v.y);}ctx.stroke();for(const c of game!.castles){const v=pos(c);ctx.fillStyle=c.friendly?'#90c4a5':'#cd8c70';ctx.fillRect(v.x-5,v.y-5,10,10);}for(const d of game!.weaponDrops){if(d.taken)continue;const v=pos(d);ctx.fillStyle='#9ddfee';ctx.fillRect(v.x-2,v.y-2,4,4);}for(const c of game!.camps){const v=pos(c);ctx.fillStyle=c.rescued?'#718c78':'#d9b86f';ctx.fillRect(v.x-2,v.y-2,4,4);}const nest=pos(game!.nest);ctx.fillStyle='#c573ad';ctx.fillRect(nest.x-4,nest.y-4,8,8);for(const a of game!.actors.filter(a=>a.kind==='player')){const v=pos(a);ctx.fillStyle=a.id===id?'#fff9d5':'#76bdcf';ctx.beginPath();ctx.arc(v.x,v.y,3,0,Math.PI*2);ctx.fill();if(a.id===id){ctx.strokeStyle='#fff9d5';ctx.beginPath();ctx.moveTo(v.x,v.y);ctx.lineTo(v.x+Math.sin(yaw)*7,v.y-Math.cos(yaw)*7);ctx.stroke();}}
 const boss=game!.actors.find(a=>(a.name?.includes('Champion')||a.name?.includes('Fallen')||a.id==='boss-plague'||a.maxHp>=200)&&a.hp>0&&dist(a,p)<45);
 const bossBar=$('bossBar');
 if(boss){
  bossBar.style.display='block';
  $('bossName').textContent=boss.name.toUpperCase();
  $('bossHealth').style.width=Math.max(0,Math.min(100,(boss.hp/boss.maxHp)*100))+'%';
 }else if(dist(p,game!.nest)<36&&game!.nest.hp>0&&game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)){
  bossBar.style.display='block';
  $('bossName').textContent='PLAGUE NEST CRYSTAL';
  $('bossHealth').style.width=Math.max(0,Math.min(100,(game!.nest.hp/500)*100))+'%';
 }else{
  bossBar.style.display='none';
 }
}
function frame(now:number){const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;let pads:Gamepad[]=[];try{pads=Array.from(navigator.getGamepads?.()??[]).filter((p):p is Gamepad=>!!p&&p.connected&&p.mapping==='standard');}catch{}const pad=pads.find(p=>p.index===padIndex)||pads[0];if(pad){padIndex=pad.index;padName=pad.id;}else{padName='';padPrev=[];menuPrev=[];}
 const padConnected=!!pad;
 if(padConnected!==padWasConnected){
  padWasConnected=padConnected;
  if(padConnected){
   rumblePad=pad as RumblePad;setPadHints(true);applyInputHints();
   const label=(pad?.id||'Gamepad').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim().slice(0,32)||'Gamepad';
   toast(`Controller connected: ${label}. RT Attack · LT Block · B Sweep · X Heal · A Interact.`);
  }else{
   rumblePad=null;stopRumble();setPadHints(false);applyInputHints();
   toast('Controller disconnected. Keyboard and mouse controls active.');
  }
 }else if(padConnected)rumblePad=pad as RumblePad;
 let strafe=touch.mx+(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),forward=touch.forward+(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),attack=mouse.attack||touch.attack,block=mouse.block||touch.block,interact=keys.has('KeyE')||touch.interact;
 if(pad){const d=readPad(pad,padPrev,deadzoneAmount);if(!game||guide.open||result.open)menuGamepad(pad);else if(!document.hidden){strafe+=d.mx;forward+=d.forward;yaw+=d.lookX*dt*2.6*padSensitivity;pitch=clamp(pitch-d.lookY*dt*1.8*padSensitivity*(invert?-1:1),-1.05,1.05);attack ||=d.attack;block ||=d.block;interact ||=d.interact;if(pad.buttons.some(b=>b.pressed))combatAudio.unlock();if(d.toggle)cameraToggle();if(d.heal)cmd('heal');if(d.sweep)cmd('sweep');if(d.menu)openGuide();for(const action of d.commands)cmd(action);}padPrev=d.previous;}
 const p=me();if(game&&p){if(now-lastSend>=50){const inactive=guide.open||result.open||document.hidden;send({type:'input',input:{mx:inactive?0:Math.cos(yaw)*strafe+Math.sin(yaw)*forward,mz:inactive?0:Math.sin(yaw)*strafe-Math.cos(yaw)*forward,yaw,attack:!inactive&&attack,block:!inactive&&block,interact:!inactive&&interact,seq:seq++}});lastSend=now;}if(now-lastHud>100){updateHud(p);lastHud=now;}}
updateCaptions(now);pollCaptionWeather(dt);pollCaptionActors(p,dt);
 if(now>toastUntil)$('toast').textContent='';updateAudioPause();paintPerf(now);ambience.update(dt,game,p);view.draw(game,p,yaw,pitch,first,dt,now/1000);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
try{const s=JSON.parse(sessionStorage.getItem('ss-session')||'null');if(s?.code&&s?.token){code=s.code;token=s.token;connect('resume');}}catch{}
