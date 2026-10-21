import type {Actor,Game} from '../shared/types';
import {blocked,BOUNDS,dist,lineClear,move,type Vec} from '../shared/world';

export const ROLES=['defender','flanker','heavy'] as const;
export const ROLE_STATS={
 defender:{damage:18,cooldown:.85,speed:4.5,leash:7},
 flanker:{damage:16,cooldown:.65,speed:5.2,leash:15},
 heavy:{damage:34,cooldown:1.35,speed:3.9,leash:12}
};
export function squad(g:Game,a:Actor){return g.actors.filter(s=>s.kind==='soldier'&&s.hp>0&&s.owner===a.owner&&s.mode===a.mode&&(a.mode!=='guard'||s.castle===a.castle));}
export function formation(g:Game,a:Actor,anchor:Vec,yaw=0):Vec{
 const slot=Math.max(0,squad(g,a).indexOf(a)),row=Math.floor(slot/3),side=slot%3-1;
 const x=side*1.8,z=1.8+row*1.8;
 const point={x:anchor.x+x*Math.cos(yaw)-z*Math.sin(yaw),z:anchor.z+x*Math.sin(yaw)+z*Math.cos(yaw)};
 return blocked(point)?anchor:point;
}
// Search clear, unoccupied positions for recruitment and fast travel.
export function placeCompanion(g:Game,a:Actor,anchor:Vec){
 for(let ring=1;ring<=8;ring++)for(let n=0;n<ring*8;n++){
  const angle=Math.PI/2+n/(ring*8)*Math.PI*2,p={x:anchor.x+Math.sin(angle)*ring*1.4,z:anchor.z+Math.cos(angle)*ring*1.4};
  if(p.x<BOUNDS.minX||p.x>BOUNDS.maxX||p.z<BOUNDS.minZ||p.z>BOUNDS.maxZ||blocked(p)||!lineClear(anchor,p))continue;
  if(g.actors.some(b=>b!==a&&b.hp>0&&dist(b,p)<1.2))continue;
  a.x=p.x;a.z=p.z;return;
 }
}
// Move only soldiers, through the same wall-aware movement used by gameplay.
export function separateCompanions(g:Game,dt:number){
 const living=g.actors.filter(a=>a.hp>0);
 for(let pass=0;pass<2;pass++)for(const a of living){
  if(a.kind!=='soldier')continue;
  for(const b of living){if(a===b)continue;const d=dist(a,b);if(d>=1.15||!lineClear(a,b))continue;
   let dx=a.x-b.x,dz=a.z-b.z;
   if(d<.001){const sign=a.id<b.id?-1:1;dx=sign;dz=sign*.37;}
   const len=Math.hypot(dx,dz);move(a,{x:a.x+dx/len,z:a.z+dz/len},Math.min((1.15-d)*.5,dt*2));
  }
 }
}
