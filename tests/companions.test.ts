import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer,spawn,tick,command,snapshot} from '../src/simulation/game';
import {blocked,dist} from '../src/shared/world';
import type {Game} from '../src/shared/types';
function empty(){const g=createGame();g.actors=[];return g;}
function advance(g:Game,seconds:number){for(let i=0;i<seconds*20;i++)tick(g);}
test('roles rotate across recruits and replicate in snapshots',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');p.x=p.z=0;g.castles[0].friendly=true;g.resources.recruits=6;g.resources.iron=30;
 for(let i=0;i<6;i++)assert.equal(command(g,p.id,'recruit'),'');
 const allies=snapshot(g).actors.filter(a=>a.kind==='soldier');
 assert.deepEqual(allies.map(a=>a.role),['defender','flanker','heavy','defender','flanker','heavy']);
 for(const a of allies)for(const b of allies)if(a!==b)assert.ok(dist(a,b)>=1.2);
});
test('overlapping companions settle into separate follow slots without moving the player',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');
 const allies=Array.from({length:6},()=>spawn(g,'soldier',p.x,p.z,{owner:p.id,mode:'follow'}));
 advance(g,8);assert.equal(p.x,0);assert.equal(p.z,27);
 for(const a of allies){assert.ok(dist(a,p)>1);assert.ok(dist(a,p)<8);for(const b of allies)if(a!==b)assert.ok(dist(a,b)>1);}
});
test('travel places every follower separately and leaves hold and guard soldiers behind',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');p.x=p.z=0;g.castles[0].friendly=g.castles[3].friendly=true;
 const allies=Array.from({length:8},()=>spawn(g,'soldier',2,3,{owner:p.id,mode:'follow'}));
 const hold=spawn(g,'soldier',3,3,{owner:p.id,mode:'hold',hold:{x:3,z:3}}),guard=spawn(g,'soldier',4,3,{owner:p.id,mode:'guard',castle:'keep'});
 assert.equal(command(g,p.id,'travel:'+g.castles[3].id),'');
 for(const a of allies){assert.ok(dist(a,p)<7);assert.ok(dist(a,p)>=1.2);assert.ok(!blocked(a));for(const b of allies)if(a!==b)assert.ok(dist(a,b)>=1.2);}
 assert.equal(hold.z,3);assert.equal(guard.z,3);
});
test('defenders protect the owner while flankers pursue wider threats and heavies hit harder',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');p.x=30;p.z=25;
 const defender=spawn(g,'soldier',30,26,{owner:p.id,mode:'follow',role:'defender'});
 const flanker=spawn(g,'soldier',32,25,{owner:p.id,mode:'follow',role:'flanker'});
 spawn(g,'zombie',40,25,{cd:100});tick(g);
 assert.ok(flanker.x>32);assert.ok(defender.x<=30);
 const h=empty();const owner=addPlayer(h,'p','Knight');owner.x=30;owner.z=27;const heavy=spawn(h,'soldier',30,25,{role:'heavy'}),enemy=spawn(h,'corrupted',30,23,{cd:100});tick(h);
 assert.equal(enemy.hp,91);assert.equal(heavy.cd,1.35);
});
test('hold and guard respect their anchor and spacing cannot push soldiers through castle walls',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');p.x=40;p.z=30;
 const a=spawn(g,'soldier',8.7,0,{owner:p.id,mode:'hold',hold:{x:8,z:0}});
 const b=spawn(g,'soldier',8.7,0,{owner:p.id,mode:'guard',castle:'keep'});
 spawn(g,'zombie',20,0,{cd:100});advance(g,3);
 assert.ok(!blocked(a));assert.ok(!blocked(b));assert.ok(a.x<9);assert.ok(b.x<9);
});

test('explicit attack overrides defender follow leash and old snapshots gain roles',()=>{
 const g=empty(),p=addPlayer(g,'p','Knight');p.x=30;p.z=25;
 const s=spawn(g,'soldier',30,25,{owner:p.id,mode:'follow',role:'defender'});
 spawn(g,'zombie',45,25,{cd:100});assert.equal(command(g,p.id,'attack'),'');tick(g);assert.ok(s.x>30);
 delete s.role;tick(g);assert.ok(s.role);
});
