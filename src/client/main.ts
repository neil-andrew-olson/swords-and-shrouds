import {PLAYER_CHARACTERS,isPlayerCharacter} from '../shared/characters';
import './style.css';
import {CombatAudio,combatCues,eventCues} from './combat-feedback';
import {Ambience} from './ambience';
import {WEAPON_IDS,WEAPONS,weaponStats} from '../shared/weapons';
import {WorldView} from './scene';
import {readPad} from './controller';
import {dist,clamp,BOUNDS,REGIONS} from '../shared/world';
import type {Game,Actor} from '../shared/types';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world');let view:WorldView;try{view=new WorldView(canvas);}catch(e){$('connection').textContent='WebGL could not start. Try a browser with hardware acceleration enabled.';throw e;}
let game:Game|undefined,id='',code='',host='',token='',ws:WebSocket|undefined,seq=0,yaw=0,pitch=-.13,first=localStorage.getItem('ss-camera')==='first',sensitivity=Number(localStorage.getItem('ss-sensitivity'))||1,invert=localStorage.getItem('ss-invert')==='true';
let attempts=0,everJoined=false,lastSend=0,lastHud=0,lastFrame=performance.now(),lastEvent=0,toastUntil=0,stopped=false;
let padPrev:boolean[]=[],menuPrev:boolean[]=[],padIndex=-1,padName='',menuIndex=0;
const keys=new Set<string>(),mouse={attack:false,block:false},touch={mx:0,forward:0,attack:false,block:false,interact:false};
const guide=$<HTMLDialogElement>('guide'),result=$<HTMLDialogElement>('result');
const me=()=>game?.actors.find(a=>a.id===id);
const send=(value:unknown)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
let sound:AudioContext|undefined;function tone(freq=180){if(!$<HTMLInputElement>('sound').checked)return;try{sound??=new AudioContext();void sound.resume();const o=sound.createOscillator(),gain=sound.createGain();o.type='triangle';o.frequency.setValueAtTime(freq,sound.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.5,sound.currentTime+.13);gain.gain.setValueAtTime(.04,sound.currentTime);gain.gain.exponentialRampToValueAtTime(.001,sound.currentTime+.15);o.connect(gain);gain.connect(sound.destination);o.start();o.stop(sound.currentTime+.16);}catch{}}
const soundEnabled=()=>$<HTMLInputElement>('sound').checked;
const combatAudio=new CombatAudio(soundEnabled);const ambience=new Ambience(soundEnabled);
const unlockAudio=()=>{combatAudio.unlock();ambience.unlock();};
window.addEventListener('pointerdown',unlockAudio);window.addEventListener('keydown',unlockAudio);
$('sound').onchange=()=>{if(soundEnabled())unlockAudio();};
function toast(text:string){$('toast').textContent=text;toastUntil=performance.now()+5000;}
function cmd(action:string){send({type:'command',action});}
function cameraToggle(){first=!first;localStorage.setItem('ss-camera',first?'first':'third');$('cameraBtn').textContent=`${first?'First':'Third'} person · V / Y`;}
$('cameraBtn').textContent=`${first?'First':'Third'} person · V / Y`;
function release(){keys.clear();mouse.attack=mouse.block=false;touch.mx=touch.forward=0;touch.attack=touch.block=touch.interact=false;send({type:'input',input:{mx:0,mz:0,yaw,attack:false,block:false,interact:false,seq:seq++}});}
function openGuide(){release();document.exitPointerLock?.();guide.showModal();menuIndex=0;}
$('armoryBtn').onclick=()=>{openGuide();$('armoryPanel').scrollIntoView({block:'center'});};
$('manageCastle').onclick=()=>{openGuide();$('campMenu').scrollIntoView({block:'center'});};$('openRules').onclick=openGuide;$('guideBtn').onclick=openGuide;$('closeGuide').onclick=()=>guide.close();$('cameraBtn').onclick=cameraToggle;
$('name').setAttribute('value',localStorage.getItem('ss-name')||'');$<HTMLInputElement>('sensitivity').value=String(sensitivity);$<HTMLInputElement>('invert').checked=invert;
$('sensitivity').oninput=()=>{sensitivity=Number($<HTMLInputElement>('sensitivity').value);localStorage.setItem('ss-sensitivity',String(sensitivity));};$('invert').onchange=()=>{invert=$<HTMLInputElement>('invert').checked;localStorage.setItem('ss-invert',String(invert));};
const queryCode=new URLSearchParams(location.search).get('room');if(queryCode)$<HTMLInputElement>('code').value=queryCode.slice(0,6).toUpperCase();

const savedCharacter=localStorage.getItem('ss-character')??'templar';
let selectedCharacter=isPlayerCharacter(savedCharacter)?savedCharacter:'templar';
const characterSelectors:HTMLSelectElement[]=[];
for(const location of ['landing','armory']){
  const label=document.createElement('label');
  label.textContent='Your character';
  const select=document.createElement('select');
  select.id=location==='landing'?'characterChoice':'characterChoiceInGame';
  select.setAttribute('aria-label','Your character');
  for(const [value,name] of Object.entries(PLAYER_CHARACTERS)){
    const option=document.createElement('option');
    option.value=value;option.textContent=name;select.append(option);
  }
  select.value=selectedCharacter;
  label.append(select);
  if(location==='landing') $('create').before(label);
  else $('armoryPanel').prepend(label);
  characterSelectors.push(select);
  select.onchange=()=>{
    if(!isPlayerCharacter(select.value)) return;
    selectedCharacter=select.value;
    localStorage.setItem('ss-character',selectedCharacter);
    for(const other of characterSelectors) other.value=selectedCharacter;
    if(game) cmd('character:'+selectedCharacter);
  };
}
async function connect(mode:'create'|'join'|'resume'){
 if(!view.characterAssets.customLoaded){
   $('connection').textContent='Loading your generated characters...';
   $<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=true;
   await view.characterAssets.customReady;
   if(!view.characterAssets.customLoaded){
     $('connection').textContent='Character files failed to load. Refresh to retry; check the browser console for the filename.';
     return;
   }
 }

 if(ws&&ws.readyState<2)return;stopped=false;$('connection').textContent=mode==='resume'?'Reconnecting…':'Connecting to the kingdom…';$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=true;
 const protocol=location.protocol==='https:'?'wss:':'ws:';const routeCode=mode==='create'?Array.from(crypto.getRandomValues(new Uint8Array(3)),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase():mode==='resume'?code:$<HTMLInputElement>('code').value.trim().toUpperCase();ws=new WebSocket(`${protocol}//${location.host}${import.meta.env.BASE_URL}ws?room=${encodeURIComponent(routeCode)}`);
 ws.onopen=()=>{const name=$<HTMLInputElement>('name').value.trim()||'Knight';localStorage.setItem('ss-name',name);send({type:mode,name,code:mode==='resume'?code:$<HTMLInputElement>('code').value.trim().toUpperCase(),...(mode==='resume'?{token}:{})});};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
  if(m.type==='welcome'){cmd('character:'+selectedCharacter);id=m.id;code=m.code;token=m.token;everJoined=true;attempts=0;seq=0;sessionStorage.setItem('ss-session',JSON.stringify({code,token}));$('landing').hidden=true;$('hud').hidden=false;$('roomCode').textContent=code;toast('Campaign started. Clear the Fallen Keep, then hold E / A at its banner.');}
  else if(m.type==='state'){if(!document.hidden){for(const cue of combatCues(game,m.game,id)){combatAudio.play(cue);if(cue.kind==='hurt'){$('hud').classList.remove('hurt-flash');void $('hud').offsetWidth;$('hud').classList.add('hurt-flash');view.shake=Math.max(view.shake,.24);}}for(const event of eventCues(game,m.game))combatAudio.playEvent(event);}game=m.game;host=m.host;const p=me();if(p&&lastEvent===0)yaw=p.yaw;for(const ev of game!.events)if(ev.id>lastEvent){lastEvent=ev.id;toast(ev.text);tone(260);}if(game!.status!=='playing'&&!result.open){document.exitPointerLock?.();$('resultTitle').textContent=game!.status==='victory'?'The kingdom lives.':'The last fire fades.';$('resultCopy').textContent=game!.status==='victory'?'Nine castles reclaimed across three regions. Every survivor saved. The plague is ended.':'Every stronghold has fallen. Gather your fellowship and try again.';$('stats').textContent=`${game!.stats.captures} captures · ${game!.stats.rescues} rescues · ${game!.stats.sieges} sieges repelled · ${game!.stats.kills} undead defeated`;$('restart').hidden=host!==id;result.showModal();}else if(game!.status==='playing'&&result.open){result.close();lastEvent=0;cmd('character:'+selectedCharacter);}}
  else if(m.type==='error'){if(!everJoined){sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;stopped=true;ws?.close();$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}else{toast(m.text);if(/expired|not found/.test(m.text)){stopped=true;sessionStorage.removeItem('ss-session');$('connection').textContent=m.text;setTimeout(()=>location.reload(),2000);}}}
 };
 ws.onclose=e=>{release();if(stopped)return;if(e.code===4000||e.code===4001){stopped=true;sessionStorage.removeItem('ss-session');toast(e.reason);$('connection').textContent=e.reason;setTimeout(()=>location.reload(),2500);return;}if(everJoined&&attempts<8){toast('Connection lost. Reconnecting…');setTimeout(()=>connect('resume'),Math.min(8000,500*2**attempts++));}else{$('connection').textContent='Unable to connect. Try again shortly.';$<HTMLButtonElement>('create').disabled=$<HTMLButtonElement>('join').disabled=false;}};
 ws.onerror=()=>{$('connection').textContent='The server is unavailable or waking up. Please wait, then try again.';};
}
$('create').onclick=()=>connect('create');$('join').onclick=()=>connect('join');$('restart').onclick=()=>send({type:'restart'});$('leave').onclick=()=>{stopped=true;sessionStorage.removeItem('ss-session');ws?.close();location.href=location.pathname;};
$('invite').onclick=async()=>{const url=new URL(location.href);url.searchParams.set('room',code);try{await navigator.clipboard.writeText(url.href);toast('Invitation link copied. Send it to your fellowship.');}catch{toast(`Room code: ${code}. Friends can enter it on this site.`);}};
for(const id of WEAPON_IDS){const w=WEAPONS[id],b=document.createElement('button');b.id='equip-'+id;b.dataset.command='equip:'+id;b.innerHTML=`<strong>${w.name}</strong><span>${w.style}</span><span>${w.damage} damage · ${w.reach} m reach · ${w.stamina} stamina · ${w.cooldown}s recovery</span><small>Join a campaign to equip</small>`;b.disabled=true;$('weaponCards').append(b);}
document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b=>b.onclick=()=>cmd(b.dataset.command!));
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||guide.open||result.open)return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyR')cmd('nextWeapon');if(e.code==='KeyI')$('armoryBtn').click();if(e.code==='KeyV')cameraToggle();if(e.code==='KeyH')cmd('heal');if(e.code==='KeyQ')cmd('sweep');if(e.code==='Digit1')cmd('follow');if(e.code==='Digit2')cmd('hold');if(e.code==='Digit3')cmd('attack');if(e.code==='KeyG')openGuide();if(e.code==='KeyB'){$('manageCastle').click();}});window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
canvas.addEventListener('click',()=>{if(game&&!guide.open&&!result.open&&matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();});canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('mousedown',e=>{if(document.pointerLockElement===canvas){if(e.button===0){mouse.attack=true;}if(e.button===2)mouse.block=true;}});window.addEventListener('mouseup',e=>{if(e.button===0)mouse.attack=false;if(e.button===2)mouse.block=false;});document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas)release();});document.addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){yaw+=e.movementX*.0025*sensitivity;pitch=clamp(pitch-e.movementY*.0025*sensitivity*(invert?-1:1),-1.05,1.05);}});
const stick=$('stick');let stickId=-1;function stickMove(e:PointerEvent){const rect=stick.getBoundingClientRect();let x=(e.clientX-rect.left-rect.width/2)/35,z=(e.clientY-rect.top-rect.height/2)/35;const len=Math.max(1,Math.hypot(x,z));touch.mx=x/len;touch.forward=-z/len;(stick.firstElementChild as HTMLElement).style.transform=`translate(${touch.mx*25}px,${-touch.forward*25}px)`;}
stick.onpointerdown=e=>{stickId=e.pointerId;stick.setPointerCapture(stickId);stickMove(e);};stick.onpointermove=e=>{if(e.pointerId===stickId)stickMove(e);};const stopStick=()=>{stickId=-1;touch.mx=touch.forward=0;(stick.firstElementChild as HTMLElement).style.transform='';};stick.onpointerup=stopStick;stick.onpointercancel=stopStick;
let lookId=-1,lookX=0,lookY=0;const look=$('lookpad');look.onpointerdown=e=>{lookId=e.pointerId;lookX=e.clientX;lookY=e.clientY;look.setPointerCapture(lookId);};look.onpointermove=e=>{if(e.pointerId!==lookId)return;yaw+=(e.clientX-lookX)*.006*sensitivity;pitch=clamp(pitch-(e.clientY-lookY)*.006*sensitivity*(invert?-1:1),-1.05,1.05);lookX=e.clientX;lookY=e.clientY;};look.onpointerup=look.onpointercancel=()=>{lookId=-1;};
document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(b=>{const action=b.dataset.hold as 'attack'|'block'|'interact';b.onpointerdown=e=>{b.setPointerCapture(e.pointerId);touch[action]=true;};b.onpointerup=b.onpointercancel=()=>{touch[action]=false;};});
function menuGamepad(p:Gamepad){const d=readPad(p,padPrev);menuPrev=d.previous;const root=guide.open?guide:result.open?result:$('landing');const buttons=[...root.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.hidden&&!b.disabled&&b.offsetParent!==null);if(!buttons.length)return;const up=(p.buttons[12]?.pressed&&!padPrev[12]),down=(p.buttons[13]?.pressed&&!padPrev[13]);if(up)menuIndex=(menuIndex+buttons.length-1)%buttons.length;if(down)menuIndex=(menuIndex+1)%buttons.length;menuIndex%=buttons.length;if(up||down)buttons[menuIndex].focus();if(p.buttons[0]?.pressed&&!padPrev[0])buttons[menuIndex].click();if(d.menu&&guide.open)guide.close();}
function updateCompass(p:Actor){
 const track=$('compassTrack');if(!track||!game)return;
 track.replaceChildren();
 const addMark=(angle:number,label:string,className:string)=>{
  let diff=Math.atan2(Math.sin(angle-yaw),Math.cos(angle-yaw));
  if(Math.abs(diff)>Math.PI*.45)return;
  const pct=50+(diff/(Math.PI*.45))*50;
  const el=document.createElement('div');
  el.className='compass-marker '+className;
  el.textContent=label;
  el.style.left=`${pct}%`;
  track.append(el);
 };
 addMark(0,'N','compass-cardinal');
 addMark(Math.PI/2,'E','compass-cardinal');
 addMark(Math.PI,'S','compass-cardinal');
 addMark(-Math.PI/2,'W','compass-cardinal');
 for(const c of game.castles){
  const d=dist(p,c);
  if(d<120){
   const a=Math.atan2(c.x-p.x,-(c.z-p.z));
   addMark(a,c.friendly?'◆':'◇',`compass-castle ${c.friendly?'friendly':''}`);
  }
 }
 for(const c of game.camps){
  if(!c.rescued&&dist(p,c)<95){
   const a=Math.atan2(c.x-p.x,-(c.z-p.z));
   addMark(a,'⛺','compass-survivor');
  }
 }
 if(dist(p,game.nest)<180){
  const a=Math.atan2(game.nest.x-p.x,-(game.nest.z-p.z));
  addMark(a,'💀','compass-nest');
 }
}

function updateHud(p:Actor){
 const weapon=weaponStats(p.weapon);$('equippedWeapon').textContent=`${weapon.name} · ${p.cd>0?'Recovering '+p.cd.toFixed(1)+'s':(p.stamina??100)<weapon.stamina?'Low stamina':p.block?(weapon.shield?'Shield raised':'Parrying'):'Ready'} · R / LB`;
 for(const id of WEAPON_IDS){const b=$<HTMLButtonElement>('equip-'+id),w=WEAPONS[id],owned=game!.armory.includes(id);b.disabled=!owned||p.hp<=0||p.cd>0||p.weapon===id;b.classList.toggle('equipped',p.weapon===id);b.setAttribute('aria-pressed',String(p.weapon===id));b.querySelector('small')!.textContent=owned?(p.weapon===id?'EQUIPPED':'Equip'):'Find a blue weapon rack';}
 const nearestRack=game!.weaponDrops.filter(d=>!d.taken&&!game!.armory.includes(d.weapon)).sort((a,b)=>dist(a,p)-dist(b,p))[0];$('armoryHint').textContent=nearestRack?`Nearest new weapon: ${WEAPONS[nearestRack.weapon].name} · ${Math.round(dist(p,nearestRack))} m. Blue rings mark weapon racks. Recovering one unlocks it for everyone, including late joiners.`:`All ${WEAPON_IDS.length} weapons recovered. Everyone can equip their own choice.`;
$('playerName').textContent=p.name;$('hud').classList.toggle('low-health',p.hp>0&&p.hp/p.maxHp<=.3);updateCompass(p);
 $('health').style.width=`${p.hp/p.maxHp*100}%`;$('healthText').textContent=p.hp>0?`${Math.ceil(p.hp)} / ${p.maxHp} HEALTH`:`${p.downed?'CORRUPTION':'Returning'} in ${Math.max(0,Math.ceil(p.deadUntil-game!.time))}s`;$('device').textContent=padName?'XBOX / GAMEPAD CONNECTED':'WASD · MOUSE · V VIEW · G GUIDE';
 $('castleList').replaceChildren(...game!.castles.filter(c=>c.region===REGIONS.reduce((a,b)=>Math.abs(p.z-(a.offset-80))<Math.abs(p.z-(b.offset-80))?a:b).id).map(c=>{const row=document.createElement('div');row.className=c.friendly?'owned':'enemy';const a=document.createElement('span');a.textContent=(c.friendly?'◆ ':'◇ ')+c.name.replace('The ','');const b=document.createElement('span');b.textContent=c.friendly?['KEEP','BASTION','CITADEL'][c.level]:c.capture>0?`${Math.round(c.capture/5*100)}%`:'LOST';row.append(a,b);return row;}));$('rescueCount').textContent=`Survivors rescued  ${game!.camps.filter(c=>c.rescued).length} / ${game!.camps.length}`;$('nestStatus').textContent=game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)?`Plague nest exposed · ${game!.nest.hp} HP`:'Plague nest · protected';const r=game!.resources;$('resources').textContent=`WOOD ${r.wood}   IRON ${r.iron}\nHEAL ${r.medicine}   RECRUITS ${r.recruits}`;$('resources').style.whiteSpace='pre';
 $('regions').textContent=game!.regions.map(r=>`${r.held?'◆':'◇'} ${r.name} ${game!.castles.filter(c=>c.region===r.id&&c.friendly).length}/3${r.held?' · supply income':''}`).join(' | ');
 $('stamina').style.width=`${p.stamina??100}%`;$('staminaText').textContent=`${Math.ceil(p.stamina??100)} STAMINA · ${(p.armor??'light').toUpperCase()} ARMOR`;$('sweepBtn').textContent=(p.abilityCd??0)>0?`Sweep · ${Math.ceil(p.abilityCd!)}s`:'Q / B · Sweep';$<HTMLButtonElement>('sweepBtn').disabled=p.hp<=0||(p.stamina??100)<40||(p.abilityCd??0)>0;
 const siege=game!.siege;$('siege').hidden=!game!.everCaptured;if(!siege)$('siege').textContent=`RECOVERY · ${Math.max(0,Math.ceil(game!.nextSiege-game!.time))}s until next warning · loot, heal and fortify`;if(siege)$('siege').textContent=`${siege.active?'SIEGE UNDERWAY':'SIEGE IN '+Math.max(0,Math.ceil(siege.starts-game!.time))+'s'} · ${game!.castles.find(c=>c.id===siege.castle)?.name}`;
 const base=game!.castles.find(c=>c.friendly&&dist(p,c)<15);$('baseActions').hidden=!base;document.querySelectorAll<HTMLButtonElement>('[data-base]').forEach(b=>b.disabled=!base);let prompt='';if(base)prompt=`${base.name} · Gate ${Math.ceil(base.gate)}/${180+base.level*120} · Barricade ${base.barrier}/${120+base.level*60} · B / Guide to build`;
 const travelReady=!!base&&dist(p,base)<8;const travelSignature=game!.castles.filter(c=>c.friendly).map(c=>c.id).join(',')+travelReady+!!game!.siege;if($('travelMenu').dataset.signature!==travelSignature){$('travelMenu').dataset.signature=travelSignature;$('travelMenu').replaceChildren(...game!.castles.filter(c=>c.friendly).map(c=>{const b=document.createElement('button');b.textContent=`Travel: ${c.name}`;b.disabled=!travelReady||!!game!.siege;b.onclick=()=>{cmd('travel:'+c.id);guide.close();};return b;}));}
 $('castleDetails').textContent=base?`${base.name} · ${['Keep','Bastion','Citadel'][base.level]} · Gate ${Math.ceil(base.gate)}/${180+base.level*120}`:'Approach a friendly castle to unlock construction.';
 document.querySelectorAll<HTMLButtonElement>('[data-command="upgrade"]').forEach(b=>{b.textContent=base?.level===2?'Fully upgraded':`Build ${base?.level===1?'Citadel':'Bastion'} · ${24+(base?.level??0)*16}W ${10+(base?.level??0)*8}I`;b.disabled=!base||base.level===2;});
 const destinations=[...game!.weaponDrops.filter(d=>!d.taken&&!game!.armory.includes(d.weapon)).map(d=>({...d,name:WEAPONS[d.weapon].name,label:'WEAPON'})),...game!.camps.filter(c=>!c.rescued).map(c=>({...c,label:'SURVIVORS'})),...game!.castles.filter(c=>!c.friendly).map(c=>({...c,label:'RECLAIM'}))].sort((a,b)=>dist(p,a)-dist(p,b));
 const destination=destinations[0]??{...game!.nest,name:'Plague nest',label:'DESTROY'};const angle=Math.atan2(destination.x-p.x,-(destination.z-p.z))-yaw;const bearing=Math.atan2(Math.sin(angle),Math.cos(angle));
 $('wayfinder').textContent=`${Math.abs(bearing)<.35?'↑':bearing>0?'→':'←'} ${destination.label} · ${destination.name} · ${Math.round(dist(p,destination))}m`;
 const enemy=game!.castles.find(c=>!c.friendly&&dist(p,c)<4);if(enemy)prompt=game!.actors.some(a=>(a.kind==='zombie'||a.kind==='corrupted')&&a.hp>0&&(a.castle===enemy.id||dist(a,enemy)<10))?'Defeat the castle defenders before capturing.':`Hold E / A / Interact to reclaim · ${Math.floor(enemy.capture/5*100)}%`;
 if(game!.camps.some(c=>!c.rescued&&dist(p,c)<4))prompt='Clear nearby undead, then hold E / A / Interact to rescue.';if(game!.caches.some(c=>!c.taken&&dist(p,c)<3))prompt='E / A / Interact · Collect wood, iron and healing supplies.';const rack=game!.weaponDrops.find(d=>!d.taken&&dist(p,d)<3);if(rack)prompt=`E / A / Interact · Recover ${WEAPONS[rack.weapon].name} for the fellowship`;if(dist(p,game!.nest)<8)prompt=game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)?'Destroy the plague nest. Keep every castle under friendly control.':'The nest is protected. Hold all castles and rescue all groups.';const fallen=game!.actors.find(a=>a.downed&&dist(p,a)<3&&a.id!==p.id);if(fallen)prompt=`Hold E / A / Interact to revive ${fallen.name} · ${Math.floor((fallen.revive??0)/3*100)}% · ${Math.max(0,Math.ceil(fallen.deadUntil-game!.time))}s left`;if(p.hp<=0)prompt=p.downed?`CALL FOR HELP · Rescue ${Math.floor((p.revive??0)/3*100)}% · Corruption in ${Math.max(0,Math.ceil(p.deadUntil-game!.time))}s`:'Your corrupted knight remains. Your spirit is returning.';$('prompt').textContent=prompt;
 const map=$<HTMLCanvasElement>('minimap'),ctx=map.getContext('2d')!;ctx.clearRect(0,0,map.width,map.height);const pos=(v:{x:number;z:number})=>({x:(v.x-BOUNDS.minX)/(BOUNDS.maxX-BOUNDS.minX)*180,y:(v.z-BOUNDS.minZ)/(BOUNDS.maxZ-BOUNDS.minZ)*230});for(const r of REGIONS){const top=pos({x:0,z:r.offset-205}).y;ctx.fillStyle=r.id==='march'?'#34564055':r.id==='moor'?'#72544055':'#71899a55';ctx.fillRect(0,top,180,230*240/(BOUNDS.maxZ-BOUNDS.minZ));}ctx.strokeStyle='#a19d6e55';ctx.beginPath();for(const c of game!.castles){const v=pos(c);ctx.lineTo(v.x,v.y);}ctx.stroke();for(const c of game!.castles){const v=pos(c);ctx.fillStyle=c.friendly?'#90c4a5':'#cd8c70';ctx.fillRect(v.x-5,v.y-5,10,10);}for(const d of game!.weaponDrops){if(d.taken)continue;const v=pos(d);ctx.fillStyle='#9ddfee';ctx.fillRect(v.x-2,v.y-2,4,4);}for(const c of game!.camps){const v=pos(c);ctx.fillStyle=c.rescued?'#718c78':'#d9b86f';ctx.fillRect(v.x-2,v.y-2,4,4);}const nest=pos(game!.nest);ctx.fillStyle='#c573ad';ctx.fillRect(nest.x-4,nest.y-4,8,8);for(const a of game!.actors.filter(a=>a.kind==='player')){const v=pos(a);ctx.fillStyle=a.id===id?'#fff9d5':'#76bdcf';ctx.beginPath();ctx.arc(v.x,v.y,3,0,Math.PI*2);ctx.fill();if(a.id===id){ctx.strokeStyle='#fff9d5';ctx.beginPath();ctx.moveTo(v.x,v.y);ctx.lineTo(v.x+Math.sin(yaw)*7,v.y-Math.cos(yaw)*7);ctx.stroke();}}
 const boss=game!.actors.find(a=>(a.name?.includes('Champion')||a.name?.includes('Fallen')||a.id==='boss-plague'||a.maxHp>=200)&&a.hp>0&&dist(a,p)<45);
 const bossBar=$('bossBar');
 if(boss){
  bossBar.style.display='block';
  $('bossName').textContent=boss.name.toUpperCase();
  $('bossHealth').style.width=Math.max(0,Math.min(100,(boss.hp/boss.maxHp)*100))+'%';
 }else if(dist(p,game!.nest)<36&&game!.nest.hp>0&&game!.castles.every(c=>c.friendly)&&game!.camps.every(c=>c.rescued)){
  bossBar.style.display='block';
  $('bossName').textContent='PLAGUE NEST CRYSTAL';
  $('bossHealth').style.width=Math.max(0,Math.min(100,(game!.nest.hp/500)*100))+'%';
 }else{
  bossBar.style.display='none';
 }
}
function frame(now:number){const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;let pads:Gamepad[]=[];try{pads=Array.from(navigator.getGamepads?.()??[]).filter((p):p is Gamepad=>!!p&&p.connected&&p.mapping==='standard');}catch{}const pad=pads.find(p=>p.index===padIndex)||pads[0];if(pad){padIndex=pad.index;padName=pad.id;}else{padName='';padPrev=[];menuPrev=[];}
 let strafe=touch.mx+(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),forward=touch.forward+(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),attack=mouse.attack||touch.attack,block=mouse.block||touch.block,interact=keys.has('KeyE')||touch.interact;
 if(pad){const d=readPad(pad,padPrev);if(!game||guide.open||result.open)menuGamepad(pad);else if(!document.hidden){strafe+=d.mx;forward+=d.forward;yaw+=d.lookX*dt*2.6*sensitivity;pitch=clamp(pitch-d.lookY*dt*1.8*sensitivity*(invert?-1:1),-1.05,1.05);attack ||=d.attack;block ||=d.block;interact ||=d.interact;if(pad.buttons.some(b=>b.pressed))combatAudio.unlock();if(d.toggle)cameraToggle();if(d.heal)cmd('heal');if(d.sweep)cmd('sweep');if(d.menu)openGuide();for(const action of d.commands)cmd(action);}padPrev=d.previous;}
 const p=me();if(game&&p){if(now-lastSend>=50){const inactive=guide.open||result.open||document.hidden;send({type:'input',input:{mx:inactive?0:Math.cos(yaw)*strafe+Math.sin(yaw)*forward,mz:inactive?0:Math.sin(yaw)*strafe-Math.cos(yaw)*forward,yaw,attack:!inactive&&attack,block:!inactive&&block,interact:!inactive&&interact,seq:seq++}});lastSend=now;}if(now-lastHud>100){updateHud(p);lastHud=now;}}
 if(now>toastUntil)$('toast').textContent='';ambience.update(dt,game,p);view.draw(game,p,yaw,pitch,first,dt,now/1000);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
try{const s=JSON.parse(sessionStorage.getItem('ss-session')||'null');if(s?.code&&s?.token){code=s.code;token=s.token;connect('resume');}}catch{}
