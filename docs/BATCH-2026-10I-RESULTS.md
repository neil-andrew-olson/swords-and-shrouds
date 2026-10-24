# Iteration cycle 2026-10I — Results (AAA loop, cycle 6)

Sixth cycle of the standing AAA loop. Cycle 5 (`docs/BATCH-2026-10H-RESULTS.md`) ended at
208 calls / 1.727 M triangles with armour art v3, dense snowstorms, combat feel, altar/forge content
and surface audio. Cycle 6 clears remaining QA debts, adds a **sixth playable appearance**, polishes
**controller support** and improves landmark readability. Final bundle `index-BY6s-QI9.js`
(883,369 B), deterministic across two clean builds.

## 1. Sixth playable appearance — "Wandering Survivor"

`survivor` added to `PLAYER_CHARACTERS`, so both selectors (landing + in-game armory) now offer 6
appearances: Crusader Knight, Vanguard Champion, Iron Berserker, Scout Ranger, Oathsworn Defender and
**Wandering Survivor**. The existing survivor rig already had the full Mixamo clip set and hand
sockets; QA verified selection → authoritative `appearance:'survivor'` → third-person render with a
Longsword attached and feet grounded, no console errors, and the other five unchanged.
**Staff integration fix:** the baked walking staff was rigid-weighted to the right hand (would swing
with a held sword); asset-forge re-weighted it to Spine2/Hips and authored it stowed diagonally
across the back — zero hand-rigid vertices, hands free for weapons, camp NPC still reads as carrying
a staff. Equipment tests assert the new contract.

## 2. Controller polish (Gamepad API existed; now production-grade)

- **Rumble** via `Gamepad.vibrationActuator.playEffect('dual-rumble')` on player hurt (scaled by the
  weapon profile weight), block impacts and castle capture; no rumble under `prefers-reduced-motion`,
  menu/pause/hidden, and actuator reset on blur/menu/disconnect; silent no-op without an actuator.
- **Hints/UI:** `#padHints` glyph bar appears only for standard-mapping pads (RT Attack, LT Block,
  B Sweep, X Heal, A Interact, Y View) with connect/disconnect toasts; keyboard hints unchanged.
- QA hooks `__ssPad()` and `__ssCharacterSelect()`; QA's synthetic standard pad test confirms hints,
  toast, body class, guarded rumble path (no actuator → 0 errors), reduced-motion guard and disconnect
  behaviour. Physical rumble remains a hardware debt.

## 3. Remaining QA debts fixed

- **Reduced-motion vignette residual** (cycle-5: 0.546): combat camera now hard-clears under reduced
  motion every frame (`hitStop=0`, kick/roll/FOV-punch 0, vignette 0, FOV 68) and
  `__ssSetReducedMotion(true)` clears immediately mid-effect. QA: two heavy-hit samples → vignette
  exactly 0, hit-stop 0, kick 0–0.002; normal-motion peaks unchanged (hit-stop 10–60 ms, vignette
  0.749, kick 0.056–0.075).
- **Low-tier cloth-wind isolation:** `__ssCharacterFx()` → `{quality, clothWind}`; low = false,
  high/medium = true, toggling with no shader errors.
- **`landmark-crown`** camera moved fully inside the Frozen Crown — `__ssRegionInfo()` reports crown
  for the view (was a border blend).
- **Deterministic clear weather for QA:** `__ssClearWeather()` forces the region's clear phase,
  zeroes all weather pools/fog contribution and returns the state; `__ssPerf()` reports
  `weather:{region,phase,intensity}`.
- **Altar night readability:** 3 candle flame glows appended to the existing `dressing:flames`
  instanced layer (0 new draws, 0 new lights, +3×12 tris) plus a subtle warm emissive lift on the
  altar; verified with an isolated capture (`view-content-altar-close2.png`). Caveat: the QA
  `content-altar` poses only move the camera while the altar layer is player-distance-culled at
  85 m (~270 m from spawn), so cycle-7 needs a teleport/spawn hook or QA-following culling for this
  content capture.

## 4. Masked palette debt (art, documented)

- QA crop gate: **7/7 bodies ≥500** (605–955).
- Strict silhouette mask (weapons-armory pose-pinned): **4/7 ≥500** — templar 559, ally 707,
  berserker 725, survivor 1077; hero 454, fallen 460, ranger 379 remain under the 500 target despite
  the hue-chip pass (hero +52, fallen +36, ranger +3). Recorded as cycle-7 art debt with fix
  directions in `ASSET-PIPELINE.md`: ranger — lighten the re-dyed cloak base rather than more chips;
  hero/fallen — stronger luminance-separated chips/trim on large plate faces.

## 5. Verification (final artifact `index-BY6s-QI9.js`, 883,369 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| `validate-assets` | **78/78** |
| Fresh-build smoke | **26/26** + exact hash reproduction, 0 errors/404s, 10 cards, WS 1/0 |
| Characters | crop palette 7/7 ≥500; torso 82.35/72.32, clip 0; elite 30.82/88.4 %; survivor identity diff 31.9/55.2 % |
| Sixth appearance | 6 selectors incl. Wandering Survivor; player render + weapon + staff-on-back, 0 errors |
| Controller | synthetic pad → hints/toast/class, guarded rumble, reduced-motion + disconnect paths |
| Reduced motion | vignette 0, hit-stop 0, kick ≤0.002 (two samples); normal path intact |
| Weather/regions | snow 132→440, fog 0.018→0.024, low-tier snow 0; crown and landmark-crown report crown |
| Perf | **206 calls / 1,726,578 tris** (<280 / <2.05 M); FP 160/1.61 M; low 161/1.41 M |
| Payload / HUD | **16.31 MiB**; click→HUD 4.5 s, state 6.6 s, join 3.77 s |
| Regression | co-op **18/18**, live baseline **21/21**, QA views incl. content/weather |

## 6. Carried into cycle 7

1. **Strict-mask palette** hero/fallen/ranger (fix directions recorded) — target ≥5/7.
2. **Altar content capture** needs a teleport/spawn hook or QA-camera-following dressing culling.
3. **Physical controller rumble + real hardware gamepad test** (headless cannot vibrate).
4. Surface-audio ear check; real-GPU/perceptual playtests; mobile support.
5. Content depth: more enemy variety (warehouse models), campaign/siege objectives polish, balance.
