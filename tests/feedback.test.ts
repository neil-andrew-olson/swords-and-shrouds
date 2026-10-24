import {test} from 'node:test';import assert from 'node:assert/strict';import {createGame,addPlayer,spawn} from '../src/simulation/game';import {combatCues,eventCues,swingProfile} from '../src/client/combat-feedback';
test('combat feedback ignores joins, replayed snapshots and reconnect gaps',()=>{const g=createGame();addPlayer(g,'p','P');assert.deepEqual(combatCues(undefined,g,'p'),[]);assert.deepEqual(combatCues(g,g,'p'),[]);const next=structuredClone(g);next.time=2;next.actors.find(a=>a.id==='p')!.hp=1;assert.deepEqual(combatCues(g,next,'p'),[]);});
test('combat feedback follows confirmed swings and health loss with range and impact limits',()=>{const g=createGame();g.actors=[];const p=addPlayer(g,'p','P');for(let i=0;i<5;i++)spawn(g,'zombie',p.x+1,p.z);spawn(g,'zombie',70,-400);const next=structuredClone(g);next.time=.1;const n=next.actors.find(a=>a.id==='p')!;n.attackSerial=1;n.hp-=10;n.weapon='hammer';for(const a of next.actors)if(a.kind==='zombie')a.hp-=5;const cues=combatCues(g,next,'p');assert.equal(cues.filter(c=>c.kind==='impact').length,3);assert.equal(cues.filter(c=>c.kind==='swing').length,1);assert.equal(cues.find(c=>c.kind==='swing')!.weapon,'hammer');assert.ok(cues.some(c=>c.kind==='hurt'));assert.ok(cues.some(c=>c.kind==='equip'));assert.ok(cues.filter(c=>c.kind==='impact').every(c=>c.material==='flesh'));assert.ok(cues.every(c=>c.volume>0&&c.volume<=1));assert.deepEqual(combatCues(next,{...next,time:.2},'p'),[]);
const armed=structuredClone(next),replay=structuredClone(armed);replay.time=.3;assert.deepEqual(combatCues(armed,replay,'p'),[]);
const blocking=structuredClone(armed);blocking.time=.3;blocking.actors.find(a=>a.id==='p')!.block=true;assert.deepEqual(combatCues(armed,blocking,'p').map(c=>c.kind),['block']);
const siege=structuredClone(armed);siege.time=.3;siege.siege={castle:'keep',starts:1,active:true};assert.deepEqual(combatCues(armed,siege,'p').map(c=>c.kind),['siege']);
// Weapon-family swing profiles cover the whole arsenal, including the batch-2 weapons.
assert.equal(swingProfile('sword'),'thrust');assert.equal(swingProfile('rapier'),'thrust');
assert.equal(swingProfile('flamberge'),'cleave');assert.equal(swingProfile('dane_axe'),'cleave');assert.equal(swingProfile('zweihander'),'cleave');
assert.equal(swingProfile('mace'),'crush');assert.equal(swingProfile('hammer'),'crush');assert.equal(swingProfile('bastard'),'crush');
assert.equal(swingProfile('poleaxe'),'sweep');assert.equal(swingProfile('halberd'),'sweep');
assert.equal(swingProfile(undefined),undefined);assert.equal(swingProfile('not-a-weapon'),undefined);
// Milestone stingers fire once on a transition, never on the initial/replayed/stale snapshots.
assert.deepEqual(eventCues(undefined,g),[]);assert.deepEqual(eventCues(armed,armed),[]);
const captured=structuredClone(armed);captured.time=.3;captured.stats.captures++;assert.deepEqual(eventCues(armed,captured),['capture']);
const rescued=structuredClone(armed);rescued.time=.3;rescued.stats.rescues++;assert.deepEqual(eventCues(armed,rescued),['rescue']);
assert.deepEqual(eventCues(armed,siege),['siege']);
const won=structuredClone(armed);won.time=.3;won.status='victory';assert.deepEqual(eventCues(armed,won),['victory']);
const lost=structuredClone(armed);lost.time=.3;lost.status='defeat';assert.deepEqual(eventCues(armed,lost),['defeat']);
assert.deepEqual(eventCues(siege,{...siege,time:.4}),[]);
const stale=structuredClone(armed);stale.time=9;stale.stats.captures++;assert.deepEqual(eventCues(armed,stale),[]);});
