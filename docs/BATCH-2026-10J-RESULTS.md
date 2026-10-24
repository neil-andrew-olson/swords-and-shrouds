# Iteration cycle 2026-10J — Results (AAA loop, cycle 7)

Seventh cycle of the standing AAA loop. Cycle 6 (`docs/BATCH-2026-10I-RESULTS.md`) shipped the
Wandering Survivor, controller rumble/hints and QA-debt fixes at 206 calls / 1.727 M triangles.
Cycle 7 adds **enemy variety**, clears the **strict-mask armour palette** debt, fixes **content QA
captures**, and adds **accessibility captions + controller settings**. Final bundle
`index-BF93HyxO.js` (889,821 B), deterministic across two clean builds.

## 1. Enemy variety — two new undead variants

New assets that reuse the existing enemy rigs and clip sets (base enemies byte-identical):
- **`zombie-bloated`** — zombie 30-joint rig, 10 clips, 2 prims (10,000 body + 620-tri rigid
  add-on): swollen belly/chest masses, back hump, shoulder/arm/neck tumours, hanging folds;
  plague-pale palette. 10,620 tris / 361.0 KB.
- **`skeleton-armoured`** — skeleton-soldier 51-joint rig, 9 clips, 2 prims (6,821 + 268-tri rigid
  helm/pauldrons/kite-shield): iron bucket helm with crest and forearm shield. 7,089 tris / 285.9 KB.
- Client mapping: `undeadVariant(a)` = `UNDEAD_ASSETS[idNumeric % 4]` → zombie / skeleton-soldier /
  zombie-bloated / skeleton-armoured, so each region mixes ~50 % base rigs and ~25 % of each variant
  deterministically; players/soldiers/corrupted mappings unchanged.
- Defensive fallback: `characterAssetFallback` maps bloated→zombie / armoured→skeleton-soldier, and
  `create()` uses the base when a variant is unavailable (background preload, not join-critical).
- QA: `__ssEnemyVariants()` availability true; in-world variant actors captured; silhouettes differ
  from bases (bloated 31.9/70.5 %, armoured 64.0/96.8 %), animations/grounding verified; contracts
  match tests. Note: zombie-bloated is intentionally plague-pale and reads brighter than the base at
  night (close-up mean ~126 vs 83) — cycle-8 art tone note.

## 2. Strict-mask armour palette — debt cleared

Pose-pinned strict silhouette-mask colours went from **4/7 to 7/7 ≥500** (SPEC target ≥5/7):

| body | cycle 6 | cycle 7 |
| --- | --- | --- |
| templar | 559 | 561 |
| hero | 454 | **526** |
| berserker | 725 | 721 |
| ranger | 379 | **651** |
| ally | 707 | 694 |
| survivor | 1,077 | 1,082 |
| fallen | 460 | **937** |

Fixes: ranger's re-dyed cloak base lightened so hue chips survive 5-bit quantisation; hero brighter
luminance-separated chips/trim on large plate faces; fallen bigger/brighter patina-rust chips;
hero polished further to tip 491→526. Crop metric also 7/7 (638–1033). Files ≤900 KB,
tris ≤15,500, single skin/clips/sockets unchanged.

## 3. Content capture hook — altar/furnaces/plague now capturable

In `draw()`, while `__ssQAView` is active, `ruinsUpdate` receives a debug-only synthetic actor at the
QA camera position (normal play still uses the player at 85 m). This lets content views render
player-distance-culled dressing: named `content-altar`, `content-furnace-village`,
`content-furnace-camp` views now show the props while the player is at spawn, and a `content-plague`
pose (cam (−8,−680,h3.2)→(0,−666,1.2)) captures the new plague-nest ritual dressing.
`__ssPerf().contentFocus` reports the focus name/position for QA.

## 4. Plague-nest ritual dressing

Existing shipped assets only, no new files/layers/draws: 3 broken wall fragments, 2 braziers + flame
cones, 4 candle glows, 8 graves, 6 stake markers, 2 barrel clusters, corpse cart (26 props + 6
flames) arranged around the nest (0,−664) with validated road/nest/footprint clearances; 0 new
lights, receive-only shadows, 85 m culling, allocation-free. Cost ≈86 k tris only when the nest is
visible (691 m from spawn, beyond the far plane) so spawn perf is unchanged.

## 5. Accessibility captions + controller settings

- **Captions (CC):** off-by-default persisted toggle with a subtle HUD line for thunder/lightning,
  nearby undead, siege start/end, low health and castle captured; 96-char cap, 2.2 s rate limit with
  priority interrupts, suppressed in menus/pause, Sound-independent by design (accessibility).
  QA hooks `__ssCaptions()`, `__ssCaptionDemo(cue)`.
- **Controller settings:** deadzone presets (tight 0.10 / normal 0.18 / wide 0.28) and a dedicated
  controller look-sensitivity slider (0.4–2.0), both persisted and applied through `readPad`; the
  default readPad path is byte-identical to before (mapping stays deterministic). HUD hints, rumble
  and reduced-motion guards unchanged.
- Tests extended inside existing blocks (58 preserved).

## 6. Verification (final artifact `index-BF93HyxO.js`, 889,821 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| `validate-assets` | **80/80** |
| Fresh-build smoke | **38/38** + exact hash reproduction, 0 errors/404s, 10 cards, WS 1/0 |
| Enemy variants | availability + mapping + silhouettes + animations verified; fallback unit-tested |
| Palette | strict **7/7 ≥500** (561/526/721/651/694/1082/937), crop 7/7 |
| Characters/elite | characters **58/58**; torso 84.48/76.68/black 5.03; elite 31.36/87.89 % |
| Content captures | altar/furnaces/wells/plague dressing render in QA views; culling unchanged in play |
| Accessibility | captions texts/gating/persistence; deadzone/sensitivity persistence; guards intact |
| Perf | **213 calls / 1,735,988 tris** (<290 / <2.15 M); FP 165/1.62 M; low 164/1.42 M |
| Payload / HUD | **17.02 MiB**; click→HUD 157 ms, state 1.28 s, join 3.35 s |
| Regression | co-op **18/18**, live baseline **26/26**, 0 page/console errors, 0 404s |

## 7. Carried into cycle 8

1. **Zombie-bloated night tone** (brightness vs base at 2.8 m; lever = additive belly albedo level).
2. **Enemy QA framing/spawn hook** (in-world variant close-ups were partly obstructed by camp props).
3. Hero strict-mask headroom (526) if further headroom wanted; palette otherwise done.
4. Physical controller rumble / real-hardware gamepad test; surface-audio ear check.
5. Real-GPU/perceptual playtests and mobile support; content depth (campaign/siege objectives,
   balance, more enemy types).
