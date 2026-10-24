# Swords & Shrouds — Iteration cycle 2026-10E (AAA loop, cycle 2)

Cycle 1 (`docs/BATCH-2026-10D-RESULTS.md`) fixed the blacked-out characters, restored shadows and
reached 173 draw calls / 1.50 M triangles. Cycle 2 raises **character material fidelity and
silhouette variety**, pays down the batch-3 debt items, and adds atmosphere while keeping the game
smooth. Standing gates are unchanged (see `PROJECT_STATUS.md`); build with bundled Node 24.

## Baseline (deployed, cycle 1)

- Bundle `index-us7RDw53.js`; perf 173 calls / 1,500,333 tris (spawn TP, high); payload 12.41 MB.
- Characters readable but **over-bright/flat** (torso mean 102.8 / p50 114.3; baked atlases have
  little AO/material depth); all 7 player bodies share one mesh with palette swaps.
- Shadows restored; tents/stone walls receive-only; trees are LOD-only to 54 m.

## Cycle-2 goals + acceptance

1. **Characters (top priority)** — material depth and identity:
   - Bake **normal + roughness/metallic + AO** maps for the 7 character atlases and enrich albedo with
     procedural detail (chainmail weave on metal, plate seams/rivets, cloth weave, surcoat trim /
     heraldic bands, leather grain). Tonal target: night-realistic, **not white**. In-game
     third-person torso target: mean **65–95**, p50 **60–100**, black(<20) **<25 %**, detail
     preserved (unique colours in player region ≥500); close-ups must show normal/AO surface detail,
     no clipping (>250) beyond ~1 % of body pixels.
   - Add **distinct silhouettes per character** as skinned add-on armour (same single skin, extra
     prims, JOINTS_0/WEIGHTS_0, rigid-weighted to the appropriate Mixamo bones): e.g. shoulder
     pauldrons for hero/templar/ally/berserker, hood/cape for ranger/survivor, helmet crest/spikes or
     corrupted shoulder horns for fallen. Tri budget per character ≤16,000 total (current 8,449);
     keep file ≤ ~700 KB incl. new maps; keep the 6 required clips + hand sockets + single skin.
2. **Keep atlas merge** (perf + detail): `fortress_keep` currently 5 prims / 5 trimsheets → 45 draw
   calls across nine keeps. Re-pack UVs and bake the 5 materials into one atlas → 1 prim / 1
   material (target 5 draws saved per keep, ~36 total), staying visually equal or better at night.
3. **World realism/atmosphere** (world-scene):
   - Near/far tree band: full-res pine/oak within ~20 m, LODs beyond (54 m outer); reassign instance
     matrices when the camera moves (no per-frame churn), no visible pop-through under fog.
   - Restore cast shadows for tents + ruined stone walls (they currently receive only).
   - Add torch smoke, drifting embers/ash and subtle moon-dust motes via pooled particles (reuse
     `CombatEffects` pools or a new pooled system; no per-frame allocations).
   - Raise `ACTOR_ENV_INTENSITY` to 2.2 and rebalance any over-bright character response with the new
     tone.
   - Acceptance: spawn TP calls **<210**, triangles **<1.85 M** (visual quality now outranks a strict
     triangle cap), 0 console errors/warnings, quality tiers still work.
4. **Environment composition** (ruins-builder): dress the world with existing assets only (toned
   torches, stakes, barrels, carts, braziers, banners, weapon racks) to make camps/courtyards/roads
   read as lived-in; place via existing instanced layers; no new draws beyond a few; no 404s.
5. **Audio** (audio-polish): quiet adaptive music/ambience bed (night drone + strings swell near the
   plague nest/siege, fade at captured castles), torch/fire crackle layers already present; keep
   Sound checkbox authoritative, no new npm deps, tests stable.
6. **Verification (qa-verifier)**: cycle-2 character close-ups (normal/AO visible, tone gates),
   perf capture (<210 calls / <1.85 M tris), smoke 16/16, co-op 18/18, live baseline; visual audit of
   3 regions/castles + camps with screenshots inspected via read_image; update QA report.
7. **Lead**: integrate, full gate, docs (`docs/BATCH-2026-10E-RESULTS.md`, PROJECT_STATUS), commit,
   deploy, live verify, workspace doc mirror + present cards; continue to cycle 3 (content expansion:
   new character models / structures / weather) after.

## File ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom/*.glb.gz` (characters + fortress_keep), `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **world-scene** | `src/client/scene.ts`, `landscape.ts`, `effects.ts`, `postfx.ts` |
| **weapons-armory** | `src/client/custom-character.ts`, `tests/equipment.test.ts` (assertions only) |
| **ruins-builder** | `src/client/ruins.ts`, `terrain-surfaces.ts` |
| **audio-polish** | `src/client/main.ts`, `ambience.ts`, `combat-feedback.ts`, `style.css`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | `docs/**`, `PROJECT_STATUS.md`, `index.html`, git, deployment |

## Standing rules

- `npm test` exactly 58/58 (extend existing assertions only); `tsc` 0 errors; production build green;
  `validate-assets.mjs` all pass; no new npm deps; no external texture/buffer URIs; gzip-9 embedded
  assets; canonical weapon orientation and rig/anim integrity preserved; 0 console errors/warnings.
- One dist builder at a time; QA owns authoritative captures; teammates never run git commands or
  edit another owner's files. Report before/after measurements, not just "done".
- Deploy at the end of the cycle; live verification by the Lead + final live QA pass.
