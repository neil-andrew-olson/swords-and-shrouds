export const WEAPONS = {
 sword: {name:'Longsword', asset:'sword', damage:34, reach:3.4, cooldown:.65, stamina:18, arc:.25, length:.9, shield:true, style:'Balanced blade · shield guard'},
 bastard: {name:'Bastard sword', asset:'bastard', damage:43, reach:3.6, cooldown:.8, stamina:23, arc:.2, length:1.1, shield:true, style:'Heavy blade · shield guard'},
 hammer: {name:'Warhammer', asset:'hammer', damage:64, reach:2.7, cooldown:1.15, stamina:30, arc:.5, length:.85, shield:true, style:'Crushing blow · short reach'},
 poleaxe: {name:'Poleaxe', asset:'poleaxe', damage:46, reach:4.5, cooldown:1, stamina:26, arc:.65, length:1.65, shield:false, style:'Long reach · narrow strike · weapon parry'},
 zweihander: {name:'Zweihander', asset:'zweihander', damage:52, reach:4, cooldown:1.2, stamina:32, arc:-.05, length:1.45, shield:false, style:'Wide cleave · weapon parry'},
} as const;
export type WeaponId=keyof typeof WEAPONS;
export const WEAPON_IDS=Object.keys(WEAPONS) as WeaponId[];
export const weaponStats=(id?:WeaponId)=>WEAPONS[id??'sword'];
export const isWeapon=(id:string):id is WeaponId=>Object.hasOwn(WEAPONS,id);
