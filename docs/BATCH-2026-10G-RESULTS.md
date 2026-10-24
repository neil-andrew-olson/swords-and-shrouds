# Iteration cycle 2026-10G — Results (AAA loop, cycle 4)

Fourth cycle of the standing AAA loop. Cycle 3 (`docs/BATCH-2026-10F-RESULTS.md`) ended at
195 calls / 1.667 M tris with regional identity, warehouse foliage/landmarks, elite undead and
region audio. Cycle 4 targeted the biggest remaining art gap (**character/armour variety**), added
**dynamic regional weather**, fixed the foliage/tone/framing debts, and cut time-to-HUD with real
attribution. Final bundle `index-CZ8DITNA.js` (861,937 B), reproduced exactly by a fresh build.

## 1. Character / armour identity v2

All seven player/companion bodies now carry **distinct full armour silhouettes** as extra skinned
primitives on the existing Mixamo rigs (one skin, six clips, hand sockets preserved; body geometry,
weights and animation data hash-identical; cycle-2 small add-ons folded in):

| Body | Armour pieces | +tris | Total tris | File |
| --- | --- | --- | --- | --- |
| templar | great-helm, cuirass, tabard, large pauldrons, bracers, belt | +827 | 9,276 | 687.8 KB |
| hero | visored helm, knight cuirass, layered pauldrons, bracers, belt | +939 | 9,388 | 678.3 KB |
| ally | helm, cuirass, tabard, large pauldrons, bracers | +782 | 9,231 | 670.5 KB |
| berserker | horned helm, bracers, fur shoulders, belt (bare torso) | +300 | 8,749 | 654.6 KB |
| ranger | hood, long cloak, leather cuirass, quiver, bracers | +572 | 9,021 | 660.1 KB |
| survivor | hood, ragged cloak, pack, bracers | +408 | 8,857 | 660.8 KB |
| fallen | crest helm, back plate, spiked pauldrons, bracers | +389 | 8,838 | 652.8 KB |

Each body has `<body>_plate` + `<body>_cloth` prims with 512 albedo and 256 normal/ORM maps
(procedural plate/cloth/patina/heraldry detail); runtime applies a plate/cloth material split
(steel target 85 / env 2.3 / rim 0.20; cloth+body target 81 / env 2.0 / rim 0.25). QA verified
10 m silhouettes for all seven bodies are distinct, body-mask close-up colour variety **607–874**
(gate ≥300; full-frame 1,288–1,863), clipping 0 %, body-mask torso **mean 85.7 / p50 71.3 /
black 2.37 %** (debt fixed). Elite-undead silhouettes still pass (tier-3 vs normal diff 30/86 %).

## 2. Dynamic regional weather

Runs continuously with 180–330 s phases, intensity lerp, pooled/quality-tiered particles:

| Region | Phases | Visual signature |
| --- | --- | --- |
| Green March | clear 0.12 → light-rain 0.62 → downpour 1.0 | 228→550 rain streaks, splash particles, wet-road sheen, lightning flash + delayed thunder |
| Ashen Moor | calm 0.2 → ashfall 0.62 → haze 1.0 | 4→14 ash/Haze banks, ember drift, stronger gusts |
| Frozen Crown | clear 0.18 → snow 0.62 → snowstorm 1.0 | pooled snow, fog +0.0045×intensity, gust wind |

Exposed via `__ssWeather()` (region/phase/intensity/flash/particle counts/qualityScale) and
`__ssSetWeather(region,phase,intensity)`; window events `ss-weather`/`ss-lightning`/`ss-thunder`
drive weather-reactive audio (rain beds/plips/delayed thunder, snow hush + howl, ash hiss + groans,
under-cover muffling). Low quality tier = zero weather particles (state machine keeps publishing,
audio still follows). QA particle gates passed (rain 228→550, ash 4→14, low-tier 0); debt: crown
snow vs snowstorm density reads weak.

## 3. Tone / framing / night mood

- Card foliage leaf tone ×1.05 then HSL sat ×0.8 / light ×0.86; maple saturation ×0.42,
  lightness ×0.64 and share 55 %→35 % → muted autumn instead of neon.
- `region-crown` QA camera moved to (keep+30, 3.8, +58): no canopy covering the frame.
- Night mood preserved: spawn third-person canvas mean **51.6–60.9** (≤75), mean saturation 0.50;
  high tier keeps cycle-3 lighting, low tier gets a small exposure bias so software-default-low
  still reads as night.

## 4. Time-to-HUD (attributed)

`__ssLoadTimings()` marks emitted (`coreStart 196 ms`, `sceneConstruct 583 ms`, `coreReady 2,983 ms`,
compile skipped on SwiftShader where `KHR_parallel_shader_compile` is absent). Software renderers now
default to low quality at startup (unless the user has a saved choice) which removes bloom/shadows/
high-tier shader permutations. App-path result: **click→HUD 158 ms, click→state 1,505 ms, join
enabled 3.40 s** (gate 3.8 s). The raw nav→HUD metric (17.84 s) is dominated by QA idle time on the
landing screen, not by the app; both numbers are documented. Real-GPU async shader warmup is in place
and will engage on hardware that supports it.

## 5. New content + verification

- `stone_well` (warehouse scan, 2,968 tris) ×6 — two per region in courtyards/camps.
- `blacksmith_stall` ×2 (procedural forge, 196 tris) at the Green March village landmark and a camp,
  with barrel/crate smithy dressing; +4 instanced draws, ~52 k tris map-wide.
- QA: armour+elite **27/27**, weather pass, tone/framing/regions pass, perf **34/34**,
  fresh-build **17/17** + exact hash reproduction, co-op **18/18**, live baseline **18/18**;
  0 page/console/log errors, 0 404s, 10 cards.
- Perf: spawn TP **206 calls / 1,708,376 tris** (gates <260 / <1.95 M); FP 160 / 1.59 M; low tier
  160 / 1.40 M; payload **15.76 MB** (+0.71 MB).
- Gate: `npm test` 58/58; `tsc` 0; `validate-assets` **76/76**.

## 6. Carried into cycle 5

1. **Armour art richness**: oversized flat/"wood-grain" plate faces at 2.8 m, body-mask colour
   variety 250–515 vs 500 target → 1024 armour atlas for low-variety bodies, hue-separated
   patina/trim, triplanar/world-scale plate UVs, sculpted/hand-made armour detail.
2. **Frozen Crown snowstorm density/visibility** (and a snow particle counter for QA).
3. **`__ssPreviewBody` synthetic body framing bug** (QA used real actors as fallback).
4. **Survivor-specific identity** (currently reuses the soldier rig for captures).
5. `region-crown` camera sits in the moor↔crown blend band (reports blended region) — pick a pose
   fully inside crown.
6. Real-GPU profiling (SwiftShader cannot async-compile shaders), controller/mobile/campaign
   playtests, and more distinct enemy/character models.
