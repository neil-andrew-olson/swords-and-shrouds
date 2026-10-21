# Crusader rig repair — 2026-10-20

Targeted local preview repair, not a production deployment or a complete character art fix.

The supplied original player_templar_crusader_animated.glb has a roughly 0.000197-unit Z-up mesh while skeleton bind positions span roughly 0.0196 units vertically. Original normalized skin weights have zero dominant vertices for both forearms and hands. Lower-arm vertices are assigned to torso/leg influences.

scripts/custom-assets/repair-crusader.mjs aligns the original mesh with this skeleton's bind space and rebuilds normalized four-joint weights by distance to anatomical bone segments. It preserves textures, UVs, skeleton and selected existing clips. It refuses unexpected source scales and existing output paths. It is specific to this original Crusader, not a general autorigger.

Validation: the full-detail repair was rendered through the game's character renderer in rest, idle, run, attack and block snapshots. Idle/run inspected as humanoid rather than the supplied screenshot's spike collapse. This is sampled visual verification, not exhaustive animation QA. The conservative reduced variant generated successfully at 127,328 triangles; its final visual recheck was interrupted by workspace loss and must be completed locally. Script syntax checked after recovery. Do not claim all-character repair or production performance validation.

The repeated rear face/texture is unchanged and requires separate UV/texture work. Clothing and shoulder deformation still need visual review. Existing <=16,000-triangle asset budget tests will reject this preview if installed. Do not silently relax those tests or deploy the preview as finished.

Run from repository root after installing root and scripts/custom-assets dependencies:

    node scripts/custom-assets/repair-crusader.mjs ORIGINAL.glb REPAIRED.glb

Open REPAIRED.glb in model-inspector.html. Never run prepare.mjs on repaired output: that would apply coordinate conversion twice. To test in game, gzip the repaired bytes directly into public/assets/custom/templar.glb.gz after backing up that file. Do not change the hosting pin yet.
