# Swords & Shrouds — Iteration cycle 2026-10K (AAA loop, cycle 8)

Cycle 7 (`docs/BATCH-2026-10J-RESULTS.md`) shipped enemy variants, cleared the strict-mask palette
debt (7/7), content-capture culling and accessibility captions at **213 calls / 1.736 M triangles**,
live `index-sJM8R4Jf.js`. Cycle 8 targets **mobile/touch experience**, device-aware quality, enemy QA
framing, combat hit feedback, and the remaining visual tone debts. Standing gates unchanged
(58/58 tests, tsc, build, validator, smoke/co-op/live).

## Goals + acceptance

### 1. Mobile / touch experience (browser-native requirement)
Touch input already partially exists (`#stick`, `#lookpad`, `[data-hold]` buttons, `touch` state).
Polish it into a shippable mobile experience:
- Responsive HUD layout for narrow/landscape screens (safe-area insets, no overlapping panels,
  readable font sizes, hint bars hidden on touch, action buttons thumb-reachable).
- Touch camera sensitivity + stick deadzone sane defaults; pointer capture robustness
  (multi-touch move+look+attack simultaneously); prevent page scroll/zoom gestures on the canvas.
- **Device-aware quality**: detect touch/coarse-pointer and small screens; default to medium/low
  quality tier and clamp DPR on low-memory/high-DPI phones (no saved user choice override); keep
  SwiftShader/low-end behaviour. Expose `__ssDeviceProfile()` for QA.
- Acceptance: QA device emulation (mobile viewport 390×844 + touch, and landscape 844×390) shows the
  touch HUD, stick/look/attack working, no overlapping HUD, quality auto-defaulted, 0 errors;
  desktop keyboard/mouse unchanged.

### 2. Enemy QA framing hook
Add a reliable QA hook to frame any undead variant (e.g. `__ssPreviewEnemy('zombie-bloated'|'skeleton-armoured'|'zombie'|'skeleton-soldier', distance)`) that spawns/builds a preview rig in an open, unobstructed spot (or at a provided pose) and returns `{ok,appearance,distance,ready}`; `null` restores. Cycle-7 QA's in-world bloated captures were obstructed by camp props; this hook fixes capture reliability.

### 3. Combat hit feedback v2 (client-only)
Enemy damage feedback: brief hit flash (emissive/additive pulse) on the struck actor's materials,
heavy-hit stagger/shake of the enemy mesh, and a small impact spark burst at the contact point using
existing pooled FX; scaled by the weapon profile; no server changes, no per-frame allocations, works
for all 4 undead variants; respects reduced-motion. Acceptance: visible flash/kick on hits and

### 4. Visual tone debts
- `zombie-bloated` is intentionally plague-pale but reads too bright at close range (mean ~126 vs
  base 83) — bring it closer to the base while keeping the bloated read (albedo level, not mottle).
- `hero` strict-mask palette optional headroom (526 → comfortably >550 if cheap).
- Plague nest ground: add corruption ground decals around the nest (existing feather-mask decal
  system) so the ritual area blends into the terrain instead of plain ground.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `public/assets/custom` (zombie-bloated, hero atlases), `scripts/bake/**`, `docs/ASSET-PIPELINE.md` |
| **world-scene** | `scene.ts` (device profile, enemy preview hook), `effects.ts` (nest decals), `assets.ts`, `postfx.ts` |
| **audio-polish** | `main.ts`, `controller.ts`, `style.css` (touch/mobile polish), `tests/feedback.test.ts` (assertions only) |
| **weapons-armory** | `custom-character.ts`/`equipment.ts` (enemy hit feedback), `tests/equipment.test.ts` (assertions only) |
| **ruins-builder** | `ruins.ts` (verify nest dressing + QA-focus; standby) |
| **qa-verifier** | `scripts/smoke-browser.mjs`, `docs/QA-REPORT.md`, `qa/**` |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates.
- **Perf acceptance cycle 8:** spawn TP calls **<290**, triangles **<2.15 M**, quality tiers intact;
  mobile emulation should land in the medium/low tier budgets.
- Report measured before/after + screenshots; defer if needed and say so.
