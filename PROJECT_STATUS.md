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
co-op 18/18 + live-URL mode, QA inspects screenshots with read_image, Lead commits/pushes/deploys
and verifies the live bundle.

**Doc-link note:** the DSH GUI cannot open absolute Windows paths (that is why md links showed
"File not found"). `PROJECT_STATUS.md` and `docs/*.md` are mirrored into the session workspace at
`C:\Users\neil\Documents\deepseek-harness\default-workspace\swords-and-shrouds\`; always link
workspace-relative paths and/or use the `present` tool.

**Process discipline:** teammates kill only their own PIDs (`Stop-Process -Id` / `/PID`), never
broad `taskkill /IM node.exe`. One dist builder at a time; QA owns authoritative captures. If a
teammate edits after the Lead's gate, the hash changes and QA must be given the definitive artifact.

## Latest completed cycle — 2026-10K cycle 8: mobile/touch, device quality, preview/hit feedback

Contract: `docs/BATCH-2026-10K-SPEC.md`; results: `docs/BATCH-2026-10K-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-2pShR6WA.js` (898,219 B), deterministic across two builds.

### Mobile / touch experience

- Responsive touch HUD (`body.touch-device`/`small-screen`, safe-area insets): portrait 390×844 +
  landscape 844×390 layouts, no overlapping panels, thumb-reachable controls, keyboard hints hidden
  on touch, scrollable finger-sized Settings.
- Touch input: radial-deadzone analog stick (`touchStickVector()`), shared deadzone preset, persisted
  touch look sensitivity (0.4–2.0), per-control pointer capture for simultaneous move+look+attack,
  gesture/scroll/zoom suppression; desktop pointer-lock untouched.
- **Device-aware quality** `__ssDeviceProfile()`: touch/coarse/small-screen/low-memory detection →
  auto low/medium/high (SwiftShader low), DPR clamps 1.25/1.5/2; saved `ss-quality` never overridden.
- QA mobile emulation 22/22: HUD active/no overlaps, pinch scale stays 1, 3-pointer multi-touch
  (player moved 4.1 m, yaw changed), profile/mobile perf 130 calls / 1.31 M tris, desktop unchanged.

### Enemy preview + hit feedback v2

- `__ssPreviewEnemy(appearance, distance?)` frames all four undead appearances (base + variants) in
  an open spot, returns `{ok,appearance,distance,ready,actorId}`, registers with the rig registry for
  `__ssTriggerEnemyHit()`, `null` restores. QA captured all four at 2.8 m and 10 m.
- Every damaging hit: weapon-scaled 80–140 ms emissive material flash (originals stashed/restored,
  no pooled leaks), pivot-only stagger (grounding safe), weapon-tinted impact spark; works on all
  variants; reduced motion suppresses. QA verified flash 111–130 ms, stagger 160–183 ms, suppression.

### Tone + content polish

- Zombie-bloated night tone 131 → 106.9 body mean (base 82.5) via staged albedo/roughness/factor
  reduction; accepted as intentional plague-pale (+24 vs base). Cycle-9 lever: lighting bias, not
  albedo. Hero headroom attempt regressed (492 vs 526) → reverted byte-identical; strict-mask gate
  stays **7/7 ≥500** (561/526/721/651/694/1082/937).
- Plague-nest ground: 44 feather-mask corruption decals (single instanced draw when visible, pulsed,
  160 m culling) + 3 enrichment props (29 props + 6 flames total, 0 new layers/draws).

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-2pShR6WA.js` twice;
  `validate-assets` **80/80**.
- Fresh-build smoke **26/26** + hash proof, 0 errors/404s, 10 cards; characters 67/67, perf 70/70,
  mobile 22/22, co-op **18/18**, live baseline **26/26**.
- Perf **211 calls / 1,735,004 tris** (gates <290/<2.15 M); FP 165/1.62 M; low 162/1.42 M; payload
  **17.06 MiB**; HUD click→HUD 3.27 s / state 6.29 s / join 3.61 s; night 51.2.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 8 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-9 (next) — from the audit

1. Physical-device mobile + real-GPU + perceptual playtests (headless emulation is not hardware);
   hardware controller rumble test.
2. Hit-flash frame-sync capture (dedicated freeze/hook for QA visual proof).
3. Surface-audio ear check; zombie-bloated lighting-bias tone pass; hero body-atlas headroom.
4. Content/campaign depth: siege objectives polish, balance, more enemy types/props from warehouse;
   mobile real-device QA.

## Previous cycles

- **2026-10J cycle 7** (`docs/BATCH-2026-10J-RESULTS.md`): enemy variants (bloated/armoured),
  strict-mask palette cleared 7/7, QA content-capture culling, plague dressing, a11y captions,
  controller deadzone/sensitivity.
- **2026-10I cycle 6** (`docs/BATCH-2026-10I-RESULTS.md`): Wandering Survivor sixth appearance,
  controller rumble/hints, reduced-motion vignette fix, cloth-wind isolation, altar candle glows.
- **2026-10H cycle 5** (`docs/BATCH-2026-10H-RESULTS.md`): armour art v3 + survivor identity, cloth
  wind, dense snowstorms, combat feel, altar/forge content, surface audio.
- **2026-10G cycle 4** (`docs/BATCH-2026-10G-RESULTS.md`): armour v2, dynamic regional weather +
  weather audio, tone/HUD fixes, wells/stalls.
- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity, warehouse foliage +
  landmark ruins, elite undead, fire/smoke sprites, region audio.
- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2, quantised-ruin fix,
  trees/shadows, keep atlas, adaptive audio.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters, restored
  shadows, 301→173 calls, LODs, working doc links.
- **2026-10C / 2026-10B / 2026-10** earlier batches: performance & smoothness (43.5→9.47 MB payload,
  88,544→301 calls), readability/combat/arsenal/co-op QA, battlefield overhaul; asset pipeline +
  attribution in `docs/ASSET-PIPELINE.md`.

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
