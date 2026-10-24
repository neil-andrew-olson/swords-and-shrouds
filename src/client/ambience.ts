import type {Actor, Game} from '../shared/types';
import {dist} from '../shared/world';
const clamp01=(v:number)=>(v<0?0:v>1?1:v);
/**
 * Procedural WebAudio ambience. Every bed is synthesised at runtime — no audio files:
 * a wind bed, a horde drone that rises with the count of nearby undead, a plague-nest hum and a
 * very quiet plague pad near the nest, fire crackle near castle braziers and camp fires, a
 * low-health heartbeat, and footstep cadence while moving. Silent before unlock() (user gesture)
 * and while Sound is unchecked.
 *
 * update() is deliberately allocation-light: it loops the existing game arrays with plain
 * for-loops, schedules at most one short envelope per step/beat, and only re-targets
 * AudioParams a few times per second.
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
 private stepGain?:GainNode;
 private heartGain?:GainNode;
 private started=false;
 private noise?:AudioBuffer;
 private crackle?:AudioBuffer;
 private stepTimer=0;
 private beatTimer=0;
 private slowTimer=0;
 private prevX=0;
 private prevZ=0;
 private hasPrev=false;
 constructor(private enabled:()=>boolean){}
 /** Called from a user gesture. Creates/begins the graph at most once. */
 unlock(){
  if(!this.enabled())return;
  try{
   if(!this.context)this.context=new AudioContext();
   if(!this.started)this.build(this.context);
   if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
  }catch{}
 }
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
  // Fire: looped sparse pops, brightened by a high-pass.
  const fireFilter=c.createBiquadFilter();fireFilter.type='highpass';fireFilter.frequency.value=900;fireFilter.Q.value=.7;
  const fireGain=c.createGain();fireGain.gain.value=0;
  const fire=c.createBufferSource();fire.buffer=this.crackle;fire.loop=true;
  fire.connect(fireFilter);fireFilter.connect(fireGain);fireGain.connect(master);fire.start();
  this.fireGain=fireGain;
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
 update(dt:number,game:Game|undefined,me:Actor|undefined){
  const c=this.context,master=this.master;
  if(!c||!master||!this.started)return;
  if(dt>.1)dt=.1;if(dt<=0)dt=.001;
  const now=c.currentTime,enabled=this.enabled(),playing=!!game&&game.status==='playing';
  const masterTarget=!enabled?0:!game?.72:playing?1:.28;
  this.slowTimer+=dt;
  if(this.slowTimer>=.08){
   this.slowTimer=0;
   master.gain.setTargetAtTime(masterTarget,now,.22);
   let undead=0,nestLevel=0,nestPadLevel=0,fireLevel=0;
   if(game&&me){
    for(const a of game.actors){
     if(a.hp<=0||(a.kind!=='zombie'&&a.kind!=='corrupted'))continue;
     if(dist(a,me)<34)undead++;
    }
    const nestD=dist(me,game.nest);
    if(nestD<170){const near=1-nestD/170;nestLevel=near*near*Math.sqrt(near);}
    if(nestD<260){const near=1-nestD/260;nestPadLevel=near*near*.02;}
    let fireD=Infinity;
    for(const castle of game.castles){const d=dist(me,castle);if(d<fireD)fireD=d;}
    for(const camp of game.camps){const d=dist(me,camp);if(d<fireD)fireD=d;}
    if(fireD<26){const near=1-fireD/26;fireLevel=near*near*(.62+Math.random()*.38);}
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
   const fire=this.fireGain;if(fire)fire.gain.setTargetAtTime(enabled?fireLevel*.075:0,now,.08);
  }
  const hpRatio=me?clamp01(me.hp/me.maxHp):1;
  if(enabled&&me&&me.hp>0&&hpRatio<.3){
   this.beatTimer-=dt;
   if(this.beatTimer<=0){this.heartbeat(1-hpRatio/.3);this.beatTimer=.5+hpRatio*1.9;}
  }else this.beatTimer=.02;
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
