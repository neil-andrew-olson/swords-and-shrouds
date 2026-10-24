import type {Game} from '../shared/types';
import {dist} from '../shared/world';
export type CombatCue={kind:'swing'|'impact'|'hurt'|'equip'|'block'|'siege';heavy:boolean;volume:number;material?:'metal'|'flesh';weapon?:string};
export type SwingProfile='thrust'|'cleave'|'crush'|'sweep';
export type EventCue='capture'|'rescue'|'siege'|'victory'|'defeat';
/** Weapon identity → swing synthesis family. Unknown/missing weapons keep the generic whoosh. */
const SWING_PROFILES:Record<string,SwingProfile>={sword:'thrust',rapier:'thrust',spear:'thrust',flamberge:'cleave',dane_axe:'cleave',zweihander:'cleave',mace:'crush',hammer:'crush',bastard:'crush',poleaxe:'sweep',halberd:'sweep'};
export function swingProfile(weapon?:string):SwingProfile|undefined{return weapon?SWING_PROFILES[weapon]:undefined;}
/** Compare authoritative snapshots. Initial/replayed snapshots must remain silent. */
export function combatCues(before:Game|undefined,after:Game,id:string):CombatCue[]{
 if(!before||after.time<=before.time||after.time-before.time>1)return [];
 const me=after.actors.find(a=>a.id===id),oldMe=before.actors.find(a=>a.id===id);if(!me||!oldMe)return [];
 const cues:CombatCue[]=[],heavy=me.weapon==='hammer'||me.weapon==='zweihander';
 if(me.hp>0&&(me.attackSerial??0)>(oldMe.attackSerial??0))cues.push({kind:'swing',heavy,volume:1,weapon:me.weapon});
 if(me.hp<oldMe.hp)cues.push({kind:'hurt',heavy:false,volume:1});
 if(me.weapon!==oldMe.weapon)cues.push({kind:'equip',heavy,volume:.6});
 if(me.block&&!oldMe.block)cues.push({kind:'block',heavy:false,volume:.7});
 if(!before.siege?.active&&after.siege?.active)cues.push({kind:'siege',heavy:true,volume:1});
 const old=new Map(before.actors.map(a=>[a.id,a]));let impacts=0;
 for(const a of after.actors){
  const prior=old.get(a.id),range=dist(a,me);
  if(a.id===id||!prior||a.hp>=prior.hp||range>12)continue;
  cues.push({kind:'impact',heavy,volume:Math.max(.12,1-range/14),material:a.kind==='zombie'||a.kind==='corrupted'?'flesh':'metal'});
  if(++impacts>=3)break;
 }
 return cues;
}
/** One-shot milestone cues from two authoritative snapshots. Like combatCues(), the initial snapshot,
 * replayed snapshots, reconnects (>1s gap) and restarts (time travel) stay silent, so a milestone only
 * ever fires on its transition. */
export function eventCues(before:Game|undefined,after:Game):EventCue[]{
 if(!before||after.time<=before.time||after.time-before.time>1)return [];
 const cues:EventCue[]=[];
 if(after.stats.captures>before.stats.captures)cues.push('capture');
 if(after.stats.rescues>before.stats.rescues)cues.push('rescue');
 if(!before.siege?.active&&after.siege?.active)cues.push('siege');
 if(after.status==='victory'&&before.status!=='victory')cues.push('victory');
 else if(after.status==='defeat'&&before.status!=='defeat')cues.push('defeat');
 return cues;
}
const MAX_VOICES=10;
const clamp01=(v:number)=>(v<0?0:v>1?1:v);
/** Layered procedural combat audio: transient + body per cue, a generated room impulse,
 * distance-scaled volume from the cue and a hard cap on simultaneous voices. Swing cues get a
 * weapon-family layer (thrust/cleave/crush/sweep) on top of the generic whoosh, and short
 * milestone stingers (capture/rescue/siege/victory/defeat) reuse the same synth. */
export class CombatAudio{
 private context?:AudioContext;
 private master?:GainNode;
 private reverb?:ConvolverNode;
 private noise?:AudioBuffer;
 private voices=0;
 private lastPlay=0;
 private eventVoices=0;
 private paused=false;
 constructor(private enabled:()=>boolean){}
 unlock(){
  if(!this.enabled())return;
  try{
   if(!this.context)this.context=new AudioContext();
   const context=this.context;
   if(!this.master)this.build(context);
   if(this.paused){if(context.state==='running')void context.suspend().catch(()=>{});}
   else if(context.state==='suspended')void context.resume().catch(()=>{});
  }catch{}
 }
 /** Suspend synthesised audio while the tab is hidden or a dialog pauses the game (CPU win);
  * resume on return. The Sound checkbox remains authoritative through enabled(). */
 setPaused(paused:boolean){
  if(this.paused===paused)return;
  this.paused=paused;
  const context=this.context;if(!context)return;
  try{if(paused)void context.suspend().catch(()=>{});else if(this.enabled())void context.resume().catch(()=>{});}catch{}
 }
 private build(c:AudioContext){
  const master=c.createGain();master.gain.value=.9;master.connect(c.destination);this.master=master;
  // Short algorithmic room impulse: decaying stereo noise, reused for every cue.
  const length=Math.ceil(c.sampleRate*.6),impulse=c.createBuffer(2,length,c.sampleRate);
  for(let channel=0;channel<2;channel++){const data=impulse.getChannelData(channel);for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2.8);}
  const reverb=c.createConvolver();reverb.buffer=impulse;
  const wet=c.createGain();wet.gain.value=.16;reverb.connect(wet);wet.connect(master);this.reverb=reverb;
  const noise=c.createBuffer(1,Math.ceil(c.sampleRate*1.5),c.sampleRate),data=noise.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  this.noise=noise;
 }
 private noiseLayer(c:AudioContext,out:GainNode,now:number,type:BiquadFilterType,f0:number,f1:number,q:number,duration:number,peak:number,delay=0){
  const buffer=this.noise;if(!buffer)return;
  const start=now+delay,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
  source.buffer=buffer;filter.type=type;filter.Q.value=q;
  filter.frequency.setValueAtTime(Math.max(40,f0),start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40,f1),start+duration);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.008);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  source.connect(filter);filter.connect(gain);gain.connect(out);
  source.start(start,Math.random()*.4);source.stop(start+duration+.02);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
 }
 private toneLayer(c:AudioContext,out:GainNode,now:number,type:OscillatorType,f0:number,f1:number,duration:number,peak:number,delay=0){
  const start=now+delay,osc=c.createOscillator(),gain=c.createGain();
  osc.type=type;osc.frequency.setValueAtTime(Math.max(20,f0),start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20,f1),start+duration);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.01);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(gain);gain.connect(out);
  osc.start(start);osc.stop(start+duration+.02);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 /** Weapon-family layer stacked on the generic swing whoosh. */
 private swingVoice(c:AudioContext,out:GainNode,now:number,profile:SwingProfile|undefined){
  switch(profile){
   case 'thrust':
    this.noiseLayer(c,out,now,'bandpass',3200,1300,1.15,.17,.05);
    this.noiseLayer(c,out,now,'highpass',4200,2400,.7,.12,.018);
    this.toneLayer(c,out,now,'sine',880,610,.13,.016);
    break;
   case 'cleave':
    this.noiseLayer(c,out,now,'bandpass',880,150,.7,.4,.062);
    this.noiseLayer(c,out,now,'lowpass',620,120,.8,.3,.03);
    this.toneLayer(c,out,now,'sine',92,52,.32,.045);
    break;
   case 'crush':
    this.noiseLayer(c,out,now,'lowpass',620,90,.9,.26,.075);
    this.toneLayer(c,out,now,'sine',72,37,.3,.075);
    this.noiseLayer(c,out,now,'bandpass',1800,700,1.4,.1,.02);
    break;
   case 'sweep':
    this.noiseLayer(c,out,now,'bandpass',1500,290,.8,.32,.052);
    this.noiseLayer(c,out,now,'highpass',2400,1100,.6,.18,.016);
    this.toneLayer(c,out,now,'sine',128,70,.26,.032);
    break;
  }
 }
 /** Short milestone motif. Deliberately bypasses the combat voice cap (but keeps its own small one)
  * so a transition stinger is never dropped because of a burst of impact cues. */
 playEvent(kind:EventCue){
  const c=this.context,out=this.master;
  if(!c||!out||this.paused||c.state!=='running'||!this.enabled())return;
  if(this.eventVoices>=3)return;
  this.eventVoices++;
  const now=c.currentTime,voice=c.createGain();voice.gain.value=.9;
  voice.connect(out);if(this.reverb)voice.connect(this.reverb);
  let span=1;
  switch(kind){
   case 'capture':
    this.toneLayer(c,voice,now,'triangle',293.66,290,.32,.07);
    this.toneLayer(c,voice,now,'triangle',440,435,.34,.06,.15);
    this.toneLayer(c,voice,now,'triangle',587.33,580,.55,.06,.3);
    this.toneLayer(c,voice,now,'sine',1174.66,1160,.5,.018,.3);
    this.noiseLayer(c,voice,now,'highpass',3200,1400,.7,.5,.016,.02);
    span=.92;break;
   case 'rescue':
    this.toneLayer(c,voice,now,'sine',659.25,656,.8,.05);
    this.toneLayer(c,voice,now,'sine',1318.51,1312,.55,.016);
    this.toneLayer(c,voice,now,'triangle',1975.53,1960,.36,.01);
    this.toneLayer(c,voice,now,'sine',880,876,.85,.038,.24);
    this.toneLayer(c,voice,now,'sine',1760,1752,.6,.012,.24);
    this.noiseLayer(c,voice,now,'highpass',4000,2200,.8,.35,.014,.24);
    span=1.12;break;
   case 'siege':
    this.toneLayer(c,voice,now,'triangle',146.83,143,.6,.07);
    this.toneLayer(c,voice,now,'triangle',138.59,135,.7,.06,.45);
    this.toneLayer(c,voice,now,'sine',73.42,70,1.3,.09);
    this.noiseLayer(c,voice,now,'lowpass',600,140,1.1,.9,.05);
    this.noiseLayer(c,voice,now,'bandpass',900,300,1.2,.5,.03);
    span=1.4;break;
   case 'victory':
    this.toneLayer(c,voice,now,'triangle',261.63,259,.38,.07);
    this.toneLayer(c,voice,now,'triangle',329.63,327,.38,.065,.16);
    this.toneLayer(c,voice,now,'triangle',392,389,.4,.06,.32);
    this.toneLayer(c,voice,now,'triangle',523.25,519,1,.07,.48);
    this.toneLayer(c,voice,now,'sine',1046.5,1038,.9,.02,.48);
    this.noiseLayer(c,voice,now,'highpass',2600,1200,.7,.8,.018,.02);
    span=1.55;break;
   case 'defeat':
    this.toneLayer(c,voice,now,'sine',220,216,.55,.06);
    this.toneLayer(c,voice,now,'sine',174.61,171,.6,.055,.3);
    this.toneLayer(c,voice,now,'sine',146.83,143,1.1,.06,.62);
    this.toneLayer(c,voice,now,'sine',55,36,1.8,.08);
    this.noiseLayer(c,voice,now,'lowpass',320,80,1.7,.8,.04);
    span=1.9;break;
  }
  const life=c.createOscillator(),lifeGain=c.createGain();
  life.frequency.value=23;lifeGain.gain.value=.0001;
  life.connect(lifeGain);lifeGain.connect(out);
  life.start(now);life.stop(now+span);
  life.onended=()=>{this.eventVoices=Math.max(0,this.eventVoices-1);life.disconnect();lifeGain.disconnect();voice.disconnect();};
 }
 play(cue:CombatCue){
  const c=this.context,out=this.master;
  if(!c||!out||this.paused||c.state!=='running'||!this.enabled())return;
  const now=c.currentTime,volume=clamp01(cue.volume);
  if(volume<=.001)return;
  if(this.voices>=MAX_VOICES){if(now-this.lastPlay<1.5)return;this.voices=0;}
  this.lastPlay=now;this.voices++;
  const voice=c.createGain();voice.gain.value=volume;
  voice.connect(out);if(this.reverb)voice.connect(this.reverb);
  const heavy=cue.heavy;
  switch(cue.kind){
   case 'swing':
    this.noiseLayer(c,voice,now,'bandpass',heavy?1000:2100,heavy?220:520,.75,heavy?.34:.22,.075);
    this.noiseLayer(c,voice,now,'highpass',1400,600,.6,.16,.022);
    if(heavy)this.toneLayer(c,voice,now,'sine',112,55,.27,.06);
    this.swingVoice(c,voice,now,swingProfile(cue.weapon));
    break;
   case 'impact':{
    const metal=cue.material!=='flesh';
    if(metal){
     this.noiseLayer(c,voice,now,'bandpass',4200,1800,3.2,.16,.09);
     this.toneLayer(c,voice,now,'square',1180,900,.2,.03);
     this.toneLayer(c,voice,now,'sine',1740,1500,.15,.022);
     this.toneLayer(c,voice,now,'sine',heavy?118:168,56,.2,.085);
    }else{
     this.noiseLayer(c,voice,now,'lowpass',1600,260,1.1,.18,.10);
     this.noiseLayer(c,voice,now,'bandpass',520,190,1.4,.22,.05);
     this.toneLayer(c,voice,now,'sine',heavy?108:148,52,.2,.095);
    }
    this.noiseLayer(c,voice,now,'highpass',2200,900,.8,.09,.02);
    break;
   }
   case 'hurt':
    this.noiseLayer(c,voice,now,'bandpass',900,220,1.1,.24,.085);
    this.noiseLayer(c,voice,now,'highpass',1800,700,.7,.14,.03);
    this.toneLayer(c,voice,now,'sine',96,48,.26,.11);
    break;
   case 'equip':
    this.toneLayer(c,voice,now,'triangle',780,760,.3,.05);
    this.toneLayer(c,voice,now,'sine',1180,1155,.26,.03);
    this.toneLayer(c,voice,now,'sine',1560,1500,.2,.022);
    this.noiseLayer(c,voice,now,'highpass',3000,1800,.8,.1,.02);
    break;
   case 'block':
    this.noiseLayer(c,voice,now,'bandpass',3600,900,2.2,.18,.09);
    this.toneLayer(c,voice,now,'square',620,590,.35,.04);
    this.toneLayer(c,voice,now,'sine',1490,1470,.3,.034);
    this.toneLayer(c,voice,now,'sine',2320,2290,.24,.024);
    this.toneLayer(c,voice,now,'sine',150,70,.2,.09);
    break;
   case 'siege':
    this.toneLayer(c,voice,now,'sine',120,34,1.1,.22);
    this.toneLayer(c,voice,now,'triangle',70,40,.9,.06);
    this.noiseLayer(c,voice,now,'lowpass',420,90,.9,.9,.12);
    this.noiseLayer(c,voice,now,'bandpass',1400,500,1.5,.35,.05,.08);
    break;
  }
  // One inaudible voice-keeper per cue: frees the cap and the per-cue nodes when done.
  const span=cue.kind==='siege'?1.4:cue.kind==='block'?.5:cue.kind==='equip'?.42:cue.kind==='hurt'?.4:cue.kind==='impact'?.36:heavy?.44:.3;
  const life=c.createOscillator(),lifeGain=c.createGain();
  life.frequency.value=24;lifeGain.gain.value=.0001;
  life.connect(lifeGain);lifeGain.connect(out);
  life.start(now);life.stop(now+span);
  life.onended=()=>{this.voices=Math.max(0,this.voices-1);life.disconnect();lifeGain.disconnect();voice.disconnect();};
 }
}
