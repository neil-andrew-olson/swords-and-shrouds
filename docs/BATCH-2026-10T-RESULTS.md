# Iteration cycle 2026-10T — Results (AAA loop, cycle 17)

Seventeenth cycle — roadmap milestone A close-out (sprint foot-slide fixed) and milestone B start:
the **Shroud Caster**, our first ranged enemy with projectile AI, telegraph, FX, cues and captions.
Final bundle `index-EHFLh_ew.js` (976,975 B), deterministic with source freshness.

## 1. Foot-slide recalibration (closed)

- Cycle-16 clamp left `slideFactor .411` at the real full run speed of 8. Recalibrated
  `runTimeScaleFor`: stride light **5.925** / heavy **5.08**, clamp **0.6–1.6**.
- Helper table: 2→ts .600/slide .437 (low-speed clamp, still animates sensibly), 4.2→.709/0,
  6→1.013/0, **8→1.350/0**, 10→1.600/.054; heavy 8→1.575/0. Movement speed unchanged.
- **In-game proof**: `__ssAnimState()` at real full run = `{speed:8, runTimeScale:1.3502109705,
  slideFactor:1.11e-16}` → passes the ≤.06 gate. Capture `ingame-caster-run.png`.

## 2. Shroud Caster — ranged corrupted enemy (server-authoritative)

- Kind `corrupted`, `caster:true`, name **'Shroud Caster'**, HP 88 (difficulty-scaled), light armour,
  fallen/skeleton-armoured appearance; deterministic spawns: **2 nest guards** + **1 per siege index
  ≥2** at the siege approach; counters `stats.casters` / `stats.casterBolts` reset on restart.
- AI: seeks line-of-sight at **10–20 m**, **1.0 s telegraph** (`casterCharge` + event
  `A Shroud Caster gathers shadow!`), then fires a **speed-8.5 shadow bolt** at a lead-predicted
  position (**16 damage**, cooldown 3 s, melee fallback under 6 m). Bolts live in
  `game.projectiles[]` (`{id,caster,kind:'shadow-bolt',x,z,px,pz,dx,dz,tx,tz,speed,damage,firedAt,
  hit?,hitAt?,hitId?}`), updated each tick, wall-checked (`hit:'wall'`), actor collision
  (`hit:'actor'`), ground/miss (`hit:'ground'`), retained 0.2 s for FX, co-op synced.
- Events: gather / `Shadow bolt!` / `Shadow bolt strikes <name>!` / wall fizzle / ground scatter.
- Client presentation (`scene.ts`/`effects.ts`): pooled **InstancedMesh telegraph ring** under each
  caster (faint violet aura idle, bright pulsing while charging; static under reduced motion; 1 draw),
  pooled **violet bolt orb + additive trail** following authoritative `x/z` (1 draw while active),
  **impact sparks/smoke + ground scorch** for actor/ground hits and sparks-only dissipate on walls;
  violet caster tint distinct from the crimson boss. Hooks `__ssCasters()`, `__ssProjectiles()`,
  `__ssCasterFx()`, `__ssTriggerCasterFx('telegraph'|'bolt'|'impact')`.
- Audio/captions (`ambience.ts`/`controller.ts`/`main.ts`): **charge cue** (rising sine + whisper
  sweep matching the 1 s telegraph, rate-limited across casters), **launch whoosh/thump**,
  **impact thud**; cue state in `__ssAudioState().cues` (`casterChargeAt/LaunchAt/ImpactAt` + counts,
  recorded even when muted); captions "A Shroud Caster gathers shadow." / "Shadow bolt!" via the
  existing caption system; `__ssCasterAudio(...)` QA helper.
- Balance sim (2 flamberge bots): index 2 resolved 32.6 s/castle held/alive 2/3 casters/7 bolts;
  index 5 37.1 s/alive 2/8 bolts; index 9 73.5 s/alive 1/15 bolts.

## 3. Verification (final artifact `index-EHFLh_ew.js`, 976,975 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two cleared-cache builds identical + source freshness |
| `validate-assets` | **87/87** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **108/109** (one death-induced harness sample/timing; new gates all green) |
| Perf | **153/153** — spawn **158 calls / 1,622,187 tris**, high 188/1,646,952 |
| Mobile | **26/26** |
| Co-op | **22/22** |
| Foot-slide | slideFactor 1.11e-16 at speed 8 (≤.06) |
| Caster | spawn roster/counters, telegraph state, FX trigger stills + `draws`, audio cue counts, captions, reduced-motion static |
| Payload / night | **17.52 MiB**; night 56.93 |

**Deferred (honest):** real forced-siege telegraph→bolt→hit *stills* — the headless siege caster
stayed out of LOS for >30 s; behaviour is covered by server tests/sim and the deterministic FX trigger,
not claimed as a full happy-path capture. Also audio landmark ear check, physical-device/real-GPU/
perceptual, hardware rumble remain human/device debts.

## 4. Carried into cycle 18 (roadmap B)

1. **Shroud Stalker** — fast flanking harasser with telegraphed lunge (existing rig; server AI +
   FX/cues) — spec written in `docs/BATCH-2026-10U-SPEC.md`.
2. **Two-phase Shroud Warden** — enrage at 50 % HP, aura intensifies, summons adds once, HUD phase
   change (FRENZIED), co-op synced.
3. Then a fully distinct second boss encounter (phases/arena) in cycle 19.
4. Human/device debts continue to be tracked.
