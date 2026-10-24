import {isPlayerCharacter} from '../shared/characters';
import {ROLES,ROLE_STATS,formation,placeCompanion,separateCompanions,squad} from './companions';
import {CASTLES,CAMPS,REGIONS,NEST,START,COSTS,dist,move,waypoint,clamp,lineClear} from '../shared/world';
import type {Actor,Game,Input} from '../shared/types';
import {WEAPON_IDS,WEAPONS,isWeapon,weaponStats,type WeaponId} from '../shared/weapons';
export const idle=():Input=>({mx:0,mz:0,yaw:0,attack:false,block:false,interact:false,seq:0});
export function event(g:Game,text:string){g.events.push({id:++g.nextId,text,time:g.time});g.events=g.events.slice(-8);}
export function spawn(g:Game,kind:Actor['kind'],x:number,z:number,extra:Partial<Actor>={}):Actor{
 if(kind==='soldier'&&!extra.role)extra={...extra,role:ROLES[g.actors.filter(a=>a.kind==='soldier').length%ROLES.length]};
 const hp=kind==='player'?120:kind==='soldier'?90:kind==='corrupted'?125:52;
 const a:Actor={id:`a${++g.nextId}`,kind,name:kind==='corrupted'?'Corrupted knight':kind==='soldier'?'Oathsworn':kind==='zombie'?'Shrouded':'Knight',x,z,hp,maxHp:hp,yaw:0,cd:0,windup:0,swing:0,block:false,deadUntil:0,stamina:100,armor:'light',abilityCd:0,...extra};g.actors.push(a);return a;
}
export function createGame():Game{
 // Weapon-rack drops are WEAPON_IDS-driven: the starter hammer plus one rack per castle. Filtering
 // out the two starter weapons keeps every rackable weapon covered exactly once as WEAPON_IDS grows.
 const rackPool:WeaponId[]=WEAPON_IDS.filter(id=>id!=='sword'&&id!=='hammer');
 const g:Game={time:0,armory:['sword'],weaponDrops:[{id:'starter-hammer',weapon:'hammer',x:-3,z:30,taken:false},...CASTLES.map((c,i)=>({id:'rack-'+c.id,weapon:rackPool[i%rackPool.length],x:c.x-5,z:c.z+4,taken:false}))],regions:REGIONS.map(r=>({id:r.id,name:r.name,held:false,paid:false,incomeAt:0})),shots:[],noises:[],status:'playing',actors:[],castles:CASTLES.map(c=>({...c,friendly:false,artilleryCd:3,level:0,gate:0,barrier:0,capture:0,lost:0,rewarded:false})),camps:CAMPS.map(c=>({...c,rescued:false})),resources:{wood:24,iron:14,medicine:5,recruits:0},caches:[],nest:{...NEST,hp:500,maxHp:500},everCaptured:false,siege:null,nextSiege:150,stats:{captures:0,rescues:0,sieges:0,recruited:0,kills:0},events:[],nextId:0};
 g.castles.forEach((c,i)=>{for(let n=0;n<4+(i%3)*2+Math.floor(i/3);n++)spawn(g,n===5?'corrupted':'zombie',c.x-5+(n%3)*4,c.z-5+Math.floor(n/3)*4,{castle:c.id});});
 g.camps.forEach(c=>{for(let n=0;n<3;n++)spawn(g,'zombie',c.x+n*2-2,c.z-4);});
 for(let n=0;n<5;n++)spawn(g,n===4?'corrupted':'zombie',NEST.x-6+n*3,NEST.z+5,n===4?{name:'Plague Champion',hp:200,maxHp:200,weapon:'zweihander'}:{});
 [...CAMPS,...CASTLES,{x:3,z:24},{x:15,z:-25},{x:28,z:-53},{x:16,z:-91},{x:-11,z:-119},{x:-10,z:-164}].forEach((p,i)=>g.caches.push({id:`cache${i}`,x:p.x+4,z:p.z+4,taken:false}));
 spawn(g,'soldier',-2,25,{mode:'follow'});spawn(g,'soldier',2,25,{mode:'follow'});
 event(g,'Reclaim the Fallen Keep. Rescue the survivors. End the plague.');return g;
}
export function addPlayer(g:Game,id:string,name:string){let c=g.castles.find(c=>c.friendly);const a=spawn(g,'player',c?.x??START.x,c?c.z+3:START.z,{id,name,appearance:'templar',weapon:'sword',connected:true,lastSeq:-1,input:idle(),inputAt:g.time});for(const s of g.actors.filter(a=>a.kind==='soldier'&&!a.owner))s.owner=id;return a;}
export function setInput(g:Game,id:string,v:unknown):boolean{
 if(!v||typeof v!=='object')return false;const i=v as Input;const a=g.actors.find(a=>a.id===id&&a.kind==='player');
 if(!a||![i.mx,i.mz,i.yaw,i.seq].every(Number.isFinite)||!Number.isSafeInteger(i.seq)||i.seq<0||i.seq<=(a.lastSeq??-1)||[i.attack,i.block,i.interact].some(x=>typeof x!=='boolean'))return false;
 const length=Math.max(1,Math.hypot(i.mx,i.mz));a.input={mx:i.mx/length,mz:i.mz/length,yaw:Math.atan2(Math.sin(i.yaw),Math.cos(i.yaw)),attack:i.attack,block:i.block,interact:i.interact,seq:i.seq};a.lastSeq=i.seq;a.inputAt=g.time;return true;
}
export function moveEnemy(g:Game,a:Actor,target:{x:number;z:number},amount:number){const before={x:a.x,z:a.z};move(a,target,amount);for(const c of g.castles){if(!c.friendly)continue;const plane=c.barrier>0?c.z+13:c.gate>0?c.z+10:null;if(plane!==null&&before.z>=plane+.45&&a.z<plane+.45&&Math.abs(a.x-c.x)<3.5){a.x=before.x;a.z=before.z;}}}
const hostile=(a:Actor)=>a.kind==='zombie'||a.kind==='corrupted';
export function noise(g:Game,p:{x:number;z:number},radius:number){g.noises.push({x:p.x,z:p.z,radius,until:g.time+4});g.noises=g.noises.slice(-24);}
export function sever(g:Game,a:Actor,part:'leftArm'|'rightArm'|'head'){
 if(a.kind!=='zombie'||a.severed?.includes(part))return;a.severed=[...(a.severed??[]),part];if(part==='head'&&a.hp>0)hurt(g,a,a.hp);
}
function hurt(g:Game,a:Actor,amount:number,attacker?:Actor){
 if(a.hp<=0)return;
 if(a.block&&attacker){const towards=Math.atan2(attacker.x-a.x,-(attacker.z-a.z));if(Math.cos(towards-a.yaw)>.2)amount*=attacker&&a.kind==='player'&&!weaponStats(a.weapon).shield?.55:.2;}
 if(a.kind==='player'&&a.armor==='heavy')amount*=.7;
 a.hp=Math.max(0,a.hp-amount);if(a.kind==='zombie'&&attacker?.kind==='player'&&attacker.weapon!=='hammer'){if(a.hp===0)sever(g,a,'head');else if(a.hp<=a.maxHp*.5)sever(g,a,(a.severed??[]).includes('rightArm')?'leftArm':(a.severed??[]).includes('leftArm')?'rightArm':attacker.x<a.x?'leftArm':'rightArm');}
 if(a.hp===0){a.deadUntil=g.time+(a.kind==='player'?12:a.kind==='soldier'?7:2);a.windup=0;if(a.kind==='player'){a.downed=true;a.revive=0;a.block=false;event(g,`${a.name} is down! Hold Interact nearby for 3 seconds before corruption takes hold.`);}if(hostile(a)){g.stats.kills++;g.resources.wood+=2;g.resources.iron++;}if(a.kind==='soldier')event(g,'An Oathsworn has fallen. Corruption rises in 7 seconds.');}
}
function swing(g:Game,a:Actor){const w=weaponStats(a.weapon);a.stamina=Math.max(0,(a.stamina??100)-w.stamina);noise(g,a,22);a.cd=w.cooldown;a.swing=.25;a.attackSerial=(a.attackSerial??0)+1;for(const e of g.actors){if(!hostile(e)||e.hp<=0||dist(a,e)>w.reach||!lineClear(a,e))continue;const angle=Math.atan2(e.x-a.x,-(e.z-a.z));if(Math.cos(angle-a.yaw)>w.arc)hurt(g,e,w.damage,a);}
 if(dist(a,g.nest)<4&&g.castles.every(c=>c.friendly)&&g.camps.every(c=>c.rescued)){g.nest.hp=Math.max(0,g.nest.hp-w.damage);if(g.nest.hp===0){g.status='victory';event(g,'The shroud is broken. The kingdom lives.');}}
}
export function command(g:Game,id:string,action:string){
 const p=g.actors.find(a=>a.id===id&&a.hp>0);if(!p||g.status!=='playing')return 'You cannot act right now.';
 if(action.startsWith('character:')){
  const choice=action.slice(10);
  if(p.kind!=='player'||!isPlayerCharacter(choice)) return 'Choose a listed character.';
  p.appearance=choice;
  return '';
 }
 if(action==='nextWeapon'||action.startsWith('equip:')){const requested=action==='nextWeapon'?g.armory[(g.armory.indexOf(p.weapon??'sword')+1)%g.armory.length]:action.slice(6);if(!isWeapon(requested)||!g.armory.includes(requested))return 'Find that weapon at a marked weapon rack first.';if(p.cd>0||p.swing>0)return 'Finish your attack before changing weapons.';p.weapon=requested;p.block=false;p.cd=.45;return '';}
 if(['follow','hold','attack'].includes(action)){for(const s of g.actors.filter(a=>a.kind==='soldier'&&a.hp>0&&a.owner===id&&a.mode!=='guard')){s.mode=action as Actor['mode'];s.hold={x:p.x,z:p.z};if(action==='attack'){const target=g.actors.filter(a=>hostile(a)&&a.hp>0&&dist(p,a)<18).sort((a,b)=>dist(p,a)-dist(p,b))[0];s.target=target?.id;}}return '';}
 if(action.startsWith('travel:')){const from=g.castles.find(c=>c.friendly&&dist(c,p)<8),to=g.castles.find(c=>c.id===action.slice(7)&&c.friendly);if(!from||!to)return 'Travel between friendly castle banners.';if(g.siege||g.actors.some(a=>hostile(a)&&a.hp>0&&dist(a,p)<20))return 'Travel is unavailable during a siege or nearby combat.';p.x=to.x;p.z=to.z+3;for(const s of g.actors.filter(a=>a.kind==='soldier'&&a.owner===id&&a.mode==='follow'&&a.hp>0)){placeCompanion(g,s,p);}return '';}
 if(action==='sweep'){if(p.cd>0)return 'Finish your attack first.';if((p.abilityCd??0)>0)return 'Sword Sweep is recovering.';if((p.stamina??100)<40)return 'Sword Sweep needs 40 stamina.';p.stamina=(p.stamina??100)-40;p.abilityCd=7;p.cd=.9;p.swing=.4;p.attackSerial=(p.attackSerial??0)+1;noise(g,p,32);for(const enemy of g.actors)if(hostile(enemy)&&enemy.hp>0&&dist(p,enemy)<4.5&&lineClear(p,enemy))hurt(g,enemy,48,p);return '';}
 if(action==='light'||action==='heavy'){if(!g.castles.some(c=>c.friendly&&dist(c,p)<15))return 'Change armor at a friendly castle.';p.armor=action;event(g,`${p.name} equipped ${action} armor.`);return '';}
 if(action==='heal'){if(!g.resources.medicine)return 'No healing supplies remain.';if(p.hp>=p.maxHp)return 'Health is already full.';g.resources.medicine--;p.hp=Math.min(p.maxHp,p.hp+65);return '';}
 const c=g.castles.find(c=>c.friendly&&dist(c,p)<15);if(!c)return 'Enter a friendly castle or stand beside its entrance to build.';
 if(action==='recruit'||action==='guard'){if(!g.resources.recruits)return 'Rescue survivors to gain recruits.';if(g.resources.iron<COSTS.recruit.iron)return 'Need 3 iron.';if(g.actors.filter(a=>a.kind==='soldier'&&a.hp>0).length>=16)return 'Army limit: 16 soldiers.';g.resources.iron-=3;g.resources.recruits--;g.stats.recruited++;const recruit=spawn(g,'soldier',c.x+2,c.z+3,{owner:id,mode:action==='guard'?'guard':'follow',castle:action==='guard'?c.id:undefined});placeCompanion(g,recruit,{x:c.x,z:c.z+3});return '';}
 if(action==='upgrade'){const cost={wood:24+c.level*16,iron:10+c.level*8};if(c.level>=2)return 'This castle is fully upgraded.';if(g.resources.wood<cost.wood||g.resources.iron<cost.iron)return `Upgrade needs ${cost.wood} wood and ${cost.iron} iron.`;g.resources.wood-=cost.wood;g.resources.iron-=cost.iron;c.level++;c.gate=180+c.level*120;c.barrier=120+c.level*60;event(g,`${c.name} upgraded to ${c.level===1?'Bastion':'Citadel'}. Defenses restored; nearby allies recover health.`);return ''; }
 if(action!=='repair'&&action!=='barricade')return 'Unknown command.';
 if(action==='repair'&&c.gate>=180+c.level*120)return 'Gate is fully repaired.';if(action==='barricade'&&c.barrier>=120+c.level*60)return 'Barricade is at full strength.';
 const cost=COSTS[action];if(g.resources.wood<cost.wood||g.resources.iron<cost.iron)return `Need ${cost.wood} wood and ${cost.iron} iron.`;
 g.resources.wood-=cost.wood;g.resources.iron-=cost.iron;if(action==='repair')c.gate=180+c.level*120;else c.barrier=120+c.level*60;event(g,`${c.name}: ${action==='repair'?'gate repaired':'barricade constructed'}.`);return '';
}
function interactions(g:Game,dt:number){
 for(const down of g.actors.filter(a=>a.kind==='player'&&a.downed&&a.hp<=0&&a.deadUntil>g.time)){
 const rescuer=g.actors.find(a=>a.hp>0&&dist(a,down)<3&&lineClear(a,down)&&((a.kind==='player'&&a.connected&&a.input?.interact)||(a.kind==='soldier'&&a.owner===down.id&&a.mode==='follow'&&!g.actors.some(e=>hostile(e)&&e.hp>0&&dist(e,a)<5))));
 down.revive=rescuer?(down.revive??0)+dt:0;if(down.revive>=3){down.hp=60;down.downed=false;down.revive=0;down.stamina=50;down.input=idle();event(g,`${down.name} was rescued before corruption.`);}}
 const interacting=g.actors.filter(a=>a.kind==='player'&&a.hp>0&&a.connected&&a.input?.interact);
 for(const drop of g.weaponDrops){if(drop.taken)continue;const collector=interacting.find(p=>dist(p,drop)<3&&lineClear(p,drop));if(!collector)continue;drop.taken=true;if(!g.armory.includes(drop.weapon))g.armory.push(drop.weapon);event(g,`${collector.name} recovered ${WEAPONS[drop.weapon].name}. Unlocked for the whole fellowship — R / LB to cycle, or open Armory.`);}
 for(const cache of g.caches)if(!cache.taken&&interacting.some(p=>dist(p,cache)<3)){cache.taken=true;g.resources.wood+=12;g.resources.iron+=5;g.resources.medicine++;event(g,'Supplies recovered: 12 wood, 5 iron, 1 healing supply.');}
 for(const c of g.camps)if(!c.rescued&&interacting.some(p=>dist(p,c)<4)&&!g.actors.some(a=>hostile(a)&&a.hp>0&&dist(a,c)<9)){c.rescued=true;g.resources.recruits+=4;g.stats.rescues++;event(g,`${c.name} rescued. Four recruits await your orders.`);}
 for(const c of g.castles){if(c.friendly)continue;const defenders=g.actors.some(a=>hostile(a)&&a.hp>0&&(a.castle===c.id||dist(a,c)<10));if(!defenders&&interacting.some(p=>dist(p,c)<4)){c.capture+=dt;if(c.capture>=5){c.friendly=true;c.gate=180+c.level*120;c.barrier=0;c.capture=0;c.lost=0;g.everCaptured=true;g.stats.captures++;if(!c.rewarded){c.rewarded=true;g.resources.wood+=16;g.resources.iron+=8;}event(g,`${c.name} reclaimed. Fortify and assign guards.`);}}else c.capture=0;}
}
export function tick(g:Game,dt=.05){
 if(g.status!=='playing')return;g.time+=dt;g.noises=g.noises.filter(n=>n.until>g.time);
 for(const a of [...g.actors]){
  if(a.hp>0&&!hostile(a)&&g.castles.some(c=>c.friendly&&c.level>0&&dist(a,c)<9))a.hp=Math.min(a.maxHp,a.hp+dt*2);
  a.abilityCd=Math.max(0,(a.abilityCd??0)-dt);
  if(a.hp>0&&a.kind==='player')a.stamina=Math.max(0,Math.min(100,(a.stamina??100)+dt*(a.block?-22:a.cd>0?0:a.armor==='heavy'?10:18)));
  a.cd=Math.max(0,a.cd-dt);a.swing=Math.max(0,a.swing-dt);
  if(a.hp<=0){if(a.deadUntil>g.time)continue;
   if(a.kind==='player'){if(a.downed){a.downed=false;const boss=spawn(g,'corrupted',a.x,a.z,{name:`${a.name}, the Fallen`,hp:220,maxHp:220});noise(g,boss,35);a.deadUntil=g.time+8;event(g,`${a.name} has risen as a corrupted knight. Their spirit returns in 8 seconds.`);continue;}const c=g.castles.find(c=>c.friendly);if(!c&&g.everCaptured)continue;a.hp=a.maxHp;a.stamina=100;a.x=c?.x??START.x;a.z=c?c.z+3:START.z;a.input=idle();a.block=false;}
   else{g.actors=g.actors.filter(x=>x!==a);if(a.kind==='soldier')spawn(g,'corrupted',a.x,a.z);continue;}}
  if(a.kind==='player'){
   if(!a.connected||g.time-(a.inputAt??0)>.3){a.input=idle();a.block=false;continue;}
   const i=a.input??idle();a.yaw=i.yaw;a.block=i.block&&(a.stamina??100)>1;move(a,{x:a.x+i.mx,z:a.z+i.mz},dt*(a.block?2.5:a.armor==='heavy'?4.8:6));if(i.attack&&!a.block&&a.cd===0&&(a.stamina??100)>=weaponStats(a.weapon).stamina)swing(g,a);continue;
  }
  const enemies=g.actors.filter(e=>e.hp>0&&hostile(e)!==hostile(a));
  const nearest=enemies.sort((x,y)=>dist(a,x)-dist(a,y))[0];
  if(!hostile(a)){
   const owner=g.actors.find(p=>p.id===a.owner&&(p.hp>0||p.downed)&&p.connected)||g.actors.find(p=>p.kind==='player'&&p.hp>0&&p.connected);
   const fort=g.castles.find(c=>c.id===a.castle);
   const anchor=a.mode==='guard'?fort:a.mode==='hold'?a.hold:owner;
   a.role??=ROLES[Math.max(0,g.actors.filter(s=>s.kind==='soldier').indexOf(a))%ROLES.length];
   const role=a.role,stats=ROLE_STATS[role];
   a.block=false;
   // Guard/hold never chase beyond their anchor; defenders stay close to their charge.
   const candidates=enemies.filter(e=>dist(a,e)<12&&(!anchor||dist(e,anchor)<(a.mode==='guard'||a.mode==='hold'?7:stats.leash)));
   let target=a.mode==='attack'?enemies.find(e=>e.id===a.target&&(!anchor||dist(e,anchor)<18)):undefined;
   if(!target)target=candidates.sort((x,y)=>{
    const score=(e:Actor)=>dist(role==='defender'&&anchor?anchor:a,e)+(role==='heavy'&&e.kind==='corrupted'?-5:0)+(role==='flanker'?g.actors.filter(s=>s.kind==='soldier'&&s.hp>0&&s!==a&&dist(s,e)<3).length*3:0);
    return score(x)-score(y);
   })[0];
   if(target){
    a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));
    const allies=squad(g,a),slot=Math.max(0,allies.indexOf(a));
    const base=Math.atan2((anchor?.x??a.x)-target.x,(anchor?.z??a.z)-target.z);
    const angle=base+(role==='flanker'?(slot%2?1:-1)*Math.PI*.65:(slot%3-1)*.6);
    const approach={x:target.x+Math.sin(angle)*1.8,z:target.z+Math.cos(angle)*1.8};
    if(dist(a,target)>2.2||!lineClear(a,target)||(role==='flanker'&&dist(a,approach)>.8))move(a,waypoint(a,approach),dt*stats.speed);
    if(dist(a,target)<=2.2&&lineClear(a,target)){
     a.block=role==='defender'&&a.swing===0;
     if(a.cd===0){a.block=false;hurt(g,target,stats.damage,a);noise(g,a,22);a.cd=stats.cooldown;a.swing=.25;a.attackSerial=(a.attackSerial??0)+1;}
    }
   }else if(anchor){
    const destination=owner?.downed&&a.mode==='follow'?anchor:formation(g,a,anchor,a.mode==='follow'||a.mode==='attack'?owner?.yaw??0:0);
    if(dist(a,destination)>(owner?.downed?1.6:.35)){
     const step=waypoint(a,destination);a.yaw=Math.atan2(step.x-a.x,-(step.z-a.z));move(a,step,dt*4.9);
    }
   }
  }else{
   const fort=g.castles.find(c=>c.id===a.castle);
   const target=nearest&&dist(a,nearest)<(a.kind==='corrupted'?20:13)&&lineClear(a,nearest)?nearest:undefined;const heard=g.noises.filter(n=>dist(a,n)<n.radius).sort((x,y)=>dist(a,x)-dist(a,y))[0];if(heard)a.investigate={x:heard.x,z:heard.z,until:g.time+6};
   const defense=g.castles.find(c=>c.friendly&&(c.barrier>0||c.gate>0)&&a.z>=c.z+(c.barrier>0?12:9)&&dist(a,c)<30&&(a.castle===c.id||(nearest&&Math.abs(nearest.x-c.x)<9&&Math.abs(nearest.z-c.z)<9)||(a.investigate&&Math.abs(a.investigate.x-c.x)<9&&Math.abs(a.investigate.z-c.z)<9)));
   if(defense){const front={x:defense.x,z:defense.z+(defense.barrier>0?14:11)};a.yaw=Math.atan2(front.x-a.x,-(front.z-a.z));if(dist(a,front)>1.8)moveEnemy(g,a,waypoint(a,front),dt*2.6);else if(a.cd===0){if(defense.barrier>0)defense.barrier=Math.max(0,defense.barrier-12);else defense.gate=Math.max(0,defense.gate-12);a.cd=1;a.swing=.25;a.attackSerial=(a.attackSerial??0)+1;noise(g,front,30);}continue;}
   if(a.windup>0){a.windup-=dt;if(a.windup<=0&&target&&dist(a,target)<2.8&&lineClear(a,target)){hurt(g,target,(a.kind==='corrupted'?24:13)*Math.max(.25,1-(a.severed??[]).filter(p=>p!=='head').length*.4),a);a.swing=.2;}continue;}
   if(target){a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));if(dist(a,target)>2||!lineClear(a,target))moveEnemy(g,a,waypoint(a,target),dt*(a.kind==='corrupted'?3.6:2.6));else if(a.cd===0){a.windup=.65;a.cd=1.65;a.attackSerial=(a.attackSerial??0)+1;}}
   else if(a.investigate&&a.investigate.until>g.time&&dist(a,a.investigate)>1.5){a.yaw=Math.atan2(a.investigate.x-a.x,-(a.investigate.z-a.z));moveEnemy(g,a,waypoint(a,a.investigate),dt*2.6);}
   else if(fort?.friendly){const gate={x:fort.x,z:fort.z+11};if(fort.gate>0||fort.barrier>0){if(dist(a,gate)>2.5)moveEnemy(g,a,waypoint(a,gate),dt*2.6);else if(a.cd===0){if(fort.barrier>0)fort.barrier=Math.max(0,fort.barrier-12);else fort.gate=Math.max(0,fort.gate-12);noise(g,gate,30);a.cd=1;a.swing=.2;}}else moveEnemy(g,a,waypoint(a,fort),dt*2.6);}
  }
 }
 separateCompanions(g,dt);
 interactions(g,dt);
 for(const c of g.castles.filter(c=>c.friendly)){
  const threats=g.actors.filter(a=>hostile(a)&&a.hp>0&&dist(a,c)<4);
  const defended=g.actors.some(a=>!hostile(a)&&a.hp>0&&dist(a,c)<5);
  c.lost=threats.length&&!defended&&c.gate<=0?c.lost+dt:Math.max(0,c.lost-dt);
  if(c.lost>=8){c.friendly=false;c.lost=0;c.gate=0;c.barrier=0;for(const a of threats)a.castle=c.id;event(g,`${c.name} has fallen. Reclaim its banner!`);}
 }
 for(const shot of g.shots.filter(s=>s.lands<=g.time)){if(g.castles.some(c=>c.id===shot.castle&&c.friendly))for(const a of g.actors)if(hostile(a)&&a.hp>0&&dist(a,{x:shot.tx,z:shot.tz})<4)hurt(g,a,shot.damage);}
 g.shots=g.shots.filter(s=>s.lands>g.time);
 for(const c of g.castles){c.artilleryCd=Math.max(0,c.artilleryCd-dt);if(!c.friendly)continue;const target=g.actors.filter(a=>hostile(a)&&a.hp>0&&dist(a,c)<34).sort((a,b)=>dist(a,c)-dist(b,c))[0];if(target&&c.artilleryCd===0){g.shots.push({id:++g.nextId,castle:c.id,x:c.x+6,z:c.z-6,tx:target.x,tz:target.z,lands:g.time+.7,damage:42+c.level*12});c.artilleryCd=g.regions.some(r=>r.id===c.region&&r.held)?3:4.5;}}
 for(const region of g.regions){const held=g.castles.filter(c=>c.region===region.id).every(c=>c.friendly);if(held&&!region.held){region.incomeAt=g.time+60;if(!region.paid){g.resources.wood+=40;g.resources.iron+=20;region.paid=true;}event(g,`${region.name} secured: supply income every minute and faster castle artillery.`);}if(!held&&region.held)event(g,`${region.name} supply routes lost. Reclaim every castle to restore them.`);region.held=held;if(held&&g.time>=region.incomeAt){g.resources.wood+=24;g.resources.iron+=12;g.resources.medicine+=2;region.incomeAt=g.time+60;event(g,`${region.name} supplies arrived: 24 wood, 12 iron, 2 healing supplies.`);}}
 if(g.everCaptured&&!g.castles.some(c=>c.friendly)){g.status='defeat';event(g,'The last stronghold has fallen.');return;}
 if(!g.siege&&g.everCaptured&&g.time>=g.nextSiege){const friendly=g.castles.filter(c=>c.friendly);const target=friendly[(g.stats.sieges+g.stats.captures)%friendly.length];g.siege={castle:target.id,starts:g.time+30,active:false};event(g,`Siege approaching ${target.name} in 30 seconds.`);}
 if(g.siege){const c=g.castles.find(c=>c.id===g.siege!.castle)!;
  if(!g.siege.active&&g.time>=g.siege.starts){g.siege.active=true;const count=6+Math.min(8,g.stats.sieges*2+Math.max(0,g.actors.filter(a=>a.kind==='player'&&a.connected).length-1)*2);for(let n=0;n<count;n++)spawn(g,n===count-1?'corrupted':'zombie',c.x+(n%3-1)*2,c.z+19+Math.floor(n/3)*2,{castle:c.id});event(g,`The siege of ${c.name} has begun.`);}
  if(g.siege.active&&(!c.friendly||!g.actors.some(a=>hostile(a)&&a.hp>0&&a.castle===c.id))){if(c.friendly){g.stats.sieges++;g.resources.wood+=16;g.resources.iron+=6;event(g,`Siege repelled at ${c.name}.`);}g.siege=null;const players=g.actors.filter(a=>a.kind==='player'&&a.connected);const pressure=players.length?players.reduce((v,a)=>v+1-a.hp/a.maxHp,0)/players.length:0;g.nextSiege=g.time+120+Math.round(pressure*60);}
 }
}
export function snapshot(g:Game){return {...g,actors:g.actors.map(({input,inputAt,lastSeq,...a})=>a)};}
