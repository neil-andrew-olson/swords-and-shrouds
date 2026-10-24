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
 *   node scripts/smoke-browser.mjs --out qa/final --skip-build
 *
 * Options:
 *   --out <dir>        Screenshot output dir, relative to the game repo (default qa/baseline)
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
// Injected before the app boots: records every WebSocket lifecycle so the report can tell a real
// server disconnect/reconnect from a transient toast (e.g. "Connection lost. Reconnecting...").
const WS_INSTRUMENT = `(()=>{
  if(window.__qaWs)return;
  const O=window.WebSocket;
  window.__qaWs={instances:0,opens:0,closes:[],errors:[],urls:[]};
  class QAWebSocket extends O {
    constructor(...args){
      super(...args);
      const state=window.__qaWs;
      state.instances++;
      state.urls.push(String(args[0]||''));
      this.addEventListener('open',()=>{state.opens++;});
      this.addEventListener('close',event=>{state.closes.push({code:event.code,reason:event.reason,wasClean:event.wasClean,at:Date.now()});});
      this.addEventListener('error',()=>{state.errors.push({at:Date.now()});});
    }
  }
  window.WebSocket=QAWebSocket;
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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--skip-build' || a === '--no-build') opts.skipBuild = true;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--node') opts.node = argv[++i];
    else if (a === '--timeout') opts.hudTimeout = Number(argv[++i]) || opts.hudTimeout;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!opts.out) throw new Error('--out requires a directory');
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

/** Decode a PNG screenshot inside the page (2D canvas) and measure what is actually visible. */
async function analyzePng(page, base64) {
  return page.evaluate(
    `(()=>new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
          const d=ctx.getImageData(0,0,c.width,c.height).data;
          let count=0,sum=0,sumSq=0,nonDark=0,min=255,max=0;
          const buckets=new Set();
          for(let i=0;i<d.length;i+=16){
            const r=d[i],g=d[i+1],b=d[i+2];
            const lum=0.2126*r+0.7152*g+0.0722*b;
            count++;sum+=lum;sumSq+=lum*lum;
            if(lum>10)nonDark++;
            if(lum<min)min=lum;
            if(lum>max)max=lum;
            buckets.add(((r>>3)<<10)|((g>>3)<<5)|(b>>3));
          }
          const mean=sum/count;
          resolve({width:c.width,height:c.height,sampled:count,
            mean:+mean.toFixed(2),
            std:+Math.sqrt(Math.max(0,sumSq/count-mean*mean)).toFixed(2),
            nonDarkPct:+(nonDark/count*100).toFixed(2),
            uniqueColors:buckets.size,min,max});
        }catch(e){reject(new Error('pixels: '+(e&&e.message)));}
      };
      img.onerror=()=>reject(new Error('screenshot decode failed'));
      img.src='data:image/png;base64,${base64.replace(/'/g, "\\'")}';
    }))()`,
    {awaitPromise: true, timeoutMs: 30000},
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

/* ---------------------------------------------------------------- update */

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    startedAt: nowIso(),
    command: `node scripts/smoke-browser.mjs ${process.argv.slice(2).join(' ')}`.trim(),
    outDir: opts.outDir,
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
    renderer: null,
    canvas: {},
    fps: null,
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
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    report.baseUrl = baseUrl;
    check('server started + /health', true, JSON.stringify(server.health));

    /* 3. chrome */
    lastStage = 'chrome';
    const debugPort = await freePort();
    chrome = await startChrome(debugPort, path.join(tempRoot, 'chrome-profile'), opts.chrome, logDir);

    /* 4. CDP page + event collection */
    lastStage = 'cdp';
    pageInfo = await createPageTarget(debugPort);
    page = new CDP(pageInfo.webSocketDebuggerUrl, 'page');
    await page.open();

    const internal = url => typeof url === 'string' && url.startsWith(baseUrl);
    const assetUrl = url => typeof url === 'string' && url.startsWith(`${baseUrl}/assets/`);
    const requestUrls = new Map();
    page.on('Network.requestWillBeSent', params => {
      if (params.request?.url) requestUrls.set(params.requestId, params.request.url);
    });
    page.on('Runtime.exceptionThrown', params => {
      const d = params.exceptionDetails || {};
      report.pageErrors.push({
        text: d.exception?.description || d.text || 'unknown exception',
        url: d.url || '',
        line: d.lineNumber,
        column: d.columnNumber,
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
      if (type === 'error' || type === 'assert') report.consoleErrors.push({type, text});
      else if (type === 'warning') report.consoleWarnings.push({type, text});
    });
    page.on('Log.entryAdded', params => {
      const entry = params.entry || {};
      if (entry.level === 'error') report.logErrors.push({source: entry.source, text: entry.text, url: entry.url || ''});
      else if (entry.level === 'warning') report.consoleWarnings.push({type: `log:${entry.source}`, text: entry.text});
    });
    page.on('Network.responseReceived', params => {
      const r = params.response || {};
      const url = r.url || '';
      if (internal(url)) {
        report.internalRequests++;
        if (assetUrl(url) && !report.assetRequests.includes(url)) report.assetRequests.push(url);
      }
      if (typeof r.status === 'number' && r.status >= 400) {
        const entry = {url, status: r.status, type: params.type, mimeType: r.mimeType || ''};
        if (internal(url)) {
          if (/\/favicon\.ico$/.test(url)) report.notes.push('favicon.ico is 404 (cosmetic, ignored)');
          else report.badResponses.push(entry);
        } else {
          report.consoleWarnings.push({type: 'external-http', text: `${r.status} ${url}`});
        }
      }
    });
    page.on('Network.loadingFailed', params => {
      if (params.canceled) return;
      const entry = {requestId: params.requestId, errorText: params.errorText, type: params.type};
      // Network.loadingFailed does not carry the URL; resolve it from requestWillBeSent.
      const url = requestUrls.get(params.requestId);
      if (internal(url)) report.failedRequests.push({...entry, url});
    });

    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Network.enable', {maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: 10 * 1024 * 1024});
    // Headless windows are not "focused" by default; focus emulation makes document.hasFocus()
    // true, which pointer lock and a few page behaviours depend on. Harmless when unsupported.
    try {
      await page.send('Emulation.setFocusEmulationEnabled', {enabled: true}, 5000);
      log('CDP: focus emulation enabled');
    } catch (error) {
      report.notes.push(`Emulation.setFocusEmulationEnabled unavailable: ${error?.message || error}`);
    }
    try {
      await page.send('Page.bringToFront', {}, 5000);
    } catch {}
    // Install the WebSocket lifecycle recorder before the app's first script runs.
    await page.send('Page.addScriptToEvaluateOnNewDocument', {source: WS_INSTRUMENT});
    log('CDP: WebSocket lifecycle instrumentation installed');
    log('CDP: Page/Runtime/Log/Network enabled');

    /* 5. navigate + landing */
    lastStage = 'navigate';
    report.navigatedAt = nowIso();
    await page.send('Page.navigate', {url: `${baseUrl}/`}, 60000);
    await waitFor(page, `document.readyState==='complete'`, {timeoutMs: 60000, label: 'page load'});
    await waitFor(
      page,
      `(()=>{const l=document.getElementById('landing');const n=document.getElementById('name');return !!l && !l.hidden && !!n && l.getBoundingClientRect().height>0;})()`,
      {timeoutMs: 60000, label: 'landing UI'},
    );
    check('landing UI visible', true, '');
    await sleep(1200);
    report.screenshots.push(await screenshot(page, opts.outDir, '00-landing.png'));

    /* 6. enter the campaign */
    lastStage = 'join';
    const nameValue = 'QA Knight';
    await typeInto(page, '#name', nameValue);
    const typed = await page.evaluate(`document.getElementById('name').value`);
    check('filled #name', typed === nameValue, `value=${JSON.stringify(typed)}`);
    await clickSelector(page, '#create');
    log('FLOW: clicked "Begin a campaign", waiting for HUD + game state');
    await waitFor(
      page,
      `(()=>{const h=document.getElementById('hud');return !!h && !h.hidden && getComputedStyle(h).display!=='none';})()`,
      {timeoutMs: opts.hudTimeout, label: 'HUD visible'},
    );
    const hudVisible = await page.evaluate(`(()=>{const h=document.getElementById('hud');return !!h && !h.hidden && getComputedStyle(h).display!=='none';})()`);
    check('#hud visible after joining', hudVisible, '');
    await waitFor(
      page,
      `(()=>{const p=document.getElementById('playerName');const r=document.getElementById('resources');const w=document.getElementById('wayfinder');return !!p&&p.textContent.trim().length>0&&!!r&&r.textContent.includes('WOOD')&&!!w&&w.textContent.trim().length>0;})()`,
      {timeoutMs: 60000, label: 'game state (player name, resources, wayfinder)'},
    );
    check('game state received (authoritative snapshot)', true, '');
    await sleep(2500);
    report.fps = await measureFps(page, 1500);
    log(`FPS: ${JSON.stringify(report.fps)}`);
    report.renderer = await rendererInfo(page);
    report.websocket = await page.evaluate(`window.__qaWs ? JSON.parse(JSON.stringify(window.__qaWs)) : null`);
    log(`WS: ${JSON.stringify(report.websocket)}`);
    log(`RENDERER: ${report.renderer?.renderer || 'unknown'} | vendor ${report.renderer?.vendor || 'unknown'}`);
    report.hud = await hudSnapshot(page);
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
    log(`WS final: ${JSON.stringify(report.websocketFinal)}`);

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
    for (const [label, stats] of Object.entries(report.canvas)) {
      check(`canvas renders content (${label})`, stats.ok, `std=${stats.std} (>=${CANVAS_GATE.minStd}), nonDark=${stats.nonDarkPct}% (>=${CANVAS_GATE.minNonDarkPct}), colors=${stats.uniqueColors} (>=${CANVAS_GATE.minColors})`);
    }
    check('renderer string available', !!(report.renderer && report.renderer.webgl && report.renderer.renderer), report.renderer?.renderer || 'none');
    const expectedShots = ['01-third-person.png', '02-first-person.png', '03-combat.png', '04-third-person-return.png'];
    const shotNames = report.screenshots.map(f => path.basename(f));
    check('required screenshots saved', expectedShots.every(s => shotNames.includes(s)), shotNames.join(', '));
    if (report.consoleErrors.length) {
      report.notes.push(`${report.consoleErrors.length} console error(s) logged (reported, not gated)`);
    }
    if (report.consoleWarnings.length) {
      report.notes.push(`${report.consoleWarnings.length} console/log warning(s) (reported, not gated)`);
    }
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
      page?.close();
    } catch {}
    if (chrome?.child) {
      await killTree(chrome.child);
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
  console.log(`result:    ${report.pass ? 'PASS' : 'FAIL'}`);
  console.log(`checks:    ${report.checks.filter(c => c.ok).length}/${report.checks.length} passed`);
  for (const c of report.checks) console.log(`  ${c.ok ? '[PASS]' : '[FAIL]'} ${c.name}${c.ok ? '' : ` -> ${c.detail}`}`);
  console.log(`page errors: ${report.pageErrors.length}${report.pageErrors.length ? ` -> ${JSON.stringify(report.pageErrors.slice(0, 3))}` : ''}`);
  console.log(`console errors: ${report.consoleErrors.length}${report.consoleErrors.length ? ` -> ${JSON.stringify(report.consoleErrors.slice(0, 3))}` : ''}`);
  console.log(`log errors: ${report.logErrors.length}${report.logErrors.length ? ` -> ${JSON.stringify(report.logErrors.slice(0, 3))}` : ''}`);
  console.log(`bad responses: ${report.badResponses.length}`);
  console.log(`websocket: ${report.websocketFinal ? `opens=${report.websocketFinal.opens} closes=${report.websocketFinal.closes.length} errors=${report.websocketFinal.errors.length}` : 'n/a'}`);
  console.log(`renderer:  ${report.renderer?.renderer || 'n/a'}`);
  console.log(`canvas:    ${JSON.stringify(report.canvas)}`);
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
