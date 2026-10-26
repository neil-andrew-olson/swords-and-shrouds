# Iteration cycle 2026-10U — Results (AAA loop, cycle 18)

Eighteenth cycle — roadmap milestone B (content depth): a **Shroud Stalker** flanking harasser and a
**two-phase Shroud Warden** boss fight, plus a production-safe QA-only enrage path to make the
phase-2 verification deterministic. Final bundle `index-Bnc8c7Xv.js` (986,604 B), deterministic with
source freshness.

## 1. Shroud Stalker — fast harasser (server-authoritative)

- Kind corrupted `stalker:true`, name **'Shroud Stalker'**, HP 62 (difficulty-scaled), light armour,
  speed 5.2; reuses the existing undead rig (no new asset).
- **Flanking AI**: picks a player, orbits at ~7.5 m to approach from the side/back, then commits to a
  **0.45 s telegraphed windup** (`stalkerWindup`, event `A Shroud Stalker closes in!`), a **0.32 s
  lunge dash** (event `Shroud Stalker lunges!`) for **18 damage** (wall-checked; event
  `A Shroud Stalker rakes <name>!` on connect only), 2.5 s cooldown, melee fallback under 2.6 m.
- Spawns: **2 wild stalkers** from game start near the nest approach + **2 per siege index ≥3**;
  counters `stats.stalkers` / `stats.stalkerLunges` reset on restart; co-op synced; no exploits.
- Presentation: pale green-violet rig tint + dark-violet emissive (restored on death), faint aura
  ring, **bright 0.45 s lunge-windup ring** via the shared pooled InstancedMesh (≤1 draw while
  visible, 0 idle, static under reduced motion), 1.25 m-stride sprint dust trail; hooks
  `__ssStalkers()` (count/ids/distances/stalkerLunges/lungeWindup), `__ssStalkerFx()`,
  `__ssTriggerStalkerFx('lunge'|'hit')`.
- Audio/captions: lunge snarl/whoosh + pounce/hit cue, `__ssAudioState().cues.stalkerLungeAt/HitAt`
  (+counts), caption **"A Shroud Stalker closes in!"** (server-matching wording), tolerant classifiers.

## 2. Two-phase Shroud Warden

- Phase exposed as `actor.bossPhase` / `siege.bossPhase`; at **≤50 % HP** the Warden **enrages once**:
  exact event `The Shroud Warden howls — the shroud thickens!`, cadence increases (move 3.8 vs 2.9,
  windup .62 vs .95, cooldown 1.5 vs 2.2), and it **summons 2 adds once** (1 Shroud Screamer +
  1 Shroud Caster), guard prevents duplicates; enrage ends on death; co-op synced.
- Presentation: aura radius ×1.35 / opacity .62, colour shifts crimson `#8f2a38` → **violet-crimson
  `#a0305a`/`#7a2a5a` tint**, stronger pulse + pooled embers, reverts on death/reset, reduced-motion
  static; `__ssBossVisual().phase` exposed; HUD boss bar shows **FRENZIED**.
- Audio/captions: enrage howl cue, `wardenEnrageAt` (+count), caption matching the event.
- **QA-only force-enrage (production-safe)**: `qaForceEnrage()` in game.ts + a 2 s room timer set by
  the existing `SS_QA==='1'`-gated `qa-siege` path drops a live boss to 45 % and runs the normal
  enrage; one-shot guard verified (second call returns false, no dupe adds). No client surface.

## 3. Verification (final artifact `index-Bnc8c7Xv.js`, 986,604 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two cleared-cache builds identical + source freshness |
| `validate-assets` | **87/87** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **112/113** (one death-induced harness sample; documented) |
| Perf | **157/159** — 2 fails were the harness's end-of-run forced siege rejected while a prior siege was active (concurrency harness); owner final-hash proof covers phase 2; spawn **184 calls / 1,645,056 tris** (low 149/1,367,728) |
| Mobile | **26/26** |
| Co-op | **22/22** |
| Stalker | roster 2 wilds (+2/siege), windup/FX/cues/caption, counters, flank/wall/co-op by tests |
| Enraged Warden | owner in-game proof on this hash: phase 1→2, FRENZIED, violet-crimson aura, exactly +1 screamer/+1 caster once, howl event/cue |
| Payload / night | **17.53 MiB**; night 56.93 |
| Other | foot-slide 1.11e-16, caster roster/FX/cues, look torso 88.95/limb 70.93, markers, windmill, torch bed, journal/lore/recap/mood/difficulty/wayfinding |

**Deferred (documented):** QA forced-enrage still (prior-siege concurrency in the harness — owner
in-game proof exists on the final artifact), real stalker lunge still (owner forced-index3 run), audio
landmark ear check, physical-device/real-GPU/perceptual playtests, hardware rumble.

## 4. Carried into cycle 19 (roadmap B)

1. **Distinct second boss encounter** with its own arena/phases (e.g. a nest-mother/bone-colossus)
   per the roadmap, reusing the multi-phase infrastructure from the Warden.
2. Close the remaining harness capture gaps (enrage still with a clean harness sequence).
3. Human/device debts: audio landmark ear check, real-GPU/perceptual/mobile hardware, hardware rumble.
4. Then progression/meta systems (roadmap C) and more world content.
