# Iteration cycle 2026-10N — Results (AAA loop, cycle 11)

Eleventh cycle of the standing AAA loop. Cycle 10 (`docs/BATCH-2026-10M-RESULTS.md`) added the
campaign journal, wayfinding and siege bosses at 183 calls / 1.64 M tris. Cycle 11 adds
**player-facing difficulty modes**, **boss presentation** (HP bar + world aura/scale/tint), a
balance pass backed by headless bot sims, and closes most of the remaining QA verification gaps.
Final bundle `index-DuBFiyZ8.js` (927,007 B), deterministic across two builds.

## 1. Difficulty modes (server-authoritative)

- New `src/shared/difficulty.ts` presets with clear identities; multipliers apply only to **enemy
  damage dealt**, **enemy max HP** (incl. bosses/named enemies) and **siege wave size**; player
  damage/stamina are untouched so combat feel stays constant:

| id | label | enemy damage | enemy max HP | siege wave | identity |
| --- | --- | --- | --- | --- | --- |
| `squire` | Squire | ×0.75 | ×0.85 | −2 | forgiving |
| `knight` | Knight (default) | ×1.00 | ×1.00 | 0 | intended |
| `warden` | Warden | ×1.30 | ×1.15 | +2 | hard |

- Room creation accepts a validated `difficulty` (`{type:'create', name, code, difficulty?}`); joiners
  ignore their own value and inherit the host's; unknown values clamp to Knight; there is no
  post-create change path beyond a host restart which preserves the mode. Snapshots expose
  `game.difficulty`; multipliers are applied at spawn (hostile HP), hurt (hostile attacker) and siege
  wave sizing (`max(4, min(14, 6+2·sieges+2·(players−1)+boss+waveBonus))`); `siege.bossHp` exposes
  the actual spawned boss HP (index-2 boss: 204 / 240 / 276).
- **UI:** landing picker (Squire/Knight/Warden + descriptions, persisted `ss-difficulty`), HUD badge
  (with `· HOST` for joiners), journal difficulty line; `__ssDifficulty()` hook.
- Balance sim (2 bots, flamberge; damage = total player HP lost):

| siege | Squire | Knight | Warden |
| --- | --- | --- | --- |
| index 1 normal | dmg 161, wave 6 | dmg 280, wave 8 | dmg 381, wave 10 |
| index 2 first boss | dmg 161, boss 204, wave 9 | dmg 280, boss 240, wave 11 | dmg 381, boss 276, wave 13 |
| index 9 final boss | dmg 280, boss 234 | dmg 358, boss 275 | dmg 560, boss 316 |

All sieges resolve with the castle held in every mode; Squire meets the acceptance (first boss leaves
≥1 bot alive) without extra tuning; Knight keeps the heavy index-2 moment; Warden is clearly hardest
(+36 % damage taken vs Knight on index 1/2, +56 % on the final boss). Alive-count is noisy because the
simple bots never block/heal, so damage is the hardness metric.

## 2. Boss presentation

- **HUD boss bar:** `#bossSiegeBar` with banner ("BOSS SIEGE · <castle>"), name ("SHROUD WARDEN"),
  segmented HP track, HP numbers and phase (STEADY/FRENZIED/FINAL); visible only while a living boss
  siege is active, hidden on death/resolve; legacy `#bossBar` suppressed during boss sieges; body
  class `boss-siege` drives the portrait layout that hides objectives/resources so there is no
  overlap; reduced-motion safe; `__ssBossBar()` hook. (The `body.boss-siege` toggle was a one-line
  post-freeze fix; the Lead gate rebuilt the artifact after detecting it, verified the toggle is in
  the final bundle, and discarded the earlier hash.)
- **World presentation:** boss actors render at **1.15×** scale with a crimson silhouette tint
  (`#8f2a38`) and a single additive crimson ground aura ring (`#b43a4a`); aura pulses gently in
  normal motion, is calmed/static under reduced motion, and hides + restores tint on boss death or
  siege end. Exactly **+1 draw while a boss is active**, 0 otherwise, no new textures/lights,
  allocation-free; `__ssBossVisual()` hook.
- QA: boss bar name/HP/segments/phase/banner verified during a forced boss siege, hidden before/after,
  `body.boss-siege` present; `__ssBossVisual()` scale 1.15/aura/tint/actorId == siege.bossId;
  reduced-motion variant captured; boss vs normal screenshots.

## 3. QA gap closure

- Audio landmark beds: harness now polls `__ssAudioState()` up to ~3 s after `__ssAudioFocus(x,z)`;
  headless run recorded 0 (owner harness measures 0.024/0.016) — **ear check remains human debt**.
- Journal hotkey `J` and Guide-open/close paths now captured and passing.
- Forced **normal** siege after a boss siege remains deferred (server refuses while a siege is
  active, no stop hook); covered by owner game/multiplayer tests. Production has no `SS_QA`, so live
  force-siege is inert by design.

## 4. Verification (final artifact `index-DuBFiyZ8.js`, 927,007 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash (rebuilt after the post-freeze boss-siege toggle fix) |
| `validate-assets` | **82/82** |
| Fresh-build smoke | **26/26** + exact hash reproduction, 0 errors/404s |
| Perf | **104/104** — spawn TP **183 calls / 1,635,392 tris**, low 143/1.364 M |
| Mobile | **25/25** (picker/boss bar/journal layouts) |
| Co-op | **21/21** (difficulty inheritance/authority, boss sync) |
| Characters | **103/105** — the two failures were harness-only reads of the legacy `#bossBar` and a delayed `__ssBossVisual()` read, fixed afterwards and passing in perf 104/104; no character body gate failed |
| Difficulty/boss presentation | passed (Squire/Knight/Warden UI+state+co-op; boss bar/aura/tint/reduced motion) |
| Payload / HUD | **17.54 MiB**; click→HUD 157 ms, state 2.535 s, join 3.545 s |
| Regression | live baseline **26/26** (production SS_QA gate defers force-siege), 11 cards, 0 errors/404s |

## 5. Carried into cycle 12

1. Warden-mode forced-boss authoritative screenshot (owner sim + co-op state cover the mode today).
2. Near-forge/chapel audio-level human ear check; forced normal-siege capture if a stop hook is added.
3. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
4. Content/campaign depth and more enemy variety; further first-boss tuning from human play.
