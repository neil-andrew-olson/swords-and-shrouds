# Swords & Shrouds — Iteration cycle 2026-10I (AAA loop, cycle 6)

Cycle 5 (`docs/BATCH-2026-10H-RESULTS.md`) shipped armour art v3, cloth wind, dense snowstorms,
combat feel, altar/forge content and surface audio at **208 calls / 1.727 M triangles**, live
`index-Dki3Ti_e.js`. Cycle 6 clears the remaining QA debts, polishes controller support and adds a
sixth playable appearance using the existing survivor rig. Standing gates unchanged (58/58 tests,
tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Masked-palette art debt (ranger / hero / fallen)
Hue chips on the strict silhouette-mask palettes so **≥5/7 bodies ≥500 masked colours** (current
strict: templar 606, berserker 739, survivor 1073, ally 697, hero 402, fallen 424, ranger 376):
- ranger: break up the cloak **exterior** with hue-separated panels/patches (hood already reads);
- hero: coloured trim/hue chips on the large pauldron + cuirass faces (all-plate body);
- fallen: patina/rust hue chips across the large corrupted plates.
Keep atlas/geometry structure, skin/clips/sockets, ≤900 KB/file, ≤15,500 tris.

### 2. Sixth playable appearance — "Wandering Survivor" (existing survivor rig)
- Add `survivor` to `PLAYER_CHARACTERS` as *Wandering Survivor* so it appears in the character
  selectors (asset `custom/survivor` already exists and is equipment-compatible).
- Verify: selectable -> server snapshot appearance -> `customCharacter` renders it in-game with
  weapons/shield attached to hands, grounded animations, no console errors; equipment/armour tests
  cover it (it is already in the nine-body grounding set).
- Acceptance: QA can select it and capture third-person; no regressions in the existing 5.

### 3. Controller polish (Gamepad API already exists)
- **Rumble**: use `Gamepad.vibrationActuator.playEffect('dual-rumble', …)` on player damage (heavy
  scaled by weaponCombatProfile weight), block impacts and castle capture (subtle), respecting the
  existing reduced-motion preference (no rumble when reduced motion) and stopping on pause/menu.
- **Hints/UI**: when a pad is connected show controller glyph hints in the HUD/hints bar (buttons
  for attack/block/sweep/heal/interact) and a one-line connection toast; keyboard hints stay for
  keyboard users; handle connect/disconnect events.
- **Settings**: small controller sensitivity/deadzone option if cheap (defaults sane), and ensure
  the existing readPad mapping stays deterministic/tested.
- Keep exactly 58 test blocks (extend existing blocks only).

### 4. Remaining QA debts + small polish
- **Reduced-motion vignette residual**: ensure damage vignette reaches 0 under reduced motion even
  mid-effect (cycle-5 one sample showed 0.546); verify with `__ssSetReducedMotion`.
- **Low-tier cloth-wind isolation**: expose/verify a flag or assert that quality low removes the
  cloth wind term (hook is wired; add a readable state for QA).
- **Altar night readability**: add 2–3 candle flame glows on the altar top by reusing the existing
  additive brazier-flame cones (append to the existing flames layer, no new draw) — keeps the dark
  stone silhouette but makes the ritual site readable at night.
- **`landmark-crown` camera**: move fully inside the crown region (minor).
- Surface-audio ear-check remains a human task; document as debt.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (character atlases), `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **audio-polish** | `main.ts`, `shared/characters.ts` (survivor entry), `style.css`, `tests/feedback.test.ts`, `tests/characters.test.ts` (assertions only) |
| **world-scene** | `scene.ts`, `effects.ts`, `postfx.ts`, `assets.ts` |
| **ruins-builder** | `ruins.ts` |
| **weapons-armory** | `custom-character.ts`, `equipment.ts`, `tests/equipment.test.ts` |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 6:** spawn TP calls **<280**, triangles **<2.05 M**, quality tiers intact.
- Report measured before/after + screenshots; defer if needed and say so.
