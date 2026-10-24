# Swords & Shrouds — Batch 2026-10B (readability, combat feel, arsenal depth, live/co-op QA)

Shared contract for the second autonomous batch. Read [`docs/BATCH-2026-10-SPEC.md`](./BATCH-2026-10-SPEC.md)
for the batch-1 asset/code conventions; this file only lists what changes now. Teammates never run
git commands; the Lead owns integration, commit and deployment.

## Baseline

- Game repo `main` = `6ef7aea`, hosting pin `0ee662b`, live site serving the batch-1 bundle.
- `npm test` 58/58, `npx tsc --noEmit` 0 errors, headless smoke 16/16.
- Batch-1 result docs: `docs/BATCH-2026-10-RESULTS.md`, `docs/ASSET-PIPELINE.md`, `docs/QA-REPORT.md`.

## Goals

1. **Readability** — the scene is a stylised night now, but the moonlit ground vs long castle shadow
   still has strong contrast, the fill light pools on the ground, and distant actors read as dark
   silhouettes. Make the battlefield readable without losing the night mood, keep the sky's
   moon/stars in the default camera framing.
2. **Combat feel** — weapon-specific swing motion (thrust/cleave/crush/sweep), visible swing trails,
   stronger impact readability, ground blood/corruption splatter decals, brief hit stagger, and a
   better two-handed support-hand pose.
3. **Arsenal depth** — add `flamberge` (two-handed wavy greatsword) and `mace` (one-handed flanged
   mace) with canonical grips, distinct stats and full rack distribution (10 weapons total).
4. **Environment depth** — survivor camps get tents; the Castle 1 → 2 road (and the other regions)
   get ruined stone-wall segments. Terrain surface tone refined for the night palette.
5. **Verification** — browser QA must cover the live Cloudflare URL and real 2-player co-op, and
   investigate the spurious WebSocket reconnects seen under software rendering.

## Non-negotiable gates

- `npm test`: **exactly 58 tests, all passing** (extend assertions inside existing tests only).
- `npx tsc --noEmit` 0 errors; production `vite build` succeeds (bundled Node 24:
  `C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`; the system
  Node 22.11 is below Vite 7's floor).
- Every `public/assets/custom/*.glb.gz` keeps the batch-1 asset contract: glTF 2.0, gzip-9, embedded
  images with `bufferView`, indexed primitives, `TEXCOORD_0`, no Draco/KTX2/meshopt extensions.
  Budgets: weapons ≤ 3,400 tris; props ≤ 8,000 tris.
- New weapons use canonical source orientation: grip at local origin, blade/head +Y, handle 15–25 %
  of total height below origin. Weapon `length` ≤ 1.9 so the attached bounds diagonal stays < 2.2.
- No gameplay-rule changes: simulation stays server-authoritative; new weapons are content only.

## File ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom/<new>.glb.gz`, `scripts/bake/**`, `temp_sketchlab/**`, `docs/ASSET-PIPELINE.md` (append) |
| **weapons-armory** | `src/shared/weapons.ts`, `src/client/equipment.ts`, `src/client/custom-character.ts` (support-hand pose only), `tests/armory.test.ts`, `tests/equipment.test.ts`, `src/simulation/game.ts` (rack seed if needed) |
| **world-scene** | `src/client/scene.ts`, `src/client/landscape.ts`, `src/client/effects.ts`, `src/client/postfx.ts` |
| **ruins-builder** | `src/client/ruins.ts`, `src/client/terrain-surfaces.ts` |
| **audio-polish** | `src/client/main.ts`, `src/client/combat-feedback.ts`, `src/client/ambience.ts`, `src/client/style.css`, `tests/feedback.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | `docs/**` (except ASSET-PIPELINE.md), `PROJECT_STATUS.md`, `index.html`, git, deployment |

## New assets (asset-forge)

| File | Source | Budget | Notes |
| --- | --- | --- | --- |
| `flamberge.glb.gz` | `sketchlab/flamberge.zip` → `source/Flamberg2.fbx` + textures | ≤ 3,400 tris | canonical weapon orientation, 1–2 materials |
| `mace.glb.gz` | `sketchlab/medieval-mace.zip` → `source/Mace.rar` (extract with bsdtar: `tar -xf Mace.rar`; bsdtar/libarchive handles RAR) → `Mace.fbx` + textures | ≤ 3,400 tris | canonical weapon orientation |
| `camp_tent.glb.gz` | `sketchlab/top_down_low_poly_medieval_camp.glb` (117 k tris, 3 meshes, 7 images) — isolate the tent/camp shelter mesh | ≤ 6,000 tris | ground-centre origin, embedded base colour |
| `stone_wall.glb.gz` | `sketchlab/stone_wall_scan_2.glb` (377 k tris, 4 meshes) — one decimated wall segment | ≤ 8,000 tris | ground-centre origin, ~4–6 m long, embedded textures |

Reuse the batch-1 pipeline (`scripts/bake/bake_assets_blender.py`, `postprocess-glb.mjs`,
`scripts/validate-assets.mjs`). Work in `temp_sketchlab`; only validated files land in
`public/assets/custom`. Append the new rows to `docs/ASSET-PIPELINE.md`.

## Weapon definitions (weapons-armory)

Add exactly two entries to `WEAPONS` (the stat shape is unchanged; keep the existing eight):

- `flamberge` — name “Flamberge”, two-handed wavy greatsword: damage ~60, reach ~4.2,
  cooldown ~1.1, stamina ~30, arc ~-0.08, length ~1.7, shield false,
  style “Wavy greatsword · wide cleave”.
- `mace` — name “Flanged mace”, one-handed blunt: damage ~44, reach ~2.9, cooldown ~0.95,
  stamina ~22, arc ~0.35, length ~0.8, shield true,
  style “Crushing head · shield guard”.

Canonical grips: `{grip:[0,0,0],blade:[0,1,0]}` for both (baker delivers grip-at-origin/blade-+Y).
`WEAPON_IDS` becomes 10; the rack seed `WEAPON_IDS[1+i%(WEAPON_IDS.length-1)]` across nine castles
already covers all nine non-sword weapons exactly once — verify and leave it unchanged unless the
math changes.

Support-hand pose (`src/client/custom-character.ts`): improve the existing two-handed left-arm pose
so the off-hand reads as gripping nearer the shaft for polearm/greatsword weapons during idle/run,
without breaking the nine-body grounding test. Best-effort visual work; keep it cheap and
deterministic.

## World/scene work (world-scene)

- Ground/road: reduce the remaining brightness gap (road/cobble tint down further, ground detail
  cooler/lower contrast), keep the scanned detail; no white fill-light pool on the ground.
- Actor readability: reposition/retune the player-following fill light (higher, shorter range) and
  raise environment intensity on armour so actors read at distance; keep the 14-light budget.
- Sky: lower the moon elevation / bias star density so the moon or a rich star field is visible in
  the default third-person framing; keep fog off celestial materials.
- Combat feel: weapon-specific first-person motion mapped from the weapon id
  (thrust = rapier/longsword, cleave = flamberge/dane axe/zweihander, crush = mace/hammer/bastard,
  sweep = poleaxe/halberd); third-person swing trail (additive ribbon/arc from the actor, pooled);
  brief hit stagger/lean on impacted actors; brighter impact sparks; ground blood/corruption
  splatter decals (pooled sprites/quads, long-lived, capped).
- Robustness: adaptive quality — if the rolling average frame time exceeds ~28 ms for a couple of
  seconds, step the composer pixel ratio down toward 1.0 (never below 1.0) and recover when healthy.
  Keep the fallback path and tsc clean.

## Ruins/terrain work (ruins-builder)

- `ruins.ts`: place `camp_tent` ×2–3 per survivor camp (alternate scales/rotations; hide with the
  camp’s rescued/far visibility like the camp furniture), and `stone_wall` segments flanking the
  Castle 1 → Castle 2 road plus a few in the other regions (≥ 8 m from road centres, outside
  `walls(c)` footprints, never the gate corridor). All optional/defensive.
- `terrain-surfaces.ts`: refine the night ground albedo (lower contrast, cooler, slightly darker),
  keep scanned road/cobble detail, ensure the road reads as grey stone. No new downloads.

## Audio work (audio-polish)

- Event stingers driven from the authoritative game state/events: castle captured, survivor group
  rescued, siege warning, victory, defeat (short synthesised motifs; respect the Sound checkbox and
  reduced-motion preferences where relevant).
- Weapon-specific swing cue variants driven by weapon id (thrust whoosh vs heavy cleave vs blunt
  crush), layered over the existing impact/block/hurt sounds.
- Optional: a very quiet region/nest pad bed. Keep `combatCues()` semantics and the feedback tests
  intact; no new test() blocks.

## QA work (qa-verifier)

Extend `scripts/smoke-browser.mjs` with:
- `--url <url>` mode: skip build/server, drive the deployed site (live Cloudflare), create a
  campaign, screenshot both cameras, assert 0 page errors, 0 asset 404s (new GLBs/textures), 8→10
  weapon cards, and write results to `docs/QA-REPORT.md`.
- `--coop` mode: start the local authoritative server, open two independent browser contexts/pages,
  create a room with player A, join with B, verify both snapshots contain both players, movement
  propagates, a weapon-rack pickup unlocks for both, and both HUDs stay live. Screenshot both.
- Investigate the spurious `opens=3 closes=3` WebSocket lifecycle seen in the Lead’s software-render
  run: instrument whether closes come from the test harness navigation, server heartbeat, or the
  client’s reconnect logic; report root cause. If it is a real client bug under low FPS, report the
  exact code path (do not edit src).

Final phase (Lead signal): run the authoritative local smoke (`qa/final-batch2`), the live smoke,
and the co-op test; update `docs/QA-REPORT.md`; report pass/fail + concrete visual assessment
(readability, moon/stars, swing trails, tents/walls, new weapons) and any remaining defects.

## Lead

Integration review, full tests/tsc/build, browser checks, docs (`docs/BATCH-2026-10B-RESULTS.md`,
`PROJECT_STATUS.md`), commit + push game repo, update hosting pin, hosting build, push + live verify.
