# Custom artwork integration — October 17, 2026

Nine optimized models from Neil's updated uploads now supply the vanguard player,
Oathsworn companion, corrupted knight, first/third-person sword and shield,
castle trebuchets, functioning gate stakes, supply caches and plague nest.
Existing castle collision, capture and siege logic remain authoritative. Trebuchet
visuals retain the established artillery timing and damage rules. Other supplied
classes and defenses are not yet activated as gameplay features. Existing KayKit
skeletons remain in use to preserve their mesh-part dismemberment.

The uploaded vanguard and Oathsworn vertices were Z-up and 100 times smaller than
their rig's expected mesh space. Conversion rotates/scales these positions into
the corrupted-knight rig's Y-up space and centers the vertical range. A software
render of a sampled idle pose caught the collapsing original mesh and confirmed
the corrected body proportions. This correction is specific to these uploads.

Geometry is reduced with meshoptimizer permissive seam collapses and a 3% error
budget. The per-file manifest records exact triangle counts and compressed sizes.
Embedded textures and UVs are retained; nine relevant clips are retained per
character. Horizontal hip translation is suppressed at runtime because the server
owns movement. Attacks alternate two clips; block and death use dedicated clips.
Weapons attach to the Mixamo hand bones. Models load progressively with fallback
characters if custom loading fails.

These textures are projected single-view source pictures: rear faces can repeat
front details and some sides are dark. Texture painting/baking is still needed
for finished all-angle art. The software preview is not a WebGL playtest. Physical
Xbox/mobile testing and in-game weapon-grip alignment still require visual QA.
No GPU browser playback is claimed by the automated tests.

To reproduce, extract the updated characters, defense, resources, structures and
weapons archives into a single directory. In scripts/custom-assets run npm ci,
then node prepare.mjs /absolute/path/to/that/directory. This build-time tool is
separate from production dependencies and is not run by Render.
