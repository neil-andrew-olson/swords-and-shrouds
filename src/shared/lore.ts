/**
 * Campaign chronicle (cycle 12): short lore entries with pure unlock predicates. `main.ts` renders
 * the journal section, persists unlocked ids in localStorage (`ss-lore`) and fires one subtle toast
 * per new entry. No DOM/three/audio imports here so the tests can cover the full unlock matrix.
 */
export const LORE_STORAGE_KEY='ss-lore';

export type LoreState={
 castlesHeld:number;
 castlesTotal:number;
 survivorsRescued:number;
 survivorsTotal:number;
 campsRescued:number;
 campsTotal:number;
 siegesSurvived:number;
 nestSealed:boolean;
 nestVulnerable:boolean;
 bossSeen:boolean;
 bossKilled:boolean;
 weaponsRecovered:number;
 difficulty:'squire'|'knight'|'warden';
 victory:boolean;
 defeat:boolean;
};

export type LoreCategory='region'|'castle'|'survivors'|'nest'|'warden'|'weapon'|'ending';

export type LoreEntry={id:string;category:LoreCategory;title:string;text:string;hint:string;condition:(state:LoreState)=>boolean};

const allCastles=(state:LoreState)=>state.castlesTotal>0&&state.castlesHeld>=state.castlesTotal;
const allSurvivors=(state:LoreState)=>state.survivorsTotal>0&&state.survivorsRescued>=state.survivorsTotal;

export const LORE_ENTRIES:readonly LoreEntry[]=[
 {id:'region-march',category:'region',title:'The Green March',hint:'Reclaim your first castle.',text:'Green fields under a grey sky. The Green March was the kingdom\'s granary; now its roads belong to the shroud.',condition:state=>state.castlesHeld>=1},
 {id:'region-moor',category:'region',title:'The Ashen Moor',hint:'Reclaim four castles.',text:'The Ashen Moor is a country of cinders and old prayer stones. The dead gather where the ash lies thickest.',condition:state=>state.castlesHeld>=4},
 {id:'region-crown',category:'region',title:'The Frozen Crown',hint:'Reclaim seven castles.',text:'Snow buries the Frozen Crown, but the banners still stand. Take them and the three regions answer to one fire.',condition:state=>state.castlesHeld>=7},
 {id:'castle-keep',category:'castle',title:'The Fallen Keep',hint:'Hold the first castle.',text:'The Fallen Keep was the last hall to burn. Its hearth is cold, but the stones still remember a king\'s table.',condition:state=>state.castlesHeld>=1},
 {id:'castle-border',category:'castle',title:'The Border Fortress',hint:'Reclaim five castles.',text:'Border Fortress guards the road between regions. Whoever holds its gate decides which way the war will turn.',condition:state=>state.castlesHeld>=5},
 {id:'castle-citadel',category:'castle',title:'The High Citadel',hint:'Hold all nine castles.',text:'From the High Citadel you can see every road in the kingdom — and every one of them leads back to the nest.',condition:state=>state.castlesHeld>=9},
 {id:'survivors-mill',category:'survivors',title:'The Old Mill',hint:'Rescue three survivor groups.',text:'The miller\'s family sheltered in the cellar for a month. They still grind grain for anyone who brings a sword.',condition:state=>state.survivorsRescued>=3},
 {id:'survivors-all',category:'survivors',title:'Every Hearth Lit',hint:'Rescue all nine survivor groups.',text:'Nine hearths, nine stories. The kingdom is not castles — it is the people who come back to them.',condition:allSurvivors},
 {id:'nest-sealed',category:'nest',title:'The Nest Sealed',hint:'Hold every castle and rescue every survivor.',text:'The plague nest is a wound in the world, sealed by the old warding stones. Free the kingdom and the wound opens.',condition:state=>state.nestSealed},
 {id:'nest-vulnerable',category:'nest',title:'The Wound Opens',hint:'Free the kingdom, then stand before the nest.',text:'With every castle and hearth reclaimed, the shroud\'s grip fails. The plague nest is no longer a rumour — it is a target.',condition:state=>state.nestVulnerable},
 {id:'warden-seen',category:'warden',title:'The Shroud Warden',hint:'Survive until a boss siege begins.',text:'The Shroud Warden is no common corpse. It walks at the head of the horde, and the horde walks where it points.',condition:state=>state.bossSeen},
 {id:'warden-felled',category:'warden',title:'A Warden Falls',hint:'Kill a boss in a boss siege.',text:'Even a warden can fall. The shroud screams when it dies, and every horde in the kingdom hears it.',condition:state=>state.bossKilled},
 {id:'weapon-lineage',category:'weapon',title:'The Weapon Racks',hint:'Recover three or more weapons.',text:'Every blade in the racks has a lineage: a smith, a war, a name. Recover them and the fellowship fights with the kingdom\'s whole history.',condition:state=>state.weaponsRecovered>=3},
 {id:'road-warden',category:'region',title:'The Warden\'s Road',hint:'Begin a campaign on Warden difficulty.',text:'Some knights choose the hardest road on purpose. The kingdom remembers those who asked for no mercy.',condition:state=>state.difficulty==='warden'},
 {id:'end-victory',category:'ending',title:'The Kingdom Lives',hint:'Win a campaign.',text:'The nest is broken, the shroud recedes, and the hearths are lit again. The kingdom lives — because you would not let it die.',condition:state=>state.victory},
 {id:'end-defeat',category:'ending',title:'The Last Fire Fades',hint:'Lose a campaign.',text:'The last fire fades, but the story is not over. Every defeat leaves a map for the next fellowship.',condition:state=>state.defeat}
];

export function loreEntryUnlocked(entry:LoreEntry,state:LoreState):boolean{return !!entry.condition(state);}
export function unlockedLoreIds(state:LoreState):string[]{return LORE_ENTRIES.filter(entry=>loreEntryUnlocked(entry,state)).map(entry=>entry.id);}
/** Entries whose predicates pass but which are not in the persisted/known id set (max one toast per call). */
export function newlyUnlockedLore(known:ReadonlySet<string>|readonly string[],state:LoreState):LoreEntry[]{
 const knownSet=known instanceof Set?known:new Set(known);
 return LORE_ENTRIES.filter(entry=>loreEntryUnlocked(entry,state)&&!knownSet.has(entry.id));
}
export type LoreEntryView={id:string;category:LoreCategory;title:string;text:string;hint:string;unlocked:boolean};
export function loreEntryView(entry:LoreEntry,state:LoreState):LoreEntryView{
 const unlocked=loreEntryUnlocked(entry,state);
 return {id:entry.id,category:entry.category,title:entry.title,text:unlocked?entry.text:'',hint:entry.hint,unlocked};
}
export function loreEntryViews(state:LoreState,unlockedIds?:ReadonlySet<string>|readonly string[]):LoreEntryView[]{
 const unlockSet=unlockedIds?(unlockedIds instanceof Set?unlockedIds:new Set(unlockedIds)):new Set(unlockedLoreIds(state));
 return LORE_ENTRIES.map(entry=>{const view=loreEntryView(entry,state);const unlocked=unlockSet.has(entry.id)||view.unlocked;return unlocked&&!view.unlocked?{...view,unlocked:true,text:entry.text}:view;});
}
/** Subtle one-shot toast text for newly unlocked entries (null when nothing new). */
export function formatLoreToast(entries:readonly LoreEntry[]):string|null{
 if(entries.length===0)return null;
 const first=entries[0];
 return entries.length===1?`New chronicle entry: ${first.title}`:`New chronicle entries: ${first.title} +${entries.length-1}`;
}
