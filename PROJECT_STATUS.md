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

## Latest completed cycle — 2026-10I cycle 6: sixth appearance, controller polish, QA debts

Contract: `docs/BATCH-2026-10I-SPEC.md`; results: `docs/BATCH-2026-10I-RESULTS.md`; QA evidence in
`docs/QA-REPORT.md`. Final bundle `index-BY6s-QI9.js` (883,369 B), deterministic across two builds.

### Sixth playable appearance — Wandering Survivor

`survivor` added to `PLAYER_CHARACTERS` (6 selectable appearances; landing + in-game selectors).
Existing survivor rig has the Mixamo clip set and hand sockets; QA verified selection → authoritative
appearance → third-person render with Longsword attached and feet grounded. The baked walking staff
was re-weighted from RightHand to Spine2/Hips and authored stowed across the back (zero hand-rigid
vertices) so it no longer swings with a held sword; equipment tests assert the new contract.

### Controller polish

Rumble via `vibrationActuator` on hurt (weapon-weight-scaled), block and castle capture; guarded by
reduced-motion/menu/pause/hidden and actuator presence, reset on blur/menu/disconnect. Controller
glyph hints bar (`#padHints`: RT Attack, LT Block, B Sweep, X Heal, A Interact, Y View) shown only
for standard-mapping pads with connect/disconnect toasts. QA hooks `__ssPad()` +
`__ssCharacterSelect()`. Physical rumble is hardware debt (headless cannot vibrate).

### QA debts cleared

- Reduced-motion vignette residual: combat camera hard-clears every frame under reduced motion
  (vignette 0, hit-stop 0, kick ≤0.002 in two QA samples; normal peaks unchanged).
- Low-tier cloth-wind isolation via `__ssCharacterFx()` → `{quality, clothWind}`.
- `landmark-crown` camera fully inside Frozen Crown (region reports crown).
- Deterministic clear weather for QA: `__ssClearWeather()` + `weather` in `__ssPerf()`.
- Altar night readability: 3 candle flames appended to the existing flames layer (0 draws, 0 lights)
  + subtle warm emissive lift; isolated evidence `view-content-altar-close2.png`. Capture caveat:
  content-altar QA poses move only the camera while the altar layer is player-distance-culled at
  85 m — cycle-7 needs a teleport/spawn hook or QA-camera-following culling.

### Masked-palette art debt (documented, not blocking)

QA crop gate **7/7 ≥500** (605–955). Strict silhouette mask **4/7 ≥500** (templar 559, ally 707,
berserker 725, survivor 1077; hero 454, fallen 460, ranger 379). Fix directions in
`ASSET-PIPELINE.md`: ranger lighten re-dyed cloak base; hero/fallen stronger luminance-separated
plate chips/trim.

### Verification (final artifact)

- `npm test` **58/58**; `tsc` 0; deterministic build reproduced `index-BY6s-QI9.js` twice;
  `validate-assets` **78/78**.
- Fresh-build smoke **26/26** + hash proof, 0 errors/404s, 10 cards, WS 1/0.
- Characters: crop palette 7/7 ≥500; torso 82.35/72.32; clip 0; elite 30.82/88.4 %.
- Perf **206 calls / 1,726,578 tris** (gates <280/<2.05 M); FP 160/1.61 M; low 161/1.41 M;
  payload **16.31 MiB**; HUD click→HUD 4.5 s / state 6.6 s / join 3.77 s.
- Co-op **18/18**, live baseline **21/21**.

### Deployed state

Live bundle is the hosting build of this commit sequence (`feat: AAA cycle 6 …` → hosting pin commit →
Cloudflare deploy → QA final live pass). Local play: `$env:PORT=3000; node --import tsx
src/server/index.ts` from the game repo → http://localhost:3000/.

### Cycle-7 (next) — from the audit

1. Strict-mask palette: ranger (lighten dye base), hero/fallen (luminance-separated plate chips) —
   target ≥5/7.
2. Altar content capture: teleport/spawn QA hook or QA-camera-following dressing culling.
3. Physical controller rumble + real hardware gamepad test; surface-audio ear check.
4. Real-GPU/perceptual playtests and mobile support.
5. Content depth: more enemy variety (warehouse models), campaign/siege objectives polish, balance.

## Previous cycles

- **2026-10H cycle 5** (`docs/BATCH-2026-10H-RESULTS.md`): armour art v3 + survivor identity, cloth
  wind, dense snowstorms, combat feel, altar/forge content, surface audio; 208 calls / 1.727 M tris.
- **2026-10G cycle 4** (`docs/BATCH-2026-10G-RESULTS.md`): armour v2, dynamic regional weather +
  weather audio, tone/HUD fixes, wells/stalls; 206 calls / 1.728 M tris.
- **2026-10F cycle 3** (`docs/BATCH-2026-10F-RESULTS.md`): regional identity, warehouse foliage +
  landmark ruins, elite undead, fire/smoke sprites, region audio; 195 calls / 1.667 M tris.
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
