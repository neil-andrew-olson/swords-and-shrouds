export function deadzone(n:number,threshold=.18){return Math.abs(n)<threshold?0:Math.sign(n)*(Math.abs(n)-threshold)/(1-threshold);}
export function readPad(p:Pick<Gamepad,'axes'|'buttons'>,previous:boolean[]=[]){
 const down=(i:number)=>!!p.buttons[i]?.pressed||((p.buttons[i]?.value??0)>.5);
 const pressed=(i:number)=>down(i)&&!previous[i];
 return {mx:deadzone(p.axes[0]??0),forward:-deadzone(p.axes[1]??0),lookX:deadzone(p.axes[2]??0),lookY:deadzone(p.axes[3]??0),attack:down(7)||down(5),block:down(6),interact:down(0),toggle:pressed(3),heal:pressed(2),menu:pressed(9),commands:[pressed(12)?'follow':'',pressed(13)?'hold':'',pressed(15)?'attack':'',pressed(14)?'guard':''].filter(Boolean),previous:Array.from({length:17},(_,i)=>down(i))};
}
