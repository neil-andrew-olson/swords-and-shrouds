import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer,command,snapshot} from '../src/simulation/game';
import {PLAYER_CHARACTERS,characterAsset,isPlayerCharacter} from '../src/shared/characters';

test('character selection defaults to crusader and replicates independently',()=>{
 const game=createGame(),a=addPlayer(game,'one','One'),b=addPlayer(game,'two','Two');
 assert.equal(characterAsset(a),'templar');
 // Sixth playable appearance: Wandering Survivor uses the existing survivor rig/asset.
 assert.equal(PLAYER_CHARACTERS.survivor,'Wandering Survivor');
 assert.ok(isPlayerCharacter('survivor'));
 assert.equal(characterAsset({...a,appearance:'survivor'}),'survivor');
 const hp=a.hp,weapon=a.weapon;
 for(const choice of Object.keys(PLAYER_CHARACTERS)){
  assert.equal(command(game,a.id,'character:'+choice),'');
  assert.equal(snapshot(game).actors.find(p=>p.id===a.id)?.appearance,choice);
  assert.equal(characterAsset(a),choice);
  assert.equal(b.appearance,'templar');
  assert.equal(a.hp,hp);assert.equal(a.weapon,weapon);
 }
 assert.equal(snapshot(game).actors.find(p=>p.id===a.id)?.appearance,'survivor');
 assert.equal(characterAsset(a),'survivor');
 const previous=a.appearance;
 assert.ok(command(game,a.id,'character:knight'));
 assert.ok(command(game,a.id,'character:__proto__'));
 assert.equal(a.appearance,previous);
});

test('all actor kinds select generated character models',()=>{
 const a=addPlayer(createGame(),'one','One');
 assert.equal(characterAsset({...a,kind:'player',appearance:'survivor'}),'survivor');
 assert.equal(characterAsset({...a,kind:'soldier',role:'defender'}),'templar');
 assert.equal(characterAsset({...a,kind:'soldier',role:'flanker'}),'ranger');
 assert.equal(characterAsset({...a,kind:'soldier',role:'heavy'}),'berserker');
 assert.equal(characterAsset({...a,kind:'soldier',role:undefined}),'ally');
 assert.equal(characterAsset({...a,kind:'corrupted'}),'fallen');
 assert.equal(characterAsset({...a,kind:'zombie',id:'z2'}),'skeleton-soldier');
 assert.equal(characterAsset({...a,kind:'zombie',id:'z3'}),'zombie');
});
