import type {Actor, Game} from '../shared/types';
import {REGIONS,dist} from '../shared/world';
const clamp01=(v:number)=>(v<0?0:v>1?1:v);
/** Region audio profiles derived from shared/world. Region centres use the same offset-80 mapping
 * the HUD uses to pick the player's region, so the audio regions match the visible region zones. */
const REGION_CENTERS=REGIONS.map(region=>region.offset-80);
const REGION_VOLUMES=[.05,.055,.06];
const REGION_MUSIC=[
 {level:1,filter:1.08,detune:5},   // Green March: warmer/clearer bed
 {level:.9,filter:.82,detune:-7},  // Ashen Moor: darker mode
 {level:.78,filter:.72,detune:-12},// Frozen Crown: muted, thin bed
];
/** Border hysteresis band (metres around the region midpoint) so wind/foley doesn't flip-flop at seams. */
const REGION_HYSTERESIS=14;
/** Weather hook contract from world-scene (window.__ssWeather). All fields optional/defensive. */
type WeatherState={region?:string;phase?:string;intensity?:number;nextChangeAt?:number;flash?:number};
type WeatherWindow={__ssWeather?:()=>WeatherState|undefined};
const WEATHER_VOLUMES=[.055,.06,.05];
/**
 * Procedural WebAudio ambience + adaptive music. Every layer is synthesised at runtime — no audio
 * files: wind, a horde drone that rises with nearby undead, a plague-nest hum/pad (and a dissonant
 * tension pair near the nest), fire crackle + ember bed near castle braziers and camp fires, a
 * low-health heartbeat, footstep cadence, rate-limited distant undead moans/creaks, a very quiet
 * minor-mode music bed (low drone + detuned string-like pads), and per-region ambience layers:
 * Frozen Crown cold gusting wind/whistle/howl/ice cracks, Ashen Moor ash hiss/rumble/ember pops/
 * distant bells/groans, Green March leaf rustle/insect bed/bird chirps.
 *
 * Weather-reactive layers ride on top of that, driven by world-scene's `window.__ssWeather()` hook
 * (region/phase/intensity/nextChangeAt/flash, polled at ~4 Hz): a rain loop with drop plips and
 * delayed thunder after lightning (Green March), snowstorm wind howl + high-frequency snow hush
 * with gusts (Frozen Crown), ash hiss/ember drift/distant groans with haze-driven bus muffling
 * (Ashen Moor). Weather layers crossfade with the region ambience, duck under combat, fade when
 * paused/Sound is off, and are lazily built/torn down.
 *
 * The music bed is adaptive: it fades in during exploration, swells near the plague nest and during
 * an active siege, eases down for a while after a castle capture, ducks under combat via duck()
 * (called from main.ts's authoritative cue stream), and is tinted by the current region (level,
 * filter cutoff and pad detune crossfade smoothly). Silent before unlock() (user gesture) and while
 * Sound is unchecked; the whole graph is context-suspended while paused/hidden.
 *
 * update() is deliberately allocation-light: it loops existing game arrays with plain for-loops,
 * schedules at most one short envelope per step/beat/moan/regional one-shot, only re-targets
 * AudioParams a few times per second, and lazily builds/stops both the music graph and each region
 * bed so they cost nothing when inaudible.
 */
export class Ambience{
 private context?:AudioContext;
 private master?:GainNode;
 private windGain?:GainNode;
 private windFilter?:BiquadFilterNode;
 private hordeGain?:GainNode;
 private hordeFilter?:BiquadFilterNode;
 private nestGain?:GainNode;
 private nestPadGain?:GainNode;
 private fireGain?:GainNode;
 private fireLowGain?:GainNode;
 private stepGain?:GainNode;
 private heartGain?:GainNode;
 private started=false;
 private noise?:AudioBuffer;
 private crackle?:AudioBuffer;
 // Adaptive music graph (built lazily, stopped when inaudible).
 private musicBus?:GainNode;
 private musicFilter?:BiquadFilterNode;
 private musicDrone?:GainNode;
 private musicPad?:GainNode;
 private tensionGain?:GainNode;
 private musicSources:OscillatorNode[]=[];
 private musicBuilt=false;
 private musicIdle=0;
 private bedLevel=0;
 private duckLevel=0;
 private captureRelief=0;
 private prevCaptures=0;
 private capturesSeen=false;
 private nearbyUndead=0;
 private moanTimer=3;
 // Region beds: lazily built per region, crossfaded by weight, torn down when inaudible.
 private regionGain:(GainNode|undefined)[]=[undefined,undefined,undefined];
 private regionSources:AudioScheduledSourceNode[][]=[[],[],[]];
 private regionNodes:AudioNode[][]=[[],[],[]];
 private regionBuilt=[false,false,false];
 private regionIdle=[0,0,0];
 private regionIndex=0;
 private regionSeen=false;
 private regionWeights=[0,0,0];
 private musicDetune:OscillatorNode[]=[];
 private musicDetuneApplied=0;
 private iceTimer=6;
 private emberTimer=4;
 private bellTimer=14;
 private birdTimer=4;
 // Weather-reactive layers (rain/snow/ash), driven by window.__ssWeather and lazily built per kind.
 private masterFilter?:BiquadFilterNode;
 private weatherBus?:GainNode;
 private weatherFilter?:BiquadFilterNode;
 private weatherBuilt=false;
 private weatherGains:(GainNode|undefined)[]=[undefined,undefined,undefined];
 private weatherSources:AudioScheduledSourceNode[][]=[[],[],[]];
 private weatherNodes:AudioNode[][]=[[],[],[]];
 private weatherKindBuilt=[false,false,false];
 private weatherKindIdle=[0,0,0];
 private weatherKindActive=-1;
 private weatherIntensity=0;
 private weatherIntensityTarget=0;
 private weatherPhase='';
 private weatherRegion='';
 private weatherPollTimer=0;
 private weatherFlash=0;
 private weatherFlashSeen=false;
 private lastLightningAt=0;
 private lastLightningCount=-1;
 private thunderAt=0;
 private thunderDelay=-1;
 private thunderStrength=0;
 private plipTimer=1.5;
 private ashGroanTimer=8;
 private coverLevel=0;
 private stepTimer=0;
 private beatTimer=0;
 private slowTimer=0;
 private prevX=0;
 private prevZ=0;
 private hasPrev=false;
 private paused=false;
 constructor(private enabled:()=>boolean){
  // Optional lighting hook: world-scene may dispatch 'ss-lightning' instead of (or as well as)
  // exposing a flash counter; the poll in update() debounces so a strike only thunders once.
  if(typeof window!=='undefined'){
   try{
    window.addEventListener('ss-lightning',((event:Event)=>{
     const detail=(event as CustomEvent<{intensity?:number;delayMs?:number;count?:number}>).detail;
     this.lightning(typeof detail?.intensity==='number'?detail.intensity:1,typeof detail?.delayMs==='number'?detail.delayMs:undefined,typeof detail?.count==='number'?detail.count:undefined);
    }) as EventListener);
   }catch{}
  }
 }
 /** Called from a user gesture. Creates/begins the graph at most once. */
 unlock(){
  if(!this.enabled())return;
  try{
   if(!this.context)this.context=new AudioContext();
   if(!this.started)this.build(this.context);
   if(this.paused){if(this.context.state==='running')void this.context.suspend().catch(()=>{});}
   else if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
  }catch{}
 }
 /** Suspend the ambience beds while the tab is hidden or a dialog pauses the game (CPU win);
  * resume on return. The Sound checkbox remains authoritative through enabled(). */
 setPaused(paused:boolean){
  if(this.paused===paused)return;
  this.paused=paused;
  const context=this.context;if(!context)return;
  try{if(paused)void context.suspend().catch(()=>{});else if(this.enabled())void context.resume().catch(()=>{});}catch{}
 }
 /** Sidechain-style duck: main.ts calls this from the authoritative combat cue stream so the music
  * bed drops under swings/impacts/hurt and recovers over ~0.6 s. */
 duck(strength=1){this.duckLevel=Math.max(this.duckLevel,clamp01(strength));}
 private noiseBuffer(c:AudioContext,seconds:number,pink:boolean):AudioBuffer{
  const length=Math.ceil(c.sampleRate*seconds),buffer=c.createBuffer(1,length,c.sampleRate),data=buffer.getChannelData(0);
  if(pink){let b0=0,b1=0,b2=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;b0=.99765*b0+white*.099046;b1=.963*b1+white*.296516;b2=.5706*b2+white*.115926;data[i]=(b0+b1+b2)*.6;}}
  else for(let i=0;i<length;i++)data[i]=Math.random()*2-1;
  return buffer;
 }
 private crackleBuffer(c:AudioContext):AudioBuffer{
  const length=Math.ceil(c.sampleRate*3.5),buffer=c.createBuffer(1,length,c.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<length;i++){
   if(Math.random()>.0024)continue;
   const amp=.25+Math.random()*.75,pops=2+((Math.random()*5)|0);
   for(let j=0;j<pops&&i+j<length;j++)data[i+j]+=amp*(Math.random()*2-1)*Math.exp(-j/2.1);
  }
  return buffer;
 }
 private build(c:AudioContext){
  const master=c.createGain();master.gain.value=0;
  // Master low-pass is normally transparent, but weather/region haze and standing under castle
  // stonework muffle the whole ambience bus (music included) for an "under cover" feel.
  const masterFilter=c.createBiquadFilter();masterFilter.type='lowpass';masterFilter.frequency.value=20000;masterFilter.Q.value=.4;
  master.connect(masterFilter);masterFilter.connect(c.destination);
  this.master=master;this.masterFilter=masterFilter;
  this.noise=this.noiseBuffer(c,3,true);this.crackle=this.crackleBuffer(c);
  // Wind: looped pink noise through a slowly breathing low-pass.
  const windFilter=c.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=380;windFilter.Q.value=.6;
  const windGain=c.createGain();windGain.gain.value=0;
  const wind=c.createBufferSource();wind.buffer=this.noise;wind.loop=true;
  wind.connect(windFilter);windFilter.connect(windGain);windGain.connect(master);wind.start();
  const gust=c.createOscillator();gust.type='sine';gust.frequency.value=.07;
  const gustGain=c.createGain();gustGain.gain.value=.012;
  gust.connect(gustGain);gustGain.connect(windGain.gain);gust.start();
  const breeze=c.createOscillator();breeze.type='sine';breeze.frequency.value=.045;
  const breezeGain=c.createGain();breezeGain.gain.value=130;
  breeze.connect(breezeGain);breezeGain.connect(windFilter.frequency);breeze.start();
  this.windGain=windGain;this.windFilter=windFilter;
  // Horde: two detuned low saws, quietened behind a low-pass whose cutoff follows pressure.
  const hordeFilter=c.createBiquadFilter();hordeFilter.type='lowpass';hordeFilter.frequency.value=200;hordeFilter.Q.value=1.1;
  const hordeGain=c.createGain();hordeGain.gain.value=0;
  hordeFilter.connect(hordeGain);hordeGain.connect(master);
  for(const freq of [54.4,55.9]){
   const osc=c.createOscillator();osc.type='sawtooth';osc.frequency.value=freq;osc.connect(hordeFilter);osc.start();
  }
  this.hordeGain=hordeGain;this.hordeFilter=hordeFilter;
  // Plague nest: two close low sines beating against each other for an uneasy hum.
  const nestFilter=c.createBiquadFilter();nestFilter.type='lowpass';nestFilter.frequency.value=320;nestFilter.Q.value=.8;
  const nestGain=c.createGain();nestGain.gain.value=0;
  nestFilter.connect(nestGain);nestGain.connect(master);
  for(const freq of [46.6,47.9]){
   const osc=c.createOscillator();osc.type='sine';osc.frequency.value=freq;osc.connect(nestFilter);osc.start();
  }
  const wobble=c.createOscillator();wobble.type='sine';wobble.frequency.value=.11;
  const wobbleGain=c.createGain();wobbleGain.gain.value=.004;
  wobble.connect(wobbleGain);wobbleGain.connect(nestGain.gain);wobble.start();
  this.nestGain=nestGain;
  // Plague pad: a very quiet low fifth that creeps in from further away than the nest hum.
  const padFilter=c.createBiquadFilter();padFilter.type='lowpass';padFilter.frequency.value=150;padFilter.Q.value=.7;
  const nestPad=c.createGain();nestPad.gain.value=0;
  for(const freq of [32.7,49]){
   const osc=c.createOscillator();osc.type='triangle';osc.frequency.value=freq;osc.connect(padFilter);osc.start();
  }
  padFilter.connect(nestPad);nestPad.connect(master);
  const padWobble=c.createOscillator();padWobble.type='sine';padWobble.frequency.value=.07;
  const padWobbleGain=c.createGain();padWobbleGain.gain.value=.003;
  padWobble.connect(padWobbleGain);padWobbleGain.connect(nestPad.gain);padWobble.start();
  this.nestPadGain=nestPad;
  // Fire: looped sparse pops (high-passed) + a very low ember rumble bed.
  const fireFilter=c.createBiquadFilter();fireFilter.type='highpass';fireFilter.frequency.value=900;fireFilter.Q.value=.7;
  const fireGain=c.createGain();fireGain.gain.value=0;
  const fire=c.createBufferSource();fire.buffer=this.crackle;fire.loop=true;
  fire.connect(fireFilter);fireFilter.connect(fireGain);fireGain.connect(master);fire.start();
  this.fireGain=fireGain;
  const emberFilter=c.createBiquadFilter();emberFilter.type='lowpass';emberFilter.frequency.value=420;emberFilter.Q.value=.6;
  const emberGain=c.createGain();emberGain.gain.value=0;
  const ember=c.createBufferSource();ember.buffer=this.noise;ember.loop=true;
  ember.connect(emberFilter);emberFilter.connect(emberGain);emberGain.connect(master);ember.start();
  this.fireLowGain=emberGain;
  // Footsteps: looped noise gated by short envelopes scheduled on movement.
  const stepFilter=c.createBiquadFilter();stepFilter.type='bandpass';stepFilter.frequency.value=380;stepFilter.Q.value=1.1;
  const stepGain=c.createGain();stepGain.gain.value=.0001;
  const steps=c.createBufferSource();steps.buffer=this.noise;steps.loop=true;
  steps.connect(stepFilter);stepFilter.connect(stepGain);stepGain.connect(master);steps.start();
  this.stepGain=stepGain;
  // Heartbeat: one low sine, pulsed by gain envelopes.
  const heart=c.createOscillator();heart.type='sine';heart.frequency.value=46;
  const heartGain=c.createGain();heartGain.gain.value=.0001;
  heart.connect(heartGain);heartGain.connect(master);heart.start();
  this.heartGain=heartGain;
  this.started=true;
 }
 /** Build the music bed lazily (only while it would actually be audible). */
 private ensureMusic(){
  const c=this.context,master=this.master;
  if(!c||!master||this.musicBuilt)return;
  const bus=c.createGain();bus.gain.value=0;bus.connect(master);
  const toneFilter=c.createBiquadFilter();toneFilter.type='lowpass';toneFilter.frequency.value=900;toneFilter.Q.value=.6;
  toneFilter.connect(bus);
  const sources:OscillatorNode[]=[];
  const detunable:OscillatorNode[]=[];
  // Low drone: D1 + D2 + A2 fifth, mix levels kept tiny.
  const drone=c.createGain();drone.gain.value=.012;drone.connect(toneFilter);
  for(const [freq,type,level] of [[36.71,'sine',.5],[73.42,'triangle',.3],[110,'sine',.16]] as const){
   const osc=c.createOscillator();osc.type=type;osc.frequency.value=freq;
   const g=c.createGain();g.gain.value=level;osc.connect(g);g.connect(drone);osc.start();sources.push(osc);detunable.push(osc);
  }
  // String-like pads: D minor (D3, F3, A3, D4), two detuned triangles per note for chorus width.
  const padFilter=c.createBiquadFilter();padFilter.type='lowpass';padFilter.frequency.value=1100;padFilter.Q.value=.5;
  const pad=c.createGain();pad.gain.value=.013;padFilter.connect(pad);pad.connect(toneFilter);
  for(const freq of [146.83,174.61,220,293.66])for(const cents of [-7,7]){
   const osc=c.createOscillator();osc.type='triangle';osc.frequency.value=freq*Math.pow(2,cents/1200);
   const g=c.createGain();g.gain.value=.14;osc.connect(g);g.connect(padFilter);osc.start();sources.push(osc);detunable.push(osc);
  }
  // Slow filter breathing + gain shimmer so the pads drift like bowed strings.
  const breathe=c.createOscillator();breathe.type='sine';breathe.frequency.value=.05;
  const breatheGain=c.createGain();breatheGain.gain.value=240;
  breathe.connect(breatheGain);breatheGain.connect(padFilter.frequency);breathe.start();sources.push(breathe);
  const shimmer=c.createOscillator();shimmer.type='sine';shimmer.frequency.value=.083;
  const shimmerGain=c.createGain();shimmerGain.gain.value=.003;
  shimmer.connect(shimmerGain);shimmerGain.connect(pad.gain);shimmer.start();sources.push(shimmer);
  // Tension: quiet minor-second pair that only rises near the plague nest.
  const tensionFilter=c.createBiquadFilter();tensionFilter.type='lowpass';tensionFilter.frequency.value=280;tensionFilter.Q.value=.8;
  const tension=c.createGain();tension.gain.value=0;
  tensionFilter.connect(tension);tension.connect(toneFilter);
  for(const freq of [77.78,78.4]){
   const osc=c.createOscillator();osc.type='sine';osc.frequency.value=freq;
   const g=c.createGain();g.gain.value=.22;osc.connect(g);g.connect(tensionFilter);osc.start();sources.push(osc);
  }
  this.musicBus=bus;this.musicFilter=toneFilter;this.musicDrone=drone;this.musicPad=pad;this.tensionGain=tension;this.musicSources=sources;this.musicDetune=detunable;this.musicDetuneApplied=0;this.musicBuilt=true;
 }
 /** Tear the music graph down when the bed has been inaudible for a while (CPU win). */
 private stopMusic(){
  if(!this.musicBuilt)return;
  for(const osc of this.musicSources){try{osc.stop();}catch{}try{osc.disconnect();}catch{}}
  this.musicSources=[];
  for(const node of [this.musicBus,this.musicDrone,this.musicPad,this.tensionGain]){try{node?.disconnect();}catch{}}
  this.musicBus=undefined;this.musicFilter=undefined;this.musicDrone=undefined;this.musicPad=undefined;this.tensionGain=undefined;
  this.musicDetune=[];this.musicDetuneApplied=0;
  this.musicBuilt=false;this.musicIdle=0;
 }
 /** Nearest shared/world region index for a world z coordinate (0 march, 1 moor, 2 crown). */
 private nearestRegion(z:number){
  let best=0,bestDistance=Infinity;
  for(let i=0;i<REGION_CENTERS.length;i++){const distance=Math.abs(z-REGION_CENTERS[i]);if(distance<bestDistance){bestDistance=distance;best=i;}}
  return best;
 }
 /** One looped-noise bed source with its own filter/gain, registered for teardown. */
 private noiseLoop(c:AudioContext,type:BiquadFilterType,frequency:number,q:number,level:number,out:AudioNode,sources:AudioScheduledSourceNode[],nodes:AudioNode[]){
  const noise=this.noise;if(!noise)return undefined;
  const source=c.createBufferSource();source.buffer=noise;source.loop=true;
  const filter=c.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
  const gain=c.createGain();gain.gain.value=level;
  source.connect(filter);filter.connect(gain);gain.connect(out);
  source.start();sources.push(source);nodes.push(filter,gain);
  return {filter,gain};
 }
 /** Build one region's continuous ambience beds lazily (only while that region is audible). */
 private ensureRegion(index:number){
  const c=this.context,master=this.master;
  if(!c||!master||this.regionBuilt[index])return;
  const gain=c.createGain();gain.gain.value=0;gain.connect(master);
  const sources:AudioScheduledSourceNode[]=[];const nodes:AudioNode[]=[gain];
  if(index===2){
   // Frozen Crown: cold gusting band-passed wind, a thin high whistle drift, and a low howl.
   const wind=this.noiseLoop(c,'bandpass',620,.8,.55,gain,sources,nodes);
   if(wind){
    const gust=c.createOscillator();gust.type='sine';gust.frequency.value=.07;
    const gustGain=c.createGain();gustGain.gain.value=170;
    gust.connect(gustGain);gustGain.connect(wind.filter.frequency);gust.start();sources.push(gust);nodes.push(gustGain);
   }
   const whistle=this.noiseLoop(c,'bandpass',1500,7,.12,gain,sources,nodes);
   if(whistle){
    const drift=c.createOscillator();drift.type='sine';drift.frequency.value=.043;
    const driftGain=c.createGain();driftGain.gain.value=90;
    drift.connect(driftGain);driftGain.connect(whistle.filter.frequency);drift.start();sources.push(drift);nodes.push(driftGain);
   }
   const howl=c.createOscillator();howl.type='triangle';howl.frequency.value=84;
   const howlGain=c.createGain();howlGain.gain.value=.035;
   const howlLfo=c.createOscillator();howlLfo.type='sine';howlLfo.frequency.value=.05;
   const howlLfoGain=c.createGain();howlLfoGain.gain.value=6;
   howl.connect(howlGain);howlGain.connect(gain);howlLfo.connect(howlLfoGain);howlLfoGain.connect(howl.detune);
   howl.start();howlLfo.start();sources.push(howl,howlLfo);nodes.push(howlGain,howlLfoGain);
  }else if(index===1){
   // Ashen Moor: ash/sand wind hiss over a low ash rumble that slowly breathes.
   this.noiseLoop(c,'highpass',1800,.7,.32,gain,sources,nodes);
   const rumble=this.noiseLoop(c,'lowpass',170,.8,.5,gain,sources,nodes);
   if(rumble){
    const drift=c.createOscillator();drift.type='sine';drift.frequency.value=.06;
    const driftGain=c.createGain();driftGain.gain.value=45;
    drift.connect(driftGain);driftGain.connect(rumble.filter.frequency);drift.start();sources.push(drift);nodes.push(driftGain);
   }
  }else{
   // Green March: leaf rustle with a slow flutter, plus a quiet cricket-like insect bed.
   const rustle=this.noiseLoop(c,'bandpass',1600,.7,.4,gain,sources,nodes);
   if(rustle){
    const flutter=c.createOscillator();flutter.type='sine';flutter.frequency.value=.19;
    const flutterGain=c.createGain();flutterGain.gain.value=220;
    flutter.connect(flutterGain);flutterGain.connect(rustle.filter.frequency);flutter.start();sources.push(flutter);nodes.push(flutterGain);
   }
   const insects=this.noiseLoop(c,'bandpass',3600,7,.16,gain,sources,nodes);
   if(insects){
    const chirp=c.createOscillator();chirp.type='sine';chirp.frequency.value=7.2;
    const chirpGain=c.createGain();chirpGain.gain.value=.12;
    chirp.connect(chirpGain);chirpGain.connect(insects.gain.gain);chirp.start();sources.push(chirp);nodes.push(chirpGain);
   }
  }
  this.regionGain[index]=gain;this.regionSources[index]=sources;this.regionNodes[index]=nodes;this.regionBuilt[index]=true;
 }
 /** Tear one region bed down when it has been inaudible for a while (CPU win). */
 private stopRegion(index:number){
  if(!this.regionBuilt[index])return;
  for(const source of this.regionSources[index]){try{source.stop();}catch{}try{source.disconnect();}catch{}}
  for(const node of this.regionNodes[index]){try{node.disconnect();}catch{}}
  this.regionSources[index]=[];this.regionNodes[index]=[];this.regionGain[index]=undefined;
  this.regionBuilt[index]=false;this.regionIdle[index]=0;
 }
 // ---- weather-reactive layers (rain/snow/ash), driven by world-scene's window.__ssWeather hook ----
 /** Poll the weather hook at ~4 Hz and remember its state; fully defensive if it is absent. */
 private pollWeather(){
  if(typeof window==='undefined')return;
  const hook=(window as unknown as WeatherWindow).__ssWeather;
  if(typeof hook!=='function')return;
  let weather:WeatherState|undefined;
  try{weather=hook();}catch{return;}
  if(!weather)return;
  this.weatherPhase=typeof weather.phase==='string'?weather.phase:'';
  this.weatherRegion=typeof weather.region==='string'?weather.region:'';
  this.weatherIntensityTarget=typeof weather.intensity==='number'?clamp01(weather.intensity):0;
  const flash=typeof weather.flash==='number'?weather.flash:0;
  if(!this.weatherFlashSeen){this.weatherFlashSeen=true;this.weatherFlash=flash;}
  else if(flash<this.weatherFlash)this.weatherFlash=flash;
  else if(flash>this.weatherFlash){this.weatherFlash=flash;if(this.weatherIntensityTarget>.02)this.lightning(this.weatherIntensityTarget,undefined,flash);}
 }
 private weatherKindForPhase(){
  // Check snow/ash before rain so "snowstorm" classifies as snow, not rain.
  const phase=this.weatherPhase.toLowerCase();
  if(/snow|blizzard|frost|hail/.test(phase))return 1;
  if(/ash|haze|smoke|dust|ember/.test(phase))return 2;
  if(/rain|storm|shower|drizzle|downpour/.test(phase))return 0;
  return -1;
 }
 private weatherRegionIndex(){
  const id=this.weatherRegion.toLowerCase();
  for(let i=0;i<REGIONS.length;i++)if(REGIONS[i].id===id)return i;
  return this.regionIndex;
 }
 /** Schedule a thunder rumble a moment after a lightning flash (from the flash counter or the
  * optional 'ss-lightning' event). Deduplicated by strike count/timestamp so the same strike only
  * ever produces one rumble, whether it arrives as an event, a counter bump, or both. */
 lightning(strength=1,delayMs?:number,count?:number){
  const stamp=typeof performance!=='undefined'?performance.now():Date.now();
  if(typeof count==='number'){
   if(count===this.lastLightningCount)return;
   this.lastLightningCount=count;
  }else if(stamp-this.lastLightningAt<2200)return;
  this.lastLightningAt=stamp;
  const delay=typeof delayMs==='number'?Math.max(.2,delayMs/1000):1.2+Math.random()*1.4;
  this.thunderStrength=Math.max(this.thunderStrength,clamp01(strength));
  const c=this.context;
  if(c&&this.weatherBuilt)this.thunderAt=Math.max(this.thunderAt,c.currentTime+delay);
  else this.thunderDelay=Math.max(this.thunderDelay,delay);
 }
 private ensureWeather(){
  const c=this.context,master=this.master;
  if(!c||!master||this.weatherBuilt)return;
  const bus=c.createGain();bus.gain.value=1;
  const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=20000;filter.Q.value=.4;
  bus.connect(filter);filter.connect(master);
  this.weatherBus=bus;this.weatherFilter=filter;this.weatherBuilt=true;
 }
 private ensureWeatherKind(kind:number){
  const c=this.context,bus=this.weatherBus;
  if(!c||!bus||this.weatherKindBuilt[kind])return;
  const gain=c.createGain();gain.gain.value=0;gain.connect(bus);
  const sources:AudioScheduledSourceNode[]=[];const nodes:AudioNode[]=[gain];
  if(kind===0){
   // Rain: broadband hiss + a high patter layer.
   this.noiseLoop(c,'highpass',520,.7,.5,gain,sources,nodes);
   this.noiseLoop(c,'bandpass',2600,.5,.32,gain,sources,nodes);
  }else if(kind===1){
   // Snowstorm: gusting band-passed howl + high-frequency snow hush.
   const howl=this.noiseLoop(c,'bandpass',380,2.2,.5,gain,sources,nodes);
   if(howl){
    const gust=c.createOscillator();gust.type='sine';gust.frequency.value=.09;
    const gustGain=c.createGain();gustGain.gain.value=130;
    gust.connect(gustGain);gustGain.connect(howl.filter.frequency);gust.start();sources.push(gust);nodes.push(gustGain);
   }
   this.noiseLoop(c,'lowpass',1600,.7,.3,gain,sources,nodes);
  }else{
   // Ashen Moor: dry ash hiss + slow ash drift.
   this.noiseLoop(c,'highpass',2200,.8,.4,gain,sources,nodes);
   const drift=this.noiseLoop(c,'bandpass',700,1.5,.25,gain,sources,nodes);
   if(drift){
    const weave=c.createOscillator();weave.type='sine';weave.frequency.value=.05;
    const weaveGain=c.createGain();weaveGain.gain.value=60;
    weave.connect(weaveGain);weaveGain.connect(drift.filter.frequency);weave.start();sources.push(weave);nodes.push(weaveGain);
   }
  }
  this.weatherGains[kind]=gain;this.weatherSources[kind]=sources;this.weatherNodes[kind]=nodes;this.weatherKindBuilt[kind]=true;
 }
 private stopWeatherKind(kind:number){
  if(!this.weatherKindBuilt[kind])return;
  for(const source of this.weatherSources[kind]){try{source.stop();}catch{}try{source.disconnect();}catch{}}
  for(const node of this.weatherNodes[kind]){try{node.disconnect();}catch{}}
  this.weatherSources[kind]=[];this.weatherNodes[kind]=[];this.weatherGains[kind]=undefined;
  this.weatherKindBuilt[kind]=false;this.weatherKindIdle[kind]=0;
 }
 /** Delayed distant thunder rumble (long low tail), scaled by the flash intensity. */
 private playThunder(strength:number){
  const c=this.context,bus=this.weatherBus;
  if(!c||!bus||!this.enabled()||this.paused)return;
  const now=c.currentTime;
  const voice=c.createGain();voice.gain.value=1;voice.connect(bus);
  const nodes:AudioNode[]=[voice];
  let pending=0;
  const cleanup=()=>{if(--pending<=0)for(const node of nodes){try{node.disconnect();}catch{}}};
  const roll=(delay:number,duration:number,peak:number)=>{
   const noise=this.noise;if(!noise)return;
   const start=now+delay,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
   source.buffer=noise;filter.type='lowpass';filter.Q.value=.7;
   filter.frequency.setValueAtTime(200,start);
   filter.frequency.exponentialRampToValueAtTime(70,start+duration);
   gain.gain.setValueAtTime(.0001,start);
   gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.08);
   gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
   source.connect(filter);filter.connect(gain);gain.connect(voice);nodes.push(filter,gain);
   pending++;source.onended=cleanup;source.start(start,Math.random()*.5);source.stop(start+duration+.02);
  };
  roll(0,1.6+strength*1.2,.006+.022*strength);
  roll(.35+Math.random()*.6,2+strength*1.8,.004+.016*strength);
  const osc=c.createOscillator(),oscGain=c.createGain();
  osc.type='sine';osc.frequency.setValueAtTime(48,now);osc.frequency.exponentialRampToValueAtTime(28,now+2);
  oscGain.gain.setValueAtTime(.0001,now);
  oscGain.gain.exponentialRampToValueAtTime(.004+.018*strength,now+.1);
  oscGain.gain.exponentialRampToValueAtTime(.0001,now+2.2);
  osc.connect(oscGain);oscGain.connect(voice);nodes.push(oscGain);
  pending++;osc.onended=cleanup;osc.start(now);osc.stop(now+2.3);
 }
 /** Sparse high drop plink on nearby surfaces during rain. */
 private rainPlip(){
  const c=this.context,bus=this.weatherBus;
  if(!c||!bus||!this.enabled()||this.paused)return;
  const now=c.currentTime,voice=c.createGain();voice.gain.value=1;
  const nodes:AudioNode[]=[voice];
  if(typeof c.createStereoPanner==='function'){const panner=c.createStereoPanner();panner.pan.value=Math.random()*1.6-.8;voice.connect(panner);panner.connect(bus);nodes.push(panner);}else voice.connect(bus);
  const osc=c.createOscillator(),gain=c.createGain();
  const f=2400+Math.random()*2000;
  osc.type='sine';osc.frequency.setValueAtTime(f,now);osc.frequency.exponentialRampToValueAtTime(f*.7,now+.09);
  gain.gain.setValueAtTime(.0001,now);
  gain.gain.exponentialRampToValueAtTime(.004+.004*this.weatherIntensity,now+.006);
  gain.gain.exponentialRampToValueAtTime(.0001,now+.1);
  osc.connect(gain);gain.connect(voice);nodes.push(gain);
  osc.onended=()=>{for(const node of nodes){try{node.disconnect();}catch{}}};
  osc.start(now);osc.stop(now+.12);
 }
 /** Low distant groan in the ash haze. */
 private ashGroan(){
  const c=this.context,bus=this.weatherBus;
  if(!c||!bus||!this.enabled()||this.paused)return;
  const now=c.currentTime,voice=c.createGain();voice.gain.value=1;
  const nodes:AudioNode[]=[voice];
  if(typeof c.createStereoPanner==='function'){const panner=c.createStereoPanner();panner.pan.value=Math.random()*1.4-.7;voice.connect(panner);panner.connect(bus);nodes.push(panner);}else voice.connect(bus);
  const osc=c.createOscillator(),gain=c.createGain(),filter=c.createBiquadFilter();
  filter.type='lowpass';filter.frequency.value=240;
  osc.type='sawtooth';osc.frequency.setValueAtTime(74+Math.random()*16,now);osc.frequency.exponentialRampToValueAtTime(46,now+1);
  gain.gain.setValueAtTime(.0001,now);
  gain.gain.exponentialRampToValueAtTime(.004+.002*this.weatherIntensity,now+.18);
  gain.gain.exponentialRampToValueAtTime(.0001,now+1.1);
  osc.connect(filter);filter.connect(gain);gain.connect(voice);nodes.push(filter,gain);
  osc.onended=()=>{for(const node of nodes){try{node.disconnect();}catch{}}};
  osc.start(now);osc.stop(now+1.15);
 }
 /** Sparse, rate-limited regional one-shots (ice cracks, ember pops, distant bells, bird chirps,
  * groans), always very quiet and panned into the distance. */
 private oneShot(kind:'ice'|'ember'|'bell'|'bird'|'groan'){
  const c=this.context,master=this.master;
  if(!c||!master||!this.enabled()||this.paused)return;
  const now=c.currentTime;
  const voice=c.createGain();voice.gain.value=1;
  const nodes:AudioNode[]=[voice];
  if(typeof c.createStereoPanner==='function'){
   const panner=c.createStereoPanner();panner.pan.value=Math.random()*1.6-.8;
   voice.connect(panner);panner.connect(master);nodes.push(panner);
  }else voice.connect(master);
  let pending=0;
  const cleanup=()=>{if(--pending<=0)for(const node of nodes){try{node.disconnect();}catch{}}};
  const tone=(type:OscillatorType,f0:number,f1:number,duration:number,peak:number,delay=0)=>{
   const start=now+delay,osc=c.createOscillator(),gain=c.createGain();
   osc.type=type;osc.frequency.setValueAtTime(Math.max(20,f0),start);
   osc.frequency.exponentialRampToValueAtTime(Math.max(20,f1),start+duration);
   gain.gain.setValueAtTime(.0001,start);
   gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.01);
   gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
   osc.connect(gain);gain.connect(voice);nodes.push(gain);
   pending++;osc.onended=cleanup;osc.start(start);osc.stop(start+duration+.02);
  };
  const burst=(type:BiquadFilterType,f0:number,f1:number,q:number,duration:number,peak:number,delay=0)=>{
   const noise=this.noise;if(!noise)return;
   const start=now+delay,source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
   source.buffer=noise;filter.type=type;filter.Q.value=q;
   filter.frequency.setValueAtTime(Math.max(40,f0),start);
   filter.frequency.exponentialRampToValueAtTime(Math.max(40,f1),start+duration);
   gain.gain.setValueAtTime(.0001,start);
   gain.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+.008);
   gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
   source.connect(filter);filter.connect(gain);gain.connect(voice);nodes.push(filter,gain);
   pending++;source.onended=cleanup;source.start(start,Math.random()*.4);source.stop(start+duration+.02);
  };
  switch(kind){
   case 'ice':burst('bandpass',2000,1450,5,.24,.014);tone('sine',2600,1650,.3,.006);break;
   case 'ember':burst('bandpass',1100,600,2,.16,.012);tone('sine',120,58,.2,.007);break;
   case 'bell':{const f=520+Math.random()*260;tone('sine',f,f*.998,1.6,.0045);tone('sine',f*1.5,f*1.497,1.3,.0025);break;}
   case 'bird':{const base=2600+Math.random()*900;for(let k=0;k<3;k++)tone('sine',base+k*220,base*.92+k*200,.075,.006,k*.11);break;}
   case 'groan':tone('sawtooth',82,54,.9,.006);burst('lowpass',400,180,1,.8,.004,.05);break;
  }
  if(!pending)for(const node of nodes){try{node.disconnect();}catch{}}
 }
 private footstep(){
  const c=this.context,step=this.stepGain;if(!c||!step)return;
  const t=c.currentTime+.005;step.gain.cancelScheduledValues(t);
  step.gain.setValueAtTime(.0001,t);
  step.gain.exponentialRampToValueAtTime(.045+Math.random()*.02,t+.014);
  step.gain.exponentialRampToValueAtTime(.0001,t+.11);
 }
 private heartbeat(intensity:number){
  const c=this.context,heart=this.heartGain;if(!c||!heart)return;
  const t=c.currentTime+.005,peak=.018+.075*intensity;heart.gain.cancelScheduledValues(t);
  heart.gain.setValueAtTime(.0001,t);
  heart.gain.exponentialRampToValueAtTime(peak,t+.02);
  heart.gain.exponentialRampToValueAtTime(.0001,t+.16);
  heart.gain.setValueAtTime(.0001,t+.22);
  heart.gain.exponentialRampToValueAtTime(peak*.72,t+.24);
  heart.gain.exponentialRampToValueAtTime(.0001,t+.36);
 }
 /** One rate-limited, distant undead moan/creak, scaled by nearby undead count. */
 private moan(count:number){
  const c=this.context,master=this.master;
  if(!c||!master||!this.enabled()||this.paused)return;
  const now=c.currentTime,strength=clamp01(count/7),peak=.005+.007*strength,dur=.9+Math.random()*.8;
  const voice=c.createGain();voice.gain.setValueAtTime(.0001,now);
  voice.gain.exponentialRampToValueAtTime(peak,now+.16);
  voice.gain.exponentialRampToValueAtTime(.0001,now+dur);
  const cleanup:AudioNode[]=[];
  if(typeof c.createStereoPanner==='function'){
   const panner=c.createStereoPanner();panner.pan.value=Math.random()*1.2-.6;
   voice.connect(panner);panner.connect(master);cleanup.push(panner);
  }else voice.connect(master);
  cleanup.push(voice);
  if(Math.random()<.35){
   // Dry stone/wood creak.
   const source=c.createBufferSource();
   const noise=this.noise;
   if(!noise){try{voice.disconnect();}catch{}return;}
   source.buffer=noise;
   const filter=c.createBiquadFilter();filter.type='bandpass';filter.frequency.value=900+Math.random()*500;filter.Q.value=9;
   const gain=c.createGain();gain.gain.setValueAtTime(.0001,now);
   gain.gain.exponentialRampToValueAtTime(peak*.55,now+.05);
   gain.gain.exponentialRampToValueAtTime(.0001,now+.42);
   source.connect(filter);filter.connect(gain);gain.connect(voice);
   source.start(now,Math.random()*.6);source.stop(now+dur+.05);
   source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();for(const n of cleanup){try{n.disconnect();}catch{}}};
  }else{
   // Low moan: a sine sliding down with a breathy noise layer, low-passed to sound distant.
   const osc=c.createOscillator();osc.type='sine';
   const f0=104+Math.random()*36;osc.frequency.setValueAtTime(f0,now);
   osc.frequency.exponentialRampToValueAtTime(f0*.72,now+dur);
   const oscGain=c.createGain();oscGain.gain.value=.8;
   osc.connect(oscGain);oscGain.connect(voice);osc.start(now);osc.stop(now+dur+.02);
   const breath=c.createBufferSource();
   const noise=this.noise;
   if(noise){
    breath.buffer=noise;
    const breathFilter=c.createBiquadFilter();breathFilter.type='bandpass';breathFilter.frequency.value=520;breathFilter.Q.value=1.3;
    const breathGain=c.createGain();breathGain.gain.setValueAtTime(.0001,now);
    breathGain.gain.exponentialRampToValueAtTime(peak*.18,now+.12);
    breathGain.gain.exponentialRampToValueAtTime(.0001,now+dur*.85);
    breath.connect(breathFilter);breathFilter.connect(breathGain);breathGain.connect(voice);
    breath.start(now,Math.random()*.8);breath.stop(now+dur+.02);
    breath.onended=()=>{breath.disconnect();breathFilter.disconnect();breathGain.disconnect();};
   }
   osc.onended=()=>{osc.disconnect();oscGain.disconnect();for(const n of cleanup){try{n.disconnect();}catch{}}};
  }
 }
 update(dt:number,game:Game|undefined,me:Actor|undefined){
  const c=this.context,master=this.master;
  if(!c||!master||!this.started||this.paused)return;
  if(dt>.1)dt=.1;if(dt<=0)dt=.001;
  const now=c.currentTime,enabled=this.enabled(),playing=!!game&&game.status==='playing';
  const masterTarget=!enabled?0:!game?.72:playing?1:.28;
  this.duckLevel=Math.max(0,this.duckLevel-dt*1.6);
  if(this.captureRelief>0)this.captureRelief=Math.max(0,this.captureRelief-dt/24);
  this.slowTimer+=dt;
  if(this.slowTimer>=.08){
   this.slowTimer=0;
   master.gain.setTargetAtTime(masterTarget,now,.22);
   let undead=0,nestLevel=0,nestPadLevel=0,nestSwell=0,fireLevel=0;
   if(game&&me){
    for(const a of game.actors){
     if(a.hp<=0||(a.kind!=='zombie'&&a.kind!=='corrupted'))continue;
     if(dist(a,me)<34)undead++;
    }
    const nestD=dist(me,game.nest);
    if(nestD<170){const near=1-nestD/170;nestLevel=near*near*Math.sqrt(near);nestSwell=clamp01(near);}
    if(nestD<260){const near=1-nestD/260;nestPadLevel=near*near*.02;}
    let fireD=Infinity,archD=Infinity;
    for(const castle of game.castles){const d=dist(me,castle);if(d<fireD)fireD=d;if(d<archD)archD=d;}
    for(const camp of game.camps){const d=dist(me,camp);if(d<fireD)fireD=d;}
    if(fireD<28){const near=1-fireD/28;fireLevel=near*near*(.62+Math.random()*.38);}
    this.coverLevel=archD<14?clamp01((14-archD)/8):0;
   }
   this.nearbyUndead=undead;
   // Capture easing: the bed eases down for ~24 s after a castle is taken.
   if(game){
    if(!this.capturesSeen){this.prevCaptures=game.stats.captures;this.capturesSeen=true;}
    else if(game.stats.captures>this.prevCaptures){this.prevCaptures=game.stats.captures;this.captureRelief=1;}
   }
   // ---- region state: nearest shared/world region, border hysteresis, then a smooth weight crossfade ----
   if(me){
    const nearest=this.nearestRegion(me.z);
    if(!this.regionSeen){this.regionSeen=true;this.regionIndex=nearest;this.regionWeights=[0,0,0];this.regionWeights[nearest]=1;}
    else if(nearest!==this.regionIndex){
     const current=REGION_CENTERS[this.regionIndex],target=REGION_CENTERS[nearest];
     const boundary=(current+target)/2,direction=target>current?1:-1;
     if((me.z-boundary)*direction>REGION_HYSTERESIS)this.regionIndex=nearest;
    }
   }
   let target0=0,target1=0,target2=0;
   if(this.regionIndex===0)target0=1;else if(this.regionIndex===1)target1=1;else target2=1;
   this.regionWeights[0]+=(target0-this.regionWeights[0])*.055;
   this.regionWeights[1]+=(target1-this.regionWeights[1])*.055;
   this.regionWeights[2]+=(target2-this.regionWeights[2])*.055;
   const regionActive=playing&&!!me;
   for(let i=0;i<3;i++){
    const target=regionActive&&enabled?this.regionWeights[i]*REGION_VOLUMES[i]:0;
    if(target>.0008){
     this.ensureRegion(i);this.regionIdle[i]=0;
     const regionGain=this.regionGain[i];if(regionGain)regionGain.gain.setTargetAtTime(target,now,.55);
    }else if(this.regionBuilt[i]){
     const regionGain=this.regionGain[i];if(regionGain)regionGain.gain.setTargetAtTime(0,now,.4);
     this.regionIdle[i]+=.08;if(this.regionIdle[i]>2.5)this.stopRegion(i);
    }
   }
   // ---- weather-reactive layers: poll world-scene's hook, then crossfade the matching bed ----
   this.weatherPollTimer+=.08;
   if(this.weatherPollTimer>=.25){this.weatherPollTimer=0;this.pollWeather();}
   this.weatherIntensity+=(this.weatherIntensityTarget-this.weatherIntensity)*.06;
   const weatherKind=this.weatherKindForPhase();
   this.weatherKindActive=weatherKind;
   const weatherRegionWeight=clamp01(this.regionWeights[this.weatherRegionIndex()]??0);
   const weatherLevel=enabled?this.weatherIntensity*weatherRegionWeight:0;
   if(weatherKind>=0&&weatherLevel>.004){this.ensureWeather();this.ensureWeatherKind(weatherKind);}
   for(let kind=0;kind<3;kind++){
    const audible=weatherKind===kind&&weatherLevel>.004;
    const weatherGain=this.weatherGains[kind];
    if(audible){
     this.weatherKindIdle[kind]=0;
     const cover=kind===0?1-.35*this.coverLevel:1;
     if(weatherGain)weatherGain.gain.setTargetAtTime(weatherLevel*WEATHER_VOLUMES[kind]*cover,now,.6);
    }else if(this.weatherKindBuilt[kind]){
     if(weatherGain)weatherGain.gain.setTargetAtTime(0,now,.5);
     this.weatherKindIdle[kind]+=.08;
     if(this.weatherKindIdle[kind]>2.5)this.stopWeatherKind(kind);
    }
   }
   const weatherBus=this.weatherBus;
   if(weatherBus)weatherBus.gain.setTargetAtTime(enabled?1-.7*this.duckLevel:0,now,.12);
   // Region hue + weather haze muffle the whole ambience bus; castle stonework close by dulls it
   // further ("under cover" during rain). Weather muffling only applies where that weather is local.
   const weatherInfluence=weatherKind>=0?clamp01(weatherRegionWeight)*this.weatherIntensity:0;
   const masterFilter=this.masterFilter;
   if(masterFilter){
    let cutoff=20000*(this.regionWeights[0]+this.regionWeights[1]*.55+this.regionWeights[2]*.8);
    if(weatherKind===1)cutoff*=1-.45*weatherInfluence;
    else if(weatherKind===2)cutoff*=1-.5*weatherInfluence;
    else if(weatherKind===0)cutoff*=1-.12*weatherInfluence;
    if(this.coverLevel>0)cutoff=Math.min(cutoff,2400-900*(1-this.coverLevel));
    masterFilter.frequency.setTargetAtTime(Math.max(1200,cutoff),now,.4);
   }
   const wind=this.windGain,windFilter=this.windFilter;
   if(wind){
    const base=me?me.z<-360?.034:.024:.018;
    wind.gain.setTargetAtTime(enabled?base:0,now,.5);
    if(windFilter)windFilter.frequency.setTargetAtTime(320+(me?Math.min(180,Math.abs(me.z)*.22):60),now,.6);
   }
   const horde=this.hordeGain,hordeFilter=this.hordeFilter;
   if(horde){
    const hordeLevel=Math.min(1,undead/7);
    horde.gain.setTargetAtTime(enabled?hordeLevel*.055:0,now,.35);
    if(hordeFilter)hordeFilter.frequency.setTargetAtTime(170+undead*26,now,.4);
   }
   const nest=this.nestGain;if(nest)nest.gain.setTargetAtTime(enabled?nestLevel*.055:0,now,.4);
   const nestPad=this.nestPadGain;if(nestPad)nestPad.gain.setTargetAtTime(enabled?nestPadLevel:0,now,.6);
   const fire=this.fireGain;if(fire)fire.gain.setTargetAtTime(enabled?fireLevel*.062:0,now,.08);
   const fireLow=this.fireLowGain;if(fireLow)fireLow.gain.setTargetAtTime(enabled?fireLevel*.014:0,now,.15);
   // ---- adaptive music bed, tinted by the (crossfading) region profile ----
   let musicLevel=0,musicFilterMul=0,musicDetuneCents=0;
   for(let i=0;i<3;i++){
    const weight=this.regionWeights[i],profile=REGION_MUSIC[i];
    musicLevel+=weight*profile.level;musicFilterMul+=weight*profile.filter;musicDetuneCents+=weight*profile.detune;
   }
   if(musicLevel<.05){musicLevel=1;musicFilterMul=1;musicDetuneCents=0;}
   let bedTarget=0;
   if(enabled&&game&&game.status==='playing'){
    const siege=game.siege?.active?1:0;
    bedTarget=(.42+.3*nestSwell+.22*siege)*(1-.5*this.captureRelief);
   }
   bedTarget=clamp01(bedTarget);
   this.bedLevel+=(bedTarget-this.bedLevel)*.09;
   if(this.bedLevel>.004||bedTarget>.004){this.ensureMusic();this.musicIdle=0;}
   else if(this.musicBuilt){this.musicIdle+=.08;if(this.musicIdle>2.5)this.stopMusic();}
   const bus=this.musicBus;
   if(this.musicBuilt&&bus){
    bus.gain.setTargetAtTime(enabled?this.bedLevel*.8*(1-.85*this.duckLevel)*musicLevel:0,now,.09);
    if(this.musicFilter)this.musicFilter.frequency.setTargetAtTime((760+520*nestSwell+(game?.siege?.active?220:0))*musicFilterMul,now,.5);
    if(this.musicDetune.length&&Math.abs(musicDetuneCents-this.musicDetuneApplied)>.4){
     this.musicDetuneApplied=musicDetuneCents;
     for(const osc of this.musicDetune)osc.detune.setTargetAtTime(musicDetuneCents,now,.8);
    }
    const tension=this.tensionGain;if(tension)tension.gain.setTargetAtTime(enabled?nestSwell*.06*(1-.85*this.duckLevel):0,now,.4);
   }
  }
  const hpRatio=me?clamp01(me.hp/me.maxHp):1;
  if(enabled&&me&&me.hp>0&&hpRatio<.3){
   this.beatTimer-=dt;
   if(this.beatTimer<=0){this.heartbeat(1-hpRatio/.3);this.beatTimer=.5+hpRatio*1.9;}
  }else this.beatTimer=.02;
  // Rate-limited distant undead moans/creaks scaled by nearby undead count.
  if(enabled&&playing&&this.nearbyUndead>0){
   this.moanTimer-=dt;
   if(this.moanTimer<=0){
    this.moan(this.nearbyUndead);
    this.moanTimer=Math.max(1.8,6.5-this.nearbyUndead*.85)*(.75+Math.random()*.5);
   }
  }else if(this.moanTimer<1.5)this.moanTimer=1.5+Math.random();
  // Region one-shots: timers run always, but a shot only sounds while its region layer is audible.
  if(enabled&&playing){
   const marchWeight=this.regionWeights[0],moorWeight=this.regionWeights[1],crownWeight=this.regionWeights[2];
   this.birdTimer-=dt;this.iceTimer-=dt;this.emberTimer-=dt;this.bellTimer-=dt;
   if(this.birdTimer<=0){this.birdTimer=3+Math.random()*5;if(marchWeight>.35)this.oneShot('bird');}
   if(this.iceTimer<=0){this.iceTimer=5+Math.random()*6;if(crownWeight>.35)this.oneShot('ice');}
   if(this.emberTimer<=0){this.emberTimer=3+Math.random()*4;if(moorWeight>.35)this.oneShot(Math.random()<.7?'ember':'groan');}
   if(this.bellTimer<=0){this.bellTimer=11+Math.random()*11;if(moorWeight>.35)this.oneShot('bell');}
  }
  // Delayed thunder after a lightning flash (one strike -> one rumble), then rain/ash one-shots.
  if(this.thunderDelay>=0&&this.weatherBuilt){this.thunderAt=Math.max(this.thunderAt,now+this.thunderDelay);this.thunderDelay=-1;}
  if(this.thunderAt>0&&now>=this.thunderAt){
   const strength=this.thunderStrength;this.thunderAt=0;this.thunderStrength=0;
   this.playThunder(strength);
  }
  if(enabled&&playing&&this.weatherKindActive>=0&&this.weatherIntensity>.08){
   if(this.weatherKindActive===0){
    this.plipTimer-=dt;
    if(this.plipTimer<=0){this.rainPlip();this.plipTimer=(2.8-2.1*this.weatherIntensity)*(.6+Math.random()*.8);}
   }else if(this.weatherKindActive===2){
    this.ashGroanTimer-=dt;
    if(this.ashGroanTimer<=0){this.ashGroan();this.ashGroanTimer=(8+Math.random()*10)*(1-.5*this.weatherIntensity);}
   }
  }
  if(me){
   if(this.hasPrev){
    const speed=Math.hypot(me.x-this.prevX,me.z-this.prevZ)/dt;
    if(enabled&&speed>1.2&&speed<16&&me.hp>0&&!me.downed){
     this.stepTimer-=dt;
     if(this.stepTimer<=0){this.footstep();this.stepTimer=speed>5.4?.3:speed>2.8?.4:.52;}
    }else this.stepTimer=.1;
   }
   this.prevX=me.x;this.prevZ=me.z;this.hasPrev=true;
  }else this.hasPrev=false;
 }
}
