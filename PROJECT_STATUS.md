# Swords & Shrouds — project checkpoint

Updated: 2026-10-26. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep looping toward AAA

The user asked to keep cycling improvements until the game is AAA level, using
`docs/AAA-ROADMAP.md` as the guide. Every cycle: fix visible defects, raise visual fidelity and
performance, verify with the headless QA suite, deploy and verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke + perf capture +
co-op + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys and
verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths. `PROJECT_STATUS.md`,
`docs/*.md` (incl. `docs/AAA-ROADMAP.md`) and screenshots are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. **Always**
re-check source mtimes vs the artifact mtime before handing a hash, and rebuild twice with
`node_modules/.vite` cleared (cycle-11/13/14/18 lessons: post-freeze edits and races produced
superseded artifacts — only gate a hash a clean rebuild reproduces).

## Character PBR + goblin production release (2026-10-26)

- Game implementation: **`e58f38d0376b186d130d6e3b9f5cc1eee99fadc5`**, pushed to `main`.
- Host release: **`1b47a768f25a2a00ec01c498524e4d6786861a50`**, pushed to `main`;
  `game-source.json` pins the exact game implementation above.
- Seven human variants use real Cursed Knight armour/cloth geometry and 360° embedded PBR
  materials: templar, hero, ally, berserker, ranger, survivor and fallen. Class-specific kits,
  palette grading and reduced armour distinguish the silhouettes without new magic.
- Blender 5.2 slot-based retargeting preserves the UE rest orientation, folds twist weights into
  the animated limb bones and removes horizontal root travel. Six clips, one skin and both
  Mixamo hand sockets are present. Triangles range from 7,998 to 14,240 per character.
- Goblin: short, hunched silhouette, olive skin, pointed ears, long nose, brow and worn leather;
  **10,584 triangles**, 1.45 m authored height, existing melee-only simulation and zombie fallback.
  The deterministic enemy appearance mix is `id%5`; no goblin spells, abilities or new actor type.
- Hardening: strict gzip/deflate/XFL=2 asset checks, reduced-motion-safe torch intensity/radius,
  removed duplicate smoke/mote updates. Scanned roads, modular ruins/keeps, courtyard props,
  11-weapon arsenal/racks, instanced grass/rocks and existing atmosphere/combat audio remain integrated.

### Verification on the exact game commit

- Clean detached worktree: `npm ci`, **58/58 tests**, `tsc --noEmit`, **88/88 asset checks**,
  two fresh production builds. Goblin is 389,255 B; SHA-256
  `6b6214dd7b0e3b31c8f6a7a3ae76758ba4827fdcd08c721b1baea38b528f85e5`.
- Root game bundle **`index-BLOa6N0t.js`**, 998,941 B; SHA-256
  `fa670c5ba74f3f69b73c78a4fb69f41596a96a6106739f510ce604c260d4a493`.
  Game assets total 20,753,583 B (~19.79 MiB).
- Production world QA **45/45**, two-client co-op **22/22**, perf-lite **56/56**.
  Exact-commit focused browser QA: **14 captures**, seven human variants, all five enemy
  appearances, goblin availability/fallback, hit feedback/reduced motion and real melee; zero page errors.
- Host Vite + clean pinned game build and Wrangler dry-run pass. Local Durable Object runtime:
  website/assets, origin rejection, room creation, movement, shared equipment, late join,
  locked-weapon rejection, reconnect, isolation and four-player capacity all pass.
- Hosted game bundle **`index-CKLQSgLk.js`**, 999,116 B; SHA-256
  `8dc87512a24a5b1afd95bb5852497ce6b28a82eaecb2e049aa63b3284ee19169`.
- **Live deployment: BLOCKED at rollout verification.** Live multiplayer assertions pass on the
  existing backend (origin checks, rooms, movement, weapon sharing, reconnect, isolation/capacity).
  More than 15 minutes after the host push, the goblin URL still returns 404 and the served bundle
  is the previous `index-DIThYzGd.js`, not the verified `index-CKLQSgLk.js`. No Cloudflare API token
  is available to inspect/retry the remote build; public repository check endpoints return 404.

### Limits and next work

- This is a browser-budgeted, Skyrim-inspired materials/silhouette upgrade, not a claim of
  exact Skyrim/AAA fidelity. Physical GPU, controller, audio and touch-device checks remain.
- The broad main-tree feature harness timed out after 20 minutes and reported two failures in
  unrelated, uncommitted cycle-20 journal-preview work. Those edits were not included in this release.
  Focused release gates above are green; keep unrelated local changes separate.
- GitHub warns that the pre-existing `scripts/smoke-browser.mjs` is 84.03 MB. Only the required
  QA hunks were committed. Existing dependency audit advisories were not auto-upgraded.
- Next: inspect Cloudflare Workers Builds/deployment access, publish the pinned host release,
  verify the live goblin/bundle in a browser, then continue separately owned cycle-20 work.

## Cycle 19 (2026-10V) — Shroud Colossus second boss

Final bundle **`index-tknOtxLM.js`** (998,421 B). Contract `docs/BATCH-2026-10V-SPEC.md`, results
`docs/BATCH-2026-10V-RESULTS.md`. Roadmap milestone B.

### Shroud Colossus (distinct second boss, server-authoritative)
- Alternation documented: Colossus when boss siege `index%4===0` (4, 8, 12), Warden otherwise;
  `siege.bossKind/bossName/bossPhase/bossHp` exposed. HP **420** difficulty-scaled, heavy armour,
  speed 2.2, `colossus:true`.
- **Ground slam**: 1.4 s telegraph at `slamTarget` (0.95 s phase 3, event
  `The Shroud Colossus raises its fist!`) → **radius 5.5 / 34 dmg**, wall-checked (stone event),
  impact event `The Colossus splinters the earth!`.
- **Corruption pools**: `game.hazards[]` `{id,x,z,radius:4.5,expiresAt:+12 s,damagePerSecond:6}`,
  max 6, co-op synced, pooled dark-violet decals with slow pulse (static reduced-motion).
- **Phases**: p2 ≤66 % (`The Shroud Colossus roars — its hide splits!`) faster cadence + summons
  2 Stalkers once; p3 ≤33 % (`The Shroud Colossus cracks the earth — no mercy remains!`) speed 2.8,
  shorter telegraph, occasional double slam; one-shot guards; counters `stats.colossi/slams/pools`.
- Presentation: 1.6× scale, violet-green aura `#5f9f7f` → phase-3 `#6a4a9a`, rig tint
  `#4f7a5f` → `#5f3f7a`; HUD bar per-boss name/phase (FRENZIED); `__ssBossVisual()` reports scale/phase.
- Hooks `__ssColossus/__ssHazards/__ssColossusFx/__ssTriggerColossusFx`; audio cues
  `colossusChargeAt/SlamAt/PhaseAt` + captions; sims index4 78 s (castle held, 5 slams/5 pools),
  index8 59.8 s, index12 82.6 s — all winnable.

### Fixes from cycle-18 review
- **HUD boss-bar overlap**: `#bossSiegeBar` z-index 10000 above wayfinding markers, backdrop,
  non-wrapping phase-coloured FRENZIED/FINAL label; `#siege`/`#objectiveLine`/marker layer suppressed
  during boss sieges; desktop 520×79 and mobile 340×71 verified.
- **Teal-quad artifact**: caused by flat cloth planes (captured castle flag + courtyard banner cloth),
  not aura geometry — flags now use a generated heraldic cloth texture at y 4.35 and banner cloth is
  muted/roughened; banners read as cloth.

### Verification
- 58/58 tests; tsc 0; deterministic `index-tknOtxLM.js` + freshness; validator 87/87.
- QA: fresh smoke 27/27, characters **117/118**, perf **163/164** (both one death-induced
  controller-hints timing + post-death timeout; all new gates green), mobile 26/26, co-op 22/22,
  live baseline 34/34; spawn **187 calls / 1,646,274 tris** (high sample), payload **17.54 MiB**;
  night 55.65; Colossus hooks/trigger stills/pools/phase evidence owner-verified on this exact dist.
- Deferred (documented): QA forced Colossus phase2/3 + slam happy-path stills (owner in-game
  evidence), boss-bar DOM sampled outside an active event (owner screenshots), audio landmark ear
  check, physical-device/real-GPU/perceptual, hardware rumble.

### Cycle-20 (next) — roadmap C
1. **Progression/meta systems**: weapon/armour upgrade tiers at camps, crafting/resource sinks,
   cross-run unlocks (meta progression), New Game+ modifier.
2. Close capture gaps with a clean harness sequence (forced-phase helper if useful).
3. Human/device debts; continued world/content polish.

## Previous cycles

- **2026-10U cycle 18**: Shroud Stalker flanking harasser + two-phase Warden (enrage, FRENZIED,
  adds) + production-safe QA force-enrage (`docs/BATCH-2026-10U-RESULTS.md`).
- **2026-10T cycle 17**: sprint foot-slide recalibration + Shroud Caster ranged enemy
  (`docs/BATCH-2026-10T-RESULTS.md`).
- **2026-10S cycle 16**: body-atlas tone pass, animation-depth pass, movement VFX
  (`docs/BATCH-2026-10S-RESULTS.md`).
- **2026-10R cycle 15**: armour atlas v5.1 + look-pass v5; Warden/Screamer capture debt closed
  (`docs/BATCH-2026-10R-RESULTS.md`).
- **2026-10Q cycle 14**: windmill/sails, torch-lit roads/ambience; character look hotfix; AAA roadmap
  (`docs/BATCH-2026-10Q-RESULTS.md`).
- **2026-10P cycle 13**: camp props, siege audio layers/stings, shield bash
  (`docs/BATCH-2026-10P-RESULTS.md`).
- **2026-10O cycle 12**: chronicle lore, recap+epilogue, Screamer, victory/defeat mood
  (`docs/BATCH-2026-10O-RESULTS.md`).
- **2026-10N cycle 11**: difficulty modes, boss HP bar + aura/scale/tint, balance sims
  (`docs/BATCH-2026-10N-RESULTS.md`).
- **2026-10M cycle 10**: campaign journal, wayfinding overlay, siege bosses, QA force-siege
  (`docs/BATCH-2026-10M-RESULTS.md`).
- **2026-10L cycle 9**: War Spear (11th), ruined abbey, hit-flash hold, audio diagnostics
  (`docs/BATCH-2026-10L-RESULTS.md`).
- **2026-10K cycle 8**: mobile/touch HUD, device-aware quality, enemy preview, hit feedback
  (`docs/BATCH-2026-10K-RESULTS.md`).
- **2026-10J cycle 7**: enemy variants, strict-mask palette 7/7, content captures, plague dressing
  (`docs/BATCH-2026-10J-RESULTS.md`).
- **2026-10I cycle 6**: Wandering Survivor, rumble/hints, reduced-motion fix, cloth wind
  (`docs/BATCH-2026-10I-RESULTS.md`).
- **2026-10H cycle 5**: armour v3 + survivor identity, snowstorms, combat feel, surface audio
  (`docs/BATCH-2026-10H-RESULTS.md`).
- **2026-10G cycle 4**: armour v2, weather + weather audio, tone/HUD, wells/stalls
  (`docs/BATCH-2026-10G-RESULTS.md`).
- **2026-10F cycle 3**: regional identity, foliage/ruins, elites, fire/smoke, region audio
  (`docs/BATCH-2026-10F-RESULTS.md`).
- **2026-10E cycle 2**: character material v2, quantised-ruin fix, trees/shadows, adaptive audio
  (`docs/BATCH-2026-10E-RESULTS.md`).
- **2026-10D cycle 1**: fixed blacked-out characters, shadows, 301→173 calls, LODs, doc links
  (`docs/BATCH-2026-10D-RESULTS.md`).
- Earlier batches: performance & smoothness, combat/arsenal/co-op QA, battlefield overhaul
  (`docs/BATCH-2026-10*-*`); asset pipeline in `docs/ASSET-PIPELINE.md`.

## Hosting / deployment

- Hosting repo: `C:\Users\neil\Desktop\AIprojects\neilandrew.dev` (branch `main`), pin in
  `game-source.json`; `scripts/build-game.mjs` fetches the pinned commit, `npm ci`, builds the client
  under `/games/swords-and-shrouds/`. Cloudflare Workers Builds deploys on push.
- Build locally with bundled Node v24.21.0
  (`C:\Users\neil\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`; prepend its
  dir to PATH), then `& $node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
  in the hosting repo. System Node 22.11 is below Vite 7's floor.
- Because the hosting build can leave `.game-build` in detached HEAD, always `git checkout main`
  (and fast-forward `main`) before committing docs.

## Continuity procedure

After each cycle, commit the changes and update this file with: the exact implementation commit,
branch and changed behavior; the checks actually run and their results; remaining defects and the
next concrete task; and hosting pin / deployment status, keeping source and live verification
separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Execute the next cycle in the AAA loop. Update the checkpoint."
