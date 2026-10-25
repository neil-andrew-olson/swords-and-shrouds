# Iteration cycle 2026-10Q — Results (AAA loop, cycle 14)

Fourteenth cycle. Two threads: planned **landmark + atmosphere** content (windmill with animated
sails, torch-lit roads, torch-fire ambience) and an unplanned **character-look hotfix** triggered by
user review (floating diamonds, pale marble bodies, blindfold head band, translucent cape, a green
companion artifact). Final bundle `index-DYb3SbYc.js` (960,484 B), deterministic across cleared-cache
builds with the source-freshness gate.

## 1. Character look hotfix (user-flagged)

The user shared an in-game close-up: player/ally heads had an odd dark band, bodies read as pale
teal "stone", a translucent purple panel floated at the back, and two white diamonds hovered above
heads. Diagnosis:

- **White diamonds** = overhead actor markers (friendly/ally indicators) drawn above every actor —
  not an artifact in the world, but too large/close. **Fixed:** size .13→.085, height 2.45→2.55,
  deeper palette, distance-gated (>6 m), no marker for the local player, friendly opacity .55 /
  hostile .85 / downed .9, bob only in normal motion (static under reduced motion). New QA hook
  `__ssMarkers()`.
- **Pale "stone" bodies / odd head band** = baked character atlases (pale patchwork + dark visor/hair
  region) plus a strong cool Fresnel rim and high env intensity washing the model at night. **Fixed
  (look pass v4):** albedo grade in-shader (saturation ×1.30, contrast ×1.08), rim armour .20→**.10**
  / cloth .25→**.14** / body .12, envMapIntensity 2.3/2→**1.5/1.3**, roughness floors .60/.65→
  **.68/.72**, faction steel tint on armour, and a **procedural great-helm** (252 tris: dome +
  faceplate + dark T-slit + neck guard, steel `#5c6470`) for all armoured humans so heads read as
  deliberately helmed knights instead of a marble face; ranger/survivor get a dark low cowl. A first
  iteration (visor band + amber eye dots) was rejected on review and removed.
- **Translucent purple panel** = character cloth (cape/tabard) from a pale/patchwork atlas band with
  cloth materials in a semi-transparent state. **Fixed:** all character cloth forced opaque
  (transparent=false, opacity 1, depthWrite, alphaTest 0), atlas map removed for the cape, deep
  opaque faction colours (templar/hero `#5a2b28`, ranger `#38462f`, berserker `#5a3a24`, etc.).
- **Bright green sphere at the player's hip** in the first in-game recapture = a **real companion
  soldier** carrying the moss-green role faction tint + green cloth (and earlier a green hood).
  **Fixed:** companions now force neutral cool steel (`#8fa2b8`) and neutral dark cloth (`#474b53`);
  hoods only for player ranger/survivor, darkened/desaturated. Clean in-game captures (no preview
  bodies) confirm no green object, no dots, no translucent sheet.
- QA hook `__ssCharacterLook()` exposes rim/grade/transparent list/cape/helm/faction/eyes for
  verification; in-game observed: `{transparentMaterials:[], rimWeights:{armour:.1,cloth:.14},
  grade:{saturation:1.3,contrast:1.08}, helm:{present:true,style:'great-helm',tris:252},
  factionTint:'#8fa2b8', eyes:false}`; front torso mean **88.0** (60–95), steel body mean ~63.5/64.2
  (viewer). Character tone/readability gates added to QA.

Remaining art debt (cycle 15): the underlying baked atlases are still patchwork/pale at extreme
close range; a **character atlas rebake v5** (armour/leather/skin/cloth semantics, no patchwork
bands) is the next step to true AAA close-up quality.

## 2. Windmill landmark with animated sails

- New procedural night-palette assets: `windmill` (1,000 tris, 10.0 m tall, ground-centred, door +Z,
  gallery/cap) and `windmill_sails` (668 tris, hub pivot at origin, blades in XY plane → spin local
  Z). Validator budgets 2,500/800; payload 83 files.
- Placed as a Green March farmland landmark at **(64, 36)** yaw −2.954 (relocated from (70,20) after
  the first capture showed pine occlusion; Lead-approved, tree-free cell, 42.8 m from the village
  landmark). One distance-culled instanced layer, receive-only shadows, no new lights.
- **Animated sails**: group at hub world anchor (63.357, 7.20, 32.611), deterministic wind-scaled
  rotation (~0.26–0.40 rad/s), **stopped under reduced motion**, 85 m culling, exactly **+1 draw when
  visible**. QA measured angle delta **0.442–0.470 rad** over 3.8 s, reduced speed 0/delta 0,
  draws 1/0. `__ssWindmill()` hook.

## 3. Torch-lit roads + torch ambience

- Installed `torch_post` asset placed as **8 posts** on one instanced layer (+1 draw, 1,216 tris)
  along the keep→village→fortress roads with validated clearances; 8 flame cones appended to the
  existing flames layer (**no new lights**). Exported `TORCH_POSTS`.
- New **torch-fire crackle ambience bed** anchored to the nearest post (10 m radius, quadratic fade,
  level 0.018 at the post), exposed in `__ssAudioState().landmarkBeds.torches` and QA-focus
  verifiable; respects Sound/ducking, allocation-free. QA: focus (11,17) → 0.018, away → 0, restore.

## 4. Verification (final artifact `index-DYb3SbYc.js`, 960,484 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two cleared-cache builds identical hash + freshness gate |
| `validate-assets` | **87/87** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **139/140** (one harness timing read fixed + green in probe 117/117 and perf 137/137) |
| Perf | **137/137** — spawn **186 calls / 1,637,968 tris**, low tier green |
| Mobile | **26/26** |
| Co-op | **22/22** |
| Character look / markers | PASS (helm/T-slit, no green orb/dots/sheet, torso 88.0, markers gated) |
| Windmill / torches / torch bed | PASS (sails angle delta, 8 posts, bed .018/0) |
| Payload / night | **17.74 MiB**; night 50.96; 18 optional views green |

Roadmap: `docs/AAA-ROADMAP.md` (milestones A–F, near-term cycles 15–18, honest debt register).

## 5. Carried into cycle 15

1. **Character atlas rebake v5** — armour/leather/skin/cloth semantic regions (remove patchwork/pale
   bands) for true close-up quality; keep strict-mask palette and tone gates.
2. Deferred QA captures: Warden forced-boss shot, forced Screamer via `__ssForceSiege(3)`,
   normal forced-siege after resolve if feasible.
3. Audio landmark **ear check** (human), physical-device mobile / real-GPU / perceptual playtests,
   hardware controller rumble.
4. Next content milestone per roadmap: animation depth (heavy attack, dodge/step, death variants,
   foot-slide) then enemy family #2 and a second boss.
