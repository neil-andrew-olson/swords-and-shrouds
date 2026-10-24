# Swords & Shrouds — Iteration cycle 2026-10J (AAA loop, cycle 7)

Cycle 6 (`docs/BATCH-2026-10I-RESULTS.md`) shipped the Wandering Survivor, controller rumble/hints,
reduced-motion/altar/crown fixes at **206 calls / 1.727 M triangles**, live `index-CwNoKm_O.js`.
Cycle 7 targets **enemy variety** (new undead silhouettes), the remaining **strict-mask armour
palette** debt, the **altar/content capture hook**, and **accessibility/controller settings**.
Standing gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Enemy variety (new undead silhouettes)
Bake two additional undead variants that reuse the existing enemy rigs and clip sets (so combat and
animation contracts are unchanged), installed as **additional assets** (existing `zombie` /
`skeleton-soldier` stay):
- `zombie-bloated`: zombie 30-joint rig, same clips, distinct swollen/plague-bloated silhouette
  and palette (add-on prim or reshaped safe geometry; ≤11,000 tris, ≤~400 KB).
- `skeleton-armoured`: skeleton-soldier 51-joint rig, same clips, helmet + shield/pauldron add-ons
  rigid-weighted to the existing joints (like the character add-on pipeline; ≤8,500 tris, ≤~350 KB).
Client maps a deterministic subset of undead spawns to the variants (id-based) with **defensive
fallback** to the base assets if loading fails. Acceptance: at least ~25 % of undead spawns in a
region show a variant; variants are visually distinct at 10 m; 0 errors.

### 2. Strict-mask palette (ranger/hero/fallen)
Target **≥5/7 bodies ≥500 strict silhouette-mask colours** (cycle-6: templar 559, ally 707,
berserker 725, survivor 1077; **hero 454, fallen 460, ranger 379**):
- ranger: lighten the re-dyed cloak base so existing hue chips survive 5-bit quantisation;
- hero: stronger luminance-separated chips/trim on large plate faces;
- fallen: bigger/brighter patina-rust chips across corrupted plates.
Keep filenames/skin/clips/sockets, files ≤900 KB, tris ≤15,500.

### 3. Content capture hook + altar visibility
Make QA content views render player-distance-culled dressing (altar, furnaces, wells) by having the
ruins/dressing culling follow the QA camera when a `__ssQAView` is active (like landscape already
does). Acceptance: `content-altar` / `content-furnace-*` views show the props in QA captures; normal
play culling unchanged (85 m from the player); no perf regression.

### 4. Accessibility + controller settings
- **Captions/CC** for key non-visual cues (thunder, nearby undead, siege start/end, low health,
  castle captured) — a small caption line in the HUD, toggleable in Settings, off by default.
- **Controller settings**: deadzone preset (tight/normal/wide) + look sensitivity slider persisted
  to localStorage, applied through `readPad` (controller.ts) and the existing sensitivity path; HUD
  hints unaffected.
- Keep 58 test blocks (extend existing blocks only), Sound/pause/reduced-motion gating intact.

### 5. Plague-area dressing (small content)
Enrich the plague nest area with corpse/grave/stake dressing using existing shipped assets only
(no new files), distance-culled like other dressing, so the nest reads as a ritual/plague site.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (armour atlases + new enemy variants), `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **weapons-armory** | `src/shared/characters.ts` (enemy variant mapping), `custom-character.ts`, `tests/characters.test.ts`/`equipment.test.ts` (assertions only) |
| **world-scene** | `scene.ts` (QA-focus culling pass-through, enemy variant preload in `assets.ts`), `effects.ts`, `assets.ts` |
| **audio-polish** | `main.ts`, `controller.ts`, `style.css`, `tests/feedback.test.ts` (assertions only) |
| **ruins-builder** | `ruins.ts` (plague-area dressing; culling focus compatibility) |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 7:** spawn TP calls **<290**, triangles **<2.15 M**, quality tiers intact.
- Report measured before/after + screenshots; defer if needed and say so.
