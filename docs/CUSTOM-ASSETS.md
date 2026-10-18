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

## Equipment and landscape correction

Weapon sizing now uses the longest model extent after orienting the blade upright,
instead of dividing by a possibly tiny Y thickness. Hand attachments compensate
for bone scale after each animation update. The first-person weapon is 0.7 m long,
the shield 0.56 m, and both sit farther from the camera. The shield front faces
outward; a separate wood backing and leather straps face the wearer.

A regression test loads all three actual character rigs and both equipment models,
then checks world-space bounds through idle, running, blocking and attacks.
A second test covers sideways and upright synthetic exports.

The landscape uses shared instanced trunks, branches, rounded canopy clusters,
tapered grass blades and rocks. Ground noise tiles across the terrain with linear
filtering instead of stretching a nearest-filtered texture across an entire region.
Iron and medicine models now appear alongside supply caches and disappear when
that cache is collected. They represent the existing cache contents; rewards have
not changed. The asset manifest now contains eleven integrated models.

Additional class models and siege devices are still inactive; they require their
own gameplay behavior. The complete supplied castle mesh is not substituted for
the modular castle because its interior must first match navigation/collision.
In-browser visual playtesting remains necessary; numeric size tests do not certify
texture quality or final weapon grip appearance.

## Armory and competition polish pass

Five supplied weapon models now have server-authoritative equipment and distinct damage, reach, stamina, recovery and attack cones. Blue weapon racks unlock a shared fellowship armory; a starter warhammer is at (-3,30), and castle racks distribute all remaining types. R / Xbox LB cycles unlocked equipment; I or the Armory button opens accessible stat cards. Late joiners inherit unlocks; equipment is individual and retained on reconnect. Two-handed weapons hide shields and use weaker frontal parries. Switching cannot reset attack recovery. Weapon meshes change in first person and on remote actors. Loaded GLTF promises are shared to avoid duplicate downloads.

Four additional models add about 1.44 MB compressed, each under 4,000 triangles. Forty-six automated tests cover discovery, ownership, forged commands, reconnects, remote equipment, attack stats, occlusion, controller edges and actual mesh bounds in animation. Exact vertex bounds are used for long weapons because rotated bounding boxes substantially overestimate their extent.

Still required before calling this competition-ready: dedicated polearm/hammer/two-handed animations (currently reusing supplied sword clips), authored castle/village environments with matching collision, remaining defensive equipment with useful mechanics, richer audio and encounters, and an end-to-end visual/controller/mobile performance playtest. Not all supplied assets are active. No claim of GPU visual verification is made.
