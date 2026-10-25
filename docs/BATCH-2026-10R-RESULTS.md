# Iteration cycle 2026-10R — Results (AAA loop, cycle 15)

Fifteenth cycle — roadmap milestone A (look & feel): the **character armour atlas rebake v5/v5.1** and
a matching **look-pass re-tune**, plus closure of the Warden/Screamer capture debt. Final bundle
`index-Dcbqu6dS.js` (960,403 B), deterministic across cleared-cache builds with source freshness.

## 1. Armour atlas v5 (asset-forge)

Replaced the patchwork/debug-chip character armour look with a **coherent 4-band material atlas**:
- **steel plates** — large coherent fields with value/hue-stepped panels, raised edge highlights,
  mid-tone insets, regular **brass rivet rows** (3 brass shades + dark-iron shadows);
- **dark leather** straps/underlayers with tone segments, brass buckles, stitched seams;
- **faction cloth** panels (deep red / steel blue / moss / rust / brown) with tone-stepped folds,
  stitched seam lines, off-white rules and 3-stripe emblem blocks;
- **brass trim** bands alternating with steel/leather and rivet heads.
- **All debug knobs deleted** (`metalChips`, `metalHueAmp`, `chipBoost`, `chipBlocks`, `plateFamilies`,
  `plateGems`, `plateStripes`, `clothPatches`, `clothHueAmp`, per-body `atlas:` blocks) so the chip
  look cannot return on rebuild. Steel/trim metalness lowered so night IBL no longer blows plates to
  pale stone.
- **Strict-mask palette repaired and exceeded**: templar 1,311 · hero 987 · ally 1,214 · berserker 716
  · ranger 802 · survivor 728 · fallen 777 → **7/7 ≥560** (house gate 7/7 ≥500). Torso means 79.9–92.4.
  Files 718–746 KB (≤900), tris/prims/skins/clips/body hashes unchanged, validator 87/87.

## 2. Look-pass v5 re-tune (client)

- Grade no longer double-saturates the new atlas: armour **sat 1.12 / contrast 1.04**, body-prim
  .95 / 1.03, cloth 1.15 / 1.04; adaptive target 96.
- Faction steel multiply removed (`factionTint:'atlas'`); atlas palette carries faction colour.
- Cloth atlas maps re-enabled (opaque, DoubleSide) — clean faction capes with seams/emblem instead of
  flat solid colour; helm/hood head covering retained; steel metalness preserved from the atlas;
  body-scan prims forced non-metal with a warm/desaturated tint.
- Kept: rim .10/.14, env 1.5/1.3, roughness floors .78/.82, no green companion tint,
  `transparentMaterials:[]`, `__ssCharacterLook()` hook updated.
- In-game 2.5 m proof (`ingame-clean-{front-player,back-player,3p}.png`, no preview bodies):
  steel great-helm with dark T-slit, coherent steel/leather/red cloth read, no patchwork, no green
  object, no dots, no translucent cape. Viewer tone templar 72.0/67.5, hero 75.6/71.6, ally 74.1/70.1.
- **Honest remaining gap:** the **body-scan limbs** (separate base atlas) still read pale at extreme
  close range; scoped as the **cycle-16 body-atlas tone pass** (warm/desaturate + slight value floor on
  the base body colour atlas only, armour untouched).

## 3. Deferred captures closed

- **Warden forced boss**: HP 276 early screenshot within ~3 s (`qa/warden-c15/siege-boss-early.png`,
  bar 100%, aura) — the cycle-11/13/14 deferral is now evidenced.
- **Forced Screamer**: `__ssForceSiege(3)` → index-3 wave 10, `Shroud Screamer hp72/72`,
  `stats.screamers 1`, capture (`screamer.png`); shriek event needs aggro ≤30 m (owner sim covers it).
- Normal forced siege after resolve: index 1, boss false, wave 6.

## 4. Verification (final artifact `index-Dcbqu6dS.js`, 960,403 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two cleared-cache builds identical + source freshness |
| `validate-assets` | **87/87** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **143/143** (incl. look close-ups) |
| Perf | **139/139** — spawn **186 calls / 1,637,872 tris** (low tier green) |
| Mobile | **26/26** |
| Co-op | **22/22** |
| Look gates | strict-mask 7/7 ≥560, harness 7/7 ≥500, front torso mean 90.65, no patchwork/green/dots/cape artifacts |
| Payload / night | **17.47 MiB** (atlas is smaller than v4); night 51.12 |

## 5. Carried into cycle 16 (roadmap milestone A/B)

1. **Body-scan atlas tone pass** (asset-side): warm/desaturate + slight value floor on the base body
   colour atlas (armour atlas untouched) to finish close-up limb quality.
2. **Animation depth** (roadmap A): heavy-attack, dodge/step-back, death variants, idle fidgets,
   run speed matching (foot-slide), blend polish.
3. Audio landmark **ear check** (human); physical-device/real-GPU/perceptual playtests; hardware rumble.
4. Then enemy family #2 + second boss (roadmap B).
