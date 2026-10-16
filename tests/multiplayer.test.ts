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
 }finally{clients.forEach(c=>c.ws.terminate());await s.close();}
});
