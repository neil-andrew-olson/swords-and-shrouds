import {PLAYER_CHARACTERS,isPlayerCharacter} from '../shared/characters';
import './style.css';
import {CombatAudio,combatCues,eventCues} from './combat-feedback';
import {Ambience} from './ambience';
import {WEAPON_IDS,WEAPONS,weaponStats} from '../shared/weapons';
import {WorldView} from './scene';
import {weaponCombatProfile} from './equipment';
import {readPad,deadzoneValue,DEADZONE_PRESETS,type DeadzonePreset,captionText,captionAllowed,CAPTION_RATE_LIMIT_MS,type CaptionCue,touchStickVector,touchSensitivityValue,deriveObjectiveLine,deriveJournalSummary,type JournalInput,type JournalSummary,type ObjectiveLine,type ObjectivePoint,DIFFICULTY_CHOICES,DEFAULT_DIFFICULTY,type DifficultyId,isDifficultyId,difficultyId,difficultyChoice,bossBarState,type BossBarModel,deriveRunRecap,type RunRecap,bashChordReady,formatBashHint,casterCueForEvent,stalkerCueForEvent,wardenCueForEvent} from './controller';
import {LORE_ENTRIES,LORE_STORAGE_KEY,loreEntryViews,unlockedLoreIds,newlyUnlockedLore,formatLoreToast,type LoreEntry,type LoreState} from '../shared/lore';
import {dist,clamp,BOUNDS,REGIONS,CASTLES,CAMPS,NEST} from '../shared/world';
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

// ---- Campaign journal overlay (created here so the HUD/Guide buttons exist before frame starts) ----
const journal=document.createElement('dialog');
journal.id='journal';journal.className='journal';journal.setAttribute('aria-label','Campaign journal');
journal.innerHTML=`<div class="journal-head"><div><span class="eyebrow">CAMPAIGN JOURNAL</span><h2 id="journalTitle">The war for the kingdom</h2></div><button id="closeJournal" type="button">Close · J</button></div>
<div class="journal-scroll" id="journalScroll">
 <section class="journal-section" id="journalCampaign"><h3>Reclaim the kingdom</h3><p id="journalCastles"></p><p id="journalDifficulty"></p><div id="journalRegionList" class="journal-regions"></div></section>
 <section class="journal-section" id="journalSurvivors"><h3>Survivors</h3><p id="journalSurvivorsLine"></p><p id="journalCampsLine"></p></section>
 <section class="journal-section" id="journalNest"><h3>The plague nest</h3><p id="journalNestLine"></p></section>
 <section class="journal-section" id="journalSieges"><h3>Sieges</h3><p id="journalSiegesLine"></p></section>
 <section class="journal-section" id="journalWeapon"><h3>Your weapon</h3><p id="journalWeaponLine"></p></section>
 <section class="journal-section" id="journalControls"><h3>Controls</h3><div id="journalControlsLine" class="journal-controls"></div></section>
 <section class="journal-section" id="journalChronicle"><h3>Chronicle</h3><div id="journalLoreList" class="journal-lore"></div></section>
 <section class="journal-section" id="journalTips"><h3>Field notes</h3><ul id="journalTipsList"></ul></section>
</div>`;
document.body.append(journal);
const JOURNAL_TIPS=[
 'Bring a shield to sieges — blocking beats dodging in a gate.',
 'The plague nest opens only when every castle and survivor group is secured.',
 'Hold Interact at a castle banner for five seconds to reclaim it.',
 'Weapon reach matters: spears and halberds outrange the dead.',
 'Camps with enemies nearby cannot be rescued — clear them first.'
];
$('journalTipsList').innerHTML=JOURNAL_TIPS.map(tip=>`<li>${tip}</li>`).join('');
const journalHudButton=document.createElement('button');
journalHudButton.type='button';journalHudButton.id='journalBtn';journalHudButton.textContent='Journal · J';
const hudTop=document.querySelector('#hud .hud-top');
if(hudTop){const guideButton=document.getElementById('guideBtn');if(guideButton)guideButton.before(journalHudButton);else hudTop.append(journalHudButton);}
const journalGuideButton=document.createElement('button');
journalGuideButton.type='button';journalGuideButton.id='openJournalFromGuide';journalGuideButton.textContent='Open campaign journal · J';
$('closeGuide').after(journalGuideButton);
const bashGuideHint=document.createElement('p');
bashGuideHint.id='bashGuideHint';bashGuideHint.className='guide-bash';
bashGuideHint.textContent='Shield bash: with a shield-capable weapon, hold Block + Attack (right click + left click / LT + RT / Bash button). Costs 14 stamina, 1.1 s cooldown.';
document.querySelector('#guide .settings')?.after(bashGuideHint);

// ---- Difficulty picker (landing: solo/host choice; joiners inherit the host's mode) ----
let selectedDifficulty:DifficultyId=difficultyId(localStorage.getItem('ss-difficulty'));
const difficultyPicker=document.createElement('div');
difficultyPicker.id='difficultyPicker';difficultyPicker.className='difficulty-picker';
difficultyPicker.innerHTML='<span class="difficulty-label">DIFFICULTY</span><div class="difficulty-options" role="group" aria-label="Campaign difficulty"></div><p id="difficultyDescription" class="difficulty-description"></p><p class="difficulty-note">Solo choice, or the host\u2019s choice for co-op — joiners inherit it.</p>';
$('name').after(difficultyPicker);
const difficultyButtons:HTMLButtonElement[]=[];
for(const choice of DIFFICULTY_CHOICES){
 const button=document.createElement('button');
 button.type='button';button.className='difficulty-choice';button.dataset.difficulty=choice.id;
 button.textContent=choice.label;button.setAttribute('aria-pressed','false');
 button.onclick=()=>setDifficulty(choice.id);
 difficultyPicker.querySelector('.difficulty-options')!.append(button);
 difficultyButtons.push(button);
}
function setDifficulty(next:DifficultyId,persist=true){
 selectedDifficulty=difficultyId(next);
 if(persist)localStorage.setItem('ss-difficulty',selectedDifficulty);
 for(const button of difficultyButtons){const active=button.dataset.difficulty===selectedDifficulty;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));}
 const description=$('difficultyDescription');if(description)description.textContent=difficultyChoice(selectedDifficulty).description;
}
setDifficulty(selectedDifficulty,false);

// ---- Boss-siege HP bar (segmented, phase-coloured; hidden unless an active boss siege is alive) ----
const bossSiegeBar=document.createElement('div');
bossSiegeBar.id='bossSiegeBar';bossSiegeBar.hidden=true;
bossSiegeBar.setAttribute('aria-live','polite');
bossSiegeBar.innerHTML='<div id="bossSiegeBanner">BOSS SIEGE · <span id="bossSiegeCastle"></span></div><div id="bossSiegeName">SHROUD WARDEN</div><div id="bossSiegeTrack"><div id="bossSiegeFill"></div></div><div id="bossSiegeMeta"><span id="bossSiegeHp"></span><span id="bossSiegePhase">STEADY</span></div>';
$('hud').append(bossSiegeBar);
const bossSiegeElements={bar:bossSiegeBar,castle:$('bossSiegeCastle'),name:$('bossSiegeName'),fill:$('bossSiegeFill'),hp:$('bossSiegeHp'),phase:$('bossSiegePhase')};
// ---- Shield bash client: block+attack chord sends {type:'bash'} (server-authoritative). ----
let lastBashAt=0,lastBashSentAt=0,lastBashEventAt=0,bashSentCount=0,attackWasDown=false,stungFor:'victory'|'defeat'|null=null;
const bashHint=document.createElement('p');
bashHint.id='bashHint';bashHint.hidden=true;$('vitals')?.append(bashHint);
const bashButton=document.createElement('button');
bashButton.type='button';bashButton.id='bashBtn';bashButton.textContent='Bash';bashButton.hidden=true;
document.querySelector('.touch-actions')?.append(bashButton);
bashButton.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();sendBash();});
function bashCooldownRemaining(now=performance.now()){return Math.max(0,1100-(now-lastBashAt));}
function bashShieldCapable(){const player=me();return !!game&&!!player&&weaponStats(player.weapon).shield;}
function sendBash(){
 const player=me();
 if(!game||!player||player.hp<=0||bashCooldownRemaining()>0||!bashShieldCapable())return false;
 lastBashAt=performance.now();lastBashSentAt=lastBashAt;bashSentCount++;
 send({type:'bash'});
 updateBashHint();
 return true;
}
function updateBashHint(){
 const player=me();
 const capable=!!game&&!!player&&player.hp>0&&weaponStats(player.weapon).shield;
 if(!capable){if(!bashHint.hidden)bashHint.hidden=true;if(!bashButton.hidden)bashButton.hidden=true;return;}
 const serverCd=(player as {bashCd?:number}).bashCd??0;
 const remaining=Math.max(bashCooldownRemaining(),serverCd*1000);
 const text=formatBashHint({shieldCapable:true,cooldownRemaining:remaining,stamina:player.stamina??100});
 if(bashHint.hidden)bashHint.hidden=false;
 if(bashHint.textContent!==text)bashHint.textContent=text??'';
 const label=remaining>0?`Bash · ${(remaining/1000).toFixed(1)}s`:'Bash';
 if(bashButton.hidden)bashButton.hidden=false;
 if(bashButton.textContent!==label)bashButton.textContent=label;
 bashButton.disabled=remaining>0;
}

// ---- Chronicle/lore persistence + end-of-run recap DOM ----
function loadLoreIds():Set<string>{
 try{const raw=localStorage.getItem(LORE_STORAGE_KEY);const parsed=raw?JSON.parse(raw):[];return new Set(Array.isArray(parsed)?parsed.filter((x):x is string=>typeof x==='string'):[]);}catch{return new Set();}
}
const knownLoreIds:Set<string>=loadLoreIds();
let previewLoreStage:'early'|'mid'|'late'|null=null;
let lastRunRecap:RunRecap|null=null;
let previewRecapOutcome:'victory'|'defeat'|null=null;
function saveLoreIds(){try{localStorage.setItem(LORE_STORAGE_KEY,JSON.stringify([...knownLoreIds]));}catch{}}
function loreState():LoreState|null{
 if(!game)return null;
 const stats=game.stats as {bossesFelled?:number;bossesSeen?:number};
 const castlesHeld=game.castles.filter(c=>c.friendly).length;
 const survivorsRescued=game.camps.filter(c=>c.rescued).length;
 const allCastles=castlesHeld===game.castles.length,allSurvivors=survivorsRescued===game.camps.length;
 const bossesFelled=stats.bossesFelled??(game.siege?.bossKilled?1:0);
 return {castlesHeld,castlesTotal:game.castles.length,survivorsRescued,survivorsTotal:game.camps.length,campsRescued:survivorsRescued,campsTotal:game.camps.length,siegesSurvived:game.stats.sieges,nestSealed:allCastles&&allSurvivors,nestVulnerable:allCastles&&allSurvivors&&game.nest.hp>0,bossSeen:!!(game.siege?.boss)||(stats.bossesSeen??0)>0,bossKilled:bossesFelled>0,weaponsRecovered:game.armory.length,difficulty:difficultyId(game.difficulty),victory:game.status==='victory',defeat:game.status==='defeat'};
}
function checkLoreUnlocks(){
 const state=loreState();if(!state)return;
 const fresh=newlyUnlockedLore(knownLoreIds,state);
 if(!fresh.length)return;
 for(const entry of fresh)knownLoreIds.add(entry.id);
 saveLoreIds();
 const text=formatLoreToast(fresh);
 if(text)toast(text);
}
function renderLore(state:LoreState|null){
 const list=$('journalLoreList');if(!list)return;
 const previewIds=previewLoreStage?({
  early:['region-march','castle-keep','survivors-mill'],
  mid:['region-march','region-moor','castle-keep','castle-border','survivors-mill','warden-seen','weapon-lineage'],
  late:LORE_ENTRIES.map(entry=>entry.id)
 }[previewLoreStage]):null;
 const views=loreEntryViews(state??{castlesHeld:0,castlesTotal:9,survivorsRescued:0,survivorsTotal:9,campsRescued:0,campsTotal:9,siegesSurvived:0,nestSealed:false,nestVulnerable:false,bossSeen:false,bossKilled:false,weaponsRecovered:1,difficulty:'knight',victory:false,defeat:false},knownLoreIds);
 const unlocked=previewIds?new Set(previewIds):new Set([...knownLoreIds,...(state?unlockedLoreIds(state):[])]);
 list.replaceChildren(...views.map(view=>{
  const isUnlocked=unlocked.has(view.id);
  const row=document.createElement('div');row.className='journal-lore-entry'+(isUnlocked?' unlocked':' locked');
  const title=document.createElement('strong');title.textContent=isUnlocked?view.title:'Unrecorded — '+view.title;
  const detail=document.createElement('span');detail.textContent=isUnlocked?view.text:'Hint: '+view.hint;
  row.append(title,detail);return row;
 }));
}
const runRecap=document.createElement('div');
runRecap.id='runRecap';runRecap.hidden=true;
runRecap.innerHTML='<h3 id="runRecapTitle">RUN RECAP</h3><div id="runRecapRows" class="run-recap-rows"></div><p id="runRecapEpilogue" class="run-recap-epilogue"></p>';
$('stats')?.after(runRecap);
function updateRunRecap(source:typeof game){
 if(!source)return null;
 const player=source.actors.find(a=>a.id===id);
 const stats=source.stats as {bossesFelled?:number};
 const castlesHeld=source.castles.filter(c=>c.friendly).length;
 const survivorsRescued=source.camps.filter(c=>c.rescued).length;
 const recap=deriveRunRecap({outcome:source.status==='victory'?'victory':'defeat',time:source.time,castlesHeld,castlesTotal:source.castles.length,survivorsRescued,survivorsTotal:source.camps.length,campsRescued:survivorsRescued,campsTotal:source.camps.length,siegesSurvived:source.stats.sieges,bossesFelled:stats.bossesFelled??(source.siege?.bossKilled?1:0),difficulty:source.difficulty,weaponName:weaponStats(player?.weapon).name});
 lastRunRecap=recap;
 runRecap.hidden=false;
 const rows=$('runRecapRows');
 rows.replaceChildren(...recap.rows.map(row=>{const line=document.createElement('div');line.className='run-recap-row';const label=document.createElement('span');label.textContent=row.label;const value=document.createElement('strong');value.textContent=row.value;line.append(label,value);return line;}));
 $('runRecapEpilogue').textContent=recap.epilogue;
 return recap;
}
function previewRunRecap(outcome:'victory'|'defeat'){
 const base=loreState();
 const recap=deriveRunRecap({outcome,time:base?Math.round(600+base.castlesHeld*90):754,castlesHeld:base?.castlesHeld??6,castlesTotal:9,survivorsRescued:base?.survivorsRescued??5,survivorsTotal:9,campsRescued:base?.campsRescued??5,campsTotal:9,siegesSurvived:base?.siegesSurvived??2,bossesFelled:outcome==='victory'?2:1,difficulty:base?.difficulty??selectedDifficulty,weaponName:weaponStats(me()?.weapon).name});
 lastRunRecap=recap;previewRecapOutcome=outcome;
 $('resultTitle').textContent=recap.title;$('resultCopy').textContent=outcome==='victory'?'Nine castles reclaimed across three regions. Every survivor saved. The plague is ended.':'Every stronghold has fallen. Gather your fellowship and try again.';
 $('stats').textContent='';runRecap.hidden=false;
 $('runRecapRows').replaceChildren(...recap.rows.map(row=>{const line=document.createElement('div');line.className='run-recap-row';const label=document.createElement('span');label.textContent=row.label;const value=document.createElement('strong');value.textContent=row.value;line.append(label,value);return line;}));
 $('runRecapEpilogue').textContent=recap.epilogue;
 if(!result.open)result.showModal();
 return recap;
}

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
 const paused=!soundEnabled()||document.hidden||guide.open||result.open||journal.open;
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
 if(reducedMotionQuery?.matches||guide.open||result.open||journal.open||document.hidden)return;
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
 if(guide.open||result.open||journal.open||document.hidden)return true;
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
function openGuide(){if(journal.open)journal.close();stopRumble();release();document.exitPointerLock?.();guide.showModal();menuIndex=0;}
function closeJournalOverlay(){if(journal.open)journal.close();}
function openJournal(){if(journal.open)return;if(guide.open)guide.close();if(result.open)return;stopRumble();release();document.exitPointerLock?.();journal.showModal();menuIndex=0;updateJournal();}
journalHudButton.onclick=openJournal;
journalGuideButton.onclick=()=>{if(guide.open)guide.close();openJournal();};
$('closeJournal').onclick=closeJournalOverlay;
journal.addEventListener('click',e=>{if(e.target===journal)closeJournalOverlay();});
journal.addEventListener('cancel',e=>{e.preventDefault();closeJournalOverlay();});
// ---- Next-objective HUD line: derived from the authoritative snapshot at HUD cadence. ----
const objectiveLineEl=document.createElement('div');
objectiveLineEl.id='objectiveLine';objectiveLineEl.hidden=true;
objectiveLineEl.innerHTML='<span id="objectiveArrow" aria-hidden="true"></span><span id="objectiveText">Join a campaign to see your next objective.</span>';
const objectivesPanel=$('objectives');
const objectivesEyebrow=objectivesPanel?.querySelector('.eyebrow');
if(objectivesEyebrow)objectivesEyebrow.after(objectiveLineEl);else objectivesPanel?.prepend(objectiveLineEl);
const difficultyBadge=document.createElement('span');
difficultyBadge.id='difficultyBadge';difficultyBadge.className='difficulty-badge';difficultyBadge.hidden=true;
objectivesEyebrow?.append(difficultyBadge);
let lastObjective:ObjectiveLine|null=null;
let lastJournalSummary:JournalSummary|null=null;
let previewJournalStage:'early'|'mid'|'late'|null=null;
let previewObjectiveText:string|null=null;
function journalInput(player:Actor):JournalInput{
 const g=game!;const w=weaponStats(player.weapon);
 return {player:{x:player.x,z:player.z},time:g.time,castles:g.castles.map(c=>({id:c.id,name:c.name,x:c.x,z:c.z,region:c.region,friendly:c.friendly})),regions:g.regions.map(r=>({id:r.id,name:r.name})),camps:g.camps.map(c=>({id:c.id,name:c.name,x:c.x,z:c.z,region:(c as {region?:string}).region,rescued:c.rescued})),nest:{x:g.nest.x,z:g.nest.z,hp:g.nest.hp,maxHp:g.nest.maxHp},siege:g.siege?{castle:g.siege.castle,starts:g.siege.starts,active:g.siege.active}:null,nextSiege:g.nextSiege,stats:{captures:g.stats.captures,rescues:g.stats.rescues,sieges:g.stats.sieges},weapon:{id:player.weapon??'sword',name:w.name,damage:w.damage,reach:w.reach,cooldown:w.cooldown,stamina:w.stamina,shield:!!w.shield}};
}
function objectiveArrowFor(player:Actor,target:ObjectivePoint){
 const angle=Math.atan2(target.x-player.x,-(target.z-player.z))-yaw;
 const arrows=['↑','↗','→','↘','↓','↙','←','↖'];
 return arrows[Math.round(((angle+Math.PI*2)%(Math.PI*2))/(Math.PI/4))%8];
}
function updateObjectiveHud(player:Actor){
 if(!game)return;
 const objective=deriveObjectiveLine(journalInput(player));
 lastObjective=objective;
 objectiveLineEl.hidden=false;
 const text=previewObjectiveText??objective.text;
 const textEl=$('objectiveText');
 if(textEl.textContent!==text)textEl.textContent=text;
 const arrowEl=$('objectiveArrow');
 const arrow=objective.target?objectiveArrowFor(player,objective.target):'';
 if(arrowEl && arrowEl.textContent!==arrow)arrowEl.textContent=arrow;
}
function currentDifficulty():DifficultyId{return difficultyId(game?.difficulty??selectedDifficulty);}
function difficultyIsHostChoice(){return !!game&&!!host&&host!==id;}
function updateDifficultyUi(){
 if(!game){difficultyBadge.hidden=true;return;}
 const difficulty=currentDifficulty(),choice=difficultyChoice(difficulty);
 difficultyBadge.hidden=false;
 difficultyBadge.className='difficulty-badge diff-'+difficulty;
 difficultyBadge.textContent=`${choice.label.toUpperCase()}${difficultyIsHostChoice()?' · HOST':''}`;
 difficultyBadge.title=`Difficulty: ${choice.label} — ${choice.description}${difficultyIsHostChoice()?' (host\u2019s choice, read-only)':''}`;
}
function updateBossSiegeBar(model:BossBarModel){
 if(model.visible===bossSiegeBar.hidden)bossSiegeBar.hidden=!model.visible;
 document.body.classList.toggle('boss-siege',model.visible);
 if(!model.visible)return;
 bossSiegeElements.name.textContent=model.name.toUpperCase();
 bossSiegeElements.castle.textContent=model.castle?model.castle.replace(/-/g,' '):'';
 bossSiegeElements.fill.style.width=`${(model.ratio*100).toFixed(1)}%`;
 bossSiegeElements.hp.textContent=`${model.hp} / ${model.maxHp}`;
 bossSiegeElements.phase.textContent=model.phase.toUpperCase();
 bossSiegeBar.classList.toggle('phase-steady',model.phase==='steady');
 bossSiegeBar.classList.toggle('phase-frenzied',model.phase==='frenzied');
 bossSiegeBar.classList.toggle('phase-final',model.phase==='final');
}
function journalControlsLegend(){
 if(padWasConnected)return ['Move — Left stick','Look — Right stick','Attack — RT','Block — LT','Sweep — B','Heal — X','Interact — A','Journal — Start / Menu','Guide — View'];
 if(touchDevice)return ['Move — Left stick','Look — Drag the right side','Attack / Block / Interact — Touch buttons','Shield bash — Bash button','Sweep / Heal — Bottom buttons','Journal — Journal button'];
 return ['Move — WASD','Look — Mouse','Attack — Left click','Block — Right click','Sweep — Q or B','Heal — H','Interact — E','Camera — V','Journal — J','Guide — G'];
}
function previewSummary(summary:JournalSummary):JournalSummary{
 if(!previewJournalStage)return summary;
 const next:JournalSummary=structuredClone(summary);
 if(previewJournalStage==='early'){next.castles.held=1;next.survivors={rescued:1,total:9};next.camps={rescued:1,total:9};next.sieges={...next.sieges,survived:0,nextIn:150};next.nest.protected=true;}
 else if(previewJournalStage==='mid'){next.castles.held=5;next.survivors={rescued:4,total:9};next.camps={rescued:4,total:9};next.sieges={...next.sieges,survived:1,nextIn:45};next.nest.protected=true;}
 else{next.castles.held=9;next.survivors={rescued:9,total:9};next.camps={rescued:9,total:9};next.sieges={...next.sieges,survived:3,nextIn:0};next.nest.protected=false;next.nest.hp=500;}
 const perStage:Record<'early'|'mid'|'late',number[]>={early:[1,0,0],mid:[2,2,1],late:[3,3,3]};
 next.regions=next.regions.map((region,index)=>{const held=perStage[previewJournalStage!][index]??0;return {...region,castlesHeld:held,held:held===region.castlesTotal};});
 return next;
}
/** QA-only demo summary so the journal layout can be captured without joining a server room. */
function previewJournalDemo():JournalSummary{
 const stage=previewJournalStage??'early';
 const friendlyCount=stage==='early'?1:stage==='mid'?5:9;
 const demo:JournalInput={player:{x:0,z:27},time:0,castles:CASTLES.map((c,index)=>({id:c.id,name:c.name,x:c.x,z:c.z,region:c.region,friendly:index<friendlyCount})),regions:REGIONS.map(r=>({id:r.id,name:r.name})),camps:CAMPS.map((c,index)=>({id:c.id,name:c.name,x:c.x,z:c.z,region:c.region,rescued:index<(stage==='early'?1:stage==='mid'?4:9)})),nest:{x:NEST.x,z:NEST.z,hp:500,maxHp:500},siege:null,nextSiege:150,stats:{captures:friendlyCount,rescues:stage==='early'?1:stage==='mid'?4:9,sieges:stage==='late'?3:0},weapon:{id:'spear',name:'War spear',damage:32,reach:5.6,cooldown:.7,stamina:20,shield:true}};
 return previewSummary(deriveJournalSummary(demo));
}
function updateJournal(){
 const castleEl=$('journalCastles'),survivorEl=$('journalSurvivorsLine'),campsEl=$('journalCampsLine'),nestEl=$('journalNestLine'),siegeEl=$('journalSiegesLine'),weaponEl=$('journalWeaponLine'),regionEl=$('journalRegionList'),controlsEl=$('journalControlsLine'),difficultyEl=$('journalDifficulty');
 const difficulty=difficultyChoice(currentDifficulty());
 difficultyEl.textContent=`Difficulty: ${difficulty.label} — ${difficulty.description}${difficultyIsHostChoice()?' (host\u2019s choice, read-only for joiners)':''}`;
 renderLore(loreState());
 let summary:JournalSummary|null=null;
 if(game&&me())summary=previewSummary(deriveJournalSummary(journalInput(me()!)));
 else if(previewJournalStage)summary=previewJournalDemo();
 if(!summary){castleEl.textContent='No campaign in progress — join a room to record your progress.';survivorEl.textContent='';campsEl.textContent='';nestEl.textContent='';siegeEl.textContent='';weaponEl.textContent='';regionEl.replaceChildren();controlsEl.textContent=journalControlsLegend().join(' · ');return;}
 lastJournalSummary=summary;
 castleEl.textContent=`Castles held: ${summary.castles.held} / ${summary.castles.total} · Regions secured: ${summary.regions.filter(r=>r.held).length} / ${summary.regions.length}`;
 regionEl.replaceChildren(...summary.regions.map(region=>{const row=document.createElement('div');row.className='journal-region'+(region.held?' held':'');row.textContent=`${region.held?'†':'‡'} ${region.name} — ${region.castlesHeld}/${region.castlesTotal} castles`;return row;}));
 survivorEl.textContent=`Survivors rescued: ${summary.survivors.rescued} / ${summary.survivors.total}`;
 campsEl.textContent=`Camps secured: ${summary.camps.rescued} / ${summary.camps.total} · +4 recruits per rescue`;
 nestEl.textContent=summary.nest.protected?'Sealed — free every castle and rescue every survivor first.':`Vulnerable — ${summary.nest.hp} / ${summary.nest.maxHp} integrity. Reach the plague nest to end it.`;
 siegeEl.textContent=summary.sieges.active?`Siege underway${summary.sieges.castleName?` at ${summary.sieges.castleName}`:''} — hold the line.`:`Sieges survived: ${summary.sieges.survived} · Next siege in ${summary.sieges.nextIn??'—'} s`;
 weaponEl.textContent=summary.weapon?`${summary.weapon.name} — ${summary.weapon.damage} damage · ${summary.weapon.reach} m reach · ${summary.weapon.cooldown}s cooldown · ${summary.weapon.stamina} stamina · ${summary.weapon.shield?'shield allowed':'two-handed (no shield)'}`:'No weapon equipped.';
 controlsEl.replaceChildren(...journalControlsLegend().map(line=>{const row=document.createElement('div');row.className='journal-control';row.textContent=line;return row;}));
}
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
const qaHooks=window as unknown as {__ssCharacterSelect?:()=>unknown;__ssPad?:()=>unknown;__ssControllerSettings?:()=>unknown;__ssCaptions?:()=>unknown;__ssCaptionDemo?:(cue?:string)=>unknown;__ssAudioState?:()=>unknown;__ssAudioFocus?:(x?:number|null,z?:number|null)=>unknown;__ssObjectives?:()=>unknown;__ssJournal?:()=>unknown;__ssJournalPreview?:(stage?:string|null)=>unknown;__ssObjectivePreview?:(text?:string|null)=>unknown;__ssForceSiege?:(index?:number|null)=>unknown;__ssDifficulty?:()=>unknown;__ssBossBar?:()=>unknown;__ssBash?:()=>unknown;__ssBashSend?:()=>unknown;__ssAudioSting?:(mode?:string|null)=>unknown;__ssAudioScreamer?:()=>unknown;__ssCasterAudio?:(kind?:string|null)=>unknown;__ssStalkerAudio?:(kind?:string|null)=>unknown;__ssWardenAudio?:()=>unknown;__ssLore?:()=>unknown;__ssLorePreview?:(stage?:string|null)=>unknown;__ssRecap?:()=>unknown;__ssRecapPreview?:(outcome?:string|null)=>unknown};
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
 rumbleGuarded:!!reducedMotionQuery?.matches||guide.open||result.open||journal.open||document.hidden,
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
 gated:!captionsEnabled||guide.open||result.open||journal.open||document.hidden,
 paused:guide.open||result.open||journal.open||document.hidden
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
  paused:document.hidden||guide.open||result.open||journal.open,
  contextState:state.contextState,
  weather:state.weather,
  regionBeds:state.regionBeds,
  music:state.music,
  weatherBeds:state.weatherBeds,
  landmarkBeds:state.landmarkBeds,
  siege:state.siege,
  cues:state.cues,
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
/** Read-only campaign objective/journal state for QA (live authoritative snapshot; no side effects). */
qaHooks.__ssObjectives=()=>{
 const player=me();
 if(!game||!player)return {next:lastObjective??{kind:'none',text:'Join a campaign to see your next objective.',detail:'',distance:null,bearing:null,target:null},progress:null,journalOpen:journal.open};
 const input=journalInput(player);
 return {next:deriveObjectiveLine(input),progress:deriveJournalSummary(input),journalOpen:journal.open,previewObjective:previewObjectiveText,previewStage:previewJournalStage};
};
qaHooks.__ssJournal=()=>({
 open:journal.open,
 summary:lastJournalSummary,
 lineText:$('objectiveText')?.textContent??null,
 journalButtonId:'journalBtn',
 openFromGuideId:'openJournalFromGuide',
 closeId:'closeJournal',
});
/** QA-only layout previews (display only, never touches gameplay/authority). */
qaHooks.__ssJournalPreview=(stage?:string|null)=>{
 previewJournalStage=stage==='early'||stage==='mid'||stage==='late'?stage:null;
 if(journal.open)updateJournal();
 return qaHooks.__ssJournal?.();
};
qaHooks.__ssObjectivePreview=(text?:string|null)=>{
 previewObjectiveText=typeof text==='string'?text:null;
 if(game&&me())updateObjectiveHud(me()!);
 else{objectiveLineEl.hidden=previewObjectiveText===null;const textEl=$('objectiveText');if(textEl&&previewObjectiveText!==null)textEl.textContent=previewObjectiveText;}
 return {previewObjective:previewObjectiveText,lineText:$('objectiveText')?.textContent??null};
};
/** QA-only siege trigger: sends {type:'qa-siege', index?} on the live socket. Server side is
 * SS_QA=1-gated; this hook never changes client gameplay state itself. Returns true if the message
 * was handed to an open socket. */
qaHooks.__ssForceSiege=(index?:number|null)=>{
 try{
  const message=typeof index==='number'&&Number.isFinite(index)?{type:'qa-siege',index:Math.max(0,Math.floor(index))}:{type:'qa-siege'};
  send(message);
  return ws?.readyState===WebSocket.OPEN;
 }catch{return false;}
};
/** Read-only difficulty state for QA: picker/localStorage + authoritative room difficulty. */
qaHooks.__ssDifficulty=()=>{
 const difficulty=currentDifficulty(),choice=difficultyChoice(difficulty);
 return {id:difficulty,label:choice.label,description:choice.description,source:difficultyIsHostChoice()?'host':'solo',readonly:difficultyIsHostChoice(),authoritative:game?.difficulty??null,landingSelection:selectedDifficulty,persisted:localStorage.getItem('ss-difficulty'),pickerIds:difficultyButtons.map(button=>button.dataset.difficulty),selectedPickerId:difficultyButtons.find(button=>button.classList.contains('selected'))?.dataset.difficulty??null,badgeText:difficultyBadge.hidden?null:difficultyBadge.textContent,journalText:$('journalDifficulty')?.textContent??null};
};
/** Read-only boss-siege HP bar model + the exact DOM handles QA can gate on. */
qaHooks.__ssBossBar=()=>{
 const siege=game?.siege??null;
 const bossActor=siege?.bossId?game?.actors.find(a=>a.id===siege.bossId):game?.actors.find(a=>(a as unknown as {boss?:boolean}).boss);
 const model=bossBarState(siege?{boss:siege.boss,active:siege.active,castle:siege.castle,bossName:siege.bossName,bossHp:siege.bossHp,bossId:siege.bossId,index:siege.index,bossKilled:siege.bossKilled}:null,bossActor?{hp:bossActor.hp,maxHp:bossActor.maxHp}:undefined);
 return {...model,elementId:'bossSiegeBar',nameId:'bossSiegeName',fillId:'bossSiegeFill',hpId:'bossSiegeHp',phaseId:'bossSiegePhase',bannerId:'bossSiegeBanner',hidden:bossSiegeBar.hidden,phaseClass:model.visible?`phase-${model.phase}`:null,fillWidth:$('bossSiegeFill').style.width||null};
};
/** Read-only chronicle state for QA: entries (unlocked text vs unrecorded hints), stored ids. */
qaHooks.__ssLore=()=>{
 const state=loreState();
 const views=loreEntryViews(state??{castlesHeld:0,castlesTotal:9,survivorsRescued:0,survivorsTotal:9,campsRescued:0,campsTotal:9,siegesSurvived:0,nestSealed:false,nestVulnerable:false,bossSeen:false,bossKilled:false,weaponsRecovered:1,difficulty:'knight',victory:false,defeat:false},knownLoreIds);
 return {storageKey:LORE_STORAGE_KEY,entries:views,unlocked:views.filter(entry=>entry.unlocked).map(entry=>entry.id),locked:views.filter(entry=>!entry.unlocked).map(entry=>entry.id),stored:[...knownLoreIds],state,previewStage:previewLoreStage};
};
/** QA-only display preview of chronicle unlock stages (renders journal + one toast; no persistence). */
qaHooks.__ssLorePreview=(stage?:string|null)=>{
 previewLoreStage=stage==='early'||stage==='mid'||stage==='late'?stage:null;
 renderLore(loreState());
 if(previewLoreStage){
  const ids=previewLoreStage==='early'?['region-march']:previewLoreStage==='mid'?['region-moor','castle-border','warden-seen']:['region-crown','castle-citadel','nest-sealed','end-victory'];
  const title=LORE_ENTRIES.find(entry=>entry.id===ids[0])?.title??'Chronicle';
  toast(`New chronicle entry: ${title}`);
 }
 return qaHooks.__ssLore?.();
};
/** Read-only end-of-run recap model + DOM handles (QA can gate values/epilogue). */
qaHooks.__ssRecap=()=>({
 model:lastRunRecap,
 previewOutcome:previewRecapOutcome,
 resultOpen:result.open,
 containerId:'runRecap',titleId:'runRecapTitle',rowsId:'runRecapRows',epilogueId:'runRecapEpilogue',restartId:'restart',
 rows:$('runRecapRows')?[...$('runRecapRows').querySelectorAll('.run-recap-row')].map(row=>({label:row.querySelector('span')?.textContent??'',value:row.querySelector('strong')?.textContent??''})):[]
});
/** QA-only display preview of the victory/defeat recap (no gameplay effect; does not send restart). */
qaHooks.__ssRecapPreview=(outcome?:string|null)=>{
 previewRecapOutcome=outcome==='victory'||outcome==='defeat'?outcome:null;
 if(!previewRecapOutcome){if(result.open)result.close();runRecap.hidden=true;return qaHooks.__ssRecap?.();}
 previewRunRecap(previewRecapOutcome);
 return qaHooks.__ssRecap?.();
};
/** Read-only shield-bash client state for QA (server-confirmed bashes, cooldown, HUD handles). */
qaHooks.__ssBash=()=>{
 const player=me();const capable=!!player&&!!game&&weaponStats(player.weapon).shield;
 const serverCd=player?(player as {bashCd?:number}).bashCd??0:0;
 const remaining=Math.max(bashCooldownRemaining(),serverCd*1000);
 return {shieldCapable:capable,cooldownRemaining:Math.round(remaining),playerBashCd:player?(player as {bashCd?:number}).bashCd??null:null,lastBashAt:lastBashAt||null,lastBashEventAt:lastBashEventAt||null,sentCount:bashSentCount,lastSentAt:lastBashSentAt||null,serverBashes:game?(game.stats as {bashes?:number}).bashes??null:null,hintId:'bashHint',hintText:bashHint.hidden?null:bashHint.textContent,buttonId:'bashBtn',buttonText:bashButton.hidden?null:bashButton.textContent,buttonHidden:bashButton.hidden,eventName:'ss-bash'};
};
/** QA-only bash trigger (same path as the chord; used for deterministic HUD/rejection tests). */
qaHooks.__ssBashSend=()=>sendBash();
/** QA-only sting trigger (records the same cue fields as the recap moment; no gameplay effect). */
qaHooks.__ssAudioSting=(mode?:string|null)=>{ambience.endingSting(mode==='defeat'?'defeat':'victory');return qaHooks.__ssAudioState?.();};
/** QA-only screamer cue trigger (same synth/state as the server event; no gameplay effect). *//** QA-only caster cue trigger (same synth/captions as the server events; force only bypasses the
 * in-game requirement, not the Captions/Sound settings or the pause gates). */
qaHooks.__ssCasterAudio=(kind?:string|null)=>{
 const cue=kind==='launch'?'launch':kind==='impact'?'impact':'charge';
 if(cue==='charge'){ambience.casterCharge();showCaption('caster-charge',undefined,true);}
 else if(cue==='launch'){ambience.casterLaunch();showCaption('caster-launch',undefined,true);}
 else ambience.casterImpact();
 const caption=$('captions');
 return {cue,captionVisible:!!caption&&!caption.hidden,captionText:caption?.textContent??null,state:qaHooks.__ssAudioState?.()};
};
qaHooks.__ssAudioScreamer=()=>{ambience.screamerShriek();return qaHooks.__ssAudioState?.();};
/** QA-only Stalker lunge/hit cue trigger (same synth/caption path as the server events). */
qaHooks.__ssStalkerAudio=(kind?:string|null)=>{
 const cue=kind==='hit'?'hit':'lunge';
 if(cue==='lunge'){ambience.stalkerLunge();showCaption('stalker-lunge',undefined,true);}
 else ambience.stalkerHit();
 const caption=$('captions');
 return {cue,captionVisible:!!caption&&!caption.hidden,captionText:caption?.textContent??null,state:qaHooks.__ssAudioState?.()};
};
/** QA-only Warden enrage howl trigger (same synth/caption path as the phase event). */
qaHooks.__ssWardenAudio=()=>{
 ambience.wardenEnrage();showCaption('warden-enrage',undefined,true);
 const caption=$('captions');
 return {cue:'enrage',captionVisible:!!caption&&!caption.hidden,captionText:caption?.textContent??null,state:qaHooks.__ssAudioState?.()};
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
 ws.onopen=()=>{const name=$<HTMLInputElement>('name').value.trim()||'Knight';localStorage.setItem('ss-name',name);send({type:mode,name,code:mode==='resume'?code:$<HTMLInputElement>('code').value.trim().toUpperCase(),...(mode==='resume'?{token}:{}),...(mode==='create'?{difficulty:selectedDifficulty}:{})});};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
  if(m.type==='welcome'){cmd('character:'+selectedCharacter);id=m.id;code=m.code;token=m.token;everJoined=true;attempts=0;seq=0;sessionStorage.setItem('ss-session',JSON.stringify({code,token}));$('landing').hidden=true;$('hud').hidden=false;$('roomCode').textContent=code;toast('Campaign started. Clear the Fallen Keep, then hold E / A at its banner.');}
  else if(m.type==='state'){if(!document.hidden){for(const cue of combatCues(game,m.game,id)){combatAudio.play(cue);if(cue.kind==='impact'||cue.kind==='hurt')ambience.duck(1);else if(cue.kind==='swing'||cue.kind==='block')ambience.duck(.55);if(cue.kind==='hurt'){const hudActor=m.game.actors.find((a:Actor)=>a.id===id);const weight=weaponCombatProfile(hudActor?.weapon).weight;rumble(clamp(.16+.24*weight,.2,.55),150);$('hud').classList.remove('hurt-flash');void $('hud').offsetWidth;$('hud').classList.add('hurt-flash');view.shake=Math.max(view.shake,.24);}else if(cue.kind==='block')rumble(.3,90);}for(const event of eventCues(game,m.game)){combatAudio.playEvent(event);if(event==='capture'){rumble(.22,170);const captured=m.game.castles.find((c:{id:string;name:string;friendly:boolean})=>c.friendly&&!game?.castles.find(o=>o.id===c.id)?.friendly);if(captured)showCaption('castle-captured',captured.name);}}
   if(game?.status==='playing'){const wasSiege=!!game.siege?.active,nowSiege=!!m.game.siege?.active;if(nowSiege&&!wasSiege){const target=m.game.castles.find((c:{id:string;name:string})=>c.id===m.game.siege?.castle);const bossName=(m.game.siege as {bossName?:string}|null)?.bossName;showCaption('siege-start',target?.name?`${target.name}${bossName?` · ${bossName} leads the wave`:''}`:bossName??undefined);}else if(!nowSiege&&wasSiege)showCaption('siege-end');}
  }game=m.game;host=m.host;const p=me();if(p&&lastEvent===0)yaw=p.yaw;for(const ev of game!.events)if(ev.id>lastEvent){lastEvent=ev.id;toast(ev.text);tone(260);if(/screamer shrieks/i.test(ev.text))ambience.screamerShriek();if(ev.text==='Shield bash!')lastBashEventAt=performance.now();const casterCue=casterCueForEvent(ev.text);if(casterCue==='charge'){ambience.casterCharge();showCaption('caster-charge');}else if(casterCue==='launch'){ambience.casterLaunch();showCaption('caster-launch');}else if(casterCue==='impact'){ambience.casterImpact();}const stalkerCue=stalkerCueForEvent(ev.text);if(stalkerCue==='lunge'){ambience.stalkerLunge();showCaption('stalker-lunge');}else if(stalkerCue==='hit')ambience.stalkerHit();if(wardenCueForEvent(ev.text)==='enrage'){ambience.wardenEnrage();showCaption('warden-enrage');}}if(game!.status!=='playing'&&!result.open){document.exitPointerLock?.();stopRumble();$('resultTitle').textContent=game!.status==='victory'?'The kingdom lives.':'The last fire fades.';$('resultCopy').textContent=game!.status==='victory'?'Nine castles reclaimed across three regions. Every survivor saved. The plague is ended.':'Every stronghold has fallen. Gather your fellowship and try again.';$('stats').textContent=`${game!.stats.captures} captures · ${game!.stats.rescues} rescues · ${game!.stats.sieges} sieges repelled · ${game!.stats.kills} undead defeated`;document.getElementById('restart')!.hidden=host!==id;updateRunRecap(m.game);const endOutcome=game!.status==='victory'?'victory':game!.status==='defeat'?'defeat':null;if(endOutcome&&stungFor!==endOutcome){ambience.endingSting(endOutcome);stungFor=endOutcome;}result.showModal();}else if(game!.status==='playing'&&result.open){result.close();runRecap.hidden=true;previewRecapOutcome=null;stungFor=null;lastEvent=0;cmd('character:'+selectedCharacter);}}
  else if(m.type==='error'){if(!everJoined){sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;stopped=true;ws?.close();$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}else{toast(m.text);if(/expired|not found/.test(m.text)){stopped=true;sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;setTimeout(()=>location.reload(),2000);}}}
 };
 ws.onclose=e=>{release();if(stopped)return;if(e.code===4000||e.code===4001){stopped=true;sessionStorage.removeItem('ss-session');toast(e.reason);$('connection').textContent=e.reason;setTimeout(()=>location.reload(),2500);return;}if(everJoined&&attempts<8){toast('Connection lost. Reconnecting…');setTimeout(()=>connect('resume'),Math.min(8000,500*2**attempts++));}else{$('connection').textContent='Unable to connect. Try again shortly.';$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}};
 ws.onerror=()=>{$('connection').textContent='The server is unavailable or waking up. Please wait, then try again.';};
}
$('create').onclick=()=>connect('create');$('join').onclick=()=>connect('join');$('restart').onclick=()=>send({type:'restart'});$('leave').onclick=()=>{stopped=true;sessionStorage.removeItem('ss-session');ws?.close();location.href=location.pathname;};
$('invite').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Invitation link copied. Send it to your fellowship.');}catch{toast(`Room code: ${code}. Friends can enter it on this site.`);}};
for(const id of WEAPON_IDS){const w=WEAPONS[id],b=document.createElement('button');b.id='equip-'+id;b.dataset.command='equip:'+id;b.innerHTML=`<strong>${w.name}</strong><span>${w.style}</span><span>${w.damage} damage · ${w.reach} m reach · ${w.stamina} stamina · ${w.cooldown}s recovery</span><small>Join a campaign to equip</small>`;b.disabled=true;$('weaponCards').append(b);}
document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b=>b.onclick=()=>cmd(b.dataset.command!));
window.addEventListener('keydown',e=>{if(e.code==='KeyJ'&&!e.repeat&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLSelectElement)){if(journal.open)closeJournalOverlay();else openJournal();return;}if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||guide.open||result.open||journal.open)return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyR')cmd('nextWeapon');if(e.code==='KeyI')$('armoryBtn').click();if(e.code==='KeyV')cameraToggle();if(e.code==='KeyH')cmd('heal');if(e.code==='KeyQ')cmd('sweep');if(e.code==='Digit1')cmd('follow');if(e.code==='Digit2')cmd('hold');if(e.code==='Digit3')cmd('attack');if(e.code==='KeyG')openGuide();if(e.code==='KeyB'){$('manageCastle').click();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden){release();stopRumble();}updateAudioPause();});
canvas.addEventListener('click',()=>{if(game&&!guide.open&&!result.open&&!journal.open&&matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();});canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('mousedown',e=>{if(document.pointerLockElement===canvas){if(e.button===0){mouse.attack=true;}if(e.button===2)mouse.block=true;}});window.addEventListener('mouseup',e=>{if(e.button===0)mouse.attack=false;if(e.button===2)mouse.block=false;});document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas)release();});document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){yaw+=e.movementX*.0025*sensitivity;pitch=clamp(pitch-e.movementY*.0025*sensitivity*(invert?-1:1),-1.05,1.05);}});
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
 journalHudButton.textContent=touchDevice?'Journal':'Journal · J';
 journalGuideButton.textContent=touchDevice?'Open campaign journal':'Open campaign journal · J';
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
function menuGamepad(p:Gamepad){const d=readPad(p,padPrev,deadzoneAmount);menuPrev=d.previous;const root=guide.open?guide:journal.open?journal:result.open?result:$('landing');const buttons=[...root.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.hidden&&!b.disabled&&b.offsetParent!==null);if(!buttons.length)return;const up=(p.buttons[12]?.pressed&&!padPrev[12]),down=(p.buttons[13]?.pressed&&!padPrev[13]);if(up)menuIndex=(menuIndex+buttons.length-1)%buttons.length;if(down)menuIndex=(menuIndex+1)%buttons.length;menuIndex%=buttons.length;if(up||down)buttons[menuIndex].focus();if(p.buttons[0]?.pressed&&!padPrev[0])buttons[menuIndex].click();if(d.menu&&(guide.open||journal.open)){if(guide.open)guide.close();else closeJournalOverlay();}}
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
 const siegeBossActive=!!game!.siege?.boss&&!!game!.siege?.active&&!game!.siege.bossKilled&&(game!.siege.bossHp??0)>0;
 const siegeBossActor=game!.siege?.bossId?game!.actors.find(a=>a.id===game!.siege!.bossId):game!.actors.find(a=>(a as unknown as {boss?:boolean}).boss);
 const bossModel=bossBarState(siegeBossActive&&game!.siege?{boss:game!.siege.boss,active:game!.siege.active,castle:game!.siege.castle,bossName:game!.siege.bossName,bossHp:game!.siege.bossHp,bossId:game!.siege.bossId,index:game!.siege.index,bossKilled:game!.siege.bossKilled}:null,siegeBossActor?{hp:siegeBossActor.hp,maxHp:siegeBossActor.maxHp}:undefined);
 updateBossSiegeBar(bossModel);
 if(siegeBossActive){bossBar.style.display='none';}else if(boss){
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
 updateObjectiveHud(p);
 updateDifficultyUi();
 updateBashHint();
 checkLoreUnlocks();
 if(journal.open)updateJournal();
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
 if(game){const bashPlayer=me();if(bashPlayer){const capable=weaponStats(bashPlayer.weapon).shield;if(bashChordReady({block,attack,previousAttack:attackWasDown,shieldCapable:capable,alive:bashPlayer.hp>0,stamina:bashPlayer.stamina??100,cooldownRemaining:bashCooldownRemaining()}))sendBash();attackWasDown=attack;}}
 if(pad){const d=readPad(pad,padPrev,deadzoneAmount);if(!game||guide.open||result.open||journal.open)menuGamepad(pad);else if(!document.hidden){strafe+=d.mx;forward+=d.forward;yaw+=d.lookX*dt*2.6*padSensitivity;pitch=clamp(pitch-d.lookY*dt*1.8*padSensitivity*(invert?-1:1),-1.05,1.05);attack ||=d.attack;block ||=d.block;interact ||=d.interact;if(pad.buttons.some(b=>b.pressed))combatAudio.unlock();if(d.toggle)cameraToggle();if(d.heal)cmd('heal');if(d.sweep)cmd('sweep');if(d.menu)openGuide();for(const action of d.commands)cmd(action);}padPrev=d.previous;}
 const p=me();if(game&&p){if(now-lastSend>=50){const inactive=guide.open||result.open||journal.open||document.hidden;send({type:'input',input:{mx:inactive?0:Math.cos(yaw)*strafe+Math.sin(yaw)*forward,mz:inactive?0:Math.sin(yaw)*strafe-Math.cos(yaw)*forward,yaw,attack:!inactive&&attack,block:!inactive&&block,interact:!inactive&&interact,seq:seq++}});lastSend=now;}if(now-lastHud>100){updateHud(p);lastHud=now;}}
updateCaptions(now);pollCaptionWeather(dt);pollCaptionActors(p,dt);
 if(now>toastUntil)$('toast').textContent='';updateAudioPause();paintPerf(now);ambience.update(dt,game,p);view.draw(game,p,yaw,pitch,first,dt,now/1000);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
try{const s=JSON.parse(sessionStorage.getItem('ss-session')||'null');if(s?.code&&s?.token){code=s.code;token=s.token;connect('resume');}}catch{}
