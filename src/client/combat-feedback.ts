import type {Game} from '../shared/types';
import {dist} from '../shared/world';
export type CombatCue={kind:'swing'|'impact'|'hurt'|'equip';heavy:boolean;volume:number};
/** Compare authoritative snapshots. Initial/replayed snapshots must remain silent. */
export function combatCues(before:Game|undefined,after:Game,id:string):CombatCue[]{
 if(!before||after.time<=before.time||after.time-before.time>1)return [];
 const me=after.actors.find(a=>a.id===id),oldMe=before.actors.find(a=>a.id===id);if(!me||!oldMe)return [];
 const cues:CombatCue[]=[],heavy=me.weapon==='hammer'||me.weapon==='zweihander';
 if(me.hp>0&&(me.attackSerial??0)>(oldMe.attackSerial??0))cues.push({kind:'swing',heavy,volume:1});
 if(me.hp<oldMe.hp)cues.push({kind:'hurt',heavy:false,volume:1});
 if(me.weapon!==oldMe.weapon)cues.push({kind:'equip',heavy,volume:.6});
 const old=new Map(before.actors.map(a=>[a.id,a]));
 for(const a of after.actors){const prior=old.get(a.id),range=dist(a,me);if(a.id===id||!prior||a.hp>=prior.hp||range>12)continue;cues.push({kind:'impact',heavy,volume:Math.max(.12,1-range/14)});if(cues.filter(c=>c.kind==='impact').length>=3)break;}
 return cues;
}
export class CombatAudio{
 private context?:AudioContext;
 constructor(private enabled:()=>boolean){}
 unlock(){if(!this.enabled())return;try{this.context??=new AudioContext();if(this.context.state==='suspended')void this.context.resume().catch(()=>{});}catch{}}
 play(cue:CombatCue){const c=this.context;if(!c||c.state!=='running'||!this.enabled())return;
 const duration=cue.kind==='swing'?.22:cue.kind==='hurt'?.24:.14,now=c.currentTime;
 const envelope=c.createGain();envelope.gain.setValueAtTime(.0001,now);envelope.gain.exponentialRampToValueAtTime(.10*cue.volume,now+.012);envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);envelope.connect(c.destination);
 const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
 const noise=c.createBufferSource(),filter=c.createBiquadFilter();noise.buffer=buffer;filter.type='bandpass';filter.Q.value=cue.kind==='equip'?5:.7;filter.frequency.setValueAtTime(cue.kind==='swing'?1800:cue.kind==='equip'?2200:cue.heavy?220:650,now);filter.frequency.exponentialRampToValueAtTime(cue.kind==='swing'?350:120,now+duration);noise.connect(filter);filter.connect(envelope);noise.start();noise.stop(now+duration);
 const oscillator=c.createOscillator();oscillator.type='sine';oscillator.frequency.setValueAtTime(cue.kind==='equip'?1100:cue.kind==='hurt'?90:cue.heavy?65:160,now);oscillator.frequency.exponentialRampToValueAtTime(45,now+duration);const gain=c.createGain();gain.gain.value=cue.kind==='swing'?.03:.25;oscillator.connect(gain);gain.connect(envelope);oscillator.start();oscillator.stop(now+duration);
 noise.onended=()=>{noise.disconnect();filter.disconnect();};oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();envelope.disconnect();};
 }
}
