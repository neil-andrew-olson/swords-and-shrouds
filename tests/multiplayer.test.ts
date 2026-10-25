import {test} from 'node:test';import assert from 'node:assert/strict';import {WebSocket} from 'ws';import {makeServer} from '../src/server/index';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function client(url:string){const ws=new WebSocket(url),messages:any[]=[];ws.on('message',v=>messages.push(JSON.parse(v.toString())));await new Promise<void>((r,j)=>{ws.once('open',r);ws.once('error',j);});return {ws,messages,send:(m:unknown)=>ws.send(JSON.stringify(m)),async next(type:string){for(let i=0;i<100;i++){const n=messages.findIndex(x=>x.type===type);if(n>=0)return messages.splice(n,1)[0];await wait(10);}throw new Error('Timeout waiting for '+type);}};}
test('independent sockets: rooms, sync, capacity, reconnect, leadership, isolation and restart',async()=>{
 const s=makeServer();await new Promise<void>(r=>s.server.listen(0,'127.0.0.1',r));const port=(s.server.address() as any).port;const url=`ws://127.0.0.1:${port}/ws`;const clients:Awaited<ReturnType<typeof client>>[]=[];
 try{assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);const a=await client(url);clients.push(a);a.send({type:'create',name:'Neil',difficulty:'warden'});const aw=await a.next('welcome');const b=await client(url);clients.push(b);b.send({type:'join',code:aw.code,name:'Ally'});const bw=await b.next('welcome');assert.notEqual(aw.id,bw.id);assert.equal(aw.code,bw.code);const state=await b.next('state');assert.equal(state.players.length,2);assert.equal(state.game.castles.length,9);assert.equal(state.game.difficulty,'warden','joiner inherits the host difficulty');assert.equal(s.rooms.get(aw.code)!.game.difficulty,'warden');
 a.send({type:'input',input:{mx:1,mz:0,yaw:1,attack:false,block:false,interact:false,seq:1}});await wait(200);const states=b.messages.filter(m=>m.type==='state');assert.ok(states.at(-1).game.actors.find((p:any)=>p.id===aw.id).x>0);
 const other=await client(url);clients.push(other);other.send({type:'create',name:'Other',difficulty:'nightmare'});const ow=await other.next('welcome');assert.notEqual(ow.code,aw.code);assert.equal(s.rooms.get(ow.code)!.game.difficulty,'knight','unknown difficulty clamps to knight');assert.equal(s.rooms.get(ow.code)!.game.actors.filter(a=>a.kind==='player').length,1);
 b.send({type:'create',name:'Ally',difficulty:'squire'});assert.match((await b.next('error')).text,/Already in a room/);assert.equal(s.rooms.get(aw.code)!.game.difficulty,'warden','joiner cannot change the host difficulty');
const bad=await client(url);clients.push(bad);bad.send({type:'join',code:'XXXXXX'});assert.match((await bad.next('error')).text,/not found/);
 for(let i=0;i<2;i++){const c=await client(url);clients.push(c);c.send({type:'join',code:aw.code});await c.next('welcome');}bad.send({type:'join',code:aw.code});assert.match((await bad.next('error')).text,/full/);
 a.ws.close();await wait(80);const resumed=await client(url);clients.push(resumed);resumed.send({type:'resume',code:aw.code,token:aw.token});assert.equal((await resumed.next('welcome')).id,aw.id);assert.equal(s.rooms.get(aw.code)!.seats.length,4);
 const room=s.rooms.get(aw.code)!;assert.equal(room.host,bw.id);room.game.status='defeat';resumed.send({type:'restart'});assert.match((await resumed.next('error')).text,/leader/);b.send({type:'restart'});await wait(80);assert.equal(room.game.status,'playing');assert.equal(room.game.actors.filter(a=>a.kind==='player').length,4);assert.equal(room.game.difficulty,'warden','restart preserves the room difficulty');assert.equal(room.game.stats.casters,2,'restart resets/repopulates caster counter');assert.equal(room.game.stats.casterBolts,0,'restart resets bolt counter');
 // Every room must receive snapshots, including even-index rooms.
 other.messages.length=0;await wait(230);assert.ok(other.messages.some(m=>m.type==='state'));
 // Cycle-10 co-op siege sync: both clients see the same boss siege + boss actor.
 const roomGame=room.game;for(const c of roomGame.castles)c.friendly=false;roomGame.everCaptured=false;roomGame.nextSiege=1e9;roomGame.stats.sieges=1;const qaCastle=roomGame.castles[0];const qaCaptures=roomGame.stats.captures;
 process.env.SS_QA='1';b.send({type:'qa-siege',index:2});await wait(360);process.env.SS_QA='';delete process.env.SS_QA;
 assert.equal(qaCastle.friendly,true,'QA gate auto-granted the first castle');assert.equal(roomGame.castles.filter((c:any)=>c.friendly).length,1,'exactly one friendly castle granted in co-op');assert.equal(roomGame.stats.captures,qaCaptures,'auto-grant does not count as a capture');assert.equal(roomGame.everCaptured,true);
 const latest=(c:any)=>c.messages.filter((m:any)=>m.type==='state').at(-1);
 const sa=latest(resumed).game.siege,sb=latest(b).game.siege;
 assert.ok(sa&&sa.active,'siege active in host snapshot');assert.equal(sa.boss,true);assert.equal(sa.bossName,'Shroud Warden');assert.equal(sa.index,2);assert.equal(sa.castle,qaCastle.id,'forced siege targets the auto-granted castle');
 assert.equal(sb.boss,true);assert.equal(sb.bossName,'Shroud Warden');assert.equal(sa.bossId,sb.bossId,'same siege boss id in co-op');assert.ok(sa.bossId,'boss id populated');
 const bossA=latest(resumed).game.actors.find((x:any)=>x.boss),bossB=latest(b).game.actors.find((x:any)=>x.boss);
 assert.ok(bossA&&bossB,'boss actor present in both co-op snapshots');assert.equal(bossA.id,bossB.id);assert.equal(bossA.name,'Shroud Warden');assert.equal(bossA.hp,bossB.hp);
 // Cycle-12 Shroud Screamer co-op sync: a forced index-3 siege spawns one screamer seen identically by
 // every client, and the default/invalid-difficulty rooms still expose an explicit difficulty snapshot.
 roomGame.siege=null;roomGame.actors=roomGame.actors.filter((a:any)=>a.kind==='player');
 process.env.SS_QA='1';b.send({type:'qa-siege',index:3});await wait(400);process.env.SS_QA='';delete process.env.SS_QA;
 const s3a=latest(resumed).game,s3b=latest(b).game;
 assert.equal(s3a.difficulty,'warden','co-op snapshot keeps the host difficulty');assert.equal(s3b.difficulty,'warden');
 assert.equal(s3a.siege.index,3);assert.equal(s3a.siege.boss,false);
 const scrA=s3a.actors.find((a:any)=>a.screamer),scrB=s3b.actors.find((a:any)=>a.screamer);
 assert.ok(scrA&&scrB,'screamer actor present in both co-op snapshots');assert.equal(scrA.id,scrB.id);assert.equal(scrA.name,'Shroud Screamer');assert.equal(scrA.kind,'corrupted');assert.equal(scrA.appearance,'skeleton-armoured');assert.equal(scrA.hp,scrB.hp);assert.equal(s3a.stats.screamers,1);assert.equal(s3b.stats.screamers,1);
 // Cycle-17 Shroud Caster co-op sync: index-3 siege includes a caster in both snapshots; a forced charge
 // launches the same projectile id/state to every client.
 const castA=s3a.actors.find((a:any)=>a.caster),castB=s3b.actors.find((a:any)=>a.caster);
 assert.ok(castA&&castB,'caster actor present in both co-op snapshots');assert.equal(castA.id,castB.id);assert.equal(castA.name,'Shroud Caster');assert.equal(castA.kind,'corrupted');assert.equal(castA.maxHp,castB.maxHp);assert.equal(s3a.stats.casters,s3b.stats.casters);
 const roomCaster=roomGame.actors.find((a:any)=>a.caster);const coPlayer=roomGame.actors.find((a:any)=>a.kind==='player'&&a.connected);
 if(roomCaster&&coPlayer){roomCaster.x=coPlayer.x;roomCaster.z=coPlayer.z-12;roomCaster.casterTarget=coPlayer.id;roomCaster.casterCharge=.3;roomCaster.casterCd=0;}
 await wait(450);
 const pA=latest(resumed).game.projectiles??[],pB=latest(b).game.projectiles??[];
 assert.equal(pA.length,pB.length,'co-op projectile count synced');if(pA.length){assert.equal(pA[0].id,pB[0].id);assert.equal(pA[0].caster,castA.id);assert.ok(pA[0].speed>0);}
 assert.equal(latest(resumed).game.stats.casterBolts,latest(b).game.stats.casterBolts);

 const otherState=other.messages.filter((m:any)=>m.type==='state').at(-1);
 assert.equal(otherState.game.difficulty,'knight','default/invalid-difficulty room snapshot is explicit knight');
 }finally{clients.forEach(c=>c.ws.terminate());await s.close();}
});

test('weapon recovery and independent equipment replicate across sockets and survive reconnect',async()=>{
 const s=makeServer();await new Promise<void>(r=>s.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${(s.server.address() as any).port}/ws`,clients:Awaited<ReturnType<typeof client>>[]=[];
 try{const a=await client(url);clients.push(a);a.send({type:'create',name:'Collector'});const aw=await a.next('welcome');const room=s.rooms.get(aw.code)!,p=room.game.actors.find(a=>a.id===aw.id)!,drop=room.game.weaponDrops[0];p.x=drop.x;p.z=drop.z;a.send({type:'input',input:{...{mx:0,mz:0,yaw:0,attack:false,block:false,interact:true,seq:1}}});await wait(180);assert.ok(room.game.armory.includes('hammer'));
 const b=await client(url);clients.push(b);b.send({type:'join',code:aw.code,name:'Late joiner'});const bw=await b.next('welcome');assert.ok((await b.next('state')).game.armory.includes('hammer'));b.send({type:'command',action:'equip:hammer'});await wait(160);const state=a.messages.filter(m=>m.type==='state').at(-1);assert.equal(state.game.actors.find((p:any)=>p.id===bw.id).weapon,'hammer');assert.equal(state.game.actors.find((p:any)=>p.id===aw.id).weapon,'sword');b.ws.close();await wait(50);const resume=await client(url);clients.push(resume);resume.send({type:'resume',code:aw.code,token:bw.token});await resume.next('welcome');assert.equal((await resume.next('state')).game.actors.find((p:any)=>p.id===bw.id).weapon,'hammer');
 // Cycle-13 co-op shield bash: the raw {type:'bash'} message is server-authoritative and syncs.
 const basher=room.game.actors.find((x:any)=>x.id===aw.id)!;
 const victim=room.game.actors.find((x:any)=>x.kind==='zombie'&&x.hp>0)??room.game.actors.find((x:any)=>x.kind==='corrupted'&&x.hp>0);
 assert.ok(victim,'co-op bash test has a hostile target');room.game.actors=room.game.actors.filter((x:any)=>x.kind==='player'||x.id===victim.id);
 basher.weapon='sword';basher.stamina=100;basher.cd=0;basher.bashCd=0;basher.x=0;basher.z=30;basher.yaw=0;
 victim.x=0;victim.z=28.4;victim.hp=100;victim.maxHp=100;victim.windup=.5;
 const victimHp=victim.hp;
 a.send({type:'bash'});await wait(240);
 const bashA=a.messages.filter((m:any)=>m.type==='state').at(-1).game,bashB=resume.messages.filter((m:any)=>m.type==='state').at(-1).game;
 assert.equal(bashA.stats.bashes,1,'bash counted once in co-op');assert.equal(bashB.stats.bashes,1,'joiner sees the bash stat');
 assert.equal(bashA.actors.find((x:any)=>x.id===victim.id).hp,victimHp-6,'bash damage authoritative');assert.equal(bashB.actors.find((x:any)=>x.id===victim.id).hp,victimHp-6);
 assert.equal(bashA.actors.find((x:any)=>x.id===victim.id).windup,0,'bash interrupts the target windup');
 const basherA=bashA.actors.find((x:any)=>x.id===aw.id),basherB=bashB.actors.find((x:any)=>x.id===aw.id);
 assert.ok(basherA.bashCd>0&&basherA.bashCd<=1.1,'bash cooldown exposed');assert.equal(basherA.bashCd,basherB.bashCd);
 assert.equal(basherA.stamina,basherB.stamina);
 }finally{clients.forEach(c=>c.ws.terminate());await s.close();}
});
