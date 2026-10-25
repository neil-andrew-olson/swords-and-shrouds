# Iteration cycle 2026-10S — Results (AAA loop, cycle 16)

Sixteenth cycle — roadmap milestone A completion: the **body-scan base-atlas tone pass** (finishing
the character close-up look) and the first **animation-depth pass** (foot-slide, weapon-class attack
timing, idle life, death variation, landing reaction) plus **movement VFX** (footstep dust, landing
poofs). Final bundle `index-BWKLWhO3.js` (964,279 B), deterministic with source freshness.

## 1. Body-scan base-atlas tone pass (asset)

- Base body colour atlas only (arms/legs/torso skin+underlayer): **desat 0.74 / warm 1.10 / blue 0.85 /
  value 0.86 / floor 0.03**; face/hand contrast preserved (no crush). Armour atlas **byte-identical to
  v5.1** (verified by hashing every embedded image); prims/skins/clips and body/anim hashes unchanged.
- Measured 2.5 m front: torso means **82.4–90.6** (inside 60–95), torso sat .31–.35; **limbs now darker
  than the torso** (arms −11…−30, legs −18…−23) with limb sat .29–.39 instead of pale grey.
- Strict-mask palette **7/7 ≥801** (templar 1,246 · hero 982 · ally 1,265 · berserker 805 · ranger 839 ·
  survivor 801 · fallen 850); files 726–752 KB; validator 87/87; builder `bake/tone-body-atlas.mjs`.

## 2. Animation-depth pass (client, no new clips/server)

- **Foot-slide**: `runTimeScaleFor(speed, heavy)` = clamp(speed/stride, .6–1.35), strides 4.2/3.6;
  `slideFactorFor` residual exposed. Table: 2→.600/.206, 4.2→1.000/0, 6→1.350/.058, 8→1.350/.411.
  **Honest gap:** real sprint speed is 8, so the upper clamp caps the match and leaves slide .41 at
  full sprint — recalibrate clamp/stride in cycle 17.
- **Weapon-class attack timing** tied to server cooldowns: thrust → `attack_1` (sword .65 s: windup
  169 ms / .507 s; spear 182/.546; rapier 109/.328), cleave/crush → `attack_2` (flamberge 418/.99;
  hammer 483/1.0925; mace 399/.9025; dane 399/.945; zweihander 456/1.08; poleaxe 340/.88; halberd
  357/.924; bastard 336/.76), with anticipation lean + follow-through (reduced-motion safe).
- **Idle life**: spine breathing/weight sway 3.2 s phase, reduced-motion suppressed.
- **Death variation**: deterministic per-actor FNV hash → ±25° corpse yaw, applied once on death and
  reset on revive; crowd variants observed (18, −18, −22, 25, 4, 0, …).
- **Landing/step reaction**: crouch impulse on >2.2 m/s deceleration or hit stagger, exp decay ≤3 cm,
  no gameplay effect, reduced-motion safe.
- QA hooks `__ssAnimState(actorId?)`, `__ssAnimActors()`, `__ssDeathVariants()`; pure helpers tested
  inside the existing equipment block (58 preserved).

## 3. Movement VFX (world)

- Stride-based **footstep dust** on run (1.85 m stride, foot-level pooled puffs, foot-side alternation,
  26 m distance cull), **landing poof** on abrupt stop/knockback (bounded to the local player to avoid
  NPC network-snap spam), skipped entirely under reduced motion, **0 extra draw calls**.
- `__ssMoveFx()` → {steps, landings, active, reducedMotion, draws:0, stride, minDistance};
  `__ssTriggerMoveFx('step'|'land')` for deterministic captures. Real held-run: steps 40→46, landing
  +1; reduced run leaves counters unchanged.

## 4. Verification (final artifact `index-BWKLWhO3.js`, 964,279 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two cleared-cache builds identical + source freshness |
| `validate-assets` | **87/87** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **147/149** (two harness-only death-induced sample timings; owner state evidence green) |
| Perf | **149/150** — spawn **167 calls / 1,619,105 tris**; one synthetic attack-input sampling race (same run observed attack_1/thrust/169 ms) |
| Mobile | **26/26** |
| Co-op | **22/22** |
| Body tone | torso 88.8 in-game, limbs ≤ torso+3, strict-mask 7/7 ≥801 |
| Animation | idle phase advances, attack windup 169 ms (sword), per-class table, death variants varied, reduced-motion suppressed |
| Movement VFX | steps/landings counted, 0 draws, reduced-motion skipped |
| Payload / night | ~17.4 MiB; night 55.96 |

## 5. Carried into cycle 17 (roadmap milestone A close-out → B)

1. **Foot-slide recalibration** (raise clamp to ~2.2 / calibrate stride against real speed 8) —
   the one real gap from the animation pass.
2. **Enemy family #2** (roadmap B): ranged corrupted (projectile AI) + hound-style harasser with
   distinct telegraphs, plus spawn integration and tests.
3. Audio landmark **ear check** (human); physical-device/real-GPU/perceptual playtests; hardware rumble.
4. Then second boss with phases/arena (roadmap B).
