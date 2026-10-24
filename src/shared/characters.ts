import type {Actor} from './types';
export const PLAYER_CHARACTERS = {
  templar:'Crusader Knight',
  hero:'Vanguard Champion',
  berserker:'Iron Berserker',
  ranger:'Scout Ranger',
  ally:'Oathsworn Defender'
} as const;
export type PlayerCharacter = keyof typeof PLAYER_CHARACTERS;
export function isPlayerCharacter(value:string):value is PlayerCharacter {
  return Object.hasOwn(PLAYER_CHARACTERS,value);
}
export function characterAsset(a:Actor):string {
  if(a.kind==='player') return a.appearance && isPlayerCharacter(a.appearance) ? a.appearance : 'templar';
  if(a.kind==='soldier') return a.role==='defender'?'templar':a.role==='flanker'?'ranger':a.role==='heavy'?'berserker':'ally';
  if(a.kind==='corrupted') return 'fallen';
  return Number(a.id.replace(/[^0-9]/g,'') || 0)%2 ? 'zombie' : 'skeleton-soldier';
}
