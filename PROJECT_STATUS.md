# Swords & Shrouds — project checkpoint

Updated: 2026-10-24. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Standing objective — keep iterating to AAA quality

The user asked to keep cycling improvements until the game is AAA level. Every cycle: fix visible
defects, raise visual fidelity and performance, verify with the headless QA suite, deploy and
verify live. Never relax these gates:
`npm test` **58/58** (extend tests in place only), `npx tsc --noEmit` 0 errors, `vite build` green
with bundled Node 24, `scripts/validate-assets.mjs` all pass, headless smoke + perf capture +
co-op + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys and
verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. **Always**
re-check source mtimes against the artifact mtime before handing a hash, and when in doubt clear
`node_modules/.vite` and rebuild twice (cycle-11 and cycle-13 lesson: a post-freeze one-line edit
produced two candidate artifacts; QA's independent rebuild caught the mismatch — only gate the hash
that a clean rebuild reproduces).

## Latest completed cycle — 2026-10P cycle 13: props, siege audio, shield bash

Contract: `docs/BATCH-2026-10P-SPEC.md`; results: `docs/BATCH-2026-10P-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-Dwublozr.js` (950,533 B), deterministic across clean builds
from the frozen tree (artifact 21:40:16 > newest src main.ts 21:39:22; superseded pre-dedup candidate
`index-DnADE4CG.js` was rejected).

### New world props

Procedurally authored in the night palette (warehouse camp/props packs unusable as standalones):
`notice_board` (192 tris, 2.0 × 2.26 × 0.72 m), `fence_segment` (252 tris, 2.57 × 1.35 × 0.24 m),
`torch_post` (152 tris, installed; placement deferred to cycle 14 to respect ≤+2 draws). Placed:
notice board at (44, −14) facing the village walkway; 3-segment fence run along the crossing camp's
southern edge. Two distance-culled instanced layers (+2 draws/+948 tris only when visible),
receive-only shadows, no new lights, 85 m culling, defensive missing-asset skip. Validator 85/85;
real-GLB suite 80/80.

### Audio depth

Boss-siege music layer (saw/noise bed) intensifies during boss sieges, releases/tears down after;
distinct Screamer shriek cue tied to the server event; victory/defeat stings on the recap moment
(once per outcome); all respect Sound/ducking. `__ssAudioState()` exposes
`siege:{boss,active,mode,level,gain}` and `cues:{screamerAt,screamerCount,sting,stingAt}`; QA triggers
`__ssAudioSting`/`__ssAudioScreamer`. QA verified engage (.432→.733) + release, stings, cue contract.

### Shield bash (server-authoritative)

Client `{type:'bash'}` on block+attack chord (mouse RMB+LMB, pad LT+RT, mobile Bash button). Server
validation: playing/alive/not downed → bash cooldown → attack cd/swing → shield-capable → stamina ≥14
→ one front target ≤2.2 m with LOS. On success: stamina −14, 1.1 s bash CD, attack-cancel lock,
6 damage, 0.9 s stagger/windup interrupt, 1.2 m wall-checked knockback, positioned `Shield bash!`
event, `stats.bashes++`. Defensive opener, not DPS (6 dmg vs sword 34/0.65 s); no bash→attack
cancel; works while blocking; walls respected. Client: HUD/guide/journal hints, mobile button with
cooldown feedback, graceful rejection toasts. World FX: one additive ground ring + pooled dust/sparks,
30 ms hit-stop/shake normally, 120 ms static ring under reduced motion, no double rig flash; single
`ss-bash` dispatch (server event → scene FX → audio). `__ssBashFx()`/`__ssTriggerBashFx()` hooks.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; two clean builds reproduced `index-Dwublozr.js`; `validate-assets`
  **85/85**.
- Fresh-build smoke **27/27** (incl. freshness) + exact hash, characters **120/123** (3 harness-only
  audio-timing failures fixed and green in perf 123/123), perf **123/123** (spawn **185 calls /
  1,636,132 tris**), mobile **26/26**, co-op **22/22**, live baseline **32/32**, 11 cards, 0 errors/404s.
- Payload **17.63 MiB**; props/audio/bash verified with deterministic hooks.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 13 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-14 (next) — from the audit

1. Warden-mode forced-boss authoritative screenshot; QA forced Screamer capture.
2. `torch_post` placement (asset installed — add to flames/lightless layer).
3. Near-forge/chapel audio landmark ear check (human).
4. Physical-device mobile / real-GPU / perceptual playtests; hardware controller rumble test.
5. Further content/campaign depth.

## Previous cycles

- **2026-10O cycle 12** (`docs/BATCH-2026-10O-RESULTS.md`): chronicle lore (16 entries), run recap +
  epilogue, Shroud Screamer behaviour, victory/defeat mood, difficulty snapshot fix, freshness gate.
- **2026-10N cycle 11** (`docs/BATCH-2026-10N-RESULTS.md`): difficulty modes (Squire/Knight/Warden),
  boss HP bar + world aura/scale/tint, balance sims, QA gap closure.
- **2026-10M cycle 10** (`docs/BATCH-2026-10M-RESULTS.md`): campaign journal + next-objective HUD,
  wayfinding overlay, siege bosses, QA force-siege path, audio focus ramp.
- **2026-10L cycle 9** (`docs/BATCH-2026-10L-RESULTS.md`): War Spear (11th weapon) + rackPool drops,
  ruined abbey landmark, hit-flash hold, weapon QA hooks, audio diagnostics.
- **2026-10K cycle 8** (`docs/BATCH-2026-10K-RESULTS.md`): mobile/touch HUD, device-aware quality,
  enemy preview, per-hit feedback, nest decals.
- **2026-10J cycle 7** (`docs/BATCH-2026-10J-RESULTS.md`): enemy variants, strict-mask palette 7/7,
  content-capture culling, plague dressing, a11y captions.
- **2026-10I cycle 6** (`docs/BATCH-2026-10I-RESULTS.md`): Wandering Survivor, rumble/hints,
  reduced-motion fix, cloth-wind, altar candles.
- **2026-10H cycle 5** (`docs/BATCH-2026-10H-RESULTS.md`): armour art v3, cloth wind, snowstorms,
  combat feel, altar/forge content, surface audio.
- **2026-10G cycle 4** (`docs/BATCH-2026-10G-RESULTS.md`): armour v2, weather + audio, tone/HUD,
  wells/stalls.
- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity, foliage/ruins, elites,
  fire/smoke, region audio.
- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2, quantised-ruin fix,
  trees/shadows, keep atlas, adaptive audio.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters, shadows,
  301→173 calls, LODs, doc links.
- **2026-10C / 2026-10B / 2026-10** earlier: performance & smoothness (43.5→9.47 MB payload,
  88,544→301 calls), combat/arsenal/co-op QA, battlefield overhaul; asset pipeline in
  `docs/ASSET-PIPELINE.md`.

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
