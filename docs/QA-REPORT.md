# QA Report — Headless Browser Smoke (Batch 2026-10)

Owner: **qa-verifier**. Harness: `scripts/smoke-browser.mjs`. Screenshots: `qa/<run>/`.
Both the pre-batch baseline and the final integrated run are recorded below.

## TL;DR

| Run | When (local) | Command | Result |
| --- | --- | --- | --- |
| Baseline (pre-batch HEAD) | 2026-10-23 22:17–22:18 | `node scripts/smoke-browser.mjs --out qa/baseline --skip-build` | **PASS 16/16**, 0 page errors, 0 console errors, 0 failed/4xx internal requests |
| Final integration | 2026-10-23 22:38–22:39 | `& $node scripts/smoke-browser.mjs --out qa/final` (bundled Node 24, fresh build) | **PASS 16/16**, 0 page errors, 0 console errors, 0 asset 404s, WS opens=1/closes=0, 8 weapon cards |

## Harness

`scripts/smoke-browser.mjs` is a reusable, non-interactive production smoke check. It:

1. Cleans `dist/` and builds the client with a **Vite-compatible Node** (auto-selected; see
   Environment) via `node node_modules/vite/bin/vite.js build` → `dist/client/`; skipped with
   `--skip-build`.
2. Starts the real authoritative server on a free port:
   `node --import tsx src/server/index.ts` with `PORT=<free port>`, waits for `/health`.
3. Launches headless Chrome with the flags below, creates a CDP page target through
   `http://127.0.0.1:<debug>/json/new` (PUT), and talks DevTools Protocol over `ws`.
4. Enables `Page`, `Runtime`, `Log`, `Network`, plus focus emulation, then drives the real
   production client: landing → type `#name` → click `#create` → wait for `#hud` + live game
   state → screenshots → `V` first person → `V` back → hold `W` → mouse attack (when pointer
   lock is available) → `Q` sweep / `H` heal → screenshots.
5. Collects `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`, `Log.entryAdded`,
   `Network.responseReceived` (4xx/5xx), `Network.loadingFailed`, and a pre-injected
   `window.__qaWs` WebSocket recorder (open/close code+reason/errors) so a transient
   "Connection lost. Reconnecting…" toast can be distinguished from a real server disconnect.
6. Measures the rendered canvas itself (HUD/vignette temporarily hidden, screenshot decoded
   in-page): mean luminance, std-dev, non-dark pixel %, unique quantised colours.
7. Always kills Chrome + server (`taskkill /T /F`), frees the port, removes the temp Chrome
   profile, and exits non-zero if any gate fails.

Exact commands (shell starts outside the repo):

```bat
cd C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build

:: pre-batch baseline (already captured; reused the pre-batch dist/client, no build)
node scripts/smoke-browser.mjs --out qa/baseline --skip-build

:: final integrated run — Node 24 required for Vite 7.3.7 (system Node is 22.11.0)
$node = "C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
& $node scripts/smoke-browser.mjs --out qa/final
```

The harness auto-selects a Vite-compatible Node for the build (harness Node → bundled Node 24,
overridable with `--node <path>` / `SMOKE_NODE`), so running it with the bundled Node is the
supported path; running it with system Node 22.11 still builds correctly because the build child
process is switched to Node 24. It also removes `dist/` before building (with retries) to avoid
Vite's `ENOTEMPTY` race.

Options: `--out <dir>` (default `qa/baseline`), `--skip-build`, `--node <path>`, `--keep`,
`--chrome <path>`, `--timeout <ms>` (HUD wait, default 150000). Exit codes: `0` pass, `1` gate
failure, `2` harness crash. Machine-readable report + logs are written to
`%TEMP%\ss-smoke-artifacts\<out-name>-<timestamp>\{report.json,harness.log,build.log,chrome.log}`.

### Environment / flags

- Windows. System Node **v22.11.0** is too old for Vite **7.3.7** (engines `^20.19.0 || >=22.12.0`);
  builds run on the bundled Node **v24.21.0**
  (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`).
  Chrome **155.0.8059.85**.
- Chrome flags: `--headless=new --remote-debugging-port=<free> --user-data-dir=<temp>
  --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle --ignore-gpu-blocklist
  --disable-gpu-sandbox --window-size=1600,900 --hide-scrollbars --mute-audio --no-first-run
  --no-default-browser-check --no-sandbox --disable-dev-shm-usage --disable-extensions
  --remote-allow-origins=* --force-device-scale-factor=1`.
- Actual viewport: **1584 × 805** (Chrome's `--window-size` is the outer size; DPR 1). Both
  runs use the same flags, so baseline/final screenshots are directly comparable.
- WebGL renderer (from `WEBGL_debug_renderer_info` on `#world`):
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`,
  vendor `Google Inc. (Google)`, WebGL 2.0. **Software rasterisation** — 3.3 fps on the baseline,
  1.6 fps on the final build (post-FX composer + PMREM + denser trees), so it is not
  representative of player GPU performance; it is only enough to prove the scene renders and is
  interactive.
- Audio is muted headless. Audio/ambience cannot be verified by this harness.

### Gates asserted (16)

1. production build present (or fresh `vite build` succeeds)
2. server starts + `/health` responds
3. landing UI visible
4. `#name` filled
5. `#hud` visible after joining
6. authoritative game state received (player name + resources + wayfinder)
7. `V` toggles to first person (button text changes)
8. `V` toggles back to third person
9. zero uncaught page errors / exceptions
10. zero internal HTTP 4xx/5xx (no asset 404s)
11. zero non-cancelled internal request failures
12–14. canvas renders content in third person / first person / combat
   (`std ≥ 2`, non-dark ≥ 2 %, unique colours ≥ 32)
15. WebGL renderer string available
16. required screenshots saved

### Mitigations / known harness caveats

- **Pointer lock**: the game's `canvas.requestPointerLock()` is not wrapped in a `.catch`, so in
  a headless window that cannot grant pointer lock it surfaces as an uncaught
  `WrongDocumentError` page error. Fix: the harness calls
  `Emulation.setFocusEmulationEnabled({enabled:true})` + `Page.bringToFront`, then *probes*
  pointer lock in a caught evaluate before clicking the canvas. With focus emulation, pointer
  lock succeeds in this environment and mouse attacks are exercised for real. If a future
  environment refuses it, the probe skips the canvas click (Q sweep still exercises combat) and
  the limitation is listed in the report instead of producing a false page error.
- `#hud`/`.vignette` are hidden only for the canvas pixel measurement and restored immediately.
- Baseline used `--skip-build` because the shared worktree already contained teammates'
  in-flight edits when QA ran; `dist/client` was the pre-batch production build (verified it
  contains HEAD's `All five weapons recovered.` string and predates the batch). The final run
  builds automatically from the integrated tree.
- `/favicon.ico` is requested by Chrome and 404s from the Express server. It is logged as a
  cosmetic network log entry, excluded from the 4xx gate. Not a game defect.

## Baseline run (pre-batch HEAD)

- Command: `node scripts/smoke-browser.mjs --out qa/baseline --skip-build`
- Code: HEAD `d161f92` production build (`dist/client`), run 2026-10-23 22:17:38 → 22:18:16
  (37.6 s).
- **Result: PASS — 16/16 gates.**
- Page errors: **none**. Console errors: **none**. Log-level errors: 2 (both `/favicon.ico`
  404). Internal requests: 45; asset requests: 42 (`/assets/**`), 0 4xx/5xx, 0 failed.
- HUD text observed (verbatim):
  - `QA Knight` · `120 / 120 HEALTH` · `100 STAMINA · LIGHT ARMOR`
  - `Longsword · Ready · R / LB` · `WASD · MOUSE · V VIEW · G GUIDE`
  - `Third person · V / Y` (toggled to `First person · V / Y` and back)
  - `WOOD 24 IRON 14 HEAL 5 RECRUITS 0` (ticked to `WOOD 26 IRON 15 …` during the run →
    authoritative server simulation is live)
  - `◇ Fallen Keep LOST ◇ Border Fortress LOST ◇ High Citadel LOST`
  - `← WEAPON · Warhammer · 4m` → `8m` after moving; `Survivors rescued 0 / 9`;
    `Plague nest · protected`; `RECOVERY · 145s until next warning · loot, heal and fortify`
  - `#weaponCards` = **5** at baseline (expected 8 after the armory batch lands).
- Canvas pixel stats (HUD hidden, screenshot decoded in-page):

| Shot | mean lum | std | non-dark | unique colours |
| --- | --- | --- | --- | --- |
| third person | 56.0 | 34.2 | 97.8 % | 1300 |
| first person | 64.4 | 41.9 | 94.7 % | 1214 |
| combat | 65.6 | 49.5 | 91.7 % | 1222 |

- FPS during idle measurement: 3.3 (SwiftShader; not representative).
- Pointer lock: granted after focus emulation; mouse attack + movement + Q sweep all registered
  (`stamina 100 → 92`, `Sweep · 5s` cooldown, HUD toast `Finish your attack first.` when Q was
  pressed mid-swing).

### Screenshots (baseline)

All in `qa/baseline/` (1584 × 805 PNG):

- `00-landing.png` — landing page over the live 3D scene.
- `01-third-person.png` — spawn, third person.
- `02-first-person.png` — first person, sword/shield viewmodel.
- `03-combat.png` — first person mid-attack (sword swung across view).
- `04-third-person-return.png` — third person after movement + combat.

### Visual assessment of the baseline (inspected with image tooling)

What is actually on screen:

- **Landing**: dark green/teal night scene behind the UI — the Fallen Keep silhouette with blue
  tower roofs, lit gate/camp glow, scattered rocks, trees, a pale road, grass tufts; gold-on-
  cream wordmark, name input, character select (`Crusader`), gold "Begin a campaign" button,
  room-code row, right-hand caption "01 / THE FALLEN KEEP — Every light is a promise that
  someone is still alive." UI is legible.
- **Third person spawn**: castle gate ahead with two white-roofed towers, red banner, two
  skeletal defenders visible in the courtyard, stone road, grass tufts, boulders, distant
  treeline/mountains. Player knight is centre-bottom. HUD (objectives, resources, minimap,
  vitals, troop bar, compass) is all readable.
- **First person**: sword held upright on the right, textured kite shield bottom-left, `+`
  crosshair, road leading to the gate, `BASTARD SWORD` world label over the gate. Reads well.
- **Combat**: same first-person view after moving ~8 m forward; sword mid-swing across the
  lower frame, stamina drained to 92, sweep cooldown shown, skeletons closing in.
- **Third-person return**: several NPC knights in dark armour around the player, an enemy group
  (skeletons + one bright white humanoid) left of the road on/near a weapon-ring decal,
  player centre with sword, loot glints (white diamonds), live HUD.

Concrete defects seen in the baseline (baseline comparisons for the batch):

1. **Spawn view is dominated by a giant world-space weapon label.** In third person at spawn,
   the `WARHAMMER` rack label (a ~25-character text plane plus a large translucent backing
   quad) covers roughly the lower centre-third of the screen, hiding the player character and
   the rack itself; it only clears after moving/turning. The new 3D weapon-rack displays
   planned in `ruins.ts` must not repeat this (labels should be distance-faded, scaled down, or
   only shown when looked at). See `01-third-person.png`.
2. **Landing-page footer overlaps content at this viewport.** At 1584 × 805 the absolute footer
   text (`REAL-TIME COOPERATIVE SURVIVAL`, `WOOD. IRON. A LITTLE COURAGE.`) collides with the
   room-code input and is clipped at the right edge; the existing `max-height:750px` media
   query does not catch 805 px. Suggest an additional ≤ 830 px-height rule or flow layout for
   the join box. See `00-landing.png`.
3. **Overall scene is very dark / low contrast.** Castle facades, the road shadow band and most
   character bodies are near-black in the baseline; enemies are hard to read against the ground
   (consistent with the previous checkpoint's note). The batch's post-FX/atmosphere work should
   raise key/fill light, exposure or local contrast in the play area.
4. **NPC/character silhouette readability**: in `04-third-person-return.png` the two nearby
   armoured NPCs render almost pure black (no readable material detail), while one
   enemy-side humanoid beside the skeletons renders as a flat, untextured **white** silhouette.
   Worth checking the material/lighting path for NPC variants (possibly a missing texture or
   emissive fallback).
5. First-person sword blade is nearly pure black against the shield's textured metal; may be
   intended dark steel, but it reads as unlit.
6. `/favicon.ico` 404 (cosmetic; excluded from gates).

Status after integration: 1 **fixed**, 2 **fixed**, 3 **improved** (scene much brighter, see
final run), 4 **fixed / not reproducible** (no pure-white or pure-black NPCs in any final shot),
5 **improved** (blade catches light), 6 **unchanged** (cosmetic).

## Final integration run — 2026-10-23 22:38:37 → 22:39:52 (PASS)

```bat
cd C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build
$node = "C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
& $node scripts/smoke-browser.mjs --out qa/final
```

- **Result: PASS — 16/16 gates** (74.8 s total). Fresh `vite build` from the integrated working
  tree in 1.6 s with bundled Node v24.21.0 → `dist/client/assets/index-CS9GEA8s.js` (758,526 B) +
  `index-DSURmr1-.css`.
- Page errors: **0**. Console errors: **0**. Log-level errors: **0**. Bad responses: **0**;
  failed requests: **0**. Internal requests: 53, of which 52 are `/assets/**`.
- Console warning (1, informational): `THREE.GLTFLoader: Unknown extension
  "KHR_materials_pbrSpecularGlossiness"` — comes from the **pre-existing** `custom/gatehouse.glb.gz`
  (the baseline run logged the same warning; none of the 14 new assets use that extension).
- WebSocket lifecycle: `instances=1, opens=1, closes=0, errors=0, url ws://…/ws?room=6B6C7A` —
  **no disconnect/reconnect**, so the "Connection lost. Reconnecting…" toast seen at ~1.4 fps on
  the software renderer did not reproduce.
- Pointer lock: granted; real mouse attack + `W` movement + `Q` sweep exercised. Camera modes
  toggled `Third person · V / Y` → `First person · V / Y` → back.
- HUD observed: `QA Knight` · `120 / 120 HEALTH` · `100 STAMINA · LIGHT ARMOR` ·
  `Longsword · Ready · R / LB`; `#weaponCards` = **8**; `WOOD 24 IRON 14 HEAL 5 RECRUITS 0` ticked
  to `WOOD 28 IRON 16 …` during the run (live authoritative sim); `◇ Fallen Keep LOST …`;
  wayfinder `← WEAPON · Warhammer · 4m` → `8m`; end-of-run event toast
  `An Oathsworn has fallen. Corruption rises in 7 seconds.` (a companion was downed during combat).
- FPS: 1.6 (SwiftShader; baseline 3.3). Software-render cost of bloom/PMREM/denser trees,
  expected; the 150 s HUD budget and all canvas gates were comfortably met.
- Canvas pixel stats (HUD hidden, decoded in-page) — brighter and richer than baseline:

| Shot | mean lum | std | non-dark | unique colours | baseline std |
| --- | --- | --- | --- | --- | --- |
| third person | 77.1 | 59.2 | 98.0 % | 1558 | 34.2 |
| first person | 100.9 | 60.8 | 97.9 % | 1695 | 41.9 |
| combat | 102.4 | 63.5 | 97.3 % | 1343 | 49.5 |

### Asset load log (all new batch files fetched, HTTP 200, no 404s)

- Models: `custom/rapier`, `halberd`, `dane_axe`, `fortress_keep`, `castle_tower`, `chapel_ruin`,
  `aqueduct_ruin`, `bridge_ruin`, `courtyard_ruin`, `well`, `chest`, `bench`, `grass_tuft`,
  `rock_cluster` (all `.glb.gz`).
- Textures: `textures/road_country_basecolor.jpg`, `road_country_normal.png`,
  `cobblestone_basecolor.jpg`, `cobblestone_normal.png`.

### Screenshots (final)

All in `qa/final/` (1584 × 805 PNG):

- `00-landing.png` — landing over the upgraded scene (chapel ruin, keeps, towers, grass).
- `01-third-person.png` — spawn, third person (label band gone, readable characters).
- `02-first-person.png` — first person, sword/shield, bright cobbled road, fortress keep.
- `03-combat.png` — first person at the gate facing skeleton defenders.
- `04-third-person-return.png` — third person, downed companion + combat particles, ruins/scatter.

### Visual assessment of the final run (inspected with image tooling)

Checks requested by the Lead:

- **(a) WARHAMMER rack-label band: GONE.** The giant text plane + translucent backing that hid
  the spawn view in the baseline is gone; only a dim, small label remains near the foreground
  rack. The player, rack and courtyard are unobstructed. ✅
- **(b) Characters: fixed.** No pure-white untextured humanoid anywhere (the baseline white
  silhouette is gone); no pure-black bodies. Skeletons are bone-textured, companions are dark
  armoured knights with readable rim/fill light. Combat particles (white sparks) render around
  hits. ✅
- **(c) New content renders.** The Fallen Keep now uses `fortress_keep` instead of dark boxes,
  `castle_tower` crenellated masonry towers replace the old blue cone tops, and the gothic chapel
  ruin, aqueduct/arch ruins and broken walls are visible on the landing scene and along the road.
  Cobblestone road + road texture, `grass_tuft` and `rock_cluster` scatter, wells/benches/camp
  props and 3D weapon racks are present. Torches/lanterns glow, ground materials read as stone
  rather than flat grey. ✅
- **(d) 8 weapon cards:** DOM snapshot reports `#weaponCards = 8`. ✅
- **(e) Landing footer overlap: fixed.** At 1584 × 805 the join box ends above the features row
  and the footer (`REAL-TIME COOPERATIVE SURVIVAL` / `WOOD. IRON. A LITTLE COURAGE.`) is fully
  visible with no collision or clipping against the ROOM CODE row. ✅

Still worth a look (blunt):

1. **Terrain reads as a patchwork.** Bright green grass polygons sit with hard, straight edges
   against near-black ground on either side of the cobbled road (clearest in `01` and `04`).
   Likely a surface-tagging/tint-boundary or lighting issue rather than a texture problem — it
   looks like only some ground regions receive the lit material. Not a blocker, but it is the
   most noticeable visual seam in the final build.
2. **Atmosphere is now pale grey-green / overcast rather than the established dark night.** The
   whole sky/fog/horizon is washed light and bloom haze lifts the distance; the night mood of the
   baseline is largely gone. Deliberate or not, this is a stylistic shift worth a product call
   (the brightness itself is an improvement; the "washed" sky is the questionable part).
3. Player/NPC bodies are still on the dark side in third person — readable now (unlike baseline),
   but faces/armour detail only resolves up close.
4. `03-combat.png` was captured after the swing had already finished (1.6 fps software renderer
   timing), so it shows the gate and defenders rather than a mid-swing blade; combat itself was
   exercised and fired. Not a game defect.
5. Pre-existing, unchanged: `gatehouse.glb.gz` spec-gloss extension warning and `/favicon.ico`
   404 (cosmetic).

No missing models, no page errors, no asset 404s, HUD fully readable. **Green for the Lead's
commit/deploy gate.**
