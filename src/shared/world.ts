export type Vec = { x:number; z:number };
export const CASTLES = [
  {id:'keep',name:'The Fallen Keep',x:0,z:0},
  {id:'border',name:'The Border Fortress',x:42,z:-67},
  {id:'citadel',name:'The High Citadel',x:-24,z:-135}
];
export const CAMPS = [{id:'mill',name:'The Old Mill',x:-20,z:19},{id:'crossing',name:'Ashen Crossing',x:22,z:-37},{id:'hamlet',name:'Hollow Hamlet',x:3,z:-102}];
export const NEST={x:0,z:-184};
export const START={x:0,z:27};
export const BOUNDS={minX:-75,maxX:85,minZ:-205,maxZ:43};
export const COSTS={repair:{wood:8,iron:2},barricade:{wood:12,iron:4},recruit:{wood:0,iron:3}};
export const dist=(a:Vec,b:Vec)=>Math.hypot(a.x-b.x,a.z-b.z);
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function walls(c:Vec){return [
 {x:c.x-10,z:c.z,w:1.5,d:20},{x:c.x+10,z:c.z,w:1.5,d:20},{x:c.x,z:c.z-10,w:20,d:1.5},
 {x:c.x-6.6,z:c.z+10,w:6.8,d:1.5},{x:c.x+6.6,z:c.z+10,w:6.8,d:1.5}
];}
export function blocked(p:Vec,r=.45){return CASTLES.some(c=>walls(c).some(w=>Math.abs(p.x-w.x)<w.w/2+r&&Math.abs(p.z-w.z)<w.d/2+r));}
export function move(p:Vec,target:Vec,amount:number){let dx=target.x-p.x,dz=target.z-p.z,len=Math.hypot(dx,dz); if(len<.01)return; amount=Math.min(amount,len); dx=dx/len*amount; dz=dz/len*amount;
 const nx=clamp(p.x+dx,BOUNDS.minX,BOUNDS.maxX),nz=clamp(p.z+dz,BOUNDS.minZ,BOUNDS.maxZ);
 if(!blocked({x:nx,z:p.z}))p.x=nx;if(!blocked({x:p.x,z:nz}))p.z=nz;
}
// Route actors through the south entrance rather than pushing through stone walls.
export function lineClear(a:Vec,b:Vec){const steps=Math.ceil(dist(a,b)*4);for(let i=1;i<steps;i++){const t=i/steps;if(blocked({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},.12))return false;}return true;}
export function waypoint(p:Vec,target:Vec):Vec{
 for(const c of CASTLES){const inside=(v:Vec)=>Math.abs(v.x-c.x)<9.2&&Math.abs(v.z-c.z)<9.2;
  if(inside(p)!==inside(target)){
   const gate={x:c.x,z:c.z+12};
   if(inside(p)){if(Math.abs(p.x-c.x)>1.5||p.z<c.z+7)return {x:c.x,z:c.z+8};return gate;}
   if(Math.abs(p.x-c.x)<2.4&&p.z>c.z+7&&p.z<c.z+14)return {x:c.x,z:c.z+7};
   if(dist(p,gate)>2.4){if(!lineClear(p,gate)){const side=p.x>=c.x?1:-1; if(p.z<c.z+12){if(Math.abs(p.x-c.x)<12)return {x:c.x+side*13,z:p.z};return {x:c.x+side*13,z:c.z+13};}}return gate;}return {x:c.x,z:c.z+7};
  }
 }return target;
}
