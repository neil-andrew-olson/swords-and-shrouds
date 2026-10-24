import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer,command,snapshot} from '../src/simulation/game';
import {PLAYER_CHARACTERS,UNDEAD_ASSETS,characterAsset,characterAssetFallback,isPlayerCharacter} from '../src/shared/characters';

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
 // Cycle-7 deterministic undead silhouettes: id%4 -> zombie | skeleton-soldier | zombie-bloated | skeleton-armoured.
 const undead=(id:string)=>({...a,kind:'zombie' as const,id});
 assert.equal(characterAsset(undead('z0')),'zombie');
 assert.equal(characterAsset(undead('z1')),'skeleton-soldier');
 assert.equal(characterAsset(undead('z2')),'zombie-bloated');
 assert.equal(characterAsset(undead('z3')),'skeleton-armoured');
 const reachable=new Set<string>();const fallbacks:Record<string,string|undefined>={};
 for(let n=0;n<16;n++){
  const actor=undead('a'+n),asset=characterAsset(actor);
  reachable.add(asset);
  assert.equal(characterAsset(actor),asset,'deterministic id '+n);
  fallbacks[asset]=characterAssetFallback(actor);
 }
 assert.deepEqual([...reachable].sort(),[...UNDEAD_ASSETS].sort(),'all four undead assets reachable');
 assert.equal(fallbacks['zombie'],undefined,'base zombie has no fallback');
 assert.equal(fallbacks['skeleton-soldier'],undefined,'base skeleton has no fallback');
 assert.equal(fallbacks['zombie-bloated'],'zombie','bloated falls back to the base zombie');
 assert.equal(fallbacks['skeleton-armoured'],'skeleton-soldier','armoured falls back to the base skeleton');
 // Variants keep the same actor kind/rig identity; non-undead kinds never report a fallback.
 assert.equal(characterAssetFallback({...a,kind:'player'}),undefined);
 assert.equal(characterAssetFallback({...a,kind:'corrupted'}),undefined);
 assert.equal(characterAssetFallback({...a,kind:'soldier'}),undefined);
});
