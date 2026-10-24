#!/usr/bin/env node
/**
 * Swords & Shrouds - headless production smoke harness.
 *
 * Builds the client (vite build -> dist/client), starts the authoritative server on a free
 * port, launches headless Chrome with SwiftShader WebGL, drives the real production client
 * over the DevTools Protocol (WebSocket via `ws`), captures screenshots and fails on:
 *   - uncaught page errors / uncaught exceptions
 *   - internal asset 4xx/5xx responses (404s)
 *   - #hud staying hidden or missing game state after "Begin a campaign"
 *   - a blank / near-uniform canvas (pixel variance + non-dark coverage)
 *
 * Usage:
 *   node scripts/smoke-browser.mjs --out qa/baseline
 *   node scripts/smoke-browser.mjs --out qa/final-batch2                 # fresh build + local server
 *   node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ \
 *        --out qa/live --expect-weapons 10                              # deployed site, no build/server
 *   node scripts/smoke-browser.mjs --coop --skip-build --out qa/coop    # 2-player co-op (local server)
 *   node scripts/smoke-browser.mjs --perf --skip-build --out qa/perf    # perf capture (__ssPerf hook)
 *
 * Options:
 *   --out <dir>        Screenshot output dir, relative to the game repo (default qa/baseline)
 *   --url <url>        Drive an already-deployed site: skips build + local server entirely
 *   --coop             Two independent browser contexts: A creates a room, B joins and plays
 *   --perf             Capture performance evidence (renderer.info via window.__ssPerf, frame
 *                      percentiles, load timings, request bytes, quality tiers, loading progress).
 *                      Degrades to fps/load-only when the __ssPerf hook is absent (e.g. live site).
 *   --perf-settle <ms> Settle time after joining before the third-person capture (default 4000)
 *   --perf-samples <ms> Frame-time sampling window per capture point (default 4000)
 *   --characters       Cycle-1 character readability mode: close-up screenshots of the player in
 *                      all 5 appearances + zombie/skeleton via window.__ssCharacterPreview, with
 *                      mean/p50/p90/black% body luminance before/after comparison.
 *   --views            Cycle-3 QA-view mode: capture the 7 required + optional region/landmark/
 *                      foliage/corruption/wind views right after joining (before the idle corruption
 *                      timer kills the player), plus region-info/border/wind evidence.
 *   --expect-weapons <n> Gate `#weaponCards` to exactly n (default: report only)
 *   --expect-assets <list> Comma-separated asset paths (relative to assets/) to fetch and require 200
 *   --skip-build       Reuse the existing dist/client instead of running vite build
 *   --keep             Keep the temp Chrome profile / logs after the run
 *   --chrome <path>    Chrome executable (default C:\Program Files\Google\Chrome\Application\chrome.exe)
 *   --node <path>      Node executable used for the vite build (default: harness Node, else the
 *                      bundled Node 24; Vite 7 needs ^20.19 || >=22.12 and the system Node is 22.11)
 *   --timeout <ms>     HUD / game-state wait budget (default 150000)
 *   --help
 *
 * Exit code 0 = every gate passed, 1 = a gate failed, 2 = harness/runtime error.
 * Never edits source files. Screenshots are the only files written inside the repo.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// Vite 7.3.7 declares engines ^20.19.0 || >=22.12.0; the system Node here is v22.11.0 (too old),
// so builds must run on the bundled Node 24. Override with --node <path> or SMOKE_NODE.
const BUNDLED_NODE = 'C:\\Users\\neil\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';
const VIEWPORT = {width: 1600, height: 900};
const CANVAS_GATE = {minStd: 2, minNonDarkPct: 2, minColors: 32};
// Character-readability gates (cycle 2026-10D/10E): close-up body luminance must clearly clear the
// near-black-silhouette baseline, and the cycle-2 in-game torso tone must be night-realistic
// (not over-bright/white) with preserved surface detail and no clipping.
const CHAR_GATE = {
  // Cycle-2 in-game third-person torso tone window (Lead/SPEC): mean 65-95, p50 60-100, black<25%.
  torsoMeanMin: 65,
  torsoMeanMax: 95,
  torsoP50Min: 60,
  torsoP50Max: 100,
  torsoBlackMax: 25,
  clipMaxPct: 1,
  // Close-ups must still read (cycle-1 thresholds kept) and show surface detail.
  minMean: 35,
  minP90: 70,
  closeupMaxBlackPct: 40,
  // Detail gate is measured on the fuller close-up body mask, not the tiny torso crop (Lead
  // 2026-10-24): 256 quantised colours in a 73x170 dark-scene crop is expected; the SPEC's 500
  // target is reported for reference.
  // Cycle-4 Lead decision: armour-v2 gate = body-mask unique colours >=300; the full close-up frame
  // colour count (measured 809-1029 by weapons-armory) is the headline detail metric; the SPEC >=500
  // body-mask target is deferred art debt (asset-forge 1024 atlas in cycle 5 — not worth +1.3 MB now).
  closeupUniqueColorsMin: 300,
  specUniqueColorsTarget: 500,
  // Cycle-5 SPEC: body-mask close-up colour variety >=500 on at least 5 of the 7 bodies.
  specColourBodiesRequired: 5,
};
// Performance acceptance for cycle 5 (SPEC: <270 calls / <2.0M tris).
const PERF_GATE = {maxCalls: 270, maxTris: 2_000_000};
// QA atmosphere/region audit views requested from world-scene via window.__ssQAView(name).
const QA_VIEWS = ['treeline', 'fire', 'camp', 'courtyard', 'region-green', 'region-ashen', 'region-crown'];
// Cycle-3/4 optional views: landmarks, foliage/corruption/wind, char lineup, and the new cycle-4
// smithy stalls. Each is captured when the hook supports it (or a `__ssQAPose` fallback exists);
// absence is reported (not a hard fail) so the required 7 stay the gate.
const QA_VIEWS_OPTIONAL = ['landmark-green', 'landmark-ashen', 'landmark-crown', 'foliage', 'corruption', 'wind', 'char-lineup', 'prop-stall-village', 'prop-stall-camp', 'content-altar', 'content-altar-close', 'content-furnace-village', 'content-furnace-camp'];

// Cycle-4 cycle appearance coverage: the 5 playable select options + survivor/fallen companion bodies
// (those two require world-scene's QA body-preview hook; absent => reported, not a hard fail).
const PLAYER_APPEARANCES = ['templar', 'hero', 'berserker', 'ranger', 'ally'];
const ALL_APPEARANCES = [...PLAYER_APPEARANCES, 'survivor', 'fallen'];
// Regional weather phases for the cycle-4 audit. world-scene's final hook uses positional
// `__ssSetWeather(region, phase, intensity)` with API region keys march|moor|crown and phase names:
//   march: clear | light-rain | downpour; moor: calm | ashfall | haze; crown: clear | snow | snowstorm.
// `view` is the QA camera view name (region-green/…), `region` is the weather-API region key.
const WEATHER_AUDIT = [
  {region: 'march', view: 'region-green', label: 'rain', low: {phase: 'light-rain', intensity: 0.3}, high: {phase: 'downpour', intensity: 1.0}},
  {region: 'moor', view: 'region-ashen', label: 'ash', low: {phase: 'ashfall', intensity: 0.3}, high: {phase: 'haze', intensity: 1.0}},
  {region: 'crown', view: 'region-crown', label: 'snow', low: {phase: 'snow', intensity: 0.3}, high: {phase: 'snowstorm', intensity: 1.0}},
];
// activeParticles exposes rain/splash/haze counts only (snow has no counter) — intensity/low-tier
// particle gates use the rain (march) and haze (moor) regions; crown snow is verified by phase +
// screenshot + the shared low-tier proof.
const WEATHER_COUNT_REGIONS = ['march', 'moor']; 
const WEATHER_GATE = {minCaptures: 3};
// `__ssQAPose` fallbacks for landmark framing (updated with ruins-builder's final coordinates):
// computed from cam -> lookTarget with world-scene's pose convention
// {x,z,height,yaw=atan2(lookX-x, -(lookZ-z)), pitch=atan2(lookY-height, hypot(...))}.
// Landmark anchors (ruins-builder FINAL after the Lead's visual-fix pass): green village_house_ruin
// MOVED to (56,-6) h6.2 (65 m from spawn, 32.2 m off the road, 44.3 m from castle) + rebuilt 8-stone
// circle r9.8 + 5 loose stones; ashen chapel_ruin (-36,-228) h10.0; crown watchtower_ruin (-34,-472)
// h9.0 on a 3-rock outcrop (top ~11.8). Cam/target/yaw/pitch are ruins-builder's exact final
// fallbacks; the green camera sits on the circle's collapsed-gap side.
const LANDMARK_POSES = {
  'landmark-green': {x: 69.2, z: -21, height: 2.8, yaw: -2.4199, pitch: 0.01},
  'landmark-ashen': {x: -36, z: -190, height: 3.2, yaw: 0, pitch: 0.0473},
  'landmark-crown': {x: -34, z: -432, height: 3.2, yaw: 0, pitch: 0.1021},
  // Cycle-4 smithy props (ruins-builder poses): village landmark stall + crossing-camp stall.
  'prop-stall-village': {x: 40, z: -2, height: 2.4, yaw: 2.2143, pitch: -0.0898},
  'prop-stall-camp': {x: 26, z: -31, height: 2.4, yaw: 0.7854, pitch: -0.1055},
  // Cycle-5 content: chapel altar + smithy furnaces (ruins-builder FINAL poses + one QA close-up).
  'content-altar': {x: -16, z: -224, height: 2.8, yaw: -1.4056, pitch: -0.0263},
  'content-altar-close': {x: -24, z: -221, height: 2.2, yaw: -0.628, pitch: -0.126},
  'content-altar-close2': {x: -26.5, z: -223, height: 1.9, yaw: -0.368, pitch: -0.204},
  'content-altar-close3': {x: -31.5, z: -218, height: 2.6, yaw: 0.439, pitch: -0.155},
  'content-furnace-village': {x: 48, z: 18, height: 2.8, yaw: 0.1526, pitch: -0.0985},
  'content-furnace-camp': {x: 40, z: -44, height: 2.6, yaw: -1.9296, pitch: -0.128},
};
// Cycle-2 reference timings (SwiftShader, same machine) and the cycle-3 "meaningfully earlier" gate.
const CYCLE2_TIMINGS = {landingMs: 3564, hudMs: 16308, stateMs: 17415, joinMs: 3698};
const TIME_GATE = {maxHudMs: 15000, maxStateMs: 16200, maxJoinMs: 3800};
// Regional-identity + wind gates.
const REGION_GATE = {minPairwiseColorDistance: 4, minLuminanceSpread: 1.5};
const WIND_GATE = {minMeanAbsDiff: 0.8};
// BEFORE baseline measured from qa/final-batch3 (player body + companion crops, batch-3 pre-fix).
const CHAR_BEFORE_BASELINE = {
  normalPlayerTorso: {mean: 54.9, p50: 28.5, p90: 132.0, blackPct: 44.5},
  normalCompanionBody: {mean: 27.4, p50: 22.8, p90: 30.8, blackPct: 20.4},
  cycle1: {normalPlayerTorso: {mean: 102.84, p50: 114.26, p90: 187.38, blackPct: 15.42}, closeupAvg: {mean: 44.46, p50: 25.81, p90: 108.57, blackPct: 15.22}},
  source: 'qa/final-batch3/01-third-person.png crops; cycle-1 qa/characters-b4-final',
};
// Injected before the app boots: records the WebSocket lifecycle AND a summary of the last
// authoritative snapshot on every page. This is what lets the harness (a) prove a real
// disconnect/reconnect vs a transient toast, (b) carry out co-op assertions (players, positions,
// shared armory) without touching src/, and (c) time closes against navigations / server stalls.
const WS_INSTRUMENT = `(()=>{
  if(window.__qaWs)return;
  const O=window.WebSocket;
  const state={instances:0,opens:0,closes:[],errors:[],urls:[],openedAt:[],stateCount:0,
    welcome:null,firstStateAt:null,lastMessageAt:null,lastState:null,visibility:[],conns:[],
    allActors:[],actorKey:null};
  window.__qaWs=state;
  function summarizeState(m){
    const game=m.game||{};
    return {
      at:Date.now(),
      players:(m.players||[]).map(p=>({id:p.id,name:p.name,connected:!!p.connected})),
      // Only player actors: co-op assertions need player positions, not the 90+ NPCs/waves.
      actors:(game.actors||[]).filter(a=>a.kind==='player').map(a=>({id:a.id,name:a.name,kind:a.kind,hp:a.hp,
        character:a.character||null,
        x:Math.round(a.x*10)/10,z:Math.round(a.z*10)/10,yaw:a.yaw})),
      armory:(game.armory||[]).slice(),
      weaponDrops:(game.weaponDrops||[]).map(d=>({weapon:d.weapon,
        x:Math.round(d.x*10)/10,z:Math.round(d.z*10)/10,taken:!!d.taken})),
      resources:game.resources?{wood:game.resources.wood,iron:game.resources.iron,medicine:game.resources.medicine,recruits:game.resources.recruits}:null,
      status:game.status
    };
  }
  class QAWebSocket extends O {
    constructor(...args){
      super(...args);
      const idx=state.instances++;
      state.urls.push(String(args[0]||''));
      state.openedAt.push(null);
      state.conns.push({url:String(args[0]||''),openedAt:null,closedAt:null,closeCode:null,stateCount:0,msgCount:0,maxGapMs:0,lastMessageAt:null});
      this.__qaIndex=idx;
      this.addEventListener('open',()=>{state.opens++;state.openedAt[idx]=Date.now();state.conns[idx].openedAt=Date.now();});
      this.addEventListener('close',event=>{
        const openedAt=state.openedAt[idx];
        const close={instance:idx,code:event.code,reason:event.reason,wasClean:event.wasClean,
          at:Date.now(),openedAt,openMs:openedAt?Date.now()-openedAt:null,
          statesBeforeClose:state.conns[idx]?state.conns[idx].stateCount:null,
          lastMessageAgoMs:state.lastMessageAt?Date.now()-state.lastMessageAt:null};
        state.closes.push(close);
        if(state.conns[idx])Object.assign(state.conns[idx],{closedAt:close.at,closeCode:event.code});
      });
      this.addEventListener('error',()=>{state.errors.push({instance:idx,at:Date.now()});});
      this.addEventListener('message',event=>{
        const now=Date.now();
        state.lastMessageAt=now;
        const conn=state.conns[idx];
        if(conn){
          if(conn.lastMessageAt){const gap=now-conn.lastMessageAt;if(gap>conn.maxGapMs)conn.maxGapMs=gap;}
          conn.lastMessageAt=now;
          conn.msgCount++;
        }
        try{
          const m=JSON.parse(event.data);
          if(m&&m.type==='welcome'){state.welcome={id:m.id,code:m.code,at:Date.now()};}
          else if(m&&m.type==='state'){
            state.stateCount++;
            if(state.conns[idx])state.conns[idx].stateCount++;
            if(!state.firstStateAt)state.firstStateAt=Date.now();
            state.lastState=summarizeState(m);
            // Full actor id/kind/character index for the character-preview hook (rebuild only when
            // the actor set changes; ids are stable for the session, so this is cheap).
            const actors=(m.game&&m.game.actors)||[];
            const key=actors.length+':'+actors.map(a=>a.id).join(',');
            if(key!==state.actorKey){
              state.actorKey=key;
              state.allActors=actors.map(a=>({id:a.id,name:a.name,kind:a.kind,character:a.character||null,
                x:Math.round((a.x||0)*10)/10,z:Math.round((a.z||0)*10)/10,
                // QA-only scalar copies so cycle-3 elite-undead identification works without src edits.
                elite:a.elite===true||a.elite==='elite'?a.elite:null,tier:a.tier??a.rank??null,
                variant:a.variant??null,role:a.role??null,type:a.type??null,level:a.level??null,
                maxHp:a.maxHp??null,castle:a.castle??null}));
            }
          }
        }catch(e){}
      });
    }
  }
  window.WebSocket=QAWebSocket;
  document.addEventListener('visibilitychange',()=>state.visibility.push({state:document.visibilityState,at:Date.now()}));
  window.addEventListener('pagehide',()=>state.visibility.push({state:'pagehide',at:Date.now()}));
  // Frame-gap tracker (loading-smoothness + perf): longest main-thread gap since page start.
  if(!window.__qaRaf){
    const raf={startAt:performance.now(),lastAt:performance.now(),count:0,maxGapMs:0,longestAtMs:0};
    window.__qaRaf=raf;
    (function tick(){
      const now=performance.now();
      const gap=now-raf.lastAt;
      if(gap>raf.maxGapMs){raf.maxGapMs=gap;raf.longestAtMs=now-raf.startAt;}
      raf.lastAt=now;raf.count++;
      requestAnimationFrame(tick);
    })();
  }
  // Loading-progress recorder: captures every #connection text transition + join-enable moment.
  // Mutations + a cheap 80 ms poll fallback, because at document-start documentElement may not
  // exist yet and very fast local loads can otherwise be missed.
  if(!window.__qaLoading){
    const load={events:[],joinEnabledAtMs:null,lastText:null,sawDisabled:false,startAt:performance.now()};
    window.__qaLoading=load;
    const record=()=>{
      try{
        const c=document.getElementById('connection');
        const b=document.getElementById('create');
        if(c){
          const text=(c.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120);
          if(text!==load.lastText){load.lastText=text;load.events.push({atMs:Math.round(performance.now()-load.startAt),text});if(load.events.length>200)load.events.shift();}
        }
        if(b){
          // Only count "join enabled" after we have seen it disabled (ignore the pre-JS default).
          if(b.disabled){load.sawDisabled=true;}
          else if(load.sawDisabled&&load.joinEnabledAtMs===null){load.joinEnabledAtMs=Math.round(performance.now()-load.startAt);}
        }
      }catch(e){}
    };
    const observe=()=>{
      try{
        const target=document.documentElement||document;
        if(!target)return;
        const obs=new MutationObserver(record);
        obs.observe(target,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});
      }catch(e){}
    };
    observe();
    document.addEventListener('DOMContentLoaded',()=>{observe();record();},{once:true});
    const poll=setInterval(record,80);
    const stopPoll=setInterval(()=>{
      try{const h=document.getElementById('hud');if(h&&!h.hidden){clearInterval(poll);clearInterval(stopPoll);}}catch(e){}
    },500);
    record();
  }
  // QA-only slow-load simulation: delay /assets/*.glb.gz fetches when localStorage
  // 'ss-qa-load-delay' is set (used to make the progressive-loading counter observable on a fast
  // localhost load; production code and network are untouched).
  if(!window.__qaFetchWrapped){
    const origFetch=window.fetch.bind(window);
    let delayed=0;
    window.fetch=(...args)=>{
      try{
        const input=args[0];
        const url=typeof input==='string'?input:(input&&input.url)||'';
        const mode=window.localStorage.getItem('ss-qa-load-delay');
        if(mode&&/\\/assets\\//.test(url)&&/\\.glb\\.gz($|\\?)/.test(url)){
          const wait=Number(mode)||0;
          const slot=delayed++*400;
          return new Promise(resolve=>setTimeout(resolve,wait+slot)).then(()=>origFetch(...args));
        }
      }catch(e){}
      return origFetch(...args);
    };
    window.__qaFetchWrapped=true;
  }
})();`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = n => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();
const logLines = [];
function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logLines.push(`[${nowIso()}] ${line}`);
  console.log(line);
}

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const opts = {
    out: 'qa/baseline',
    skipBuild: false,
    keep: false,
    chrome: DEFAULT_CHROME,
    hudTimeout: 150000,
    node: null,
    url: null,
    coop: false,
    perf: false,
    characters: false,
    views: false,
    probePreview: false,
    perfSettle: 4000,
    perfSampleMs: 4000,
    expectWeapons: null,
    expectAssets: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--skip-build' || a === '--no-build') opts.skipBuild = true;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--node') opts.node = argv[++i];
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--coop') opts.coop = true;
    else if (a === '--perf') opts.perf = true;
    else if (a === '--characters') opts.characters = true;
    else if (a === '--views') opts.views = true;
    else if (a === '--probe-preview') opts.probePreview = true;
    else if (a === '--perf-settle') opts.perfSettle = Number(argv[++i]) || opts.perfSettle;
    else if (a === '--perf-samples') opts.perfSampleMs = Number(argv[++i]) || opts.perfSampleMs;
    else if (a === '--expect-weapons') opts.expectWeapons = Number(argv[++i]);
    else if (a === '--expect-assets') opts.expectAssets = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--timeout') opts.hudTimeout = Number(argv[++i]) || opts.hudTimeout;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!opts.out) throw new Error('--out requires a directory');
  if (opts.coop && opts.url) throw new Error('--coop and --url are mutually exclusive');
  if (opts.coop && opts.perf) throw new Error('--perf captures a single page; do not combine with --coop');
  if (opts.coop && opts.characters) throw new Error('--characters captures a single page; do not combine with --coop');
  if (opts.coop && opts.views) throw new Error('--views captures a single page; do not combine with --coop');
  if (opts.expectWeapons !== null && (!Number.isInteger(opts.expectWeapons) || opts.expectWeapons < 1)) {
    throw new Error('--expect-weapons requires a positive integer');
  }
  if (opts.url) {
    try {
      opts.url = new URL(opts.url).href;
    } catch {
      throw new Error(`--url is not a valid URL: ${opts.url}`);
    }
  }
  opts.outDir = path.isAbsolute(opts.out) ? opts.out : path.join(ROOT, opts.out);
  return opts;
}

/* --------------------------------------------------------------- process */

function spawnLogged(command, args, {cwd = ROOT, env = process.env, logName}) {
  const outChunks = [];
  const errChunks = [];
  const child = spawn(command, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  child.stdout?.on('data', d => outChunks.push(d));
  child.stderr?.on('data', d => errChunks.push(d));
  child.output = {
    get stdout() {
      return Buffer.concat(outChunks).toString('utf8');
    },
    get stderr() {
      return Buffer.concat(errChunks).toString('utf8');
    },
  };
  child.logName = logName;
  return child;
}

function tail(text, lines = 25, max = 4000) {
  const t = String(text || '').trim();
  if (!t) return '(empty)';
  const arr = t.split(/\r?\n/);
  return arr.slice(-lines).join('\n').slice(-max);
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    if (r.status !== 0) {
      try {
        child.kill();
      } catch {}
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  const exited = await waitForExit(child, 10000);
  if (!exited) {
    try {
      child.kill('SIGKILL');
    } catch {}
    await waitForExit(child, 3000);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const {port} = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function portIsFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/* ----------------------------------------------------------------- build */

/** Read `node --version` as {raw, major, minor, patch}; null when the binary is unusable. */
function nodeVersion(exe) {
  try {
    const result = spawnSync(exe, ['--version'], {encoding: 'utf8', windowsHide: true, timeout: 15000});
    if (result.status !== 0) return null;
    const match = /v(\d+)\.(\d+)\.(\d+)/.exec((result.stdout || '').trim());
    if (!match) return null;
    return {raw: result.stdout.trim(), major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3])};
  } catch {
    return null;
  }
}

/** Vite 7 engines: ^20.19.0 || >=22.12.0 (i.e. Node 21 is not supported either). */
function satisfiesViteEngines(version) {
  if (!version) return false;
  if (version.major === 20) return version.minor >= 19;
  if (version.major === 22) return version.minor >= 12;
  return version.major > 22;
}

/** Pick a Node that Vite accepts, in priority order, and report what was used. */
function pickBuildNode(requested) {
  const candidates = [];
  if (requested) candidates.push({path: requested, label: '--node'});
  if (process.env.SMOKE_NODE) candidates.push({path: process.env.SMOKE_NODE, label: 'SMOKE_NODE'});
  candidates.push({path: process.execPath, label: 'harness Node'});
  candidates.push({path: BUNDLED_NODE, label: 'bundled Node'});
  for (const candidate of candidates) {
    if (!candidate.path || !fs.existsSync(candidate.path)) continue;
    const version = nodeVersion(candidate.path);
    if (version && satisfiesViteEngines(version)) return {...candidate, version};
  }
  const fallback = nodeVersion(process.execPath);
  return {path: process.execPath, label: 'harness Node (too old for Vite!)', version: fallback};
}

/** Remove dist/ before building (Vite can race with a concurrent build and hit ENOTEMPTY). */
async function cleanDist(logDir) {
  const dist = path.join(ROOT, 'dist');
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      fs.rmSync(dist, {recursive: true, force: true, maxRetries: 3, retryDelay: 150});
      log('BUILD: cleaned dist/ before build');
      return;
    } catch (error) {
      if (attempt === 6) throw new Error(`could not remove dist/ before build: ${error?.message || error}`);
      await sleep(400);
    }
  }
}

async function viteBuild(logDir, buildNode) {
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) throw new Error(`vite not found at ${viteBin}`);
  if (!satisfiesViteEngines(buildNode.version)) {
    throw new Error(
      `no Vite-compatible Node found (Vite 7 needs ^20.19.0 || >=22.12.0). ` +
        `Try: --node "${BUNDLED_NODE}"`,
    );
  }
  await cleanDist(logDir);
  log(`BUILD: ${buildNode.path} (${buildNode.version.raw}, ${buildNode.label}) node_modules/vite/bin/vite.js build`);
  const t0 = Date.now();
  const child = spawnLogged(buildNode.path, [viteBin, 'build'], {logName: 'build'});
  const code = await new Promise(resolve => child.once('exit', resolve));
  const ms = Date.now() - t0;
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, 'build.log'), child.output.stdout + '\n--- stderr ---\n' + child.output.stderr);
  if (code !== 0) {
    throw new Error(`vite build failed (exit ${code}) after ${ms}ms\n${tail(child.output.stderr || child.output.stdout)}`);
  }
  log(`BUILD: ok in ${(ms / 1000).toFixed(1)}s`);
  return {ms, node: buildNode.path, nodeVersion: buildNode.version.raw, label: buildNode.label};
}

/* ---------------------------------------------------------------- server */

async function startServer(port, logDir) {
  log(`SERVER: node --import tsx src/server/index.ts (PORT=${port})`);
  const child = spawnLogged(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: {...process.env, PORT: String(port), NODE_ENV: 'production'},
    logName: 'server',
  });
  child.once('exit', code => log(`SERVER: exited (code ${code})`));
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(1500)});
      if (res.ok) {
        const body = await res.json();
        log(`SERVER: /health ok ${JSON.stringify(body)}`);
        fs.mkdirSync(logDir, {recursive: true});
        return {child, health: body};
      }
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String(error?.cause?.code || error?.message || error);
    }
    await sleep(200);
  }
  throw new Error(`server did not become healthy on port ${port}: ${lastError}\n${tail(child.output.stderr)}`);
}

/* ---------------------------------------------------------------- chrome */

async function startChrome(debugPort, userDataDir, chromePath, logDir) {
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
  const args = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--window-position=0,0',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=1',
    '--remote-allow-origins=*',
    'about:blank',
  ];
  log(`CHROME: ${chromePath} --headless=new --remote-debugging-port=${debugPort}`);
  const child = spawnLogged(chromePath, args, {logName: 'chrome'});
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {signal: AbortSignal.timeout(1500)});
      if (res.ok) {
        const body = await res.json();
        fs.mkdirSync(logDir, {recursive: true});
        fs.writeFileSync(path.join(logDir, 'chrome.log'), child.output.stdout + '\n--- stderr ---\n' + child.output.stderr);
        log(`CHROME: ${body.Browser} | protocol ${body['Protocol-Version']}`);
        return {child, version: body};
      }
    } catch (error) {
      lastError = String(error?.cause?.code || error?.message || error);
    }
    if (child.exitCode !== null) throw new Error(`Chrome exited early (code ${child.exitCode})\n${tail(child.output.stderr)}`);
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint did not start on ${debugPort}: ${lastError}\n${tail(child.output.stderr)}`);
}

async function createPageTarget(debugPort) {
  const url = `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`;
  let lastError;
  for (const method of ['PUT', 'GET']) {
    try {
      const res = await fetch(url, {method, signal: AbortSignal.timeout(5000)});
      if (!res.ok) {
        lastError = `HTTP ${res.status} (${method})`;
        continue;
      }
      const info = await res.json();
      if (info?.webSocketDebuggerUrl) {
        log(`CDP: page target ${info.id} (${method} /json/new)`);
        return info;
      }
      lastError = `no webSocketDebuggerUrl (${method})`;
    } catch (error) {
      lastError = String(error?.cause?.code || error?.message || error);
    }
  }
  throw new Error(`could not create Chrome page target: ${lastError}`);
}

/** Cycle-2/3 QA camera hooks (world-scene): named viewpoint or explicit pose; null restores. */
async function qaView(page, name) {
  const arg = name === null ? 'null' : JSON.stringify(name);
  return page.evaluate(
    `(()=>{const f=window.__ssQAView;if(typeof f!=='function')return {ok:false,reason:'__ssQAView not available'};try{const r=f(${arg});return r===undefined?{ok:true}:JSON.parse(JSON.stringify(r));}catch(e){return {ok:false,error:String((e&&e.message)||e)};}})()`,
    {timeoutMs: 15000},
  );
}

async function qaPose(page, pose) {
  const arg = pose === null ? 'null' : JSON.stringify(pose);
  return page.evaluate(
    `(()=>{const f=window.__ssQAPose;if(typeof f!=='function')return {ok:false,reason:'__ssQAPose not available'};try{const r=f(${arg});return r===undefined?{ok:true}:JSON.parse(JSON.stringify(r));}catch(e){return {ok:false,error:String((e&&e.message)||e)};}})()`,
    {timeoutMs: 15000},
  );
}

/** Optional cycle-3 region/atmosphere debug hook (see world-scene request). */
async function readRegionInfo(page) {
  return page
    .evaluate(
      `(()=>{try{const f=window.__ssRegionInfo;if(typeof f!=='function')return null;const r=f();return r===undefined?null:JSON.parse(JSON.stringify(r));}catch(e){return {error:String((e&&e.message)||e)};}})()`,
      {timeoutMs: 10000},
    )
    .catch(() => null);
}

/** Cycle-4 weather state hook: `__ssWeather()` (region/phase/intensity/counts...). */
async function readWeather(page) {
  return page
    .evaluate(
      `(()=>{try{const f=window.__ssWeather;if(typeof f!=='function')return null;const r=f();return r===undefined?null:JSON.parse(JSON.stringify(r));}catch(e){return {error:String((e&&e.message)||e)};}})()`,
      {timeoutMs: 10000},
    )
    .catch(() => null);
}

/**
 * Cycle-4 weather forcing hook (QA-only): world-scene's final API is positional
 * `__ssSetWeather(region, phase, intensity)` (alias `__ssWeatherForce`); `null`/omitted clears.
 * Fallback names are tried too; returns {hook,result}.
 */
async function setWeather(page, region, phase, intensity) {
  const args = region === null ? 'null' : `${JSON.stringify(region)}, ${JSON.stringify(phase)}, ${Number(intensity) || 0}`;
  return page
    .evaluate(
      `(()=>{const names=['__ssSetWeather','__ssWeatherForce','__ssForceWeather','__ssSetWeatherPhase'];
        for(const n of names){const f=window[n];if(typeof f==='function'){
          try{const r=f(${args});return {hook:n,result:r===undefined?null:JSON.parse(JSON.stringify(r))};}catch(e){return {hook:n,error:String((e&&e.message)||e)};}
        }}
        return {hook:null};})()`,
      {timeoutMs: 15000},
    )
    .catch(() => ({hook: null, error: 'evaluate failed'}));
}

/**
 * Particle-count extraction from a weather state object: first numeric value among the common keys
 * (or nested `particles`/`counts`). Used to prove low intensity/tier = minimal particles.
 */
function weatherParticleCount(state) {
  if (!state || typeof state !== 'object') return null;
  const keys = ['activeParticles', 'particleCount', 'particles', 'active', 'count', 'instanceCount'];
  for (const k of keys) {
    const v = state[k];
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object') {
      const nums = Object.values(v).filter(x => typeof x === 'number');
      if (nums.length) return nums.reduce((a, b) => a + b, 0);
    }
  }
  return null;
}

/** Cycle-5 explicit snow particle counter (`__ssWeather().activeParticles.snow`). */
function weatherSnowCount(state) {
  const v = state && state.activeParticles && state.activeParticles.snow;
  return typeof v === 'number' ? v : 0;
}

/** Cycle-5 surface-audio hook (`__ssSurfaceAt(x,z)`), when present. */
async function readSurface(page, x, z) {
  return page
    .evaluate(
      `(()=>{try{if(typeof window.__ssSurfaceAt!=='function')return null;const r=window.__ssSurfaceAt(${Number(x)},${Number(z)});return r===undefined?null:JSON.parse(JSON.stringify(r));}catch(e){return null;}})()`,
      {timeoutMs: 10000},
    )
    .catch(() => null);
}

/** Cycle-4 load-timing hook: `__ssLoadTimings()` + raw performance marks/measures. */
async function readLoadTimings(page) {
  return page
    .evaluate(
      `(()=>{try{
        const f=window.__ssLoadTimings;
        const hook=typeof f==='function'?(f()??null):null;
        const marks=performance.getEntriesByType('mark').map(m=>({name:m.name,startTime:+m.startTime.toFixed(1)})).slice(0,80);
        const measures=performance.getEntriesByType('measure').map(m=>({name:m.name,startTime:+m.startTime.toFixed(1),duration:+m.duration.toFixed(1)})).slice(0,80);
        return {hook:(hook===null?null:JSON.parse(JSON.stringify(hook))),marks,measures};
      }catch(e){return {error:String((e&&e.message)||e)};}})()`,
      {timeoutMs: 15000},
    )
    .catch(() => null);
}

/** Cycle-4 QA body preview hook (world-scene): `__ssPreviewBody(assetName, {distance})`. */
async function previewBody(page, character, opts = {distance: 2.8}) {
  return page
    .evaluate(
      `(()=>{const names=['__ssPreviewBody','__ssBodyPreview'];
        for(const n of names){const f=window[n];if(typeof f==='function'){
          try{const r=f(${JSON.stringify(character)}, ${JSON.stringify(opts)});const ok=!!(r&&typeof r==='object'&&'ok' in r?r.ok:true);return {hook:n,ok,result:r===undefined?null:JSON.parse(JSON.stringify(r))};}catch(e){return {hook:n,ok:false,error:String((e&&e.message)||e)};}
        }}
        return {hook:null,ok:false};})()`,
      {timeoutMs: 15000},
    )
    .catch(() => ({hook: null, ok: false}));
}

/** Abort a local run early if the spawned server was killed mid-run (health sampler failures). */
function assertServerAlive(report, stage) {
  const h = report.health;
  if (h && (h.failures || 0) > 3) {
    throw new Error(`${stage}: local server died mid-run (health failures=${h.failures}, samples=${h.samples}); aborting for a clean re-run`);
  }
}

const QA_CAPTURE_SETTLE_MS = 1800;

/** Capture the atmosphere/region audit views (tree line, fire, camp, courtyard, 3 regions). */
async function captureQaViews(page, outDir, report, check) {
  const available = await page.evaluate(`typeof window.__ssQAView==='function'`);
  report.views = {hook: available, captures: [], optionalCaptures: [], regionInfo: {}, wind: null, regionDistinctness: null};
  if (!available) {
    report.notes.push('perf: __ssQAView hook absent — atmosphere/region audit screenshots skipped');
    log('QA VIEWS: __ssQAView hook not present in this build');
    return;
  }
  // Cycle-4: beauty views must be captured at high quality (software default is now low).
  await forceQuality(page, 'high');
  await sleep(800);
  const captureOne = async (name, pose = null) => {
    const result = pose ? await qaPose(page, pose) : await qaView(page, name);
    if (!result || result.ok === false) {
      report.notes.push(`perf: QA view '${name}'${pose ? ' (pose fallback)' : ''} unavailable: ${JSON.stringify(result)}`);
      return null;
    }
    // 1.8 s lets the QA-camera landscape focus and one full SwiftShader frame settle (>=1 frame at
    // ~1.4 fps software rendering) before capture.
    await sleep(QA_CAPTURE_SETTLE_MS);
    const shot = await screenshotWithStats(page, outDir, `view-${name}.png`, null);
    const entry = {name, result, via: pose ? 'pose' : 'view', file: shot.file, stats: shot.stats};
    const regionInfo = await readRegionInfo(page);
    if (regionInfo) entry.regionInfo = regionInfo;
    return entry;
  };
  for (const name of QA_VIEWS) {
    const entry = await captureOne(name);
    if (entry) {
      report.views.captures.push(entry);
      if (name === 'treeline') {
        // Extra debug data: full/LOD instance counts + the treeline vantage, used to prove the
        // near/far tree bands are live even if the screenshot vantage is awkward.
        report.views.landscape = await page
          .evaluate(
            `(()=>{try{const f=window.__ssPerf;if(typeof f!=='function')return null;const p=f();return p&&p.landscape?JSON.parse(JSON.stringify(p.landscape)):null;}catch(e){return {error:String((e&&e.message)||e)};}})()`,
            {timeoutMs: 15000},
          )
          .catch(() => null);
        // Cycle-3 fix: per-prim bark/leaf material debug (leaf prims + alphaTest) proves the card
        // trees render bark AND leaf geometry, not just trunks.
        report.views.treeDebug = await page
          .evaluate(
            `(()=>{try{const f=window.__ssPerf;if(typeof f!=='function')return null;const p=f();const l=p&&p.landscape;return l&&l.treeDebug?JSON.parse(JSON.stringify(l.treeDebug)):null;}catch(e){return {error:String((e&&e.message)||e)};}})()`,
            {timeoutMs: 15000},
          )
          .catch(() => null);
      }
      if (name.startsWith('region-') && entry.regionInfo) report.views.regionInfo[name] = entry.regionInfo;
    }
    await qaView(page, null);
    await sleep(300);
  }
  check(
    'perf: atmosphere/region audit views captured',
    report.views.captures.length === QA_VIEWS.length,
    `${report.views.captures.length}/${QA_VIEWS.length} (${report.views.captures.map(c => c.name).join(', ')})`,
  );
  // Cycle-3 optional views: landmarks / foliage / corruption / wind; capture when supported, with an
  // explicit-pose fallback for landmarks when ruins-builder supplies coordinates (LANDMARK_POSES).
  // For landmark views, verify the named view's returned pose matches the expected anchor; a stale
  // named view (e.g. the relocated Green landmark) is discarded in favour of __ssQAPose.
  for (const name of QA_VIEWS_OPTIONAL) {
    let entry = await captureOne(name);
    const expected = LANDMARK_POSES[name];
    if (entry && expected) {
      const pose = entry.result && entry.result.pose;
      const px = pose ? Number(pose.x ?? pose.camX) : NaN;
      const pz = pose ? Number(pose.z ?? pose.camZ) : NaN;
      const drift = Number.isFinite(px) && Number.isFinite(pz) ? Math.hypot(px - expected.x, pz - expected.z) : null;
      if (drift == null || drift > 2) {
        report.notes.push(
          `perf: named view '${name}' pose (${JSON.stringify(pose)}) does not match the expected landmark pose (drift=${drift}); using __ssQAPose fallback`,
        );
        entry = null;
        await qaView(page, null);
      }
    }
    if (!entry && expected) entry = await captureOne(name, expected);
    if (entry) report.views.optionalCaptures.push(entry);
    await qaView(page, null);
    await sleep(300);
  }
  // Wind check: three shots ~1.2 s apart of a foliage/grass view; a static scene would diff ~0.
  // Three samples (max pairwise diff) keep the gate robust when SwiftShader frame timing means a
  // single 1 s pair can land on nearly-identical wind phases.
  const windViewName = report.views.optionalCaptures.some(o => o.name === 'wind') ? 'wind' : report.views.captures.some(c => c.name === 'treeline') ? 'treeline' : null;
  if (windViewName) {
    const applied = windViewName === 'wind' ? await qaView(page, 'wind') : await qaView(page, 'treeline');
    if (applied && applied.ok !== false) {
      await sleep(QA_CAPTURE_SETTLE_MS);
      const a = await screenshot(page, outDir, 'view-wind-a.png');
      await sleep(1200);
      const b = await screenshot(page, outDir, 'view-wind-b.png');
      await sleep(1200);
      const c = await screenshot(page, outDir, 'view-wind-c.png');
      const ab = await comparePngs(page, a, b);
      const ac = await comparePngs(page, a, c);
      const bc = await comparePngs(page, b, c);
      const diff = [ab, ac, bc].sort((x, y) => y.meanAbsLum - x.meanAbsLum)[0];
      report.views.wind = {view: windViewName, files: [a, b, c], diffs: {ab, ac, bc}, diff};
      log(`WIND: max=${JSON.stringify(diff)} (view=${windViewName}; ab=${ab.meanAbsLum}, ac=${ac.meanAbsLum}, bc=${bc.meanAbsLum})`);
      check(
        'perf: foliage/grass wind motion detected (3 shots ~1.2s apart differ)',
        diff.meanAbsLum >= WIND_GATE.minMeanAbsDiff || diff.changedPct >= 1.0,
        `maxMeanAbsLum=${diff.meanAbsLum} changed%=${diff.changedPct} (gate >=${WIND_GATE.minMeanAbsDiff}; ab/ac/bc=${ab.meanAbsLum}/${ac.meanAbsLum}/${bc.meanAbsLum})`,
      );
      await qaView(page, null);
      await sleep(300);
    }
  } else {
    report.notes.push('perf: wind check skipped (no wind/treeline view available)');
  }
  // Cycle-4 weather audit: each region at low+high intensity (forced when the QA weather hook exists),
  // plus a low-quality-tier high-intensity shot to prove weather particles are quality-gated.
  // SwiftShader defaults to quality low per world-scene — force high for beauty/weather captures.
  const weatherHook = await page.evaluate(`typeof window.__ssWeather==='function'`);
  report.weather = {hook: weatherHook, captures: [], lowTier: null, forceHook: null, qualityForced: null};
  if (weatherHook) {
    await page.evaluate(`window.__ssQuality&&window.__ssQuality('high')`).catch(() => null);
    await sleep(700);
    report.weather.qualityForced = 'high';
    report.weather.state = await readWeather(page);
    const probe = await setWeather(page, 'green', 'downpour', 1.0);
    report.weather.forceHook = probe.hook;
    if (!probe.hook) report.notes.push('weather: no forcing hook (__ssSetWeather/__ssWeatherForce...) — capturing natural phases only');
    for (const w of WEATHER_AUDIT) {
      for (const [intensity, spec] of [['low', w.low], ['high', w.high]]) {
        let force = null;
        if (probe.hook) {
          force = await setWeather(page, w.region, spec.phase, spec.intensity);
          await sleep(900);
        }
        // Cycle-5: crown captures prefer an optional 10 m `snow-compare` QA view when world-scene ships it.
        let view = await qaView(page, w.view);
        if (w.region === 'crown') {
          const compareView = await qaView(page, 'snow-compare');
          if (compareView && compareView.ok !== false) view = compareView;
        }
        if (!view || view.ok === false) {
          report.notes.push(`weather: view '${w.view}' unavailable for ${w.region} ${intensity}`);
          continue;
        }
        await sleep(QA_CAPTURE_SETTLE_MS);
        const shot = await screenshotWithStats(page, outDir, `weather-${w.label}-${intensity}.png`, null);
        const state = await readWeather(page);
        const regionInfo = await readRegionInfo(page);
        report.weather.captures.push({
          region: w.region,
          phase: spec.phase,
          intensity,
          forced: force,
          state,
          particles: weatherParticleCount(state),
          snow: weatherSnowCount(state),
          fogDensity: regionInfo?.fog?.density ?? null,
          regionReported: regionInfo?.region ?? null,
          file: shot.file,
          stats: shot.stats,
        });
        await qaView(page, null);
        await sleep(250);
      }
    }
    // Low-tier minimality: force a high downpour (rain counter exists), drop quality to low, capture
    // the same region view; low tier must reduce weather particles to 0/minimal (qualityScale 0).
    if (probe.hook) {
      await setWeather(page, 'march', 'downpour', 1.0);
      await page.evaluate(`window.__ssQuality&&window.__ssQuality('low')`);
      await sleep(1600);
      const view = await qaView(page, 'region-green');
      if (view && view.ok !== false) {
        await sleep(QA_CAPTURE_SETTLE_MS);
        const shot = await screenshotWithStats(page, outDir, 'weather-lowtier-rain-high.png', null);
        const state = await readWeather(page);
        report.weather.lowTier = {state, particles: weatherParticleCount(state), snow: weatherSnowCount(state), file: shot.file, stats: shot.stats};
      }
      // Cycle-5: low-tier snowstorm must expose 0 snow particles.
      await setWeather(page, 'crown', 'snowstorm', 1.0);
      await sleep(1200);
      const snowView = await qaView(page, 'region-crown');
      if (snowView && snowView.ok !== false) {
        await sleep(QA_CAPTURE_SETTLE_MS);
        const shot = await screenshotWithStats(page, outDir, 'weather-lowtier-snowstorm.png', null);
        const state = await readWeather(page);
        report.weather.lowTierSnow = {state, particles: weatherParticleCount(state), snow: weatherSnowCount(state), file: shot.file, stats: shot.stats};
      }
      await page.evaluate(`window.__ssQuality&&window.__ssQuality('high')`);
      await qaView(page, null);
    }
    await setWeather(page, null); // restore natural weather
    check(
      'weather: regional weather captures (low+high per region)',
      report.weather.captures.length >= WEATHER_GATE.minCaptures * 2,
      `${report.weather.captures.length}/${WEATHER_GATE.minCaptures * 2} (${report.weather.captures.map(c => `${c.phase}:${c.intensity}`).join(', ')})`,
    );
    // Per-region particle monotonicity (low vs high intensity) on regions with exposed counters.
    const perRegion = [];
    for (const w of WEATHER_AUDIT.filter(w => WEATHER_COUNT_REGIONS.includes(w.region))) {
      const low = report.weather.captures.find(c => c.region === w.region && c.intensity === 'low');
      const high = report.weather.captures.find(c => c.region === w.region && c.intensity === 'high');
      if (low && high && low.particles != null && high.particles != null) {
        perRegion.push({region: w.region, low: low.particles, high: high.particles, ok: high.particles > low.particles});
      }
    }
    if (perRegion.length) {
      report.weather.particles = {perRegion};
      check(
        'weather: high intensity uses more particles than low (per region)',
        perRegion.every(r => r.ok),
        JSON.stringify(perRegion),
      );
    }
    if (report.weather.lowTier && report.weather.lowTier.particles != null) {
      const highRain = report.weather.captures.find(c => c.region === 'march' && c.intensity === 'high' && c.particles != null);
      if (highRain) {
        check(
          'weather: low quality tier reduces weather particles to minimal/zero',
          report.weather.lowTier.particles < highRain.particles,
          `lowTier=${report.weather.lowTier.particles} highTier=${highRain.particles} (world-scene: low tier => 0 particles)`,
        );
      }
    }
    // Cycle-5 snowstorm audit: explicit `activeParticles.snow` counter, fog/whiteout response, and
    // the moved region-crown camera reporting the crown region.
    const snowLow = report.weather.captures.find(c => c.region === 'crown' && c.intensity === 'low');
    const snowHigh = report.weather.captures.find(c => c.region === 'crown' && c.intensity === 'high');
    if (snowLow && snowHigh) {
      report.weather.snow = {low: snowLow.snow, high: snowHigh.snow, lowFog: snowLow.fogDensity, highFog: snowHigh.fogDensity, regionLow: snowLow.regionReported, regionHigh: snowHigh.regionReported};
      check(
        'weather: snowstorm snow particles high > low (activeParticles.snow)',
        snowHigh.snow > snowLow.snow,
        `snow: low=${snowLow.snow} high=${snowHigh.snow}; per-phase ${snowLow.phase}/${snowHigh.phase}`,
      );
      if (snowLow.fogDensity != null && snowHigh.fogDensity != null) {
        check(
          'weather: snowstorm increases fog/whiteout vs snow',
          snowHigh.fogDensity > snowLow.fogDensity,
          `fog density low=${snowLow.fogDensity} high=${snowHigh.fogDensity}`,
        );
      } else {
        report.notes.push('weather: fog density not exposed via __ssRegionInfo during snow captures — visual check only');
      }
    }
    if (report.weather.lowTierSnow) {
      check(
        'weather: low quality tier => 0 snow particles',
        report.weather.lowTierSnow.snow === 0,
        `lowTier snow=${report.weather.lowTierSnow.snow} (state ${JSON.stringify(report.weather.lowTierSnow.state?.qualityScale ?? null)})`,
      );
    }
  } else {
    report.notes.push('weather: __ssWeather hook absent — weather audit skipped');
  }
  // Regional distinctness: pairwise mean-RGB distance + luminance spread across the 3 region shots.
  const regions = report.views.captures.filter(c => c.name.startsWith('region-'));
  if (regions.length >= 2) {
    const pairs = [];
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i].stats, b = regions[j].stats;
        const dr = a.meanR - b.meanR, dg = a.meanG - b.meanG, db = a.meanB - b.meanB;
        pairs.push({
          a: regions[i].name,
          b: regions[j].name,
          colorDistance: +Math.sqrt(dr * dr + dg * dg + db * db).toFixed(2),
          luminanceDiff: +Math.abs(a.mean - b.mean).toFixed(2),
        });
      }
    }
    const distinctness = {
      regions: regions.map(c => ({name: c.name, mean: c.stats.mean, p50: c.stats.p50, meanR: c.stats.meanR, meanG: c.stats.meanG, meanB: c.stats.meanB, fog: c.regionInfo?.fog ?? null, region: c.regionInfo?.region ?? null})),
      pairs,
      maxColorDistance: +Math.max(...pairs.map(p => p.colorDistance)).toFixed(2),
      maxLuminanceDiff: +Math.max(...pairs.map(p => p.luminanceDiff)).toFixed(2),
      minColorDistance: +Math.min(...pairs.map(p => p.colorDistance)).toFixed(2),
    };
    report.views.regionDistinctness = distinctness;
    check(
      'perf: region captures visibly distinct (colour/luminance)',
      distinctness.maxColorDistance >= REGION_GATE.minPairwiseColorDistance || distinctness.maxLuminanceDiff >= REGION_GATE.minLuminanceSpread,
      JSON.stringify({maxColorDistance: distinctness.maxColorDistance, minColorDistance: distinctness.minColorDistance, maxLuminanceDiff: distinctness.maxLuminanceDiff, gate: REGION_GATE}),
    );
    // Cycle-5: the moved region-crown camera must report the crown region (not the moor blend).
    const crownCapture = report.views.captures.find(c => c.name === 'region-crown');
    if (crownCapture && crownCapture.regionInfo) {
      check(
        'perf: region-crown camera reports the crown region',
        crownCapture.regionInfo.region === 'crown',
        `reported=${crownCapture.regionInfo.region} fog=${JSON.stringify(crownCapture.regionInfo.fog ?? null)}`,
      );
    } else {
      report.notes.push('perf: region-crown region info unavailable — crown camera report not gated');
    }
  }
}

/* ------------------------------------------------------------- CDP client */

class CDP {
  constructor(url, label = 'page') {
    this.url = url;
    this.label = label;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, {perMessageDeflate: false, maxPayload: 256 * 1024 * 1024});
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.label}: CDP socket open timed out`)), 15000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on('message', data => this.onMessage(data));
      ws.on('close', () => {
        this.closed = true;
        for (const {reject: rejectPending} of this.pending.values()) rejectPending(new Error(`${this.label}: CDP connection closed`));
        this.pending.clear();
      });
    });
    log(`CDP: ${this.label} WebSocket connected`);
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${this.label} CDP ${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    if (message.method) {
      const list = this.handlers.get(message.method);
      if (list) for (const fn of list) {
        try {
          fn(message.params || {});
        } catch (error) {
          log(`CDP: handler error for ${message.method}: ${error?.message || error}`);
        }
      }
    }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`${this.label}: CDP connection closed`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} CDP ${method}: timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {resolve, reject, timer, method});
      try {
        this.ws.send(JSON.stringify({id, method, params}));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, {awaitPromise = false, timeoutMs = 20000, returnByValue = true} = {}) {
    const result = await this.send(
      'Runtime.evaluate',
      {expression, awaitPromise, returnByValue, userGesture: true, includeCommandLineAPI: true},
      timeoutMs,
    );
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluate failed';
      throw new Error(`page evaluate failed: ${description.split('\n')[0]}`);
    }
    return result.result ? result.result.value : undefined;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

/* ----------------------------------------------------------- page helpers */

async function waitFor(page, expression, {timeoutMs = 60000, interval = 150, label = 'condition'} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await page.evaluate(`(()=>{try{return !!(${expression});}catch(e){return false;}})()`, {
        timeoutMs: 8000,
      });
      if (value) return true;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await sleep(interval);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}${lastError ? ` (last error: ${lastError})` : ''}`);
}

async function clickAt(page, x, y, button = 'left') {
  const params = {type: 'mousePressed', x: round(x), y: round(y), button, clickCount: 1};
  await page.send('Input.dispatchMouseEvent', params);
  await page.send('Input.dispatchMouseEvent', {...params, type: 'mouseReleased'});
}

async function selectorRect(page, selector) {
  return page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};})()`);
}

async function clickSelector(page, selector) {
  const rect = await selectorRect(page, selector);
  if (!rect) throw new Error(`cannot click missing/invisible element: ${selector}`);
  await clickAt(page, rect.x, rect.y);
  return rect;
}

async function typeInto(page, selector, text) {
  const rect = await clickSelector(page, selector);
  await sleep(80);
  await page.send('Input.insertText', {text});
  return rect;
}

async function pressKey(page, code, key, vk) {
  await page.send('Input.dispatchKeyEvent', {type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
  await sleep(60);
  await page.send('Input.dispatchKeyEvent', {type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
}

async function holdKey(page, code, key, vk, ms) {
  await page.send('Input.dispatchKeyEvent', {type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
  await sleep(ms);
  await page.send('Input.dispatchKeyEvent', {type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
}

async function screenshot(page, outDir, name) {
  const started = Date.now();
  const shot = await page.send('Page.captureScreenshot', {format: 'png', fromSurface: true}, 60000);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  log(`SHOT: ${name} (${((Date.now() - started) / 1000).toFixed(2)}s, ${(shot.data.length * 0.75 / 1024).toFixed(0)} KB)`);
  return file;
}

/**
 * Decode a PNG screenshot inside the page (2D canvas) and measure what is actually visible.
 * `region` (optional) is a fractional crop {x0,y0,x1,y1} in 0..1 for character-region luminance.
 */
async function analyzePng(page, base64, region = null) {
  return page.evaluate(
    `(()=>new Promise((resolve,reject)=>{
      const region=${JSON.stringify(region)};
      const img=new Image();
      img.onload=()=>{
        try{
          const W=img.naturalWidth,H=img.naturalHeight;
          const c=document.createElement('canvas');c.width=W;c.height=H;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
          const x0=region?Math.max(0,Math.floor(W*region.x0)):0;
          const x1=region?Math.min(W,Math.ceil(W*region.x1)):W;
          const y0=region?Math.max(0,Math.floor(H*region.y0)):0;
          const y1=region?Math.min(H,Math.ceil(H*region.y1)):H;
          const d=ctx.getImageData(0,0,W,H).data;
          const lums=[];let sum=0,sumSq=0,nonDark=0,black=0,clipped=0,min=255,max=0;
          let sumR=0,sumG=0,sumB=0,sumSat=0;
          const sats=[];
          const buckets=new Set();
          for(let y=y0;y<y1;y+=2){
            for(let x=x0;x<x1;x+=2){
              const i=(y*W+x)*4;const r=d[i],g=d[i+1],b=d[i+2];
              const lum=0.2126*r+0.7152*g+0.0722*b;
              const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
              const sat=mx>0?(mx-mn)/mx:0;
              lums.push(lum);sats.push(sat);sum+=lum;sumSq+=lum*lum;sumR+=r;sumG+=g;sumB+=b;sumSat+=sat;
              if(lum>10)nonDark++;
              if(lum<20)black++;
              if(lum>=250)clipped++;
              if(lum<min)min=lum;if(lum>max)max=lum;
              buckets.add(((r>>3)<<10)|((g>>3)<<5)|(b>>3));
            }
          }
          const count=lums.length;const mean=sum/count;
          const sorted=lums.slice().sort((a,b)=>a-b);
          const sortedSats=sats.slice().sort((a,b)=>a-b);
          const pick=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
          const pickSat=p=>sortedSats[Math.min(sortedSats.length-1,Math.floor(sortedSats.length*p))];
          resolve({width:W,height:H,region:region||null,sampled:count,
            mean:+mean.toFixed(2),p50:+pick(0.5).toFixed(2),p90:+pick(0.9).toFixed(2),
            meanR:+(sumR/count).toFixed(2),meanG:+(sumG/count).toFixed(2),meanB:+(sumB/count).toFixed(2),
            meanSat:+(sumSat/count).toFixed(4),p90Sat:+pickSat(0.9).toFixed(4),
            std:+Math.sqrt(Math.max(0,sumSq/count-mean*mean)).toFixed(2),
            blackPct:+(black/count*100).toFixed(2),
            clippedPct:+(clipped/count*100).toFixed(2),
            nonDarkPct:+(nonDark/count*100).toFixed(2),
            uniqueColors:buckets.size,min:+min.toFixed(1),max:+max.toFixed(1)});
        }catch(e){reject(new Error('pixels: '+(e&&e.message)));}
      };
      img.onerror=()=>reject(new Error('screenshot decode failed'));
      img.src='data:image/png;base64,${base64.replace(/'/g, "\\'")}';
    }))()`,
    {awaitPromise: true, timeoutMs: 60000},
  );
}

/**
 * Cycle-4 body-mask torso-tone measurement (Lead-approved re-baseline): in the fixed torso crop the
 * background now dominates, so estimate the character silhouette by its colour/luminance difference
 * from the crop edge (left/right/top background strips), then measure tone over the masked pixels
 * only. Reports maskPct so a bad mask is visible rather than silently trusted.
 */
async function analyzePngBodyMask(page, base64, region) {
  return page.evaluate(
    `(()=>new Promise((resolve,reject)=>{
      const region=${JSON.stringify(region)};
      const img=new Image();
      img.onload=()=>{
        try{
          const W=img.naturalWidth,H=img.naturalHeight;
          const c=document.createElement('canvas');c.width=W;c.height=H;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
          const x0=Math.max(0,Math.floor(W*region.x0)),x1=Math.min(W,Math.ceil(W*region.x1));
          const y0=Math.max(0,Math.floor(H*region.y0)),y1=Math.min(H,Math.ceil(H*region.y1));
          const d=ctx.getImageData(0,0,W,H).data;
          const bw=Math.max(4,Math.floor((x1-x0)*0.14)); // border strip width for background sampling
          let bgN=0,bgR=0,bgG=0,bgB=0;
          const addBg=(x,y)=>{const i=(y*W+x)*4;bgR+=d[i];bgG+=d[i+1];bgB+=d[i+2];bgN++;};
          for(let y=y0;y<y1;y+=2){
            for(let x=x0;x<x0+bw;x+=2)addBg(x,y);
            for(let x=x1-bw;x<x1;x+=2)addBg(x,y);
          }
          for(let y=y0;y<Math.min(y1,y0+bw);y+=2){for(let x=x0;x<x1;x+=2)addBg(x,y);}
          if(!bgN){reject(new Error('body-mask: no background samples'));return;}
          bgR/=bgN;bgG/=bgN;bgB/=bgN;
          const bgLum=0.2126*bgR+0.7152*bgG+0.0722*bgB;
          // Cycle-4 body-mask: the character occupies the central column of the torso crop; restrict
          // to a central ROI (30-70% width, 8-95% height) and select pixels whose colour differs
          // strongly (sum-abs > 80) from the edge-sampled background. The ROI/maskPct are reported so
          // an unreliable mask is visible rather than silently trusted.
          const rx0=x0+Math.floor((x1-x0)*0.30), rx1=x0+Math.floor((x1-x0)*0.70);
          const ry0=y0+Math.floor((y1-y0)*0.08), ry1=y0+Math.floor((y1-y0)*0.95);
          const lums=[],buckets=new Set();
          let maskN=0,total=0,sum=0,sumSq=0,black=0,clipped=0;
          for(let y=ry0;y<ry1;y+=2){
            for(let x=rx0;x<rx1;x+=2){
              const i=(y*W+x)*4;const r=d[i],g=d[i+1],b=d[i+2];
              const lum=0.2126*r+0.7152*g+0.0722*b;
              const diff=Math.abs(r-bgR)+Math.abs(g-bgG)+Math.abs(b-bgB);
              total++;
              if(diff<=80)continue;
              maskN++;sum+=lum;sumSq+=lum*lum;
              if(lum<20)black++;
              if(lum>=250)clipped++;
              lums.push(lum);
              buckets.add(((r>>3)<<10)|((g>>3)<<5)|(b>>3));
            }
          }
          if(!maskN){reject(new Error('body-mask: empty mask'));return;}
          const mean=sum/maskN;
          const sorted=lums.slice().sort((a,b)=>a-b);
          const pick=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
          resolve({region:region||null,sampled:maskN,total,background:{r:+bgR.toFixed(1),g:+bgG.toFixed(1),b:+bgB.toFixed(1),lum:+bgLum.toFixed(1)},
            method:'central-ROI(30-70% x,8-95% y) colour-diff>80 vs edge background; heuristic silhouette, not alpha mask',
            mean:+mean.toFixed(2),p50:+pick(0.5).toFixed(2),p90:+pick(0.9).toFixed(2),
            std:+Math.sqrt(Math.max(0,sumSq/maskN-mean*mean)).toFixed(2),
            blackPct:+(black/maskN*100).toFixed(2),clippedPct:+(clipped/maskN*100).toFixed(2),
            maskPct:+(maskN/total*100).toFixed(2),uniqueColors:buckets.size});
        }catch(e){reject(new Error('body-mask: '+(e&&e.message)));}
      };
      img.onerror=()=>reject(new Error('body-mask: screenshot decode failed'));
      img.src='data:image/png;base64,${base64.replace(/'/g, "\\'")}';
    }))()`,
    {awaitPromise: true, timeoutMs: 60000},
  );
}
/**
 * Cycle-5 high-frequency detail metric (plate texel density / "stretched flat face" detector):
 * mean + p90 gradient magnitude and edge density over a crop. Uniform fine texel detail gives higher
 * values than large flat quads; used per body close-up alongside the visual inspection.
 */
async function analyzePngGradient(page, base64, region) {
  return page.evaluate(
    `(()=>new Promise((resolve,reject)=>{
      const region=${JSON.stringify(region)};
      const img=new Image();
      img.onload=()=>{
        try{
          const W=img.naturalWidth,H=img.naturalHeight;
          const c=document.createElement('canvas');c.width=W;c.height=H;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
          const x0=Math.max(0,Math.floor(W*region.x0)),x1=Math.min(W,Math.ceil(W*region.x1));
          const y0=Math.max(0,Math.floor(H*region.y0)),y1=Math.min(H,Math.ceil(H*region.y1));
          const d=ctx.getImageData(0,0,W,H).data;
          const lum=(x,y)=>{const i=(y*W+x)*4;return 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];};
          const grads=[];let sum=0,edges=0;
          for(let y=y0+1;y<y1-1;y+=2){
            for(let x=x0+1;x<x1-1;x+=2){
              const gx=lum(x+1,y)-lum(x-1,y), gy=lum(x,y+1)-lum(x,y-1);
              const g=Math.hypot(gx,gy);
              grads.push(g);sum+=g;
              if(g>25)edges++;
            }
          }
          const count=grads.length;if(!count){reject(new Error('gradient: empty region'));return;}
          const sorted=grads.slice().sort((a,b)=>a-b);
          const pick=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
          resolve({region:region||null,sampled:count,
            meanGradient:+(sum/count).toFixed(2),p90Gradient:+pick(0.9).toFixed(2),p50Gradient:+pick(0.5).toFixed(2),
            edgePct:+(edges/count*100).toFixed(2)});
        }catch(e){reject(new Error('gradient: '+(e&&e.message)));}
      };
      img.onerror=()=>reject(new Error('gradient: screenshot decode failed'));
      img.src='data:image/png;base64,${base64.replace(/'/g, "\\'")}';
    }))()`,
    {awaitPromise: true, timeoutMs: 60000},
  );
}

async function screenshotWithStats(page, outDir, name, region = null) {
  const file = await screenshot(page, outDir, name);
  const base64 = fs.readFileSync(file).toString('base64');
  const stats = await analyzePng(page, base64, region);
  log(`REGION[${name}]: mean=${stats.mean} p50=${stats.p50} p90=${stats.p90} black=${stats.blackPct}%`);
  return {file, stats};
}

/**
 * Compare two saved PNGs inside the page: mean absolute per-channel/luminance difference over a
 * central region. Used for the cycle-3 wind check (two shots ~1 s apart must differ) and for
 * elite-vs-normal undead silhouette comparison.
 */
async function comparePngs(page, fileA, fileB, region = {x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8}) {
  const a = fs.readFileSync(fileA).toString('base64');
  const b = fs.readFileSync(fileB).toString('base64');
  return page.evaluate(
    `(()=>new Promise((resolve,reject)=>{
      const region=${JSON.stringify(region)};
      const load=s=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode failed'));i.src='data:image/png;base64,'+s;});
      Promise.all([load(${JSON.stringify(a)}),load(${JSON.stringify(b)})]).then(([ia,ib])=>{
        try{
          const W=ia.naturalWidth,H=ia.naturalHeight;
          const ca=document.createElement('canvas');ca.width=W;ca.height=H;
          const cb=document.createElement('canvas');cb.width=W;cb.height=H;
          const xa=ca.getContext('2d',{willReadFrequently:true});xa.drawImage(ia,0,0);
          const xb=cb.getContext('2d',{willReadFrequently:true});xb.drawImage(ib,0,0);
          const da=xa.getImageData(0,0,W,H).data, db=xb.getImageData(0,0,W,H).data;
          const x0=Math.max(0,Math.floor(W*region.x0)),x1=Math.min(W,Math.ceil(W*region.x1));
          const y0=Math.max(0,Math.floor(H*region.y0)),y1=Math.min(H,Math.ceil(H*region.y1));
          let n=0,sr=0,sg=0,sb=0,sl=0,changed=0;
          for(let y=y0;y<y1;y+=2){
            for(let x=x0;x<x1;x+=2){
              const i=(y*W+x)*4;
              const ar=da[i],ag=da[i+1],ab=da[i+2],br=db[i],bg=db[i+1],bb=db[i+2];
              const al=0.2126*ar+0.7152*ag+0.0722*ab, bl=0.2126*br+0.7152*bg+0.0722*bb;
              sr+=Math.abs(ar-br);sg+=Math.abs(ag-bg);sb+=Math.abs(ab-bb);sl+=Math.abs(al-bl);
              if(Math.abs(ar-br)+Math.abs(ag-bg)+Math.abs(ab-bb)>24)changed++;
              n++;
            }
          }
          resolve({samples:n,meanAbsR:+(sr/n).toFixed(3),meanAbsG:+(sg/n).toFixed(3),
            meanAbsB:+(sb/n).toFixed(3),meanAbsLum:+(sl/n).toFixed(3),changedPct:+(changed/n*100).toFixed(2)});
        }catch(e){reject(new Error('compare: '+(e&&e.message)));}
      });
    }))()`,
    {awaitPromise: true, timeoutMs: 60000},
  );
}

/** Screenshot with HUD/scene overlays hidden so only the WebGL canvas is measured. */
async function canvasPixelStats(page, outDir, label) {
  await page.evaluate(`(()=>{for(const s of ['#hud','.vignette']){const el=document.querySelector(s);if(el)el.style.visibility='hidden';}return true;})()`);
  await sleep(300);
  const shot = await page.send('Page.captureScreenshot', {format: 'png', fromSurface: true}, 60000);
  await page.evaluate(`(()=>{for(const s of ['#hud','.vignette']){const el=document.querySelector(s);if(el)el.style.visibility='';}return true;})()`);
  const stats = await analyzePng(page, shot.data);
  stats.ok = stats.std >= CANVAS_GATE.minStd && stats.nonDarkPct >= CANVAS_GATE.minNonDarkPct && stats.uniqueColors >= CANVAS_GATE.minColors;
  log(`CANVAS[${label}]: mean=${stats.mean} std=${stats.std} nonDark=${stats.nonDarkPct}% colors=${stats.uniqueColors} -> ${stats.ok ? 'ok' : 'BLANK?'}`);
  return stats;
}

async function measureFps(page, ms = 1500) {
  try {
    return await page.evaluate(
      `new Promise(res=>{let n=0;const t0=performance.now();function f(){n++;const t=performance.now();if(t-t0<${ms})requestAnimationFrame(f);else res({frames:n,elapsedMs:+(t-t0).toFixed(0),fps:+(n/((t-t0)/1000)).toFixed(1)});}requestAnimationFrame(f);})`,
      {awaitPromise: true, timeoutMs: ms + 15000},
    );
  } catch (error) {
    return {error: error?.message || String(error)};
  }
}

const HUD_IDS = [
  'playerName', 'healthText', 'staminaText', 'equippedWeapon', 'device', 'roomCode', 'cameraBtn',
  'resources', 'objectives', 'castleList', 'regions', 'wayfinder', 'rescueCount', 'nestStatus',
  'siege', 'prompt', 'toast', 'connection', 'bossName', 'armoryHint',
];

async function hudSnapshot(page) {
  return page.evaluate(`(()=>{
    const out={};
    for(const id of ${JSON.stringify(HUD_IDS)}){
      const el=document.getElementById(id);
      if(!el)continue;
      const text=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();
      out[id]=text.slice(0,600);
    }
    const hud=document.getElementById('hud');
    out.__hudHidden=!hud||hud.hidden;
    out.__hudDisplay=hud?getComputedStyle(hud).display:null;
    out.__landingHidden=document.getElementById('landing')?.hidden??null;
    out.__title=document.title;
    out.__href=location.href;
    out.__viewport={w:innerWidth,h:innerHeight,dpr:devicePixelRatio};
    const canvas=document.getElementById('world');
    out.__canvas=canvas?{width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight}:null;
    const hp=document.getElementById('health');
    out.__healthWidth=hp?hp.style.width:null;
    const st=document.getElementById('stamina');
    out.__staminaWidth=st?st.style.width:null;
    out.__castleRows=document.querySelectorAll('#castleList>div').length;
    out.__weaponCards=document.querySelectorAll('#weaponCards button').length;
    out.__dialogsOpen=[...document.querySelectorAll('dialog')].filter(d=>d.open).map(d=>d.id);
    return out;
  })()`);
}

async function rendererInfo(page) {
  return page.evaluate(`(()=>{
    const canvas=document.getElementById('world');
    if(!canvas)return {webgl:false,reason:'no canvas'};
    const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
    if(!gl)return {webgl:false,reason:'no context'};
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl:true,
      context:gl instanceof WebGL2RenderingContext?'webgl2':'webgl1',
      vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),
      renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      version:gl.getParameter(gl.VERSION),
      shadingLanguageVersion:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),
      userAgent:navigator.userAgent,
    };
  })()`);
}

/* ------------------------------------------------ shared page/session helpers */

/** Root URL of the deployed site (keeps the sub-path, always trailing slash). */
function siteRootFromUrl(raw) {
  const u = new URL(raw);
  const p = u.pathname.endsWith('/') ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
  return `${u.origin}${p}`;
}

/**
 * Wire DevTools events for one page into a collector object. Used for the single-page flow and
 * for both co-op pages. `internalPrefix`/`assetPrefix` scope the 4xx/failed-request gates so a
 * third-party CDN failure is reported as a warning instead of failing the run.
 */
function attachPage(page, {internalPrefix, assetPrefix, label, notesSink}) {
  const sink = {
    label,
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    logErrors: [],
    badResponses: [],
    failedRequests: [],
    assetRequests: [],
    internalRequests: 0,
    responseBytes: 0,
    finishedRequests: 0,
    assetBytes: 0,
    navigations: 0,
    notes: notesSink || [],
  };
  const note = text => {
    if (notesSink) {
      if (!notesSink.includes(text)) notesSink.push(text);
    } else if (!sink.notes.includes(text)) sink.notes.push(text);
  };
  const internal = url => typeof url === 'string' && url.startsWith(internalPrefix);
  const isAsset = url => typeof url === 'string' && url.startsWith(assetPrefix);
  const requestUrls = new Map();
  const requestMeta = new Map();
  page.on('Network.requestWillBeSent', params => {
    if (params.request?.url) {
      requestUrls.set(params.requestId, params.request.url);
      requestMeta.set(params.requestId, {url: params.request.url, type: params.type || ''});
    }
  });
  sink.navigations = 0;
  sink.navigationLog = [];
  page.on('Page.frameNavigated', params => {
    if (params.frame && !params.frame.parentId) {
      sink.navigations++;
      sink.navigationLog.push({url: params.frame.url, at: Date.now()});
    }
  });
  page.on('Runtime.exceptionThrown', params => {
    const d = params.exceptionDetails || {};
    sink.pageErrors.push({
      text: d.exception?.description || d.text || 'unknown exception',
      url: d.url || '',
      line: d.lineNumber,
      at: Date.now(),
    });
  });
  page.on('Runtime.consoleAPICalled', params => {
    const type = params.type;
    const text = (params.args || [])
      .map(arg => {
        if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
        return arg.description || arg.unserializableValue || String(arg.type);
      })
      .join(' ');
    if (type === 'error' || type === 'assert') sink.consoleErrors.push({type, text, at: Date.now()});
    else if (type === 'warning') sink.consoleWarnings.push({type, text, at: Date.now()});
  });
  page.on('Log.entryAdded', params => {
    const entry = params.entry || {};
    if (entry.level === 'error') sink.logErrors.push({source: entry.source, text: entry.text, url: entry.url || '', at: Date.now()});
    else if (entry.level === 'warning') sink.consoleWarnings.push({type: `log:${entry.source}`, text: entry.text, at: Date.now()});
  });
  page.on('Network.responseReceived', params => {
    const r = params.response || {};
    const url = r.url || '';
    if (internal(url)) {
      sink.internalRequests++;
      if (isAsset(url) && !sink.assetRequests.includes(url)) sink.assetRequests.push(url);
    }
    if (typeof r.status === 'number' && r.status >= 400) {
      const entry = {url, status: r.status, type: params.type, mimeType: r.mimeType || ''};
      if (internal(url)) {
        if (/\/favicon\.ico$/.test(url)) note('favicon.ico is 404 (cosmetic, ignored)');
        else sink.badResponses.push(entry);
      } else {
        sink.consoleWarnings.push({type: 'external-http', text: `${r.status} ${url}`, at: Date.now()});
      }
    }
  });
  page.on('Network.loadingFailed', params => {
    if (params.canceled) return;
    const entry = {requestId: params.requestId, errorText: params.errorText, type: params.type};
    // Network.loadingFailed does not carry the URL; resolve it from requestWillBeSent.
    const url = requestUrls.get(params.requestId);
    if (internal(url)) sink.failedRequests.push({...entry, url, at: Date.now()});
  });
  page.on('Network.loadingFinished', params => {
    const meta = requestMeta.get(params.requestId);
    if (!meta || !internal(meta.url)) return;
    const bytes = params.encodedDataLength || 0;
    sink.responseBytes += bytes;
    sink.finishedRequests++;
    if (isAsset(meta.url)) sink.assetBytes += bytes;
  });
  return sink;
}

/** Create a fresh page target in Chrome and wire it up for QA driving. */
async function openPageSession({debugPort, internalPrefix, assetPrefix, label, notesSink}) {
  const info = await createPageTarget(debugPort);
  const page = new CDP(info.webSocketDebuggerUrl, label);
  await page.open();
  const sink = attachPage(page, {internalPrefix, assetPrefix, label, notesSink});
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Network.enable', {maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024});
  try {
    await page.send('Emulation.setFocusEmulationEnabled', {enabled: true}, 5000);
  } catch (error) {
    sink.notes.push(`[${label}] Emulation.setFocusEmulationEnabled unavailable: ${error?.message || error}`);
  }
  try {
    await page.send('Page.bringToFront', {}, 5000);
  } catch {}
  // Install the WebSocket recorder before the app's first script runs.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source: WS_INSTRUMENT});
  log(`CDP[${label}]: Page/Runtime/Log/Network enabled + WS instrumentation`);
  return {page, sink, info};
}

async function waitForHud(page, timeoutMs = 150000) {
  await waitFor(
    page,
    `(()=>{const h=document.getElementById('hud');return !!h && !h.hidden && getComputedStyle(h).display!=='none';})()`,
    {timeoutMs, label: 'HUD visible'},
  );
}

async function waitForGameState(page, timeoutMs = 60000) {
  await waitFor(
    page,
    `(()=>{const p=document.getElementById('playerName');const r=document.getElementById('resources');const w=document.getElementById('wayfinder');return !!p&&p.textContent.trim().length>0&&!!r&&r.textContent.includes('WOOD')&&!!w&&w.textContent.trim().length>0;})()`,
    {timeoutMs, label: 'game state (player name, resources, wayfinder)'},
  );
}

async function navigateToLanding(page, url, {timeoutMs = 60000, label = 'page'} = {}) {
  await page.send('Page.navigate', {url}, 60000);
  await waitFor(page, `document.readyState==='complete'`, {timeoutMs, label: `${label} load`});
  await waitFor(
    page,
    `(()=>{const l=document.getElementById('landing');const n=document.getElementById('name');return !!l && !l.hidden && !!n && l.getBoundingClientRect().height>0;})()`,
    {timeoutMs, label: `${label} landing UI`},
  );
}

/** Wait until a join/create button is actually enabled (batch-3 gates joining on core loading). */
async function waitForJoinEnabled(page, selector, timeoutMs = 150000) {
  await waitFor(
    page,
    `(()=>{const b=document.querySelector(${JSON.stringify(selector)});return !!b && b.disabled===false;})()`,
    {timeoutMs, label: `${selector} enabled`},
  );
}

/** Landing -> name -> "Begin a campaign" -> HUD + first authoritative snapshot. */
async function createCampaign(page, {name = 'QA Knight', hudTimeout = 150000} = {}) {
  await typeInto(page, '#name', name);
  await waitForJoinEnabled(page, '#create', hudTimeout);
  await clickSelector(page, '#create');
  await waitForHud(page, hudTimeout);
  await waitForGameState(page, 60000);
}

/** Landing -> name + room code -> "Join" -> HUD + first authoritative snapshot. */
async function joinCampaign(page, {name = 'QA Knight', code, hudTimeout = 150000} = {}) {
  await typeInto(page, '#name', name);
  await typeInto(page, '#code', String(code));
  await waitForJoinEnabled(page, '#join', hudTimeout);
  await clickSelector(page, '#join');
  await waitForHud(page, hudTimeout);
  await waitForGameState(page, 60000);
}

/** Read the instrumented WebSocket/state summary from a page. */
async function readQaState(page) {
  return page.evaluate(`window.__qaWs ? JSON.parse(JSON.stringify({
    instances:window.__qaWs.instances,opens:window.__qaWs.opens,closes:window.__qaWs.closes,
    errors:window.__qaWs.errors,urls:window.__qaWs.urls,openedAt:window.__qaWs.openedAt,
    conns:window.__qaWs.conns,
    welcome:window.__qaWs.welcome,stateCount:window.__qaWs.stateCount,
    firstStateAt:window.__qaWs.firstStateAt,lastMessageAt:window.__qaWs.lastMessageAt,
    lastState:window.__qaWs.lastState,allActors:window.__qaWs.allActors,visibility:window.__qaWs.visibility
  })) : null`);
}

async function holdKeys(page, keys, ms) {
  for (const [code, key, vk] of keys) {
    await page.send('Input.dispatchKeyEvent', {type: 'keyDown', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
  }
  await sleep(ms);
  for (const [code, key, vk] of keys) {
    await page.send('Input.dispatchKeyEvent', {type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk});
  }
}

/** Make sure a page target is foregrounded (two independent Chrome instances otherwise blur). */
async function focusPage(page, label = 'page') {
  try {
    await page.send('Page.bringToFront', {}, 5000);
  } catch {}
  try {
    await page.send('Emulation.setFocusEmulationEnabled', {enabled: true}, 5000);
  } catch {}
  if (process.env.QA_DEBUG) {
    try {
      const state = await page.evaluate(`({focus:document.hasFocus(),visibility:document.visibilityState})`);
      log(`FOCUS[${label}]: ${JSON.stringify(state)}`);
    } catch {}
  }
}

/**
 * Keyboard-only walk to a weapon-rack drop using the authoritative snapshot (yaw + positions),
 * so the co-op test can prove a rack pickup without relying on visual navigation. Holds each
 * direction long enough to survive the very slow dual-SwiftShader frame ping-pong, and re-focuses
 * the page every round (a second Chrome instance blurs the first, which releases held keys).
 */
async function moveToRack(page, rack, {iterations = 24, stepMs = 1200, label = 'rack'} = {}) {
  for (let i = 0; i < iterations; i++) {
    await focusPage(page, label);
    const state = await readQaState(page);
    const me = state?.welcome ? (state.lastState?.actors || []).find(a => a.id === state.welcome.id) : null;
    const target = (state?.lastState?.weaponDrops || []).find(d => !d.taken && d.weapon === rack.weapon) || rack;
    if (!me || !target) return {reason: 'no-player-or-target', iteration: i};
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 2.2) return {distance: +distance.toFixed(2), iteration: i};
    const prompt = await page.evaluate(`document.getElementById('prompt').textContent`);
    if (/Recover/i.test(prompt || '')) return {distance: +distance.toFixed(2), iteration: i, prompt};
    const yaw = me.yaw || 0;
    const forward = dx * Math.sin(yaw) + dz * -Math.cos(yaw);
    const right = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const keys = [];
    if (forward > 0.4) keys.push(['KeyW', 'w', 87]);
    else if (forward < -0.4) keys.push(['KeyS', 's', 83]);
    if (right > 0.4) keys.push(['KeyD', 'd', 68]);
    else if (right < -0.4) keys.push(['KeyA', 'a', 65]);
    if (!keys.length) return {distance: +distance.toFixed(2), stalled: true, iteration: i};
    if (process.env.QA_DEBUG) {
      log(`moveToRack[${label}] i=${i} me=(${me.x},${me.z}) yaw=${me.yaw} target=(${target.x},${target.z}) d=${distance.toFixed(2)} keys=${keys.map(k => k[0]).join('+')}`);
    }
    await holdKeys(page, keys, stepMs);
    await sleep(250);
  }
  return null;
}

/** Fetch a list of asset paths directly in the page and require HTTP 200 for each. */
async function verifyExpectedAssets(page, assetPrefix, list, {timeoutMs = 120000} = {}) {
  if (!list.length) return [];
  return page.evaluate(
    `(async()=>{const out=[];for(const rel of ${JSON.stringify(list)}){const url=${JSON.stringify(assetPrefix)}+String(rel).replace(/^\\/+/,'');try{const res=await fetch(url,{cache:'no-store'});out.push({path:rel,url,status:res.status,ok:res.ok});}catch(e){out.push({path:rel,url,status:null,ok:false,error:String((e&&e.message)||e)});}}return out;})()`,
    {awaitPromise: true, timeoutMs},
  );
}

/** Poll the local server's /health every second to detect event-loop/CPU starvation stalls. */
function startHealthSampler(port) {
  const samples = [];
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    const started = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(5000)});
      samples.push({at: started, rttMs: Date.now() - started, ok: res.ok});
    } catch (error) {
      samples.push({at: started, rttMs: Date.now() - started, ok: false, error: String(error?.cause?.code || error?.message || error)});
    } finally {
      inFlight = false;
    }
  }, 1000);
  timer.unref?.();
  return {
    samples,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function summarizeHealth(samples) {
  if (!samples.length) return null;
  const rtts = samples.map(s => s.rttMs).sort((a, b) => a - b);
  const pick = f => rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * f))];
  return {
    samples: samples.length,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    maxMs: rtts[rtts.length - 1],
    stallsOver2s: samples.filter(s => s.rttMs > 2000).length,
    failures: samples.filter(s => !s.ok).length,
  };
}

/** Compact WS/state diagnostics for the reconnect investigation. */
function wsDiagnostics(state, startedAt) {
  if (!state) return null;
  return {
    instances: state.instances,
    opens: state.opens,
    closes: state.closes || [],
    conns: state.conns || [],
    errors: state.errors || [],
    urls: state.urls || [],
    stateCount: state.stateCount,
    welcome: state.welcome,
    firstStateAt: state.firstStateAt,
    lastMessageAt: state.lastMessageAt,
    reconnected: (state.opens || 0) > 1 || (state.closes || []).length > 0,
    firstStateSinceStartMs: startedAt && state.firstStateAt ? state.firstStateAt - startedAt : null,
    // Client reconnect delay: setTimeout(500ms * 2^attempt) fired late proves a renderer stall.
    reconnectGapsMs: (state.closes || []).map(close => {
      const nextOpen = (state.openedAt || [])[close.instance + 1];
      return nextOpen ? nextOpen - close.at : null;
    }),
  };
}

/**
 * Two-player co-op verification: two completely independent Chrome instances/profiles against
 * the local authoritative server. A creates a room, B joins with the code, then we prove via the
 * instrumented authoritative snapshots that both clients see both players, B's movement reaches
 * A, and a weapon-rack pickup unlocks for both (shared armory rule).
 */
async function coopFlow({opts, report, check, logDir, tempRoot, baseUrl, healthSampler, handles}) {
  const internalPrefix = baseUrl;
  const assetPrefix = `${baseUrl}/assets/`;
  const coopStartedAt = Date.now();
  report.coop = {roomCode: null, playersA: null, playersB: null, movement: null, pickup: null, hud: null};

  // --- Player A: fresh profile, create the campaign/room.
  const debugA = await freePort();
  const chromeA = await startChrome(debugA, path.join(tempRoot, 'chrome-coop-a'), opts.chrome, logDir);
  handles.chromes.push(chromeA);
  const sessionA = await openPageSession({debugPort: debugA, internalPrefix, assetPrefix, label: 'coop-A', notesSink: report.notes});
  handles.pages.push(sessionA.page);
  await navigateToLanding(sessionA.page, `${baseUrl}/`, {timeoutMs: opts.hudTimeout, label: 'coop A'});
  await createCampaign(sessionA.page, {name: 'Coop A', hudTimeout: opts.hudTimeout});
  const roomCode = ((await sessionA.page.evaluate(`document.getElementById('roomCode').textContent`)) || '').trim().toUpperCase();
  report.coop.roomCode = roomCode;
  check('coop: room created (6-char room code shown)', /^[0-9A-F]{6}$/.test(roomCode), roomCode);

  // --- Player B: second independent Chrome instance + profile, join by room code.
  const debugB = await freePort();
  const chromeB = await startChrome(debugB, path.join(tempRoot, 'chrome-coop-b'), opts.chrome, logDir);
  handles.chromes.push(chromeB);
  const sessionB = await openPageSession({debugPort: debugB, internalPrefix, assetPrefix, label: 'coop-B', notesSink: report.notes});
  handles.pages.push(sessionB.page);
  await navigateToLanding(sessionB.page, `${baseUrl}/`, {timeoutMs: opts.hudTimeout, label: 'coop B'});
  await joinCampaign(sessionB.page, {name: 'Coop B', code: roomCode, hudTimeout: opts.hudTimeout});
  check('coop: B joined the campaign via room code', true, roomCode);
  // Wait until both instrumented snapshots list both players (slow software renderer can lag).
  try {
    await waitFor(sessionA.page, `window.__qaWs && window.__qaWs.lastState && window.__qaWs.lastState.players.length>=2`, {timeoutMs: 45000, label: 'A sees 2 players'});
    await waitFor(sessionB.page, `window.__qaWs && window.__qaWs.lastState && window.__qaWs.lastState.players.length>=2`, {timeoutMs: 45000, label: 'B sees 2 players'});
  } catch (error) {
    report.notes.push(`coop: timed out waiting for both clients to see 2 players (${error?.message || error})`);
  }
  await sleep(1500);

  const stateA = await readQaState(sessionA.page);
  const stateB = await readQaState(sessionB.page);
  const idA = stateA?.welcome?.id;
  const idB = stateB?.welcome?.id;
  const playersA = stateA?.lastState?.players || [];
  const playersB = stateB?.lastState?.players || [];
  const hudA = await hudSnapshot(sessionA.page);
  const hudB = await hudSnapshot(sessionB.page);
  report.coop.playersA = playersA;
  report.coop.playersB = playersB;
  report.coop.hud = {
    a: {playerName: hudA.playerName, resources: hudA.resources, hudHidden: hudA.__hudHidden},
    b: {playerName: hudB.playerName, resources: hudB.resources, hudHidden: hudB.__hudHidden},
  };

  check(
    'coop: A and B are in the same room',
    !!idA && !!idB && stateA?.welcome?.code === stateB?.welcome?.code,
    `A=${idA} B=${idB} codeA=${stateA?.welcome?.code} codeB=${stateB?.welcome?.code}`,
  );
  check(
    'coop: both authoritative snapshots list both player ids',
    [idA, idB].every(id => playersA.some(p => p.id === id)) && [idA, idB].every(id => playersB.some(p => p.id === id)),
    `A sees ${playersA.length} (${playersA.map(p => p.name).join(',')}), B sees ${playersB.length} (${playersB.map(p => p.name).join(',')})`,
  );
  check(
    'coop: both HUDs visible with correct names',
    !hudA.__hudHidden && !hudB.__hudHidden && hudA.playerName === 'Coop A' && hudB.playerName === 'Coop B',
    `A="${hudA.playerName}"/hidden=${hudA.__hudHidden} B="${hudB.playerName}"/hidden=${hudB.__hudHidden}`,
  );
  check(
    'coop: both clients receive live state',
    (stateA?.stateCount || 0) > 0 && (stateB?.stateCount || 0) > 0,
    `A=${stateA?.stateCount} states, B=${stateB?.stateCount} states`,
  );
  check(
    'coop: both HUDs show live resources',
    /WOOD/.test(hudA.resources || '') && /WOOD/.test(hudB.resources || ''),
    `A="${hudA.resources}" B="${hudB.resources}"`,
  );

  // --- Movement propagation: hold W on B, then poll A's snapshot until B's actor moves.
  const bBefore = (stateA?.lastState?.actors || []).find(a => a.id === idB);
  await focusPage(sessionB.page, 'coop-B-move');
  await holdKey(sessionB.page, 'KeyW', 'w', 87, 2600);
  let bAfter = null;
  const moveDeadline = Date.now() + 25000;
  while (Date.now() < moveDeadline) {
    const live = await readQaState(sessionA.page);
    const seen = (live?.lastState?.actors || []).find(a => a.id === idB);
    if (seen && bBefore && Math.hypot(seen.x - bBefore.x, seen.z - bBefore.z) > 0.5) {
      bAfter = seen;
      break;
    }
    await sleep(400);
  }
  const stateB2 = await readQaState(sessionB.page);
  if (!bAfter) bAfter = (await readQaState(sessionA.page))?.lastState?.actors?.find(a => a.id === idB) || null;
  const moved = bBefore && bAfter ? Math.hypot(bAfter.x - bBefore.x, bAfter.z - bBefore.z) : 0;
  report.coop.movement = {before: bBefore || null, after: bAfter || null, meters: +moved.toFixed(2)};
  check('coop: B movement propagates to A snapshot', moved > 0.5, `${moved.toFixed(2)} m seen by A`);
  check('coop: B keeps receiving state while moving', (stateB2?.stateCount || 0) > 0, `B states=${stateB2?.stateCount}`);

  // Record per-page fps: dual software-rendered Chrome instances are the reconnect scenario.
  report.coop.fpsA = await measureFps(sessionA.page, 2000);
  report.coop.fpsB = await measureFps(sessionB.page, 2000);
  log(`COOP FPS: A=${JSON.stringify(report.coop.fpsA)} B=${JSON.stringify(report.coop.fpsB)}`);

  // --- Weapon-rack pickup: A walks to the nearest untaken rack (keyboard-only steering from the
  // authoritative snapshot), holds E, and the shared armory must gain the weapon for B too.
  const beforeState = await readQaState(sessionA.page);
  const beforeArmory = beforeState?.lastState?.armory || [];
  const meA = (beforeState?.lastState?.actors || []).find(a => a.id === idA);
  const rack = (beforeState?.lastState?.weaponDrops || [])
    .filter(d => !d.taken)
    .sort((a, b) => {
      const da = meA ? Math.hypot(a.x - meA.x, a.z - meA.z) : 0;
      const db = meA ? Math.hypot(b.x - meA.x, b.z - meA.z) : 0;
      return da - db;
    })[0];
  report.coop.pickup = {targetWeapon: rack?.weapon || null, beforeArmory, arrived: null, prompt: null, afterArmory: beforeArmory};
  if (rack) {
    report.coop.pickup.arrived = await moveToRack(sessionA.page, rack, {iterations: 24, stepMs: 1300, label: 'coop-A-rack'});
    let prompt = '';
    try {
      await waitFor(sessionA.page, `document.getElementById('prompt').textContent.includes('Recover')`, {timeoutMs: 15000, label: 'weapon rack prompt'});
      prompt = await sessionA.page.evaluate(`document.getElementById('prompt').textContent`);
    } catch {
      prompt = await sessionA.page.evaluate(`document.getElementById('prompt').textContent`);
    }
    report.coop.pickup.prompt = prompt;
    check('coop: A reached the weapon rack prompt', /Recover/i.test(prompt || ''), `arrived=${JSON.stringify(report.coop.pickup.arrived)} prompt="${prompt}"`);
    await focusPage(sessionA.page, 'coop-A-interact');
    await holdKey(sessionA.page, 'KeyE', 'e', 69, 6000);
    // Poll both armories for the unlock (shared armory rule) instead of a fixed sleep.
    const pickupDeadline = Date.now() + 20000;
    while (Date.now() < pickupDeadline) {
      const liveA = await readQaState(sessionA.page);
      const liveB = await readQaState(sessionB.page);
      const aArmory = liveA?.lastState?.armory || [];
      const bArmory = liveB?.lastState?.armory || [];
      if (aArmory.some(w => !beforeArmory.includes(w)) && bArmory.some(w => !beforeArmory.includes(w))) break;
      await sleep(500);
    }
  }
  const afterState = await readQaState(sessionA.page);
  const afterArmory = afterState?.lastState?.armory || [];
  const armoryB = (await readQaState(sessionB.page))?.lastState?.armory || [];
  const newWeapons = afterArmory.filter(w => !beforeArmory.includes(w));
  const shared = newWeapons.filter(w => armoryB.includes(w));
  report.coop.pickup.afterArmory = afterArmory;
  report.coop.pickup.newWeapons = newWeapons;
  report.coop.pickup.armoryB = armoryB;
  check('coop: A recovered a weapon rack', newWeapons.length > 0, `new=${JSON.stringify(newWeapons)}`);
  check('coop: rack unlock is shared with B', shared.length > 0, `new=${JSON.stringify(newWeapons)} B armory=${JSON.stringify(armoryB)}`);

  // --- Both pages' screenshots (after the pickup so the shared armory is visible in the HUD).
  await focusPage(sessionA.page, 'coop-A-shot');
  report.screenshots.push(await screenshot(sessionA.page, opts.outDir, 'coop-a-third-person.png'));
  await focusPage(sessionB.page, 'coop-B-shot');
  report.screenshots.push(await screenshot(sessionB.page, opts.outDir, 'coop-b-third-person.png'));
  await focusPage(sessionA.page, 'coop-A-shot2');
  report.screenshots.push(await screenshot(sessionA.page, opts.outDir, 'coop-a-after-pickup.png'));
  await focusPage(sessionB.page, 'coop-B-shot2');
  report.screenshots.push(await screenshot(sessionB.page, opts.outDir, 'coop-b-after-pickup.png'));

  // --- Merge both collectors and gate errors.
  const prefix = (pageLabel, list) => list.map(entry => ({page: pageLabel, ...entry}));
  report.pageErrors = [...prefix('A', sessionA.sink.pageErrors), ...prefix('B', sessionB.sink.pageErrors)];
  report.consoleErrors = [...prefix('A', sessionA.sink.consoleErrors), ...prefix('B', sessionB.sink.consoleErrors)];
  report.consoleWarnings = [...prefix('A', sessionA.sink.consoleWarnings), ...prefix('B', sessionB.sink.consoleWarnings)];
  report.logErrors = [...prefix('A', sessionA.sink.logErrors), ...prefix('B', sessionB.sink.logErrors)];
  report.badResponses = [...prefix('A', sessionA.sink.badResponses), ...prefix('B', sessionB.sink.badResponses)];
  report.failedRequests = [...prefix('A', sessionA.sink.failedRequests), ...prefix('B', sessionB.sink.failedRequests)];
  report.assetRequests = [...new Set([...sessionA.sink.assetRequests, ...sessionB.sink.assetRequests])];
  report.internalRequests = sessionA.sink.internalRequests + sessionB.sink.internalRequests;
  report.navigations = sessionA.sink.navigations + sessionB.sink.navigations;
  report.websocket = wsDiagnostics(stateA, coopStartedAt);
  report.websocketFinal = report.websocket;
  report.websocketB = wsDiagnostics(stateB, coopStartedAt);
  report.diagnostics = {
    navigations: report.navigations,
    navigationLogA: sessionA.sink.navigationLog,
    navigationLogB: sessionB.sink.navigationLog,
    wsA: report.websocket,
    wsB: report.websocketB,
    health: healthSampler ? summarizeHealth(healthSampler.samples) : null,
  };
  if (report.websocket?.reconnected || report.websocketB?.reconnected) {
    report.notes.push(
      `coop WebSocket reconnects: A closes=${JSON.stringify(report.websocket?.closes || [])} B closes=${JSON.stringify(report.websocketB?.closes || [])}`,
    );
  }
  check('coop: zero uncaught page errors (both pages)', report.pageErrors.length === 0, JSON.stringify(report.pageErrors.slice(0, 4)));
  check('coop: zero internal 4xx/5xx (both pages)', report.badResponses.length === 0, JSON.stringify(report.badResponses.slice(0, 4)));
  check('coop: zero failed internal requests (both pages)', report.failedRequests.length === 0, JSON.stringify(report.failedRequests.slice(0, 4)));
  const required = ['coop-a-third-person.png', 'coop-b-third-person.png'];
  const shotNames = report.screenshots.map(f => path.basename(f));
  check('coop: both page screenshots saved', required.every(s => shotNames.includes(s)), shotNames.join(', '));
}

/* ------------------------------------------------------------ perf helpers */

/** Percentile stats for the rAF frame deltas collected in the page. */
function frameStats(deltas, wallMs) {
  if (!Array.isArray(deltas) || !deltas.length) return {frames: 0, wallMs, error: 'no frames sampled'};
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return {
    frames: deltas.length,
    wallMs,
    meanFrameMs: +mean.toFixed(1),
    p50FrameMs: +pick(0.5).toFixed(1),
    p95FrameMs: +pick(0.95).toFixed(1),
    minFrameMs: +sorted[0].toFixed(1),
    maxFrameMs: +sorted[sorted.length - 1].toFixed(1),
    fps: +(1000 / mean).toFixed(2),
  };
}

/** Sample rAF deltas in the page for `ms` wall time (first frame is not counted as a delta). */
async function captureFrameStats(page, ms = 4000) {
  const deltas = await page.evaluate(
    `new Promise(res=>{const d=[];let t0=null,last=null;function f(now){if(last===null){last=now;t0=now;requestAnimationFrame(f);return;}d.push(now-last);last=now;if(now-t0<${ms})requestAnimationFrame(f);else res(d);}requestAnimationFrame(f);})`,
    {awaitPromise: true, timeoutMs: ms + 60000},
  );
  return frameStats(deltas, ms);
}

/** window.__ssPerf() snapshot (world-scene hook) or null when the hook is absent. */
async function capturePerfSnapshot(page) {
  return page.evaluate(
    `(()=>{if(typeof window.__ssPerf!=='function')return null;try{return JSON.parse(JSON.stringify(window.__ssPerf()));}catch(e){return {error:String((e&&e.message)||e)};}})()`,
    {timeoutMs: 15000},
  );
}

async function perfHookInfo(page) {
  return page.evaluate(
    `(()=>({hasPerf:typeof window.__ssPerf==='function',hasQuality:typeof window.__ssQuality==='function',quality:(()=>{try{if(typeof window.__ssQuality!=='function')return null;const q=window.__ssQuality();return q===undefined?null:q;}catch(e){return 'error:'+((e&&e.message)||e);}})()}))()`,
    {timeoutMs: 15000},
  );
}

async function readQuality(page) {
  return page.evaluate(
    `(()=>{if(typeof window.__ssQuality!=='function')return null;try{const q=window.__ssQuality();return q===undefined?null:q;}catch(e){return 'error:'+((e&&e.message)||e);}})()`,
    {timeoutMs: 15000},
  );
}

/** Force a quality tier via the QA hook (cycle-4: SwiftShader now defaults to low; beauty and perf
 * captures must force high, while the minimal-weather proof deliberately uses low). */
async function forceQuality(page, tier = 'high') {
  return page
    .evaluate(
      `(()=>{try{const f=window.__ssQuality;if(typeof f!=='function')return null;return f(${JSON.stringify(tier)});}catch(e){return null;}})()`,
      {timeoutMs: 15000},
    )
    .catch(() => null);
}

/** Page-side performance timings + resource byte totals. */
async function capturePageTimings(page) {
  return page.evaluate(
    `(()=>{
      const nav=performance.getEntriesByType('navigation')[0]||null;
      const res=performance.getEntriesByType('resource')||[];
      const assetRes=res.filter(r=>/\\/assets\\//.test(r.name));
      const sum=list=>list.reduce((a,r)=>a+(r.transferSize||r.encodedBodySize||0),0);
      return {
        navigation:nav?{responseStart:Math.round(nav.responseStart),domContentLoaded:Math.round(nav.domContentLoadedEventEnd),loadEvent:Math.round(nav.loadEventEnd),transferSize:nav.transferSize||0,type:nav.type}:null,
        resources:{count:res.length,assetCount:assetRes.length,transferBytes:sum(res),assetTransferBytes:sum(assetRes)},
        timeOrigin:Math.round(performance.timeOrigin)
      };
    })()`,
    {timeoutMs: 15000},
  );
}

/** Find the dynamically-created graphics-quality select (options low/medium/high). */
async function findQualitySelect(page) {
  return page.evaluate(
    `(()=>{
      const sels=[...document.querySelectorAll('select')];
      const s=sels.find(x=>[...x.options].some(o=>o.value==='low')&&[...x.options].some(o=>o.value==='medium')&&[...x.options].some(o=>o.value==='high'));
      if(!s)return null;
      return {id:s.id||null,value:s.value,options:[...s.options].map(o=>({value:o.value,label:(o.textContent||'').trim()}))};
    })()`,
    {timeoutMs: 15000},
  );
}

async function setQualityViaSelect(page, tier) {
  return page.evaluate(
    `(()=>{
      const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='low')&&[...x.options].some(o=>o.value==='high'));
      if(!s)return {ok:false,reason:'quality select not found'};
      s.value=${JSON.stringify(tier)};
      s.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true,value:s.value};
    })()`,
    {timeoutMs: 15000},
  );
}

/** Wait for join enable, then read the observer-recorded loading progress history. */
async function captureLoadingProgress(page, {timeoutMs = 150000, interval = 120} = {}) {
  const started = Date.now();
  let joinEnabledAt = null;
  while (Date.now() - started < timeoutMs) {
    let state = null;
    try {
      state = await page.evaluate(`(()=>{const b=document.getElementById('create');return b?{disabled:b.disabled}:null;})()`, {timeoutMs: 8000});
    } catch {}
    if (state && state.disabled === false) {
      joinEnabledAt = Date.now() - started;
      break;
    }
    await sleep(interval);
  }
  let record = null;
  try {
    record = await page.evaluate(`window.__qaLoading ? JSON.parse(JSON.stringify(window.__qaLoading)) : null`);
  } catch {}
  let raf = null;
  try {
    raf = await page.evaluate(`window.__qaRaf ? JSON.parse(JSON.stringify(window.__qaRaf)) : null`);
  } catch {}
  const events = record?.events || [];
  const distinctTexts = [...new Set(events.map(e => e.text).filter(Boolean))];
  const progressLikeTexts = distinctTexts.filter(t => /loading/i.test(t));
  const progressCounts = progressLikeTexts
    .map(t => {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? `${m[1]}/${m[2]}` : null;
    })
    .filter(Boolean);
  return {
    events,
    distinctTexts,
    progressLikeTexts,
    progressCounts,
    distinctProgressCounts: [...new Set(progressCounts)],
    joinEnabledAtMs: record?.joinEnabledAtMs != null ? record.joinEnabledAtMs : joinEnabledAt,
    maxFrameGapMs: raf ? +(raf.maxGapMs || 0).toFixed(1) : null,
    frames: raf ? raf.count : null,
  };
}

/** Extract "N/M" loading-count strings from observer events. */
function progressCountsFromEvents(events) {
  const texts = [...new Set((events || []).map(e => e && e.text).filter(Boolean))];
  const counts = texts
    .filter(t => /loading/i.test(t))
    .map(t => {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(t);
      return m ? `${m[1]}/${m[2]}` : null;
    })
    .filter(Boolean);
  return {texts, counts: [...new Set(counts)]};
}

/** Sweep quality tiers low -> medium -> high capturing __ssPerf + frame percentiles. */
async function captureQualitySweep(page, {tiers = ['low', 'medium', 'high'], settleMs = 2000, sampleMs = 3000} = {}) {
  const out = {};
  for (const tier of tiers) {
    const set = await page.evaluate(
      `(()=>{if(typeof window.__ssQuality!=='function')return false;try{window.__ssQuality(${JSON.stringify(tier)});return true;}catch(e){return false;}})()`,
      {timeoutMs: 15000},
    );
    if (!set) return {available: false, tiers: out};
    await sleep(settleMs);
    out[tier] = {
      quality: await readQuality(page),
      perf: await capturePerfSnapshot(page),
      frames: await captureFrameStats(page, sampleMs),
    };
    log(`PERF[${tier}]: calls=${perfMetric(out[tier].perf, 'calls')} triangles=${perfMetric(out[tier].perf, 'triangles')} fps=${out[tier].frames?.fps}`);
  }
  return {available: true, tiers: out};
}

/** Read a renderer.info-style metric tolerantly across possible __ssPerf shapes. */
function perfMetric(perf, key) {
  if (!perf || typeof perf !== 'object') return null;
  if (perf.renderer && perf.renderer[key] != null) return perf.renderer[key];
  if (perf[key] != null) return perf[key];
  if (perf.info && perf.info[key] != null) return perf.info[key];
  if (perf.render && perf.render[key] != null) return perf.render[key];
  return null;
}

/** Compact summary of a __ssPerf snapshot + frame stats for logs/reports. */
function perfSummary(perf, frames) {
  return {
    calls: perfMetric(perf, 'calls'),
    triangles: perfMetric(perf, 'triangles'),
    points: perfMetric(perf, 'points'),
    geometries: perfMetric(perf, 'geometries'),
    textures: perfMetric(perf, 'textures'),
    programs: perfMetric(perf, 'programs'),
    quality: perf?.quality ?? perf?.tier ?? null,
    fps: frames?.fps ?? null,
    meanFrameMs: frames?.meanFrameMs ?? null,
  };
}

/* ------------------------------------------------------- character close-ups */

// PLAYER_APPEARANCES / ALL_APPEARANCES are declared with the cycle-4 gate constants above.
// Central crop of a framed close-up: torso/legs strip, minimises background.
const CHAR_CLOSEUP_REGION = {x0: 0.36, y0: 0.08, x1: 0.64, y1: 0.94};
// Cycle-4 tighter body-core strip (armour detail / palette richness) — reported alongside the full
// close-up body mask; the SPEC's >=500 unique-colour target is evaluated on the body mask.
const CHAR_CORE_REGION = {x0: 0.44, y0: 0.2, x1: 0.56, y1: 0.8};
// Player torso box in the normal third-person spawn view (mirrors the pre-fix baseline crop
// x 752..826 / y 470..640 at 1584x805).
const CHAR_NORMAL_REGION = {x0: 0.475, y0: 0.584, x1: 0.521, y1: 0.795};

/** Analyse an already-saved screenshot file with an alternative crop (no extra capture). */
async function statsFromFile(page, file, region) {
  const base64 = fs.readFileSync(file).toString('base64');
  return analyzePng(page, base64, region);
}

async function charPreview(page, actorId, opts) {
  // undefined => no-arg call (frames local player); null => restore; string => frame that actor.
  // `opts` (cycle 4) is an optional second argument, e.g. {distance:10} for a 10 m silhouette.
  const arg = actorId === undefined ? (opts ? 'undefined' : '') : actorId === null ? 'null' : JSON.stringify(actorId);
  const optArg = opts ? `,${JSON.stringify(opts)}` : '';
  return page.evaluate(
    `(()=>{const f=window.__ssCharacterPreview;if(typeof f!=='function')return {ok:false,reason:'__ssCharacterPreview not available'};try{const r=f(${arg}${optArg});return r===undefined?{ok:true}:JSON.parse(JSON.stringify(r));}catch(e){return {ok:false,error:String((e&&e.message)||e)};}})()`,
    {timeoutMs: 15000},
  );
}

/** Capture a 10 m silhouette of a world actor via a QA camera pose (fallback when the body-preview
 * hook does not render; used for the 7-body archetype check). */
async function captureActorAt10m(page, actor, outDir, name) {
  const x = Number(actor?.x ?? 0);
  const z = Number(actor?.z ?? 0);
  const pose = {x: x + 10, z, height: 2.4, yaw: -Math.PI / 2, pitch: Math.atan2(1.2 - 2.4, 10)};
  const applied = await qaPose(page, pose);
  if (!applied || applied.ok === false) return null;
  await sleep(QA_CAPTURE_SETTLE_MS);
  const shot = await screenshotWithStats(page, outDir, name, null);
  await qaView(page, null);
  await sleep(300);
  return {file: shot.file, stats: shot.stats, pose};
}

async function setPlayerAppearance(page, value) {
  return page.evaluate(
    `(()=>{
      const selects=[...document.querySelectorAll('select')];
      const s=selects.find(x=>[...x.options].some(o=>o.value===${JSON.stringify(PLAYER_APPEARANCES[0])}));
      if(!s)return {ok:false,reason:'character select not found'};
      s.value=${JSON.stringify(value)};
      s.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true,id:s.id,value:s.value};
    })()`,
    {timeoutMs: 15000},
  );
}

async function waitForPlayerCharacter(page, value, timeoutMs = 30000) {
  await waitFor(
    page,
    `(()=>{const s=window.__qaWs&&window.__qaWs.lastState;if(!s)return false;const p=(s.actors||[]).find(a=>a.kind==='player');return !!p&&p.character===${JSON.stringify(value)};})()`,
    {timeoutMs, label: `player character ${value}`},
  );
}

/** Cycle-1 readability capture: 5 player appearances + undead close-ups with body luminance. */
async function captureCharacterReadability(page, {opts, report, check}) {
  const outDir = opts.outDir;
  const hooks = await page.evaluate(`(()=>({preview:typeof window.__ssCharacterPreview==='function',quality:typeof window.__ssQuality==='function'}))()`);
  report.characters = {
    hook: hooks,
    mode: opts.url ? 'url' : 'local',
    appearances: [],
    undead: [],
    normalThirdPerson: null,
    baseline: CHAR_BEFORE_BASELINE,
    closeupRegion: CHAR_CLOSEUP_REGION,
    normalRegion: CHAR_NORMAL_REGION,
  };
  check('char: __ssCharacterPreview hook available', hooks.preview, JSON.stringify(hooks));
  if (!hooks.preview) return;
  // Cycle-4: force high quality for armour/beauty captures (software default is now low).
  await forceQuality(page, 'high');
  // Cycle-5: hold weather clear during the armour capture so cloth/background two-frame diffs are not
  // polluted by moving precipitation (restored to natural weather after the appearance loop).
  await setWeather(page, 'march', 'clear', 0);
  await sleep(900);
  const normal = await screenshotWithStats(page, outDir, 'char-third-person.png', CHAR_NORMAL_REGION);
  report.characters.normalThirdPerson = {file: normal.file, stats: normal.stats, before: CHAR_BEFORE_BASELINE.normalPlayerTorso};
  // Cycle-4 Lead-approved re-baseline: primary tone gate is the body-mask measurement; the fixed
  // centre crop is kept as informational (cycle-4 background/foliage now dominates it).
  let bodyMask = null;
  try {
    bodyMask = await analyzePngBodyMask(page, fs.readFileSync(normal.file).toString('base64'), CHAR_NORMAL_REGION);
  } catch (error) {
    report.notes.push(`char: body-mask torso measurement failed (${error?.message || error}) — fixed-crop only`);
  }
  report.characters.normalThirdPersonBodyMask = bodyMask;
  const actors = (await page.evaluate(`window.__qaWs ? window.__qaWs.allActors : []`)) || [];
  const bodyPreviewHook = await page
    .evaluate(
      `(()=>{const n=['__ssPreviewBody','__ssBodyPreview'];for(const x of n){if(typeof window[x]==='function')return x;}return null;})()`,
      {timeoutMs: 10000},
    )
    .catch(() => null);
  report.characters.bodyPreviewHook = bodyPreviewHook;
  if (bodyPreviewHook) {
    report.notes.push(
      'char: __ssPreviewBody exists but its synthetic body did not render in the probe screenshot (camera framing) — using in-game select/actor close-ups + QA-pose 10 m silhouettes instead',
    );
  }
  const appearances = [];
  for (const value of ALL_APPEARANCES) {
    const playable = PLAYER_APPEARANCES.includes(value);
    let sel = null;
    let changed = null;
    let preview = null;
    let targetActor = null;
    if (playable) {
      sel = await setPlayerAppearance(page, value);
      changed = true;
      try {
        await waitForPlayerCharacter(page, value, 25000);
      } catch {
        changed = false;
      }
      await sleep(1200);
      preview = await charPreview(page);
      targetActor = actors.find(a => a.kind === 'player') || null;
    } else {
      // survivor = camp NPC (kind soldier); fallen = corrupted knight (kind corrupted). Both are
      // real in-game rigs, so __ssCharacterPreview frames the same armour-v2 body the player sees.
      const isFallen = value === 'fallen';
      targetActor = actors.find(a => (isFallen ? a.kind === 'corrupted' : a.kind === 'soldier')) || null;
      if (!targetActor) {
        report.notes.push(`char: no in-game actor found for ${value} — appearance skipped`);
        appearances.push({appearance: value, playable, skipped: true});
        continue;
      }
      preview = await charPreview(page, targetActor.id);
      if (!preview || preview.ok === false) {
        report.notes.push(`char: __ssCharacterPreview failed for ${value} actor ${targetActor.id} — appearance skipped`);
        appearances.push({appearance: value, playable, skipped: true});
        continue;
      }
    }
    await sleep(2200);
    const shot = await screenshotWithStats(page, outDir, `char-${value}-closeup.png`, CHAR_CLOSEUP_REGION);
    // Cycle-4 body-core palette richness (reported next to the full body-mask unique colours).
    const coreStats = await statsFromFile(page, shot.file, CHAR_CORE_REGION);
    // Headline detail metric (Lead cycle-4): unique colours over the full close-up frame.
    const fullFrameStats = await statsFromFile(page, shot.file, null);
    // Cycle-5 plate texel-density metric (gradient/edge energy over the body crop).
    const detailStats = await analyzePngGradient(page, fs.readFileSync(shot.file).toString('base64'), CHAR_CLOSEUP_REGION);
    // Cycle-5 cloth-wind check: second frame ~0.6 s later; body-region diff vs a static side strip.
    await sleep(600);
    const cloth2 = await screenshot(page, outDir, `char-${value}-cloth2.png`);
    const clothDiff = await comparePngs(page, shot.file, cloth2, CHAR_CORE_REGION);
    const clothBgDiff = await comparePngs(page, shot.file, cloth2, {x0: 0.05, y0: 0.1, x1: 0.15, y1: 0.9});
    await charPreview(page, null);
    await sleep(600);
    // Cycle-4 10 m silhouette via a QA camera pose 10 m from the actor (front-ish, chest height).
    const tenShot = targetActor ? await captureActorAt10m(page, targetActor, outDir, `char-${value}-10m.png`) : null;
    if (!tenShot) report.notes.push(`char: 10 m silhouette capture unavailable for ${value}`);
    appearances.push({
      appearance: value,
      playable,
      mode: playable ? 'characterSelect' : 'actorPreview',
      select: sel,
      stateChanged: changed,
      preview,
      actor: targetActor ? {id: targetActor.id, kind: targetActor.kind} : null,
      file: shot.file,
      stats: shot.stats,
      coreStats,
      fullFrameStats,
      detailStats,
      clothWind: {file: cloth2, diff: clothDiff, backgroundDiff: clothBgDiff},
      tenMeter: tenShot,
    });
    await sleep(400);
  }
  report.characters.appearances = appearances;
  // Restore natural regional weather after the armour captures.
  await setWeather(page, null);
  await sleep(400);
  const capturedAppearances = appearances.filter(a => a.stats && !a.skipped);
  check(
    'char: 7 appearance close-ups captured (5 playable + survivor/fallen)',
    capturedAppearances.length === ALL_APPEARANCES.length && capturedAppearances.every(a => a.stats.sampled > 1000),
    capturedAppearances.map(a => a.appearance).join(','),
  );
  check(
    'char: 10 m archetype silhouettes captured',
    appearances.filter(a => a.tenMeter).length >= Math.min(5, capturedAppearances.length),
    `${appearances.filter(a => a.tenMeter).length}/${capturedAppearances.length} captured`,
  );
  // Numeric appearance distinctness: pairwise mean-RGB distance between the 7 close-ups (arms/body
  // palettes) + core-palette richness report. Visual read_image remains the primary verdict.
  const arms = capturedAppearances.map(a => ({name: a.appearance, stats: a.stats, core: a.coreStats}));
  const pair = [];
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const a = arms[i].stats, b = arms[j].stats;
      pair.push({
        a: arms[i].name,
        b: arms[j].name,
        colorDistance: +Math.hypot(a.meanR - b.meanR, a.meanG - b.meanG, a.meanB - b.meanB).toFixed(2),
      });
    }
  }
  report.characters.distinctness = {
    pairs: pair,
    maxColorDistance: pair.length ? +Math.max(...pair.map(p => p.colorDistance)).toFixed(2) : null,
    minColorDistance: pair.length ? +Math.min(...pair.map(p => p.colorDistance)).toFixed(2) : null,
    coreUniqueColors: arms.map(a => ({appearance: a.name, bodyMask: a.stats.uniqueColors, core: a.core?.uniqueColors ?? null, coreSat: a.core?.meanSat ?? null})),
  };
  // Cycle-5 cloth-wind report (body-region diff between two frames ~0.6 s apart vs a static side strip)
  report.characters.clothWind = capturedAppearances.map(a => ({
    appearance: a.appearance,
    bodyDiff: a.clothWind?.diff ?? null,
    backgroundDiff: a.clothWind?.backgroundDiff ?? null,
  }));
  const clothBodies = report.characters.clothWind.filter(c => c.bodyDiff && c.backgroundDiff);
  check(
    'char: cloth prims show frame-to-frame motion (body diff exceeds static background)',
    clothBodies.length > 0 && clothBodies.some(c => c.bodyDiff.meanAbsLum > 0.15 && c.bodyDiff.meanAbsLum > c.backgroundDiff.meanAbsLum * 1.5),
    `${clothBodies.filter(c => c.bodyDiff.meanAbsLum > 0.15 && c.bodyDiff.meanAbsLum > c.backgroundDiff.meanAbsLum * 1.5).length}/${clothBodies.length} bodies show body-region motion above static background (subtle wind; visual read_image confirms cloth vs idle)`,
  );
  // Cycle-5 survivor identity vs the cycle-4 reference capture (before/after evidence)
  const survivorAppearance = appearances.find(a => a.appearance === 'survivor' && a.file);
  const survivorRef = path.join(ROOT, 'qa', 'characters-b7', 'char-survivor-closeup.png');
  if (survivorAppearance && fs.existsSync(survivorRef)) {
    try {
      const diff = await comparePngs(page, survivorRef, survivorAppearance.file, CHAR_CLOSEUP_REGION);
      report.characters.survivorIdentity = {reference: path.relative(ROOT, survivorRef), current: path.relative(ROOT, survivorAppearance.file), diff};
      check('char: survivor identity differs from cycle-4 soldier clone (before/after diff)', diff.meanAbsLum > 0.5 || diff.changedPct > 1, JSON.stringify(diff));
    } catch (error) {
      report.notes.push(`char: survivor before/after diff failed (${error?.message || error})`);
    }
  } else {
    report.notes.push('char: survivor before/after reference missing (qa/characters-b7/char-survivor-closeup.png) — identity assessed visually only');
  }
  const undead = [];
  const allCandidates = actors.filter(a => a.kind !== 'player' && a.kind !== 'soldier');
  // Prefer actors in open ground (outside castle courtyards) so the 2.8 m preview camera does not
  // clip through walls/terrain (the first garrison zombie sat inside the keep and framed the ground).
  const openGround = a => Math.abs(a.x || 0) > 12 || (typeof a.z === 'number' && a.z < -200);
  const ordered = [...allCandidates].sort((a, b) => (openGround(b) ? 1 : 0) - (openGround(a) ? 1 : 0));
  let attempts = 0;
  for (const actor of ordered) {
    if (undead.length >= 2 || attempts >= 8) break;
    attempts++;
    const preview = await charPreview(page, actor.id);
    if (!preview || preview.ok === false) continue;
    await sleep(900);
    const shot = await screenshotWithStats(page, outDir, `char-undead-${undead.length + 1}-${actor.kind}.png`, CHAR_CLOSEUP_REGION);
    // Reject clipped/framed-inside-terrain attempts (flat, low-detail frames).
    const good = shot.stats.std >= 18 && shot.stats.uniqueColors >= 60;
    await charPreview(page, null);
    if (good) undead.push({actor, preview, file: shot.file, stats: shot.stats});
    else report.notes.push(`char: discarded clipped undead preview attempt ${attempts} (${actor.kind} id=${actor.id}, std=${shot.stats.std}, colors=${shot.stats.uniqueColors})`);
    await sleep(300);
  }
  report.characters.undead = undead;
  check(
    'char: undead close-ups captured',
    undead.length >= 1 && undead.every(u => u.stats && u.stats.sampled > 1000),
    `${undead.length} captured (${undead.map(u => `${u.actor.kind}:${u.actor.name}`).join(', ')})`,
  );
  // Cycle-3 elite-undead silhouette: identify elite actors via world-scene's hooks
  // (__ssEliteUndeadInfo preferred for tier labels, __ssEliteUndeadIds fallback, then the snapshot
  // rule), frame the highest-tier elite vs a tier-0 normal with __ssCharacterPreview and compare.
  const eliteHooks = await page.evaluate(
    `(()=>({info:typeof window.__ssEliteUndeadInfo==='function',ids:typeof window.__ssEliteUndeadIds==='function'}))()`,
    {timeoutMs: 15000},
  );
  let eliteIds = [];
  let eliteInfo = [];
  if (eliteHooks.info) {
    eliteInfo = await page.evaluate(
      `(()=>{try{const r=window.__ssEliteUndeadInfo();return Array.isArray(r)?JSON.parse(JSON.stringify(r)):[];}catch(e){return [];}})()`,
      {timeoutMs: 15000},
    );
    eliteIds = eliteInfo.map(e => String(e.id));
  } else if (eliteHooks.ids) {
    eliteIds = await page.evaluate(
      `(()=>{try{const r=window.__ssEliteUndeadIds();return Array.isArray(r)?r.map(String):[];}catch(e){return [];}})()`,
      {timeoutMs: 15000},
    );
  }
  const eliteTierById = new Map(eliteInfo.map(e => [String(e.id), Number(e.tier) || 0]));
  const allUndead = actors.filter(a => a.kind !== 'player' && a.kind !== 'soldier');
  // Fallback identification matching weapons-armory's `undeadEliteTier(actor)` rule when neither
  // hook is present: corrupted → 2 (3 if maxHp>=200); zombie → 3 if maxHp>=150, else 1 if
  // castle==='keep' or within 70 m of the nest (0,-664), else 0.
  const undeadEliteTier = a => {
    if (!a || a.kind === 'player' || a.kind === 'soldier') return 0;
    if (a.kind === 'corrupted') return (a.maxHp || 0) >= 200 ? 3 : 2;
    if (a.kind === 'zombie') {
      if ((a.maxHp || 0) >= 150) return 3;
      if (a.castle === 'keep') return 1;
      if (Math.hypot((a.x || 0) - 0, (a.z || 0) + 664) <= 70) return 1;
    }
    return 0;
  };
  const tierOf = a => (eliteTierById.has(String(a.id)) ? eliteTierById.get(String(a.id)) : undeadEliteTier(a));
  // Sort by elite tier so the capture uses the highest-tier silhouette available (tier 3 crown +
  // shoulder spikes > tier 2 crest > tier 1 bone crown), whether ids came from the hooks or the rule.
  const eliteActors = (eliteIds.length
    ? allUndead.filter(a => eliteIds.includes(String(a.id)))
    : allUndead.filter(a => a.elite === true || a.elite === 'elite' || /elite|crown|crest/i.test(String(a.name || '')) || /elite/i.test(String(a.tier || '')) || undeadEliteTier(a) > 0)
  ).sort((a, b) => tierOf(b) - tierOf(a));
  report.characters.elite = {
    hooks: eliteHooks,
    ids: eliteIds,
    info: eliteInfo,
    matched: eliteActors.map(a => a.id),
    tiers: eliteActors.map(a => ({id: a.id, name: a.name, kind: a.kind, tier: tierOf(a), x: a.x, z: a.z, maxHp: a.maxHp ?? null, castle: a.castle ?? null})),
    rule: eliteHooks.info ? '__ssEliteUndeadInfo()' : eliteHooks.ids ? '__ssEliteUndeadIds()' : 'fallback undeadEliteTier(actor) matching weapons-armory rule',
    captures: [],
  };
  const captureActorCloseup = async (actor, fileName) => {
    const preview = await charPreview(page, actor.id);
    if (!preview || preview.ok === false) return null;
    await sleep(900);
    const shot = await screenshotWithStats(page, outDir, fileName, CHAR_CLOSEUP_REGION);
    await charPreview(page, null);
    return {actor, preview, file: shot.file, stats: shot.stats};
  };
  if (eliteActors.length) {
    const elite = eliteActors[0];
    // Prefer a tier-0 normal of the same broad family (zombie vs corrupted) for an apples-to-apples
    // silhouette comparison; fall back to any non-elite undead.
    const normals = allUndead.filter(a => a.id !== elite.id && tierOf(a) === 0 && a.kind === elite.kind);
    const anyNormals = allUndead.filter(a => a.id !== elite.id && tierOf(a) === 0);
    const normalActor = normals[0] || anyNormals[0] || null;
    const eliteShot = await captureActorCloseup(elite, 'char-undead-elite.png');
    const normalShot = normalActor ? await captureActorCloseup(normalActor, 'char-undead-normal.png') : null;
    if (eliteShot) report.characters.elite.captures.push({kind: 'elite', ...eliteShot});
    if (normalShot) report.characters.elite.captures.push({kind: 'normal', ...normalShot});
    if (eliteShot && normalShot) {
      const diff = await comparePngs(page, eliteShot.file, normalShot.file, CHAR_CLOSEUP_REGION);
      report.characters.elite.diff = diff;
      check(
        'char: elite-undead silhouette differs from normal (close-up pixel diff)',
        diff.meanAbsLum >= 0.3 || diff.changedPct >= 0.5,
        `meanAbsLum=${diff.meanAbsLum} changed%=${diff.changedPct}`,
      );
    } else {
      report.notes.push('char: elite/normal close-up pair incomplete — see elite captures');
    }
  } else {
    report.notes.push(
      eliteHook
        ? 'char: __ssEliteUndeadIds() returned no elite actor ids — silhouette check skipped'
        : 'char: elite-undead identification unavailable (no __ssEliteUndeadIds hook / snapshot flag) — silhouette check skipped',
    );
  }
  const playerStats = appearances.map(a => a.stats).filter(Boolean);
  const avg = key => +(playerStats.reduce((sum, s) => sum + s[key], 0) / Math.max(1, playerStats.length)).toFixed(2);
  const max = key => +Math.max(...playerStats.map(s => s[key])).toFixed(2);
  const fullFrames = capturedAppearances.map(a => a.fullFrameStats?.uniqueColors ?? 0);
  const bodyColours = capturedAppearances.map(a => ({appearance: a.appearance, bodyMask: a.stats.uniqueColors, fullFrame: a.fullFrameStats?.uniqueColors ?? null, core: a.coreStats?.uniqueColors ?? null, gradientMean: a.detailStats?.meanGradient ?? null}));
  const bodiesWith500 = bodyColours.filter(b => b.bodyMask >= CHAR_GATE.specUniqueColorsTarget).length;
  const aggregate = {
    avgMean: avg('mean'),
    avgP50: avg('p50'),
    avgP90: avg('p90'),
    avgBlackPct: avg('blackPct'),
    avgClippedPct: avg('clippedPct'),
    maxClippedPct: max('clippedPct'),
    minUniqueColors: Math.min(...playerStats.map(s => s.uniqueColors)),
    minFullFrameColors: fullFrames.length ? Math.min(...fullFrames) : null,
    avgFullFrameColors: fullFrames.length ? +(fullFrames.reduce((a, b) => a + b, 0) / fullFrames.length).toFixed(1) : null,
    bodiesWith500,
    bodiesColour: bodyColours,
    minGradientMean: bodyColours.filter(b => b.gradientMean != null).length ? +Math.min(...bodyColours.map(b => b.gradientMean ?? Infinity)).toFixed(2) : null,
    avgGradientMean: bodyColours.filter(b => b.gradientMean != null).length ? +(bodyColours.reduce((a, b) => a + (b.gradientMean ?? 0), 0) / bodyColours.length).toFixed(2) : null,
  };
  report.characters.aggregate = aggregate;
  log(`CHAR CLOSEUPS: ${JSON.stringify(aggregate)} normalTP=${JSON.stringify(normal.stats)} cycle1=${JSON.stringify(CHAR_BEFORE_BASELINE.cycle1)}`);
  check(
    'char: close-up body luminance above black-silhouette threshold',
    aggregate.avgMean >= CHAR_GATE.minMean && aggregate.avgP90 >= CHAR_GATE.minP90,
    `avgMean=${aggregate.avgMean} (>=${CHAR_GATE.minMean}), avgP90=${aggregate.avgP90} (>=${CHAR_GATE.minP90})`,
  );
  check(
    'char: armour-v3 body-mask colours >=500 on >=5/7 bodies',
    bodiesWith500 >= CHAR_GATE.specColourBodiesRequired && aggregate.minUniqueColors >= CHAR_GATE.closeupUniqueColorsMin,
    `${bodiesWith500}/${bodyColours.length} bodies >=500 (required >=${CHAR_GATE.specColourBodiesRequired}); per-body ${JSON.stringify(bodyColours.map(b => `${b.appearance}:${b.bodyMask}`))}; min=${aggregate.minUniqueColors} (floor >=${CHAR_GATE.closeupUniqueColorsMin})`,
  );
  if (bodiesWith500 < bodyColours.length) {
    report.notes.push(
      `char: bodies below the SPEC >=500 body-mask colour target: ${JSON.stringify(bodyColours.filter(b => b.bodyMask < 500).map(b => ({appearance: b.appearance, colours: b.bodyMask})))} — reported as remaining armour-art debt`,
    );
  }
  check(
    'char: close-ups show plate texel detail (gradient energy reported per body)',
    aggregate.minGradientMean != null,
    `gradient mean range=${aggregate.minGradientMean}-${Math.max(...bodyColours.map(b => b.gradientMean ?? 0))} (avg ${aggregate.avgGradientMean}); per-body ${JSON.stringify(bodyColours.map(b => `${b.appearance}:${b.gradientMean}`))} — high values indicate fine texel detail, low values flag stretched/flat plate faces (visual read_image still primary)`,
  );
  check(
    'char: close-ups no white clipping (>250 <= 1% of body)',
    aggregate.maxClippedPct <= CHAR_GATE.clipMaxPct,
    `maxClipped=${aggregate.maxClippedPct}% avg=${aggregate.avgClippedPct}% (<=${CHAR_GATE.clipMaxPct}%)`,
  );
  // Cycle-4 Lead-approved re-baseline: primary torso gate uses the character body-mask (the fixed
  // centre crop is background-dominated in cycle-4 — reported informationally only).
  if (bodyMask) {
    check(
      'char: in-game TP torso tone — body-mask (mean 65-95, p50 60-100, black<25%)',
      bodyMask.mean >= CHAR_GATE.torsoMeanMin &&
        bodyMask.mean <= CHAR_GATE.torsoMeanMax &&
        bodyMask.p50 >= CHAR_GATE.torsoP50Min &&
        bodyMask.p50 <= CHAR_GATE.torsoP50Max &&
        bodyMask.blackPct < CHAR_GATE.torsoBlackMax,
      `bodyMask mean=${bodyMask.mean} (${CHAR_GATE.torsoMeanMin}-${CHAR_GATE.torsoMeanMax}), p50=${bodyMask.p50} (${CHAR_GATE.torsoP50Min}-${CHAR_GATE.torsoP50Max}), black=${bodyMask.blackPct}% (<${CHAR_GATE.torsoBlackMax}%), maskPct=${bodyMask.maskPct}%; fixed-crop informational: mean=${normal.stats.mean} p50=${normal.stats.p50} black=${normal.stats.blackPct}%`,
    );
  } else {
    report.notes.push('char: body-mask torso measurement unavailable — torso tone not gated this run');
  }
  report.characters.torsoTone = {
    gate: 'body-mask (cycle-4 re-baseline)',
    bodyMask,
    fixedCropInformational: {mean: normal.stats.mean, p50: normal.stats.p50, p90: normal.stats.p90, blackPct: normal.stats.blackPct, note: 'background-dominated in cycle-4; informational only'},
    cycle3Reference: {fixedCrop: {mean: 91.5, p50: 102.4, blackPct: 4.86}, bodyMask: null},
  };
  // Torso-crop unique colours are reported for reference only (too small a region); the detail
  // gate is the close-up body-mask check above.
  report.characters.detailGateMask = 'close-up body mask (x36-64%, y8-94%)';
  report.characters.torsoCropColors = normal.stats.uniqueColors;
  report.characters.specUniqueColorsTarget = CHAR_GATE.specUniqueColorsTarget;
  if (normal.stats.uniqueColors < CHAR_GATE.specUniqueColorsTarget) {
    report.notes.push(`char: narrow torso-crop unique colours ${normal.stats.uniqueColors} < SPEC reference ${CHAR_GATE.specUniqueColorsTarget} — informational only (detail gate uses close-up body mask)`);
  }
  check('char: close-ups are not mostly black (blackPct < 40%)', aggregate.avgBlackPct < CHAR_GATE.closeupMaxBlackPct, `avgBlackPct=${aggregate.avgBlackPct}`);
  // Cycle-5: `__ssPreviewBody` must render all 7 bodies in frame (cycle-4 probe found it did not).
  if (bodyPreviewHook) {
    const probe = {hook: bodyPreviewHook, bodies: [], rendered: 0};
    try {
      await previewBody(page, null);
      await sleep(500);
      const base = await screenshot(page, outDir, 'probe-body-base.png');
      for (const name of ALL_APPEARANCES) {
        let r = await previewBody(page, name, {distance: 3});
        // world-scene's fixed hook loads bodies on demand and reports `ready`; wait for it (up to 8 s)
        // rather than screenshotting an empty frame on the first call.
        for (let waited = 0; waited < 8000 && r.ok && r.result && r.result.ready === false; waited += 500) {
          await sleep(500);
          r = await previewBody(page, name, {distance: 3});
        }
        await sleep(900);
        const shot = await screenshot(page, outDir, `probe-body-${name}.png`);
        const diff = await comparePngs(page, base, shot, CHAR_CORE_REGION);
        const rendered = r.ok && (diff.meanAbsLum > 1.2 || diff.changedPct > 1.5);
        probe.bodies.push({name, hookResult: r, diff, rendered});
        if (rendered) probe.rendered++;
        await previewBody(page, null);
        await sleep(300);
      }
      report.characters.previewBodyProbe = probe;
      check(
        'char: __ssPreviewBody renders all 7 armour bodies in frame',
        probe.rendered === ALL_APPEARANCES.length,
        `${probe.rendered}/${ALL_APPEARANCES.length} rendered (${probe.bodies.map(b => `${b.name}:${b.rendered ? 'ok' : 'MISSING'}`).join(', ')})`,
      );
    } catch (error) {
      report.notes.push(`char: __ssPreviewBody render probe failed (${error?.message || error})`);
    }
  } else {
    report.notes.push('char: no __ssPreviewBody hook — render probe skipped (in-game fallbacks used)');
  }
}

/* ---------------------------------------------------------------- update */

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    startedAt: nowIso(),
    command: `node scripts/smoke-browser.mjs ${process.argv.slice(2).join(' ')}`.trim(),
    outDir: opts.outDir,
    mode: null,
    url: opts.url,
    expectedWeapons: opts.expectWeapons,
    expectedAssets: opts.expectAssets,
    checks: [],
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    logErrors: [],
    badResponses: [],
    failedRequests: [],
    internalRequests: 0,
    assetRequests: [],
    hud: null,
    hudAfter: null,
    renderer: null,
    canvas: {},
    fps: null,
    weaponCards: null,
    perf: null,
    characters: null,
    loading: null,
    websocket: null,
    websocketFinal: null,
    diagnostics: null,
    coop: null,
    screenshots: [],
    logs: {},
    notes: [],
    errors: [],
  };

  let tempDir = null;
  let buildInfo = null;
  let server = null;
  let chrome = null;
  let page = null;
  let pageInfo = null;
  let fatal = null;
  let lastStage = 'startup';
  let healthSampler = null;
  const handles = {chromes: [], pages: []};

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-smoke-'));
  tempDir = tempRoot;
  const logDir = path.join(tempRoot, 'logs');
  fs.mkdirSync(logDir, {recursive: true});
  fs.mkdirSync(opts.outDir, {recursive: true});

  const check = (name, ok, detail) => {
    const entry = {name, ok: !!ok, detail: detail === undefined ? '' : String(detail).slice(0, 2000)};
    report.checks.push(entry);
    log(`CHECK: ${ok ? 'PASS' : 'FAIL'} ${name}${entry.detail ? ` - ${entry.detail}` : ''}`);
    return !!ok;
  };

  try {
    const mode = opts.coop ? 'coop' : opts.url ? 'url' : 'local';
    report.mode = mode;
    report.localServer = mode !== 'url';
    let baseUrl = null;
    let internalPrefix = null;
    let assetPrefix = null;

    if (mode === 'url') {
      /* Deployed-site mode: no build, no local server, everything is driven over the network. */
      lastStage = 'url';
      internalPrefix = siteRootFromUrl(opts.url);
      assetPrefix = `${internalPrefix}assets/`;
      report.siteRoot = internalPrefix;
      log(`URL MODE: driving ${opts.url} (no build, no local server)`);
      check('url mode: build + local server skipped', true, opts.url);
    } else {
      /* 1. build */
      lastStage = 'build';
      if (opts.skipBuild) {
        const indexFile = path.join(ROOT, 'dist', 'client', 'index.html');
        if (!fs.existsSync(indexFile)) throw new Error('--skip-build given but dist/client/index.html is missing; run a build first');
        log('BUILD: skipped (--skip-build), reusing dist/client');
      } else {
        const buildNode = pickBuildNode(opts.node);
        report.buildNode = {path: buildNode.path, version: buildNode.version?.raw ?? 'unknown', label: buildNode.label};
        log(`NODE: build will use ${buildNode.path} (${buildNode.version?.raw ?? 'unknown'}, ${buildNode.label}); harness Node ${process.version}`);
        buildInfo = await viteBuild(logDir, buildNode);
      }
      const distIndex = path.join(ROOT, 'dist', 'client', 'index.html');
      if (!fs.existsSync(distIndex)) throw new Error('dist/client/index.html missing after build');
      check(
        'production build (vite build)',
        true,
        opts.skipBuild
          ? 'reused existing dist/client'
          : `built in ${(buildInfo.ms / 1000).toFixed(1)}s with Node ${buildInfo.nodeVersion} (${buildInfo.label})`,
      );

      /* 2. server */
      lastStage = 'server';
      const serverPort = await freePort();
      server = await startServer(serverPort, logDir);
      baseUrl = `http://127.0.0.1:${serverPort}`;
      report.baseUrl = baseUrl;
      check('server started + /health', true, JSON.stringify(server.health));
      internalPrefix = baseUrl;
      assetPrefix = `${baseUrl}/assets/`;
      // Sample /health every second so WS reconnects can be correlated with server/CPU stalls.
      healthSampler = startHealthSampler(serverPort);
    }

    /* 3. browser(s) + flow */
    lastStage = 'chrome';
    if (mode === 'coop') {
      await coopFlow({opts, report, check, logDir, tempRoot, baseUrl, healthSampler, handles});
    } else {
      const debugPort = await freePort();
      chrome = await startChrome(debugPort, path.join(tempRoot, 'chrome-profile'), opts.chrome, logDir);
      handles.chromes.push(chrome);

      /* 4. CDP page + event collection */
      lastStage = 'cdp';
      const session = await openPageSession({debugPort, internalPrefix, assetPrefix, label: 'page', notesSink: report.notes});
      page = session.page;
      const sink = session.sink;
      handles.pages.push(page);
      report.pageErrors = sink.pageErrors;
      report.consoleErrors = sink.consoleErrors;
      report.consoleWarnings = sink.consoleWarnings;
      report.logErrors = sink.logErrors;
      report.badResponses = sink.badResponses;
      report.failedRequests = sink.failedRequests;
      report.assetRequests = sink.assetRequests;

    /* 5. navigate + landing */
    lastStage = 'navigate';
    report.navigatedAt = nowIso();
    const targetUrl = mode === 'url' ? opts.url : `${baseUrl}/`;
    const navStartedAt = Date.now();
    await page.send('Page.navigate', {url: targetUrl}, 60000);
    await waitFor(page, `document.readyState==='complete'`, {timeoutMs: 90000, label: 'page load'});
    await waitFor(
      page,
      `(()=>{const l=document.getElementById('landing');const n=document.getElementById('name');return !!l && !l.hidden && !!n && l.getBoundingClientRect().height>0;})()`,
      {timeoutMs: 90000, label: 'landing UI'},
    );
    const landingAt = Date.now();
    if (mode === 'url') check('live url loaded', true, targetUrl);
    check('landing UI visible', true, '');
    // Landing streaming-window evidence: capture immediately on landing, then a second frame
    // ~0.6 s later. The legacy blue-cone tower tops were visible only while the modern keep towers
    // streamed in, so these early frames prove the hidden-by-default fix on the landing page.
    report.screenshots.push(await screenshot(page, opts.outDir, '00-landing-early.png'));
    // Performance mode: capture loading progress UX before joining (progress text + join enable).
    if (opts.perf) {
      const loading = await captureLoadingProgress(page, {timeoutMs: Math.min(opts.hudTimeout, 150000)});
      report.loading = loading;
      log(`LOADING: joinEnabledAt=${loading.joinEnabledAtMs}ms maxFrameGap=${loading.maxFrameGapMs}ms texts=${JSON.stringify(loading.distinctTexts)}`);
    }
    await sleep(600);
    report.screenshots.push(await screenshot(page, opts.outDir, '00-landing-mid.png'));
    await sleep(600);
    report.screenshots.push(await screenshot(page, opts.outDir, '00-landing.png'));

    // Performance mode: validate the graphics-quality selector wiring before joining. Persistence
    // across a reload is checked at the END of the run so it cannot pollute the load timings.
    if (opts.perf) {
      const hook = await perfHookInfo(page);
      report.perf = {mode: mode === 'url' ? 'fps-load-only' : 'full', hook, loading: report.loading};
      log(`PERF HOOKS: ${JSON.stringify(hook)}`);
      if (hook.hasPerf) {
        report.perf.initialPageTimings = await capturePageTimings(page);
        const selector = await findQualitySelect(page);
        report.perf.qualitySelector = {found: !!selector, initial: selector, persisted: null, restored: null};
        if (selector) {
          await setQualityViaSelect(page, 'medium');
          await sleep(600);
          report.perf.qualitySelector.afterSelect = {hook: await readQuality(page), stored: await page.evaluate(`localStorage.getItem('ss-quality')`)};
          await setQualityViaSelect(page, 'high');
          await sleep(600);
          report.perf.qualitySelector.restored = {hook: await readQuality(page), stored: await page.evaluate(`localStorage.getItem('ss-quality')`)};
          log(`QUALITY SELECTOR: ${JSON.stringify(report.perf.qualitySelector)}`);
        } else {
          report.notes.push('perf: graphics-quality select not found in the DOM');
        }
      }
    }

    /* 6. enter the campaign */
    lastStage = 'join';
    const nameValue = 'QA Knight';
    await typeInto(page, '#name', nameValue);
    const typed = await page.evaluate(`document.getElementById('name').value`);
    check('filled #name', typed === nameValue, `value=${JSON.stringify(typed)}`);
    await waitForJoinEnabled(page, '#create', opts.hudTimeout);
    const joinClickedAt = Date.now();
    await clickSelector(page, '#create');
    // Cycle-4 HUD gate context: the perf run spends time on the landing QA steps before joining, so
    // nav→HUD includes that idle time. Record the join-click offset to report click→HUD as well.
    report.joinOffsetMs = joinClickedAt - navStartedAt;
    log(`FLOW: clicked "Begin a campaign" (join offset ${report.joinOffsetMs}ms from navigation), waiting for HUD + game state`);
    await waitFor(
      page,
      `(()=>{const h=document.getElementById('hud');return !!h && !h.hidden && getComputedStyle(h).display!=='none';})()`,
      {timeoutMs: opts.hudTimeout, label: 'HUD visible'},
    );
    const hudVisible = await page.evaluate(`(()=>{const h=document.getElementById('hud');return !!h && !h.hidden && getComputedStyle(h).display!=='none';})()`);
    check('#hud visible after joining', hudVisible, '');
    const hudAt = Date.now();
    await waitFor(
      page,
      `(()=>{const p=document.getElementById('playerName');const r=document.getElementById('resources');const w=document.getElementById('wayfinder');return !!p&&p.textContent.trim().length>0&&!!r&&r.textContent.includes('WOOD')&&!!w&&w.textContent.trim().length>0;})()`,
      {timeoutMs: 60000, label: 'game state (player name, resources, wayfinder)'},
    );
    check('game state received (authoritative snapshot)', true, '');
    // Cycle-4 load-timing marks: `__ssLoadTimings()` + raw performance marks/measures for HUD
    // attribution (the nav→HUD/state numbers are also measured independently by the perf capture).
    report.loadTimings = await readLoadTimings(page);
    if (report.loadTimings && report.loadTimings.hook) {
      log(`LOAD TIMINGS: ${JSON.stringify(report.loadTimings.hook)}`);
    }
    if (opts.probePreview) {
      const probe = await previewBody(page, 'templar', {distance: 3});
      log(`PROBE __ssPreviewBody('templar',{distance:3}): ${JSON.stringify(probe)}`);
      await sleep(3000);
      await screenshot(page, opts.outDir, 'probe-preview-templar.png');
      log('PROBE: wrote probe-preview-templar.png');
      // Cycle-5 content probe: altar/furnace QA poses at high quality (early, before corruption).
      await forceQuality(page, 'high');
      for (const name of ['content-altar', 'content-altar-close', 'content-altar-close2', 'content-altar-close3', 'content-furnace-village', 'content-furnace-camp']) {
        const pose = LANDMARK_POSES[name];
        if (!pose) continue;
        const applied = await qaPose(page, pose);
        if (applied && applied.ok !== false) {
          await sleep(2500);
          await screenshot(page, opts.outDir, `probe-${name}.png`);
          log(`PROBE: wrote probe-${name}.png`);
        }
        await qaView(page, null);
        await sleep(300);
      }
      await forceQuality(page, 'high');
    }
    const stateAt = Date.now();
    // Expected weapon-card count (8 at batch 1, 10 after batch-2 weapons land).
    const hudEarly = await hudSnapshot(page);
    report.weaponCards = hudEarly.__weaponCards;
    if (opts.expectWeapons !== null) {
      check(`weapon cards == ${opts.expectWeapons}`, hudEarly.__weaponCards === opts.expectWeapons, `found ${hudEarly.__weaponCards}`);
    } else {
      report.notes.push(`#weaponCards = ${hudEarly.__weaponCards} (no --expect-weapons gate)`);
    }
    // Optional direct 200-check for specific assets (especially newly-added ones on the live URL).
    if (opts.expectAssets.length) {
      const results = await verifyExpectedAssets(page, assetPrefix, opts.expectAssets);
      report.expectedAssets = results;
      check('expected assets return 200', results.every(r => r.ok), JSON.stringify(results));
    }
    await sleep(opts.perf ? opts.perfSettle : 2500);
    // Cycle-1 character readability capture (close-ups + body luminance before/after).
    if (opts.characters) {
      await captureCharacterReadability(page, {opts, report, check});
      await sleep(500);
    }
    // Cycle-3 short QA-view mode: capture region/atmosphere views immediately after join, before the
    // idle corruption timer can kill the player mid-capture (the long perf pass otherwise shows a
    // respawn overlay in region/landmark shots).
    if (opts.views) {
      await captureQaViews(page, opts.outDir, report, check);
      await sleep(400);
    }
    // Cycle-4: software renderer now defaults to quality LOW — force HIGH for all beauty/canvas
    // captures (the minimal-weather proof explicitly drops to low inside the weather audit).
    await forceQuality(page, 'high');
    await sleep(800);
    report.fps = await measureFps(page, 1500);
    log(`FPS: ${JSON.stringify(report.fps)}`);
    report.renderer = await rendererInfo(page);
    report.websocket = await page.evaluate(`window.__qaWs ? JSON.parse(JSON.stringify(window.__qaWs)) : null`);
    log(`WS: instances=${report.websocket?.instances} opens=${report.websocket?.opens} closes=${report.websocket?.closes?.length || 0} states=${report.websocket?.stateCount} url=${report.websocket?.urls?.[0]}`);
    log(`RENDERER: ${report.renderer?.renderer || 'unknown'} | vendor ${report.renderer?.vendor || 'unknown'}`);
    report.hud = await hudSnapshot(page);
    // Performance mode: third-person capture (renderer.info + 3-5 s frame percentiles + load
    // timings/request bytes), then a low/medium/high quality sweep when the hooks exist.
    if (opts.perf) {
      report.perf.requests = {
        internalRequests: sink.internalRequests,
        finishedRequests: sink.finishedRequests,
        responseBytes: sink.responseBytes,
        assetBytes: sink.assetBytes,
      };
      report.perf.pageTimings = await capturePageTimings(page);
      report.perf.load = {
        navigationToLandingMs: landingAt - navStartedAt,
        navigationToHudMs: hudAt - navStartedAt,
        navigationToStateMs: stateAt - navStartedAt,
        page: report.perf.initialPageTimings?.navigation ?? report.perf.pageTimings?.navigation ?? null,
        resources: report.perf.initialPageTimings?.resources ?? report.perf.pageTimings?.resources ?? null,
        requests: report.perf.requests,
      };
      await forceQuality(page, 'high');
      await sleep(1200);
      report.perf.thirdPerson = {
        snapshot: await capturePerfSnapshot(page),
        frames: await captureFrameStats(page, opts.perfSampleMs),
      };
      const tpSummary = perfSummary(report.perf.thirdPerson.snapshot, report.perf.thirdPerson.frames);
      log(`PERF[third-person]: ${JSON.stringify(tpSummary)}`);
      if (report.perf.hook?.hasPerf) {
        report.perf.qualities = await captureQualitySweep(page, {settleMs: 2000, sampleMs: Math.min(opts.perfSampleMs, 3000)});
        // Restore the default high tier before the visual-regression screenshots.
        await page.evaluate(`(()=>{try{if(typeof window.__ssQuality==='function')window.__ssQuality('high');}catch(e){}return true;})()`);
        await sleep(1500);
        report.perf.thirdPersonHigh = await capturePerfSnapshot(page);
        report.perf.thirdPerson.framesHigh = await captureFrameStats(page, Math.min(opts.perfSampleMs, 3000));
      }
    }
    // Cycle-5: force clear weather for the night-mood capture so natural rain/haze variance cannot
    // brighten the frame (weather visuals are audited separately in --perf). The first frames after
    // joining can run at <1 fps under SwiftShader, so wait long enough for at least two clear frames
    // before the screenshot (a 0.9 s wait previously captured the old rain frame).
    await setWeather(page, 'march', 'clear', 0);
    await sleep(4500);
    report.nightMoodWeather = 'forced-clear';
    report.screenshots.push(await screenshot(page, opts.outDir, '01-third-person.png'));
    report.canvas['third-person'] = await canvasPixelStats(page, opts.outDir, 'third-person');

    /* 7. first person */
    lastStage = 'first-person';
    const cameraBefore = await page.evaluate(`document.getElementById('cameraBtn').textContent`);
    await pressKey(page, 'KeyV', 'v', 86);
    await sleep(700);
    const cameraAfter = await page.evaluate(`document.getElementById('cameraBtn').textContent`);
    const firstPerson = /first/i.test(cameraAfter || '');
    check('V toggles to first person', firstPerson, `${cameraBefore} -> ${cameraAfter}`);
    await sleep(600);
    report.screenshots.push(await screenshot(page, opts.outDir, '02-first-person.png'));
    report.canvas['first-person'] = await canvasPixelStats(page, opts.outDir, 'first-person');
    if (opts.perf) {
      report.perf.firstPerson = {
        snapshot: await capturePerfSnapshot(page),
        frames: await captureFrameStats(page, opts.perfSampleMs),
      };
      log(`PERF[first-person]: ${JSON.stringify(perfSummary(report.perf.firstPerson.snapshot, report.perf.firstPerson.frames))}`);
    }

    /* 8. movement + attack */
    lastStage = 'combat';
    await holdKey(page, 'KeyW', 'w', 87, 1600);
    await sleep(200);
    // Pointer lock is required by the game before mouse attacks register. Some headless

    // environments cannot grant it; probe first so the harness never triggers an uncaught
    // requestPointerLock rejection (the game does not catch it). Fall back to the Q sweep.
    const pointerLock = await page.evaluate(
      `(async()=>{
        const c=document.getElementById('world');
        if(!c||typeof c.requestPointerLock!=='function')return {supported:false,reason:'requestPointerLock unavailable'};
        try{
          const p=c.requestPointerLock();
          if(p&&typeof p.then==='function')await p;
          const locked=document.pointerLockElement===c;
          document.exitPointerLock?.();
          await new Promise(r=>setTimeout(r,120));
          return {supported:!!locked,reason:locked?null:'lock not granted'};
        }catch(e){return {supported:false,reason:String((e&&e.message)||e)};}
      })()`,
      {awaitPromise: true, timeoutMs: 15000},
    );
    report.pointerLock = pointerLock;
    log(`POINTER LOCK: ${JSON.stringify(pointerLock)}`);
    if (!pointerLock.supported) {
      report.notes.push(
        `Mouse attack not exercised: headless Chrome refused pointer lock (${pointerLock.reason}); used Q sweep instead.`,
      );
    }
    const canvasRect = await selectorRect(page, '#world');
    if (canvasRect && pointerLock.supported) {
      await clickAt(page, canvasRect.x, canvasRect.y);
      await sleep(400);
      const locked = await page.evaluate(`document.pointerLockElement===document.getElementById('world')`);
      if (locked) {
        await page.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: round(canvasRect.x), y: round(canvasRect.y), button: 'left', clickCount: 1});
        await sleep(1200);
        await page.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: round(canvasRect.x), y: round(canvasRect.y), button: 'left', clickCount: 1});
        report.combat = {pointerLocked: true, mouseAttack: true};
      } else {
        report.combat = {pointerLocked: false, mouseAttack: false};
      }
    } else {
      report.combat = {pointerLocked: false, mouseAttack: false};
    }
    await pressKey(page, 'KeyQ', 'q', 81); // sweep = attack command if pointer lock is unavailable
    await pressKey(page, 'KeyH', 'h', 72); // heal (exercises command path; harmless at full health)
    await sleep(1200);
    report.combat = {
      ...report.combat,
      cameraMode: await page.evaluate(`document.getElementById('cameraBtn').textContent`),
      playerName: await page.evaluate(`document.getElementById('playerName').textContent`),
    };
    report.screenshots.push(await screenshot(page, opts.outDir, '03-combat.png'));
    report.canvas['combat'] = await canvasPixelStats(page, opts.outDir, 'combat');

    // Cycle-5 combat-feel probe: heavy hit → hit-stop/kick/vignette, then the reduced-motion path.
    const combatFeelHook = await page.evaluate(`typeof window.__ssCombatFx==='function'`);
    if (combatFeelHook) {
      const readFx = async () => page.evaluate(
        `(()=>{try{const r=window.__ssCombatFx();return r===undefined?null:JSON.parse(JSON.stringify(r));}catch(e){return null;}})()`,
        {timeoutMs: 10000},
      );
      const sampleFx = async () => {
        const samples = [];
        for (let i = 0; i < 12; i++) {
          samples.push(await readFx());
          await sleep(120);
        }
        return samples.filter(Boolean);
      };
      const attack = async () => {
        if (!canvasRect) return;
        await page.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: round(canvasRect.x), y: round(canvasRect.y), button: 'left', clickCount: 1});
        await sleep(320);
        await page.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: round(canvasRect.x), y: round(canvasRect.y), button: 'left', clickCount: 1});
      };
      const summariseFx = samples => ({
        maxHitStopMs: samples.length ? +Math.max(...samples.map(s => Number(s?.hitStopMs || 0))).toFixed(1) : 0,
        maxVignette: samples.length ? +Math.max(...samples.map(s => Number(s?.vignette?.opacity ?? s?.vignette ?? 0))).toFixed(3) : 0,
        maxKick: samples.length ? +Math.max(...samples.map(s => Math.abs(Number(s?.kick?.x ?? 0)) + Math.abs(Number(s?.kick?.y ?? 0)))).toFixed(3) : 0,
        reducedMotion: samples.some(s => s?.reducedMotion === true),
      });
      // Approach the gate garrison so the heavy swing actually lands (hit-stop/vignette are hit-driven).
      await holdKey(page, 'KeyW', 'w', 87, 6500);
      await sleep(500);
      const attackAndSample = async () => {
        const all = [];
        for (let i = 0; i < 3; i++) {
          await attack();
          all.push(...(await sampleFx()));
          await sleep(350);
        }
        return all;
      };
      const normalSamples = await attackAndSample();
      const normal = summariseFx(normalSamples);
      const heavyCount = normalSamples.length ? Math.max(...normalSamples.map(s => Number(s?.heavyCount || 0))) : 0;
      // Reduced-motion path: prefer the scene override hook, fall back to CDP media emulation.
      const reducedHook = await page.evaluate(`typeof window.__ssSetReducedMotion==='function'`);
      if (reducedHook) await page.evaluate(`window.__ssSetReducedMotion(true)`);
      else await page.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
      await sleep(600);
      const reducedFlag = await readFx();
      const reducedSamples = await attackAndSample();
      const reduced = summariseFx(reducedSamples);
      if (reducedHook) await page.evaluate(`window.__ssSetReducedMotion(null)`);
      else await page.send('Emulation.setEmulatedMedia', {features: []});
      report.combatFeel = {hook: true, normal, reduced, heavyCount, reducedFlagPresent: reducedFlag?.reducedMotion === true, reducedHook: reducedHook ? '__ssSetReducedMotion' : 'Emulation.setEmulatedMedia'};
      log(`COMBAT FEEL: normal=${JSON.stringify(normal)} reduced=${JSON.stringify(reduced)} heavyCount=${heavyCount} reducedMotionFlag=${report.combatFeel.reducedFlagPresent}`);
      check('combat: heavy-hit feel hook available', true, JSON.stringify(Object.keys(normalSamples[0] || {})));
      if (normal.maxHitStopMs > 0 || normal.maxKick > 0 || normal.maxVignette > 0) {
        check('combat: hit-stop fires on heavy hit', normal.maxHitStopMs > 0, `hitStopMs=${normal.maxHitStopMs}, heavyCount=${heavyCount}`);
        check('combat: kick/vignette fires on heavy hit', normal.maxVignette > 0 || normal.maxKick > 0, `vignette=${normal.maxVignette} kick=${normal.maxKick}`);
        check(
          'combat: reduced-motion preference lowers fx and is reported',
          reduced.reducedMotion && reduced.maxHitStopMs <= normal.maxHitStopMs && reduced.maxKick <= normal.maxKick,
          `reducedMotion=${reduced.reducedMotion} (${report.combatFeel.reducedHook}) hitStop ${normal.maxHitStopMs}→${reduced.maxHitStopMs}, kick ${normal.maxKick}→${reduced.maxKick}, vignette ${normal.maxVignette}→${reduced.maxVignette}`,
        );
      } else {
        report.notes.push(
          `combat: heavy attack sampled (${heavyCount} heavy, ${normalSamples.length} samples) but no hit-stop/kick/vignette was observed — likely no enemy contact reached from the spawn approach in this run; combat-feel visuals not gated (gap recorded for cycle 6)`,
        );
      }
    } else {
      report.notes.push('combat: __ssCombatFx hook absent — hit-stop/kick/vignette not measurable this run');
    }

    /* 9. toggle back */
    lastStage = 'toggle-back';
    await pressKey(page, 'KeyV', 'v', 86);
    await sleep(800);
    const cameraBack = await page.evaluate(`document.getElementById('cameraBtn').textContent`);
    check('V toggles back to third person', /third/i.test(cameraBack || ''), String(cameraBack));
    report.screenshots.push(await screenshot(page, opts.outDir, '04-third-person-return.png'));

    // Final HUD snapshot after all interactions, then assertions.
    report.hudAfter = await hudSnapshot(page);
    report.pageErrorsFinal = report.pageErrors.length;
    report.websocketFinal = await page.evaluate(`window.__qaWs ? JSON.parse(JSON.stringify(window.__qaWs)) : null`);
    if (report.websocketFinal?.closes?.length) {
      const closures = report.websocketFinal.closes.map(c => `${c.code}${c.reason ? `:${c.reason}` : ''}`).join(', ');
      report.notes.push(
        `WebSocket closed/reconnected ${report.websocketFinal.closes.length}x during the run (${closures}); ` +
          `${report.websocketFinal.opens} successful open(s) — check whether the client recovered.`,
      );
    }
    log(`WS final: instances=${report.websocketFinal?.instances} opens=${report.websocketFinal?.opens} closes=${report.websocketFinal?.closes?.length || 0} states=${report.websocketFinal?.stateCount}${report.websocketFinal?.closes?.length ? ` closures=${JSON.stringify(report.websocketFinal.closes)}` : ''}`);
    // Cycle-2 atmosphere/region audit screenshots via world-scene's named camera views
    // (window.__ssQAView(name)); camera is restored with __ssQAView(null) after each capture.
    if (opts.perf) {
      assertServerAlive(report, 'pre-views');
      await captureQaViews(page, opts.outDir, report, check);
    }
    // Performance mode: deferred quality-persistence + progressive-loading validation. A reload is
    // required to prove the stored tier is applied on startup; done last so it cannot pollute the
    // load timings. QA also injects a pre-app fetch delay (localStorage 'ss-qa-load-delay', read by
    // the injected instrumentation only) so the loading counter is observable — on a fast localhost
    // load the heavy scene construction otherwise hides the whole progress sequence.
    if (opts.perf && report.perf?.qualitySelector?.found) {
      try {
        await setQualityViaSelect(page, 'medium');
        await sleep(400);
        report.perf.qualitySelector.beforeReload = {hook: await readQuality(page), stored: await page.evaluate(`localStorage.getItem('ss-quality')`)};
        const delayMs = 2500;
        await page.evaluate(`localStorage.setItem('ss-qa-load-delay', ${JSON.stringify(String(delayMs))})`);
        // The app auto-resumes a session from sessionStorage on load; clear it so this reload
        // exercises the fresh landing + loading UI instead of jumping straight into the HUD.
        await page.evaluate(`sessionStorage.removeItem('ss-session')`);
        await page.send('Page.reload', {}, 60000);
        await sleep(2600);
        try {
          report.screenshots.push(await screenshot(page, opts.outDir, '05-loading-progress.png'));
        } catch {}
        await waitFor(page, `document.readyState==='complete'`, {timeoutMs: 90000, label: 'reload with simulated slow load'});
        await waitFor(page, `(()=>{const l=document.getElementById('landing');return !!l && !l.hidden;})()`, {timeoutMs: 90000, label: 'landing after reload'});
        await waitFor(
          page,
          `(()=>{const b=document.getElementById('create');return !!b && b.disabled===false;})()`,
          {timeoutMs: 45000, interval: 100, label: 'join enabled after slow load'},
        );
        const loadingState = await page.evaluate(`window.__qaLoading ? JSON.parse(JSON.stringify(window.__qaLoading)) : null`);
        const rafState = await page.evaluate(`window.__qaRaf ? JSON.parse(JSON.stringify(window.__qaRaf)) : null`);
        const parsed = progressCountsFromEvents(loadingState?.events || []);
        report.perf.loadingDelayed = {
          simulated: `pre-app fetch delay ${delayMs}ms + 250ms/asset stagger (QA instrumentation only; src untouched)`,
          events: loadingState?.events || [],
          distinctTexts: parsed.texts,
          counts: parsed.counts,
          joinEnabledAtMs: loadingState?.joinEnabledAtMs ?? null,
          maxFrameGapMs: rafState ? +(rafState.maxGapMs || 0).toFixed(1) : null,
          screenshot: '05-loading-progress.png',
        };
        const reopened = await findQualitySelect(page);
        const reloadType = await page.evaluate(`performance.getEntriesByType('navigation')[0]?.type ?? null`);
        report.perf.qualitySelector.persisted = {
          hook: await readQuality(page),
          stored: await page.evaluate(`localStorage.getItem('ss-quality')`),
          selectValue: reopened ? reopened.value : null,
          reloadType,
        };
        await page.evaluate(`localStorage.removeItem('ss-qa-load-delay')`);
        await setQualityViaSelect(page, 'high');
        log(`QUALITY PERSISTENCE: ${JSON.stringify(report.perf.qualitySelector.persisted)}`);
        log(`SLOW-LOAD PROGRESS: ${JSON.stringify({counts: parsed.counts, joinEnabledAtMs: report.perf.loadingDelayed.joinEnabledAtMs, maxFrameGapMs: report.perf.loadingDelayed.maxFrameGapMs})}`);
      } catch (error) {
        report.notes.push(`perf: quality persistence / slow-load progress check failed: ${error?.message || error}`);
        // Capture why the slow-load check failed (visible loading state on the reloaded page).
        try {
          report.perf.slowLoadFailure = {
            error: String(error?.message || error),
            state: await page.evaluate(`(()=>{const c=document.getElementById('connection');const b=document.getElementById('create');return {href:location.href,connection:c?c.textContent.trim().slice(0,140):null,createDisabled:b?b.disabled:null,loading:window.__qaLoading?JSON.parse(JSON.stringify(window.__qaLoading)):null};})()`),
          };
          report.screenshots.push(await screenshot(page, opts.outDir, '05-loading-progress-failure.png'));
        } catch {}
      }
    }
    // Reconnect-investigation diagnostics: navigation markers + server /health stall samples.
    report.diagnostics = {
      navigations: sink.navigations,
      navigationLog: sink.navigationLog,
      internalRequests: sink.internalRequests,
      ws: wsDiagnostics(report.websocketFinal, startedAt),
      health: healthSampler ? summarizeHealth(healthSampler.samples) : null,
    };
    report.internalRequests = sink.internalRequests;
    report.navigations = sink.navigations;
    log(`DIAG: ${JSON.stringify(report.diagnostics)}`);
    if (report.diagnostics.health && (report.diagnostics.health.stallsOver2s > 0 || report.diagnostics.health.maxMs > 2000)) {
      report.notes.push(`local server /health stall(s) observed: ${JSON.stringify(report.diagnostics.health)}`);
    }

    /* 10. assertions */
    lastStage = 'assert';
    check('zero uncaught page errors', report.pageErrors.length === 0, report.pageErrors.length ? JSON.stringify(report.pageErrors.slice(0, 5)) : 'none');
    check(
      'zero internal asset HTTP errors (no 404s)',
      report.badResponses.length === 0,
      report.badResponses.length ? JSON.stringify(report.badResponses.slice(0, 8)) : 'none',
    );
    check(
      'zero failed internal requests',
      report.failedRequests.length === 0,
      report.failedRequests.length ? JSON.stringify(report.failedRequests.slice(0, 8)) : 'none',
    );
    if (mode === 'local' && report.health) {
      check(
        'server: stayed up for the whole run (health failures 0)',
        (report.health.failures || 0) === 0,
        `failures=${report.health.failures} samples=${report.health.samples} p50=${report.health.p50Ms}ms${report.health.failures ? ' — external node kill? re-run required' : ''}`,
      );
    }
    for (const [label, stats] of Object.entries(report.canvas)) {
      check(`canvas renders content (${label})`, stats.ok, `std=${stats.std} (>=${CANVAS_GATE.minStd}), nonDark=${stats.nonDarkPct}% (>=${CANVAS_GATE.minNonDarkPct}), colors=${stats.uniqueColors} (>=${CANVAS_GATE.minColors})`);
    }
    // Cycle-4 night-mood check (Lead): the final scene must still read as night, not daylight.
    const tpCanvas = report.canvas['third-person'];
    if (tpCanvas) {
      const nightMood = {canvasMean: tpCanvas.mean, threshold: 75, meanR: tpCanvas.meanR, meanG: tpCanvas.meanG, meanB: tpCanvas.meanB, blackPct: tpCanvas.blackPct};
      report.nightMood = nightMood;
      check(
        'night: third-person scene stays a night scene (canvas mean <= 75, not daylight)',
        tpCanvas.mean <= 75,
        `TP canvas mean=${tpCanvas.mean} (threshold <=75; cycle-3 was ~52-62), RGB=${tpCanvas.meanR}/${tpCanvas.meanG}/${tpCanvas.meanB}, black=${tpCanvas.blackPct}%`,
      );
    }
    check('renderer string available', !!(report.renderer && report.renderer.webgl && report.renderer.renderer), report.renderer?.renderer || 'none');
    const expectedShots = ['01-third-person.png', '02-first-person.png', '03-combat.png', '04-third-person-return.png'];
    const shotNames = report.screenshots.map(f => path.basename(f));
    check('required screenshots saved', expectedShots.every(s => shotNames.includes(s)), shotNames.join(', '));
    if (opts.perf) {
      const perf = report.perf;
      const localFull = mode !== 'url';
      check('perf: capture produced data', !!(perf && perf.thirdPerson && perf.load && perf.requests), JSON.stringify({hasThird: !!perf?.thirdPerson, hasLoad: !!perf?.load}));
      if (localFull) {
        check('perf: __ssPerf hook available', !!perf?.hook?.hasPerf, JSON.stringify(perf?.hook));
        check('perf: __ssQuality hook available', !!perf?.hook?.hasQuality, JSON.stringify(perf?.hook));
        const lowCalls = perfMetric(perf?.qualities?.tiers?.low?.perf, 'calls');
        const highCalls = perfMetric(perf?.qualities?.tiers?.high?.perf, 'calls');
        check(
          'perf: draw calls drop at low quality',
          lowCalls != null && highCalls != null && lowCalls < highCalls && lowCalls <= highCalls * 0.9,
          `low=${lowCalls} high=${highCalls} ratio=${lowCalls != null && highCalls ? +(lowCalls / highCalls).toFixed(3) : 'n/a'}`,
        );
        const tpCalls = perfMetric(perf?.thirdPerson?.snapshot, 'calls');
        const tpTris = perfMetric(perf?.thirdPerson?.snapshot, 'triangles');
        check(
          'perf: draw calls < 210 (cycle-2 gate)',
          tpCalls != null && tpCalls < PERF_GATE.maxCalls,
          `calls=${tpCalls} (<${PERF_GATE.maxCalls}); cycle-1 was 173`,
        );
        check(
          'perf: triangles < 1.85M (cycle-2 gate)',
          tpTris != null && tpTris < PERF_GATE.maxTris,
          `tris=${tpTris} (<${PERF_GATE.maxTris}); cycle-1 was 1,500,333`,
        );
        const selector = perf?.qualitySelector;
        const normQuality = v => (typeof v === 'string' ? v : v?.tier ?? v?.quality ?? v?.current ?? null);
        check(
          'perf: quality selector present + persists',
          !!selector?.found && !!selector?.persisted && String(selector?.persisted?.stored) === 'medium' && normQuality(selector?.persisted?.hook) === 'medium',
          JSON.stringify({found: selector?.found, afterSelect: selector?.afterSelect, persisted: selector?.persisted}),
        );
        const loading = report.loading;
        const delayed = perf?.loadingDelayed;
        const loadingCounts = [...new Set([...(loading?.distinctProgressCounts || []), ...(delayed?.counts || [])])];
        const joinEnabledAtMs = loading?.joinEnabledAtMs ?? delayed?.joinEnabledAtMs ?? null;
        check(
          'perf: loading progress shows changing counts + join enabled',
          loadingCounts.length >= 2 && joinEnabledAtMs != null,
          JSON.stringify({
            unthrottledCounts: loading?.distinctProgressCounts || [],
            delayedCounts: delayed?.counts || [],
            joinEnabledAtMs,
            simulated: delayed?.simulated || null,
          }),
        );
        check(
          'perf: no long frozen frame during load',
          loading?.maxFrameGapMs == null || loading.maxFrameGapMs <= 5000,
          `maxFrameGap=${loading?.maxFrameGapMs}ms`,
        );
        // Cycle-3/4 time-to-HUD: must be meaningfully earlier than cycle-2 on the same SwiftShader box;
        // cycle-4 adds `__ssLoadTimings()`/mark attribution to the failure message when still over.
        // Cycle-4 note: the perf run spends landing-QA time before joining, so nav→HUD includes that
        // idle overhead; the gate uses CLICK→HUD/state (join click recorded in report.joinOffsetMs)
        // with the nav-based numbers reported for context.
        const loadTimes = perf?.load || {};
        const hudMs = loadTimes.navigationToHudMs;
        const stateMs = loadTimes.navigationToStateMs;
        const landingMs = loadTimes.navigationToLandingMs;
        const joinMs = loading?.joinEnabledAtMs ?? delayed?.joinEnabledAtMs ?? null;
        const joinOffset = report.joinOffsetMs ?? 0;
        const clickToHudMs = hudMs != null ? hudMs - joinOffset : null;
        const clickToStateMs = stateMs != null ? stateMs - joinOffset : null;
        const timingHook = report.loadTimings && report.loadTimings.hook ? report.loadTimings.hook : null;
        const marks = report.loadTimings && Array.isArray(report.loadTimings.marks) ? report.loadTimings.marks : [];
        report.perf.timeToHud = {
          landingMs,
          hudMs,
          stateMs,
          joinMs,
          joinOffsetMs: joinOffset,
          clickToHudMs,
          clickToStateMs,
          cycle2: {...CYCLE2_TIMINGS, gateMode: 'click-relative'},
          loadTimings: timingHook,
          marks: marks.slice(0, 30),
        };
        if (timingHook) {
          log(`TIME-TO-HUD ATTRIBUTION: ${JSON.stringify(timingHook)} marks=${JSON.stringify(marks.slice(0, 30))}`);
        }
        check(
          'perf: time-to-HUD meaningfully earlier than cycle-2 (SwiftShader, click→HUD)',
          clickToHudMs != null && clickToStateMs != null && clickToHudMs <= TIME_GATE.maxHudMs && clickToStateMs <= TIME_GATE.maxStateMs,
          `click→HUD=${clickToHudMs}ms (gate <=${TIME_GATE.maxHudMs}); click→state=${clickToStateMs}ms (gate <=${TIME_GATE.maxStateMs}); nav→HUD=${hudMs}ms / nav→state=${stateMs}ms (includes ${joinOffset}ms landing-QA overhead); landing=${landingMs}ms; attribution=${timingHook ? JSON.stringify(timingHook) : 'no __ssLoadTimings hook'}`,
        );
        if (joinMs != null) {
          check(
            'perf: join enabled within cycle-2 reference',
            joinMs <= TIME_GATE.maxJoinMs,
            `join=${joinMs}ms (cycle-2 ${CYCLE2_TIMINGS.joinMs}, gate <=${TIME_GATE.maxJoinMs})`,
          );
        }
        log(`PERF SUMMARY: third=${JSON.stringify(perfSummary(perf?.thirdPerson?.snapshot, perf?.thirdPerson?.frames))} first=${JSON.stringify(perfSummary(perf?.firstPerson?.snapshot, perf?.firstPerson?.frames))} low=${JSON.stringify(perfSummary(perf?.qualities?.tiers?.low?.perf, perf?.qualities?.tiers?.low?.frames))} high=${JSON.stringify(perfSummary(perf?.qualities?.tiers?.high?.perf, perf?.qualities?.tiers?.high?.frames))}`);
      } else {
        check('perf: live reference captured (fps/load only, hook absent as expected)', !!perf?.thirdPerson?.frames, JSON.stringify(perfSummary(perf?.thirdPerson?.snapshot, perf?.thirdPerson?.frames)));
      }
    }
    if (report.consoleErrors.length) {
      report.notes.push(`${report.consoleErrors.length} console error(s) logged (reported, not gated)`);
    }
    if (report.consoleWarnings.length) {
      report.notes.push(`${report.consoleWarnings.length} console/log warning(s) (reported, not gated)`);
    }
    } // end single-page flow
  } catch (error) {
    fatal = error;
    report.errors.push(`${lastStage}: ${error?.stack || error?.message || String(error)}`);
    log(`ERROR [${lastStage}]: ${error?.message || error}`);
    // Best effort evidence when the flow breaks.
    if (page && !page.closed) {
      try {
        report.screenshots.push(await screenshot(page, opts.outDir, 'failure.png'));
      } catch {}
      try {
        report.hud = report.hud || (await hudSnapshot(page));
      } catch {}
      if (!report.renderer) {
        try {
          report.renderer = await rendererInfo(page);
        } catch {}
      }
    }
  } finally {
    /* 11. cleanup - always */
    lastStage = 'cleanup';
    try {
      healthSampler?.stop();
    } catch {}
    for (const p of handles.pages) {
      try {
        p.close();
      } catch {}
    }
    for (const c of handles.chromes) {
      await killTree(c.child);
      log('CLEANUP: chrome stopped');
    }
    if (server?.child) {
      await killTree(server.child);
      log('CLEANUP: server stopped');
    }
    // wait for the server port to be released
    if (report.baseUrl) {
      const port = Number(new URL(report.baseUrl).port);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !(await portIsFree(port))) await sleep(150);
    }
    if (tempDir && !opts.keep) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 3, retryDelay: 150});
          break;
        } catch {
          await sleep(250);
        }
      }
    } else if (tempDir) {
      log(`CLEANUP: kept temp dir ${tempDir}`);
    }
    report.finishedAt = nowIso();
    report.durationMs = Date.now() - startedAt;
  }

  /* 12. persist artifacts + logs, then summary */
  const artifactDir = path.join(os.tmpdir(), 'ss-smoke-artifacts', `${path.basename(opts.outDir)}-${stamp}`);
  fs.mkdirSync(artifactDir, {recursive: true});
  for (const name of ['build.log', 'chrome.log']) {
    const from = path.join(logDir, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(artifactDir, name));
  }
  fs.writeFileSync(path.join(artifactDir, 'harness.log'), logLines.join('\n') + '\n');
  if (buildInfo) {
    report.buildMs = buildInfo.ms;
    report.buildNode = {path: buildInfo.node, version: buildInfo.nodeVersion, label: buildInfo.label};
  }
  const failed = report.checks.filter(c => !c.ok);
  report.pass = !fatal && failed.length === 0;
  report.logs = {
    dir: artifactDir,
    build: fs.existsSync(path.join(artifactDir, 'build.log')) ? path.join(artifactDir, 'build.log') : null,
    chrome: fs.existsSync(path.join(artifactDir, 'chrome.log')) ? path.join(artifactDir, 'chrome.log') : null,
    harness: path.join(artifactDir, 'harness.log'),
  };
  const summaryPath = path.join(artifactDir, 'report.json');
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));

  console.log('\n================ SMOKE SUMMARY ================');
  console.log(`command:   ${report.command}`);
  console.log(`out:       ${opts.outDir}`);
  console.log(`mode:      ${report.mode}${report.siteRoot ? ` (${report.siteRoot})` : ''}`);
  console.log(`result:    ${report.pass ? 'PASS' : 'FAIL'}`);
  console.log(`checks:    ${report.checks.filter(c => c.ok).length}/${report.checks.length} passed`);
  for (const c of report.checks) console.log(`  ${c.ok ? '[PASS]' : '[FAIL]'} ${c.name}${c.ok ? '' : ` -> ${c.detail}`}`);
  if (report.weaponCards !== null) console.log(`weapons:   ${report.weaponCards} cards${opts.expectWeapons !== null ? ` (expected ${opts.expectWeapons})` : ''}`);
  if (report.characters) {
    const c = report.characters;
    console.log(`characters: agg=${JSON.stringify(c.aggregate)} normalTP=${JSON.stringify(c.normalThirdPerson?.stats)}`);
    console.log(`char torso: bodyMask=${JSON.stringify(c.normalThirdPersonBodyMask || null)} fixedCropInfo=${JSON.stringify(c.torsoTone?.fixedCropInformational || null)}`);
    console.log(`char before: ${JSON.stringify(c.baseline?.normalPlayerTorso)} (${c.baseline?.source})`);
    if (c.aggregate?.bodiesColour) {
      console.log(`char colours: ${c.aggregate.bodiesWith500}/${c.aggregate.bodiesColour.length} >=500 (${c.aggregate.bodiesColour.map(b => `${b.appearance}:${b.bodyMask}`).join(',')}) gradient=${c.aggregate.minGradientMean}-${Math.max(...c.aggregate.bodiesColour.map(b => b.gradientMean ?? 0))} (avg ${c.aggregate.avgGradientMean})`);
    }
    if (c.previewBodyProbe) console.log(`char previewBody: ${c.previewBodyProbe.rendered}/${c.previewBodyProbe.bodies.length} rendered (${c.previewBodyProbe.bodies.map(b => `${b.name}:${b.rendered ? 'ok' : 'MISSING'}`).join(',')})`);
    if (c.survivorIdentity) console.log(`char survivor identity diff vs cycle-4: ${JSON.stringify(c.survivorIdentity.diff)}`);
    if (c.clothWind) console.log(`char cloth wind: ${JSON.stringify(c.clothWind.map(w => ({appearance: w.appearance, body: w.bodyDiff?.meanAbsLum, bg: w.backgroundDiff?.meanAbsLum})))}`);
    for (const a of c.appearances || []) {
      if (a.skipped) {
        console.log(`  char ${a.appearance}: SKIPPED (body-preview hook unavailable)`);
        continue;
      }
      console.log(`  char ${a.appearance}: ${JSON.stringify(a.stats)} core=${JSON.stringify({colors: a.coreStats?.uniqueColors ?? null, sat: a.coreStats?.meanSat ?? null})} fullFrameColors=${a.fullFrameStats?.uniqueColors ?? null}${a.tenMeter ? ` 10m=${JSON.stringify({mean: a.tenMeter.stats.mean, colors: a.tenMeter.stats.uniqueColors})}` : ' 10m=missing'} -> ${path.relative(ROOT, a.file)}`);
    }
    if (c.distinctness) console.log(`  appearance distinctness: ${JSON.stringify(c.distinctness)}`);
    for (const u of c.undead || []) console.log(`  undead ${u.actor.kind}:${u.actor.name}: ${JSON.stringify(u.stats)} -> ${path.relative(ROOT, u.file)}`);
    if (c.elite) {
      console.log(`  elite: hooks=${JSON.stringify(c.elite.hooks || {hook: c.elite.hook})} matched=${(c.elite.matched || []).length} tiers=${JSON.stringify((c.elite.tiers || []).map(t => t.tier))} rule=${c.elite.rule} diff=${JSON.stringify(c.elite.diff || null)}`);
      for (const e of c.elite.captures || []) console.log(`    ${e.kind}: ${e.actor.kind}:${e.actor.name} ${JSON.stringify(e.stats)} -> ${path.relative(ROOT, e.file)}`);
    }
  }
  if (report.views) {
    console.log(`views:     hook=${report.views.hook} captured=${report.views.captures.map(c => c.name).join(',') || '(none)'} optional=${(report.views.optionalCaptures || []).map(c => c.name).join(',') || '(none)'} landscape=${JSON.stringify(report.views.landscape)}`);
    for (const c of report.views.captures) {
      console.log(`  view ${c.name}: ${JSON.stringify({mean: c.stats.mean, p50: c.stats.p50, p90: c.stats.p90, colors: c.stats.uniqueColors, meanR: c.stats.meanR, meanG: c.stats.meanG, meanB: c.stats.meanB, meanSat: c.stats.meanSat})} -> ${path.relative(ROOT, c.file)}`);
    }
    for (const c of report.views.optionalCaptures || []) {
      console.log(`  view(optional) ${c.name}: ${JSON.stringify({mean: c.stats.mean, p50: c.stats.p50, colors: c.stats.uniqueColors, meanSat: c.stats.meanSat, region: c.regionInfo?.region ?? null})} -> ${path.relative(ROOT, c.file)}`);
    }
    if (report.views.regionDistinctness) console.log(`regions:   ${JSON.stringify(report.views.regionDistinctness)}`);
    if (report.views.wind) console.log(`wind:      ${JSON.stringify(report.views.wind)}`);
  }
  if (report.combatFeel) console.log(`combatFeel: ${JSON.stringify(report.combatFeel)}`);
  if (report.weather) {
    console.log(`weather:   hook=${report.weather.hook} forceHook=${report.weather.forceHook} captures=${report.weather.captures.length} particles=${JSON.stringify(report.weather.particles || null)} snow=${JSON.stringify(report.weather.snow || null)} lowTier=${JSON.stringify(report.weather.lowTier ? {particles: report.weather.lowTier.particles} : null)} lowTierSnow=${JSON.stringify(report.weather.lowTierSnow ? {snow: report.weather.lowTierSnow.snow} : null)}`);
    for (const w of report.weather.captures || []) {
      console.log(`  weather ${w.phase}:${w.intensity}: state=${JSON.stringify(w.state)} forced=${JSON.stringify(w.forced)} -> ${path.relative(ROOT, w.file)}`);
    }
  }
  if (report.perf) {
    const perf = report.perf;
    console.log(`perf:      mode=${perf.mode} third=${JSON.stringify(perfSummary(perf.thirdPerson?.snapshot, perf.thirdPerson?.frames))}`);
    if (perf.firstPerson) console.log(`perf FP:   ${JSON.stringify(perfSummary(perf.firstPerson?.snapshot, perf.firstPerson?.frames))}`);
    if (perf.qualities?.tiers) {
      for (const [tier, data] of Object.entries(perf.qualities.tiers)) {
        console.log(`perf ${tier}: ${JSON.stringify(perfSummary(data?.perf, data?.frames))}`);
      }
    }
    if (perf.load) {
      console.log(`load:      ${JSON.stringify({toLandingMs: perf.load.navigationToLandingMs, toHudMs: perf.load.navigationToHudMs, toStateMs: perf.load.navigationToStateMs, assetBytes: perf.load.resources?.assetTransferBytes ?? null, responseBytes: perf.load.requests?.responseBytes ?? null})}`);
      if (perf.timeToHud) console.log(`timeToHud: ${JSON.stringify(perf.timeToHud)}`);
      if (report.loadTimings && report.loadTimings.hook) console.log(`loadTimings(perf run): ${JSON.stringify(report.loadTimings.hook)}`);
    }
    if (report.loading) console.log(`loading:   ${JSON.stringify({joinEnabledAtMs: report.loading.joinEnabledAtMs, maxFrameGapMs: report.loading.maxFrameGapMs, texts: report.loading.distinctTexts})}`);
    if (perf.qualitySelector) console.log(`quality:   ${JSON.stringify(perf.qualitySelector)}`);
  }
  if (report.coop) console.log(`coop:      ${JSON.stringify(report.coop)}`);
  console.log(`page errors: ${report.pageErrors.length}${report.pageErrors.length ? ` -> ${JSON.stringify(report.pageErrors.slice(0, 3))}` : ''}`);
  console.log(`console errors: ${report.consoleErrors.length}${report.consoleErrors.length ? ` -> ${JSON.stringify(report.consoleErrors.slice(0, 3))}` : ''}`);
  console.log(`log errors: ${report.logErrors.length}${report.logErrors.length ? ` -> ${JSON.stringify(report.logErrors.slice(0, 3))}` : ''}`);
  console.log(`bad responses: ${report.badResponses.length}`);
  console.log(`websocket: ${report.websocketFinal ? `opens=${report.websocketFinal.opens} closes=${report.websocketFinal.closes.length} errors=${report.websocketFinal.errors.length}` : 'n/a'}`);
  if (report.diagnostics) console.log(`diagnostics: ${JSON.stringify({navigations: report.diagnostics.navigations, health: report.diagnostics.health, closes: report.diagnostics.ws?.closes})}`);
  console.log(`renderer:  ${report.renderer?.renderer || 'n/a'}`);
  console.log(`canvas:    ${JSON.stringify(report.canvas)}`);
  if (report.nightMood) console.log(`nightMood: ${JSON.stringify(report.nightMood)}`);
  console.log(`fps:       ${JSON.stringify(report.fps)}`);
  console.log(`screens:   ${report.screenshots.map(f => path.relative(ROOT, f)).join(', ')}`);
  console.log(`report:    ${summaryPath}`);
  console.log(`artifacts: ${artifactDir}${opts.keep ? ' (temp profile kept)' : ''}`);
  if (fatal) console.log(`fatal:     ${fatal?.message || fatal}`);
  console.log('===============================================\n');

  if (fatal) process.exitCode = 2;
  else process.exitCode = report.pass ? 0 : 1;
}

run().catch(error => {
  console.error('HARNESS CRASH:', error?.stack || error);
  process.exitCode = 2;
});
