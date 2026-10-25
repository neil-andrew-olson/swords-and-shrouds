/** Cycle-11 difficulty presets (server-authoritative). Player damage/stamina are never touched; the
 *  presets only scale enemy outgoing damage, enemy spawn HP (bosses included) and siege wave size. */
export type Difficulty='squire'|'knight'|'warden';
export type DifficultyPreset={id:Difficulty;name:string;blurb:string;enemyDamage:number;enemyHp:number;waveBonus:number};
export const DIFFICULTIES:Record<Difficulty,DifficultyPreset>={
 squire:{id:'squire',name:'Squire',blurb:'A forgiving road. The dead hit softer and arrive in smaller hordes.',enemyDamage:.75,enemyHp:.85,waveBonus:-2},
 knight:{id:'knight',name:'Knight',blurb:'The intended campaign. Every blow and every horde as forged.',enemyDamage:1,enemyHp:1,waveBonus:0},
 warden:{id:'warden',name:'Warden',blurb:'No mercy. The shroud strikes harder, endures longer and masses in greater numbers.',enemyDamage:1.3,enemyHp:1.15,waveBonus:2}
};
export const DIFFICULTY_IDS:readonly Difficulty[]=['squire','knight','warden'];
export const DEFAULT_DIFFICULTY:Difficulty='knight';
export const isDifficulty=(value:unknown):value is Difficulty=>typeof value==='string'&&Object.hasOwn(DIFFICULTIES,value);
export const difficultyPreset=(id:Difficulty=DEFAULT_DIFFICULTY):DifficultyPreset=>DIFFICULTIES[id];
