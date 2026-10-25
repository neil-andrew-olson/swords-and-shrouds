# Swords & Shrouds — Iteration cycle 2026-10R (AAA loop, cycle 15)

Cycle 14 (`docs/BATCH-2026-10Q-RESULTS.md`) shipped the windmill/torches content and a character-look
hotfix (great-helm, steel tint, opaque capes, marker gate) at 186 calls / 1.64 M tris. Cycle 15 is the
first **roadmap milestone-A quality cycle**: the **character armour atlas rebake v5** — replacing the
patchwork/debug-chip look that still shows at close range — plus the deferred QA captures and
in-game proof. Standing gates unchanged (58/58 tests, tsc, build, validator, smoke/co-op/live).

## Context for the atlas work

The character pipeline (`scripts/bake/bake-character-armour.mjs`) adds a procedural armour primitive
per appearance with a 512² procedural atlas built from `palette {metal, cloth, accent}` plus hue/chip
knobs (`metalChips`, `metalHueAmp`, `chipBoost`, `chipBlocks`, `clothPatches`, …). Those chip/block
knobs were added to satisfy the strict-mask colour-count test and now read as blotchy "patchwork"
at close range. The base body scan atlas is separate.

## Goal: armour atlas v5 (player-facing bodies)

- Rebake the **armour atlas** for the six selectable appearances (templar, hero, berserker, ranger,
  ally, survivor) — and the fallen/corrupted body if cheap — with **coherent material reading**:
  - large steel plate fields with subtle value variation and edge wear (no rainbow chips);
  - dark leather straps/underlayers for contrast;
  - faction cloth colours (deep red, steel blue, moss green, rust, brown) as clean panels;
  - restrained gold/brass trim bands and rivets for accent;
  - weathering/dirt gradients at edges/bottom, not random blotches.
- Keep the **strict silhouette-mask palette ≥500** (adjust the test-supporting variety so it lives in
  trim/rivets/panel edges rather than big random chips); keep body tone gates (torso mean 60–95);
  same tris/prim/clips/skins/budgets; validator 87/87; no new textures/extensions.
- Provide viewer before/after close-ups (front + back) for templar/hero/ally, plus the other three.
- weapons-armory then re-tunes the look-pass grade (saturation/contrast/faction tint/rim) on top of
  the new atlas so the two don't double up, and produces **in-game** close-ups (front/back/3p) on a
  rebuilt dist with `__ssCharacterLook()` values. The design target: at 2–3 m the character reads as
  a crafted armoured knight (steel, leather, cloth, trim), not stone/patchwork.

## Secondary: deferred captures + regression

- QA: Warden-mode forced boss early screenshot; forced Screamer capture via `__ssForceSiege(3)`;
  normal forced-siege after resolve if feasible.
- Keep the hotfix behaviour: great-helm/hood head covering, opaque capes, distance-gated markers,
  no green companion tint, transparentMaterials []; all prior gates green.

## Ownership

| Owner | Files |
| --- | --- |
| **asset-forge** | `scripts/bake/bake-character-armour.mjs`, `public/assets/custom/*.glb.gz` (armour atlases), validator, ASSET-PIPELINE |
| **weapons-armory** | `src/client/custom-character.ts` (grade/rim/tint re-tune), in-game capture harness (read-only), tests |
| **qa-verifier** | `scripts/smoke-browser.mjs` (look gates + captures), `QA-REPORT.md`, `qa/**` |
| **world-scene / audio-polish / ruins-builder** | standby this cycle |
| **Lead** | docs, `PROJECT_STATUS.md`, git, deployment |

## Standing rules

- 58/58 tests exactly, tsc 0, production build, validator all pass, 0 console errors/warnings, no new
  npm deps, embedded assets only; one dist builder at a time; PID-scoped only; no git from teammates;
  re-check source mtimes vs artifact and rebuild twice with cleared Vite cache before handing a hash.
- **Perf acceptance cycle 15:** spawn TP calls **<290**, triangles **<2.15 M**; atlas changes must not
  change tri counts (≤16 k/body, ≤900 KB/file).
- Report measured before/after + screenshots; defer if needed and say so.
