# The Gathering Fog

Original implementation informed by public design material, with no decompiled game binaries, extracted commercial assets or proprietary game code.

References:
- Michael Booth, Valve, The AI Systems of Left 4 Dead (2009): https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
- Project Zomboid's public WorldSoundManager API: https://projectzomboid.com/modding/zombie/WorldSoundManager.html

Implemented rules:
- Fog begins at 12 meters and becomes opaque at 48. Remote characters and survivor world labels are also hidden beyond fog range. Map/quest directions remain navigation aids. No camera mode is forced.
- Sword attacks cost 18 stamina and emit noise within 22 meters. Sword Sweep (Q / Xbox B / screen button) costs 40, deals 48 damage within 4.5 meters, respects walls, and recovers in 7 seconds. Blocking drains 22 stamina/sec. Rest restores 18/sec in light armor, 10/sec in heavy armor. Heavy armor reduces incoming damage 30% and movement from 6 to 4.8 meters/sec. Armor can be changed for free at a friendly castle.
- Undead acquire nearby visible targets and investigate recent noise through castle entrance waypoints. Noise events expire and are capped at 24. NPC sword clashes and attacks on fortifications generate noise too.
- A fallen human has 12 seconds to be revived by 3 uninterrupted seconds of nearby interaction. A following companion can help if threats within 5 meters are cleared. An expired rescue spawns one named 220-HP corrupted knight; the human respawns eight seconds later. Fallen soldiers retain their seven-second corruption rule.
- Existing siege warnings remain 30 seconds. Horde size scales from 6 by campaign progress and connected players, capped at 14. After a siege, the next warning is 120–180 seconds away, based on team health. Existing enemies remain active during recovery; this is simple adaptive pacing, not a full recreation of Valve's Director.
- Friendly markers, stronger boss silhouette, white hit flashes and cosmetic recoil improve combat feedback. Imported CC0 character animation is retained.

Not implemented in this release: item-weight inventory, individual scavenged weapon equipment, crossbow projectiles, destructible limbs, or a top-down camera. Shared resource caches, first/third-person cameras and existing sword/block controls remain the foundation.
