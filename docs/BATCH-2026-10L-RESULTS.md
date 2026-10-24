# Iteration cycle 2026-10L — Results (AAA loop, cycle 9)

Ninth cycle of the standing AAA loop. Cycle 8 (`docs/BATCH-2026-10K-RESULTS.md`) made the build
mobile-ready and added device-aware quality + hit feedback at 211 calls / 1.735 M tris. Cycle 9 adds
an **11th weapon**, a **new abbey landmark**, QA verification hooks and audio diagnostics. Final
bundle `index-2keD53-A.js` (901,729 B), deterministic across two builds.

## 1. New weapon — War Spear (11th weapon)

- New `spear` asset: **504 tris / 1 prim / 44.1 KB gzip**, 512² night-toned albedo, canonical
  polearm orientation (grip at origin, shaft along +Y, blade tip +1.760 / butt −0.440, total length
  2.200 exactly).
- `WEAPONS.spear`: War spear — damage 32, **reach 5.6 (longest)**, cooldown 0.7, stamina 20,
  arc 0.16, length 2.2, shield allowed, style "Long thrust · shield guard"; grip profile
  `{grip:[0,0,0],blade:[0,1,0]}`, thrust swing style.
- **Drops (Lead-approved generic `rackPool`):** 9 castle racks now cover every non-starter weapon
  exactly once — keep=bastard, border=poleaxe, citadel=zweihander, moor-keep=rapier,
  moor-border=halberd, **moor-citadel=spear (−29,−371)**, crown-keep=dane axe, crown-border=flamberge,
  crown-citadel=mace; starter hammer drop unchanged. All 11 weapons obtainable.
- Tests extended inside existing blocks (exactly 58): 11 weapons, spear stats/reach/shield, rackPool
  coverage, spear reach simulation (5.5 m hit for 32 / 5.9 m miss), grip/fit assertions. QA verified
  11 armory cards, spear stats in-game, drops mapping and third-person spear+shield grip.

## 2. New landmark — ruined abbey

- `abbey_ruin` asset from the warehouse `overgrown-courtyard-patio-ruin` scan: **13,786 tris / 1 prim
  / 406.8 KB**, 1,024² night-toned texture, ground-centred, bbox 7.411 × 5.000 × 7.390 m (sister
  footprint to the chapel ruin), overgrown colonnade/courtyard read.
- Placed as the **second Green March landmark** at **(62, −46)**, yaw 0.6, height 6.5 m, between the
  village landmark and the border fortress (40.2 m from the village landmark, 34.5 m from the fortress
  towers, 20 m off-road); one distance-culled instanced layer (+1 draw / 13.8 k tris only when
  visible), receive-only shadows, validated clearances, spawn culled (95.8 m).
- QA captured it via `__ssQAPose` with the QA-focus culling path (player at spawn): grounded, no
  intersections, distinct silhouette.

## 3. Verification hooks + audio diagnostics

- **Hit-flash hold:** `__ssSetHitFeedbackHold(true|false|null)` re-arms the per-hit enemy flash/stagger
  while held so slow SwiftShader stills always catch it; disable restores normal 80–140 ms decay with
  no emissive leak. QA: flash stayed active after 1.2 s under hold, frame diff 9.66–10.97 / 22.8–26.4 %,
  disable → all false.
- **Weapon QA hooks:** `__ssWeaponReadiness()` (count 11, all loaded), `__ssWeaponState()` (stats,
  armory 11, drops incl. spear), `__ssEquipWeapon(id,{preview:true})` deterministic grip preview.
- **Audio state:** `__ssAudioState()` returns enabled/paused/context, weather region/phase/intensity,
  regional bed levels, music/duck, weather bed levels, chapel/forge landmark levels, captions/master;
  `__ssAudioFocus(x,z)` lets QA drive landmark beds without walking. QA verified march bed 0.05,
  clear→downpour intensity 0.369–0.412 / rain bed 0.020–0.022; near-forge ramp remains a human
  ear/debt item.
- Spear swing mapped to the `thrust` profile and audible through the existing combat cue path.

## 4. Verification (final artifact `index-2keD53-A.js`, 901,729 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| `validate-assets` | **82/82** |
| Fresh-build smoke | **26/26** + exact hash reproduction, 0 errors/404s |
| Characters/elite | **81/81** |
| Perf | **85/85** — spawn TP **186 calls / 1,640,130 tris** (abbey culled), FP 152/1.555 M, low 145/1.366 M |
| Mobile | **22/22** |
| Weapons | 11 cards, spear stats/reach/grip/drops verified, other 10 unchanged |
| Abbey / hit-hold / audio | all verified (near-forge audio level = human debt) |
| Payload / HUD | **17.51 MiB**; click→HUD 158 ms, state 3.945 s, join 3.139 s |
| Regression | co-op **18/18**, 0 page/console errors, 0 404s, 11 cards |

## 5. Carried into cycle 10

1. Near-forge audio-level ear check; physical-device mobile / real-GPU / perceptual playtests;
   hardware controller rumble test.
2. Server-authoritative spear equip screenshot (QA capture used the preview path; equip needs rack
   ownership) — a QA/session capture task, not a defect.
3. Content/campaign depth: siege/campaign objectives polish, balance pass, more enemy types/props.
4. Optional: named `content-abbey` QA view in scene.ts (pose already exists in ruins.ts).
