import {characterAsset} from '../shared/characters';
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
export class CharacterAssets {
  custom = new Map<string,GLTF>();
  customLoaded = false;
  loadError:unknown;
  customReady = Promise.all([
    ...WEAPON_IDS,'shield','hero','ally','fallen','berserker',
    'ranger','templar','survivor','skeleton-soldier','zombie'
  ].map(async name => {
    this.custom.set(name,await loadAsset('custom/'+name));
  })).then(() => {
    this.customLoaded=true;
  }).catch(error => {
    this.loadError=error;
    console.error('Generated character assets failed to load',error);
  });
  create(a:Actor) {
    if(!this.customLoaded) return;
    const source=this.custom.get(characterAsset(a));
    if(source) return customCharacter(source,a,this.custom);
  }
}
