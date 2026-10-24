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
