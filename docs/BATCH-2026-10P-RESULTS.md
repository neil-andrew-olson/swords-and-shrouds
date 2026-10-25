# Iteration cycle 2026-10P — Results (AAA loop, cycle 13)

Thirteenth cycle of the standing AAA loop. Cycle 12 (`docs/BATCH-2026-10O-RESULTS.md`) added the
chronicle, recap, Screamer and victory/defeat mood at 183 calls / 1.64 M tris. Cycle 13 is a content
and combat-variety cycle: **new world props**, **new siege audio layers/stings**, the
**shield-bash combat action**, and the deferred capture debt. Final bundle `index-Dwublozr.js`
(950,533 B), deterministic across clean builds from the frozen tree.

## 1. New world props (2 instanced dressing sets)

- Three new assets baked in the night palette (warehouse packs for these specific props were unusable
  as standalones — camp GLB splits into 6,577 loose parts; same procedural precedent as the
  blacksmith stall): `notice_board` (192 tris, 34.1 KB, 2.0 × 2.26 × 0.72 m), `fence_segment`
  (252 tris, 34.5 KB, 2.57 × 1.35 × 0.24 m), `torch_post` (152 tris, 33.7 KB — baked and installed,
  placement deferred to cycle 14 because a third material would exceed the ≤+2 draw acceptance).
- Placed by ruins-builder: **notice board** at (44, −14) on the keep→village walkway (front faces
  the path) and a **3-segment fence run** along the crossing camp's southern edge (27.5/25/22.5,
  −44.x). Two distance-culled instanced layers, receive-only shadows, no new lights, 85 m culling,
  allocation-free, defensive missing-asset skip. Cost **+2 draws / +948 tris** only when visible.
- Validator 85/85; real-shipped-GLB suite 80/80; isolated capture evidence for both sets.

## 2. Audio depth: boss layer, screamer cue, ending stings

- New **boss-siege music layer** (lazily built saw/noise bed) that intensifies while a boss siege is
  active and releases/tears down after; respects Sound toggle and ducking.
- Distinct rate-limited **screamer shriek cue** tied to the server event; short **victory/defeat
  stings** on the recap moment (once per outcome).
- `__ssAudioState()` now exposes `siege:{boss,active,mode,level,gain}` and
  `cues:{screamerAt,screamerCount,sting,stingAt}`; QA-only `__ssAudioSting`, `__ssAudioScreamer`.
- QA verified boss layer engage (.432 → .733 during a forced boss siege) and release, victory/defeat
  sting states, screamer cue contract; no audio errors.

## 3. Shield bash (server-authoritative combat action)

- Client sends raw `{type:'bash'}` on the block+attack chord (mouse RMB+LMB, pad LT+RT, mobile
  **Bash** button). Server validates in order (playing/alive/not downed → bash cooldown → attack
  cd/swing → shield-capable weapon → stamina ≥14 → one front target ≤2.2 m with LOS) and applies:
  stamina −14, 1.1 s bash cooldown, attack-cancel lock, 6 damage, 0.9 s stagger/windup interrupt,
  1.2 m wall-checked knockback, positioned event `Shield bash!`, `stats.bashes++`.
- Rationale: 6 dmg / 14 stamina on a 1.1 s cooldown is far below weapon DPS; the value is the
  stagger/windup interrupt and shove — a defensive opener, not a DPS replacement. Bash counts as an
  action for exploit checks (no bash→attack cancel), works while blocking, cannot hit through walls.
- Client: HUD hint (`#bashHint`), guide hint, journal controls legend for keyboard/controller/touch,
  mobile button with local + authoritative (`bashCd`) cooldown feedback, graceful rejection toasts.
- World FX: one additive shield-arc ground ring + pooled dust/sparks at the contact point, 30 ms
  hit-stop and small shake in normal motion; reduced motion → 120 ms static ring, no hit-stop/shake;
  no double rig flash (damage hit-feedback skips when a bash cue is within 0.3 s/3 m). Exactly one
  extra draw while active. `__ssBashFx()`/`__ssTriggerBashFx()` hooks; the `ss-bash` event is
  single-dispatch (server event → scene FX → audio), after removing a duplicate client dispatch.

## 4. Hash/freshness lesson (process)

Two candidate artifacts existed briefly: `index-DnADE4CG.js` (950,667 B) compiled before audio-polish's
final one-line `ss-bash` dedup, and `index-Dwublozr.js` (950,533 B) from the frozen tree. QA's
independent fresh build reproduced **Dwublozr**; the Lead rebuilt twice with `node_modules/.vite`
cleared (both Dwublozr), confirmed artifact mtime 21:40:16 > newest source 21:39:22, and QA gated
Dwublozr. DnADE4CG was explicitly superseded — this is the cycle-11 freshness lesson applied again.

## 5. Verification (final artifact `index-Dwublozr.js`, 950,533 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | two clean builds identical hash + freshness gate |
| `validate-assets` | **85/85** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **120/123** (3 failures were harness-only audio-timing checks, fixed and green in perf 123/123) |
| Perf | **123/123** — spawn **185 calls / 1,636,132 tris**, low tier green |
| Mobile | **26/26** (bash button, journal, touch) |
| Co-op | **22/22** (bash sync, boss/siege sync) |
| Payload / HUD | **17.63 MiB**; night 52.4; 15 optional views green |

## 6. Carried into cycle 14

1. Warden-mode forced-boss authoritative screenshot; QA forced Screamer capture.
2. `torch_post` placement (asset installed; add to flames/lightless layer).
3. Audio landmark ear check (human).
4. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
