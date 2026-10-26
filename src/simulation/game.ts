import {isPlayerCharacter} from '../shared/characters';
import {ROLES,ROLE_STATS,formation,placeCompanion,separateCompanions,squad} from './companions';
import {CASTLES,CAMPS,REGIONS,NEST,START,COSTS,dist,move,waypoint,clamp,lineClear} from '../shared/world';
import type {Actor,Game,Input} from '../shared/types';
import {WEAPON_IDS,WEAPONS,isWeapon,weaponStats,type WeaponId} from '../shared/weapons';
import {DEFAULT_DIFFICULTY,difficultyPreset,type Difficulty} from '../shared/difficulty';
export const idle=():Input=>({mx:0,mz:0,yaw:0,attack:false,block:false,interact:false,seq:0});
export function event(g:Game,text:string,at?:{x:number;z:number}){g.events.push(at?{id:++g.nextId,text,time:g.time,x:at.x,z:at.z}:{id:++g.nextId,text,time:g.time});g.events=g.events.slice(-8);}
export function spawn(g:Game,kind:Actor['kind'],x:number,z:number,extra:Partial<Actor>={}):Actor{
 if(kind==='soldier'&&!extra.role)extra={...extra,role:ROLES[g.actors.filter(a=>a.kind==='soldier').length%ROLES.length]};
 const hp=kind==='player'?120:kind==='soldier'?90:kind==='corrupted'?125:52;
 const a:Actor={id:`a${++g.nextId}`,kind,name:kind==='corrupted'?'Corrupted knight':kind==='soldier'?'Oathsworn':kind==='zombie'?'Shrouded':'Knight',x,z,hp,maxHp:hp,yaw:0,cd:0,windup:0,swing:0,block:false,deadUntil:0,stamina:100,armor:'light',abilityCd:0,bashCd:0,...extra};
 if(kind==='zombie'||kind==='corrupted'){const hpScale=difficultyPreset(g.difficulty).enemyHp;if(hpScale!==1){a.maxHp=Math.max(1,Math.round(a.maxHp*hpScale));a.hp=Math.min(a.maxHp,Math.round(a.hp*hpScale));}}
 g.actors.push(a);return a;
}
export function createGame(difficulty:Difficulty=DEFAULT_DIFFICULTY):Game{
 // Weapon-rack drops are WEAPON_IDS-driven: the starter hammer plus one rack per castle. Filtering
 // out the two starter weapons keeps every rackable weapon covered exactly once as WEAPON_IDS grows.
 const rackPool:WeaponId[]=WEAPON_IDS.filter(id=>id!=='sword'&&id!=='hammer');
 const g:Game={time:0,difficulty,armory:['sword'],weaponDrops:[{id:'starter-hammer',weapon:'hammer',x:-3,z:30,taken:false},...CASTLES.map((c,i)=>({id:'rack-'+c.id,weapon:rackPool[i%rackPool.length],x:c.x-5,z:c.z+4,taken:false}))],regions:REGIONS.map(r=>({id:r.id,name:r.name,held:false,paid:false,incomeAt:0})),shots:[],projectiles:[],hazards:[],noises:[],status:'playing',actors:[],castles:CASTLES.map(c=>({...c,friendly:false,artilleryCd:3,level:0,gate:0,barrier:0,capture:0,lost:0,rewarded:false})),camps:CAMPS.map(c=>({...c,rescued:false})),resources:{wood:24,iron:14,medicine:5,recruits:0},caches:[],nest:{...NEST,hp:500,maxHp:500},everCaptured:false,siege:null,nextSiege:150,stats:{captures:0,rescues:0,sieges:0,recruited:0,kills:0,bossesSeen:0,bossesFelled:0,screamers:0,screams:0,bashes:0,casters:0,casterBolts:0,stalkers:0,stalkerLunges:0,colossi:0,slams:0,pools:0},events:[],nextId:0};
 g.castles.forEach((c,i)=>{for(let n=0;n<4+(i%3)*2+Math.floor(i/3);n++)spawn(g,n===5?'corrupted':'zombie',c.x-5+(n%3)*4,c.z-5+Math.floor(n/3)*4,{castle:c.id});});
 g.camps.forEach(c=>{for(let n=0;n<3;n++)spawn(g,'zombie',c.x+n*2-2,c.z-4);});
 for(let n=0;n<5;n++)spawn(g,n===4?'corrupted':'zombie',NEST.x-6+n*3,NEST.z+5,n===4?{name:'Plague Champion',hp:200,maxHp:200,weapon:'zweihander'}:{});
 // Cycle-17 Shroud Casters guard the plague nest (deterministic: two, flanking the nest approach).
 spawnCaster(g,NEST.x-9,NEST.z+13,{appearance:'fallen'});spawnCaster(g,NEST.x+9,NEST.z+13,{appearance:'skeleton-armoured'});
 // Cycle-18 Shroud Stalkers hunt the Ashen Moor/nest approach (two deterministic wilds spawns).
 spawnStalker(g,NEST.x-16,NEST.z+70,{appearance:'skeleton-armoured'});spawnStalker(g,NEST.x+18,NEST.z+86,{appearance:'fallen'});
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
/** Cycle-17 Shroud Caster: ranged corrupted. Deterministic stats/telegraph/bolt numbers. */
export const CASTER={hp:88,damage:16,speed:8.5,rangeMin:10,rangeMax:20,telegraph:1.0,cooldown:3,maxRange:26,radius:.6,lead:1.15};
function spawnCaster(g:Game,x:number,z:number,extra:Partial<Actor>={}):Actor{
 const a=spawn(g,'corrupted',x,z,{name:'Shroud Caster',hp:CASTER.hp,maxHp:CASTER.hp,armor:'light',caster:true,casterCd:1.2,appearance:'skeleton-armoured',...extra});
 g.stats.casters++;return a;
}
function launchShadowBolt(g:Game,c:Actor,target:Actor){
 const flight=Math.max(.15,dist(c,target)/CASTER.speed);
 const ax=target.x+Math.max(-6,Math.min(6,target.vx??0))*flight*CASTER.lead;
 const az=target.z+Math.max(-6,Math.min(6,target.vz??0))*flight*CASTER.lead;
 const dx=ax-c.x,dz=az-c.z,len=Math.hypot(dx,dz)||1;
 g.projectiles.push({id:'b'+(++g.nextId),caster:c.id,kind:'shadow-bolt',x:c.x,z:c.z,px:c.x,pz:c.z,dx:dx/len,dz:dz/len,tx:ax,tz:az,speed:CASTER.speed,damage:CASTER.damage,firedAt:g.time});
 g.stats.casterBolts++;c.casterCharge=0;c.casterCd=CASTER.cooldown;c.casterAim={x:ax,z:az};
 event(g,'Shadow bolt!',{x:c.x,z:c.z});c.yaw=Math.atan2(dx,-dz);
}
export const STALKER={hp:62,speed:5.2,lungeWindup:.45,lunge:.32,lungeDash:2.3,damage:18,cooldown:2.5,lungeRange:10,orbit:7.5};
function spawnStalker(g:Game,x:number,z:number,extra:Partial<Actor>={}):Actor{
 const a=spawn(g,'corrupted',x,z,{name:'Shroud Stalker',hp:STALKER.hp,maxHp:STALKER.hp,armor:'light',stalker:true,appearance:'skeleton-armoured',...extra});
 g.stats.stalkers++;return a;
}
function enrageWarden(g:Game,boss:Actor){
 if((boss.bossPhase??1)>=2)return;
 boss.bossPhase=2;if(g.siege&&g.siege.bossId===boss.id)g.siege.bossPhase=2;
 event(g,'The Shroud Warden howls — the shroud thickens!',{x:boss.x,z:boss.z});
 const castle=boss.castle;
 spawn(g,'corrupted',boss.x+4,boss.z+2,{castle,name:'Shroud Screamer',hp:72,maxHp:72,armor:'light',screamer:true,appearance:'skeleton-armoured'});g.stats.screamers++;
 spawnCaster(g,boss.x-4,boss.z+2,{castle,appearance:'fallen'});
}
export const COLOSSUS={hp:420,speed:2.2,armor:'heavy',slamTelegraph:1.4,slamTelegraphFast:.95,slamRadius:5.5,slamDamage:34,pools:12,poolDps:6,poolRadius:4.5,poolCap:6,cooldown:[4,2.8,2] as const};
function colossusPhase(g:Game,boss:Actor,phase:2|3){
 if((boss.bossPhase??1)>=phase)return;
 boss.bossPhase=phase;if(g.siege&&g.siege.bossId===boss.id)g.siege.bossPhase=phase;
 if(phase===2){
  event(g,'The Shroud Colossus roars — its hide splits!',{x:boss.x,z:boss.z});
  const castle=boss.castle;spawnStalker(g,boss.x+5,boss.z+2,{castle,appearance:'skeleton-armoured'});spawnStalker(g,boss.x-5,boss.z+2,{castle,appearance:'fallen'});
 }else event(g,'The Shroud Colossus cracks the earth — no mercy remains!',{x:boss.x,z:boss.z});
}
function resolveColossusSlam(g:Game,boss:Actor,secondary=false){
 const aim=boss.slamTarget;if(!aim)return;
 if(!lineClear(boss,aim)){event(g,'The Colossus strikes the stone!',{x:aim.x,z:aim.z});boss.slamCharge=0;boss.slamCd=COLOSSUS.cooldown[Math.min(2,(boss.bossPhase??1)-1)];return;}
 for(const a of g.actors)if(a.hp>0&&!hostile(a)&&dist(a,aim)<=COLOSSUS.slamRadius)hurt(g,a,COLOSSUS.slamDamage,boss);
 g.stats.slams++;event(g,'The Colossus splinters the earth!',{x:aim.x,z:aim.z});
 g.hazards.push({id:'h'+(++g.nextId),x:aim.x,z:aim.z,radius:COLOSSUS.poolRadius,expiresAt:g.time+COLOSSUS.pools,damagePerSecond:COLOSSUS.poolDps});
 g.stats.pools++;while(g.hazards.length>COLOSSUS.poolCap)g.hazards.splice(0,1);
 boss.slamCharge=0;boss.slamCd=COLOSSUS.cooldown[Math.min(2,(boss.bossPhase??1)-1)];
 if(!secondary&&(boss.bossPhase??1)>=3&&g.stats.slams%2===0)boss.slamDouble=.35;
}
function updateHazards(g:Game,dt:number){
 for(const h of g.hazards)if(g.time<h.expiresAt)for(const a of g.actors)if(a.hp>0&&!hostile(a)&&dist(a,h)<=h.radius)hurt(g,a,h.damagePerSecond*dt);
 g.hazards=g.hazards.filter(h=>h.expiresAt>g.time);
}
function updateProjectiles(g:Game,dt:number){
 const living=[];
 for(const p of g.projectiles){
  if(p.hit){if(g.time-(p.hitAt??0)>0.2)continue;living.push(p);continue;}
  const nx=p.x+p.dx*CASTER.speed*dt,nz=p.z+p.dz*CASTER.speed*dt,prev={x:p.x,z:p.z};
  let kind:'actor'|'wall'|'ground'|null=null,hitActor:Actor|undefined;
  if(!lineClear(prev,{x:nx,z:nz}))kind='wall';
  else{
   const probes=[{x:(p.x+nx)/2,z:(p.z+nz)/2},{x:nx,z:nz}];
   for(const a of g.actors){if(a.hp<=0||hostile(a))continue;if(probes.some(q=>dist(q,a)<CASTER.radius+.5)){kind='actor';hitActor=a;break;}}
   if(!kind&&dist({x:nx,z:nz},{x:p.tx,z:p.tz})<.7)kind='ground';
  }
  p.px=p.x;p.pz=p.z;
  if(kind){p.x=nx;p.z=nz;p.hit=kind;p.hitAt=g.time;p.hitId=hitActor?.id;
   if(hitActor){const caster=g.actors.find(a=>a.id===p.caster&&a.hp>0);hurt(g,hitActor,p.damage,caster);event(g,'Shadow bolt strikes '+hitActor.name+'!',{x:nx,z:nz});}
   else if(kind==='wall')event(g,'Shadow bolt fizzles against the stone.',{x:nx,z:nz});
   else event(g,'The shadow bolt scatters on the ground.',{x:nx,z:nz});
   living.push(p);continue;
  }
  p.x=nx;p.z=nz;
  if(g.time-p.firedAt>3.2){p.hit='ground';p.hitAt=g.time;event(g,'The shadow bolt scatters on the ground.',{x:nx,z:nz});}
  living.push(p);
 }
 g.projectiles=living;
}
export function noise(g:Game,p:{x:number;z:number},radius:number){g.noises.push({x:p.x,z:p.z,radius,until:g.time+4});g.noises=g.noises.slice(-24);}
export function sever(g:Game,a:Actor,part:'leftArm'|'rightArm'|'head'){
 if(a.kind!=='zombie'||a.severed?.includes(part))return;a.severed=[...(a.severed??[]),part];if(part==='head'&&a.hp>0)hurt(g,a,a.hp);
}
function hurt(g:Game,a:Actor,amount:number,attacker?:Actor){
 if(a.hp<=0)return;
 if(attacker&&hostile(attacker)&&!hostile(a))amount*=difficultyPreset(g.difficulty).enemyDamage;
 if(a.block&&attacker){const towards=Math.atan2(attacker.x-a.x,-(attacker.z-a.z));if(Math.cos(towards-a.yaw)>.2)amount*=attacker&&a.kind==='player'&&!weaponStats(a.weapon).shield?.55:.2;}
 if(a.kind==='player'&&a.armor==='heavy')amount*=.7;
 a.hp=Math.max(0,a.hp-amount);if(a.boss&&!a.colossus&&a.hp>0&&a.hp<=a.maxHp*.5&&(a.bossPhase??1)<2)enrageWarden(g,a);if(a.colossus&&a.hp>0){if(a.hp<=a.maxHp*.33&&(a.bossPhase??1)<3)colossusPhase(g,a,3);else if(a.hp<=a.maxHp*.66&&(a.bossPhase??1)<2)colossusPhase(g,a,2);}if(a.kind==='zombie'&&attacker?.kind==='player'&&attacker.weapon!=='hammer'){if(a.hp===0)sever(g,a,'head');else if(a.hp<=a.maxHp*.5)sever(g,a,(a.severed??[]).includes('rightArm')?'leftArm':(a.severed??[]).includes('leftArm')?'rightArm':attacker.x<a.x?'leftArm':'rightArm');}
 if(a.hp===0){a.deadUntil=g.time+(a.kind==='player'?12:a.kind==='soldier'?7:2);a.windup=0;if(a.kind==='player'){a.downed=true;a.revive=0;a.block=false;event(g,`${a.name} is down! Hold Interact nearby for 3 seconds before corruption takes hold.`);}if(hostile(a)){g.stats.kills++;g.resources.wood+=2;g.resources.iron++;if(a.boss){g.stats.bossesFelled++;}if(a.boss&&g.siege&&g.siege.bossId===a.id&&!g.siege.bossRewarded){g.siege.bossRewarded=true;g.siege.bossKilled=true;g.resources.wood+=10;g.resources.iron+=5;g.resources.medicine+=1;event(g,`${a.name} falls: +10 wood, +5 iron, +1 healing supply.`);}}if(a.kind==='soldier')event(g,'An Oathsworn has fallen. Corruption rises in 7 seconds.');}
}
function swing(g:Game,a:Actor){const w=weaponStats(a.weapon);a.stamina=Math.max(0,(a.stamina??100)-w.stamina);noise(g,a,22);a.cd=w.cooldown;a.swing=.25;a.attackSerial=(a.attackSerial??0)+1;for(const e of g.actors){if(!hostile(e)||e.hp<=0||dist(a,e)>w.reach||!lineClear(a,e))continue;const angle=Math.atan2(e.x-a.x,-(e.z-a.z));if(Math.cos(angle-a.yaw)>w.arc)hurt(g,e,w.damage,a);}
 if(dist(a,g.nest)<4&&g.castles.every(c=>c.friendly)&&g.camps.every(c=>c.rescued)){g.nest.hp=Math.max(0,g.nest.hp-w.damage);if(g.nest.hp===0){g.status='victory';event(g,'The shroud is broken. The kingdom lives.');}}
}
/** Cycle-13 shield bash constants: defensive tool, deliberately not a DPS replacement. */
export const BASH={stamina:14,cooldown:1.1,damage:6,stagger:.9,range:2.2,knockback:1.2,arcCos:.35,attackLock:.3};
/** Server-authoritative shield bash. Returns '' on success or a player-facing error string. */
export function shieldBash(g:Game,id:string):string{
 const p=g.actors.find(a=>a.id===id&&a.hp>0);
 if(!p||g.status!=='playing')return 'You cannot act right now.';
 if(p.kind!=='player'||!p.connected)return 'You cannot act right now.';
 if(p.downed)return 'You are down.';
 if((p.bashCd??0)>0)return 'Shield bash is recovering.';
 if(p.cd>0||p.swing>0)return 'Finish your attack first.';
 if(!weaponStats(p.weapon).shield)return 'You need a shield to bash.';
 if((p.stamina??100)<BASH.stamina)return 'Shield bash needs 14 stamina.';
 const candidates=g.actors.filter(e=>e.hp>0&&hostile(e)!==hostile(p)&&dist(p,e)<=BASH.range&&lineClear(p,e));
 const target=candidates.find(e=>Math.cos(Math.atan2(e.x-p.x,-(e.z-p.z))-p.yaw)>BASH.arcCos);
 if(!target)return 'No enemy in front to bash.';
 p.stamina=Math.max(0,(p.stamina??100)-BASH.stamina);
 p.bashCd=BASH.cooldown;
 p.cd=Math.max(p.cd,BASH.attackLock);
 p.block=false;
 p.bashSerial=(p.bashSerial??0)+1;
 p.attackSerial=(p.attackSerial??0)+1;
 hurt(g,target,BASH.damage,p);
 target.windup=0;target.cd=Math.max(target.cd,BASH.stagger);target.staggerUntil=g.time+BASH.stagger;target.attackSerial=(target.attackSerial??0)+1;
 const dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz)||1;
 move(target,{x:target.x+(dx/len)*BASH.knockback,z:target.z+(dz/len)*BASH.knockback},BASH.knockback);
 event(g,'Shield bash!',{x:target.x,z:target.z});
 g.stats.bashes++;
 return '';
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

/** Cycle-10 siege escalation: one deterministic siege built from the completed-siege count. Every
 *  second siege (and the endgame from the 9th on) is led by a corrupted 'Shroud Warden' boss. */
function openSiege(g:Game,requestedIndex=g.stats.sieges+1,startsAt=g.time+30):boolean{
 if(g.siege)return false;
 const friendly=g.castles.filter(c=>c.friendly);
 if(!friendly.length)return false;
 const index=Math.max(1,Math.floor(requestedIndex));
 g.stats.sieges=index-1;
 const target=friendly[((index-1)+g.stats.captures)%friendly.length];
 const boss=index%2===0||index>=9;
 // Cycle-19 alternation: boss sieges stay Warden except every fourth index (4,8,12,...) which is the Colossus.
 const colossus=boss&&index%4===0;
 const bossName=boss?(colossus?'Shroud Colossus':'Shroud Warden'):'';
 const bossHp=boss?(colossus?420:240+Math.min(40,Math.max(0,(index-2)*5))):0;
 g.siege={castle:target.id,starts:startsAt,active:false,boss,bossName,bossHp,index,waveSize:0,bossId:'',bossKilled:false,bossRewarded:false,bossPhase:boss?1:undefined,bossKind:boss?(colossus?'colossus':'warden'):undefined};
 const lead=boss?`${bossName} leads the horde.`:'';event(g,startsAt<=g.time?`The siege of ${target.name} begins! ${lead}`.trim():`Siege approaching ${target.name} in 30 seconds. ${lead}`.trim());
 return true;
}
/** QA-only deterministic siege starter; the server gates its message behind SS_QA (never normal play). */
/** QA-only: deterministically make the first castle friendly so a QA-gated forced siege has a target.
 *  Deliberately bypasses normal capture flow (no capture count, rewards or achievements) — only the
 *  server's SS_QA-gated qa-siege path calls this; production play never does. */
export function qaEnsureFriendlyCastle(g:Game):boolean{
 const castle=g.castles[0];
 if(!castle)return false;
 castle.friendly=true;
 g.everCaptured=true;
 return true;
}
export function qaForceEnrage(g:Game,fraction=.45):boolean{
 const boss=g.actors.find(a=>a.boss&&!a.colossus&&a.hp>0&&(a.bossPhase??1)<2);
 if(!boss)return false;
 boss.hp=Math.min(boss.hp,Math.ceil(boss.maxHp*Math.max(.05,Math.min(.9,fraction))));
 enrageWarden(g,boss);
 return true;
}
export function forceSiege(g:Game,index=g.stats.sieges+1):boolean{
 g.everCaptured=true;
 return openSiege(g,index,g.time);
}
export function tick(g:Game,dt=.05){
 if(g.status!=='playing')return;g.time+=dt;g.noises=g.noises.filter(n=>n.until>g.time);
 for(const a of g.actors){a.vx=dt>0?Math.max(-6,Math.min(6,(a.x-(a.px??a.x))/dt)):0;a.vz=dt>0?Math.max(-6,Math.min(6,(a.z-(a.pz??a.z))/dt)):0;a.px=a.x;a.pz=a.z;}
 for(const a of [...g.actors]){
  if(a.hp>0&&!hostile(a)&&g.castles.some(c=>c.friendly&&c.level>0&&dist(a,c)<9))a.hp=Math.min(a.maxHp,a.hp+dt*2);
  a.abilityCd=Math.max(0,(a.abilityCd??0)-dt);
  if(a.hp>0&&a.kind==='player')a.stamina=Math.max(0,Math.min(100,(a.stamina??100)+dt*(a.block?-22:a.cd>0?0:a.armor==='heavy'?10:18)));
  a.cd=Math.max(0,a.cd-dt);a.swing=Math.max(0,a.swing-dt);a.bashCd=Math.max(0,(a.bashCd??0)-dt);a.casterCd=Math.max(0,(a.casterCd??0)-dt);a.stalkerCd=Math.max(0,(a.stalkerCd??0)-dt);a.slamCd=Math.max(0,(a.slamCd??0)-dt);
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
   if(a.colossus&&a.hp>0){
    if((a.slamDouble??0)>0){a.slamDouble=Math.max(0,(a.slamDouble??0)-dt);if(a.slamDouble<=0)resolveColossusSlam(g,a,true);continue;}
    if((a.slamCharge??0)>0){a.slamCharge=Math.max(0,(a.slamCharge??0)-dt);if(a.slamTarget)a.yaw=Math.atan2(a.slamTarget.x-a.x,-(a.slamTarget.z-a.z));if(a.slamCharge<=0)resolveColossusSlam(g,a);continue;}
    const players=g.actors.filter(p=>p.kind==='player'&&p.hp>0);const target=players.sort((x,y)=>dist(a,x)-dist(a,y))[0]??nearest;
    if(target){const d=dist(a,target);if((a.slamCd??0)<=0&&d<=12){a.slamCharge=(a.bossPhase??1)>=3?COLOSSUS.slamTelegraphFast:COLOSSUS.slamTelegraph;a.slamTarget={x:target.x,z:target.z};a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));event(g,'The Shroud Colossus raises its fist!',{x:target.x,z:target.z});continue;}if(d>2.8)moveEnemy(g,a,waypoint(a,target),dt*((a.bossPhase??1)>=3?2.8:(a.bossPhase??1)>=2?2.5:COLOSSUS.speed));continue;}
   }
      if(a.stalker&&a.hp>0){
    const players=g.actors.filter(p=>p.kind==='player'&&p.hp>0);
    const target=players.sort((x,y)=>dist(a,x)-dist(a,y))[0]??nearest;
    if(target){
     if((a.stalkerWindup??0)>0){
      a.stalkerWindup=Math.max(0,(a.stalkerWindup??0)-dt);a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));
      if(a.stalkerWindup<=0){a.stalkerLunge=STALKER.lunge;a.stalkerTarget=target.id;event(g,'Shroud Stalker lunges!',{x:a.x,z:a.z});g.stats.stalkerLunges++;}
      continue;
     }
     if((a.stalkerLunge??0)>0){
      a.stalkerLunge=Math.max(0,(a.stalkerLunge??0)-dt);a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));moveEnemy(g,a,waypoint(a,target),dt*STALKER.speed*STALKER.lungeDash);
      if(a.stalkerLunge<=0){if(dist(a,target)<=4.5&&lineClear(a,target)){hurt(g,target,STALKER.damage,a);event(g,'A Shroud Stalker rakes '+target.name+'!',{x:a.x,z:a.z});}a.stalkerCd=STALKER.cooldown;}
      continue;
     }
     const d=dist(a,target);
     if((a.stalkerCd??0)<=0&&d>=4&&d<=STALKER.lungeRange&&lineClear(a,target)){a.stalkerWindup=STALKER.lungeWindup;a.stalkerTarget=target.id;a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));event(g,'A Shroud Stalker closes in!',{x:a.x,z:a.z});continue;}
     if(d<2.6&&lineClear(a,target)){if(a.cd===0){a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));hurt(g,target,STALKER.damage,a);a.cd=STALKER.cooldown;a.attackSerial=(a.attackSerial??0)+1;}continue;}
     const side=(a.id.charCodeAt(a.id.length-1)%2?1:-1);
     const backX=-Math.sin(target.yaw??0),backZ=Math.cos(target.yaw??0),sideX=Math.cos(target.yaw??0),sideZ=Math.sin(target.yaw??0);
     const orbit={x:target.x+backX*STALKER.orbit+sideX*side*4,z:target.z+backZ*STALKER.orbit+sideZ*side*4};
     a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));moveEnemy(g,a,waypoint(a,orbit),dt*STALKER.speed);continue;
    }
   }
      if(a.caster&&a.hp>0){
    if((a.casterCharge??0)>0){
     a.casterCharge=Math.max(0,(a.casterCharge??0)-dt);const aim=a.casterTarget?g.actors.find(e=>e.id===a.casterTarget&&e.hp>0):undefined;
     if(!aim){a.casterCharge=0;a.casterCd=.5;}
     else{a.yaw=Math.atan2(aim.x-a.x,-(aim.z-a.z));if(a.casterCharge<=0)launchShadowBolt(g,a,aim);}
     continue;
    }
    const visible=enemies.filter(e=>e.hp>0&&dist(a,e)>=CASTER.rangeMin&&dist(a,e)<=CASTER.rangeMax&&lineClear(a,e)).sort((x,y)=>dist(a,x)-dist(a,y))[0];
    if(visible&&(a.casterCd??0)<=0){a.casterTarget=visible.id;a.casterCharge=CASTER.telegraph;a.casterAim={x:visible.x,z:visible.z};a.yaw=Math.atan2(visible.x-a.x,-(visible.z-a.z));event(g,'A Shroud Caster gathers shadow!',{x:a.x,z:a.z});continue;}
    const close=nearest&&dist(a,nearest)<6;
    if(!close){if(nearest){const d=dist(a,nearest);if(d>CASTER.rangeMax||!lineClear(a,nearest)||d<CASTER.rangeMin){const dest=d<CASTER.rangeMin?{x:a.x-Math.sin(Math.atan2(nearest.x-a.x,-(nearest.z-a.z)))*1.5,z:a.z+Math.cos(Math.atan2(nearest.x-a.x,-(nearest.z-a.z)))*1.5}:nearest;moveEnemy(g,a,waypoint(a,dest),dt*2.4);}}continue;}
   }
      if(a.screamer&&!a.screamerAlerted&&nearest&&dist(a,nearest)<30){a.screamerAlerted=true;noise(g,a,32);g.stats.screams++;event(g,'A Shroud Screamer shrieks — the dead answer its call!');}
   const fort=g.castles.find(c=>c.id===a.castle);
   const target=nearest&&dist(a,nearest)<(a.kind==='corrupted'?20:13)&&lineClear(a,nearest)?nearest:undefined;const heard=g.noises.filter(n=>dist(a,n)<n.radius).sort((x,y)=>dist(a,x)-dist(a,y))[0];if(heard)a.investigate={x:heard.x,z:heard.z,until:g.time+6};
   const defense=g.castles.find(c=>c.friendly&&(c.barrier>0||c.gate>0)&&a.z>=c.z+(c.barrier>0?12:9)&&dist(a,c)<30&&(a.castle===c.id||(nearest&&Math.abs(nearest.x-c.x)<9&&Math.abs(nearest.z-c.z)<9)||(a.investigate&&Math.abs(a.investigate.x-c.x)<9&&Math.abs(a.investigate.z-c.z)<9)));
   if(defense){const front={x:defense.x,z:defense.z+(defense.barrier>0?14:11)};a.yaw=Math.atan2(front.x-a.x,-(front.z-a.z));if(dist(a,front)>1.8)moveEnemy(g,a,waypoint(a,front),dt*2.6);else if(a.cd===0){if(defense.barrier>0)defense.barrier=Math.max(0,defense.barrier-12);else defense.gate=Math.max(0,defense.gate-12);a.cd=1;a.swing=.25;a.attackSerial=(a.attackSerial??0)+1;noise(g,front,30);}continue;}
   if(a.windup>0){a.windup-=dt;if(a.windup<=0&&target&&dist(a,target)<2.8&&lineClear(a,target)){hurt(g,target,(a.boss?(a.maxHp<=240?28:30):a.kind==='corrupted'?24:13)*Math.max(.25,1-(a.severed??[]).filter(p=>p!=='head').length*.4),a);a.swing=.2;}continue;}
   if(target){a.yaw=Math.atan2(target.x-a.x,-(target.z-a.z));if(dist(a,target)>2||!lineClear(a,target)){const bossSpeed=a.boss?(a.colossus?((a.bossPhase??1)>=3?2.8:(a.bossPhase??1)>=2?2.5:COLOSSUS.speed):((a.bossPhase??1)>=2?3.8:2.9)):a.kind==='corrupted'?3.6:2.6;moveEnemy(g,a,waypoint(a,target),dt*bossSpeed);}else if(a.cd===0){a.windup=a.colossus?.9:a.boss?((a.bossPhase??1)>=2?.62:.95):.65;a.cd=a.colossus?1.8:a.boss?((a.bossPhase??1)>=2?1.5:2.2):1.65;a.attackSerial=(a.attackSerial??0)+1;}}
   else if(a.investigate&&a.investigate.until>g.time&&dist(a,a.investigate)>1.5){a.yaw=Math.atan2(a.investigate.x-a.x,-(a.investigate.z-a.z));moveEnemy(g,a,waypoint(a,a.investigate),dt*2.6);}
   else if(fort?.friendly){const gate={x:fort.x,z:fort.z+11};if(fort.gate>0||fort.barrier>0){if(dist(a,gate)>2.5)moveEnemy(g,a,waypoint(a,gate),dt*2.6);else if(a.cd===0){if(fort.barrier>0)fort.barrier=Math.max(0,fort.barrier-12);else fort.gate=Math.max(0,fort.gate-12);noise(g,gate,30);a.cd=1;a.swing=.2;}}else moveEnemy(g,a,waypoint(a,fort),dt*2.6);}
  }
 }
 updateProjectiles(g,dt);
 updateHazards(g,dt);
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
 if(!g.siege&&g.everCaptured&&g.time>=g.nextSiege)openSiege(g);
 if(g.siege){const c=g.castles.find(c=>c.id===g.siege!.castle)!;
  if(!g.siege.active&&g.time>=g.siege.starts){g.siege.active=true;const extra=Math.max(0,g.actors.filter(a=>a.kind==='player'&&a.connected).length-1)*2;const boss=!!g.siege.boss;const count=Math.max(4,Math.min(14,6+g.stats.sieges*2+extra+(boss?1:0)+difficultyPreset(g.difficulty).waveBonus));const normals=count-(boss?1:0);for(let n=0;n<normals;n++)spawn(g,n===normals-1?'corrupted':'zombie',c.x+(n%3-1)*2,c.z+19+Math.floor(n/3)*2,{castle:c.id});if(boss){const isColossus=g.siege.bossKind==='colossus';const bossHp=isColossus?420:Math.max(240,Math.min(280,g.siege.bossHp||240));const bossActor=spawn(g,'corrupted',c.x,c.z+19+Math.floor(normals/3)*2,{castle:c.id,name:g.siege.bossName||(isColossus?'Shroud Colossus':'Shroud Warden'),hp:bossHp,maxHp:bossHp,armor:'heavy',boss:true,bossPhase:1,appearance:isColossus?'skeleton-armoured':undefined});if(isColossus){bossActor.colossus=true;g.stats.colossi++;}g.siege.bossId=bossActor.id;g.siege.bossHp=bossActor.maxHp;g.stats.bossesSeen++;}if((g.siege.index??1)>=3){const screamerHp=72+Math.min(18,((g.siege.index??3)-3)*3);spawn(g,'corrupted',c.x+4,c.z+21+((g.siege.index??3)%3)*2,{castle:c.id,name:'Shroud Screamer',hp:screamerHp,maxHp:screamerHp,armor:'light',screamer:true,appearance:(g.siege.index??3)%2===0?'fallen':'skeleton-armoured'});g.stats.screamers++;}if((g.siege.index??1)>=2){spawnCaster(g,c.x-4,c.z+23+((g.siege.index??2)%3)*2,{castle:c.id,appearance:(g.siege.index??2)%2===0?'fallen':'skeleton-armoured'});}if((g.siege.index??1)>=3){spawnStalker(g,c.x-9,c.z+26,{castle:c.id,appearance:'skeleton-armoured'});spawnStalker(g,c.x+9,c.z+27,{castle:c.id,appearance:'fallen'});}g.siege.waveSize=count;event(g,boss?`${g.siege.bossName} leads the siege of ${c.name}!`:`The siege of ${c.name} has begun.`);}
  if(g.siege.active&&(!c.friendly||!g.actors.some(a=>hostile(a)&&a.hp>0&&a.castle===c.id))){if(c.friendly){g.stats.sieges++;g.resources.wood+=16;g.resources.iron+=6;event(g,`Siege repelled at ${c.name}.`);}g.siege=null;const players=g.actors.filter(a=>a.kind==='player'&&a.connected);const pressure=players.length?players.reduce((v,a)=>v+1-a.hp/a.maxHp,0)/players.length:0;g.nextSiege=g.time+120+Math.round(pressure*60);}
 }
}
export function snapshot(g:Game){return {...g,difficulty:g.difficulty??'knight',actors:g.actors.map(({input,inputAt,lastSeq,...a})=>a)};}
