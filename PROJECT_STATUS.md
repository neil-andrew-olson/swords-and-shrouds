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
teammate edits after the Lead's gate, the hash changes and QA must be told the definitive artifact.

## Latest completed cycle — 2026-10H cycle 5: armour art v3, snowstorm, combat feel, surface audio

Contract: `docs/BATCH-2026-10H-SPEC.md`; results: `docs/BATCH-2026-10H-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `dist/client/assets/index-CsjSWrV-.js` (879,493 B), deterministic
across two clean builds.

### Armour art v3 + survivor identity

- World-scale plate UVs (no more stretched/"wood-grain" faces), low-frequency atlas + softened
  normals, hue-separated detail (teal patina/rust/oxide, patchwork cloth, three-hue heraldry),
  **1024² armour atlas on all 7** bodies; files 706.6–783.8 KB, tris 8,749–9,433.
- Survivor rebuilt: tattered hood/cloak with patches, bedroll+satchel, rope belt, walking staff
  rigid-weighted to the hand — distinct from a soldier (QA diff 4.69/10.87 %).
- **Cloth wind sway** on tabard/cloak/fur prims (bounds-normalised, foliage-style, allocation-free)
  with `setCharacterWindQuality` wired to quality tiers.
- Geometry gate: no armour triangle over 0.5 bind units² remains (fallen face 0.0353→0.0088 m²).
- QA: crop palette 7/7 ≥500 (618–941); strict masked 4/7 (606/739/1073/697/402/424/376) = cycle-6
  art debt for ranger/hero/fallen.

### Snowstorm + hooks (cycle-4 debt cleared)

Dense separate billboard snow: 480 flakes at snow → **800 at snowstorm**, larger flakes, gust drift,
whiteout fog 0.0195→0.0249, frost tint, **0 snow at low tier**. `__ssWeather().activeParticles.snow`
exposed; `__ssPreviewBody` fixed (7/7 render); `region-crown` camera fully inside crown (reports
crown); bonus `__ssSurfaceAt(x,z)`.

### Combat feel (new)

Heavy-hit hit-stop 57.8–60 ms (visual only), camera kick/shake, directional red damage vignette, FOV
punch, tier-scaled from `weaponCombatProfile`; `__ssCombatFx()` state + `prefers-reduced-motion` /
`__ssSetReducedMotion()` verified (hit-stop 0, kick ≤0.013, vignette 0 in two runs; one residual
0.546 sample noted for cycle 6).

### Content + surface audio

`stone_altar` at the Ashen chapel approach + `forge_furnace` ×2 at the smithy stalls (+2 layers,
+2 draws, ~17.9 k tris map-wide); surface-aware footsteps (stone/grass/snow/ash/wood, walk/run
cadence), chapel choir ambience at the altar, forge ambience at both furnaces (anchored on
ruins-builder's exported constants), preferring `__ssSurfaceAt`.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-CsjSWrV-.js` twice;
  `validate-assets` **78/78**.
- Fresh-build smoke **22/22** + hash proof, 0 errors/404s/warnings, 10 cards, WS 1/0, night
  forced-clear TP 56.56.
- Perf **208 calls / 1,726,954 tris** (gates <270/<2.0 M); FP 160/1.609 M; low 162/1.414 M;
  payload **16.25 MiB**. HUD app path click→HUD 158 ms / click→state 1,146 ms / join 3,330 ms.
- Co-op **18/18**, live baseline **19/19**, QA views 31/31 (12 optional content views).

### Deployed state

Live bundle for cycle 5 is the hosting build of this commit (see commit history
`feat: AAA cycle 5 …` → hosting pin commit → Cloudflare deploy → QA final live pass). Local play:
`$env:PORT=3000; node --import tsx src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-6 (next) — from the audit

1. Strict silhouette-mask palette: hue chips on ranger cloak exterior, hero plate faces, fallen
   patina (asset-forge targets in ASSET-PIPELINE).
2. Altar night readability (scale/position/local lighting); verify reduced-motion vignette damping;
   low-tier cloth-wind isolation; surface-audio ear check.
3. Real-GPU/perceptual/controller/mobile playtests (headless QA is SwiftShader only).
4. Content depth: more enemy variety (warehouse models), campaign/siege objectives polish, balance;
   `landmark-crown` camera fine-tune.
5. Keep the loop: every cycle verified 58/58 + tsc + build + validator + QA + live deploy.

## Previous cycles

- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity, warehouse card foliage
  + landmark ruins, elite undead, fire/smoke sprites, region audio, loading rework; 195 calls /
  1.667 M tris.
- **2026-10G cycle 4** (`docs/BATCH-2026-10G-RESULTS.md`): character armour v2, dynamic regional
  weather + weather audio, tone/HUD fixes, stone wells & blacksmith stalls; 206 calls / 1.728 M tris.
- **2026-10E cycle 2** (`docs/BATCH-2026-10E-RESULTS.md`): character material v2 (normal/ORM,
  silhouettes), quantised-ruin geometry fix, near/far trees, shadows, keep atlas merge, adaptive
  audio.
- **2026-10D cycle 1** (`docs/BATCH-2026-10D-RESULTS.md`): fixed blacked-out characters (UV0 rebuild +
  baked atlases + rim), restored shadows, 301→173 calls, LODs, doc-link fix.
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
