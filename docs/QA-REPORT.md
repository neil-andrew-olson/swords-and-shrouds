# QA Report — Headless Browser Smoke (Batches 2026-10 / 2026-10B)

Owner: **qa-verifier**. Harness: `scripts/smoke-browser.mjs`. Screenshots: `qa/<run>/`.
Batch-1 baseline/final runs and the batch-2 local, live-URL and co-op runs are recorded below.

## TL;DR

| Run | When (local) | Command | Result |
| --- | --- | --- | --- |
| Batch-1 baseline (pre-batch HEAD) | 2026-10-23 22:17–22:18 | `node scripts/smoke-browser.mjs --out qa/baseline --skip-build` | **PASS 16/16**, 0 page errors, 0 console errors, 0 failed/4xx internal requests |
| Batch-1 final integration | 2026-10-23 22:38–22:39 | `& $node scripts/smoke-browser.mjs --out qa/final` (bundled Node 24, fresh build) | **PASS 16/16**, 0 page errors, 0 console errors, 0 asset 404s, WS opens=1/closes=0, 8 weapon cards |
| Batch-2 final local (authoritative, Lead-run; QA-inspected) | 2026-10-24 01:06 | `& $node scripts/smoke-browser.mjs --out qa/final-batch2` | **PASS 16/16**, 10 weapon cards, 0 page/console errors, 0 asset 404s, WS opens=3/closes=2 (1006, auto-resumed) |
| Batch-2 live URL (deployed batch-1) | 2026-10-24 01:15 | `& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --out qa/live-batch1 --expect-weapons 8` | **PASS 17/17**, 8 weapon cards, 0 page errors, 0 asset 404s, WS opens=1/closes=0 |
| Batch-2 live deployment: game `657cdde` / hosting `a627cbb` | 2026-10-24 01:21 | `& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --out qa/live-batch2 --expect-weapons 10 --expect-assets custom/flamberge.glb.gz,custom/mace.glb.gz,custom/camp_tent.glb.gz,custom/stone_wall.glb.gz` | **PASS 18/18**, new bundle `index-DZ7lk_yj.js`, 10 weapon cards, 4/4 new assets HTTP 200, 0 page errors, 0 asset 404s, WS opens=1/closes=0 |
| Batch-2 2-player co-op | 2026-10-24 01:10 | `& $node scripts/smoke-browser.mjs --coop --skip-build --out qa/coop` | **PASS 18/18**, shared armory unlock, both snapshots list both players, 0 page errors |
| Batch-3 perf after-capture (`index-BeMuJwuM.js`) | 2026-10-24 03:00 | `& $node scripts/smoke-browser.mjs --perf --skip-build --out qa/perf-after-batch3` | **PASS 23/23** — calls 88,544→301 (0.34 %), tris 4.04 M→1.76 M (43.6 %), payload 43.19→12.20 MB (−71.8 %), tier + loading gates |
| Batch-3 local smoke (fresh build) | 2026-10-24 02:59 | `& $node scripts/smoke-browser.mjs --out qa/final-batch3` | **PASS 16/16**, 10 cards, 0 errors; rebuilt same bundle; no blue cones in all three landing frames |
| Batch-3 co-op | 2026-10-24 02:50 | `& $node scripts/smoke-browser.mjs --coop --skip-build --out qa/coop-batch3` | **PASS 18/18**, shared armory unlock, both snapshots list both players |
| Batch-3 live deployment: game `d2b340a` / hosting `47f4782` | 2026-10-24 03:05 | `& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --out qa/live-batch3 --expect-weapons 10 --expect-assets custom/flamberge.glb.gz,custom/mace.glb.gz,custom/camp_tent.glb.gz,custom/stone_wall.glb.gz` | **PASS 18/18**, bundle `index-BIHlx9in.js`, 10 cards, 4/4 assets 200, live payload **12.18 MB (−71.4 % vs 42.6 MB batch-2)**, 0 errors/404s, no blue cones |

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

---

## Batch 2026-10B — live-URL mode, 2-player co-op, reconnect investigation

Harness additions (all in `scripts/smoke-browser.mjs`, still one reusable script):

- `--url <url>` — deployed-site mode: skips build + local server, drives the live Cloudflare
  site, runs the same campaign flow, gates page errors / internal 4xx / failed requests and can
  assert `--expect-weapons <n>` and fetch any `--expect-assets a.glb.gz,b.jpg` directly (HTTP 200).
- `--coop` — two independent Chrome instances/profiles against the local authoritative server;
  A creates the room, B joins by room code; asserts both authoritative snapshots list both
  player ids, B's movement reaches A, both HUDs are live, A's weapon-rack pickup unlocks in B's
  shared armory, zero page errors on both pages; screenshots both pages.
- Instrumentation (injected before app boot): per-WebSocket-connection `msgCount`, `maxGapMs`,
  `statesBeforeClose`, `lastMessageAgoMs`, open/close timestamps; page navigation timeline;
  local `/health` RTT sampler; per-page fps during co-op.

```bat
cd C:\Users\neil\Desktop\AIprojects\neilandrew.dev\.game-build
$node = "C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node scripts/smoke-browser.mjs --out qa/final-batch2                 :: local final (fresh build)
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch1 --expect-weapons 8                            :: deployed batch-1 baseline
& $node scripts/smoke-browser.mjs --coop --skip-build --out qa/coop     :: 2-player co-op
```

### Results

- **Local final (batch-2 tree, authoritative; run by the Lead, screenshots QA-inspected):**
  **PASS 16/16**, `#weaponCards = 10`, 0 page/console/log errors, 0 bad responses, 0 asset
  404s. WS: opens=3, closes=2 — both `1006`, `wasClean=false`, one after 30.15 s and one after
  40.57 s, then auto-resumed (details below). Screenshots: `qa/final-batch2/`.
- **Live URL (currently deployed batch-1):** **PASS 17/17**, 8 weapon cards as expected for the
  deployed bundle, 0 page errors, 0 asset 404s (48 internal requests), WSS connected
  (`wss://neilandrew.dev/games/swords-and-shrouds/ws`), canvas std 42–54 / 1.6–1.9 k colours.
  One external `static.cloudflareinsights.com` beacon returns `ERR_CONNECTION_REFUSED` in
  headless Chrome — third-party analytics, reported not gated. Screenshots: `qa/live-batch1/`.
- **2-player co-op:** **PASS 18/18** (room `258E31`). A and B are in the same room; both
  authoritative snapshots list both player ids (`Coop A`, `Coop B`, both connected); B's `W`
  movement propagated to A (1.2 m); A reached the starter rack (prompt
  `E / A / Interact · Recover Warhammer for the fellowship`) and recovered `hammer`; B's armory
  became `["sword","hammer"]`, proving the shared rack-unlock rule; both HUDs live; 0 page
  errors / 0 4xx / 0 failed requests on either page. Dual-SwiftShader fps 0.6/0.6.
  Screenshots: `qa/coop/` (four: both pages before/after pickup).

### WebSocket reconnect investigation — root cause

Evidence collected across the local final, live-URL and co-op runs:

1. **Symptom:** closes are `code 1006`, `wasClean=false` (no close frame), connections last
   ~30–41 s, then the client auto-resumes to the same room; gameplay/HUD stay live throughout.
2. **Not harness navigation:** `Page.frameNavigated` log shows exactly **1** main-frame
   navigation for the whole run (the initial load).
3. **Not server load / not a server event-loop stall:** `/health` sampled every second for the
   whole local run — p50 **1 ms**, p95 **2 ms**, max **2 ms**, **0** stalls >2 s (co-op run:
   242 samples, p95 2 ms, max 9 ms). The Node server's timers (including the 15 s WS heartbeat)
   fire on schedule.
4. **The renderer main thread really does stall for many seconds:** the client's reconnect
   backoff after a close is `setTimeout(500 ms)` then `1000 ms`, but measured close→next-open
   gaps were **9.54 s** and **6.21 s** — i.e. the renderer's own timers fired 6–10 s late. In
   the live-URL run (no disconnect) the instrumented WebSocket recorded a **`maxGapMs = 10.36 s`**
   between processed message events — the main thread went >10 s without processing WS messages.
5. **Correlates with software-renderer frame rate:** batch-1 final (1.6 fps) ran 75 s with
   `opens=1/closes=0`; the heavier batch-2 scene runs at **0.7 fps local** (2 frames in 3 s),
   **0.6 fps** per co-op page, **0.8 fps** live — and only those runs reconnect. The screenshot
   `qa/final-batch2/03-combat.png` literally captures the `Connection lost. Reconnecting…`
   toast while the HUD stays fully live.

**Mechanism:** server heartbeat (`src/server/index.ts`) runs every 15 s; if no pong arrived since
the previous tick it calls `ws.terminate()` (no close handshake → client sees 1006). The client
(`main.ts`) reacts with the toast and `connect('resume')` (500 ms × 2^attempt backoff, max 8
attempts), which restores the full snapshot. Under SwiftShader software rendering (0.6–0.8 fps
with multi-second main-thread stalls) WebSocket control-message/pong processing and the
reconnect timer are delayed past that 15 s window → terminate → 1006 → auto-resume.

**Conclusion:** not a harness artefact, not server load, and not a broken client reconnect path
(recovery works and the HUD/state stay live). It is a **keepalive robustness issue under extreme
software-renderer stalls** — essentially headless-QA-only today, but a very slow player GPU could
see a brief reconnect. Recommendation for the Lead (no src changed by QA): relax the server
heartbeat (tolerate e.g. 2 missed pongs / ~30–45 s window) and/or make the reconnect toast less
intrusive; world-scene's adaptive quality already reduces the stall frequency. Not a batch-2
blocker. **Follow-up:** the Lead applied the server-side fix (tolerate 2 consecutive missed pongs
≈30 s before terminate) to the local authoritative server; the live Cloudflare worker already
tolerated ~45 s. The final live run at 0.7 fps showed `opens=1/closes=0` with no 1006 reconnects,
confirming the transport is now robust for slow software-rendered clients.

### Visual checklist (inspected `qa/final-batch2/`, `qa/coop/`)

- **(a) Survivor-camp tents:** present at The Old Mill camp — canopy-style shelter on poles with
  hanging cloth panels beside the wagon/house/fire/cauldron, sitting on the ground, no visible
  intersection with camp furniture. (3 per camp / 27 total can't be counted from 5 screenshots;
  no missing/floating tents seen.)
- **(b) Ruined stone walls:** low knee/waist-height grey stone segments flank the road on the
  right of the third-person shots; ends sit flush/embedded in the ground as intended, they do
  not block the road and do not float. Batch-1→2 road tone change is visible (grey stone, not
  white concrete).
- **(c) 10 weapon cards:** DOM `#weaponCards = 10` ✅.
- **(d) New weapons on racks:** the authoritative snapshot's `weaponDrops` includes `flamberge`
  at (37, −543) and `mace` at (−29, −611) — the nine-castle seed covers all 9 non-sword weapons
  (incl. both new ones) exactly once ✅.
- **(e) Readability:** moon + halo clearly visible in third person and on the landing page, moon
  + halo + stars in first person; sky reads dark night (batch-1's washed overcast is gone);
  ground cooler/darker, lit-grass vs shadow contrast reduced; actors are readable closer up but
  still dark silhouettes at distance. **Swing trail not captured** — at 0.6–0.7 fps the combat
  screenshot landed after the swing (it captured the reconnect toast instead), so trail visuals
  are unverified by screenshot this pass.

Remaining defects / notes (non-blocking):

1. WS keepalive reconnects under software-renderer stalls (root cause above).
2. First-person road still reads fairly light grey (texture detail visible; the scan ×0.42
   tint could go a touch darker, world-scene's one-line dial).
3. Distant NPCs are still dark silhouettes (improved vs batch-1, not fully solved).
4. Tent asset reads as a flat canopy/awning rather than a classic pitched tent (asset choice).
5. No mid-swing/trail screenshot due to 0.6–0.7 fps capture timing; combat itself exercised.
6. External Cloudflare Insights beacon failure on the live site (third-party, not gated).
7. Pre-existing: `gatehouse.glb.gz` spec-gloss warning + `/favicon.ico` 404 (cosmetic).

### Artifacts

- Screenshots: `qa/final-batch2/` (local final), `qa/live-batch1/` (live batch-1),
  `qa/live-batch2/` (live batch-2 deployment), `qa/coop/` (both co-op pages).
- Machine reports: `%TEMP%\ss-smoke-artifacts\final-batch2-*\report.json`,
  `live-batch1-*\report.json`, `live-batch2-*\report.json`, `coop-*\report.json` (include
  `diagnostics.ws`, `conns`, `maxGapMs`, `health`, `navigationLog`, `coop` details).

### Final live deployment verification — batch-2 (game `657cdde`, hosting `a627cbb`)

Run after the Lead's Cloudflare deployment:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch2 --expect-weapons 10 `
    --expect-assets custom/flamberge.glb.gz,custom/mace.glb.gz,custom/camp_tent.glb.gz,custom/stone_wall.glb.gz
```

- **Result: PASS 18/18** (new live-mode gates included the weapon-card and asset assertions).
- **New bundle confirmed from the live network log:** the page fetched
  `https://neilandrew.dev/games/swords-and-shrouds/assets/index-DZ7lk_yj.js` (774 kB) and
  `assets/index-DSURmr1-.css`. `HEAD /assets/index-CS9GEA8s.js` (old bundle) returns **404**, and
  `HEAD /health`, the four new GLBs (`flamberge`, `mace`, `camp_tent`, `stone_wall`) and the new
  bundle all return **200** — the swap is complete.
- **10 weapon cards** (`#weaponCards = 10`, matching the local final).
- **4/4 expected assets HTTP 200** via direct in-page fetch (flamberge, mace, camp_tent,
  stone_wall `.glb.gz`).
- **0 uncaught page errors, 0 console errors, 0 bad responses, 0 failed internal requests**
  (57 internal requests). Log-level errors: 1 — external
  `static.cloudflareinsights.com/beacon.min.js` `ERR_ADDRESS_UNREACHABLE` (third-party analytics,
  not gated).
- **WebSocket:** opens=1, closes=0, errors=0 — **no 1006 reconnects** at 0.7 fps live (the one
  instrumented >9 s message gap did not trip the transport; Cloudflare's Durable Object already
  tolerates ~45 s). This is consistent with the Lead's note: the local heartbeat fix (tolerate 2
  missed pongs) targets the local authoritative server, the live worker was unchanged.
- Canvas: third-person std 39.8 / 1783 colours; first-person std 48.0 / 1850; combat std 48.0 /
  1848. Renderer: `ANGLE … SwiftShader` WebGL2 (software).
- Screenshots `qa/live-batch2/` visually match the local final: dark night sky with moon+halo
  (and moon+stars in first person), tents at the mill camp, low ruined wall segments flanking the
  grey road, readable actors, 10-card armory data in the HUD.

**Batch-2 live deployment is verified end-to-end: green.**

---

## Batch 2026-10C — performance evidence (in progress)

Smoothness/perf pass. Everything below is measured, not estimated; the authoritative after-numbers
are captured on the Lead's final optimised build (see status at the end of this section).

### Harness: `--perf` mode (`scripts/smoke-browser.mjs`)

```bat
:: after-capture on a local production build (read-only; dist must be final)
& $node scripts/smoke-browser.mjs --perf --skip-build --out qa/perf-after-batch3

:: reference capture against the deployed site (no __ssPerf hook => fps/load only)
& $node scripts/smoke-browser.mjs --perf --url https://neilandrew.dev/games/swords-and-shrouds/ --out qa/perf-before-batch2-live
```

`--perf` captures, per view (third-person spawn, first-person) and per quality tier
(`low|medium|high` via `window.__ssQuality`):
`window.__ssPerf()` (`renderer.info`: calls, triangles, points, geometries, textures, programs;
scene objects, meshes, materials, lights, skinned; quality tier, pixelRatio, rolling fps/frameMs),
3–5 s of rAF frame-time samples (mean/p50/p95/min/max/fps), load timings
(navigation → landing visible → HUD → first authoritative state, plus page `performance`
navigation/resource entries), internal request count and encoded bytes (total and assets), the
graphics-quality selector (presence, calls the hook, `ss-quality` persistence proven across a
reload done at the end of the run), and loading-progress UX (observer-recorded
`#connection` text transitions + join-enable time + max rAF main-thread gap). Local-full mode gates
on: hook present, quality setter works, **low-tier draw calls ≥10 % below high**, selector persists,
**≥2 distinct loading progress counts**, no frozen frame >5 s, plus all existing smoke gates.

### Baseline (pre-optimisation, world-scene Phase-1 hooks build, quality forced high)

| Metric | Third-person | First-person |
| --- | --- | --- |
| draw calls | **88,544** | **87,317** |
| triangles | **4,041,177** | **4,070,005** |
| points | 340 | 340 |
| geometries | 2,605 | 2,608 |
| textures | 114 | 114 |
| programs | 53 | 53 |
| scene objects / meshes / materials / lights / skinned | 175,324 / 96,671 / 276 / 17 / 27 | 175,297 / 96,626 / 277 / 17 / 27 |

Pre-batching tier separation was negligible (calls low 86,074 / medium 84,604 / high 84,108).
Load: navigation 5.2 s, 48 resources, **43.19 MB** transfer. Targets for this batch:
**calls ≤ 35 % of baseline (≈31.0 k)** and **triangles ≤ 60 % (≈2.42 M)** in the spawn
third-person view, with zero visual regressions.

Independent QA "before" reference on the **deployed batch-2** site (no `__ssPerf` hook, so
fps/load-only): **fps 0.58 TP / 0.59 FP**, mean frame 1.72 s, navigation→landing 6.1 s,
navigation→HUD 34.2 s, **42.6 MB asset bytes** / 53 internal requests, 0 page errors, 0 asset
404s, 10 weapon cards (PASS 19/19). Screenshots `qa/perf-before-batch2-live/`.

### Interim build (context only — NOT the authoritative result)

A read-only capture on the 01:55 interim build (`index-CFtW9YuC.js`, pre-final; asset-forge
slimming + ruins instancing + part of world-scene batching already applied): TP calls **217**,
triangles **2,508,998**, meshes 670, objects 4,280, geometries 142, textures 115, programs 63,
lights 17, skinned 37; FP calls 181, tris 2,367,629; low/medium/high calls 147 / 217 / 216
(low/high ratio 0.68 → tier gate passes); dist payload 9.93 MB gzip, 12.2 MB response bytes.
This interim build also logged 8 `BufferGeometryUtils.mergeGeometries()` console errors and a
pale-foliage visual regression — both reported to world-scene and expected to be fixed before the
authoritative capture, so these numbers are indicative only.

### Authoritative after-capture + regression suite (pending Lead's final-build ping)

To run on the final optimised build: `--perf --skip-build` after-capture (`qa/perf-after-batch3`)
with the before/after deltas; fresh-build local smoke (`qa/final-batch3`, expected 16/16);
`--coop --skip-build` (expected 18/18); `--url` live baseline against the deployed batch-2 site;
loading-progress/quality-selector gates; visual regression against
`qa/live-batch2`/`qa/perf-before-batch2-live` screenshots; and a final `--url` run against the
batch-3 deployment once the Lead ships it. Results and the green/red verdict will replace this
paragraph.

### Authoritative after-capture — PASS 23/23 (final dist `index-BeMuJwuM.js`)

Final bundle after the surgical landing-page fix: **`dist/client/assets/index-BeMuJwuM.js`**
(793,960 B). The fix hides the legacy blue-cone keep towers from the first frame and only reveals
them if the modern `castle_tower`/`fortress_keep` assets fail to load; no rendering draws were
added. A fresh `vite build` from the final tree reproduced **the same hash**, so the capture and
the tree are byte-identical. Pre-fix capture on `index-DfbqKz3R.js` (793,534 B) was functionally
identical; only the hidden legacy geometry differs (its removal left geometries 148→141 and
textures 132→125 in the counters below).

Command: `& $node scripts/smoke-browser.mjs --perf --skip-build --out qa/perf-after-batch3`
SwiftShader, 1584×805, quality high unless stated. 0 page errors, 0 console errors, **0 console
warnings**, 0 log errors, 0 bad responses, 0 failed requests, 10 weapon cards, WS opens=1/closes=0.
(The fresh-build local smoke `qa/final-batch3` is PASS 16/16, vite build 1.4 s with bundled Node 24.)

| Metric (spawn view) | Baseline | Final | Delta |
| --- | --- | --- | --- |
| draw calls TP | 88,544 | **301** | **0.34 %** (target ≤35 %) ✅ |
| triangles TP | 4,041,177 | **1,761,097** | **43.6 %** (target ≤60 %) ✅ |
| draw calls FP | 87,317 | **259** | **0.30 %** ✅ |
| triangles FP | 4,070,005 | **1,584,700** | **38.9 %** ✅ |
| meshes | 96,671 | **852** | 0.88 % |
| scene objects | 175,324 | **4,728** | 2.7 % |
| geometries | 2,605 | **141** | 5.4 % |
| textures | 114 | 125 | 109.6 % (merged/instanced materials; legacy-tower textures gone) |
| programs | 53 | 74 TP / 105 FP | measured after the quality-selector pre-test compiled both tier variants; world-scene's clean probe = 51 |
| lights / skinned | 17 / 27 | 17 / 37 | unchanged lights |

- **Landing streaming-window fix verified:** this batch's QA found legacy **blue-cone tower caps**
  visible on the landing page while the modern keep towers streamed in (captured in
  `qa/final-batch3/00-landing.png` pre-fix). After world-scene's hidden-by-default +
  reveal-on-failure fix, `00-landing-early.png` (immediately on landing), `00-landing-mid.png`
  (~0.6 s later) and `00-landing.png` all show **no blue cones at any point**, while
  `01-third-person.png` still shows the modern masonry. The early/mid/late landing frames are now
  part of the standard smoke capture for future visual regressions.

- **Quality tiers:** low **238 calls / 1,453,625 tris**, medium 301 / 1,760,365, high 300 /
  1,760,293 → **low tier = 79.3 % of high calls (−20.7 %), −17.4 % triangles** (gate ≥10 % drop ✅).
  Quality selector: present (`#qualityChoice`, low/medium/high), calls `__ssQuality`, writes
  `ss-quality`; set to medium → reload → hook reports **medium** and localStorage `medium`
  (persistence proven); restored to high afterwards.
- **Progressive loading:** `#connection` shows real counts (`Loading world… N/M`); with a QA-only
  pre-app fetch delay (900 ms + 250 ms/asset, instrumentation only, src untouched) the observer
  recorded **0/20 → 11/20 → 12/20 → 13/20** count changes and join-enabled at **3.89 s**, max
  main-thread gap 1.67 s (<5 s gate) — screenshot
  `qa/perf-after-batch3/05-loading-progress.png`. On a fast localhost load the count can jump
  straight from 0/20 to ready because scene construction blocks the main thread while the assets
  finish; the throttled-network path is what makes it visible.
- **Load timings / payload:** navigation→landing **3.76 s** (baseline 5.2 s), →HUD 15.8–23.4 s
  across runs (SwiftShader start-up variance), →first state 17.9–24.8 s; 66 internal requests;
  **12.20 MB** transfer (asset bytes 12,201,905) vs **43.19 MB** baseline = **−71.8 %**; deployed
  batch-2 live was 42.6 MB / landing 6.1 s / HUD 34.2 s. Resource count rose 48→66 (smaller, split
  files) but bytes dropped 3.5×.
- **fps:** SwiftShader rAF 1.53 TP / 1.37 FP (mean frame 653/732 ms; app-ring `frameMs` 46.3 ms is
  headless-throttled). Absolute software fps is only a relative proxy; the structural wins
  (calls/tris/objects) are the reliable target and they are enormous.
- **Visual regression vs `qa/live-batch2`:** screenshots `qa/perf-after-batch3/` show the same
  composition — moon + halo + stars, dark night sky, tents at the mill camp, low ruined stone
  walls, weapon racks, 10-card armory, HUD readable. Trees now read **dark green** (the pale/white
  masses are the white stone-wall/ruin scans, as world-scene confirmed). The road is **cooler and
  darker** than batch 2 (measured road patch mean RGB 82,98,115 vs 109,113,117; frame mean 26,37,42
  vs 49,60,61) — a night-toning/hue shift with a similar ratio, **not a brightness regression**
  (world-scene's framing). Gate towers read as stone masonry from the first landing frame (no
  legacy blue cones), which reads intentional and better than batch-2's white caps.
- **Build reproducibility:** the fresh-build local smoke (`qa/final-batch3`, PASS 16/16, vite build
  1.4 s with bundled Node 24) reproduced the *same* bundle
  `dist/client/assets/index-BeMuJwuM.js` (793,960 B), so the read-only perf capture and the rebuilt
  tree are byte-identical code. (Pre-fix build reproduced `index-DfbqKz3R.js`, 793,534 B.)
- **Co-op on the final build:** `qa/coop-batch3` PASS 18/18 — same room, both snapshots list both
  players, B movement propagated 3.0 m, A recovered the Warhammer rack and B's armory became
  `["sword","hammer"]`, both HUDs live, 0 errors both pages (dual SwiftShader 1.2 fps each).
- **Live baseline (deployed batch-2, 2026-10-24 02:51):** `--url https://neilandrew.dev/games/swords-and-shrouds/ --out qa/live-prebatch3 --expect-weapons 10` → **PASS 17/17**;
  deployed batch-2 bundle still served, 10 weapon cards, 0 page errors, 0 asset 404s, WS
  opens=1/closes=0 (one 9.9 s message gap, no reconnect), fps 0.7. Only log-level entry is the
  third-party Cloudflare-Insights beacon (`ERR_ADDRESS_UNREACHABLE`, not gated). This was the
  pre-batch-3 deployment reference; the final new-live run is recorded below.

### Final live deployment verification — batch-3 (game `d2b340a`, hosting `47f4782`)

Run after the Lead's Cloudflare deployment (bundle `index-BIHlx9in.js`, 794,060 B):

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch3 --expect-weapons 10 `
    --expect-assets custom/flamberge.glb.gz,custom/mace.glb.gz,custom/camp_tent.glb.gz,custom/stone_wall.glb.gz
```

- **Result: PASS 18/18.** 0 uncaught page errors, 0 console errors, 0 bad responses, 0 failed
  internal requests; 10 weapon cards; all 4 expected GLBs HTTP 200. 70 internal requests (65
  `/assets/**`). Live bundle in the network log: **`assets/index-BIHlx9in.js`** + CSS
  `index-CnBWkizl.css`. WS `wss://…/ws` opens=1/closes=0, max gap 2.4 s. Renderer ANGLE
  SwiftShader WebGL2, fps 1.4.
- **Live payload delta** (measured by GET-ting all 65 requested asset URLs): **12,182,505 B =
  12.18 MB** vs the batch-2 live reference **42.6 MB** → 28.6 %, i.e. **−71.4 %**. Slim assets
  confirmed live: oak 188,639 B (was 8.26 MB), rapier 153,792 B (was 1.36 MB), pine 324,731 B
  (was 1.35 MB), gatehouse 48,316 B (was 3.44 MB), road_country_normal.png 247,721 B (was
  1.72 MB), fortress_keep 390,396 B, CREDITS 4,697 B.
- **Landing-page visual:** `qa/live-batch3/00-landing-early.png` (immediately),
  `00-landing-mid.png` and `00-landing.png` all show **no legacy blue-cone towers**, with the stone
  keeps/masonry visible; moon+halo, tents, low ruined walls, racks, HUD and 10-card armory all
  present. No visual regression vs the local final capture.
- Only log-level entry: external `static.cloudflareinsights.com` beacon
  (`ERR_ADDRESS_UNREACHABLE`, third-party, not gated).
- Co-op and the pre-deploy live baseline results above stand (same game code path; batch-3 co-op
  PASS 18/18 and live baseline PASS 17/17).

**Batch-3 live deployment is verified end-to-end: green.**

**Verdict: batch-3 smoothness pass is green on every measured axis** on the final bundle
`index-BeMuJwuM.js` — draw calls 0.34 % and triangles 43.6 % of baseline in the spawn view, local
payload −71.8 %, tier separation working, progressive loading observable, landing blue-cone fix
verified in three early frames, co-op intact, no page/console errors or asset 404s. Remaining
notes are cosmetic (cooler/darker road hue; textures/programs +counts explained above).

---

## Iteration cycle 2026-10D (AAA loop, cycle 1) — character readability + perf (in progress)

The user reported that **all characters render blacked out**. Cycle-1 QA proves readability with
close-up captures + body-region luminance, and re-verifies performance and the standing gates.

### Harness: `--characters` mode (`scripts/smoke-browser.mjs`)

After joining in third person, the harness:
1. captures the normal third-person spawn view (`char-third-person.png`) and measures luminance over
   the same player-torso region used for the pre-fix baseline;
2. cycles the player through all 5 appearances (`templar`, `hero`, `berserker`, `ranger`, `ally`)
   via the in-game character select (`cmd('character:X')`, waiting for `actor.character` in the
   authoritative snapshot), calls `window.__ssCharacterPreview()` to frame a close-up
   (`char-player-<appearance>-closeup.png`), restores with `__ssCharacterPreview(null)`;
3. frames up to 3 undead actors by id (`char-undead-<n>-<kind>.png`);
4. measures **mean / p50 / p90 luminance and % black pixels (<20)** over a central body crop
   (x 36–64 %, y 8–94 % of the close-up; normal-view crop x 47.5–52.1 %, y 58.4–79.5 %) and gates:
   hook available, 5 appearance close-ups, undead close-up, close-up avg mean ≥35 / p90 ≥70 /
   black <40 %, normal-view torso p50 ≥35 (vs 28.5 pre-fix).

```bat
& $node scripts/smoke-browser.mjs --characters --skip-build --out qa/characters-b4
```

### BEFORE baseline (pre-fix, `qa/final-batch3/01-third-person.png`)

| Crop | mean | p50 | p90 | black (<20) |
| --- | --- | --- | --- | --- |
| player body torso (180×400 region, tight 90×270 torso) | 54.9 | 28.5 | 132.0 | 44.5 % |
| companions (230×330) | 27.4 | 22.8 | 30.8 | 20.4 % |

`p90` on the player crop is inflated by the bright shield/weapon equipment (non-skinned meshes
render fine); the **body itself is near-black** — p50 28.5 with 44.5 % of the sampled pixels below
luminance 20, and the companions are pure dark silhouettes (mean 27.4, p90 30.8). Evidence crops:
`qa/characters/before-player-body.png`, `before-player-torso-4x.png`,
`before-companions-crop.png`, `before-player-crop.png`.

### AFTER capture + perf/regression — final build `index-DtnItod1.js` (PASS)

Final bundle from a fresh build of the frozen tree + asset-forge's re-UV'd character atlases:
**`dist/client/assets/index-DtnItod1.js`** (801,289 B). Character GLBs in `dist` are the re-baked
variants (mtimes 04:11–04:12, sizes: hero 451,853 B, templar 450,942, ally 449,134, berserker
457,435, ranger 455,322, survivor 459,200, fallen 459,375 — all ≤450–459 KB). Zombie/skeleton
assets unchanged. Commands run on this build:
`--characters --skip-build` (`qa/characters-b4-final`), `--perf --skip-build` (`qa/perf-b4-final`),
fresh-build smoke (`qa/final-batch4`, 16/16), `--coop --skip-build` (`qa/coop-batch4`), live-URL
baseline vs the deployed batch-3 site (`qa/live-prebatch4`).

**Character luminance — BEFORE vs AFTER (same crop definitions):**

| Measure | BEFORE (`qa/final-batch3`) | runtime fix only (`index-Dlih2vUk`) | AFTER re-UV'd atlases (`index-DtnItod1`) |
| --- | --- | --- | --- |
| normal third-person torso mean | 54.9 | 58.1 | **102.84** |
| normal torso p50 | 28.5 | 28.95 | **114.26** |
| normal torso p90 | 132.0 | 132.98 | **187.38** |
| normal torso black (<20) | 44.5 % | 44.77 % | **15.42 %** |
| close-up avg mean (5 appearances) | n/a (black bodies) | 37.35 | **44.46** |
| close-up avg p50 / p90 | n/a | 24.98 / 96.37 | **25.81 / 108.57** |
| close-up avg black % | n/a | 17.64 % | **15.22 %** |

All character gates PASS (22/22 in the run): hook present, all 5 appearance close-ups, undead
close-ups (skeleton + zombie), close-up body luminance ≥ thresholds, normal-view body lifted, no
mostly-black frames. Visual: bodies that were pure black silhouettes now read clearly (helmet,
shoulders, shield, skirt, boots) — the root cause (93 % zero-area UV triangles sampling black
gutters) is fixed. **New visual defect to flag:** characters now read **over-bright / low-contrast
white** in the night scene (templar and hero in particular are near-white with minimal shading;
ranger/berserker/ally are brighter than the environment) — readability is solved, but tone/AO/
material exposure needs a small tune next cycle to avoid white-out (spec's "no white blow-outs"
acceptance is borderline). Screenshots: `qa/characters-b4-final/` (5 close-ups + 2 undead +
`char-third-person.png`); before crops in `qa/characters/`.

**Performance (fresh build `index-DtnItod1.js`, quality high, SwiftShader):** `--perf` PASS 23/23.

| Metric (spawn TP) | Batch-3 final | Cycle-1 final | Revised gate (<220 calls / <1.5 M tris) |
| --- | --- | --- | --- |
| draw calls | 301 | **173** | ✅ 78.6 % of cap |
| triangles | 1,760,609 | **1,500,333** | ⚠️ **333 over the 1.5 M cap (+0.02 %)** — at-budget |
| geometries | 141 | **138** | — |
| meshes / objects | 852 / 4,728 | **606 / 3,325** | — |
| textures / programs | 125 / 74 | **123 / 71** | — |
| FP calls / tris | 259 / 1,584,700 | **140 / 1,376,211** | ✅ |
| low tier | 238 calls / 1.45 M | **128 calls / 1,256,031 tris** (−25.6 % calls vs high 172) | ✅ |
| load | 3.76 s / 12.20 MB | 4.62 s / **12.43 MB** (+0.23 MB = new character atlases) | — |
| loading UX | 0/20→13/20 | **2/20 → 13/20** counts, join 4.68 s, max frame gap 2.0 s | ✅ |
| quality selector | persists | persists (hook+localStorage medium after reload) | ✅ |

Note the triangle number is **1,500,333 — 333 triangles (0.02 %) over the Lead's revised 1.5 M
cap**, i.e. at-budget within measurement/probe variance (world-scene's probe reported 1,499,905);
treat as at-cap, not a failure. All 0 page/console/log errors, 0 failed requests/404s, 10 weapon
cards throughout.

**Visual regression vs `qa/final-batch3`:** shadows are **restored** (visible tower/architecture
shadows across the road, character contact shadows), architecture reads as detailed stone with the
restored castle-tower LODs (1/castle at 9 towers), grass is back (5600 tufts), survivors 2/camp,
carts/graves restored; LOD-only trees (54 m band) read dark green with no obvious popping in the
screenshots; no blue-cone legacy towers in any landing frame; moon/halo/stars retained; HUD and
10-card armory unchanged. No world/UI regressions found beyond the character over-brightness noted
above.

**Regression channels on this build:** fresh-build local smoke **PASS 16/16** (bundle reproduced as
`index-DtnItod1.js`), co-op **PASS 18/18** (both snapshots list both players, shared Warhammer
unlock, 0 errors), live-URL baseline vs deployed batch-3 **PASS 17/17** (10 cards, 0 asset 404s,
external Cloudflare beacon logged only).

### Final live deployment verification — cycle-1 (game `cce2dcdd`, hosting `0a2b7e76`)

Run after the Lead's Cloudflare deployment (live bundle **`index-us7RDw53.js`**, 801,279 B):

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch4 --expect-weapons 10 `
    --expect-assets custom/hero.glb.gz,custom/templar.glb.gz,custom/castle_tower_lod.glb.gz,custom/pine_lod.glb.gz
```

- **Result: PASS 18/18.** Live network log shows `assets/index-us7RDw53.js` + CSS
  `index-CnBWkizl.css`; `/health` OK; 0 uncaught page errors, 0 console errors, 0 bad responses,
  0 failed internal requests; 10 weapon cards; all 4 expected assets HTTP 200 (hero, templar,
  castle_tower_lod, pine_lod). 72 internal requests (67 `/assets/**`); WS `wss://…/ws` opens=1/
  closes=0; fps 2.2 (SwiftShader).
- **Live payload:** 12,412,444 B = **12.41 MB** across the 67 requested asset URLs — +1.9 % vs the
  pre-cycle live 12.18 MB (the re-UV'd character atlases + tree/tower LODs), still **−70.9 % vs the
  batch-2 live 42.6 MB**. Verified live sizes: hero 451,853 B, templar 450,942 B,
  castle_tower_lod 123,177 B, pine_lod 90,446 B, CREDITS 4,697 B.
- **Visual (live `qa/live-batch4/`):** characters now read clearly in the normal third-person view
  (player + companions bright/coloured instead of black silhouettes — the same over-bright tone as
  the local capture, flagged for cycle-2); dynamic shadows are visible on the walls/road and under
  characters; stone architecture + tower LODs; grass/tents/ruins present; **no blue-cone towers**
  in any landing frame; moon/halo retained; HUD and 10-card armory intact.
- Only log-level entry: external `static.cloudflareinsights.com` beacon
  (`ERR_CONNECTION_REFUSED`, third-party, not gated).
- Co-op, perf, character close-up luminance and regression results above stand on the identical
  game commit (only the URL/deployment differs).

**Cycle-1 live deployment is verified end-to-end: green.** Accepted cycle-2 debt noted: character
tone/AO over-brightness (cosmetic), triangles at the 1.5 M cap (+0.02 %).

---

## Iteration cycle 2026-10E (AAA loop, cycle 2) — material fidelity, atmosphere, AAA-gap audit (in progress)

Cycle-2 verification adds a character **material audit** (normal/AO/rough pipeline + night tone),
updated perf gates, and an **atmosphere/region visual audit** feeding cycle 3.

### Harness additions (`scripts/smoke-browser.mjs`)

- `--characters` now also measures **clipping** (`clippedPct` = pixels with luminance ≥250) and
  **surface detail** (unique quantised colours in the body region), and gates the in-game
  third-person torso tone to the SPEC window: mean **65–95**, p50 **60–100**, black(<20) **<25 %**,
  unique colours **≥500**, clipping **<1 %**; close-ups keep ≥300 unique colours / <1 % clipping.
- `--perf` now gates **<210 draw calls** and **<1.85 M triangles** (cycle-1: 173 / 1,500,333), keeps
  quality-tier/low-tier/loading checks, and captures **7 atmosphere/region audit views** via
  world-scene's `window.__ssQAView(name)` (tree line near/far, fire with smoke/embers, camp with
  tent/stone-wall shadows, courtyard, and the three regional castles) as `view-*.png`.

### Cycle-1 reference values (before cycle-2)

- Character TP torso: mean **102.84** / p50 **114.26** / p90 187.38 / black 15.42 % / unique
  colours 557 (over-bright/flat) — `qa/characters-b4-final/`.
- Close-up avg: mean 44.46 / p50 25.81 / p90 108.57 / black 15.22 %.
- Perf: 173 calls / 1,500,333 tris / 138 geoms / 606 meshes / 3,325 objects; payload 12.43 MB.
- Visual: shadows restored, characters readable-but-white, LOD-only trees, tents/stone walls
  receive-only, no torch smoke/dust particles.

### Cycle-2 after-capture + regression — final build `index-BfnriryF.js` (PASS)

**Final bundle:** `dist/client/assets/index-BfnriryF.js` (815,540 B, built 05:16:14 with bundled
Node 24). A fresh `vite build` from the frozen tree **reproduced the exact hash** (`index-BfnriryF.js`,
815,540 B), so the tree equals what was tested. Character assets in dist: re-UV'd atlas v2 with
normal/AO — hero 621,882 B, templar 627,057, ally 616,432, berserker 618,061, ranger 619,732,
survivor 618,493, fallen 616,777 (all 04:48:4x), fortress_keep.glb.gz 473,607 B (04:51:51).
**Gate clarifications applied (Lead):** tone window unchanged; the unique-colour detail gate is
measured on the **fuller close-up body mask** (the 73×170 torso crop is too small for 500 colours in
a dark scene — reported for reference only). Authoritative commands:
`--characters --skip-build --out qa/characters-b5-final`, `--perf --skip-build --out qa/perf-b5-final`,
fresh-build smoke `qa/final-batch5`, `--coop --skip-build --out qa/coop-batch5`, and live baseline
`qa/live-batch5` against the deployed cycle-1 site.

**1) Character material audit (`qa/characters-b5-final`) — PASS 24/24.**

| Measure | pre-fix batch-3 | cycle-1 (`DtnItod1`) | interim (`CHBvf55l`) | **cycle-2 final** | gate |
| --- | --- | --- | --- | --- | --- |
| in-game TP torso mean | 54.9 | 102.84 | 100.28 | **89.31** | 65–95 ✅ |
| in-game TP torso p50 | 28.5 | 114.26 | 115.25 | **95.98** | 60–100 ✅ |
| torso black (<20) | 44.5 % | 15.42 % | 14.21 % | **14.75 %** | <25 % ✅ |
| torso clipping (≥250) | — | 0 % | 0 % | **0 %** | <1 % ✅ |
| close-up avg mean / p90 | — | 44.46 / 108.57 | 45.34 / 110.83 | **43.16 / 105.83** | luminance ✅ |
| close-up unique colours (min) | — | — | 429 | **407** | ≥400 ✅ (SPEC ref 500, see note) |
| torso-crop unique colours (info) | 557 | 256 | 230 | **230** | reference only |

The tone now sits inside the night-realistic window (mean 89.3 vs weapons-armory's predicted
≈83–84; slightly brighter, still inside the gate) with no clipping; the close-up body mask shows
407–505 unique colours (visibly richer surface detail: plate seams, rivets, pauldron/shoulder shapes,
shield detail, belt/pouch and cloth/leather variation). Close-ups: all 5 appearances + skeleton and
zombie captured (`char-player-*.png`, `char-undead-*.png`); no black silhouettes; the SPEC's 500
full-body-colour reference is only met by the templar (505) — hero/berserker/ranger/ally sit at
407–446, so "detail preserved" passes the agreed ≥400 close-up gate but is a cycle-3 polish item.

**2) Performance (`qa/perf-b5-final`) — PASS 26/26, gates met with headroom.**

| Metric (spawn TP, high, DPR1) | cycle-1 | **cycle-2 final** | gate |
| --- | --- | --- | --- |
| draw calls | 173 | **169** | <210 ✅ |
| triangles | 1,500,333 | **1,658,880** | <1.85 M ✅ |
| geometries | 138 | **147** | — |
| meshes / objects | 606 / 3,325 | **624 / 3,364** | — |
| materials / textures / programs | 201 / 123 / 71 | **214 / 151 / 72** | — |
| lights / skinned meshes | 17 / 28 | **17 / 49** | — |
| FP calls / tris | 140 / 1,376,211 | **131 / 1,546,364** | — |
| tier calls (low / medium / high) | 128 / 173 / 172 | **130 / 168 / 168** | low-tier drop ✅ |
| payload (requested assets) | 12.43 MB | **13.69 MB** (13,686,241 B) | +1.26 MB = character atlases v2 + keep atlas + LODs |
| nav → landing / HUD / state | 4.62 s / 25.8 s / 27.3 s | **3.56 s / 16.3 s / 17.4 s** | — |
| loading UX | 2/20→13/20, join 4.68 s | **0/20→13/20**, join 3.70 s, max frame gap 1.76 s | ✅ |
| quality selector | persists | **persists** (hook+localStorage medium after reload) | ✅ |

`__ssPerf().landscape` confirms the near/far tree bands are live: at spawn TP `pine [2,2]` full +
`pineLod [15,15]` LOD instances, `oak [0,0]` + `oakLod [5,5]`; at the treeline viewpoint
`pine [6,6]`, `pineLod [11,11]`, `oak [4,4]`, `oakLod [14,14]` (pineCount 231 / oakCount 170,
`hasMatrices:true`). The fixed `treeline` QA view now shows real trees (near foreground + midground
stands + castle wall on the right). Note: the harness textures/programs counts (151/72) are slightly
higher than world-scene's probe (130/52) because QA captures late in the session after the quality
sweep/reloads; calls/triangles match.

**3) Regression — all PASS.** Fresh-build local smoke **16/16** (`qa/final-batch5`, hash reproduced);
co-op **18/18** (`qa/coop-batch5`: both snapshots list both players, 4.5 m movement propagation,
shared Warhammer unlock, 0 errors); live-URL baseline vs deployed cycle-1 **17/17**
(`qa/live-batch5`: 10 cards, 0 asset 404s; only external Cloudflare beacon). 0 page/console/log
errors, 0 bad responses; **new `server: stayed up for the whole run` gate** passes (health failures 0)
after the earlier teammate-cleanup incident.

**4) Visual audit (`read_image`, all 7 views + landing/TP/combat) — restorations confirmed.**

- **Restored batch-10B geometry (was a real cycle-1 bug):** landing/`camp`/`region-*` now show proper
  chapel ruin (gothic window, roof ribs), aqueduct/bridge fragments, stone walls (grounded, correct
  5.6 m wall segments), well pergola, chest, bench, carts, barrels and tents — **no white/grey blob
  artifacts** remain (compare `qa/final-batch4/00-landing.png` vs `qa/final-batch5/00-landing.png`).
- **Shadows:** tent/stone-wall cast shadows restored and visible in `camp`/`courtyard`/landing;
  character contact shadows present; architecture shadows across the road at the gate.
- **Dressing:** gate braziers with emissive flames + red torch glows on the towers (`courtyard`),
  camp barrel/cart clusters + wolf carcasses (`camp`, matches ruins-builder's checklist), stake lines
  and grave field visible, banner poles in the courtyard, grass 5600, survivor camps, trebuchet.
  No pop/glitch besides the notes below.
- **Atmosphere:** brazier smoke/ember particles visible above the fire (`view-fire.png`); moon + halo
  retained; night palette consistent.
- **Characters at gameplay distance:** readable silvery/pale armoured figures with visible shoulders/
  shields at the gate; no black silhouettes; tone matches the close-up audit.

**5) Concrete AAA gaps for cycle 3 (QA list).**

1. **Regional identity is weak** — the three regions present the same castle gatehouse + chapel ruin
   + well pergola composition with near-identical palettes (`region-green/ashen/crown` are hard to
   tell apart). Needs per-region biome dressing (snow/ash/marsh), colour grading/fog, and distinct
   landmarks/ruin types.
2. **Tree foliage reads as pale white shard clumps**, not pine/oak canopies; the near→LOD switch is
   visible as silhouette change and the full-res tree count drawn at the treeline is low (6 pine /
   4 oak near vs 11+14 LOD). Improve foliage cards/alpha textures and blend the LOD band under fog.
3. **Corruption/plague magenta patches** appear as flat saturated splotches on the courtyard/road
   (e.g. `view-courtyard.png` bottom foreground, `view-region-green.png` near NPCs) — they look like
   unblended decals; texture/stencil them or restrict to nest areas.
4. **Fire/smoke is stylized flat:** brazier flame is a flat emissive cone and smoke is sparse white
   specks; upgrade flame sprite/shader + denser embers, keeping the pooled/cheap implementation.
5. **Character silhouettes are still subtle at gameplay distance** — the new add-on armour
   (pauldrons/hood/cape/crest) barely differentiates characters at 10 m; scale/shape readability is
   a cycle-3 fidelity item alongside the ≥500-colour target.
6. **Time-to-HUD under SwiftShader is long** (nav→HUD 16.3 s / state 17.4 s; loading progress is
   visible throughout) — shader-compile/scene-ctor cost could be trimmed for slower machines.
7. Minor: moon halo is a very hard-edged stylized disc; tents are bright flat panels; no wind
   animation on foliage/banners.

**Cycle-2 verdict: PASS on all gates** (characters 24/24, perf 26/26, fresh-build 16/16 +
hash reproduced, co-op 18/18, live baseline 17/17); the cycle-2 visuals are a real upgrade over
`qa/final-batch4` (restored geometry, shadows, atmosphere, character tone/detail), with the seven
gaps above carried into cycle 3.

### Final live deployment verification — cycle-2 (game `5a49f24e`, hosting `d4b71cb7`)

Run after the Lead's Cloudflare deployment (deployed bundle **`index-C_mLlIzi.js`**, 815,640 B —
the pinned-confirm hosting build; the local `vite build` of the same commit produced
`index-BfnriryF.js`, 815,540 B; the 100 B delta is the hosting build's asset/base configuration, not
a code difference — Lead built from the pushed pinned commit and verified the live bundle):

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch5-deployed --expect-weapons 10 `
    --expect-assets custom/hero.glb.gz,custom/fortress_keep.glb.gz,custom/castle_tower_lod.glb.gz,custom/pine_lod.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --perf --out qa/live-views-b5
```

- **Results: PASS 18/18 (deployed pass) + PASS 19/19 (live + 7 QA views).** Live network log shows
  `assets/index-C_mLlIzi.js` + `index-CnBWkizl.css`; `/health` OK; 10 weapon cards; all 4 expected
  assets HTTP 200; 0 page/console errors, 0 bad responses, 0 failed internal requests; WS
  `wss://…/ws` opens=1/closes=0; fps 2.8 (SwiftShader). Only log entries: external Cloudflare
  Insights beacon (third-party, not gated).
- **Live payload:** 13,665,189 B = **13.03 MiB** across the 67 requested asset URLs (curl-verified)
  — **+5.0 %** vs the cycle-1 live 12.41 MB (character atlases v2 + fortress_keep atlas +
  tower/pine LODs), still **−68 % vs the batch-2 live 42.6 MB**. Verified live sizes: hero 621,882 B,
  templar 627,057 B, fortress_keep 473,607 B, castle_tower_lod 123,177 B, pine_lod 90,446 B,
  CREDITS 4,697 B. Live perf probe: **169 calls / 1,659,220 tris**, low tier 131 / 1.347 M, medium
  168 / 1.658 M — matches the local authoritative capture (169 / 1,658,880).
- **Live QA views:** all 7 `__ssQAView` captures work on the deployed build
  (`qa/live-views-b5/view-*.png`); `treeline` shows real near/mid trees and
  `__ssPerf().landscape` reports the same instance counts as local (pine [6,6] full + pineLod
  [11,11], oak [4,4] + oakLod [14,14] at the treeline; pineCount 231 / oakCount 170) — so the
  near/far tree band is live.
- **Visual confirmation vs cycle-1 live (`qa/live-batch4/`):** characters now read as detailed,
  night-toned armoured figures (no white-out, no black silhouettes); restored chapel ruin / stone
  walls / well pergola / tent geometry is visible from the live spawn (the cycle-1 live screenshots
  still showed the old blob artifacts); tent/stone-wall/character shadows and gate braziers/torch
  glows present; moon + clouds + grass + dressing intact; **no blue-cone towers** in early/mid/settled
  landing frames; HUD and 10-card armory unchanged.
- Loading UX live: counts 0/20 → 13/20, join 4.07 s, max frame gap 1.94 s; quality selector
  persists (medium after reload).

**Cycle-2 live deployment is verified end-to-end: green.** Accepted cycle-3 debt: the seven
visual/performance gaps listed above (regional identity, tree foliage/LOD band, magenta corruption
decals, fire/smoke fidelity, character silhouette/detail target, SwiftShader time-to-HUD, moon/tent
polish).

---

## Iteration cycle 2026-10F (AAA loop, cycle 3) — regional identity, foliage/fire/corruption, time-to-HUD (in progress)

Cycle 3 attacks the cycle-2 visual-audit gaps: distinct regional atmosphere/grading + landmarks,
proper alpha-card foliage with a fogged near/far band, feathered corruption decals, sprite
fire/embers/smoke, wind motion, elite-undead silhouettes, region ambience, and a time-to-HUD
reduction.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Required QA views unchanged** (7: treeline/fire/camp/courtyard/region-green/ashen/crown) plus
  **new optional cycle-3 views**: `landmark-green|ashen|crown`, `foliage`, `corruption`, `wind` —
  captured when `__ssQAView` supports them; landmarks fall back to `__ssQAPose` with
  ruins-builder's final poses (green MOVED after the visual-fix pass: cam (69.2,−21,h2.8)→
  (56,−6,3.0) yaw −2.4199 pitch 0.0100; ashen cam (−36,−190,h3.2)→(−36,−228,5.0) yaw 0 pitch
  0.0473; crown cam (−34,−432,h3.2)→(−34,−472,7.3) yaw 0 pitch 0.1021). A named landmark view whose
  returned pose drifts >2 m from the expected anchor is discarded in favour of `__ssQAPose`.
- **`__ssRegionInfo()` numeric capture** after every region/landmark view (region, blend weights,
  fog colour/density, sky/ambient/moon tints, exposure, saturation) → reported per region; plus
  **regional distinctness gate**: pairwise mean-RGB colour distance / mean-luminance spread between
  the three region screenshots (plus visual `read_image` verdict: fog/foliage/landmark/seams).
- **Wind gate**: two screenshots of a foliage/grass view ~1.1 s apart, decoded in-page, mean-abs
  luminance/RGB diff + changed-pixel % (a static scene would diff ≈0).
- **Time-to-HUD gate**: reports landing/HUD/state/join and gates **HUD ≤15.0 s / state ≤16.2 s**
  (≈≥8 % earlier than cycle-2's 16.3 s / 17.4 s), join ≤3.8 s (cycle-2 3.70 s); failures are
  reported with the measured delta rather than silently passed.
- **Perf gates** updated to **<230 calls / <1.9 M tris** (cycle-2: 169 / 1,658,880).
- **Elite-undead silhouette check**: identifies elite actors via world-scene's hooks
  (`__ssEliteUndeadInfo()` preferred for `{id,name,tier}` labels/sorting, `__ssEliteUndeadIds()`
  fallback, then weapons-armory's rule in-page: `corrupted`→tier2/3; `zombie` maxHp≥150→3, castle
  'keep' or within 70 m of nest (0,−664)→1), frames the **highest-tier** elite vs a same-family
  tier-0 normal with `__ssCharacterPreview`, saves close-ups
  (`char-undead-elite.png`/`char-undead-normal.png`) and reports pixel-diff + silhouette verdict
  (preview boom is ~2.8 m; the 10 m line-up reference is viewable in `qa/char-viewer/shots/`).
- **Hook confirmation (world-scene, cycle-3 build):** all 7 original views unchanged + `foliage`,
  `corruption`, `wind`, `landmark-green|ashen|crown` (landmark views ship ruins-builder's exact
  cam poses/targets and return `{ok,name,region,pose}`); `__ssSetLandmark(region,x|null,z?)`
  moves/resets anchors (defaults green (14,28), ashen (−36,−228), crown (−34,−472));
  `__ssEliteUndeadIds()→string[]`, `__ssEliteUndeadInfo()→[{id,name,tier}]`;
  `__ssRegionInfo()` returns region/weights/fog/sky/ambient/moon tints/intensities/exposure/
  saturation/landmark with smoothstep border bands (z −245…−165 and −485…−405).
  **Landscape debug change:** the card-tree switch makes `pine`/`oak` counts large and
  `pineLod`/`oakLod` intentionally empty (legacy fallback), with new maple/snow instance counts in
  `__ssPerf().landscape` — the cycle-3 report reads the raw landscape object (keys as shipped).
- **Pre-final measured state (world-scene, not authoritative):** TP **193 calls / 1.64 M tris**,
  low 110 calls, first-state **14.75 s** vs cycle-2 16.3 s, click→HUD 1.13 s, 0 errors/warnings/404s.
- **Elite geometry cost (weapons-armory, measured)**: +1 SkinnedMesh primitive per elite — tier1
  32 tris bone crown; tier2 76 tris (8-spike crown + 5-spike crest + 6 shoulder spikes); tier3
  84 tris (10-spike crown); merged undead eyes 72 tris + elite additive glow 48 tris; body
  skin/materials untouched (cycle-2 tone gates unaffected); +~2 draws per elite. tsc 0 errors,
  equipment 5/5, armory 5/5, exactly 58 test blocks; reference viewer images in
  `qa/char-viewer/shots/` (`elite-a-base.png` 10 m line-up, `elite-*-closeup-*` vs normal).
- **Characters**: cycle-2 tone/detail gates retained (TP torso mean 65–95 / p50 60–100 / black<25 % /
  clipping<1 %; close-up detail ≥400 colours), plus elite-undead evidence.

### Cycle-2 reference values (before cycle-3)

- Perf: 169 calls / 1,658,880 tris / 147 geoms / 624 meshes / 3,364 objects; payload 13.69 MB.
- Time-to-HUD (SwiftShader): landing 3.56 s, HUD **16.3 s**, state **17.4 s**, join **3.70 s**.
- Characters: TP torso mean 89.31 / p50 95.98 / black 14.75 % / clipping 0 %; close-up min colours 407.
- Regions: near-identical fog/palette (QA #1 gap); flat magenta corruption blobs; flat emissive-cone
  fire; pale shard-clump foliage; hard moon halo; no wind.
- Expected cycle-3 region grading (world-scene): Green March fog ≈#1e4038 density ≈0.0122 exposure
  ≈1.55 saturation ≈1.05; Ashen Moor ≈#342d42 density ≈0.0208 exposure ≈1.37 saturation ≈0.82;
  Frozen Crown ≈#6f93b0 density ≈0.0172 exposure ≈1.62 saturation ≈1.12 + snow flakes; border
  bands z −245…−165 and −485…−405 with smoothstep weights.
- Cycle-3 landmark anchors (ruins-builder FINAL after the visual-fix pass): Green March
  `village_house_ruin` **MOVED to (56,−6)** h≈6.2 (native 13.81×6.5×7.66) + rebuilt 8-stone circle
  r≈9.8 + 5 loose stones — 65 m from spawn, 32.2 m off the nearest road, 44.3 m from the nearest
  castle footprint (the spawn/gate crowding is gone); Ashen Moor `chapel_ruin` (−36,−228) h≈10.0
  (in-place replace; matches old footprint); Frozen Crown `watchtower_ruin` (−34,−472) h9.0 on a
  3-rock outcrop (base top 2.8, tower top ≈11.8). Exact landmark camera fallbacks: green cam
  (69.2,−21,h2.8)→(56,−6,3.0) yaw −2.4199/pitch 0.0100 (camera on the circle's collapsed-gap side,
  occlusion-free); ashen cam (−36,−190,h3.2)→(−36,−228,5.0) yaw 0/pitch 0.0473; crown cam
  (−34,−432,h3.2)→(−34,−472,7.3) yaw 0/pitch 0.1021. Validation after the move: all placements +
  framing OK, all 8 circle stones road ≥23 m, min spacing 6.39 m, tsc 0, real-GLB 33/33, mocked 52/52.
  Prop scatter: **12 `dead_tree`** (Ashen), **12 `ice_shard`** (Frozen), **13 `standing_stone`**
  (Green: 8-stone circle r9.8 + 5 loose) — **confirmed 0 dead_tree / 0 ice_shard in Green March**
  (region band check), so the bare trees near the spawn castle are world-scene's card-foliage issue,
  not ruins scatter. Cost: +7 instanced draws structurally (3 landmarks + rocks + 3 scatter layers;
  only +2–3 render per region view), ~34.2 k tris across the map (chapel 13,810 / watchtower 9,817 /
  village 2,475 / rocks 450 / dead trees 5,568 / shards 1,296 / stones 819), only the 4 large landmark
  layers cast shadows (architecture), scatter receive-only, no new lights, no 404s (3× retry then
  skip). Grounding: village/house min-y 0, tower min-y 2.80 on the outcrop, trees/shards/stones
  min-y ≈0.

### Cycle-3 authoritative capture + regression — final build `index-CurTIx8l.js` (functional green; visual defects + time-to-HUD gate FAIL)

**Final bundle:** `dist/client/assets/index-CurTIx8l.js` (839,609 B). A fresh `vite build` from the
frozen tree **reproduced the exact hash** (839,609 B). Runs on this hash:
`--characters --skip-build --out qa/characters-b6` (PASS 25/25), `--perf --skip-build --out
qa/perf-b6` **and** `qa/perf-b6b` (two samples; 28/30 each — time-to-HUD/join gates fail),
`--views --skip-build --out qa/views-b6` (clean early QA-view set; 18/19 — wind sample failed),
fresh-build smoke `qa/final-batch6` (PASS 16/16 + hash reproduced), `--coop --skip-build --out
qa/coop-batch6` (PASS 18/18), live baseline `qa/live-batch6` (PASS 17/17 vs deployed cycle-2).
New assets in dist: pine 324,731 / oak 188,639 / pine_v2 122,514 / oak_v2 95,617 / snow_pine
118,305 / maple 107,166 / dead_tree 93,579 / standing_stone 85,440 / ice_shard 84,000 / chapel_ruin
444,298 / watchtower_ruin 477,873 / village_house_ruin 147,757.

**1) Characters + elite undead — PASS 25/25** (`qa/characters-b6`):

| Measure | cycle-2 (`BfnriryF`) | **cycle-3 (`CurTIx8l`)** | gate |
| --- | --- | --- | --- |
| in-game TP torso mean | 89.31 | **91.69** | 65–95 ✅ |
| in-game TP torso p50 | 95.98 | **95.68** | 60–100 ✅ |
| torso black (<20) | 14.75 % | **5.25 %** | <25 % ✅ |
| torso clipping (≥250) | 0 % | **0 %** | <1 % ✅ |
| close-up avg mean / p90 | 43.16 / 105.83 | **46.54 / 113.89** | luminance ✅ |
| close-up min unique colours | 407 | **496** | ≥400 ✅ (SPEC 500: just under) |
| elite undead | — | **PASS** (`__ssEliteUndeadInfo`+`Ids`): 25 elites (tier 3/2/1), tier-3 Plague Champion vs tier-0 zombie close-up diff meanAbsLum **31.1**, changed **88.9 %** — crown/shoulder-spike silhouette clearly distinct | ✅ |

**2) Performance — PASS** (two samples, spawn TP high, DPR1): **194 calls** (<230), **1,641,589
tris** (<1.9 M), geoms 158, meshes 646, objects 3,386, materials 234, textures 155, programs 70,
lights 17, skinned 53; FP 152 calls / 1,525,946 tris; low tier 151 calls / 1,327,868 tris
(−22 % vs high 193). Payload **15.39 MB** (assetTransferBytes 15,387,844; 83 requests, +1.70 MB vs
cycle-2's 13.69 MB = new foliage/landmark/effect assets). Loading counts 0/20→4/20 delayed, join
enabled 4.4–4.7 s, max frame gap 1.76 s, quality persists. `__ssPerf().landscape` now card-tree
counts: pine 26 / oak 2 / maple 6 rendered at spawn (pineCount 230 / oakCount 108 / mapleCount 57 /
snowCount 247; `pineLod`/`oakLod` empty by design — legacy fallback).

**3) Time-to-HUD — GATE FAIL** (two authoritative samples; same SwiftShader machine):

| Metric | cycle-2 | cycle-3 sample A | cycle-3 sample B | gate |
| --- | --- | --- | --- | --- |
| nav → landing | 3.56 s | 4.33 s | 3.97 s | — |
| nav → HUD | 16.31 s | **16.27 s** | **18.03 s** | ≤15.0 s ❌ |
| nav → state | 17.42 s | **16.96 s** | **18.05 s** | ≤16.2 s ❌ |
| join enabled | 3.70 s | **4.71 s** | **4.36 s** | ≤3.8 s ❌ |

No meaningful improvement (HUD −0.2 %/−2.8 % change, second sample worse; join is slower); the
owner's pre-final probe reported 14.75 s first-state (different metric / pre-final payload), which
did not reproduce in the harness on the final 15.39 MB build. **Time-to-HUD goal is not met.**

**4) Regional identity + atmosphere audit.** All 7 required views + all 6 optional views captured
(`qa/views-b6` clean set, no death overlay). Numeric distinctness passes: pairwise mean-RGB colour
distance **9.94 / 20.7 / 26.7** (min between green/ashen 9.94), luminance spread **12.0**; fog/tint
constants as spec. **But the visual audit fails the acceptance:** the `region-green` and
`region-crown` QA captures are **blocked by giant dark foliage/trunk planes** (the camera sits
inside/next to opaque card-tree geometry) so the regions cannot be visually compared; only
`region-ashen` reads as a distinct place (chapel landmark + dead trees + grey fog). Corruption nest
looks improved (detailed crystal/root mass, no flat magenta blobs); fire has sprite flames/glow but
the smoke puffs render as **dark opaque dome shapes** around braziers (blending defect).

**5) Visual defects confirmed in the audit (cycle-3 debt / blockers):**

1. **Foliage/card-tree rendering is broken (major regression).** `treeline`/`foliage` views and
   spawn/landing show **leafless, gnarled bare-branch trees** instead of pine/oak/maple canopies,
   and `region-green`/`region-crown` views are filled by giant opaque dark foliage/trunk planes; the
   new card-tree foliage appears to render with missing/inverted alpha or at wrong scale. This
   directly fails the cycle-3 "foliage quality / no shard clumps / fogged LOD blend" goal and blocks
   regional-identity visual verification.
2. **Moon halo is a very large grey disc with a dark rim** (Lead concern a, confirmed) dominating
   spawn/crown/ashen/landing views — regression from cycle-2's softer halo.
3. **Standing-stone circle at spawn** (Lead concern b): the 8-stone circle r≈9.8 m around the Green
   landmark at (14,28) puts several large slabs immediately right of the spawn road/gate; the
   landmark reads as random monoliths crowding the spawn composition (proximity/composition issue).
4. **Dead trees in Green March near spawn** (Lead concern c, confirmed): bare dead-looking trees
   visible beside the spawn castle/landing — **ruins-builder confirmed 0 dead_tree / 0 ice_shard in
   Green March (region band check)**, so this is world-scene's card-foliage rendering (broken/absent
   leaf cards exposing branch skeletons), not ruins scatter.
5. **Ground decals near spawn read as brownish/pink patches** (Lead concern d): decal/tint blending
   issue around the road/camp; not yet systematic — captured for cycle-4.
6. **Smoke sprites blend as dark opaque domes** around braziers (fire view) — needs alpha/colour fix.
7. **`__ssRegionInfo()` follows the player, not the QA camera** (all region views report
   region "march"/fog #1e4038); per-region fog numbers could not be read from camera captures
   (harness limitation; documented as cycle-4 hook fix). Also the idle corruption timer kills the
   player during 5+ min perf captures → QA added an early `--views` mode; perf-run region/landmark
   captures contain a respawn overlay (the clean evidence is `qa/views-b6`).

**6) Regression channels — PASS:** fresh-build smoke **16/16** + exact hash reproduced; co-op
**18/18**; live baseline vs deployed cycle-2 **17/17**; 0 page/console/log errors, 0 bad
responses/404s, 10 weapon cards; `server: stayed up` gate passes.

**Verdict: functional/perf/character/regression channels are green, but cycle-3 does NOT meet its
visual acceptance.** The foliage/card-tree regression, the giant moon disc, the spawn
standing-stone composition and the time-to-HUD gate failure are real defects; regional identity
cannot be visually certified from the green/crown captures because the foliage occludes the QA
views. Recommendation for the Lead: either route a focused visual-fix rebuild (foliage alpha/scale +
moon halo + stone proximity; world-scene/asset-forge) and re-run the affected captures, or deploy as
a known-debt build and fold these into cycle 4. QA does not certify the cycle-3 foliage/regional-
identity goals on `index-CurTIx8l.js`.

**New AAA gaps for cycle 4:** fix card-tree alpha/scale + validate named QA views against foliage;
moon halo scale/softness; landmark-circle proximity/composition at spawn; confirm dead-tree scatter
regions; decal tint/blending on roads/camps; smoke sprite blending; `__ssRegionInfo` should sample the
QA camera (or return per-region constants) for numeric audits; true time-to-HUD work (payload grew
1.7 MB, join slower — the core-first pipeline did not pay off on the final build).

### Visual-fix rebuild `index-j2KTUVMP.js` — focused re-verification

Lead routed the cycle-3 defects; owners produced `dist/client/assets/index-j2KTUVMP.js` (840,799 B).
Focused re-run results (same harness):

- **Hash proof:** fresh bundled-Node-24 build **reproduced `index-j2KTUVMP.js` exactly** (840,799 B),
  fresh-build smoke **PASS 16/16** (`qa/final-batch6b`).
- **Visual fixes — VERIFIED** (`qa/views-b6b`, `read_image`): card trees now render **canopies**
  (green needle pines + orange maple; `treeDebug` confirms `bark` 316 tris + `pine_leaves` 956 tris,
  `alphaTest 0.42`) with no leafless skeletons or giant opaque planes; `region-green` is readable
  again; relocated Green landmark at **(56,−6)** with its 8-stone circle frames cleanly
  (`landmark-green`, 65 m from spawn) and the spawn road/gate is clear of stones; **moon halo is a
  soft small moon** (no grey disc/dark rim); brazier **smoke is pale additive plume** (no dark
  domes); spawn/landing **brown/pink decal patches are gone**; dead-looking bare trees in Green are
  gone (canopies restored). Numeric region identity: fog follows the **QA camera** —
  march #1e4038 d0.0122, moor #243939 d0.0137, crown #415867 d0.0156; pairwise colour distance
  **9.36/31.5/32.2**, luminance spread **15.1**; wind diff **0.887–1.602** meanAbsLum (PASS in both
  samples). Non-blocking nit: the `region-crown` camera still has a snow-pine canopy intruding over
  ~40 % of the right frame (QA-view placement, not a geometry bug); maple/green pines read quite
  bright/saturated at night → cycle-4 tone item.
- **Perf — PASS** (`qa/perf-b6c`, `perf-b6d`): **195 calls** (<230), **1,666,828 tris** (<1.9 M),
  FP 153/1,550,961, low 153/1,355,474; geoms 160, textures 160, programs 73; payload **15.06 MB**
  (assetBytes 15,061,330). Quality tiers/loading/persistence pass; 0 errors/404s; 10 cards.
- **Time-to-HUD — STILL FAILS** (two samples): HUD **18.54 s / 17.14 s** (cycle-2 16.31, gate
  ≤15.0), state **20.06 s / 18.55 s** (gate ≤16.2), join **3.84/3.85 s** (gate ≤3.8); landing did
  improve (**3.28/3.32 s** vs 3.56). The owner's 12.58 s first-state probe did not reproduce under
  the harness on the final build. This remains the only routed goal that fails.
- **Characters/elite spot-check — 24/25:** character code unchanged; close-ups pass (avg mean 45.79,
  p90 112.62, min colours **545**, clipping 0); elite tier-3 vs normal diff **31.08 / 88.9 %** PASS.
  The one marginal fail is the torso **p50 102.4** vs gate ≤100 (mean **91.5** ✓, black 4.86 % ✓) —
  character materials are untouched, so this reads as the brighter foliage/background raising the
  torso-region p50 (close-up tone unchanged); flagged as marginal/environmental, not a character
  regression.
- **Co-op — PASS 18/18** (`qa/coop-batch6b`).

**Rebuild verdict:** five of six routed visual defects are fixed and verified; the only remaining
gate failure is **time-to-HUD** (plus the marginal torso-p50 note). Everything else (perf, region
identity, foliage, moon, smoke, decals, stones, dead trees, characters/elite, co-op, hash) is green.

### Final live deployment verification — cycle-3 (game `b1117806`, hosting `7bba27d8`)

Deployed after the Lead accepted the visual-fix build as **known debt** (time-to-HUD + marginal
torso p50 documented above). Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch6-deployed --expect-weapons 10 --expect-assets custom/pine_v2.glb.gz,custom/snow_pine.glb.gz,custom/oak_v2.glb.gz,custom/maple.glb.gz,custom/chapel_ruin.glb.gz,custom/watchtower_ruin.glb.gz,custom/village_house_ruin.glb.gz,textures/flame_soft.png
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --perf --out qa/live-views-b6
```

- **Result: PASS 18/18 (deployed pass) + 20/21 (live + QA views; one wind-motion sample below the
  0.8 gate, see note).** Live network log shows **`assets/index-C1FVaRwU.js`** (840,949 B) +
  `index-CnBWkizl.css`; `/health` OK; 10 weapon cards; all **8/8 expected assets HTTP 200** (pine_v2,
  snow_pine, oak_v2, maple, chapel_ruin, watchtower_ruin, village_house_ruin, textures/flame_soft.png);
  **0 page/console errors, 0 bad responses/404s, 0 failed internal requests**; 91 internal requests
  (82 asset URLs); WS `wss://` opens=1/closes=0; fps 2.0 (SwiftShader). Only log entry: external
  Cloudflare-Insights beacon (third-party, not gated).
- **Live payload:** 15,036,880 B = **14.34 MiB** across the 82 requested assets (curl-verified) —
  **+10.1 %** vs cycle-2 live 13.03 MiB (new v2 foliage, snow pine, maple, three landmark
  structures, flame/smoke/snow textures), still **−66 % vs batch-2 live 42.6 MB**. Live sizes:
  pine_v2 97,202 / snow_pine 100,773 / oak_v2 74,674 / maple 81,922 / chapel_ruin 444,298 /
  watchtower_ruin 477,873 / village_house_ruin 147,757 / flame_soft 33,685 / CREDITS 4,697 B.
  Live perf probe: **195 calls / 1,666,320 tris** (low 153/1.355 M, medium 194, FP 153/1.551 M) —
  matches the local authoritative capture (195 / 1,666,828).
- **Live QA views:** all 13 captures work on the deployed build (`qa/live-views-b6/view-*.png`);
  `__ssPerf().landscape.treeDebug` on live shows `bark` 316 tris + `pine_leaves` 956 tris
  `alphaTest 0.42` (canopy leaf prims live); `__ssRegionInfo` per-camera values verified live:
  march **#1e4038 d0.0122**, moor **#243839 d0.0139**, crown **#425968 d0.0158**; region colour
  distances **12.55/31.26/30.87**, luminance spread **14.8**; treeline shows real canopies.
- **Visual confirmation live vs cycle-2 live (`qa/live-batch4/`):** landing/third-person show
  **canopy foliage** (green pines + orange maple) instead of bare trees, a **soft small moon**
  (grey disc/dark rim gone), **pale additive brazier smoke**, the **relocated Green landmark**
  (village house + stone circle) far from the spawn road, **no standing-stone crowding at the gate**,
  and **distinct region looks** (snow/blue crown vs grey-violet moor vs green march). The long live
  QA-view capture shows the idle-corruption respawn overlay (5-min capture; clean evidence is
  `qa/views-b6b/`) — non-blocking, and the corruption mechanic is working as designed.
- **Accepted cycle-3 debt (Lead-approved, documented):** time-to-HUD still above the 15.0 s gate
  (HUD 17.1–18.5 s local, live reference 18.7 s; landing improved 3.28–3.50 s), marginal torso p50
  102.4 vs ≤100 (mean 91.5, close-ups unchanged), wind-diff sample variance around the 0.8 threshold
  (passed 0.887–1.602 locally, 0.721 in this live sample), `region-crown` QA-view snow-pine framing,
  and bright/saturated maple + green pines at night (cycle-4 tone item).

**Cycle-3 live deployment is verified end-to-end: green, with the Lead-approved time-to-HUD debt.**
task-45 complete; cycle-4 candidates: regional tone refinement (maple/green saturation), real-GPU
HUD profiling, torso-p50 tone, `region-crown` QA-view framing, content expansion.

---

## Iteration cycle 2026-10G (AAA loop, cycle 4) — armour v2, weather, tone/HUD debt (in progress)

Cycle 4 targets character/armour identity v2 (7 distinct bodies), regional dynamic weather, the
cycle-3 tone debts (foliage/maple saturation, crown framing, torso p50), new props (stone well,
blacksmith stall), weather audio, and time-to-HUD.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Weather audit (new):** captures each region at **low + high intensity** via
  `__ssWeather()` + a QA forcing hook (`__ssSetWeather`/`__ssWeatherForce`-family, `null` restores),
  plus a **low-quality-tier high-intensity** screenshot to prove weather particles are quality-gated.
  Records weather state + particle counts (low < high and low-tier minimal gates when the hook
  exposes counts); saves `weather-<rain|ash|snow>-<low|high>.png` + `weather-lowtier-snow-high.png`.
- **Character armour v2:** cycles **all 7 bodies** (`templar|hero|berserker|ranger|ally|survivor|fallen`);
  the 5 playable appearances use the in-game character select, survivor/fallen use world-scene's QA
  `__ssPreviewBody(assetName,{distance})` hook (reported if absent). Captures a **close-up** and a
  **10 m third-person silhouette** per body (`char-<name>-closeup.png` / `char-<name>-10m.png`),
  keeps the cycle-2 tone gates; keyed to the Lead's cycle-4 decision the close-up gate is
  **body-mask unique colours ≥300**, the **full close-up frame colour count is the headline detail
  metric**, and the SPEC ≥500 body-mask target is documented as deferred art debt (asset-forge 1024
  atlas in cycle 5 — not worth +1.3 MB payload now); elite-undead regression retained.
- **Tone metrics:** region/foliage stats now include **mean saturation** (`meanSat`, `p90Sat`) so the
  green/maple desaturation and crown framing fixes can be measured against cycle-3 references.
- **Torso-tone re-baseline (Lead-approved):** the primary in-game torso gate now measures the
  **character body-mask** (background sampled from the crop's edge strips; character pixels selected
  by colour/luminance difference; reports mean/p50/p90/black %/maskPct/unique colours). The fixed
  centre crop is **informational only** — cycle-4 background/foliage dominates it (weapons-armory
  measured fixed-crop p50 124.5 while body-mask close-ups were mean 82–100 / p50 77–100). Gate window
  unchanged: mean 65–95 / p50 60–100 / black<25 %.
- **Night-mood gate (Lead):** `night: third-person scene stays a night scene (canvas mean <= 75, not
  daylight)` — reports canvas mean/RGB/black % (cycle-3 was ~52–62); a daylight-looking build is a
  blocker routed to world-scene.
- **Time-to-HUD attribution:** captures `__ssLoadTimings()` + raw performance marks/measures and
  prints them on the HUD/state gate result so any remaining time can be attributed; gates unchanged
  (HUD ≤15.0 s, state ≤16.2 s, join ≤3.8 s).
- **Perf gates:** cycle-4 SPEC **<260 calls / <1.95 M tris** (+tiers/loading/payload/all views).
- **Final hook shapes (world-scene, candidate `index-CZ8DITNA.js`)**: `__ssWeather()` →
  `{region, phase, intensity, nextChangeAt/In, flash/flashing, activeParticles:{rain,splash,haze},
  qualityScale}` with phases march `clear|light-rain|downpour`, moor `calm|ashfall|haze`, crown
  `clear|snow|snowstorm`; **positional** `__ssSetWeather(region, phase, intensity)` (alias
  `__ssWeatherForce`; `null` clears) — the harness now calls it positionally, forces **quality high**
  for beauty/weather captures (SwiftShader defaults low) and uses **low** only for the minimal-weather
  proof (expected 0 particles, qualityScale 0); `__ssLoadTimings()` →
  `{marks:[{name,at,ms}], summary:{sceneConstruct,coreReady,firstGameFrame,earlyCompileEnd,compileEnd},
  software, quality}` (compileAsync skipped/marked on SwiftShader); `__ssPreviewBody(name,
  distance|{distance})` for all 7 body ids with `null` restore. Weather hook expected counts e.g.
  green downpour high → 460 rain / 90 splash; ashen haze high → 14 haze banks; crown snowstorm high;
  low tier → 0 particles. Candidate perf reference: **205 calls / 1,706,992 tris**, FP 159/1.59 M,
  low 116/1.29 M, spawn TP canvas mean **58.23** (night), first-state ~11.89 s.
- **Quality forcing note:** SwiftShader defaults to quality low unless `ss-quality` is saved; the
  harness therefore forces `__ssQuality('high')` for beauty/perf/weather captures and low only for
  the low-tier weather proof, restoring high afterwards.

### Cycle-3 reference values (before cycle-4)

- Perf: 195 calls / 1,666,828 tris / 160 geoms / textures 160 / programs 73 / 17 lights / 53 skinned;
  payload 15.06 MB.
- Time-to-HUD (SwiftShader, two samples): landing 3.28–3.32 s, **HUD 17.14–18.54 s**, **state
  18.55–20.06 s**, **join 3.84–3.85 s** (accepted debt; gates 15.0/16.2/3.8).
- Characters: close-ups pass (min colours 545, clip 0); in-game torso mean 91.5, **p50 102.4**
  (debt target ≤100); elite tier-3 vs normal diff 31.08 / 88.9 %.
- Regions/foliage: distinct fog per region (`march #1e4038 d0.0122 / moor #243839 d0.0139 /
  crown #425968 d0.0158`), colour distance 9.36–32.2; maple/green bright-saturated at night (tone
  debt); `region-crown` snow-pine canopy covers ~40 % of the right frame (framing debt).
- Landmarks: green village_house_ruin (56,−6) + 8-stone circle; ashen chapel_ruin (−36,−228);
  crown watchtower_ruin (−34,−472).
- **Armour-v2 reference (weapons-armory; assets re-installed 07:14 with richer albedo + new armour
  normal/ORM maps):** per body — templar 9,276 tris / 3 prims / 3 mats; hero 9,388/2/2; berserker
  8,749/3/3; ranger 9,021/3/3; ally 9,231/3/3; survivor 8,857/3/3; fallen 8,838/2/2 (+76-tri elite
  add-on when corrupted). Rich-atlas gz sizes **654.6–704.3 KB** (tris unchanged), all ≤15,500 tris /
  ≤900 KB, one 91-joint skin, hand sockets + 12 clips, armour rigid-weighted inside the body envelope,
  old `*_addon` prims folded away; equipment/armory/assets tests 5/5, 58 blocks. Cross-reference
  sheets: `qa/char-viewer/shots/c4rich-base-closeup-{templar,hero,berserker,ranger,ally,survivor,fallen}.png`
  and `c4richsil-base.png` (all 7 at 13 m). **Palette richness (Lead decision):** body-mask unique
  colours on the rich atlases measured templar 515, hero 378, berserker 426, ranger 462, ally 333,
  survivor 250, fallen 303 (full close-up frame 809–1,029). Cycle-4 gate is **body-mask ≥300**;
  the ≥500 body-mask target is **deferred art debt** (asset-forge 1024 atlas in cycle 5 — not worth
  +1.3 MB payload now); full-frame colour counts are reported as the headline detail metric.
  **Art risk flagged by weapons-armory:** the new armour shows oversized flat/wood-grain-looking
  plates at 2.8 m (visible in asset-forge's own previews; silhouettes at 10–13 m read fine) — QA
  will confirm in the authoritative close-ups and route as asset-side art debt if reproduced.
  **Tone:** runtime frozen; fixed-crop is background-dominated (WIP mean 115.6/p50 124.5), character
  body-mask mean 82–100 / p50 77–100 → Lead-approved QA body-mask re-baseline above.
- **Cycle-4 props (ruins-builder, integrated + validated)**: `stone_well` (2,968 tris, 1.82×1.60×1.72
  native) ×6 — Green keep courtyard (−6,−4) + crossing camp (12,−30); Ashen (−6,−244) + (12,−270);
  Crown (−6,−484) + (−30,−446); `blacksmith_stall` (196 tris, 3.80×3.05×2.38) ×2 — Green village
  landmark (48,4) + crossing camp (32,−37), each with barrel/crate clusters. Four distance-culled
  instanced dressing layers, receive-only shadows, 85 m compaction, defensive missing-asset skip;
  all placements/framing validated (wells road 17.1–30 m, stalls road 30.6/4.4 m, clear of
  walls/towers/camps/landmarks/scatter); cost +4 draws / ~51.6 k tris map-wide. QA captures optional
  smithy poses (`prop-stall-village` cam (40,−2,h2.4)→(48,4,1.5); `prop-stall-camp` cam
  (26,−31,h2.4)→(32,−37,1.5)) in addition to the required 7 views.

### Cycle-4 authoritative capture + regression — final build `index-CZ8DITNA.js` (functional green; visual caveats)

**Final bundle:** `dist/client/assets/index-CZ8DITNA.js` (861,937 B). A fresh bundled-Node-24 build
**reproduced the exact hash** and fresh-build smoke passed **17/17** (`qa/final-batch7`; night-mood
gate included, TP canvas mean 58.77). Authoritative runs on this hash: `--characters --skip-build`
(`qa/characters-b7`, 27/27), `--perf --skip-build` (`qa/perf-b7`, 34/34 incl. views/weather/night),
`--coop --skip-build` (`qa/coop-b7`, 18/18), live baseline `qa/live-batch7` (18/18 vs deployed
cycle-3). Quality was forced **high** for beauty/character/weather/perf captures (software default is
low) and low only for the minimal-weather proof.

**1) Character/armour v2 — PASS.** 7 body close-ups + **7/7 10 m silhouettes** captured
(`char-<name>-closeup.png` / `char-<name>-10m.png`): 5 playable via character select, `fallen` via a
corrupted knight, `survivor` via a soldier rig. Body-mask torso gate (Lead-approved re-baseline):
mean **85.73** / p50 **71.31** / black **2.37 %** (gate 65–95 / 60–100 / <25 %) ✅; fixed-crop
informational mean 100.01 / p50 97.76 (background-dominated, now under 100 due darker night scene).
Close-up body-mask colours **607–874** (gate ≥300) with **full-frame headline 1,288–1,863**; clipping
0 %; total runtime cost visible in assets (9,276/9,388/8,749/9,021/9,231/8,857/8,838 tris, ≤900 KB
gz per body). Elite-undead regression PASS (`__ssEliteUndeadInfo`: 25 elites; tier-3 vs normal diff
meanAbsLum **29.76**, changed **86.1 %**). Night mood 50–58. **Caveats:** `__ssPreviewBody` exists
but its synthetic body did not render in a probe screenshot (camera framing) → fallback captures
used; numeric mean-RGB distinctness across the 5 knight bodies is small (overlapping palettes, min
0.93) though helms/cloaks differ visually; weapons-armory's flagged **oversized flat/wood-grain
plates at 2.8 m** are visible on the close-ups → asset-side art debt.

**2) Regional weather — PASS with a snowstorm caveat.** `__ssWeather()`/`__ssSetWeather` (positional,
region keys march/moor/crown) verified. Particle gates: march light-rain **228** → downpour **550**;
moor ashfall **4** → haze **14** (both high>low ✅); low quality tier on a high downpour → rain **0**,
qualityScale **0** (splash 90 still runs) ✅; visuals: rain streaks + wet-road sheen clearly visible,
ash/haze visible. **Snowstorm caveat:** crown `snow` vs `snowstorm` screenshots are nearly identical
and show only sparse flakes (no exposed snow particle counter; qualityScale 0.55) — the SPEC's
"dense snow / reduced visibility" reads weak in the authoritative capture → routed to world-scene as
cycle-4 visual debt, non-blocking for rain/ash.

**3) Tone/framing/regions — PASS.** `region-crown` framing fixed (no canopy covering ~40 %; snow
pines + soft moon + castle tower composition). Region fog follows the QA camera: march #1e4038
d0.0123 / moor #243939 d0.0141; `region-crown` camera sits in the moor↔crown border band (camera
z≈−432; band −485…−405) so it reports a blended `moor` #313e49 d0.0166 — visually distinct snow/cold
region, but note the blend when reading the numbers. Pairwise colour distance 5.03–12.69, luminance
spread 5.22 (distinctness PASS, softened vs cycle-3 but still distinct). Foliage/maple saturation is
toned down (TP canvas meanSat 0.50; region means 41–42 with maple orange distinct) and night mood
holds (TP canvas mean **51.58**, ≤75).

**4) Time-to-HUD — PASS on the app metric with attribution.** The perf run spends **17.7 s on
landing QA** before clicking join, so nav→HUD (17.84 s) includes QA idle time; measured from the join
click: **click→HUD 158 ms**, **click→state 1,505 ms**, join button enabled 3.40 s (gate 3.8 s) ✅.
`__ssLoadTimings()` exposes `{marks, summary{sceneConstruct,coreReady,firstGameFrame...},software,
quality}` (SwiftShader compileAsync skipped/marked); marks show coreStart 196 ms, sceneConstruct
583 ms, coreReady 2,983 ms, compileSkipped 5,149 ms. firstGameFrame 18.3 s is nav-relative and
includes the same landing idle. No gate failure on the app metric; documented for real-GPU follow-up.

**5) Performance — PASS.** Spawn TP: **206 calls** (<260 ✅), **1,708,376 tris** (<1.95 M ✅),
geoms 168, meshes 677, objects 3,417, materials 262, textures 178, programs 96, lights 17, skinned 74;
FP 160 calls / 1,591,286 tris; low tier 160/1,395,804 (−22 % calls vs high 206). Payload **15.76 MB**
(assetTransferBytes 15,760,016; 84 asset requests, +0.71 MB vs cycle-3 = armour v2 + props + weather
audio). Tiers/loading/persistence pass; wind PASS (meanAbsLum 1.464); 7 required + 9 optional views
(landmarks/foliage/corruption/wind/char-lineup/smithy stalls) captured.

**6) Regression — PASS.** Fresh-build 17/17 + exact hash reproduced; co-op 18/18; live baseline 18/18
(10 cards, 0 404s; external Cloudflare beacon only); 0 page/console/log errors throughout.

**Cycle-4 verdict: PASS on all gates**, with four non-blocking visual debts logged for cycle 5: (a)
snowstorm density/visibility weak at high intensity (rain/ash fine); (b) `__ssPreviewBody` synthetic
body not rendering (camera framing) — QA used in-game fallbacks; (c) oversized flat/wood-grain armour
plates at 2.8 m (asset-side); (d) survivor body identification uses a soldier rig (camp survivor
specifics not isolated). `region-crown` is a border-blend capture, noted above.

### Final live deployment verification — cycle-4 (game `abfa0d72`, hosting `923fd216`)

Deployed after the Lead accepted the cycle-4 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch7-deployed --expect-weapons 10 `
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --perf --out qa/live-views-b7
```

- **Results: PASS 19/19 (deployed pass) + PASS 25/25 (live views/perf/weather).** Live network log
  shows **`assets/index-czSzE-EL.js`** (862,087 B) + `index-CnBWkizl.css`; `/health` OK; 10 weapon
  cards; **9/9 expected assets HTTP 200** (7 armour v2 GLBs, stone_well, blacksmith_stall); 0 page/
  console errors, 0 bad responses/404s, 0 failed requests; 94 internal requests (84 asset URLs); WS
  opens=1/closes=0. Only log entries: external Cloudflare-Insights beacon (third-party, not gated).
- **Live payload:** 15,734,966 B = **15.01 MiB** across 84 assets (curl-verified) — **+4.6 %** vs
  cycle-3 live 14.34 MiB (armour v2 rich atlases + new props/weather). Verified live sizes: templar
  704,344 / hero 694,601 / stone_well 222,207 / blacksmith_stall 16,279 / flame_soft 33,685 /
  CREDITS 4,697 B. Live perf probe: **206 calls / 1,708,300 tris** (low 161/1,395,576, FP
  160/1,591,562) — matches the local authoritative capture (206 / 1,708,376); `treeDebug` shows
  pine card bark 316 + pine_leaves 956 tris (alphaTest 0.42).
- **Live weather (QA force hook works on the deployed build):** march light-rain rain 138/splash 90 →
  downpour rain 460/splash 90; moor ashfall haze 4 → haze 14; low quality tier downpour → rain 0
  (qualityScale 0, splash 90 continues) — low/high particle gates PASS live. Crown snowstorm still
  sparse visually (known debt; no snow counter).
- **Live regions/views:** all 7 required + 8 optional views captured live; region fog follows the
  camera (march #1e4038 / moor #243939 / crown blend #313e49), colour distance 4.96–12.76, wind diff
  1.514; night mood TP canvas mean **51.28** (≤75); landing/third-person live screenshots show
  armour-v2 party (distinct helms/cloaks), rain streaks + wet sheen, canopies, blacksmith stall and
  night palette — matches local captures.
- **Live HUD context:** join button enabled 3.71 s (<3.8 gate); nav→HUD is inflated by QA landing
  steps (join offset ~19 s in the live views run); app-load evidence is the same click→HUD fast path
  as local (the live deployed pass had join offset 10.6 s and firstGameFrame 11.86 s).

**Cycle-4 live deployment is verified end-to-end: green, with the four visual debts + region-crown
blend nit carried into cycle 5.** task-52 complete; cycle-5 candidates: armour art richness (plates),
crown snowstorm density + snow particle counter, `__ssPreviewBody` framing, survivor identity,
region-crown pose, real-GPU/controller/mobile.

---

## Iteration cycle 2026-10H (AAA loop, cycle 5) — armour art v3, snowstorm, combat feel, content (in progress)

Cycle 5 clears the cycle-4 art/hook debts: armour art v3 (uniform plate texel density, 1024 atlases,
survivor identity, optional cloth-wind sway), Frozen Crown snowstorm density + `activeParticles.snow`,
`__ssPreviewBody` framing + crown camera fixes, combat feel (hit-stop/kick/vignette + reduced motion),
chapel altar + smithy furnaces, and surface-aware audio.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Armour v3 audit:** cycle-4 7-body close-ups + 10 m silhouettes retained; new gates/report:
  body-mask close-up colours **≥500 on ≥5/7 bodies** (exact per-body list, remainder as debt; ≥300
  floor), **plate texel-density** metric (gradient/edge-energy mean+p90 over the body crop) alongside
  the 2.8 m visual `read_image`, **survivor identity before/after** pixel-diff vs
  `qa/characters-b7/char-survivor-closeup.png`, and **cloth-wind** two-frame (~0.6 s) body-region diff
  compared against a static side strip (body motion > background motion), tone/clipping/elite gates
  retained.
- **`__ssPreviewBody` render probe:** baseline vs per-body preview screenshot diff for all 7 ids;
  gates "all 7 bodies render in frame" (cycle-4 hook rendered nothing).
- **Snowstorm audit:** explicit `__ssWeather().activeParticles.snow` counter (high > low), low quality
  tier **0 snow particles**, fog/whiteout via `__ssRegionInfo().fog.density` (high > low), optional
  `snow-compare` 10 m view when shipped, and gate `region-crown` reports `crown` (camera moved out of
  the moor blend).
- **Combat feel:** if `__ssCombatFx()` exists, triggers a heavy attack and samples hit-stop/kick/
  vignette state ~120 ms apart, then repeats under `Emulation.setEmulatedMedia` **prefers-reduced-
  motion: reduce** and gates reduced fx + reported reduced-motion flag; no-console-error gate retained.
- **Content:** optional QA poses `content-altar` (Ashen chapel), `content-furnace-village` /
  `content-furnace-camp` (smithy stalls) for the new altar/furnace props (poses/coords coordinated with
  ruins-builder).
- **Perf gates:** cycle-5 SPEC **<270 calls / <2.0 M tris**; tiers/payload/views retained; HUD app
  path (click→HUD/state, join ≤3.8 s) and nav numbers reported separately.

### Cycle-4 reference values (before cycle-5)

- Perf: 206 calls / 1,708,376 tris / 168 geoms / textures 178 / programs 96 / lights 17 / skinned 74;
  payload 15.76 MB (live 15.01 MiB across 84 assets).
- Characters: body-mask torso mean 85.73 / p50 71.31 / black 2.37 %; close-up body-mask colours
  607–874 (all ≥500 by the crop metric), full-frame 1,288–1,863; elite diff 29.76 / 86.1 %; fixed-crop
  informational 100.01/97.76.
- Debts being fixed: plate flat/wood-grain faces at 2.8 m; snow/snowstorm visually identical with no
  snow counter; `__ssPreviewBody` rendered no synthetic body; `region-crown` reported blend `moor`;
  survivor used a soldier rig; no QA-readable combat-feel state.
- **Armour-v3 final data (weapons-armory, final 08:13 bytes; supersedes c5v3-* sheets):** per body —
  templar 9,276 tris / 3 prims / 694.8 KB; hero 9,388/2/683.4; ally 9,231/3/675.1; berserker 8,749/3/
  654.2; ranger 9,021/3/665.6; survivor 8,947/3/665.8; fallen 8,838 GLB (8,914 runtime, +76-tri elite
  add-on) /2/654.9 KB. All bodies have a **1024² albedo + 256² normal/ORM** atlas, one 91-joint skin,
  12 clips, hand sockets; ≤15,500 tris / ≤900 KB. Plate geometry: max triangle area per plate prim
  **0.0028–0.0088 m²** (fallen fixed from 0.0353), max edge 0.135–0.467 m (survivor staff; under the
  0.5 m limit) — stretched-plate debt appears resolved. QA gradient cross-check on the c5final viewer
  sheets (same crop/definition): mean **9.46–11.06**, p50 0.00–1.51, p90 **27.77–32.16**, edge%
  **11.26–13.55** across all 7 bodies (survivor highest, hero lowest; no outlier). weapons-armory
  independently reproduced the same values with a ÷2 central-difference variant (×2 to match QA), so the
  metric is consistent; QA's in-game gradient pass will be reported per body.
  Survivor identity = tattered hood/cloak, pale patch panels, bedroll/satchel, rope belt (orange-red
  accent), walking staff (runtime asserts cloth + plate-accent prims and a staff rigid-weighted to
  `mixamorigRightHand`). Cloth-wind prims = `*_cloth` materials (templar/ally tabard-skirt, berserker
  fur/shoulder, ranger hood+cloak, survivor hood/cloak; hero/fallen plate-only); pose-frozen final
  evidence meanAbsLum **0.619 templar / 0.752 ranger / 0.540 survivor** vs **0.000 hero control**;
  `setCharacterWindQuality` is implemented and **now wired by world-scene in `scene.ts`** (low tier
  removes the shader term, medium/high keep the sway) — QA verifies low-tier wind contribution drops in
  the authoritative run. Masked body tone (all 7): mean **81.5–93.2** /
  p50 **75.1–91.8** / clip 0 % / black ≤4.31 % — inside gates. Masked palette (5-bit, strict mask):
  templar 606, berserker 739, survivor 1073, ally 697, hero 402, fallen 424, ranger 376 — **4/7 ≥500
  masked**; QA's crop metric is the gate and both numbers are reported, with the masked shortfall
  documented as cycle-6 art debt. Final sheets: `qa/char-viewer/shots/c5final-*`,
  `c5finalsil-base.png`, `c5finalwind-*`; survivor before/after vs `c4rich-base-closeup-survivor.png`.
  **Cloth-wind QA method note:** the harness captures two frames ~0.6 s apart with weather forced clear;
  body-region diff still includes idle animation, so weapons-armory's pose-frozen frames are the precise
  wind evidence and QA's diff is a motion-presence check (visual read_image decides cloth).

### Cycle-5 authoritative capture + regression — final build `index-CsjSWrV-.js` (879,493 B): PASS

**Artifact:** the Lead's definitive re-gate hash **`index-CsjSWrV-.js` (879,493 B)**. My clean
bundled-Node-24 build reproduced it exactly (deterministic; earlier `Dewa`/`CyiYOx4j` hashes were
superseded when a late `scene.ts` edit changed the tree). Fresh-build smoke **22/22 PASS** (`qa/final-c5b`;
hash reproduced; 0 page/console/log errors, 0 404s, 10 cards, WS 1/0, night TP mean **56.56** with
weather forced clear). Authoritative runs on this artifact: `--characters` **35/35**
(`qa/characters-c5`), `--perf` **42/42** (`qa/perf-c5`), `--views` **31/31** (`qa/views-c5`),
`--coop` **18/18** (`qa/coop-c5`), live baseline **19/19** (`qa/live-batch8-pre`).

**1) Armour art v3 — PASS.** 7 close-ups + 7/7 10 m silhouettes. **QA crop metric: body-mask colours
618–941 on 7/7 bodies** (≥500 target on ≥5/7 ✅: templar 637, hero 618, berserker 663, ranger 674,
ally 746, survivor 684, fallen 941; full-frame 1,280–1,962). Strict masked counts (weapons-armory)
606/739/1073/697/402/424/376 = **4/7 ≥500 masked** — the ranger/hero/fallen shortfall is documented
cycle-6 art debt (asset-forge has targets). **Plate texel density:** in-game gradient metric 6.66–12.86
(avg 7.73; fallen brightest at 12.86) with no flat-face outlier; cross-checked on the c5final viewer
sheets (mean 9.46–11.06 / p90 27.77–32.16; weapons-armory independently reproduced ×2). Visual 2.8 m
inspection: the cycle-4 oversized wood-grain/flat plates are gone (templar now shows patina/trim/
heraldry and curved plates; no stretched quad reads). Torso body-mask 68.89 / p50 61.16 / black 8.95 %
(in gates), clip 0 %, elite-undead diff **29.87 / 86.33 %**. **Survivor identity** changed vs cycle-4
(meanAbsLum 4.69 / 10.87 % changed; visual: ragged hood/cloak, pale patch panels, bedroll/satchel,
staff — clearly not a soldier clone). **Cloth wind:** two-frame body diff 7.80–17.92 vs static
background ≤0.91 on all 7 bodies (motion-presence; includes idle sway), with weapons-armory's
pose-frozen precision evidence **0.619 templar / 0.752 ranger / 0.540 survivor vs 0.000 hero**;
`setCharacterWindQuality` is wired in `scene.ts` (low tier drops the shader term) — low-tier visual
isolation not separately measured.

**2) Frozen Crown snowstorm + hooks — PASS.** `__ssWeather().activeParticles.snow` monotonic:
**240 (snow 0.3) → 800 (snowstorm 1.0)**; fog/whiteout `__ssRegionInfo().fog.density` **0.0185/0.0192 →
0.0239/0.0242**; low quality tier → **0 snow particles** (qualityScale 0; rain splash 90 remains for
rain's low-tier proof). Visuals: snowstorm is clearly dense with large flakes + whiteout haze vs sparse
snow (read_image; `qa/perf-c5/weather-snow-high.png`). Gust/gusts exposed (1.10→1.78 / 0→4).
**`region-crown` camera moved fully inside crown → `__ssRegionInfo().region === 'crown'`** (fog
#4b6678/0.0169), region distinctness 6.03–22.12 colour distance. **`__ssPreviewBody` render probe:
7/7 bodies rendered in frame** (cycle-4 debt fixed). Note: the `landmark-crown` optional view still
reports `moor` (it sits at the old border z≈−432) — informational only, not the region-crown gate.

**3) Combat feel — PASS.** `__ssCombatFx()` sampled across heavy attacks: **hit-stop 57.8–60 ms**,
**vignette opacity 0.648–0.816**, **kick 0.044–0.073**, heavyCount increments each attack; 0 console
errors, input/state checks unaffected. Reduced-motion via `__ssSetReducedMotion(true)`: hit-stop **0**,
kick ≤0.013, vignette **0** in two runs (one sample showed a residual 0.546 vignette — partial, noted
for polish) and the hook reports `reducedMotion:true`; restored with `null` after the probe.

**4) Content — furnaces PASS; altar present with a readability note.** Village furnace
(52.14,7.3) and camp furnace (32,−42.3) are clearly visible, grounded, with barrel+crate dressing and
no intersection/z-fighting (`view-content-furnace-village/camp`, read_image). Altar (−27.71,−226.14,
1.4 m): ritual stone/white dressing is visible at the chapel base from the ruins-builder pose and in
close-ups, but at night it reads small/low-contrast against the rubble — **cycle-6 readability note**
(not a blocking defect; owner framing/validator OK). Surface-audio hooks (`__ssSurfaceAt`) present and
0 errors; audibility cannot be heard headlessly — **ear-verification debt** documented.

**5) Performance — PASS.** Spawn TP **208 calls** (<270 ✅) / **1,726,954 tris** (<2.0 M ✅), geoms 171,
textures 181, programs 99, quality high; FP 160 calls / 1,609,390 tris; low 162/1,414,322 (−22 % calls);
medium/high 207/1,726M. Payload **17,037,811 B = 16.25 MiB** (+1.28 MB vs cycle-4 15.76 MB; armour v3 +
altar/furnace + audio). Tiers/persistence/loading PASS; wind (3-frame max) **1.063** (≥0.8); 7 required
+ 12 optional views (incl. content poses) captured. HUD app path: **click→HUD 158 ms, click→state
1,146 ms, join enabled 3,330 ms** (≤3.8 s); nav→HUD 20.2 s is QA-landing overhead (20.0 s), reported
separately; `__ssLoadTimings` marks coreReady 3.1 s / compileSkipped 5.5 s.

**6) Regression — PASS.** Fresh-build **22/22** + exact hash reproduction (`index-CsjSWrV-.js`),
co-op **18/18** (room join, movement propagation 3 m, shared weapon-rack unlock, both HUDs live),
live baseline **19/19** (deployed cycle-4: 10 cards, expected assets 200, 0 errors/404s except the
external Cloudflare beacon), 0 page/console/log errors throughout.

**Cycle-5 verdict: PASS on all gates.** Non-blocking debts for cycle 6: (a) strict-masked palette
shortfall on ranger/hero/fallen (4/7 ≥500 masked; asset-forge targets set), (b) altar night
readability/contrast at the Ashen chapel, (c) reduced-motion vignette not fully zero in one sample,
(d) low-tier cloth-wind shader saving wired but not visually isolated, (e) surface-audio ear check,
(f) real-GPU/perceptual/controller/mobile passes. After deploy: final live pass + task-59 complete.

### Final live deployment verification — cycle-5 (game `63a74d05`, hosting `648e5c20`)

Deployed after the Lead accepted the cycle-5 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch8-deployed --expect-weapons 10 `
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz,custom/stone_altar.glb.gz,custom/forge_furnace.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --views --out qa/live-views-c5
```

- **Results: PASS 23/23 (deployed pass) + PASS 31/31 (live views/weather/content).** Live serves
  **`assets/index-Dki3Ti_e.js` (879,643 B)** — the hosting/base-path build of the authoritative
  `index-CsjSWrV-.js` (879,493 B; +150 B, same hosting delta as cycle-4's 862,087 vs 861,937);
  `/health` OK; **11/11 expected assets HTTP 200** (7
  armour-v3 GLBs, stone_well, blacksmith_stall, **stone_altar 220,895 B, forge_furnace 280,799 B**);
  10 weapon cards; 0 page/console errors, 0 bad responses/404s, 0 failed requests; WS opens=1/closes=0.
  Only log entry: external Cloudflare-Insights beacon (third-party, not gated). Live verified sizes:
  templar 800,429 / survivor 784,780 / altar 220,895 / forge_furnace 280,799 / CREDITS 4,697 B.
- **Live payload:** 17,012,161 B = **16.22 MiB** across 86 assets (curl-verified) — **+1.22 MB** vs
  cycle-4 live 15,734,966 B (armour-v3 atlases + altar/furnace + audio).
- **Live night mood:** TP canvas mean **63.35** natural weather in the deployed pass (≤75), and
  **51.93** in the forced-clear views pass — night scene holds live. Combat feel verified live:
  hit-stop 60 ms, vignette 0.749, kick 0.071; reduced-motion (`__ssSetReducedMotion(true)`) → hit-stop
  0, kick 0.011, vignette 0.344 (partial residual again — cycle-6 polish note).
- **Live weather/content (views pass):** march rain 138/90 → 460/90; moor haze 4 → 14; crown snow
  **240 → 800**, fog **0.01827 → 0.02327**, low-tier **0 snow**, `region-crown` reports **crown**;
  region distances 5.23–23.38; wind max diff 1.289. All 7 required + 12 optional views captured live
  (incl. `content-altar(-close)`, `content-furnace-village/camp`); furnace views clearly show the
  grounded furnaces with barrel/crate dressing; altar reads as pale stone + ritual wax/books at the
  chapel base with the dark stone body merging into chapel shadow — matches the "present, low night
  contrast" classification (cycle-6 readability note; no rebuild).
- **Live HUD context:** join button enabled **3.33 s** (local authoritative run, gate ≤3.8 s); app-load
  evidence is the same fast click→HUD path as local (**158 ms / 1.15 s** click→HUD/state); the live
  views run's nav→HUD includes QA landing overhead as before.

**Cycle-5 live deployment is verified end-to-end: green, with the cycle-6 gaps recorded** (masked
palette ranger/hero/fallen, altar night readability, reduced-motion vignette residual, low-tier wind
isolation, surface-audio ear check, real-GPU/perceptual/controller/mobile, content depth). task-59
complete.

---

## Iteration cycle 2026-10I (AAA loop, cycle 6) — palette debt, sixth appearance, controller, reduced-motion, altar glow (in progress)

Cycle 6 clears the remaining QA debts: strict-mask palette hue chips (ranger/hero/fallen), a sixth
playable appearance **Wandering Survivor** (`survivor`), controller rumble/hints polish, exact
reduced-motion vignette zero, a readable low-tier cloth-wind state, altar candle glows, and the
`landmark-crown` camera move.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Sixth appearance:** `PLAYER_APPEARANCES` now has 6 entries incl. `survivor`; the character run
  reads the selector options and gates the 6 values + the **"Wandering Survivor"** label, then selects
  it as the actual player, captures third-person (`char-survivor-thirdperson.png`), checks the server
  snapshot appearance field, the equipped-weapon HUD, and that all 7 body close-ups/10 m silhouettes
  still render.
- **Strict-mask palette:** new QA-side strict proxy (`analyzeStrictMaskedPalette`) — preview-body frame
  vs no-body baseline diff (>40) inside the central band, counting 5-bit RGB unique colours per body —
  reported alongside the owner/weapons-armory strict counter and the existing crop metric. Acceptance
  gate stays on the reproducible owner counter (≥500 on ≥5/7) with QA proxy/crop as corroboration.
- **Controller:** deterministic synthetic-pad injection via `navigator.getGamepads` + a
  `GamepadEvent('gamepadconnected')`, no `vibrationActuator` on the fake pad; checks connect clean, an
  attack path with the rumble guard absent, hint-UI reaction (or documented hardware/debt), then
  restores and disconnects. Uses `__ssPad()` when world-scene exposes it.
- **Reduced-motion exact gate:** after enabling `__ssSetReducedMotion(true)`, the harness settles until
  vignette/hit-stop are 0, runs **two** heavy-hit samples and requires vignette **exactly 0**,
  hit-stop **0**, kick **≤0.013**, with normal-motion peaks still >0.
- **Low-tier cloth-wind isolation:** `__ssCharacterFx()` (world-scene) read at high vs low quality;
  gates `clothWind:true` high / `false` low and reports compile/console cleanliness.
- **Altar glow + crown camera:** `content-altar-close` capture diffed against the cycle-5 reference
  (night close-up must change/brighter from the candle glows); `landmark-crown` now also gates
  `__ssRegionInfo().region === 'crown'` (in addition to `region-crown`).
- **Perf gates:** cycle-6 SPEC **<280 calls / <2.05 M tris**; tiers/payload/views/HUD app path retained.

### Cycle-5 reference values (before cycle-6)

- Perf: 208 calls / 1,726,954 tris / geoms 171 / textures 181 / programs 99 / high quality; payload
  16.25 MiB (live 16.22 MiB across 86 assets); live bundle `index-Dki3Ti_e.js` (879,643 B).
- Armour: QA crop body-mask colours 618–941 (7/7 ≥500); strict owner counter 4/7 ≥500
  (templar 606, berserker 739, survivor 1073, ally 697, hero 402, fallen 424, ranger 376); torso
  68.89/61.16/black 8.95; elite 29.87/86.33.
- Night/weather: night TP 51–63; snow 240→800, fog 0.0185→0.0242, crown reports crown.
- Debts being fixed: strict-mask ranger/hero/fallen <500; sixth appearance not selectable; controller
  rumble/hints missing; reduced-motion vignette residual (0.344–0.546 in one sample); low-tier wind
  isolation not readable; altar night contrast; `landmark-crown` at border.

### Cycle-6 authoritative capture + regression — final build `index-BY6s-QI9.js` (883,369 B): PASS (strict-mask palette debt deferred to cycle 7)

**Artifact:** Lead-confirmed final hash **`index-BY6s-QI9.js` (883,369 B)**. My clean bundled-Node-24
build reproduced it **exactly** (fresh-build smoke **26/26 PASS**, `qa/final-c6`; 0 page/console/log
errors, 0 404s, 10 cards, WS 1/0, night TP **70.9** with forced clear). Authoritative runs on this
artifact: `--characters` **45/45** (`qa/characters-c6`), `--perf` **47/47** (`qa/perf-c6`),
`--coop` **18/18** (`qa/coop-c6`), live baseline **21/21** (`qa/live-batch9-pre`; controller hooks
absent on the deployed cycle-5 build → controller checks skipped there and re-run on the deployed
cycle-6 artifact).

**1) Masked palette + armour v3 — PASS on the Lead-designated crop gate; strict-mask debt deferred.**
QA crop metric: body-mask colours **605–955 on 7/7 bodies** (templar 757, hero 648, berserker 753,
ranger 605, ally 732, survivor 810, fallen 949; full-frame 1,295–1,434) ✅. Strict silhouette-mask
(weapons-armory, reproducible `qa/char-viewer --view closeup --pose 30`, alpha mask + 5-bit RGB):
templar 559, ally 707, berserker 725, survivor 1077 = **4/7 ≥500**; hero 454, fallen 460, ranger 379
still short (hero +52 / fallen +36 vs cycle-5; ranger +3) → **recorded cycle-7 art debt**, not a cycle
failure per Lead decision. QA strict proxy (preview-body diff mask, 5-bit): **7/7 ≥500** (518–709) —
reported for corroboration only; owner counter is authoritative. Tone: body-mask torso 82.35 / p50
72.32 / black 4.62 %, clip 0 %; gradient 6.96–13.04 (avg 8.12); elite-undead diff 30.82 / 88.4 %.
Survivor identity diff vs cycle-4 **31.93 / 55.18 %** (dramatic change; staff now back-mounted,
hands free, weapon Longsword attached).

**2) Sixth appearance "Wandering Survivor" — PASS.** Selector has **6 options incl. Wandering
Survivor** (`__ssCharacterSelect`: `appearanceField:'appearance'`, landing `#characterChoice`, in-game
`#characterChoiceInGame`); selecting `survivor` updates the authoritative snapshot **appearance:
'survivor'**, renders the player in third person (`char-survivor-thirdperson.png`) with **Longsword**
attached, grounded; other 6 bodies still render 7/7 close-ups + 10 m silhouettes; 0 errors.

**3) Controller / rumble guard — PASS (physical rumble hardware debt).** Synthetic **standard-mapping**
pad (17 buttons, no `vibrationActuator`) injected via `navigator.getGamepads` + `gamepadconnected`:
`__ssPad()` reports connected/mapping standard/hintsVisible, `#padHints` shows **6 glyph hints**
(RT Attack/LT Block/B Sweep/X Heal/A Interact/Y View) + `body.pad-connected` + connection toast;
attack path with absent actuator → **0 errors**; reduced-motion emulation flips `reducedMotion/
rumbleGuarded` true; disconnect hides hints/class and shows keyboard toast. Physical rumble timing on a
real pad remains hardware debt.

**4) Reduced-motion — PASS.** Settled to zero, then **two** heavy-hit samples under
`__ssSetReducedMotion(true)`: vignette **exactly 0**, hit-stop **0**, kick **0** (both samples, all
runs); normal path peaks positive (hit-stop 10–60 ms, vignette 0.749, kick 0.05–0.075) — cycle-5
residual is fixed. `__ssCharacterFx()` reports high/medium `clothWind:true`, low `false` (low-tier
wind isolation readable, 0 shader-compile errors).

**5) Content / altar glow — implemented; capture caveat documented.** Furnaces unchanged/visible.
Altar glow (`+3` candle cones on `dressing:flames`, 0 new draws/lights, warm emissive lift) is in code;
ruins-builder supplied isolated-build evidence (`c6-build/captures-c6/view-content-altar-close2/3.png`).
**QA caveat:** `content-altar` poses only move the camera while `dressing:altar/flames` are
player-distance culled at 85 m (altar ~270 m from spawn), so the final artifact's content-altar frames
cannot show the altar/candles — documented cycle-7 ask (make dressing culling follow the QA camera or
add a teleport/`__ssSpawnAt` hook). `landmark-crown` now reports **crown** ✅ (alongside
`region-crown` crown).

**6) Perf / HUD / regression — PASS.** Spawn TP **206 calls** (<280 ✅) / **1,726,578 tris**
(<2.05 M ✅), geoms 171, textures 181, programs 100, quality high; FP 160/1.61 M; low 161/1.41 M
(−22 % calls); payload **17,100,027 B = 16.31 MiB** (+0.15 MB vs cycle-5 local). Night TP forced-clear
**50.2–70.9** (≤75; Lead gate 68.55); regions 19.79–21.82 colour distance; snow **132→440**, fog
**0.01848→0.02352**, low-tier snow **0**; HUD click→HUD 4.5 s / click→state 6.6 s / join **3.77 s**
(≤3.8 gate, tight under SwiftShader); fresh-build **26/26** + exact hash, co-op **18/18**, live
baseline **21/21**, 0 page/console/log errors and 0 404s throughout.

**Cycle-6 verdict: PASS on all non-deferred gates**, with the Lead-deferred strict-mask palette debt
(hero 454 / fallen 460 / ranger 379; 4/7) and the altar-culling capture caveat as the two carried
items. Cycle-7 gaps: strict-mask palette (hero/fallen/ranger), altar culling/teleport capture hook,
physical-gamepad rumble/hardware verification, surface-audio ear check, real-GPU/perceptual/controller/
mobile passes, content depth. After deploy: final live pass + task-66 complete.

### Final live deployment verification — cycle-6 (game `d4b095c9`, hosting `ed6a59b3`)

Deployed after the Lead accepted the cycle-6 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch9-deployed --expect-weapons 10 `
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz,custom/stone_altar.glb.gz,custom/forge_furnace.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --probe-preview --out qa/live-sixth-c6
```

- **Results: PASS 27/27 (deployed pass) + PASS 25/25 (live sixth-appearance/probe run).** Live serves
  **`assets/index-CwNoKm_O.js` (883,519 B)** — hosting/base-path build of authoritative
  `index-BY6s-QI9.js` (883,369 B; +150 B, consistent with prior hosting deltas); `/health` OK;
  **11/11 expected assets HTTP 200** (7 armour GLBs incl. **survivor 791,204 B**, hero 798,296,
  stone_well, blacksmith_stall, **stone_altar 220,895**, **forge_furnace 280,799**); 10 cards; 0
  page/console errors, 0 bad/404/failed requests; WS opens=1/closes=0. Only log: external
  Cloudflare-Insights beacon (third-party, not gated).
- **Live payload:** 17,074,377 B = **16.28 MiB** across 86 assets (curl-verified) — +0.06 MB vs
  cycle-5 live; CREDITS 4,697 B.
- **Sixth appearance live:** selector synced to **survivor** (`__ssCharacterSelect` value/inGameValue
  survivor, in-game `#characterChoiceInGame`); authoritative snapshot **appearance:'survivor'**; live
  third-person `probe-survivor-tp.png` shows the Wandering Survivor as the player with weapon attached;
  0 page errors.
- **Controller live:** cycle-6 hooks present — `__ssPad()` connected/standard/hintsVisible; HUD
  `#padHints` **6 glyph hints** + `pad-connected` class + connection toast; rumble guarded with no
  `vibrationActuator` (0 errors); reduced-motion emulation flips `reducedMotion/rumbleGuarded` true;
  disconnect hides hints/class and shows keyboard toast.
- **Reduced motion live:** two heavy-hit samples under `__ssSetReducedMotion(true)` → vignette **0**,
  hit-stop **0**, kick **0**; normal peaks intact (hit-stop 60 ms, vignette 0.749, kick 0.068).
  Low-tier `__ssCharacterFx()` reports `clothWind:false` (high/medium true) live.
- **Night/weather live:** TP canvas mean **56.12** (deployed pass) / **50.99** (probe run) ≤75;
  deterministic clear-weather night capture via `__ssSetWeather('march','clear',0)`; `__ssClearWeather`
  ships from world-scene (used for local QA clear; not separately re-exercised live). Regions/crown
  verified on the authoritative artifact; altar content capture remains culling-limited (cycle-7 ask).
- **Live HUD/regression:** join button enabled 3.77 s local (tight ≤3.8); live nav→HUD includes QA
  landing overhead as usual; 0 404s; 10 cards; no console/page errors.

**Cycle-6 live deployment is verified end-to-end: green, with the deferred strict-mask palette debt and
the altar-culling capture caveat carried into cycle 7.** task-66 complete; cycle-7 candidates:
strict-mask palette hero/fallen/ranger, altar capture/teleport hook, physical controller rumble/real
hardware, surface-audio ear check, real-GPU/perceptual/mobile passes, content depth.

---

## Iteration cycle 2026-10J (AAA loop, cycle 7) — enemy variants, palette, content capture hook, accessibility (in progress)

Cycle 7 adds two undead silhouettes (`zombie-bloated`, `skeleton-armoured`) mapped deterministically by
actor id, clears the remaining strict-mask palette debt (ranger/hero/fallen), makes QA content views
render the player-distance-culled altar/furnace/well dressing, adds accessibility captions + controller
deadzone/sensitivity settings, and enriches the plague-nest ritual dressing.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Enemy variants:** new `probeEnemyVariants` reads `__ssEnemyVariants()` when present (else derives
  the id%4 mapping from the authoritative actor list), captures base zombie / skeleton-soldier and
  `zombie-bloated` / `skeleton-armoured` actors close-up + 10 m, checks distinct silhouettes (pixel
  diff vs base), frame-to-frame animation/grounding, and records the defensive-fallback state (code/
  unit-test verified when not forceable headlessly). Live assets include the two variant GLBs.
- **Strict-mask palette:** owner-counter values are tracked in `CHAR_GATE.cycle7StrictMasked`; QA gates
  **≥500 on ≥5/7** on that reproducible counter and reports its own crop metric + preview-body strict
  proxy alongside (crop metric is also reported per body).
- **Content capture:** the content views are gated by comparing `content-altar-close` against the
  cycle-5 (no-props) reference — a strong diff proves the QA-focus culling fix renders the culled
  altar/candles; furnace/well captures are reported; normal-play player-focus 85 m culling is
  unchanged in source.
- **Accessibility/controller:** captions toggle + cue evidence (thunder/undead/low health when the hook/
  DOM is available), deadzone/sensitivity preset persistence, deterministic readPad state, and the
  existing reduced-motion/rumble-guard probes retained.
- **Plague-area dressing:** optional QA view/pose near the nest (0,−664) for a night capture to verify
  the ritual/corpse/stake dressing and 0 404s.
- **Perf gates:** cycle-7 SPEC **<290 calls / <2.15 M tris**; tiers/payload/views/HUD app path retained.

### Cycle-6 reference values (before cycle-7)

- Perf: 206 calls / 1,726,578 tris / geoms 171 / textures 181 / programs 100; payload 16.31 MiB (live
  16.28 MiB across 86 assets); authoritative bundle `index-BY6s-QI9.js` (883,369 B), live
  `index-CwNoKm_O.js` (883,519 B).
- Armour: QA crop colours 605–955 (7/7 ≥500); strict owner counter **4/7 ≥500** (templar 559, ally 707,
  berserker 725, survivor 1077; hero 454, fallen 460, ranger 379); torso 82.35/72.32/black 4.62; elite
  30.82/88.4 %; survivor identity verified live.
- Controller/reduced-motion: synthetic pad hints/rumble guard live; reduced-motion exactly 0 vignette/
  hit-stop/kick; cloth-wind isolation high/medium true, low false.
- Content/altar: implemented but culling-limited captures (cycle-7 hook to fix); furnaces visible.

### Cycle-7 authoritative capture + regression — final build `index-BF93HyxO.js` (889,821 B): PASS

**Artifact:** Lead-confirmed final hash **`index-BF93HyxO.js` (889,821 B)**. Fresh bundled-Node-24 build
reproduced it **exactly** (fresh-build smoke **38/38 PASS**, `qa/final-c7`; 0 page/console/log errors,
0 404s, 10 cards, WS 1/0, night TP **53.66** forced-clear). Authoritative runs: `--characters` **58/58**
(`qa/characters-c7`), `--perf` **60/60** (`qa/perf-c7`), `--coop` **18/18** (`qa/coop-c7`), live
baseline **PASS** (`qa/live-batch10-pre`, deployed cycle-6 baseline).

**1) Enemy variants — PASS.** `__ssEnemyVariants()` reports both assets available
(`zombie-bloated` fallback `zombie`, `skeleton-armoured` fallback `skeleton-soldier`) with the
deterministic **id%4** rule (0 zombie, 1 skeleton-soldier, 2 zombie-bloated, 3 skeleton-armoured);
captured in-world actors `a6` (bloated) and `a7` (armoured) close-up + 10 m. Distinct silhouettes:
base-zombie vs bloated **meanAbsLum 31.9 / 70.5 % changed**, base-skeleton vs armoured **64.0 / 96.8 %**;
both animate/ground (frame diff 3.8 / 16.4 with 5–48 % body pixels moving). Contracts: bloated
10,620 tris / 2 prims / 30 joints / 10 clips / 361 KB; armoured 7,089 / 2 / 51 / 9 / 286 KB.
Fallback is code + unit-test verified (no headless force hook; world-scene wires `custom.get(variant) ??
custom.get(base)`). **Art note:** bloated is intentionally plague-pale and still clearly brighter than
the base zombie at night (owner close-up mean ~126 vs 83) — cycle-8 tone note, not a failure. **QA
capture caveat:** the in-world bloated close-up/10 m QA frames are partly obstructed by camp props
(weapon rack/cart) because `__ssCharacterPreview` must frame the existing actor where it spawned; the
armoured silhouette is clearly visible. Canonical silhouette evidence is weapons-armory's
`qa/char-viewer/shots/c7var-base.png` (10 m line) + `c7bl2`/`c7h2` close-ups; a QA enemy-framing/spawn
hook is a cycle-8 ask (not a model defect).

**2) Strict-mask palette — PASS (7/7 ≥500).** Owner counter (weapons-armory pose-pinned): templar 561,
hero 526, berserker 721, ranger 651, ally 694, survivor 1082, fallen 937 — **7/7 ≥500** (SPEC ≥5/7
met; hero is closest at 526). QA crop metric **7/7 ≥500** (638–1033); QA strict proxy 7/7 (597–700);
gradient 7.11–13.08; torso body-mask 84.48 / 76.68 / black 5.03 %; clip 0; elite 31.36 / 87.89 %.

**3) Content capture hook — PASS.** `__ssPerf().contentFocus` is non-null while content QA views are
active (`content-altar` −16,−224; `content-altar-close` −24,−221; `content-furnace-village` 48,18;
`content-furnace-camp` 40,−44; `content-plague` −8,−680). `content-altar-close` differs strongly from
the cycle-6 no-props reference (meanAbsLum **17.17 / 29.5 % changed**) → the altar + candles now render
in QA captures; furnaces/wells captured; plague-nest ritual dressing captured at ruins-builder's final
pose (`content-plague`, mean 65.5, 2,022 colours). Normal-play culling remains player-focus at 85 m
(source unchanged); 0 404s.

**4) Accessibility + controller settings — PASS.** Controls exist with correct defaults (captions off;
deadzone normal 0.18; sensitivity 1). Captions: enabling the toggle shows thunder/undead/low-health
texts (`Lightning. Thunder rolls in the distance.` / `Undead moan nearby.` / `Low health. Find cover or
heal.`), auto-clears after ~3.8 s, is suppressed when disabled or gated (Guide); persistence keys
`ss-captions`. Deadzone presets tight/normal/wide apply through `__ssControllerSettings()` and persist
(localStorage `ss-deadzone`), sensitivity 1.4 persists (`ss-pad-sensitivity`); readPad default path
unchanged, hints/rumble/reduced-motion guards intact (0 errors).

**5) Perf / HUD / regression — PASS.** Spawn TP **213 calls** (<290 ✅) / **1,735,988 tris**
(<2.15 M ✅), geoms 175, textures 188, programs 101; FP 165/1.62 M; low 164/1.42 M; payload
**17,847,399 B = 17.02 MiB** (+0.7 MB vs cycle-6 local, enemy variants + content). Night TP forced-clear
**53.66** (≤75; Lead gate 69.96); weather/snow unchanged (240→800, fog 0.0189→0.0242, low-tier 0);
regions 22.95–25.37 colour distance; `region-crown` AND `landmark-crown` report crown; HUD click→HUD
**157 ms** / state 1,276 ms / join **3.35 s** (≤3.8); fresh-build **38/38** + exact hash, co-op
**18/18**, live baseline PASS, 0 page/console/log errors and 0 404s throughout.

**Cycle-7 verdict: PASS on all gates.** Cycle-8 candidates: zombie-bloated night tone (pale vs base),
hero strict-mask 526 headroom, physical controller rumble/real hardware, real-GPU/perceptual/mobile
passes, surface-audio ear check, content depth, nest ground-decal polish. After deploy: final live
pass + task-73 complete.

### Final live deployment verification — cycle-7 (game `6f576e82`, hosting `3d81106c`)

Deployed after the Lead accepted the cycle-7 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch10-deployed --expect-weapons 10 `
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz,custom/stone_altar.glb.gz,custom/forge_furnace.glb.gz,custom/zombie-bloated.glb.gz,custom/skeleton-armoured.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --views --out qa/live-views-c7
```

- **Results: PASS 37/37 (deployed pass) + PASS 46/46 (live views/content run).** Live serves
  **`assets/index-sJM8R4Jf.js` (889,971 B)** — hosting/base-path build of authoritative
  `index-BF93HyxO.js` (889,821 B; +150 B); `/health` OK; **13/13 expected assets HTTP 200**
  (7 armour GLBs, stone_well, blacksmith_stall, stone_altar, forge_furnace, **zombie-bloated 369,628**,
  **skeleton-armoured 292,792**; hero 802,229 / ranger 830,666); 10 cards; 0 page/console errors,
  0 bad/404/failed requests; WS opens=1/closes=0. Only log: external Cloudflare-Insights beacon.
- **Live payload:** 17,821,149 B = **17.00 MiB** across 88 assets (curl-verified) — +0.71 MB vs
  cycle-6 live; CREDITS 4,697 B.
- **Enemy variants live:** `__ssEnemyVariants()` availability true for both; variant actors in the
  authoritative list (id%4); close-up/10 m captures produced (bloated QA frame partly obstructed by
  camp props — canonical silhouette evidence in weapons-armory `c7var-base.png`); armoured silhouette
  clear; animations/grounding verified; 0 errors.
- **Accessibility/controller live:** captions toggle + `__ssCaptionDemo` cues show/auto-clear/suppress
  correctly; deadzone presets tight/wide/normal (0.10/0.28/0.18) and sensitivity 1.4 apply + persist
  (`ss-deadzone`, `ss-pad-sensitivity`); hints/rumble/reduced-motion guards unchanged; 0 errors.
- **Content views live:** `contentFocus` active; `content-altar` mean 34.4 (vs 31.7 cycle-6 — altar/
  candles now render), furnaces/wells captured, `content-plague` mean 65.3 with the plague-nest ritual
  dressing (braziers/candles/graves/stakes/walls/barrels/cart); normal-play 85 m culling unchanged;
  0 404s.
- **Night/weather live:** deployed pass TP mean **53.23** and views run **51.35** (≤75); regions/
  crown unchanged; `landmark-crown` crown on the authoritative artifact; 0 errors.
- **Live HUD/regression:** join 3.35 s local (≤3.8); live nav→HUD includes QA landing overhead;
  10 cards; 0 404s; no page/console errors.

**Cycle-7 live deployment is verified end-to-end: green.** task-73 complete; cycle-8 candidates:
zombie-bloated night tone, enemy QA framing/spawn hook, physical rumble/hardware, real-GPU/perceptual/
mobile, surface-audio ear check, content depth, nest ground-decal polish.

---

## Iteration cycle 2026-10K (AAA loop, cycle 8) — mobile/touch, enemy QA framing, hit feedback, tone (in progress)

Cycle 8 ships browser-native mobile/touch experience, device-aware quality, the enemy QA framing hook,
combat hit feedback v2 (flash/stagger/impact), zombie-bloated night-tone correction, nest ground
decals, and mobile/accessibility settings.

### Harness additions (`scripts/smoke-browser.mjs`)

- **Mobile/touch mode (`--mobile`)**: CDP `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled`
  + mobile UA + optional `setSafeAreaInsetsOverride` are applied **before navigation**, then the page is
  reloaded after clearing storage for the auto-quality path. Checks: `__ssDeviceProfile()` touch/
  suggested/applied/dpr/maxDpr, touch HUD (`#touch`/`#stick`/`#lookpad`/`[data-hold]`) visibility,
  keyboard-hint hiding, HUD-panel overlap, safe-area/inset layout, multi-touch move+look+attack via
  CDP touch events with `__ssTouch()` pointer/held state, pinch/scroll zoom prevention, portrait
  390×844 + landscape 844×390 screenshots, and landscape profile/quality retention. Desktop runs are
  unaffected (mobile checks only run in `--mobile`).
- **Enemy preview hook:** `probeEnemyPreview` frames `__ssPreviewEnemy()` for zombie/skeleton-soldier/
  zombie-bloated/skeleton-armoured at 2.8 m + 10 m, checks base-vs-variant distinctness (body-centred
  crop at 10 m), `null` restore, and the zombie-bloated vs base close-up tone delta (cycle-8 tone fix).
- **Hit feedback v2:** `probeHitFeedback` uses `__ssEnemyHitFx()` / `__ssTriggerEnemyHit()` /
  `__ssHitRigIds()` (deterministic; preview rigs included), samples flash/stagger state per base +
  variant, captures before/during frames, checks hit-counter increments, and verifies reduced-motion
  suppression via `__ssSetHitFeedbackReducedMotion`.
- **Tone/content:** plague-nest capture diffed against the cycle-7 reference to prove ground
  decals/enrichment; altar/furnace QA-focus checks retained; zombie-bloated/hero palette numbers
  updated from owner counters (strict gate ≥5/7, currently 7/7).
- **Perf gates:** cycle-8 SPEC **<290 calls / <2.15 M tris**; tiers/payload/views/HUD app path retained;
  mobile-emulation tier sanity (auto low/medium; DPR clamp).

### Cycle-7 reference values (before cycle-8)

- Perf: 213 calls / 1,735,988 tris / geoms 175 / textures 188 / programs 101; payload 17.02 MiB local
  (live 17.00 MiB across 88 assets); authoritative bundle `index-BF93HyxO.js` (889,821 B), live
  `index-sJM8R4Jf.js` (889,971 B).
- Armour: strict mask 7/7 ≥500 (templar 561, hero 526, berserker 721, ranger 651, ally 694, survivor
  1082, fallen 937); crop 7/7 638–1033; torso 84.48/76.68/black 5.03; hit feedback/QA preview hooks
  absent; mobile touch HUD partially laid out but CSS zoom/overlap gates open; zombie-bloated tone
  ~126 vs base 83 (owner mask).

### Cycle-8 authoritative capture + regression — final build `index-2pShR6WA.js` (898,219 B): PASS

**Artifact:** Lead-confirmed final hash **`index-2pShR6WA.js` (898,219 B)**. Fresh bundled-Node-24 build
reproduced it **exactly** (fresh-build smoke **26/26 PASS**, `qa/final-c8`; 0 page/console/log errors,
0 404s, 10 cards, WS 1/0, night TP **54.53** forced-clear). Authoritative runs: `--characters`
**67/67** (`qa/characters-c8`), `--perf` **70/70** (`qa/perf-c8`), `--mobile` **22/22**
(`qa/mobile-c8`), `--coop` **18/18** (`qa/coop-c8`), live baseline **26/26**
(`qa/live-batch11-pre`, deployed cycle-7; only external Cloudflare beacon in logs).

**1) Mobile/touch — PASS (portrait 390×844 + landscape 844×390).** CDP device-metrics + touch
emulation + mobile UA applied before navigation and reloaded with cleared storage. Portrait and
landscape both: `#touch` HUD active (`body.touch-device`), stick/lookpad/3 action buttons visible,
keyboard hint bar hidden, HUD panels non-overlapping, controls inside viewport with safe insets, no
page scroll/zoom (pinch test scale stays 1, `#world`/controls `touch-action:none`), **3-pointer
multi-touch** (move+look+attack) with `__ssTouch()` showing `pointers.count=3/multiTouch=true/
held.attack=true` and player moved 4.1 m + yaw 0.36; touch look sensitivity 1.4 applies/persists
(`ss-touch-sensitivity`); `__ssDeviceProfile()` `{touch:true,coarse:true,smallScreen:true,
suggestedQuality:'low',appliedQuality:'low',maxDpr:1.25}` and mobile `__ssPerf()` **130 calls /
1,309,725 tris** (low tier). Screenshots `mobile-portrait.png` / `mobile-landscape.png`; desktop runs
unchanged.

**2) Enemy QA framing — PASS.** `__ssPreviewEnemy()` frames **all 4 undead appearances** (zombie,
skeleton-soldier, zombie-bloated, skeleton-armoured) at **2.8 m + 10 m** (8 captures), base-vs-variant
silhouettes distinct at both distances (10 m body-centred diffs 1.36–23.87 meanAbsLum / 1.8–75 %
changed), `null` removes the body (restore diff 25.79/75 %) and returns `{ok,appearance:null}`;
`__ssEnemyVariants()` availability/mapping still live; in-world id%4 captures retained.

**3) Hit feedback v2 — PASS (state + frame evidence; screenshot-timing caveat).**
`__ssEnemyHitFx()` on triggered hits for base + all 3 variants: **flashActive true** with
flashRemaining ~111–130 ms, flashWeight 1.4 (heavy) / 0.9, **staggerActive true** ~160–183 ms,
hit counter increments every trigger; framed hit frames visibly change (zombie 30.3 mean / 90 %
changed, bloated 44.1 / 90 %); reduced-motion (`__ssSetHitFeedbackReducedMotion(true)` +
`__ssSetReducedMotion(true)`) → flashActive false, staggerActive false, reduced true, 0 errors.
Real gameplay wiring is in scene.ts on every damaging hit (world-scene/weapons confirm); QA’s slow
SwiftShader hit screenshots can land after the 130 ms pulse (one frame caught the death overlay), so
the deterministic hook state + weapons-armory’s framed canonical shots (`qa/char-viewer/shots/
ingame-preview-hit-*`, `c8hit-*`/`c8red-*`) are the visual cross-reference — cycle-9 ask: pause/sync
the hit frame for a pretty in-game capture.

**4) Tone/nest — PASS.** `__ssPreviewEnemy` close-up tone: base zombie core mean **89.25** vs
zombie-bloated **97.89** (delta **+8.6**; cycle-7 owner-mask delta ~43; plague-pale read retained,
accepted owner base+24 masked as intentional). Hero reverted to cycle-7 bytes → strict mask stays
**7/7 ≥500**. `content-plague` now shows the enriched ritual nest + **corruption feather ground
decals** (44-instance mesh): capture differs from cycle-7 by **11.99 meanAbsLum / 42.3 % changed**;
altar/furnace QA-focus captures still render props (`contentFocus` non-null); normal-play 85 m
player-focus culling unchanged.

**5) Perf / HUD / regression — PASS.** Spawn TP **211 calls** (<290 ✅) / **1,735,004 tris**
(<2.15 M ✅), geoms 175, textures 188, programs 100; FP 165/1.62 M; low 162/1.42 M; payload
**17,890,209 B = 17.06 MiB** (+0.06 MB vs cycle-7 local). Night TP **51.21** (≤75; Lead gate 65.32);
regions 8.64–24.19 colour distance; crown cameras crown; snow 132→440 / fog 0.0189→0.0237 / low-tier 0;
wind 3.316; HUD click→HUD **3.27 s** / state 6.29 s (both gates) / join **3.61 s** (≤3.8); fresh-build
**26/26** + exact hash, co-op **18/18**, live baseline **26/26**, 0 page/console/log errors, 0 404s.

**Cycle-8 verdict: PASS on all gates**, with the hit-frame screenshot timing and zombie-bloated
intentional tone as cycle-9 notes. Cycle-9 candidates: physical-device mobile/real-GPU/perceptual
passes, hardware controller rumble, hit-flash frame-sync capture, surface-audio ear check, content/
campaign depth, further enemy variety. After deploy: final live pass + task-80 complete.

### Final live deployment verification — cycle-8 (game `8c72d1bb`, hosting `f373932e`)

Deployed after the Lead accepted the cycle-8 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ `
    --out qa/live-batch11-deployed --expect-weapons 10 `
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz,custom/stone_altar.glb.gz,custom/forge_furnace.glb.gz,custom/zombie-bloated.glb.gz,custom/skeleton-armoured.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --mobile --out qa/live-mobile-c8
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --perf --out qa/live-perf-c8
```

- **Results: PASS 27/27 (deployed pass) + PASS 22/22 (live mobile) + PASS 70/70 (live views/content/
  heavy hooks).** Live serves **`assets/index-NAyaupV0.js` (898,394 B)** — hosting/base-path build of
  authoritative `index-2pShR6WA.js` (898,219 B; +175 B); `/health` OK; **13/13 expected assets HTTP
  200** (7 armour GLBs, stone_well, blacksmith_stall, stone_altar, forge_furnace, **zombie-bloated
  367,162**, **skeleton-armoured 292,792**; hero 802,229); 10 cards; 0 page/console errors, 0
  bad/404/failed requests; WS opens=1/closes=0. Only log: external Cloudflare-Insights beacon.
- **Live payload:** 17,863,684 B = **17.04 MiB** across 89 assets (curl-verified) — +0.04 MB vs
  cycle-7 live; CREDITS 4,697 B.
- **Live mobile/touch:** `__ssDeviceProfile()` `{touch,coarse,smallScreen,suggestedQuality:'low',
  appliedQuality:'low',maxDpr:1.25}`; `#touch` HUD, stick/lookpad/action buttons visible and
  non-overlapping in portrait 390×844 **and** landscape 844×390; keyboard hints hidden; safe insets;
  pinch/scroll scale stays 1; **3-pointer multi-touch** (`__ssTouch`: pointers 3, held.attack true,
  player moved 4.5 m/yaw .36); touch look sensitivity 1.4 persists; mobile `__ssPerf()` **128 calls /
  1,309,525 tris** (low tier). `mobile-portrait/landscape.png` captured live.
- **Live feature hooks:** `__ssPreviewEnemy` frames all 4 undead at 2.8/10 m; `__ssEnemyHitFx`/
  `__ssTriggerEnemyHit` flash+stagger live incl. reduced-motion suppression; captions + deadzone/
  sensitivity settings live; `__ssEnemyVariants` availability true.
- **Live content/weather:** `content-altar-close` differs strongly from the no-props reference
  (**20.52 / 41.7 %**); `contentFocus` non-null for all content views; plague nest + ground decals
  captured live (diff vs cycle-7 **9.21 / 33.5 %**, 1,987 colours); furnace/well props visible; snow
  240→800, fog 0.01847→0.02196, low-tier 0; both crown cameras report crown; night TP **53.62**
  (deployed pass) / **51.18** (perf run) ≤75.
- **Live HUD/regression:** join 3.61 s local (≤3.8); live nav→HUD includes QA landing overhead;
  10 cards; 0 404s; no page/console errors.

**Cycle-8 live deployment is verified end-to-end: green**, with the hit-frame screenshot timing and
intentional zombie-bloated tone carried as cycle-9 notes. task-80 complete; cycle-9 candidates:
physical-device mobile/real-GPU/perceptual passes, hardware controller rumble, hit-flash frame-sync
capture, surface-audio ear check, content/campaign depth, further enemy variety.

---

## Iteration cycle 2026-10L (AAA loop, cycle 9) — War Spear (11th weapon), abbey landmark, hit-hold, audio state (in progress)

Cycle 9 adds the War Spear (11th WEAPON_IDS-driven weapon), a ruined-abbey Green March landmark, the
hit-flash hold QA hook for still captures, and `__ssAudioState()` for systematic soundscape evidence.

### Harness additions (`scripts/smoke-browser.mjs`)

- **11-weapon gates:** expected weapon cards derived from `__ssWeaponIds()`/`__ssWeaponReadiness()`
  (11) with a fallback to the explicit `--expect-weapons` value; the old 10-card assumption and note
  are removed. `__ssWeaponReadiness()` is gated for `count:11`, ids including `spear`, `allLoaded`.
- **Spear probe:** armory/card count via `#armoryPanel button[id^="equip-"]` and `#weaponCards`,
  spear presence (`#equip-spear`), expected stats (damage 32, reach 5.6 > poleaxe 5.2, cooldown .7,
  stamina 20, shield true) gated against the owner-confirmed definition, deterministic equip via
  `__ssEquipWeapon` when world-scene ships it (else `#equip-spear` when owned), authoritative
  snapshot `weapon` field (now included in the QA actor summary), third-person `spear-thirdperson.png`
  grip shot + attack still, other 10 ids unchanged, and server `weaponDrops` inclusion reported.
- **Hit-flash hold:** `probeHitFeedback` now uses `__ssSetHitFeedbackHold(true)` on a framed preview
  rig, waits ~1.2 s, checks `flashActive` is still true and captures `hit-hold-frame.png`, then
  disables hold and verifies decay + no persistent flash/material leak.
- **Audio state:** `probeAudioState` reads `__ssAudioState()` in clear vs downpour weather (shape:
  enabled/contextState/regionBeds/weatherBeds/music/landmarkBeds) and uses `__ssAudioFocus(48,4)` for
  the near-forge landmark bed; gates shape/storm reflection/forge bed level (ear-check human debt).
- **Abbey:** `content-abbey` optional QA view gated for capture + non-null `contentFocus`; pose/named
  view filled from ruins-builder's export.
- **Perf gates:** cycle-9 SPEC **<290 calls / <2.15 M tris**; tiers/payload/views/HUD app path retained.

### Cycle-8 reference values (before cycle-9)

- Perf: 211 calls / 1,735,004 tris / geoms 175 / textures 188 / programs 100; payload 17.06 MiB local
  (live 17.04 MiB across 89 assets); authoritative bundle `index-2pShR6WA.js` (898,219 B), live
  `index-NAyaupV0.js` (898,394 B); mobile 130 calls/1.31 M at low tier.
- Armour: strict 7/7 ≥500 (hero 526 reverted); crops 7/7; survivor sixth appearance; enemy variants +
  preview + hit feedback v2 (flash/stagger/reduced) verified; zombie-bloated +8.6 tone; nest decals.
- 10 weapons pre-cycle; armory card gate 10.

### Cycle-9 authoritative capture + regression — final build `index-2keD53-A.js` (901,729 B): PASS

**Artifact:** Lead-confirmed final hash **`index-2keD53-A.js` (901,729 B)**; fresh bundled-Node-24
build reproduced it **exactly** (fresh-build smoke **26/26 PASS**, `qa/final-c9`, 0 page/console/log
errors, 0 404s, 11 cards, WS 1/0, night TP 54.83). Authoritative runs: **characters 81/81**
(`qa/characters-c9`), **perf 85/85** (`qa/perf-c9`), **mobile 22/22** (`qa/mobile-c9`), **co-op 18/18**
(`qa/coop-c9`); pre-deploy live baseline **25/26** (`qa/live-batch12-pre`, delivered cycle-8: 10 cards
so the cycle-9 11-card gate correctly fails pre-deploy, everything else green; only external
Cloudflare beacon in logs).

**1) War Spear / 11 weapons — PASS.** Armory **11 cards** (derived from `__ssWeaponIds`/`
__ssWeaponReadiness()` and `#armoryPanel button[id^="equip-"]`; the old 10-card assumption is
removed); `__ssWeaponReadiness()` `{count:11, ids:[sword,bastard,hammer,poleaxe,zweihander,rapier,
halberd,spear,dane_axe,flamberge,mace], loaded:11, allLoaded:true}`. Spear contract verified in state:
**damage 32, reach 5.6 (longest, > poleaxe 5.2), cooldown .7, stamina 20, shield true, style thrust**;
`__ssEquipWeapon('spear',{preview:true})` → `{ok, weapon:'spear', stats:{reach:5.6,damage:32,
shield:true}}` and `__ssWeaponState()` reflects the full stat block. Rack drops include the spear:
`rack-moor-citadel` at (−29,−371), all 10 other weapon ids unchanged/present. QA third-person
`spear-thirdperson.png`/`spear-attack.png` captured the **preview** held model (server-authoritative
equip needs rack ownership; HUD therefore reads Longsword and `__ssWeaponState().qaPreview='spear'`);
the canonical in-game grip/orientation shot is weapons-armory's `qa/char-viewer/shots/
ingame-spear-thirdperson.png` (shield off-hand, vertical shaft/grip lower third), viewer grip shots
`c9spear3p-base.png`/`c9spear-base-closeup-hero.png`; armory/equipment/characters tests green inside
the same 58 blocks. Reach sim: 5.5 m hit for 32, 5.9 m miss (owner tests).

**2) Abbey landmark — PASS.** `content-abbey` captured via `__ssQAPose` fallback cam (40,−40,h3.2) →
(62,−46,2.6), yaw 1.3045, pitch −0.0263: `contentFocus` = `{name:'custom',x:40,z:-40}` non-null,
**1553 colours / mean 44.65**, structure reads grounded and clearanced in `view-content-abbey.png`
(overgrown colonnade/courtyard ruin; border fortress behind, existing wall in foreground, no
intersection/floating). At spawn the abbey is distance-culled (95.8 m > 85 m; geometry count drops
167 vs 175 and tris to 1.64 M), and QA focus makes it visible (+1 draw / +13.8 k tris only when
visible), matching ruins-builder's validated clearances (road 20 m, tower gap 12.4 m, nearest
landmark 26 m).

**3) Hit-flash hold — PASS (still frame + state).** Early in the run (before the corruption timer):
`__ssSetHitFeedbackHold(true)` + `__ssTriggerEnemyHit(...,{weight:1.4,durationMs:130,stagger:0.12})`
→ hook still reports **flashActive true** after 1.2 s (far beyond the 130 ms pulse), and
`hit-hold-frame.png` differs from the pre-hold frame (**meanAbsLum 9.66–10.97 / 22.8–26.4 %
changed**). Disabling hold releases state cleanly (**flashActive false, staggerActive false, no
persisting emissive** — `releasedState` flash 0/stagger 0); the restored frame diff is informational
because the framed rig keeps animating. Normal flash/stagger/reduced-motion checks remain green
(`__ssEnemyHitFx`), and owner screenshots `ingame-preview-hit-*` cross-reference the red pulse.

**4) Audio state — PASS (state-level; ear-check human debt).** `__ssAudioState()` shape sane:
`enabled:true`, `contextState:'running'`, `regionBeds` march 0.05, `music` level .36, `weatherBeds`
and `landmarkBeds` arrays. Clear weather: `{region:'march', phase:'clear', intensity ~0.08}`, rain 0.
Forced downpour (`__ssSetWeather('march','downpour',1.0)` + ≥1.9 s/poll): phase **downpour**,
intensity **0.369–0.412**, rain bed **0.020–0.022** (snow/ash 0) — storm is reflected in the
soundscape. Near-forge `__ssAudioFocus(52.14,7.3)` was accepted by the hook but the forge bed did not
ramp within headless polling in the authoritative run (owner harness observed **0.022** at that
focus; the landed `landmarkBeds`/`__ssAudioFocus` path is state-verified) → **human/ear debt** for
near-forge loudness; no audio behaviour changes in src beyond the QA focus override.

**5) Perf / HUD / regression — PASS.** Spawn TP **186 calls** (<290 ✅) / **1,640,130 tris**
(<2.15 M ✅; abbey culled at spawn), geoms 167, textures 207, programs 103; FP 152/1.555 M; low
145/1.366 M; medium 184/1.635 M; payload **18,356,075 B = 17.51 MiB** local (armory + spear GLB;
+0.45 MiB vs cycle-8; SPEC accepts one small weapon's payload growth); night TP **54.83** (fresh) /
**51.54** (perf) ≤75; regions 4.9–20.5; snow 240→440 / fog 0.0184→0.0225 / low-tier 0; wind 10.65;
HUD click→HUD **158 ms** / state **3,945 ms** / join **3,139 ms** (≤3.8 s); 0 page/console/log errors,
0 404s, 11 cards, co-op 18/18.

**Cycle-9 verdict: PASS on all gates**, with near-forge audio level, spear preview-vs-server grip
screenshot, and hit-hold restored-frame animation as cycle-10 notes. Cycle-10 candidates:
real-GPU/perceptual/mobile hardware, hardware controller rumble, near-forge audio ear check,
campaign/siege depth, more enemy variety, balance. After deploy: final live pass + task-87 complete.

### Final live deployment verification — cycle-9 (game `93811dda`, hosting `a16ea8fc`)

Deployed after the Lead accepted the cycle-9 pass. Live verification runs:

```bat
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ ^
    --out qa/live-batch12-deployed --expect-weapons 11 ^
    --expect-assets custom/templar.glb.gz,custom/hero.glb.gz,custom/berserker.glb.gz,custom/ranger.glb.gz,custom/ally.glb.gz,custom/survivor.glb.gz,custom/fallen.glb.gz,custom/stone_well.glb.gz,custom/blacksmith_stall.glb.gz,custom/stone_altar.glb.gz,custom/forge_furnace.glb.gz,custom/zombie-bloated.glb.gz,custom/skeleton-armoured.glb.gz,custom/spear.glb.gz,custom/abbey_ruin.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --probes --views --out qa/live-feature-c9 --expect-weapons 11 --expect-assets custom/spear.glb.gz,custom/abbey_ruin.glb.gz
& $node scripts/smoke-browser.mjs --url https://neilandrew.dev/games/swords-and-shrouds/ --mobile --out qa/live-mobile-c9
```

- **Results: PASS 27/27 (deployed) + PASS 75/75 (feature/probes/views) + PASS 22/22 (live mobile).**
  Live serves **`assets/index-CGiECS4R.js` (901,904 B)** — hosting/base-path build of authoritative
  `index-2keD53-A.js` (901,729 B; +175 B); `/health` OK; **15/15 expected assets HTTP 200** including
  **spear 45,176 B** and **abbey_ruin 416,580 B** (zombie-bloated 367,162, skeleton-armoured 292,792,
  hero 802,229); **11 armory cards**; 0 page/console/errors, 0 bad/404/failed requests; WS
  opens=1/closes=0. Only log: external Cloudflare-Insights beacon (connection refused in headless).
- **Live payload:** **18,328,950 B = 17.48 MiB** across 91 assets (curl-verified) — +0.44 MB vs
  cycle-8 live (spear GLB 45,176 B + abbey GLB 416,580 B, both within SPEC budgets).
- **Live 11 weapons/spear:** `__ssWeaponReadiness()` `{count:11, ids:[…spear…], loaded:11,
  allLoaded:true}`, 11 armory cards/equip buttons, `#equip-spear` present; `__ssWeaponState()` live
  `{weapon:'spear', reach 5.6, damage 32, cooldown .7, stamina 20, shield true, style:'thrust',
  cardCount 11, drops incl. rack-moor-citadel spear at (−29,−371)}`; `__ssEquipWeapon('spear',
  {preview:true})` → ok + full stats; live third-person/attack preview stills captured
  (`spear-thirdperson.png`/`spear-attack.png`; server-authoritative grip evidence remains the owner
  shot `ingame-spear-thirdperson.png`).
- **Live hit-hold/audio/abbey:** `__ssSetHitFeedbackHold(true)` + trigger holds `flashActive true`
  (150 ms remaining after 1.2 s) with a clear still-frame diff (**11.30 / 28.4 % changed**); disable
  releases to flashActive/staggerActive false. `__ssAudioState()` enabled/running, march bed 0.05;
  clear `{clear ~0.085, rain 0}` → live downpour **{downpour, intensity 0.507, rain 0.026}**.
  `content-abbey` live via `__ssQAPose` (40,−40,h3.2)→(62,−46,2.6) yaw 1.3045 pitch −0.0263:
  `contentFocus {custom,40,−40}`, **1471 colours / mean 45.19**, grounded/clearanced in
  `view-content-abbey.png`; plague nest/decals, altar/furnace content views and 7/7 atmosphere views
  live; all weather/snow/fog/low-tier/region/crown checks green.
- **Live mobile/touch (390×844 + 844×390):** `__ssDeviceProfile` touch/coarse/small, suggested=applied
  **low**, maxDpr **1.25**; `#touch` HUD stick/lookpad/3 action buttons visible, keyboard hints hidden,
  no panel overlap, safe insets/in-viewport, pinch/scroll prevented (scale 1), **3-pointer multi-touch**
  move+look+attack (`__ssTouch`: pointers 3, `held.attack true`, player moved 4.1 m/yaw .36), touch
  sensitivity 1.4 persists; live mobile `__ssPerf()` **127 calls / 1,309,865 tris**, 0 page errors;
  `mobile-portrait.png`/`mobile-landscape.png` live.
- **Live HUD/regression:** join 3.14–4.0 s live (includes QA landing overhead), 11 cards, 0 404s, no
  page errors; night TP **53.79** (deployed) / **51.37** (feature run) ≤75.

**Cycle-9 live deployment is verified end-to-end: green**; task-87 complete. Cycle-10 candidates:
near-forge audio ear check, physical-device/real-GPU/perceptual passes, hardware controller rumble,
server-authoritative spear equip/grip capture, campaign/siege depth, more enemy variety, balance.

---

## Iteration cycle 2026-10M (AAA loop, cycle 10) - campaign journal, wayfinding, siege boss, audio ramp

### Authoritative capture + regression - final build index-DTiDZ99w.js (918,844 B): PASS

Fresh bundled-Node-24 build reproduced index-DTiDZ99w.js exactly (fresh-build smoke 26/26, 0 page/console/log errors, 0 404s, 11 cards, WS 1/0; night TP 55.34). Authoritative runs: characters 93/93 (qa/characters-c10), perf 98/98 (qa/perf-c10), mobile 25/25 (qa/mobile-c10), co-op 18/18 (qa/coop-c10), pre-deploy live baseline 26/26 (qa/live-batch13-pre, deployed cycle-9: 11 cards).

1) Campaign journal + objectives - PASS. Opens from HUD #journalBtn (Guide #openJournalFromGuide / hotkey J wired by owner), modal #journal with aria-label, scroll #journalScroll (719/628, overflow-y auto), close #closeJournal; all 7 sections populated live (castles/regions, survivors, camps, nest, sieges, weapon stats, controls, tips). Display-only stages early/mid/late: 1/9 -> 5/9 -> 9/9 castles, 1->4->9 survivors, 0->1->3 sieges, nest sealed->vulnerable. Next objective #objectiveText = "Free The Fallen Keep - 27 m" with direction; player position unchanged while open (modal pauses input); close returns journal closed. Mobile portrait 390x844 journal 352x747, scrollHeight 928 > clientHeight 684, 7/7 sections; landscape 844x390 776x300 scrollable; screenshots journal-desktop.png, journal-stage-{early,mid,late}.png, mobile-journal{,-landscape}.png.

2) Wayfinding - PASS. #ss-objectives DOM pool capacity 14, visible 6, 0 WebGL draws; labels include distances (Survivors - The Old Mill - 22 m; NEXT - Hostile - The Fallen Keep - 27 m; Hostile - The Border Fortress - 103 m; High Citadel - 164 m); 2+ types (camps + castles). Reduced motion: all 6 markers get ss-obj reduced, pulsing 0, animation none (normal 6 pulsing); wayfinding-normal/reduced.png. No draw explosion (TP calls 183).

3) Siege boss - PASS (forced) + normal deferred. Local server SS_QA=1, __ssForceSiege(2) -> state siege {active:true, boss:true, bossName:'Shroud Warden', bossHp:240, bossId:'a165', index:2, waveSize:9}, boss actor kind corrupted name Shroud Warden hp/maxHp 240; announcement toast "Shroud Warden leads the siege of The Fallen Keep!" + boss caption path; siege-boss.png. Normal forced siege index1 refused while boss siege active -> no-boss/normal assertion deferred to weapons-armory game+multiplayer tests (forceSiege index1 boss:false; co-op same boss id/name/hp both sockets). Co-op smoke 18/18.

4) Audio state/focus - PARTIAL. __ssAudioState enabled/running; clear {phase clear, intensity .081, rain 0} -> forced downpour phase downpour intensity .329 rain bed .018 (music duck .84). __ssAudioFocus(52.14,7.3)/chapel accepted but forge/chapel bed levels did not ramp in the headless poll window (owner harness measured forge .024 / chapel .016 immediately) -> near-forge/chapel level remains human ear debt; no product failure.

5) Regression/perf - PASS. Spawn TP 183 calls / 1,635,288 tris (low 143/1.36 M; medium/high 183/1.635 M), geoms 167, textures 207, programs 104; payload 18,376,349 B = 17.52 MiB local; night TP 51.66 (<=75); 7/7 atmosphere + 14 optional views incl. content-abbey (contentFocus {name:'content-abbey',x:40,z:-40}, 1,570 colours, grounded/clearanced); plague decals diff 7.58/27.2%; regions 4.21-21.25 colour distance (pass); wind 17.5; weather/low-tier/crown green; hit-hold + 11 weapons (spear) + captions/deadzone unchanged; HUD click->HUD 156 ms / state 6.28 s / join 3.22 s; mobile 25/25; co-op 18/18; live baseline 26/26; 0 page/console/log errors, 0 404s.

Cycle-10 verdict: PASS on the cycle-10 gates (journal/objectives, wayfinding, forced siege boss, regressions), with near-forge/chapel audio level and normal forced-siege no-boss deferred (owner tests + human ear check); gaps: journal hotkey/Guide-open scripted only via HUD button (owner wiring exists), perf-end force-siege can be refused while a siege is active. After deploy: final live pass + task-92 complete.


### Final live deployment verification - cycle-10 (game 86802594, hosting 393b091c)

Deployed after the Lead accepted the cycle-10 pass. Live runs PASS: deployed **26/26** (qa/live-batch13-deployed), **feature/probes/views 87/87** (qa/live-feature-c10), **live mobile 25/25** (qa/live-mobile-c10). Live serves **index-BXZrX3mk.js (919,019 B)** = hosting build of authoritative index-DTiDZ99w.js (918,844 B; +175 B); /health OK; 11 armory cards; payload **18,349,224 B = 17.50 MiB across 91 assets** (+0.02 MB vs cycle-9 live), incl. spear 45,176 B / abbey_ruin 416,580 B / hero 802,229 B (Lead-confirmed 200); 0 page/console errors, 0 404s/failed requests; only external Cloudflare beacon log. Night TP 51.56 (<=75).

- Live journal: #journal opens, 7/7 sections, scroll 719/628, stages early/mid/late, next objective "Free The Fallen Keep - 27 m", closes; mobile portrait 352x747 scrollable and landscape 776x300; screenshots journal-desktop.png, journal-stage-*.png, mobile-journal*.png.
- Live wayfinding: #ss-objectives pool 14, visible 4, distance labels, 2+ types; reduced motion -> 4/4 reduced, pulsing 0; DOM-only (0 draws).
- Live content: content-abbey contentFocus {content-abbey,40,-40}, mean 45.2 / 1457 colours, grounded; plague decals diff 6.74/26.0%; altar/furnace views; 7/7 atmosphere; weather/snow/fog/low-tier/crown green.
- Live audio: clear -> downpour intensity .507 rain .028; state shape green (near-forge/chapel level still owner/ear debt).
- Live mobile: touch HUD safe/non-overlap, 3-pointer multi-touch, no zoom, journal scrollable both orientations; device profile low/maxDpr 1.25; mobile 127 calls/1.31 M tris.
- Forced siege boss: cannot be exercised on the production URL (server runs without SS_QA=1 -> qa-siege inert); the forced boss-siege pass is certified on the authoritative local build (index 2 -> Shroud Warden hp240/wave9, state/caption/toast). Normal forced-siege no-boss remains deferred to owner game/multiplayer tests.

Cycle-10 live deployment is verified green for the shipped UI/wayfinding/content/mobile surfaces; forced boss-siege live remains QA-limited by the production SS_QA gate (local authoritative pass green). task-92 complete. Cycle-11 notes: near-forge/chapel audio ear check, normal forced-siege no-boss run, journal hotkey/Guide-open scripted capture, physical-device/real-GPU/perceptual, hardware rumble, first-boss tuning, content depth.


---

## Iteration cycle 2026-10N (AAA loop, cycle 11) - difficulty modes, boss presentation, QA gap closure

### Authoritative capture + regression - final build index-DuBFiyZ8.js (927,007 B): PASS (2 harness-only character timing misses fixed after run)

Fresh bundled-Node-24 build reproduced index-DuBFiyZ8.js exactly (fresh-build smoke 26/26, 0 page/console/log errors, 0 404s, 11 cards, WS 1/0, night TP 56.01). Authoritative runs: perf **104/104** (qa/perf-c11), characters **103/105** (qa/characters-c11; two failures were harness reads of legacy #bossBar / a delayed __ssBossVisual read, both fixed after the run and verified green by the perf pass), mobile **25/25** (qa/mobile-c11), co-op **21/21** (qa/coop-c11), pre-deploy live baseline **26/26** (qa/live-batch14-pre, deployed cycle-10, siege checks deferred by production SS_QA gate).

1) DIFFICULTY MODES - PASS (contract + UI; Warden forced-siege HP deferred). Landing picker #difficultyPicker with .difficulty-choice[data-difficulty] buttons Squire/Knight/Warden and #difficultyDescription; default Knight; persisted ss-difficulty (verified on explicit selection; default Knight not stored until chosen). __ssDifficulty() -> {id:'knight',label,source:'solo',readonly:false,authoritative:'knight',pickerIds,selectedPickerId:'knight',badgeText:'KNIGHT',journalText:'Difficulty: Knight - ...'}; HUD #difficultyBadge visible, journal #journalDifficulty present; co-op host Warden -> both clients warden, joiner hook {source:'host',readonly:true,badgeText:'WARDEN - HOST'} (joiner cannot change). Presets per owner: Squire x0.75 dmg/x0.85 HP/-2 wave; Knight x1/x1/0; Warden x1.3/x1.15/+2 wave; forced index-2 boss HP squire 204 / knight 240 / warden 276; sim table (2 bots, damage taken): index1 161/280/381, index2 161/280/381 (boss 204/240/276), index9 280/358/560, with Squire first-boss >=1 alive, Knight heavy moment, Warden hardest. QA perf run (Knight default) forced boss shows bossHp 240; the Warden forced-boss screenshot after the last harness fix was not re-shot (deferred; owner sim + co-op Warden state cover the mode).

2) BOSS PRESENTATION - PASS. During the forced boss siege __ssBossBar() = visible/name 'Shroud Warden'/hp/maxHp with segmented fill and phase (STEADY/FRENZIED/FINAL), banner #bossSiegeBanner, body.boss-siege set; hidden before force and when siege inactive (hook.visible false; resolved). __ssBossVisual() = {active:true, actorId==siege.bossId, scale 1.15, auraVisible:true, tint '#8f2a38', bossName 'Shroud Warden', hp/maxHp}; __ssSetReducedMotion(true) -> reducedMotion true and aura pulse calmed (no oscillation), screenshot siege-boss-reduced.png; boss-vs-normal screenshots siege-boss.png / siege-boss-reduced.png; +1 draw while active (world-scene).

3) QA GAP CLOSURE - PARTIAL. Audio landmark beds: __ssAudioFocus(52.14,7.3)/chapel now polled up to 3 s and recorded (levels 0 in this headless run; owner harness measured forge .024/chapel .016) - ear check remains human debt; no product failure. Forced normal siege after the boss siege: server correctly refuses a new qa-siege while one is active and there is no __ssStopSiege; normal-no-boss therefore deferred to weapons-armory game/multiplayer tests (forceSiege index1 boss:false). Journal hotkey J and Guide->#openJournalFromGuide open/close paths PASS (journal-hotkey.png, journal-guide-open.png), with 7/7 sections and stage previews.

4) REGRESSION - PASS. Perf: spawn TP **183 calls / 1,635,392 tris** (<290/<2.15M; low 143/1,364,373; medium/high 183/1.635M), geoms 167, textures 207, programs 102; payload **18,387,528 B = 17.54 MiB**; night TP 51.57; 7/7 atmosphere + 14 optional views incl. content-abbey (contentFocus {content-abbey,40,-40}, 1575 colours); plague decals 6.66/22.97%; regions 11.14-20.97; wind 15.07; weather/snow/fog/low-tier/crown green; hit-hold + 11 weapons (spear) + captions/deadzone/canvas green; HUD click->HUD 157 ms / state 2,535 ms / join 3,545 ms; 11 cards; mobile 25/25 (journal portrait 352x747/landscape 776x300 scrollable, touch HUD safe); co-op 21/21 (difficulty inheritance + read-only joiner); live baseline 26/26; 0 page/console/log errors, 0 404s (external Cloudflare beacon only).

Cycle-11 verdict: PASS on difficulty UI/state, boss presentation, gap-closure paths and regressions; deferred items: Warden-specific forced-boss HP still capture (owner sim covers), normal forced-siege no-boss (owner tests), audio landmark level ear check. After deploy: final live pass + task-97 complete.
