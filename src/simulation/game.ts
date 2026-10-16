import {CASTLES,CAMPS,NEST,START,COSTS,dist,move,waypoint,clamp,lineClear} from '../shared/world';
import type {Actor,Game,Input} from '../shared/types';
export const idle=():Input=>({mx:0,mz:0,yaw:0,attack:false,block:false,interact:false,seq:0});
export function event(g:Game,text:string){g.events.push({id:++g.nextId,text,time:g.time});g.events=g.events.slice(-8);}
export function spawn(g:Game,kind:Actor['kind'],x:number,z:number,extra:Partial<Actor>={}):Actor{
 const hp=kind==='player'?120:kind==='soldier'?90:kind==='corrupted'?125:52;
 const a:Actor={id:`a${++g.nextId}`,kind,name:kind==='corrupted'?'Corrupted knight':kind==='soldier'?'Oathsworn':kind==='zombie'?'Shrouded':'Knight',x,z,hp,maxHp:hp,yaw:0,cd:0,windup:0,swing:0,block:false,deadUntil:0,...extra};g.actors.push(a);return a;
}
export function createGame():Game{
 const g:Game={time:0,status:'playing',actors:[],castles:CASTLES.map(c=>({...c,friendly:false,level:0,gate:0,barrier:0,capture:0,lost:0,rewarded:false})),camps:CAMPS.map(c=>({...c,rescued:false})),resources:{wood:24,iron:14,medicine:5,recruits:0},caches:[],nest:{...NEST,hp:500,maxHp:500},everCaptured:false,siege:null,nextSiege:150,stats:{captures:0,rescues:0,sieges:0,recruited:0,kills:0},events:[],nextId:0};
 g.castles.forEach((c,i)=>{for(let n=0;n<4+i*2;n++)spawn(g,n===5?'corrupted':'zombie',c.x-5+(n%3)*4,c.z-5+Math.floor(n/3)*4,{castle:c.id});});
 g.camps.forEach(c=>{for(let n=0;n<3;n++)spawn(g,'zombie',c.x+n*2-2,c.z-4);});
 for(let n=0;n<5;n++)spawn(g,n===4?'corrupted':'zombie',NEST.x-6+n*3,NEST.z+5);
 [...CAMPS,...CASTLES,{x:3,z:24},{x:15,z:-25},{x:28,z:-53},{x:16,z:-91},{x:-11,z:-119},{x:-10,z:-164}].forEach((p,i)=>g.caches.push({id:`cache${i}`,x:p.x+4,z:p.z+4,taken:false}));
 spawn(g,'soldier',-2,25,{mode:'follow'});spawn(g,'soldier',2,25,{mode:'follow'});
 event(g,'Reclaim the Fallen Keep. Rescue the survivors. End the plague.');return g;
}
export function addPlayer(g:Game,id:string,name:string){let c=g.castles.find(c=>c.friendly);const a=spawn(g,'player',c?.x??START.x,c?c.z+3:START.z,{id,name,connected:true,lastSeq:-1,input:idle(),inputAt:g.time});for(const s of g.actors.filter(a=>a.kind==='soldier'&&!a.owner))s.owner=id;return a;}
export function setInput(g:Game,id:string,v:unknown):boolean{
 if(!v||typeof v!=='object')return false;const i=v as Input;const a=g.actors.find(a=>a.id===id&&a.kind==='player');
 if(!a||![i.mx,i.mz,i.yaw,i.seq].every(Number.isFinite)||!Number.isSafeInteger(i.seq)||i.seq<0||i.seq<=(a.lastSeq??-1)||[i.attack,i.block,i.interact].some(x=>typeof x!=='boolean'))return false;
 const length=Math.max(1,Math.hypot(i.mx,i.mz));a.input={mx:i.mx/length,mz:i.mz/length,yaw:Math.atan2(Math.sin(i.yaw),Math.cos(i.yaw)),attack:i.attack,block:i.block,interact:i.interact,seq:i.seq};a.lastSeq=i.seq;a.inputAt=g.time;return true;
}
const hostile=(a:Actor)=>a.kind==='zombie'||a.kind==='corrupted';
function hurt(g:Game,a:Actor,amount:number,attacker?:Actor){
 if(a.hp<=0)return;
 if(a.block&&attacker){const towards=Math.atan2(attacker.x-a.x,-(attacker.z-a.z));if(Math.cos(towards-a.yaw)>.2)amount*=.2;}
 a.hp=Math.max(0,a.hp-amount);
 if(a.hp===0){a.deadUntil=g.time+(a.kind==='player'?8:a.kind==='soldier'?7:2);a.windup=0;if(hostile(a)){g.stats.kills++;g.resources.wood+=2;g.resources.iron++;}if(a.kind==='soldier')event(g,'An Oathsworn has fallen. Corruption rises in 7 seconds.');}
}
function swing(g:Game,a:Actor){a.cd=.65;a.swing=.25;for(const e of g.actors){if(!hostile(e)||e.hp<=0||dist(a,e)>3.4||!lineClear(a,e))continue;const angle=Math.atan2(e.x-a.x,-(e.z-a.z));if(Math.cos(angle-a.yaw)>.25)hurt(g,e,34,a);}
 if(dist(a,g.nest)<4&&g.castles.every(c=>c.friendly)&&g.camps.every(c=>c.rescued)){g.nest.hp=Math.max(0,g.nest.hp-34);if(g.nest.hp===0){g.status='victory';event(g,'The shroud is broken. The kingdom lives.');}}
}
export function command(g:Game,id:string,action:string){
 const p=g.actors.find(a=>a.id===id&&a.hp>0);if(!p||g.status!=='playing')return 'You cannot act right now.';
 if(['follow','hold','attack'].includes(action)){for(const s of g.actors.filter(a=>a.kind==='soldier'&&a.hp>0&&a.owner===id&&a.mode!=='guard')){s.mode=action as Actor['mode'];s.hold={x:p.x,z:p.z};if(action==='attack'){const target=g.actors.filter(a=>hostile(a)&&a.hp>0&&dist(p,a)<18).sort((a,b)=>dist(p,a)-dist(p,b))[0];s.target=target?.id;}}return '';}
 if(action==='heal'){if(!g.resources.medicine)return 'No healing supplies remain.';if(p.hp>=p.maxHp)return 'Health is already full.';g.resources.medicine--;p.hp=Math.min(p.maxHp,p.hp+65);return '';}
 const c=g.castles.find(c=>c.friendly&&dist(c,p)<15);if(!c)return 'Enter a friendly castle or stand beside its entrance to build.';
 if(action==='recruit'||action==='guard'){if(!g.resources.recruits)return 'Rescue survivors to gain recruits.';if(g.resources.iron<COSTS.recruit.iron)return 'Need 3 iron.';if(g.actors.filter(a=>a.kind==='soldier'&&a.hp>0).length>=16)return 'Army limit: 16 soldiers.';g.resources.iron-=3;g.resources.recruits--;g.stats.recruited++;spawn(g,'soldier',c.x+2,c.z+3,{owner:id,mode:action==='guard'?'guard':'follow',castle:action==='guard'?c.id:undefined});return '';}
 if(action==='upgrade'){const cost={wood:24+c.level*16,iron:10+c.level*8};if(c.level>=2)return 'This castle is fully upgraded.';if(g.resources.wood<cost.wood||g.resources.iron<cost.iron)return `Upgrade needs ${cost.wood} wood and ${cost.iron} iron.`;g.resources.wood-=cost.wood;g.resources.iron-=cost.iron;c.level++;c.gate=180+c.level*120;c.barrier=120+c.level*60;event(g,`${c.name} upgraded to ${c.level===1?'Bastion':'Citadel'}. Defenses restored; nearby allies recover health.`);return ''; }
 if(action!=='repair'&&action!=='barricade')return 'Unknown command.';
 if(action==='repair'&&c.gate>=180+c.level*120)return 'Gate is fully repaired.';if(action==='barricade'&&c.barrier>=120+c.level*60)return 'Barricade is at full strength.';
 const cost=COSTS[action];if(g.resources.wood<cost.wood||g.resources.iron<cost.iron)return `Need ${cost.wood} wood and ${cost.iron} iron.`;
 g.resources.wood-=cost.wood;g.resources.iron-=cost.iron;if(action==='repair')c.gate=180+c.level*120;else c.barrier=120+c.level*60;event(g,`${c.name}: ${action==='repair'?'gate repaired':'barricade constructed'}.`);return '';
}
function interactions(g:Game,dt:number){
 const interacting=g.actors.filter(a=>a.kind==='player'&&a.hp>0&&a.connected&&a.input?.interact);
 for(const cache of g.caches)if(!cache.taken&&interacting.some(p=>dist(p,cache)<3)){cache.taken=true;g.resources.wood+=12;g.resources.iron+=5;g.resources.medicine++;event(g,'Supplies recovered: 12 wood, 5 iron, 1 healing supply.');}
 for(const c of g.camps)if(!c.rescued&&interacting.some(p=>dist(p,c)<4)&&!g.actors.some(a=>hostile(a)&&a.hp>0&&dist(a,c)<9)){c.rescued=true;g.resources.recruits+=4;g.stats.rescues++;event(g,`${c.name} rescued. Four recruits await your orders.`);}
 for(const c of g.castles){if(c.friendly)continue;const defenders=g.actors.some(a=>hostile(a)&&a.hp>0&&(a.castle===c.id||dist(a,c)<10));if(!defenders&&interacting.some(p=>dist(p,c)<4)){c.capture+=dt;if(c.capture>=5){c.friendly=true;c.gate=180+c.level*120;c.barrier=0;c.capture=0;c.lost=0;g.everCaptured=true;g.stats.captures++;if(!c.rewarded){c.rewarded=true;g.resources.wood+=16;g.resources.iron+=8;}event(g,`${c.name} reclaimed. Fortify and assign guards.`);}}else c.capture=0;}
}
export function tick(g:Game,dt=.05){
 if(g.status!=='playing')return;g.time+=dt;
 for(const a of [...g.actors]){
  if(a.hp>0&&!hostile(a)&&g.castles.some(c=>c.friendly&&c.level>0&&dist(a,c)<9))a.hp=Math.min(a.maxHp,a.hp+dt*2);
  a.cd=Math.max(0,a.cd-dt);a.swing=Math.max(0,a.swing-dt);
  if(a.hp<=0){if(a.deadUntil>g.time)continue;
   if(a.kind==='player'){const c=g.castles.find(c=>c.friendly);if(!c&&g.everCaptured)continue;a.hp=a.maxHp;a.x=c?.x??START.x;a.z=c?c.z+3:START.z;a.input=idle();a.block=false;}
   else{g.actors=g.actors.filter(x=>x!==a);if(a.kind==='soldier')spawn(g,'corrupted',a.x,a.z);continue;}}
  if(a.kind==='player'){
   if(!a.connected||g.time-(a.inputAt??0)>.3){a.input=idle();a.block=false;continue;}
   const i=a.input??idle();a.yaw=i.yaw;a.block=i.block;move(a,{x:a.x+i.mx,z:a.z+i.mz},dt*(a.block?2.5:6));if(i.attack&&!a.block&&a.cd===0)swing(g,a);continue;
  }
  const enemies=g.actors.filter(e=>e.hp>0&&hostile(e)!==hostile(a));
  const nearest=enemies.sort((x,y)=>dist(a,x)-dist(a,y))[0];
  if(!hostile(a)){
   const owner=g.actors.find(p=>p.id===a.owner&&p.hp>0&&p.connected)||g.actors.find(p=>p.kind==='player'&&p.hp>0&&p.connected);
   const fort=g.castles.find(c=>c.id===a.castle);
   const anchor=a.mode==='guard'?fort:a.mode==='hold'?a.hold:owner;
   let target=a.mode==='attack'?g.actors.find(e=>e.id===a.target&&e.hp>0):undefined;
   if(!target&&nearest&&dist(a,nearest)<9&&(!anchor||dist(nearest,anchor)<15))target=nearest;
   if(target){a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));if(dist(a,target)>2.2||!lineClear(a,target))move(a,waypoint(a,target),dt*4.6);else if(a.cd===0){hurt(g,target,22,a);a.cd=.9;a.swing=.25;}}
   else if(anchor&&dist(a,anchor)>3)move(a,waypoint(a,anchor),dt*4.9);
  }else{
   const fort=g.castles.find(c=>c.id===a.castle);
   const target=nearest&&dist(a,nearest)<(a.kind==='corrupted'?20:13)?nearest:undefined;
   if(a.windup>0){a.windup-=dt;if(a.windup<=0&&target&&dist(a,target)<2.8&&lineClear(a,target)){hurt(g,target,a.kind==='corrupted'?24:13,a);a.swing=.2;}continue;}
   if(target){a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));if(dist(a,target)>2||!lineClear(a,target))move(a,waypoint(a,target),dt*(a.kind==='corrupted'?3.6:2.6));else if(a.cd===0){a.windup=.65;a.cd=1.65;}}
   else if(fort?.friendly){const gate={x:fort.x,z:fort.z+11};if(fort.gate>0||fort.barrier>0){if(dist(a,gate)>2.5)move(a,waypoint(a,gate),dt*2.6);else if(a.cd===0){if(fort.barrier>0)fort.barrier=Math.max(0,fort.barrier-12);else fort.gate=Math.max(0,fort.gate-12);a.cd=1;a.swing=.2;}}else move(a,waypoint(a,fort),dt*2.6);}
  }
 }
 interactions(g,dt);
 for(const c of g.castles.filter(c=>c.friendly)){
  const threats=g.actors.filter(a=>hostile(a)&&a.hp>0&&dist(a,c)<4);
  const defended=g.actors.some(a=>!hostile(a)&&a.hp>0&&dist(a,c)<5);
  c.lost=threats.length&&!defended&&c.gate<=0?c.lost+dt:Math.max(0,c.lost-dt);
  if(c.lost>=8){c.friendly=false;c.lost=0;c.gate=0;c.barrier=0;for(const a of threats)a.castle=c.id;event(g,`${c.name} has fallen. Reclaim its banner!`);}
 }
 if(g.everCaptured&&!g.castles.some(c=>c.friendly)){g.status='defeat';event(g,'The last stronghold has fallen.');return;}
 if(!g.siege&&g.everCaptured&&g.time>=g.nextSiege){const friendly=g.castles.filter(c=>c.friendly);const target=friendly[(g.stats.sieges+g.stats.captures)%friendly.length];g.siege={castle:target.id,starts:g.time+30,active:false};event(g,`Siege approaching ${target.name} in 30 seconds.`);}
 if(g.siege){const c=g.castles.find(c=>c.id===g.siege!.castle)!;
  if(!g.siege.active&&g.time>=g.siege.starts){g.siege.active=true;const count=6+Math.min(6,g.stats.sieges*2);for(let n=0;n<count;n++)spawn(g,n===count-1?'corrupted':'zombie',c.x+(n%3-1)*2,c.z+19+Math.floor(n/3)*2,{castle:c.id});event(g,`The siege of ${c.name} has begun.`);}
  if(g.siege.active&&(!c.friendly||!g.actors.some(a=>hostile(a)&&a.hp>0&&a.castle===c.id))){if(c.friendly){g.stats.sieges++;g.resources.wood+=16;g.resources.iron+=6;event(g,`Siege repelled at ${c.name}.`);}g.siege=null;g.nextSiege=g.time+120;}
 }
}
export function snapshot(g:Game){return {...g,actors:g.actors.map(({input,inputAt,lastSeq,...a})=>a)};}
