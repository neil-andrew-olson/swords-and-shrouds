# Iteration cycle 2026-10O — Results (AAA loop, cycle 12)

Twelfth cycle of the standing AAA loop. Cycle 11 (`docs/BATCH-2026-10N-RESULTS.md`) added difficulty
modes and boss presentation at 183 calls / 1.64 M tris. Cycle 12 deepens the campaign content: an
unlockable **chronicle/lore** system, a **run recap with epilogue**, a new **Shroud Screamer** enemy
behaviour, **victory/defeat world mood**, and closure of the difficulty-snapshot debt. Final bundle
`index-Do2oPJz3.js` (940,645 B), deterministic across two builds, with an explicit
source-vs-artifact freshness gate.

## 1. Chronicle / lore (16 entries)

- `src/shared/lore.ts`: 16 short entries across the three regions, key castles, survivors, the plague
  nest, the Shroud Warden, weapon lineages, Warden difficulty and both endings; each has a pure
  `condition(LoreState)` derived from campaign state (castles held, survivors, camps, sieges, nest
  sealed/vulnerable, boss seen/killed, weapons recovered, difficulty, victory, defeat).
- Journal gains a **Chronicle** section: unlocked entries with title/text, locked entries as
  “Unrecorded — …” with hints. A single “New chronicle entry: <Title>” toast fires per unlock, ids are
  persisted (`ss-lore`) before the toast so reloads never re-fire; `__ssLore()` hook and a
  display-only `__ssLorePreview(early|mid|late)` for deterministic captures.
- Tests inside the existing feedback block only (58 preserved): unlock matrix, known-set dedupe, toast
  formatting, locked/persisted views.

## 2. End-of-run recap + epilogue

- Victory/defeat result screen gains `#runRecap`: 8 authoritative rows (Time played, Castles x/9,
  Survivors x/9, Camps x/9, Sieges survived, Bosses felled, Difficulty, Weapon), outcome epilogue
  text (victory hearths / defeat “The last fire fades.”), and the existing working “Begin again”
  restart; scrollable and mobile-safe.
- Pure tested `deriveRunRecap`/`formatRunTime`; `__ssRecap()` and display-only
  `__ssRecapPreview(victory|defeat)`; the recap hides/clears when the game returns to playing.
- New authoritative counters from the server feed it: `stats.bossesSeen`, `stats.bossesFelled`,
  `stats.screamers`, `stats.screams` (reset on restart).

## 3. Shroud Screamer (server enemy behaviour)

- One **Shroud Screamer** spawns per siege at index ≥3 (deterministic, independent of players/
  difficulty): kind corrupted, `screamer:true`, light armour, alternating `fallen`/`skeleton-armoured`
  appearance (corrupted actors can now explicitly render the armoured silhouette), HP 72–90 by index
  (difficulty HP scaling applies), as an extra actor so wave size is unchanged.
- First aggro (non-hostile within 30 m) fires once: radius-32 noise + event “A Shroud Screamer
  shrieks — the dead answer its call!” + `stats.screams`; `screamerAlerted` prevents dupes; counts as
  corrupted for every rule; co-op sync verified (same id/name/appearance/HP on both clients).
- Owner sim: indices 1–2 zero screamers / 3–5 exactly one; shriek sim `{screams 0}→{screams 1, noise
  radius 32, exact event}` and no repeats over 25 ticks; balance unchanged.

## 4. Victory/defeat world mood

- `updateMood()` blends existing grade/fog/exposure paths only (no new post chain/draws/textures):
  **victory** → gentle desaturation ×0.9, exposure +0.07, clearer air, warm golden fog `#d9c089`;
  **defeat** → muted cold grade ×0.8, exposure −0.14, heavier fog +0.011, crimson-ash fog `#5a2a32`;
  normal/restart fades back to the regional grade. Reduced motion snaps with no oscillation (also
  honours live `prefers-reduced-motion`).
- QA hooks `__ssMood()` / deterministic `__ssSetMood('victory'|'defeat'|null)`.

## 5. Verification debt

- **Difficulty snapshot debt fixed:** `snapshot()` now always emits explicit `difficulty`
  (`g.difficulty ?? 'knight'`), so default/legacy rooms no longer read null — QA gate now confirms
  `lastState.game.difficulty === 'knight'` for default rooms and `'warden'` for warden rooms.
- QA harness: fixed the `bossReducedFx` probe-scope bug; added a **source-vs-artifact freshness gate**
  (cycle-11 lesson) which passed (newest src 19:53:23 < artifact 19:57:14).

## 6. Verification (final artifact `index-Do2oPJz3.js`, 940,645 B)

| Gate | Result |
| --- | --- |
| `npm test` | **58/58** |
| `tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24) | green, two consecutive builds identical hash |
| Source freshness | PASS (sources older than artifact) |
| `validate-assets` | **82/82** |
| Fresh-build smoke | **27/27** + exact hash + freshness, 0 errors/404s, 11 cards |
| Characters/elite | **115/115** |
| Perf | **114/114** — spawn TP **183 calls / 1,635,356 tris**, low tier green |
| Mobile | **25/25** |
| Co-op | **22/22** |
| Chronicle/recap/mood | PASS (16 entries, 8-row recaps + epilogues, distinct victory/defeat moods, reduced-motion) |
| Payload / HUD | ≈**17.55 MiB**; click→HUD 157 ms, join ~3.7 s |

## 7. Carried into cycle 13

1. Warden-mode-specific forced-boss authoritative screenshot (owner sim/co-op cover the mode).
2. QA forced Screamer spawn/shriek capture and normal forced-siege-after-resolve capture (owner sim
   covers behaviour; may need a QA stop/cleanup hook).
3. Near-forge/chapel audio-level human ear check.
4. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
5. Further content/campaign depth and enemy variety.
