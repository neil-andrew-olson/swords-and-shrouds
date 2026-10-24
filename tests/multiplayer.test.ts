import {test} from 'node:test';import assert from 'node:assert/strict';import {WebSocket} from 'ws';import {makeServer} from '../src/server/index';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function client(url:string){const ws=new WebSocket(url),messages:any[]=[];ws.on('message',v=>messages.push(JSON.parse(v.toString())));await new Promise<void>((r,j)=>{ws.once('open',r);ws.once('error',j);});return {ws,messages,send:(m:unknown)=>ws.send(JSON.stringify(m)),async next(type:string){for(let i=0;i<100;i++){const n=messages.findIndex(x=>x.type===type);if(n>=0)return messages.splice(n,1)[0];await wait(10);}throw new Error('Timeout waiting for '+type);}};}
test('independent sockets: rooms, sync, capacity, reconnect, leadership, isolation and restart',async()=>{
 const s=makeServer();await new Promise<void>(r=>s.server.listen(0,'127.0.0.1',r));const port=(s.server.address() as any).port;const url=`ws://127.0.0.1:${port}/ws`;const clients:Awaited<ReturnType<typeof client>>[]=[];
 try{assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);const a=await client(url);clients.push(a);a.send({type:'create',name:'Neil'});const aw=await a.next('welcome');const b=await client(url);clients.push(b);b.send({type:'join',code:aw.code,name:'Ally'});const bw=await b.next('welcome');assert.notEqual(aw.id,bw.id);assert.equal(aw.code,bw.code);const state=await b.next('state');assert.equal(state.players.length,2);assert.equal(state.game.castles.length,9);
 a.send({type:'input',input:{mx:1,mz:0,yaw:1,attack:false,block:false,interact:false,seq:1}});await wait(200);const states=b.messages.filter(m=>m.type==='state');assert.ok(states.at(-1).game.actors.find((p:any)=>p.id===aw.id).x>0);
 const other=await client(url);clients.push(other);other.send({type:'create',name:'Other'});const ow=await other.next('welcome');assert.notEqual(ow.code,aw.code);assert.equal(s.rooms.get(ow.code)!.game.actors.filter(a=>a.kind==='player').length,1);
 const bad=await client(url);clients.push(bad);bad.send({type:'join',code:'XXXXXX'});assert.match((await bad.next('error')).text,/not found/);
 for(let i=0;i<2;i++){const c=await client(url);clients.push(c);c.send({type:'join',code:aw.code});await c.next('welcome');}bad.send({type:'join',code:aw.code});assert.match((await bad.next('error')).text,/full/);
 a.ws.close();await wait(80);const resumed=await client(url);clients.push(resumed);resumed.send({type:'resume',code:aw.code,token:aw.token});assert.equal((await resumed.next('welcome')).id,aw.id);assert.equal(s.rooms.get(aw.code)!.seats.length,4);
 const room=s.rooms.get(aw.code)!;assert.equal(room.host,bw.id);room.game.status='defeat';resumed.send({type:'restart'});assert.match((await resumed.next('error')).text,/leader/);b.send({type:'restart'});await wait(80);assert.equal(room.game.status,'playing');assert.equal(room.game.actors.filter(a=>a.kind==='player').length,4);
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
 }finally{clients.forEach(c=>c.ws.terminate());await s.close();}
});

test('weapon recovery and independent equipment replicate across sockets and survive reconnect',async()=>{
 const s=makeServer();await new Promise<void>(r=>s.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${(s.server.address() as any).port}/ws`,clients:Awaited<ReturnType<typeof client>>[]=[];
 try{const a=await client(url);clients.push(a);a.send({type:'create',name:'Collector'});const aw=await a.next('welcome');const room=s.rooms.get(aw.code)!,p=room.game.actors.find(a=>a.id===aw.id)!,drop=room.game.weaponDrops[0];p.x=drop.x;p.z=drop.z;a.send({type:'input',input:{...{mx:0,mz:0,yaw:0,attack:false,block:false,interact:true,seq:1}}});await wait(180);assert.ok(room.game.armory.includes('hammer'));
 const b=await client(url);clients.push(b);b.send({type:'join',code:aw.code,name:'Late joiner'});const bw=await b.next('welcome');assert.ok((await b.next('state')).game.armory.includes('hammer'));b.send({type:'command',action:'equip:hammer'});await wait(160);const state=a.messages.filter(m=>m.type==='state').at(-1);assert.equal(state.game.actors.find((p:any)=>p.id===bw.id).weapon,'hammer');assert.equal(state.game.actors.find((p:any)=>p.id===aw.id).weapon,'sword');b.ws.close();await wait(50);const resume=await client(url);clients.push(resume);resume.send({type:'resume',code:aw.code,token:bw.token});await resume.next('welcome');assert.equal((await resume.next('state')).game.actors.find((p:any)=>p.id===bw.id).weapon,'hammer');
 }finally{clients.forEach(c=>c.ws.terminate());await s.close();}
});
