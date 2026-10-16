# Three Kingdoms

The map now contains three regions of comparable extent (240 meters each north–south) with three castles and three survivor camps per region: Green March, Ashen Moor, Frozen Crown. The final nest is at the northern end. Ground colors, scenery distribution, region HUD and map bands distinguish the regions.

Holding all castles in one region awards 40 wood/20 iron once, then 24 wood/12 iron/2 medicine per uninterrupted minute of control. It also reduces castle artillery reload from 4.5 to 3 seconds. Losing a castle pauses regional benefits; reclaiming restores them without repeating the conquest bounty.

Each captured castle operates an automatic catapult: 34-meter detection radius, 0.7-second flight, 4-meter blast radius, 42 damage plus 12 per upgrade level. Shots are authoritative, have visible trajectories, only damage undead, and stop dealing damage after their castle falls. Free Kenney catapult art replaces the previous decorative ballista placement.

Barricades intercept hostile movement and must be destroyed before the gate. Defense attack selection now precedes chasing an interior target, fixing the bypass. Friendly troops pass through their defenses. Friendly-banner travel is available through Camp management outside sieges and nearby combat, and carries following companions.

Skeleton enemies lose an arm when a player sword hit leaves them at half health or less; each lost arm reduces damage by 40 percentage points, with a 25% minimum. Finishing player sword hits sever the head. This applies to skeleton enemies, not armored humans/corrupted knights. Detached geometry is baked from the animated pose, falls with gravity, expires after four seconds and is capped at 48 pieces. Gameplay dismemberment flags are server-owned and replicated.

Animation changes: attacks blend over idle/walking instead of forcing running legs; repeated attacks use serial numbers so clips restart reliably; armor adjusts locomotion playback; procedural block and hit-reaction overlays; remaining-arm motion after losing the attack arm. Faraway characters skip rig updates. Torch lights are limited to the local area.

Validation: 35 tests and production build pass, including expanded world bounds, regional reward/loss/reclaim, barrier interception during pursuit, artillery damage/ownership, dismemberment combat effects and safe travel. WebGL visual and physical-controller playtesting remain outstanding. No purchases or paid assets.
