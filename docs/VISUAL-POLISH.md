# Visual polish verification

This batch integrates seven previously unused generated models and corrects the reported weapon and grounding defects.

## Why characters floated and attacks moved them

Character normalization used broad object bounds, and root-motion filtering assumed an unrotated armature. The imported armature rotates its axes. Attack clips therefore translated the rendered character several meters from its server position. The renderer now uses body mesh bounds, cancels horizontal hip movement in character coordinates, and grounds the animated body independently of attached equipment.

## Weapon handling

Each weapon has an explicit source-space handle center and blade/head direction. That profile is shared by the first-person view, third-person hand attachment, and weapon rack. Mixed source axes and reversed swords are no longer guessed from the longest bounding-box dimension.

## New assets used

| Asset | Use |
| --- | --- |
| Templar | Defender companions |
| Ranger | Flanker companions |
| Berserker | Heavy companions |
| Skeleton soldier | Alternating undead appearance |
| Zombie peasant | Alternating undead appearance |
| Survivor | Three animated survivors at each camp |
| Cauldron | Survivor camp prop |

## Verification

56 automated tests pass, including nine character bodies across idle/run/block/attack, bounded horizontal animation movement, and all five measured weapon profiles. TypeScript and production Vite build pass. Local Chromium rendered the model lineup, attack poses, survivor camp, and production application in both camera modes without page errors.

This does not certify a complete campaign playthrough, physical controller behavior, live deployment, or mobile performance. The supplied custom undead models do not yet have the old segmented skeleton's detached-limb rendering. Two-handed weapons still need a support-hand IK pass. More generated environment structures remain to integrate.
