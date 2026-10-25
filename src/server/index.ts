import express from 'express';
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createGame,addPlayer,setInput,command,tick,snapshot,idle,forceSiege,qaEnsureFriendlyCastle} from '../simulation/game';
import {DEFAULT_DIFFICULTY,isDifficulty} from '../shared/difficulty';
import type {Game} from '../shared/types';
type Seat={id:string;token:string;name:string;ws?:WebSocket;left:number};
type Room={code:string;game:Game;seats:Seat[];host:string;lastActive:number;ended:number;};
export function makeServer(){
 const app=express(),server=createServer(app),wss=new WebSocketServer({server,path:'/ws',maxPayload:2048});const rooms=new Map<string,Room>();
 app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
 app.use(express.static(resolve('dist/client')));
 const send=(ws:WebSocket,data:unknown)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<512_000)ws.send(JSON.stringify(data));};
 const roomMessage=(r:Room)=>({type:'state',code:r.code,host:r.host,game:snapshot(r.game),players:r.seats.map(s=>({id:s.id,name:s.name,connected:!!s.ws}))});
 const broadcast=(r:Room)=>r.seats.forEach(s=>s.ws&&send(s.ws,roomMessage(r)));
 function removeExpired(r:Room,now:number){for(const s of [...r.seats])if(!s.ws&&now-s.left>60_000){r.seats=r.seats.filter(a=>a!==s);r.game.actors=r.game.actors.filter(a=>a.id!==s.id);for(const a of r.game.actors)if(a.owner===s.id)a.owner=r.seats[0]?.id;}if(!r.seats.some(s=>s.id===r.host&&s.ws))r.host=r.seats.find(s=>s.ws)?.id??r.host;}
 wss.on('connection',(ws,req)=>{
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host){ws.close(1008,'Origin rejected');return;}}catch{ws.close(1008);return;}}
  let room:Room|undefined,seat:Seat|undefined,windowAt=Date.now(),count=0,alive=true,missedPongs=0,lastCommand=0;
  const error=(text:string)=>send(ws,{type:'error',text});
  ws.on('pong',()=>{alive=true;missedPongs=0;});ws.on('error',()=>ws.terminate());
  const joinTimeout=setTimeout(()=>{if(!seat)ws.close(1008,'Join timeout');},15000);
  // Tolerate one missed pong: software-rendered / low-FPS clients can stall their main thread for
  // long enough to delay the pong, and terminating on the first miss caused spurious 1006 closes
  // followed by a full room resume. Two consecutive misses (~30 s) is still a dead connection.
  const heartbeat=setInterval(()=>{if(!alive){if(++missedPongs>=2)ws.terminate();}else missedPongs=0;alive=false;ws.ping();},15000);
  ws.on('message',raw=>{const now=Date.now();if(now-windowAt>1000){count=0;windowAt=now;}if(++count>65){ws.close(1008,'Too many messages');return;}
   let m:any;try{m=JSON.parse(raw.toString());}catch{return error('Invalid message.');}if(!m||typeof m.type!=='string')return error('Invalid message.');
   if(m.type==='create'||m.type==='join'||m.type==='resume'){
    if(seat)return error('Already in a room.');
    if(m.type==='create'){if(rooms.size>=40)return error('Server is full. Try again later.');let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));const difficulty=isDifficulty(m.difficulty)?m.difficulty:DEFAULT_DIFFICULTY;room={code,game:createGame(difficulty),seats:[],host:'',lastActive:now,ended:0};rooms.set(code,room);}
    else{if(typeof m.code!=='string')return error('Enter a room code.');room=rooms.get(m.code.toUpperCase());if(!room)return error('Room not found or expired.');}
    removeExpired(room,now);
    if(m.type==='resume'){
     seat=room.seats.find(s=>typeof m.token==='string'&&s.token===m.token);if(!seat)return error('Session expired. Join the room again.');
     const old=seat.ws;seat.ws=ws;if(old&&old!==ws)old.close(4001,'Reconnected elsewhere');const p=room.game.actors.find(a=>a.id===seat!.id);if(p){p.connected=true;p.lastSeq=-1;p.input=idle();}
    }else{
     if(room.game.status!=='playing')return error('Campaign finished. Ask the host to restart.');if(room.seats.length>=4)return error('Room is full (four players).');
     const name=typeof m.name==='string'?m.name.replace(/[<>\x00-\x1F]/g,'').trim().slice(0,20):'';
     seat={id:randomBytes(8).toString('hex'),token:randomBytes(24).toString('hex'),name:name||'Knight',ws,left:0};room.seats.push(seat);addPlayer(room.game,seat.id,seat.name);if(!room.host)room.host=seat.id;
    }
    clearTimeout(joinTimeout);room.lastActive=now;send(ws,{type:'welcome',id:seat.id,token:seat.token,code:room.code});broadcast(room);return;
   }
   if(!room||!seat||seat.ws!==ws)return error('Join a room first.');
   if(m.type==='input')setInput(room.game,seat.id,m.input);
   else if(m.type==='command'){if(now-lastCommand<180)return;lastCommand=now;const result=command(room.game,seat.id,typeof m.action==='string'?m.action:'');if(result)error(result);}
   else if(m.type==='qa-siege'){
    // QA-only deterministic siege: strictly gated so production servers never expose it. Reuses the
    // normal siege creation path; refuses while a siege is already running.
    if(process.env.SS_QA!=='1')return error('QA siege forcing is disabled.');
    if(room.game.siege)return error('A siege is already active.');
    if(!room.game.castles.some(c=>c.friendly))qaEnsureFriendlyCastle(room.game);
    const index=typeof m.index==='number'&&Number.isFinite(m.index)?Math.max(1,Math.floor(m.index)):undefined;
    if(!forceSiege(room.game,index))return error('Could not start a siege.');
    broadcast(room);
   }
   else if(m.type==='restart'){if(room.host!==seat.id)return error('Only the room leader can restart.');if(room.game.status==='playing')return error('Finish the campaign before restarting.');room.game=createGame(room.game.difficulty);room.ended=0;for(const s of room.seats){const p=addPlayer(room.game,s.id,s.name);p.connected=!!s.ws;}broadcast(room);}
  });
  ws.on('close',()=>{clearTimeout(joinTimeout);clearInterval(heartbeat);if(room&&seat&&seat.ws===ws){seat.ws=undefined;seat.left=Date.now();const p=room.game.actors.find(a=>a.id===seat!.id);if(p){p.connected=false;p.input=idle();p.block=false;}removeExpired(room,Date.now());broadcast(room);}});
 });
 let frames=0;const timer=setInterval(()=>{const now=Date.now();frames++;for(const [code,r] of rooms){removeExpired(r,now);if(r.seats.some(s=>s.ws)){r.lastActive=now;tick(r.game);if(frames%2===0)broadcast(r);}if(r.game.status!=='playing'&&!r.ended)r.ended=now;if(now-r.lastActive>300000||(r.ended&&now-r.ended>600000)){r.seats.forEach(s=>s.ws?.close(4000,'Room expired'));rooms.delete(code);}}},50);
 return {app,server,rooms,close:async()=>{clearInterval(timer);for(const ws of wss.clients)ws.terminate();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const s=makeServer();const port=Number(process.env.PORT)||3000;s.server.listen(port,'0.0.0.0',()=>console.log(`Swords & Shrouds server listening on ${port}`));process.on('SIGTERM',()=>{s.close().then(()=>process.exit(0));});}
