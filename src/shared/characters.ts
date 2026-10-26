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
/** Undead and goblin silhouettes use deterministic visual variants; combat stays melee-only. */
export const UNDEAD_ASSETS = ['zombie','skeleton-soldier','zombie-bloated','skeleton-armoured','goblin'] as const;
export type UndeadAsset = typeof UNDEAD_ASSETS[number];
/** Deterministic silhouette: id%5 -> zombie | skeleton | bloated | armoured | goblin.
 *  Stable spawn ids give each appearance 20 % of the horde without coupling art to game rules. */
export function undeadVariant(a:Actor):UndeadAsset {
  const numeric=Number(a.id.replace(/[^0-9]/g,'')||0);
  return UNDEAD_ASSETS[((numeric%5)+5)%5];
}
/** Base asset a variant falls back to if its GLB is missing/failed to load (undefined for bases). */
export function characterAssetFallback(a:Actor):string|undefined {
  if(a.kind!=='zombie') return undefined;
  const asset=undeadVariant(a);
  return asset==='zombie-bloated'||asset==='goblin'?'zombie':asset==='skeleton-armoured'?'skeleton-soldier':undefined;
}
export function characterAsset(a:Actor):string {
  if(a.kind==='player') return a.appearance && isPlayerCharacter(a.appearance) ? a.appearance : 'templar';
  if(a.kind==='soldier') return a.role==='defender'?'templar':a.role==='flanker'?'ranger':a.role==='heavy'?'berserker':'ally';
  if(a.kind==='corrupted') return a.appearance==='skeleton-armoured'?'skeleton-armoured':'fallen';
  return undeadVariant(a);
}
