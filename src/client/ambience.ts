import type {Actor, Game} from '../shared/types';
import {dist} from '../shared/world';
const clamp01=(v:number)=>(v<0?0:v>1?1:v);
/**
 * Procedural WebAudio ambience + adaptive music. Every layer is synthesised at runtime — no audio
 * files: wind, a horde drone that rises with nearby undead, a plague-nest hum/pad (and a dissonant
 * tension pair near the nest), fire crackle + ember bed near castle braziers and camp fires, a
 * low-health heartbeat, footstep cadence, rate-limited distant undead moans/creaks, and a very
 * quiet minor-mode music bed (low drone + detuned string-like pads).
 *
 * The music bed is adaptive: it fades in during exploration, swells near the plague nest and during
 * an active siege, eases down for a while after a castle capture, and ducks under combat via
 * duck() (called from main.ts's authoritative cue stream). Silent before unlock() (user gesture)
 * and while Sound is unchecked; the whole graph is context-suspended while paused/hidden.
 *
 * update() is deliberately allocation-light: it loops existing game arrays with plain for-loops,
 * schedules at most one short envelope per step/beat/moan, only re-targets AudioParams a few times
 * per second, and lazily builds/stops the music graph so it costs nothing when inaudible.
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
 private stepTimer=0;
 private beatTimer=0;
 private slowTimer=0;
 private prevX=0;
 private prevZ=0;
 private hasPrev=false;
 private paused=false;
 constructor(private enabled:()=>boolean){}
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
  const master=c.createGain();master.gain.value=0;master.connect(c.destination);this.master=master;
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
  // Low drone: D1 + D2 + A2 fifth, mix levels kept tiny.
  const drone=c.createGain();drone.gain.value=.012;drone.connect(toneFilter);
  for(const [freq,type,level] of [[36.71,'sine',.5],[73.42,'triangle',.3],[110,'sine',.16]] as const){
   const osc=c.createOscillator();osc.type=type;osc.frequency.value=freq;
   const g=c.createGain();g.gain.value=level;osc.connect(g);g.connect(drone);osc.start();sources.push(osc);
  }
  // String-like pads: D minor (D3, F3, A3, D4), two detuned triangles per note for chorus width.
  const padFilter=c.createBiquadFilter();padFilter.type='lowpass';padFilter.frequency.value=1100;padFilter.Q.value=.5;
  const pad=c.createGain();pad.gain.value=.013;padFilter.connect(pad);pad.connect(toneFilter);
  for(const freq of [146.83,174.61,220,293.66])for(const cents of [-7,7]){
   const osc=c.createOscillator();osc.type='triangle';osc.frequency.value=freq*Math.pow(2,cents/1200);
   const g=c.createGain();g.gain.value=.14;osc.connect(g);g.connect(padFilter);osc.start();sources.push(osc);
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
  this.musicBus=bus;this.musicFilter=toneFilter;this.musicDrone=drone;this.musicPad=pad;this.tensionGain=tension;this.musicSources=sources;this.musicBuilt=true;
 }
 /** Tear the music graph down when the bed has been inaudible for a while (CPU win). */
 private stopMusic(){
  if(!this.musicBuilt)return;
  for(const osc of this.musicSources){try{osc.stop();}catch{}try{osc.disconnect();}catch{}}
  this.musicSources=[];
  for(const node of [this.musicBus,this.musicDrone,this.musicPad,this.tensionGain]){try{node?.disconnect();}catch{}}
  this.musicBus=undefined;this.musicFilter=undefined;this.musicDrone=undefined;this.musicPad=undefined;this.tensionGain=undefined;
  this.musicBuilt=false;this.musicIdle=0;
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
    let fireD=Infinity;
    for(const castle of game.castles){const d=dist(me,castle);if(d<fireD)fireD=d;}
    for(const camp of game.camps){const d=dist(me,camp);if(d<fireD)fireD=d;}
    if(fireD<28){const near=1-fireD/28;fireLevel=near*near*(.62+Math.random()*.38);}
   }
   this.nearbyUndead=undead;
   // Capture easing: the bed eases down for ~24 s after a castle is taken.
   if(game){
    if(!this.capturesSeen){this.prevCaptures=game.stats.captures;this.capturesSeen=true;}
    else if(game.stats.captures>this.prevCaptures){this.prevCaptures=game.stats.captures;this.captureRelief=1;}
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
   // ---- adaptive music bed ----
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
    bus.gain.setTargetAtTime(enabled?this.bedLevel*.8*(1-.85*this.duckLevel):0,now,.09);
    if(this.musicFilter)this.musicFilter.frequency.setTargetAtTime(760+520*nestSwell+(game?.siege?.active?220:0),now,.5);
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
