import type {Actor} from './types';
export const PLAYER_CHARACTERS = {
  templar:'Crusader Knight',
  hero:'Vanguard Champion',
  berserker:'Iron Berserker',
  ranger:'Scout Ranger',
  ally:'Oathsworn Defender',
  survivor:'Wandering Survivor'
} as const;
export type PlayerCharacter = keyof typeof PLAYER_CHARACTERS;
export function isPlayerCharacter(value:string):value is PlayerCharacter {
  return Object.hasOwn(PLAYER_CHARACTERS,value);
}
/** Cycle-7 undead silhouettes: two bases + two variants that reuse the same rigs/clip sets. */
export const UNDEAD_ASSETS = ['zombie','skeleton-soldier','zombie-bloated','skeleton-armoured'] as const;
export type UndeadAsset = typeof UNDEAD_ASSETS[number];
/** Deterministic undead silhouette: id%4 -> zombie | skeleton-soldier | zombie-bloated | skeleton-armoured.
 *  Spawn ids are `a<N>` with a stable increment, so a region mixes 50 % base rigs and 50 % variants
 *  (≈25 % per variant) deterministically; map/gameplay logic never depends on the visual asset. */
export function undeadVariant(a:Actor):UndeadAsset {
  const numeric=Number(a.id.replace(/[^0-9]/g,'')||0);
  return UNDEAD_ASSETS[((numeric%4)+4)%4];
}
/** Base asset a variant falls back to if its GLB is missing/failed to load (undefined for bases). */
export function characterAssetFallback(a:Actor):string|undefined {
  if(a.kind!=='zombie') return undefined;
  const asset=undeadVariant(a);
  return asset==='zombie-bloated'?'zombie':asset==='skeleton-armoured'?'skeleton-soldier':undefined;
}
export function characterAsset(a:Actor):string {
  if(a.kind==='player') return a.appearance && isPlayerCharacter(a.appearance) ? a.appearance : 'templar';
  if(a.kind==='soldier') return a.role==='defender'?'templar':a.role==='flanker'?'ranger':a.role==='heavy'?'berserker':'ally';
  if(a.kind==='corrupted') return a.appearance==='skeleton-armoured'?'skeleton-armoured':'fallen';
  return undeadVariant(a);
}
