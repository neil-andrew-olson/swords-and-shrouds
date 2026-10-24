import {characterAsset,characterAssetFallback,UNDEAD_ASSETS} from '../shared/characters';
import {WEAPON_IDS} from '../shared/weapons';
import {customCharacter} from './custom-character';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';

import type {Actor} from '../shared/types';
const loader=new GLTFLoader();
const loadedAssets=new Map<string,Promise<GLTF>>();
export function loadAsset(name:string):Promise<GLTF>{let loading=loadedAssets.get(name);if(!loading){loading=fetchAsset(name);loadedAssets.set(name,loading);loading.catch(()=>loadedAssets.delete(name));}return loading;}
async function fetchAsset(name:string):Promise<GLTF>{
 const response=await fetch(`${import.meta.env.BASE_URL}assets/${name}.glb.gz`);if(!response.ok)throw Error(`Asset ${name}: ${response.status}`);
 const payload=await response.arrayBuffer(),header=new Uint8Array(payload,0,Math.min(2,payload.byteLength));
 // Hosts may already decompress .gz responses through Content-Encoding.
 const bytes=header[0]===0x1f&&header[1]===0x8b?await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():payload;
 return loader.parseAsync(bytes,`${import.meta.env.BASE_URL}assets/`);
}
/**
 * Batch-3 progressive loading:
 *  - `coreReady` resolves once the small join-critical set (weapons + shield + player/allied
 *    characters) is on disk; main.ts enables Create/Join on this.
 *  - `customReady` keeps its batch-1/2 semantics: it resolves once the core set is loaded so the
 *    scene can start streaming world props; heavy enemy character models continue in the
 *    background and simply appear when their actors first need them.
 *  - `progress` is a live {loaded,total} counter for the loading UI.
 */
export class CharacterAssets {
 custom = new Map<string,GLTF>();
 customLoaded = false;
 loadError:unknown;
 progress={loaded:0,total:0};
 coreReady:Promise<void>;
 customReady:Promise<void>;
 constructor(){
   // Cycle-3 time-to-HUD: only the bodies that must exist at the first playable frame are in the
   // blocking core set. Everything else (other weapons, rare enemy bodies) streams in the background
   // after the player is already in-world, one asset at a time with a task yield between loads so the
   // join/first-frame work never competes with a 15-fetch burst.
   const starterWeapon=WEAPON_IDS[0]??'sword';
   const core:string[]=['hero','ally','survivor',starterWeapon,'shield'];
   // Cycle-7 undead variants stream after the join-critical core; missing assets are tolerated
   // (weapons-armory maps a deterministic id subset and falls back to the base bodies).
   const extras:string[]=[...WEAPON_IDS.filter(id=>id!==starterWeapon),'fallen','berserker','ranger','templar',...UNDEAD_ASSETS];
   this.progress.total=core.length+extras.length;
   const load=async(name:string)=>{
    try{this.custom.set(name,await loadAsset('custom/'+name));}
    catch(error){this.loadError=error;console.warn('Character asset failed',name,error);}
    finally{this.progress.loaded++;}
   };
   try{performance.mark('ss:coreStart');}catch{}
   this.coreReady=Promise.all(core.map(load)).then(()=>{this.customLoaded=true;try{performance.mark('ss:coreReady');}catch{}});
   this.customReady=this.coreReady.then(async()=>{
    for(const name of extras){await load(name);await new Promise<void>(resolve=>setTimeout(resolve,0));}
   }).then(()=>undefined);
 }
 create(a:Actor) {
  if(!this.customLoaded) return;
  const asset=characterAsset(a);
  const fallback=characterAssetFallback(a);
  const source=this.custom.get(asset)??(fallback?this.custom.get(fallback):undefined);
  if(source) return customCharacter(source,a,this.custom);
}
}
