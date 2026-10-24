# Iteration cycle 2026-10K — Results (AAA loop, cycle 8)

Eighth cycle of the standing AAA loop. Cycle 7 (`docs/BATCH-2026-10J-RESULTS.md`) added enemy
variants, cleared the palette debt and shipped accessibility captions at 213 calls / 1.736 M tris.
Cycle 8 turns the browser build into a **mobile-ready** experience, adds device-aware quality,
enemy preview/hit feedback, and the last visual tone polish. Final bundle `index-2pShR6WA.js`
(898,219 B), deterministic across two builds.

## 1. Mobile / touch experience

- **Responsive touch HUD** driven by `body.touch-device` / `body.small-screen` (safe-area insets,
  `env(safe-area-inset-*)`): portrait 390×844 and landscape 844×390 layouts with no overlapping
  panels, thumb-reachable stick/lookpad/action buttons, keyboard hints hidden on touch (controller
  hints preserved), scrollable finger-sized Guide/Settings dialog.
- **Touch input robustness:** radial deadzone + analog stick magnitude via pure
  `touchStickVector()`, shared deadzone preset, persisted touch look sensitivity (0.4–2.0),
  per-control pointer capture for simultaneous move+look+attack, touch-action/overscroll hardening
  and gesture/double-tap suppression; desktop pointer-lock path untouched.
- **Device-aware quality** (`__ssDeviceProfile()`): touch/coarse/small-screen/low-memory detection
  with auto tier (low on small/low-mem, medium on tablets, high on desktop; SwiftShader → low),
  DPR clamps (1.25 low-touch / 1.5 medium-high touch / 2 desktop); an explicit saved `ss-quality`
  choice is never overridden.
- QA mobile emulation **22/22**: portrait + landscape HUD, zero panel overlaps, safe insets,
  no scroll/zoom (pinch scale stays 1), 3-pointer multi-touch (stick+look+attack, player moved
  4.1 m and yaw changed), sensitivity persisted, profile `{touch,coarse,smallScreen,suggested low,
  applied low,maxDpr 1.25}`, mobile perf **130 calls / 1.31 M tris**, desktop unchanged.

## 2. Enemy QA framing + combat hit feedback v2

- **`__ssPreviewEnemy(appearance, distance?)`** builds any of the four undead appearances
  (zombie, skeleton-soldier, zombie-bloated, skeleton-armoured) in an open spot in front of the
  camera, returns `{ok,appearance,distance,ready,actorId}`, registers with the rig registry so
  `__ssTriggerEnemyHit(actorId)` works, and `null` restores. QA captured all four cleanly at
  2.8 m and 10 m (base-vs-variant distinct), fixing cycle-7's obstructed captures.
- **Hit feedback v2 (client-only):** every damaging hit now flashes the struck rig's materials
  (80–140 ms emissive pulse scaled by the weapon profile, originals stashed/restored, no pooled
  leaks), applies a pivot-only stagger (grounding/animation intact), and fires a weapon-tinted
  impact spark at the contact point; works on all four undead appearances; reduced motion
  suppresses flash/stagger. QA verified flash 111–130 ms / stagger 160–183 ms and suppression;
  framed visuals `ingame-preview-hit-*.png`, `c8hit-*` (slow SwiftShader frames can miss the pulse,
  so canonical stills come from the QA trigger).

## 3. Visual tone + content polish

- **Zombie-bloated night tone:** body mean 131 → **106.9** (base zombie 82.5) via a staged albedo
  level reduction + roughness/`baseColorFactor`; accepted as intentional plague-pale (+24 vs base,
  QA core-delta +8.6 in-game). Cycle-9 note: further reduction should bias lighting, not albedo.
- **Hero palette:** headroom attempt regressed the strict mask (492 vs 526), so hero was reverted
  byte-for-byte — strict-mask gate stays **7/7 ≥500** (561/526/721/651/694/1082/937). Cycle-9 note:
  use a body-atlas pass, not more plate texture.
- **Plague-nest ground decals:** 44 feather-mask corruption decals around the nest (single
  instanced draw when visible, pulsing, distance-culled at 160 m) so the ritual area blends into the
  terrain; nest enrichment (second cart, extra barrel cluster, extra grave) — 29 props + 6 flames,
  0 new layers/draws, ≈100 k tris only when visible.

## 4. Verification (final artifact `index-2pShR6WA.js`, 898,219 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| `validate-assets` | **80/80** |
| Fresh-build smoke | **26/26** + exact hash reproduction, 0 errors/404s, 10 cards, WS 1/0 |
| Characters/elite | characters **67/67**; strict palette 7/7; elite intact |
| Mobile/touch | **22/22** (portrait + landscape, multi-touch, device profile, no overlaps) |
| Enemy preview + hit feedback | all 4 variants framed at 2 distances; flash/stagger/reduced-motion verified |
| Perf | **211 calls / 1,735,004 tris** (<290 / <2.15 M); FP 165/1.62 M; low 162/1.42 M |
| Payload / HUD | **17.06 MiB**; click→HUD 3.27 s, state 6.29 s, join 3.61 s |
| Regression | co-op **18/18**, live baseline **26/26**, 0 page/console errors, 0 404s |
| Night mood | TP canvas mean 51.2 (cycle-8 smoke 65.3); ≤75 |

## 5. Carried into cycle 9

1. **Physical-device mobile, real-GPU and perceptual playtests** (headless emulation is not a phone
   or a GPU); hardware controller rumble test.
2. Hit-flash frame-sync capture (a dedicated freeze-frame/hook for QA's visual proof).
3. Surface-audio ear check; zombie-bloated optional lighting-bias tone pass; hero body-atlas
   headroom.
4. Content/campaign depth: campaign/siege objectives polish, balance, more enemy types/props from
   the warehouse; mobile real-device QA.
